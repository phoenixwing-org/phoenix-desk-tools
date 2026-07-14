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
    let file = std::fs::File::open(fcstd_path).map_err(|e| FcstdError::Io {
        path: fcstd_path.to_path_buf(),
        source: e,
    })?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| FcstdError::Zip {
        path: fcstd_path.to_path_buf(),
        msg: e.to_string(),
    })?;

    let doc_xml_idx = (0..zip.len()).find(|&i| {
        zip.by_index(i)
            .map(|e| e.name() == "Document.xml")
            .unwrap_or(false)
    });

    let doc_xml_idx = match doc_xml_idx {
        Some(i) => i,
        None => return Err(FcstdError::MissingDocumentXml),
    };

    let mut xml_bytes = Vec::new();
    zip.by_index(doc_xml_idx)
        .map_err(|e| FcstdError::Zip {
            path: fcstd_path.to_path_buf(),
            msg: e.to_string(),
        })?
        .read_to_end(&mut xml_bytes)
        .map_err(|e| FcstdError::Io {
            path: fcstd_path.to_path_buf(),
            source: e,
        })?;

    let xml_str = String::from_utf8(xml_bytes).map_err(|_| FcstdError::Xml {
        msg: "Document.xml is not valid UTF-8".into(),
    })?;

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
const MOUNT_PRIORITY: &[&str] = &["PartDesign::Body", "App::Part", "App::LinkGroup"];

fn find_mount_object(xml: &str) -> Option<String> {
    let document = xml::parse_document_xml(xml).ok()?;

    // Reuse the reader's old/new FreeCAD format handling and only select roots.
    for &priority_type in MOUNT_PRIORITY {
        for object in &document.objects {
            if !document.root_names.contains(&object.name) {
                continue;
            }
            if object.type_id == priority_type {
                return Some(object.name.clone());
            }
            if object.type_id.contains("Assembly") && priority_type == "App::Part" {
                return Some(object.name.clone());
            }
        }
    }

    // Fallback: any valid BOM item that's a root
    document
        .objects
        .iter()
        .find(|object| object.is_valid_bom_item && document.root_names.contains(&object.name))
        .map(|object| object.name.clone())
}

