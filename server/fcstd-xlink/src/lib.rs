//! fcstd-xlink: FreeCAD FCStd XLink attribute manipulation.
//! Rust port of Python rename_analysis/xlink.py core functions.

use regex::Regex;
use std::collections::{BTreeMap, HashMap};
use std::io::{Read, Write};
use std::path::Path;

pub mod error;
pub use error::XlinkError;

/// Replace old basename with new basename in an XLink file attribute.
/// `attr`: the original XLink `file` value (e.g. "old_part.FCStd")
/// Returns the modified attribute, or None if no change needed.
///
/// Corresponds to Python: replace_basename_in_xlink_attr()
pub fn replace_basename_in_xlink_attr(
    attr: &str,
    old_basename: &str,
    new_basename: &str,
) -> Option<String> {
    let s = attr.replace('\\', "/").trim().to_string();
    if !s.ends_with(old_basename) {
        return None;
    }
    let prefix = &s[..s.len() - old_basename.len()];
    Some(format!("{prefix}{new_basename}"))
}

/// Scan Document.xml for XLink elements referencing files matching target_basename.
/// Returns list of (xlink_attr_value, link_label).
///
/// Corresponds to Python: scan_document_xml_xlink_hits()
pub fn scan_xlink_hits(xml: &str, target_basename: &str) -> Vec<XlinkHit> {
    let file_re = Regex::new(&format!(
        r#"<XLink\s+file="([^"]*{}[^"]*)"(\s+label="([^"]*)")?"#,
        regex::escape(target_basename)
    ))
    .unwrap();
    file_re
        .captures_iter(xml)
        .map(|cap| XlinkHit {
            file: cap
                .get(1)
                .map(|m| m.as_str().to_string())
                .unwrap_or_default(),
            label: cap.get(3).map(|m| m.as_str().to_string()),
        })
        .collect()
}

