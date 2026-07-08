use serde::{Deserialize, Serialize};

/// Parsed FCStd document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FcstdDocument {
    pub objects: Vec<FcstdObject>,
    pub xlinks: Vec<XLinkRef>,
    pub root_names: Vec<String>,
}

/// A single object (Body, Part, LinkGroup, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FcstdObject {
    pub name: String,
    pub label: String,
    #[serde(rename = "typeId")]
    pub type_id: String,
    pub children: Vec<String>,
    pub properties: std::collections::HashMap<String, PropertyValue>,
    pub material: Option<String>,
    pub placement: Option<Placement>,
    #[serde(rename = "isValidBomItem")]
    pub is_valid_bom_item: bool,
    #[serde(default)]
    pub level: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PropertyValue {
    String(String),
    Float(f64),
    Integer(i64),
}

impl std::fmt::Display for PropertyValue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::String(s) => write!(f, "{s}"),
            Self::Float(v) => write!(f, "{v}"),
            Self::Integer(v) => write!(f, "{v}"),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Placement {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub q0: f64,
    pub q1: f64,
    pub q2: f64,
    pub q3: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XLinkRef {
    pub file: String,
    pub label: Option<String>,
}

impl FcstdObject {
    pub fn bom_type(&self) -> &'static str {
        if self.children.is_empty()
            && !self.type_id.contains("Assembly")
            && !self.type_id.contains("Part")
            && !self.type_id.contains("LinkGroup")
        {
            "Part"
        } else if self.type_id.contains("Body") {
            "Part"
        } else {
            "Assembly"
        }
    }

    pub fn is_valid(type_id: &str) -> bool {
        type_id == "PartDesign::Body"
            || type_id == "App::Part"
            || type_id == "App::LinkGroup"
            || type_id.contains("Part::")
            || type_id.contains("Assembly")
    }
}
