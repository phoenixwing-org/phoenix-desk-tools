/** Read-only view of Wing's native v1 document; the server owns parsing and contract validation. */
export type CadObjectPlacement = { x: number; y: number; z: number; q0: number; q1: number; q2: number; q3: number };
export type CadDocumentObject = {
  name: string;
  label: string;
  type_id: string;
  children: string[];
  properties: Record<string, string | number>;
  material: string | null;
  placement: CadObjectPlacement | null;
  is_valid_bom_item: boolean;
  level: number;
};
export type CadObjectInfoResult = {
  document: { objects: CadDocumentObject[]; xlinks: Array<{ file: string; label: string | null }>; root_names: string[] };
  /** Original extracted UTF-8 XML size, including BOM; independent of ZIP file size. */
  source: { file_size: number; mtime_ms: number; document_xml_bytes: number };
  warnings: string[];
};

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");
const placement = (value: unknown) => value === null || (record(value) && ["x", "y", "z", "q0", "q1", "q2", "q3"].every(key => finite(value[key])));
export function isCadObjectInfoResult(value: unknown): value is CadObjectInfoResult {
  if (!record(value) || !record(value.source) || !finite(value.source.file_size) || value.source.file_size < 0
      || !finite(value.source.document_xml_bytes) || !Number.isSafeInteger(value.source.document_xml_bytes) || value.source.document_xml_bytes < 0
      || !finite(value.source.mtime_ms) || Math.abs(value.source.mtime_ms) > 8.64e15 || !strings(value.warnings) || !record(value.document)) return false;
  const doc = value.document;
  return strings(doc.root_names) && Array.isArray(doc.xlinks)
    && doc.xlinks.every(link => record(link) && typeof link.file === "string" && (typeof link.label === "string" || link.label === null))
    && Array.isArray(doc.objects) && doc.objects.every(object => record(object)
      && typeof object.name === "string" && typeof object.label === "string" && typeof object.type_id === "string"
      && strings(object.children) && record(object.properties)
      && Object.values(object.properties).every(property => typeof property === "string" || finite(property))
      && (typeof object.material === "string" || object.material === null)
      && placement(object.placement)
      && typeof object.is_valid_bom_item === "boolean" && finite(object.level) && Number.isInteger(object.level) && object.level >= 0);
}