/// Read reference labels by XLink file attribute from XML.
///
/// Corresponds to Python: read_reference_labels_by_xlink_attr()
pub fn read_reference_labels(xml: &str) -> Vec<(String, String)> {
    let re = Regex::new(r#"<XLink\s+file="([^"]+)"\s+label="([^"]*)"\s*/>"#).unwrap();
    re.captures_iter(xml)
        .filter_map(|cap| {
            let file = cap.get(1)?.as_str().to_string();
            let label = cap
                .get(2)
                .map(|m| m.as_str().to_string())
                .unwrap_or_default();
            Some((file, label))
        })
        .collect()
}

/// Apply XLink file attribute replacements in Document.xml.
/// `replacements`: {old_attr_value: new_attr_value}
/// Returns (patched_xml, count_of_replacements).
pub fn patch_xlink_attrs(xml: &str, replacements: &HashMap<String, String>) -> (String, usize) {
    let re = Regex::new(r#"(<XLink\s+file=")([^"]*)(")"#).unwrap();
    let mut count = 0;
    let result = re
        .replace_all(xml, |caps: &regex::Captures| {
            let old_val = caps.get(2).unwrap().as_str();
            if let Some(new_val) = replacements.get(old_val) {
                count += 1;
                format!("{}{}{}", &caps[1], escape_xml_attr(new_val), &caps[3])
            } else {
                caps.get(0).unwrap().as_str().to_string()
            }
        })
        .to_string();
    (result, count)
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct LabelChange {
    pub xlink_file_attr: String,
    pub old_label: String,
    pub new_label: String,
}

fn object_block_span(xml: &str, pos: usize) -> Option<(usize, usize)> {
    let object_data_start = xml.find("<ObjectData")?;
    if pos < object_data_start {
        return None;
    }
    let object_data_end = xml[object_data_start..]
        .find("</ObjectData>")
        .map(|offset| object_data_start + offset + "</ObjectData>".len())
        .unwrap_or(xml.len());
    let token_re = Regex::new(r#"<Object(?:\s[^>]*)?>|</Object>"#).unwrap();
    let mut stack: Vec<usize> = Vec::new();
    let mut best: Option<(usize, usize)> = None;
    for token in token_re.find_iter(&xml[object_data_start..object_data_end]) {
        let start = object_data_start + token.start();
        let end = object_data_start + token.end();
        if token.as_str().starts_with("</") {
            if let Some(open) = stack.pop() {
                if open <= pos && pos < end && best.is_none_or(|current| open > current.0) {
                    best = Some((open, end));
                }
            }
        } else {
            stack.push(start);
        }
    }
    best
}

fn escape_xml_attr(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn unescape_xml_attr(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

/// Patch the Label property of the ObjectData object containing each selected XLink.
pub fn patch_reference_labels(
    xml: &str,
    attr_labels: &HashMap<String, String>,
) -> (String, Vec<LabelChange>) {
    if attr_labels.is_empty() {
        return (xml.to_string(), Vec::new());
    }
    let xlink_re = Regex::new(r#"<XLink\s+file="([^"]*)""#).unwrap();
    let label_re = Regex::new(
        r#"(?s)(<Property\s+name="Label"\s+type="App::PropertyString"[^>]*>\s*<String\s+value=")([^"]*)(")"#,
    )
    .unwrap();
    let mut blocks: BTreeMap<(usize, usize), (String, String)> = BTreeMap::new();
    for captures in xlink_re.captures_iter(xml) {
        let whole = captures.get(0).unwrap();
        let attr = captures.get(1).map(|m| m.as_str()).unwrap_or_default();
        let Some(label) = attr_labels.get(attr) else {
            continue;
        };
        if let Some(span) = object_block_span(xml, whole.start()) {
            blocks.insert(span, (attr.to_string(), label.to_string()));
        }
    }

    let mut patched = xml.to_string();
    let mut changes = Vec::new();
    for ((start, end), (attr, label)) in blocks.into_iter().rev() {
        let block = &patched[start..end];
        let Some(captures) = label_re.captures(block) else {
            continue;
        };
        let old_match = captures.get(2).unwrap();
        let escaped = escape_xml_attr(&label);
        if old_match.as_str() == escaped {
            continue;
        }
        let old_label = unescape_xml_attr(old_match.as_str());
        patched.replace_range(start + old_match.start()..start + old_match.end(), &escaped);
        changes.push(LabelChange {
            xlink_file_attr: attr,
            old_label,
            new_label: label,
        });
    }
    changes.reverse();
    (patched, changes)
}

/// Open FCStd ZIP, apply XLink attribute replacements, write back.
/// Returns count of replacements made.
pub fn patch_fcstd_xlink_attrs(
    fcstd_path: &Path,
    replacements: &HashMap<String, String>,
) -> Result<usize, XlinkError> {
    // 1. Read ZIP
    let file = std::fs::File::open(fcstd_path).map_err(|e| XlinkError::Io {
        path: fcstd_path.to_path_buf(),
        msg: e.to_string(),
    })?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| XlinkError::Zip {
        path: fcstd_path.to_path_buf(),
        msg: e.to_string(),
    })?;

    let mut xml_bytes = Vec::new();
    zip.by_name("Document.xml")
        .map_err(|_| XlinkError::MissingXml)?
        .read_to_end(&mut xml_bytes)
        .map_err(|e| XlinkError::Io {
            path: fcstd_path.to_path_buf(),
            msg: e.to_string(),
        })?;
    let xml = String::from_utf8(xml_bytes).map_err(|_| XlinkError::Utf8)?;

    // 2. Patch
    let (patched, count) = patch_xlink_attrs(&xml, replacements);
    drop(zip);

    // 3. Rebuild ZIP with patched XML
    rebuild_zip_with_xml(fcstd_path, &patched)?;
    Ok(count)
}

/// Patch explicit reference labels inside an FCStd archive.
pub fn patch_fcstd_reference_labels(
    fcstd_path: &Path,
    attr_labels: &HashMap<String, String>,
) -> Result<Vec<LabelChange>, XlinkError> {
    let file = std::fs::File::open(fcstd_path).map_err(|e| XlinkError::Io {
        path: fcstd_path.to_path_buf(),
        msg: e.to_string(),
    })?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| XlinkError::Zip {
        path: fcstd_path.to_path_buf(),
        msg: e.to_string(),
    })?;
    let mut xml_bytes = Vec::new();
    zip.by_name("Document.xml")
        .map_err(|_| XlinkError::MissingXml)?
        .read_to_end(&mut xml_bytes)
        .map_err(|e| XlinkError::Io {
            path: fcstd_path.to_path_buf(),
            msg: e.to_string(),
        })?;
    let xml = String::from_utf8(xml_bytes).map_err(|_| XlinkError::Utf8)?;
    let (patched, changes) = patch_reference_labels(&xml, attr_labels);
    drop(zip);
    if !changes.is_empty() {
        rebuild_zip_with_xml(fcstd_path, &patched)?;
    }
    Ok(changes)
}

fn rebuild_zip_with_xml(fcstd_path: &Path, new_xml: &str) -> Result<(), XlinkError> {
    let token = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let filename = fcstd_path.file_name().unwrap_or_default().to_string_lossy();
    let tmp = fcstd_path.with_file_name(format!(".{filename}.phoenix-{token}.tmp"));
    let backup = fcstd_path.with_file_name(format!(".{filename}.phoenix-{token}.backup"));
    let in_file = std::fs::File::open(fcstd_path).map_err(|e| XlinkError::Io {
        path: fcstd_path.to_path_buf(),
        msg: e.to_string(),
    })?;
    let mut in_zip = zip::ZipArchive::new(in_file).map_err(|e| XlinkError::Zip {
        path: fcstd_path.to_path_buf(),
        msg: e.to_string(),
    })?;
    let out_file = std::fs::File::create(&tmp).map_err(|e| XlinkError::Io {
        path: tmp.clone(),
        msg: e.to_string(),
    })?;
    let mut out_zip = zip::ZipWriter::new(out_file);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    for i in 0..in_zip.len() {
        let entry = in_zip.by_index(i).map_err(|e| XlinkError::Zip {
            path: fcstd_path.to_path_buf(),
            msg: e.to_string(),
        })?;
        let name = entry.name().to_string();
        if name == "Document.xml" {
            out_zip
                .start_file(name, opts)
                .map_err(|e| XlinkError::Zip {
                    path: tmp.clone(),
                    msg: e.to_string(),
                })?;
            out_zip
                .write_all(new_xml.as_bytes())
                .map_err(|e| XlinkError::Io {
                    path: tmp.clone(),
                    msg: e.to_string(),
                })?;
        } else {
            out_zip.raw_copy_file(entry).map_err(|e| XlinkError::Zip {
                path: tmp.clone(),
                msg: e.to_string(),
            })?;
        }
    }
    out_zip.finish().map_err(|e| XlinkError::Zip {
        path: tmp.clone(),
        msg: e.to_string(),
    })?;
    drop(in_zip);

    if let Err(e) = std::fs::rename(fcstd_path, &backup) {
        let _ = std::fs::remove_file(&tmp);
        return Err(XlinkError::Io {
            path: fcstd_path.to_path_buf(),
            msg: e.to_string(),
        });
    }
    if let Err(e) = std::fs::rename(&tmp, fcstd_path) {
        let _ = std::fs::rename(&backup, fcstd_path);
        let _ = std::fs::remove_file(&tmp);
        return Err(XlinkError::Io {
            path: tmp,
            msg: e.to_string(),
        });
    }
    let _ = std::fs::remove_file(&backup);
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
        let xml = r#"<Other file="old.FCStd"/><XLink file="old.FCStd"/><XLink file="keep.FCStd"/>"#;
        let mut m = std::collections::HashMap::new();
        m.insert("old.FCStd".into(), "new.FCStd".into());
        let (patched, count) = patch_xlink_attrs(xml, &m);
        assert_eq!(count, 1);
        assert!(patched.contains(r#"<Other file="old.FCStd"/>"#));
        assert!(patched.contains("new.FCStd"));
        assert!(patched.contains("keep.FCStd"));
    }

    #[test]
    fn test_patch_reference_labels_targets_the_xlink_object_only() {
        let xml = r#"<Document><ObjectData>
<Object name="Link"><Properties><Property name="Label" type="App::PropertyString"><String value="Old"/></Property></Properties><XLink file="part.FCStd"/></Object>
<Object name="Other"><Properties><Property name="Label" type="App::PropertyString"><String value="Keep"/></Property></Properties><Other file="part.FCStd"/></Object>
</ObjectData></Document>"#;
        let labels = HashMap::from([("part.FCStd".to_string(), "A&B \"Part\"".to_string())]);
        let (patched, changes) = patch_reference_labels(xml, &labels);
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].old_label, "Old");
        assert_eq!(changes[0].new_label, "A&B \"Part\"");
        assert!(patched.contains(r#"value="A&amp;B &quot;Part&quot;""#));
        assert!(patched.contains(r#"value="Keep""#));
    }

    #[test]
    fn test_patch_reference_labels_uses_the_innermost_nested_object() {
        let xml = r#"<Document><ObjectData><Object name="Outer">
<Property name="Label" type="App::PropertyString"><String value="Outer"/></Property>
<Object name="Inner"><Property name="Label" type="App::PropertyString"><String value="Inner"/></Property><XLink file="part.FCStd"/></Object>
</Object></ObjectData></Document>"#;
        let labels = HashMap::from([("part.FCStd".to_string(), "Changed".to_string())]);
        let (patched, changes) = patch_reference_labels(xml, &labels);
        assert_eq!(changes.len(), 1);
        assert!(patched.contains(r#"value="Outer""#));
        assert!(patched.contains(r#"value="Changed""#));
    }

    #[test]
    fn test_patch_fcstd_replaces_original_zip() {
        let token = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("fcstd-xlink-{token}.FCStd"));
        let file = std::fs::File::create(&path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        writer.start_file("Document.xml", options).unwrap();
        writer
            .write_all(br#"<Other file="old.FCStd"/><XLink file="old.FCStd"/>"#)
            .unwrap();
        writer.finish().unwrap();

        let mut replacements = std::collections::HashMap::new();
        replacements.insert("old.FCStd".into(), "new.FCStd".into());
        assert_eq!(patch_fcstd_xlink_attrs(&path, &replacements).unwrap(), 1);

        let file = std::fs::File::open(&path).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let mut xml = String::new();
        archive
            .by_name("Document.xml")
            .unwrap()
            .read_to_string(&mut xml)
            .unwrap();
        assert!(xml.contains(r#"<Other file="old.FCStd"/>"#));
        assert!(xml.contains(r#"<XLink file="new.FCStd"/>"#));
        drop(archive);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn test_read_labels() {
        let xml = r#"<XLink file="a.FCStd" label="Part1"/><XLink file="b.FCStd" label=""/>"#;
        let labels = read_reference_labels(xml);
        assert_eq!(labels.len(), 2);
        assert_eq!(labels[0].1, "Part1");
    }
}
