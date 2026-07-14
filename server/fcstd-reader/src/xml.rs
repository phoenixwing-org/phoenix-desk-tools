//! Document.xml parser — quick-xml streaming parser for FCStd files.

use std::collections::{HashMap, HashSet, VecDeque};

use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

use crate::error::FcstdError;
use crate::types::*;

/// Parse Document.xml string into structured data.
/// Supports both FreeCAD pre-1.x and 1.x XML formats.
pub fn parse_document_xml(xml: &str) -> Result<FcstdDocument, FcstdError> {
    // ── Pass 1: collect type info from <Objects><Object type="…" name="…"/> ──
    let type_map = parse_objects_type_map(xml);

    // ── Pass 2: collect properties from <ObjectData><Object name="…"> ──
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut objects: Vec<FcstdObject> = Vec::new();
    let mut xlinks: Vec<XLinkRef> = Vec::new();
    let mut children_of: HashMap<String, Vec<String>> = HashMap::new();
    let mut parent_of: HashMap<String, Vec<String>> = HashMap::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) if e.name().as_ref() == b"Object" => {
                if let Some(parsed) = parse_object(&mut reader, e, &type_map) {
                    for child in &parsed.object.children {
                        children_of
                            .entry(parsed.object.name.clone())
                            .or_default()
                            .push(child.clone());
                        parent_of
                            .entry(child.clone())
                            .or_default()
                            .push(parsed.object.name.clone());
                    }
                    xlinks.extend(parsed.xlinks);
                    objects.push(parsed.object);
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(FcstdError::Xml {
                    msg: format!("parse error at {}: {e}", reader.buffer_position()),
                })
            }
            _ => {}
        }
        buf.clear();
    }

    let root_names: Vec<String> = objects
        .iter()
        .filter(|o| {
            o.is_valid_bom_item && !parent_of.contains_key(&o.name) && o.type_id != "App::Link"
        })
        .map(|o| o.name.clone())
        .collect();

    assign_levels(&root_names, &children_of, &mut objects);

    Ok(FcstdDocument {
        objects,
        xlinks,
        root_names,
    })
}

