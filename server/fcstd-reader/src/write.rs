//! BOM property write-back to FCStd Document.xml.
//! Mirrors Python: phoenix/freecad/fcstd_document_bom_props.py

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;

use crate::error::FcstdError;
use crate::xml;

/// BOM properties to write: key → value (PartNumber, PartVersion, PartName, Label, etc.)
pub type BomValues = HashMap<String, String>;

/// Write BOM properties into an FCStd file.
/// Returns true if the file was modified, false if no mount object was found.
pub fn write_bom_props(fcstd_path: &Path, values: &BomValues) -> Result<bool, FcstdError> {
    // 1. Read the ZIP
    let file = std::fs::File::open(fcstd_path).map_err(|e| FcstdError::Io { path: fcstd_path.to_path_buf(), source: e })?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| FcstdError::Zip { path: fcstd_path.to_path_buf(), msg: e.to_string() })?;

    let doc_xml_idx = (0..zip.len()).find(|&i| {
        zip.by_index(i).map(|e| e.name() == "Document.xml").unwrap_or(false)
    });

    let doc_xml_idx = match doc_xml_idx {
        Some(i) => i,
        None => return Err(FcstdError::MissingDocumentXml),
    };

    let mut xml_bytes = Vec::new();
    zip.by_index(doc_xml_idx).map_err(|e| FcstdError::Zip { path: fcstd_path.to_path_buf(), msg: e.to_string() })?
        .read_to_end(&mut xml_bytes).map_err(|e| FcstdError::Io { path: fcstd_path.to_path_buf(), source: e })?;

    let xml_str = String::from_utf8(xml_bytes).map_err(|_| FcstdError::Xml { msg: "Document.xml is not valid UTF-8".into() })?;

    // 2. Find mount object
    let mount_name = match find_mount_object(&xml_str) {
        Some(n) => n,
        None => return Ok(false), // no suitable mount object
    };

    // 3. Patch XML
    let patched = patch_object_properties(&xml_str, &mount_name, values)?;

    // 4. Write back to ZIP (rebuild)
    drop(zip);
    rebuild_zip_with_patched_xml(fcstd_path, &patched)?;

    Ok(true)
}

/// Priority-ordered mount candidates: body > assembly > part > link
const MOUNT_PRIORITY: &[&str] = &[
    "PartDesign::Body",
    "App::Part",
    "App::LinkGroup",
];

fn find_mount_object(xml: &str) -> Option<String> {
    let type_map = xml::parse_objects_type_map(xml);
    let children = xml::collect_group_children(xml);

    // Priority scan: find first root-level object matching mount types
    for &priority_type in MOUNT_PRIORITY {
        for (name, type_id) in &type_map {
            if type_id == priority_type && !children.contains(name) {
                return Some(name.clone());
            }
            if type_id.contains("Assembly") && !children.contains(name) && priority_type == "App::Part" {
                return Some(name.clone());
            }
        }
    }

    // Fallback: any valid BOM item that's a root
    for (name, type_id) in &type_map {
        if crate::types::FcstdObject::is_valid(type_id) && !children.contains(name) {
            return Some(name.clone());
        }
    }

    None
}

/// Replace/add property values under a specific object in Document.xml.
fn patch_object_properties(xml: &str, object_name: &str, values: &BomValues) -> Result<String, FcstdError> {
    // Simple XML patching: find <Object name="NAME">...</Object> block,
    // find or create <Properties> section, replace/add <Property> elements.
    use regex::Regex;

    let mut result = String::with_capacity(xml.len() + 1024);

    // Find the object section
    let obj_start = format!("<Object name=\"{}\"", object_name);
    let obj_re = Regex::new(&regex::escape(&obj_start)).map_err(|e| FcstdError::Xml { msg: e.to_string() })?;

    if let Some(cap) = obj_re.find(xml) {
        let start = cap.start();
        result.push_str(&xml[..start]);

        // Find </Object> closing tag
        let remainder = &xml[start..];
        let end_re = Regex::new(r"</Object>").unwrap();
        if let Some(end_cap) = end_re.find(remainder) {
            let obj_body = &remainder[..end_cap.start()];
            let after = &remainder[end_cap.end()..];

            // Patch: remove existing Property elements for our keys, then add new ones
            let patched_body = patch_properties_block(obj_body, values);
            result.push_str(&obj_start);
            result.push_str(&patched_body);
            result.push_str("</Object>");
            result.push_str(after);
        } else {
            // No closing tag found — append unchanged
            result.push_str(remainder);
        }
    } else {
        // Object not found — return original
        result.push_str(xml);
    }

    Ok(result)
}

fn patch_properties_block(obj_body: &str, values: &BomValues) -> String {
    use regex::Regex;

    let mut body = obj_body.to_string();

    for (key, val) in values {
        // Try to replace existing property
        let prop_re = Regex::new(&format!(
            r#"<Property name="{}"[^>]*>.*?</Property>"#,
            regex::escape(key)
        )).unwrap();

        let replacement = format!(
            r#"<Property name="{}" type="App::PropertyString"><String value="{}"/></Property>"#,
            key, escape_xml(val)
        );

        if prop_re.is_match(&body) {
            body = prop_re.replace(&body, replacement.as_str()).to_string();
        } else {
            // Add new property before </Properties> or at end of body
            if let Some(props_end) = body.find("</Properties>") {
                body.insert_str(props_end, &format!("\n        {}", replacement));
            } else {
                // No Properties section — create one
                body.push_str(&format!(
                    "\n      <Properties>\n        {}\n      </Properties>",
                    replacement
                ));
            }
        }
    }

    body
}

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace("\"", "&quot;")
}

/// Rebuild the ZIP with the patched Document.xml.
fn rebuild_zip_with_patched_xml(fcstd_path: &Path, new_xml: &str) -> Result<(), FcstdError> {
    let tmp_path = fcstd_path.with_extension(".fcstd.tmp");

    {
        let in_file = std::fs::File::open(fcstd_path).map_err(|e| FcstdError::Io { path: fcstd_path.to_path_buf(), source: e })?;
        let mut in_zip = zip::ZipArchive::new(in_file).map_err(|e| FcstdError::Zip { path: fcstd_path.to_path_buf(), msg: e.to_string() })?;

        let out_file = std::fs::File::create(&tmp_path).map_err(|e| FcstdError::Io { path: tmp_path.clone(), source: e })?;
        let mut out_zip = zip::ZipWriter::new(out_file);

        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        for i in 0..in_zip.len() {
            let entry = in_zip.by_index(i).map_err(|e| FcstdError::Zip { path: fcstd_path.to_path_buf(), msg: e.to_string() })?;
            let name = entry.name().to_string();

            if name == "Document.xml" {
                out_zip.start_file(name, options).map_err(|e| FcstdError::Zip { path: tmp_path.clone(), msg: e.to_string() })?;
                out_zip.write_all(new_xml.as_bytes()).map_err(|e| FcstdError::Io { path: tmp_path.clone(), source: e })?;
            } else {
                out_zip.raw_copy_file(entry).map_err(|e| FcstdError::Zip { path: tmp_path.clone(), msg: e.to_string() })?;
            }
        }

        out_zip.finish().map_err(|e| FcstdError::Zip { path: tmp_path.clone(), msg: e.to_string() })?;
    }

    // Atomic replace
    std::fs::rename(&tmp_path, fcstd_path).map_err(|e| FcstdError::Io { path: tmp_path, source: e })?;

    Ok(())
}
