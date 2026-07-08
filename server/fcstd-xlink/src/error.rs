use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum XlinkError {
    #[error("I/O error {path}: {msg}")]
    Io { path: PathBuf, msg: String },

    #[error("ZIP error {path}: {msg}")]
    Zip { path: PathBuf, msg: String },

    #[error("Document.xml not found")]
    MissingXml,

    #[error("Invalid UTF-8 in Document.xml")]
    Utf8,
}
