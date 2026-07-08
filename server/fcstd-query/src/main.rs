//! fcstd-query: Rust CLI for querying Phoenix CAD SQLite databases.
//! Used by Node.js cad-rust module as a sidecar process.
//!
//! Commands:
//!   parts <db> [--search <q>]           → phoenix_cad_part_key
//!   fcstd-map <db> [--search <q>] [--kind <k>] [--offset <n>] [--limit <n>]
//!   bom-xref-meta <db>                  → assembly BOM hosts
//!   bom-file <db> --rel <path>          → file_asset by rel path

use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("Usage: fcstd-query <command> <db-path> [options]");
        eprintln!("Commands: parts, fcstd-map, bom-xref-meta, bom-file");
        std::process::exit(1);
    }
    let cmd = &args[1];
    let db_path = &args[2];
    let opts = parse_opts(&args[3..]);

    let conn = match Connection::open(db_path) {
        Ok(c) => c,
        Err(e) => { eprintln!("DB open error: {e}"); std::process::exit(1); }
    };

    let result = match cmd.as_str() {
        "parts" => query_parts(&conn, &opts),
        "fcstd-map" => query_fcstd_map(&conn, &opts),
        "bom-xref-meta" => query_bom_xref_meta(&conn),
        "bom-xref-incoming" => query_bom_xref_incoming(&conn, &opts),
        "bom-xref-outgoing" => query_bom_xref_outgoing(&conn, &opts),
        "bom-xref-counts" => query_bom_xref_counts(&conn, &opts),
        "bom-tree" => query_bom_tree(&conn, &opts),
        "bom-file" => query_bom_file(&conn, &opts),
        "scan-recent" => query_scan_recent(&conn, &opts),
        "file-upsert" => exec_file_upsert(&conn, &opts),
        _ => { eprintln!("Unknown command: {cmd}"); std::process::exit(1); }
    };

    match result {
        Ok(json) => println!("{json}"),
        Err(e) => { eprintln!("Query error: {e}"); std::process::exit(1); }
    }
}

#[derive(Default)]
struct Opts {
    search: Option<String>,
    kind: Option<String>,
    offset: i64,
    limit: i64,
    rel: Option<String>,
}

fn parse_opts(args: &[String]) -> Opts {
    let mut o = Opts { offset: 0, limit: 100, ..Default::default() };
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--search" => { i+=1; o.search = args.get(i).cloned(); }
            "--kind"   => { i+=1; o.kind = args.get(i).cloned(); }
            "--offset" => { i+=1; o.offset = args.get(i).and_then(|s| s.parse().ok()).unwrap_or(0); }
            "--limit"  => { i+=1; o.limit = args.get(i).and_then(|s| s.parse().ok()).unwrap_or(100); }
            "--rel"    => { i+=1; o.rel = args.get(i).cloned(); }
            _ => {}
        }
        i += 1;
    }
    o
}

// ── queries ──────────────────────────────────────────

fn query_parts(conn: &Connection, opts: &Opts) -> Result<String, rusqlite::Error> {
    let where_clause = if opts.search.is_some() {
        "WHERE (part_number LIKE ?1 OR part_version LIKE ?1 OR part_name LIKE ?1)"
    } else { "" };
    let sql = format!(
        "SELECT part_number, part_version, part_name, type_code, model_series,
                (SELECT COUNT(*) FROM phoenix_cad_part_file_link WHERE part_key_id = pk.id) as file_count
         FROM phoenix_cad_part_key pk {where_clause} ORDER BY part_number, part_version LIMIT ?2"
    );

    let mut stmt = conn.prepare(&sql)?;
    let search_param = opts.search.as_ref().map(|q| format!("%{q}%")).unwrap_or_default();
    let rows: Vec<PartRow> = stmt.query_map(
        params![search_param, opts.limit],
        |row| Ok(PartRow {
            part_number: row.get(0)?, part_version: row.get(1)?, part_name: row.get(2)?,
            type_code: row.get(3)?, model_series: row.get(4)?, file_count: row.get(5)?,
        }),
    )?.filter_map(|r| r.ok()).collect();

    Ok(serde_json::to_string(&RowsWrapper { items: rows }).unwrap())
}

