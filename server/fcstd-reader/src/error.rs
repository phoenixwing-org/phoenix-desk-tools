use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum FcstdError {
    #[error("I/O error reading {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("Invalid ZIP {path}: {msg}")]
    Zip { path: PathBuf, msg: String },

    #[error("Document.xml not found in FCStd archive")]
    MissingDocumentXml,

    #[error("XML parse error: {msg}")]
    Xml { msg: String },
}

impl serde::Serialize for FcstdError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
