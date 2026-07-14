//! cad-rust: FCStd file reader.
//!
//! Reads FreeCAD FCStd files (ZIP archives) and extracts BOM-relevant data
//! from Document.xml: objects, hierarchy, properties, XLink references.
//!
//! # Example
//! ```rust,no_run
//! use fcstd_reader::read_fcstd;
//! let doc = read_fcstd(std::path::Path::new("assembly.FCStd")).unwrap();
//! println!("{} objects, {} xlinks", doc.objects.len(), doc.xlinks.len());
//! ```

pub mod error;
pub mod types;
pub mod write;
pub mod xml;

pub use error::FcstdError;
pub use types::*;

use std::io::Read;
use std::path::Path;

/// Read and parse an FCStd file.
pub fn read_fcstd(path: &Path) -> Result<FcstdDocument, FcstdError> {
    let file = std::fs::File::open(path).map_err(|e| FcstdError::Io {
        path: path.to_path_buf(),
        source: e,
    })?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| FcstdError::Zip {
        path: path.to_path_buf(),
        msg: e.to_string(),
    })?;
    let doc_xml = read_document_xml(&mut zip, path)?;
    xml::parse_document_xml(&doc_xml)
}

/// Read from in-memory bytes.
pub fn read_fcstd_from_bytes(data: &[u8]) -> Result<FcstdDocument, FcstdError> {
    let cursor = std::io::Cursor::new(data);
    let mut zip = zip::ZipArchive::new(cursor).map_err(|e| FcstdError::Zip {
        path: Path::new("<memory>").to_path_buf(),
        msg: e.to_string(),
    })?;
    let doc_xml = read_document_xml(&mut zip, Path::new("<memory>"))?;
    xml::parse_document_xml(&doc_xml)
}

/// Check if FCStd is a drawing-primary document (TechDraw, no Body/Part/Assembly).
/// Corresponds to Python: is_drawing_primary_document()
pub fn is_drawing_primary(path: &Path) -> Result<bool, FcstdError> {
    let doc = read_fcstd(path)?;
    let has_techdraw = doc
        .objects
        .iter()
        .any(|o| o.type_id.starts_with("TechDraw::"));
    let has_bom_mount = doc
        .objects
        .iter()
        .any(|o| FcstdObject::is_valid(&o.type_id) && o.type_id != "App::Link");
    Ok(has_techdraw && !has_bom_mount)
}

#[cfg(test)]
mod drawing_tests {
    #[test]
    fn test_is_drawing_primary_part() {
        // A PartDesign::Body → not drawing
        let xml = r#"<?xml version="1.0"?><Document><Objects><Object type="PartDesign::Body" name="Box"/></Objects><ObjectData><Object name="Box"><Properties><Property name="Label" type="App::PropertyString"><String value="Box"/></Property></Properties></Object></ObjectData></Document>"#;
        let doc = crate::xml::parse_document_xml(xml).unwrap();
        let has_td = doc
            .objects
            .iter()
            .any(|o| o.type_id.starts_with("TechDraw::"));
        let has_bm = doc
            .objects
            .iter()
            .any(|o| crate::types::FcstdObject::is_valid(&o.type_id) && o.type_id != "App::Link");
        assert!(!has_td);
        assert!(has_bm);
        assert!(!(has_td && !has_bm));
    }

    #[test]
    fn test_is_drawing_primary_techdraw() {
        let xml = r#"<?xml version="1.0"?><Document><Objects><Object type="TechDraw::DrawPage" name="Page"/><Object type="App::Link" name="Link"/></Objects><ObjectData><Object name="Page"><Properties><Property name="Label" type="App::PropertyString"><String value="Page"/></Property></Properties></Object><Object name="Link"><Properties><Property name="Label" type="App::PropertyString"><String value="Link"/></Property></Properties></Object></ObjectData></Document>"#;
        let doc = crate::xml::parse_document_xml(xml).unwrap();
        let has_td = doc
            .objects
            .iter()
            .any(|o| o.type_id.starts_with("TechDraw::"));
        let has_bm = doc
            .objects
            .iter()
            .any(|o| crate::types::FcstdObject::is_valid(&o.type_id) && o.type_id != "App::Link");
        assert!(has_td);
        assert!(!has_bm);
        assert!(has_td && !has_bm);
    }
}

fn read_document_xml<R: std::io::Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
    path: &Path,
) -> Result<String, FcstdError> {
    let mut entry = zip
        .by_name("Document.xml")
        .map_err(|_| FcstdError::MissingDocumentXml)?;
    let mut xml = String::new();
    entry.read_to_string(&mut xml).map_err(|e| FcstdError::Io {
        path: path.to_path_buf(),
        source: e,
    })?;
    Ok(xml)
}
