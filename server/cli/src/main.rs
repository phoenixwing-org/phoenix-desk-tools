//! cad-rust CLI: read FCStd files, write BOM properties.
use std::collections::HashMap;
use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: fcstd-read <file.fcstd>");
        eprintln!("       fcstd-read write-bom <file.fcstd> <key=value>...");
        std::process::exit(1);
    }

    if args[1] == "write-bom" {
        if args.len() < 4 {
            eprintln!("Usage: fcstd-read write-bom <file.fcstd> <key=value>...");
            std::process::exit(1);
        }
        let path = PathBuf::from(&args[2]);
        let mut values = HashMap::new();
        for arg in &args[3..] {
            if let Some((k, v)) = arg.split_once('=') {
                values.insert(k.to_string(), v.to_string());
            }
        }
        match fcstd_reader::write::write_bom_props(&path, &values) {
            Ok(true) => println!("{{\"ok\":true,\"written\":{}}}", values.len()),
            Ok(false) => { eprintln!("No suitable mount object found"); std::process::exit(2); }
            Err(e) => { eprintln!("Error: {e}"); std::process::exit(1); }
        }
    } else {
        let path = PathBuf::from(&args[1]);
        match fcstd_reader::read_fcstd(&path) {
            Ok(doc) => println!("{}", serde_json::to_string_pretty(&doc).unwrap()),
            Err(e) => { eprintln!("Error: {e}"); std::process::exit(1); }
        }
    }
}