/// Replace/add property values under a specific object in Document.xml.
fn patch_object_properties(
    xml: &str,
    object_name: &str,
    values: &BomValues,
) -> Result<String, FcstdError> {
    // Simple XML patching: find <Object name="NAME">...</Object> block,
    // find or create <Properties> section, replace/add <Property> elements.
    use regex::Regex;

    let mut result = String::with_capacity(xml.len() + 1024);

    // Find the object section
    let obj_start = format!("<Object name=\"{}\"", object_name);
    let obj_re = Regex::new(&regex::escape(&obj_start))
        .map_err(|e| FcstdError::Xml { msg: e.to_string() })?;

    if let Some(cap) = obj_re.find(xml) {
        let start = cap.start();
        result.push_str(&xml[..start]);

        // Preserve the complete opening tag and patch only its inner XML.
        let remainder = &xml[start..];
        let opening_end = remainder.find('>').ok_or_else(|| FcstdError::Xml {
            msg: format!("Object opening tag is incomplete: {object_name}"),
        })?;
        let end_re = Regex::new(r"</Object>").unwrap();
        if let Some(end_cap) = end_re.find(remainder) {
            let opening = &remainder[..=opening_end];
            let obj_body = &remainder[opening_end + 1..end_cap.start()];
            let after = &remainder[end_cap.end()..];

            // Patch: replace existing Property elements or add missing keys.
            let patched_body = patch_properties_block(obj_body, values);
            result.push_str(opening);
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
            r#"(?s)<Property name="{}"[^>]*>.*?</Property>"#,
            regex::escape(key)
        ))
        .unwrap();

        let replacement = format!(
            r#"<Property name="{}" type="App::PropertyString"><String value="{}"/></Property>"#,
            key,
            escape_xml(val)
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
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace("\"", "&quot;")
}

/// Rebuild the ZIP with the patched Document.xml.
fn rebuild_zip_with_patched_xml(fcstd_path: &Path, new_xml: &str) -> Result<(), FcstdError> {
    let token = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let filename = fcstd_path.file_name().unwrap_or_default().to_string_lossy();
    let tmp_path = fcstd_path.with_file_name(format!(".{filename}.phoenix-{token}.tmp"));
    let backup_path = fcstd_path.with_file_name(format!(".{filename}.phoenix-{token}.backup"));

    {
        let in_file = std::fs::File::open(fcstd_path).map_err(|e| FcstdError::Io {
            path: fcstd_path.to_path_buf(),
            source: e,
        })?;
        let mut in_zip = zip::ZipArchive::new(in_file).map_err(|e| FcstdError::Zip {
            path: fcstd_path.to_path_buf(),
            msg: e.to_string(),
        })?;

        let out_file = std::fs::File::create(&tmp_path).map_err(|e| FcstdError::Io {
            path: tmp_path.clone(),
            source: e,
        })?;
        let mut out_zip = zip::ZipWriter::new(out_file);

        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        for i in 0..in_zip.len() {
            let entry = in_zip.by_index(i).map_err(|e| FcstdError::Zip {
                path: fcstd_path.to_path_buf(),
                msg: e.to_string(),
            })?;
            let name = entry.name().to_string();

            if name == "Document.xml" {
                out_zip
                    .start_file(name, options)
                    .map_err(|e| FcstdError::Zip {
                        path: tmp_path.clone(),
                        msg: e.to_string(),
                    })?;
                out_zip
                    .write_all(new_xml.as_bytes())
                    .map_err(|e| FcstdError::Io {
                        path: tmp_path.clone(),
                        source: e,
                    })?;
            } else {
                out_zip.raw_copy_file(entry).map_err(|e| FcstdError::Zip {
                    path: tmp_path.clone(),
                    msg: e.to_string(),
                })?;
            }
        }

        out_zip.finish().map_err(|e| FcstdError::Zip {
            path: tmp_path.clone(),
            msg: e.to_string(),
        })?;
    }

    // Windows cannot rename a temporary file over an existing FCStd. Move the
    // original aside first and restore it if installing the replacement fails.
    if let Err(source) = std::fs::rename(fcstd_path, &backup_path) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(FcstdError::Io {
            path: fcstd_path.to_path_buf(),
            source,
        });
    }
    if let Err(source) = std::fs::rename(&tmp_path, fcstd_path) {
        let _ = std::fs::rename(&backup_path, fcstd_path);
        let _ = std::fs::remove_file(&tmp_path);
        return Err(FcstdError::Io {
            path: tmp_path,
            source,
        });
    }
    let _ = std::fs::remove_file(&backup_path);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn writes_bom_properties_to_a_real_archive_without_corrupting_xml() {
        let token = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let filename = std::env::temp_dir().join(format!("fcstd-reader-write-{token}.FCStd"));
        let xml = r#"<?xml version="1.0"?><Document><ObjectData>
<Object name="Body" type="PartDesign::Body"><Properties>
<Property name="Label" type="App::PropertyString">
  <String value="Old"/>
</Property>
</Properties></Object></ObjectData></Document>"#;

        {
            let file = std::fs::File::create(&filename).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file("Document.xml", options).unwrap();
            zip.write_all(xml.as_bytes()).unwrap();
            zip.start_file("GuiDocument.xml", options).unwrap();
            zip.write_all(b"keep me").unwrap();
            zip.finish().unwrap();
        }

        let values = HashMap::from([
            ("Label".to_string(), "New & Label".to_string()),
            ("PartNumber".to_string(), "100001".to_string()),
        ]);
        assert!(write_bom_props(&filename, &values).unwrap());

        let file = std::fs::File::open(&filename).unwrap();
        let mut zip = zip::ZipArchive::new(file).unwrap();
        let mut patched = String::new();
        zip.by_name("Document.xml")
            .unwrap()
            .read_to_string(&mut patched)
            .unwrap();
        assert_eq!(patched.matches("<Object name=\"Body\"").count(), 1);
        assert!(patched.contains("type=\"PartDesign::Body\""));
        assert!(patched.contains("value=\"New &amp; Label\""));
        assert!(patched.contains("name=\"PartNumber\""));
        let mut gui = String::new();
        zip.by_name("GuiDocument.xml")
            .unwrap()
            .read_to_string(&mut gui)
            .unwrap();
        assert_eq!(gui, "keep me");
        drop(zip);
        let _ = std::fs::remove_file(filename);
    }
}