/// Collect object names that are referenced by Group LinkLists (i.e., children of other objects).
pub fn collect_group_children(xml: &str) -> HashSet<String> {
    let mut children = HashSet::new();
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) if e.name().as_ref() == b"Property" => {
                let name = parse_attr(e, b"name").unwrap_or_default();
                if name == "Group" {
                    for link in parse_link_list(&mut reader) {
                        children.insert(link);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    children
}

/// Pass 1: build a name → type_id map from <Objects><Object type="…" name="…"/>
pub fn parse_objects_type_map(xml: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut in_objects = false;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) if e.name().as_ref() == b"Objects" => in_objects = true,
            Ok(Event::End(ref e)) if e.name().as_ref() == b"Objects" => break,
            Ok(Event::Empty(ref e)) if in_objects && e.name().as_ref() == b"Object" => {
                if let (Some(name), Some(typ)) = (parse_attr(e, b"name"), parse_attr(e, b"type")) {
                    map.insert(name, typ);
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    map
}

struct ParsedObject {
    object: FcstdObject,
    xlinks: Vec<XLinkRef>,
}

fn parse_object(
    reader: &mut Reader<&[u8]>,
    start: &BytesStart,
    type_map: &HashMap<String, String>,
) -> Option<ParsedObject> {
    let name = parse_attr(start, b"name")?;
    // type_id: first check direct attribute (old format), then type_map (1.x format)
    let type_id = parse_attr(start, b"type")
        .filter(|t| !t.is_empty())
        .or_else(|| type_map.get(&name).cloned())
        .unwrap_or_default();
    let mut buf = Vec::new();
    let mut label = name.clone();
    let mut children: Vec<String> = Vec::new();
    let mut properties: HashMap<String, PropertyValue> = HashMap::new();
    let mut material: Option<String> = None;
    let mut placement: Option<Placement> = None;
    let mut xlinks: Vec<XLinkRef> = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let ename = e.name();
                if ename.as_ref() == b"Property" {
                    let pn = parse_attr(e, b"name").unwrap_or_default();
                    let pt = parse_attr(e, b"type").unwrap_or_default();
                    match pn.as_str() {
                        "Label" => {
                            if let Some(v) = parse_string(reader) {
                                label = v;
                            }
                        }
                        "Group" => {
                            children = parse_link_list(reader);
                        }
                        "Placement" => {
                            placement = parse_placement(reader);
                        }
                        "Material" => {
                            if let Some(v) = parse_string(reader) {
                                material = Some(v);
                            }
                        }
                        _ => {
                            if let Some(v) = parse_any_value(reader, &pt) {
                                properties.insert(pn, v);
                            }
                        }
                    }
                }
            }
            Ok(Event::End(ref e)) if e.name().as_ref() == b"Object" => break,
            Ok(Event::Empty(ref e)) => {
                let ename = e.name();
                if ename.as_ref() == b"Property" {
                    let pn = parse_attr(e, b"name").unwrap_or_default();
                    if pn == "Group" {
                        if let Some(v) = parse_attr(e, b"value") {
                            children.push(v);
                        }
                    }
                } else if ename.as_ref() == b"XLink" {
                    if let Some(x) = parse_xlink(e) {
                        let lbl = x.label.clone().or_else(|| Some(label.clone()));
                        xlinks.push(XLinkRef {
                            file: x.file,
                            label: lbl,
                        });
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    let is_valid = FcstdObject::is_valid(&type_id);
    Some(ParsedObject {
        object: FcstdObject {
            name,
            label,
            type_id,
            children,
            properties,
            material,
            placement,
            is_valid_bom_item: is_valid,
            level: 0,
        },
        xlinks,
    })
}

fn parse_string(reader: &mut Reader<&[u8]>) -> Option<String> {
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Empty(ref e)) if e.name().as_ref() == b"String" => {
                return parse_attr(e, b"value")
            }
            Ok(Event::Start(ref e)) if e.name().as_ref() == b"String" => {
                let t = reader
                    .read_text(e.name().clone())
                    .ok()
                    .map(|t| t.to_string());
                return t.or_else(|| parse_attr(e, b"value"));
            }
            Ok(Event::End(ref e))
                if e.name().as_ref() == b"Property" || e.name().as_ref() == b"Properties" =>
            {
                return None
            }
            Ok(Event::Eof) => return None,
            Err(_) => return None,
            _ => {}
        }
        buf.clear();
    }
}

fn parse_placement(reader: &mut Reader<&[u8]>) -> Option<Placement> {
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Empty(ref e)) if e.name().as_ref() == b"PropertyPlacement" => {
                return Some(Placement {
                    x: parse_attr_f64(e, b"Px").unwrap_or(0.0),
                    y: parse_attr_f64(e, b"Py").unwrap_or(0.0),
                    z: parse_attr_f64(e, b"Pz").unwrap_or(0.0),
                    q0: parse_attr_f64(e, b"Q0").unwrap_or(0.0),
                    q1: parse_attr_f64(e, b"Q1").unwrap_or(0.0),
                    q2: parse_attr_f64(e, b"Q2").unwrap_or(0.0),
                    q3: parse_attr_f64(e, b"Q3").unwrap_or(1.0),
                });
            }
            Ok(Event::End(ref e)) if e.name().as_ref() == b"Property" => return None,
            Ok(Event::Eof) => return None,
            Err(_) => return None,
            _ => {}
        }
        buf.clear();
    }
}

fn parse_link_list(reader: &mut Reader<&[u8]>) -> Vec<String> {
    let mut links = Vec::new();
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Empty(ref e)) if e.name().as_ref() == b"Link" => {
                if let Some(n) = parse_attr(e, b"value").or_else(|| parse_attr(e, b"name")) {
                    links.push(n);
                }
            }
            Ok(Event::End(ref e))
                if e.name().as_ref() == b"Property" || e.name().as_ref() == b"Properties" =>
            {
                break
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    links
}

fn parse_any_value(reader: &mut Reader<&[u8]>, _pt: &str) -> Option<PropertyValue> {
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Empty(ref e)) => {
                let ename = e.name();
                match ename.as_ref() {
                    b"String" => {
                        if let Some(v) = parse_attr(e, b"value") {
                            return Some(PropertyValue::String(v));
                        }
                    }
                    b"Float" | b"PropertyLength" | b"PropertyDistance" | b"PropertyFloat" => {
                        if let Some(v) = parse_attr_f64(e, b"value") {
                            return Some(PropertyValue::Float(v));
                        }
                    }
                    b"Integer" | b"PropertyInteger" => {
                        if let Some(v) = parse_attr_i64(e, b"value") {
                            return Some(PropertyValue::Integer(v));
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(ref e))
                if e.name().as_ref() == b"Property" || e.name().as_ref() == b"Properties" =>
            {
                return None
            }
            Ok(Event::Eof) => return None,
            Err(_) => return None,
            _ => {}
        }
        buf.clear();
    }
}

