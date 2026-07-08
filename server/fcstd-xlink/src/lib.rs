//! fcstd-xlink: FreeCAD FCStd XLink attribute manipulation.
//! Rust port of Python rename_analysis/xlink.py core functions.

use regex::Regex;
use std::io::{Read, Write};
use std::path::Path;

pub mod error;
pub use error::XlinkError;

/// Replace old basename with new basename in an XLink file attribute.
/// `attr`: the original XLink `file` value (e.g. "old_part.FCStd")
/// Returns the modified attribute, or None if no change needed.
///
/// Corresponds to Python: replace_basename_in_xlink_attr()
pub fn replace_basename_in_xlink_attr(attr: &str, old_basename: &str, new_basename: &str) -> Option<String> {
    let s = attr.replace('\\', "/").trim().to_string();
    if !s.ends_with(old_basename) { return None; }
    let prefix = &s[..s.len() - old_basename.len()];
    Some(format!("{prefix}{new_basename}"))
}

/// Scan Document.xml for XLink elements referencing files matching target_basename.
/// Returns list of (xlink_attr_value, link_label).
///
/// Corresponds to Python: scan_document_xml_xlink_hits()
pub fn scan_xlink_hits(xml: &str, target_basename: &str) -> Vec<XlinkHit> {
    let file_re = Regex::new(&format!(r#"<XLink\s+file="([^"]*{}[^"]*)"(\s+label="([^"]*)")?"#, regex::escape(target_basename))).unwrap();
    file_re.captures_iter(xml).map(|cap| XlinkHit {
        file: cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default(),
        label: cap.get(3).map(|m| m.as_str().to_string()),
    }).collect()
}

/// Read reference labels by XLink file attribute from XML.
///
/// Corresponds to Python: read_reference_labels_by_xlink_attr()
pub fn read_reference_labels(xml: &str) -> Vec<(String, String)> {
    let re = Regex::new(r#"<XLink\s+file="([^"]+)"\s+label="([^"]*)"\s*/>"#).unwrap();
    re.captures_iter(xml).filter_map(|cap| {
        let file = cap.get(1)?.as_str().to_string();
        let label = cap.get(2).map(|m| m.as_str().to_string()).unwrap_or_default();
        Some((file, label))
    }).collect()
}

/// Apply XLink file attribute replacements in Document.xml.
/// `replacements`: {old_attr_value: new_attr_value}
/// Returns (patched_xml, count_of_replacements).
pub fn patch_xlink_attrs(xml: &str, replacements: &std::collections::HashMap<String, String>) -> (String, usize) {
    let re = Regex::new(r#"file="([^"]+)""#).unwrap();
    let mut count = 0;
    let result = re.replace_all(xml, |caps: &regex::Captures| {
        let old_val = caps.get(1).unwrap().as_str();
        if let Some(new_val) = replacements.get(old_val) {
            count += 1;
            format!(r#"file="{}""#, new_val)
        } else {
            caps.get(0).unwrap().as_str().to_string()
        }
    }).to_string();
    (result, count)
}

/// Open FCStd ZIP, apply XLink attribute replacements, write back.
/// Returns count of replacements made.
pub fn patch_fcstd_xlink_attrs(fcstd_path: &Path, replacements: &std::collections::HashMap<String, String>) -> Result<usize, XlinkError> {
    // 1. Read ZIP
    let file = std::fs::File::open(fcstd_path).map_err(|e| XlinkError::Io { path: fcstd_path.to_path_buf(), msg: e.to_string() })?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| XlinkError::Zip { path: fcstd_path.to_path_buf(), msg: e.to_string() })?;

    let mut xml_bytes = Vec::new();
    zip.by_name("Document.xml").map_err(|_| XlinkError::MissingXml)?.read_to_end(&mut xml_bytes).map_err(|e| XlinkError::Io { path: fcstd_path.to_path_buf(), msg: e.to_string() })?;
    let xml = String::from_utf8(xml_bytes).map_err(|_| XlinkError::Utf8)?;

    // 2. Patch
    let (patched, count) = patch_xlink_attrs(&xml, replacements);
    drop(zip);

    // 3. Rebuild ZIP with patched XML
    rebuild_zip_with_xml(fcstd_path, &patched)?;
    Ok(count)
}

fn rebuild_zip_with_xml(fcstd_path: &Path, new_xml: &str) -> Result<(), XlinkError> {
    let tmp = fcstd_path.with_extension(".fcstd.tmp");
    let in_file = std::fs::File::open(fcstd_path).map_err(|e| XlinkError::Io { path: fcstd_path.to_path_buf(), msg: e.to_string() })?;
    let mut in_zip = zip::ZipArchive::new(in_file).map_err(|e| XlinkError::Zip { path: fcstd_path.to_path_buf(), msg: e.to_string() })?;
    let out_file = std::fs::File::create(&tmp).map_err(|e| XlinkError::Io { path: tmp.clone(), msg: e.to_string() })?;
    let mut out_zip = zip::ZipWriter::new(out_file);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for i in 0..in_zip.len() {
        let entry = in_zip.by_index(i).map_err(|e| XlinkError::Zip { path: fcstd_path.to_path_buf(), msg: e.to_string() })?;
        let name = entry.name().to_string();
        if name == "Document.xml" {
            out_zip.start_file(name, opts).map_err(|e| XlinkError::Zip { path: tmp.clone(), msg: e.to_string() })?;
            out_zip.write_all(new_xml.as_bytes()).map_err(|e| XlinkError::Io { path: tmp.clone(), msg: e.to_string() })?;
        } else {
            out_zip.raw_copy_file(entry).map_err(|e| XlinkError::Zip { path: tmp.clone(), msg: e.to_string() })?;
        }
    }
    out_zip.finish().map_err(|e| XlinkError::Zip { path: tmp.clone(), msg: e.to_string() })?;
    std::fs::rename(&tmp, fcstd_path).map_err(|e| XlinkError::Io { path: tmp, msg: e.to_string() })?;
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct XlinkHit {
    pub file: String,
    pub label: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_replace_basename() {
        let r = replace_basename_in_xlink_attr("sub/old.FCStd", "old.FCStd", "new.FCStd").unwrap();
        assert_eq!(r, "sub/new.FCStd");
        assert!(replace_basename_in_xlink_attr("other.FCStd", "old.FCStd", "new.FCStd").is_none());
    }

    #[test]
    fn test_scan_hits() {
        let xml = r#"<XLink file="part.FCStd" label="Part1"/><XLink file="other.fcstd"/>"#;
        let hits = scan_xlink_hits(xml, "part.FCStd");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].label.as_deref(), Some("Part1"));
    }

    #[test]
    fn test_patch_attrs() {
        let xml = r#"<XLink file="old.FCStd"/><XLink file="keep.FCStd"/>"#;
        let mut m = std::collections::HashMap::new();
        m.insert("old.FCStd".into(), "new.FCStd".into());
        let (patched, count) = patch_xlink_attrs(xml, &m);
        assert_eq!(count, 1);
        assert!(patched.contains("new.FCStd"));
        assert!(patched.contains("keep.FCStd"));
    }

    #[test]
    fn test_read_labels() {
        let xml = r#"<XLink file="a.FCStd" label="Part1"/><XLink file="b.FCStd" label=""/>"#;
        let labels = read_reference_labels(xml);
        assert_eq!(labels.len(), 2);
        assert_eq!(labels[0].1, "Part1");
    }
}