fn query_fcstd_map(conn: &Connection, opts: &Opts) -> Result<String, rusqlite::Error> {
    let mut conditions = vec!["file_status = 'present'".to_string()];
    if let Some(k) = &opts.kind {
        if k != "all" && !k.is_empty() { conditions.push(format!("asset_kind = '{k}'")); }
    }
    if let Some(q) = &opts.search {
        let p = q.replace('\'', "''");
        conditions.push(format!("(repo_rel_path LIKE '%{p}%' OR part_number LIKE '%{p}%' OR part_name LIKE '%{p}%')"));
    }
    let where_clause = if conditions.is_empty() { String::new() } else { format!("WHERE {}", conditions.join(" AND ")) };
    let sql = format!(
        "SELECT repo_rel_path, filename, asset_kind, part_number, part_version, part_name, label, file_status
         FROM phoenix_cad_file_asset {where_clause} ORDER BY repo_rel_path LIMIT ?1 OFFSET ?2"
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows: Vec<FcstdMapRow> = stmt.query_map(params![opts.limit, opts.offset], |row| {
        Ok(FcstdMapRow {
            repo_rel_path: row.get(0)?,
            filename: row.get(1)?,
            asset_kind: row.get(2)?,
            part_number: row.get(3)?,
            part_version: row.get(4)?,
            part_name: row.get(5)?,
            label: row.get(6)?,
            file_status: row.get(7)?,
        })
    })?.filter_map(|r| r.ok()).collect();

    Ok(serde_json::to_string(&RowsWrapper { items: rows }).unwrap())
}

fn query_bom_xref_meta(conn: &Connection) -> Result<String, rusqlite::Error> {
    #[derive(Serialize)]
    struct HostRow {
        host_rel: String, host_filename: String,
        direct_children: i64, total_descendants: i64,
        incoming_count: i64, issues_count: i64,
    }

    let mut stmt = conn.prepare(
        "SELECT fa.repo_rel_path, fa.filename,
                (SELECT COUNT(DISTINCT target_repo_rel_path) FROM phoenix_cad_bom_xref WHERE host_repo_rel_path = fa.repo_rel_path) as direct_children,
                (SELECT COUNT(*) FROM phoenix_cad_bom_line WHERE assembly_rel = fa.repo_rel_path) as total_descendants,
                (SELECT COUNT(*) FROM phoenix_cad_bom_xref WHERE target_repo_rel_path = fa.repo_rel_path) as incoming_count,
                0 as issues_count
         FROM phoenix_cad_file_asset fa
         WHERE fa.file_status = 'present'
         AND EXISTS (SELECT 1 FROM phoenix_cad_bom_xref WHERE host_repo_rel_path = fa.repo_rel_path)
         ORDER BY fa.repo_rel_path"
    )?;
    let rows: Vec<HostRow> = stmt.query_map([], |row| Ok(HostRow {
        host_rel: row.get(0)?, host_filename: row.get(1)?,
        direct_children: row.get(2)?, total_descendants: row.get(3)?,
        incoming_count: row.get(4)?, issues_count: row.get(5)?,
    }))?.filter_map(|r| r.ok()).collect();

    Ok(serde_json::to_string(&RowsWrapper { items: rows }).unwrap())
}

fn query_bom_file(conn: &Connection, opts: &Opts) -> Result<String, rusqlite::Error> {
    let rel = opts.rel.as_deref().unwrap_or("");
    // Try exact match first, then LIKE
    let row = conn.query_row(
        "SELECT repo_rel_path, filename, asset_kind, part_number, part_version, part_name, label, file_status
         FROM phoenix_cad_file_asset WHERE repo_rel_path = ?1 AND file_status = 'present'",
        params![rel],
        |row| Ok(FcstdMapRow {
            repo_rel_path: row.get(0)?, filename: row.get(1)?,
            asset_kind: row.get(2)?, part_number: row.get(3)?,
            part_version: row.get(4)?, part_name: row.get(5)?,
            label: row.get(6)?, file_status: row.get(7)?,
        }),
    ).or_else(|_| {
        conn.query_row(
            "SELECT repo_rel_path, filename, asset_kind, part_number, part_version, part_name, label, file_status
             FROM phoenix_cad_file_asset WHERE repo_rel_path LIKE ?1 AND file_status = 'present' LIMIT 1",
            params![format!("%{rel}")],
            |row| Ok(FcstdMapRow {
                repo_rel_path: row.get(0)?, filename: row.get(1)?,
                asset_kind: row.get(2)?, part_number: row.get(3)?,
                part_version: row.get(4)?, part_name: row.get(5)?,
                label: row.get(6)?, file_status: row.get(7)?,
            }),
        )
    });

    match row {
        Ok(r) => Ok(serde_json::to_string(&r).unwrap()),
        Err(_) => Ok("null".to_string()),
    }
}

fn query_bom_xref_incoming(conn: &Connection, opts: &Opts) -> Result<String, rusqlite::Error> {
    let rel = opts.rel.as_deref().unwrap_or("");
    #[derive(Serialize)] struct Row { host_repo_rel_path: String, host_filename: String, link_label: Option<String>, ref_kind: Option<String>, }
    let mut stmt = conn.prepare(
        "SELECT DISTINCT x.host_repo_rel_path,
                (SELECT filename FROM phoenix_cad_file_asset WHERE repo_rel_path = x.host_repo_rel_path) as host_filename,
                x.link_label, x.ref_kind
         FROM phoenix_cad_bom_xref x
         WHERE (x.target_repo_rel_path = ?1 OR x.target_repo_rel_path LIKE ?2)
         ORDER BY x.host_repo_rel_path LIMIT 500"
    )?;
    let rows: Vec<Row> = stmt.query_map(params![rel, format!("%{rel}")], |row| Ok(Row {
        host_repo_rel_path: row.get(0)?, host_filename: row.get(1)?, link_label: row.get(2)?, ref_kind: row.get(3)?,
    }))?.filter_map(|r| r.ok()).collect();
    Ok(serde_json::to_string(&RowsWrapper { items: rows }).unwrap())
}

fn query_bom_xref_outgoing(conn: &Connection, opts: &Opts) -> Result<String, rusqlite::Error> {
    let rel = opts.rel.as_deref().unwrap_or("");
    #[derive(Serialize)] struct Row { target_repo_rel_path: String, target_filename: String, link_label: Option<String>, target_part_number: Option<String>, }
    let mut stmt = conn.prepare(
        "SELECT DISTINCT x.target_repo_rel_path,
                (SELECT filename FROM phoenix_cad_file_asset WHERE repo_rel_path = x.target_repo_rel_path) as target_filename,
                x.link_label, x.target_part_number
         FROM phoenix_cad_bom_xref x WHERE x.host_repo_rel_path = ?1
         ORDER BY x.target_repo_rel_path LIMIT 500"
    )?;
    let rows: Vec<Row> = stmt.query_map(params![rel], |row| Ok(Row {
        target_repo_rel_path: row.get(0)?, target_filename: row.get(1)?, link_label: row.get(2)?, target_part_number: row.get(3)?,
    }))?.filter_map(|r| r.ok()).collect();
    Ok(serde_json::to_string(&RowsWrapper { items: rows }).unwrap())
}

fn query_bom_xref_counts(conn: &Connection, opts: &Opts) -> Result<String, rusqlite::Error> {
    let rel = opts.rel.as_deref().unwrap_or("");
    let incoming: i64 = conn.query_row(
        "SELECT COUNT(DISTINCT host_repo_rel_path) FROM phoenix_cad_bom_xref WHERE target_repo_rel_path = ?1 OR target_repo_rel_path LIKE ?2",
        params![rel, format!("%{rel}")], |row| row.get(0),
    ).unwrap_or(0);
    let outgoing: i64 = conn.query_row(
        "SELECT COUNT(DISTINCT target_repo_rel_path) FROM phoenix_cad_bom_xref WHERE host_repo_rel_path = ?1",
        params![rel], |row| row.get(0),
    ).unwrap_or(0);
    let flat: i64 = conn.query_row(
        "SELECT COUNT(*) FROM phoenix_cad_bom_line WHERE assembly_rel = ?1",
        params![rel], |row| row.get(0),
    ).unwrap_or(0);
    Ok(serde_json::to_string(&serde_json::json!({ "incoming": incoming, "outgoing": outgoing, "flat_lines": flat })).unwrap())
}

fn query_bom_tree(conn: &Connection, opts: &Opts) -> Result<String, rusqlite::Error> {
    let rel = opts.rel.as_deref().unwrap_or("");
    #[derive(Serialize)] struct Row { depth: i64, part_rel: String, part_key: String, quantity: i64, bom_path: String, }
    let mut stmt = conn.prepare(
        "SELECT depth, part_rel, part_key, quantity, bom_path
         FROM phoenix_cad_bom_line WHERE assembly_rel = ?1
         ORDER BY depth, part_rel LIMIT 5000"
    )?;
    let rows: Vec<Row> = stmt.query_map(params![rel], |row| Ok(Row {
        depth: row.get(0)?, part_rel: row.get(1)?, part_key: row.get(2)?, quantity: row.get(3)?, bom_path: row.get(4)?,
    }))?.filter_map(|r| r.ok()).collect();
    Ok(serde_json::to_string(&RowsWrapper { items: rows }).unwrap())
}

fn query_scan_recent(conn: &Connection, opts: &Opts) -> Result<String, rusqlite::Error> {
    #[derive(Serialize)] struct Row { scan_uuid: Option<String>, scanned_at: String, status: String, stats_json: Option<String>, }
    let limit = opts.limit.max(1).min(50);
    let mut stmt = conn.prepare(
        "SELECT scan_uuid, scanned_at, status, stats_json FROM phoenix_cad_scan ORDER BY scanned_at DESC LIMIT ?1"
    )?;
    let rows: Vec<Row> = stmt.query_map(params![limit], |row| Ok(Row {
        scan_uuid: row.get(0)?, scanned_at: row.get(1)?, status: row.get(2)?, stats_json: row.get(3)?,
    }))?.filter_map(|r| r.ok()).collect();
    Ok(serde_json::to_string(&RowsWrapper { items: rows }).unwrap())
}

fn exec_file_upsert(conn: &Connection, opts: &Opts) -> Result<String, rusqlite::Error> {
    let rel = opts.rel.as_deref().unwrap_or("");
    let filename = rel.rsplit('/').next().unwrap_or(rel);
    let kind = opts.kind.as_deref().unwrap_or("fcstd");
    // UPSERT: insert or update phoenix_cad_file_asset
    conn.execute(
        "INSERT INTO phoenix_cad_file_asset (repo_rel_path, filename, asset_kind, file_status, last_seen_at, updated_at)
         VALUES (?1, ?2, ?3, 'present', datetime('now'), datetime('now'))
         ON CONFLICT(repo_rel_path) DO UPDATE SET file_status='present', last_seen_at=datetime('now'), updated_at=datetime('now')",
        params![rel, filename, kind],
    )?;
    Ok(r#"{"ok":true}"#.to_string())
}

// ── output types ─────────────────────────────────────

#[derive(Serialize)]
struct PartRow {
    part_number: String, part_version: String, part_name: Option<String>,
    type_code: Option<String>, model_series: Option<String>,
    file_count: Option<i64>,
}

#[derive(Serialize)]
struct FcstdMapRow {
    repo_rel_path: String, filename: String, asset_kind: Option<String>,
    part_number: Option<String>, part_version: Option<String>,
    part_name: Option<String>, label: Option<String>,
    file_status: Option<String>,
}

#[derive(Serialize)]
struct RowsWrapper<T: Serialize> { items: Vec<T> }