fn parse_xlink(e: &BytesStart) -> Option<XLinkRef> {
    let file = parse_attr(e, b"file")?;
    let label = parse_attr(e, b"label");
    Some(XLinkRef { file, label })
}

// ── helpers ────────────────────────────────────────────────

fn parse_attr(e: &BytesStart, name: &[u8]) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| a.key.as_ref() == name)
        .and_then(|a| String::from_utf8(a.value.to_vec()).ok())
}
fn parse_attr_f64(e: &BytesStart, name: &[u8]) -> Option<f64> {
    parse_attr(e, name).and_then(|s| s.parse().ok())
}
fn parse_attr_i64(e: &BytesStart, name: &[u8]) -> Option<i64> {
    parse_attr(e, name).and_then(|s| s.parse().ok())
}

fn assign_levels(
    roots: &[String],
    children_of: &HashMap<String, Vec<String>>,
    objects: &mut [FcstdObject],
) {
    let mut idx: HashMap<String, usize> = HashMap::new();
    for (i, o) in objects.iter().enumerate() {
        idx.insert(o.name.clone(), i);
    }

    let mut q: VecDeque<(String, u32)> = VecDeque::new();
    for r in roots {
        q.push_back((r.clone(), 0));
    }
    let mut visited: HashSet<String> = HashSet::new();

    while let Some((name, level)) = q.pop_front() {
        if !visited.insert(name.clone()) {
            continue;
        }
        if let Some(&i) = idx.get(&name) {
            objects[i].level = level;
        }
        if let Some(kids) = children_of.get(&name) {
            for kid in kids {
                if !visited.contains(kid) {
                    q.push_back((kid.clone(), level + 1));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_part() {
        let xml = r#"<?xml version="1.0"?><Document><ObjectData>
<Object name="Box" type="PartDesign::Body"><Properties>
<Property name="Label" type="App::PropertyString"><String value="MyBox"/></Property>
<Property name="PartNumber" type="App::PropertyString"><String value="8000"/></Property>
<Property name="Placement" type="App::PropertyPlacement"><PropertyPlacement Px="10" Py="20" Pz="30" Q0="0" Q1="0" Q2="0" Q3="1"/></Property>
</Properties></Object></ObjectData></Document>"#;
        let doc = parse_document_xml(xml).unwrap();
        assert_eq!(doc.objects.len(), 1);
        assert_eq!(doc.objects[0].label, "MyBox");
        assert_eq!(doc.objects[0].placement.unwrap().x, 10.0);
        assert_eq!(doc.root_names.len(), 1);
    }

    #[test]
    fn parse_assembly() {
        let xml = r#"<?xml version="1.0"?><Document><ObjectData>
<Object name="Assy" type="App::Part"><Properties>
<Property name="Label" type="App::PropertyString"><String value="Main"/></Property>
<Property name="Group" type="App::PropertyLinkList"><Link value="Body1"/><Link value="Body2"/></Property>
</Properties></Object>
<Object name="Body1" type="PartDesign::Body"><Properties><Property name="Label" type="App::PropertyString"><String value="Left"/></Property></Properties></Object>
<Object name="Body2" type="PartDesign::Body"><Properties><Property name="Label" type="App::PropertyString"><String value="Right"/></Property></Properties></Object>
</ObjectData></Document>"#;
        let doc = parse_document_xml(xml).unwrap();
        assert_eq!(doc.objects.len(), 3);
        assert_eq!(doc.root_names, vec!["Assy"]);
        assert_eq!(doc.objects[0].level, 0);
        assert_eq!(
            doc.objects
                .iter()
                .find(|o| o.name == "Body1")
                .unwrap()
                .level,
            1
        );
    }

    #[test]
    fn parse_xlink() {
        let xml = r#"<?xml version="1.0"?><Document><ObjectData>
<Object name="Link" type="App::Link"><Properties><Property name="Label" type="App::PropertyString"><String value="SubInst"/></Property></Properties>
<XLink file="sub.FCStd"/></Object></ObjectData></Document>"#;
        let doc = parse_document_xml(xml).unwrap();
        assert_eq!(doc.xlinks.len(), 1);
        assert_eq!(doc.xlinks[0].file, "sub.FCStd");
    }

    #[test]
    fn parse_empty() {
        let doc = parse_document_xml(r#"<?xml version="1.0"?><Document></Document>"#).unwrap();
        assert!(doc.objects.is_empty());
    }
}
