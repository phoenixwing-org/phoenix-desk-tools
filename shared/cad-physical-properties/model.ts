/** Pure P0 model only: no CAD runtime, filesystem, database, or material defaults.
 * A valid DTO is not proof that a source hash or native measurement was verified.
 * Per-field/count bounds are not the future host's 256 KiB worker-result budget;
 * that host must independently measure and reject oversized serialized DTOs. */
export const CAD_PHYSICAL_SCHEMA_VERSION = 1 as const;
export const MASS_FORMULA = 'volume_mm3 * density_kg_m3 / 1e9' as const;
export const DENSITY_EQUIVALENCE_RELATIVE_TOLERANCE = 1e-12;

export type PhysicalReasonCode =
  | 'invalid_observation' | 'invalid_identity' | 'invalid_provenance'
  | 'geometry_node_mismatch' | 'invalid_shape' | 'open_shape' | 'not_single_solid'
  | 'missing_volume' | 'invalid_volume' | 'missing_density' | 'invalid_density'
  | 'unsupported_density_unit' | 'unresolved_native_material' | 'density_binding_mismatch'
  | 'unverified_saved_density' | 'density_conflict' | 'mass_not_representable'
  | 'invalid_saved_mass' | 'saved_mass_differs';

export type SourceDigest = { rel: string; sha256: string };
export type FinalEntityIdentity =
  | { kind: 'explicit_solid'; source_node: string; final_node: string }
  | { kind: 'body_tip'; source_node: string; final_node: string };
export interface PhysicalProvenance {
  source: SourceDigest;
  dependencies: SourceDigest[];
  algorithm_version: string;
  observed_at: string;
  /** Declared by a producer, never upgraded to verified by this pure model. */
  evidence_kind: 'synthetic' | 'mock_protocol' | 'native_report';
  freecad_version: string | null;
}
export interface SavedMaterialObservation {
  saved_text: string | null;
  native_binding: {
    property: string | null;
    uuid: string | null;
    state: 'not_present' | 'unresolved' | 'invalid' | 'resolved';
    card_sha256: string | null;
    card_version: string | null;
  };
}
/** `value` must be expressed in `unit`; raw_value is retained, not evaluated.
 * A native reader must not relabel FreeCAD Quantity.Value as kg/m^3. */
export type QuantityInput = { value: number; unit: string; raw_value: string };
export type DensityEvidenceSource =
  | { kind: 'native_material'; material_uuid: string; card_sha256: string }
  | { kind: 'explicit_override'; review_ref: string }
  | { kind: 'versioned_mapping'; mapping_version: string; mapping_sha256: string; entry_key: string }
  | { kind: 'saved_calculation'; property: string }
;
export type DensityEvidence = { id: string; quantity: QuantityInput } & DensityEvidenceSource;
export interface SinglePartPhysicalObservation {
  schema_version: 1;
  identity: FinalEntityIdentity;
  provenance: PhysicalProvenance;
  material: SavedMaterialObservation;
  /** Exactly one final node, not a sum of Body, Tip, BaseFeature and history. */
  geometry: {
    node: string;
    basis: 'saved_shape_no_recompute';
    valid: boolean;
    closed: boolean;
    solid_count: number;
    volume_mm3: number | null;
  };
  density_evidence: DensityEvidence[];
  saved_mass: (QuantityInput & { property: string }) | null;
}
export type DensityNormalization = { density_kg_m3: number | null; reason_codes: PhysicalReasonCode[] };
export type DensityAssessment = {
  id: string;
  kind: DensityEvidence['kind'];
  source: DensityEvidenceSource;
  quantity: { value: number | null; unit: string; raw_value: string };
  density_kg_m3: number | null;
  eligible: boolean;
  reason_codes: PhysicalReasonCode[];
};
export interface SinglePartPhysicalAssessment {
  schema_version: 1;
  validation_scope: 'pure_model';
  native_proof: 'not_checked';
  source_freshness: 'not_checked';
  status: 'computed' | 'needs_input' | 'manual';
  identity: FinalEntityIdentity | null;
  provenance: PhysicalProvenance | null;
  material: SavedMaterialObservation | null;
  volume_mm3: number | null;
  density_kg_m3: number | null;
  mass_kg: number | null;
  density_evidence: DensityAssessment[];
  density_conflict: boolean;
  saved_mass: {
    property: string;
    quantity: { value: number | null; unit: string; raw_value: string };
    mass_kg: number | null;
    comparison: 'invalid' | 'uncompared' | 'same' | 'different';
  } | null;
  formula: typeof MASS_FORMULA;
  reason_codes: PhysicalReasonCode[];
}

const DENSITY_FACTORS: Readonly<Record<string, number>> = Object.freeze({
  'kg/m^3': 1, 'kg/m3': 1,
  'g/cm^3': 1000, 'g/cm3': 1000,
  'kg/mm^3': 1e9, 'kg/mm3': 1e9,
});
const MASS_FACTORS: Readonly<Record<string, number>> = Object.freeze({ kg: 1, g: 1e-3, mg: 1e-6 });
const SHA = /^[a-f0-9]{64}$/;
const NODE = /^[A-Za-z_]\w{0,255}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function nonzeroUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value) && /[1-9a-f]/i.test(value);
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}
function text(value: unknown, max = 4096): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\p{Cs}\x00]/u.test(value);
}
function nullableText(value: unknown): boolean { return value === null || text(value); }
function relativeFcstd(value: unknown): value is string {
  return text(value) && /\.fcstd$/i.test(value) && !/[\\:\p{Cc}\p{Cf}]/u.test(value)
    && !value.startsWith('/') && value.split('/').every(piece => piece && piece !== '.' && piece !== '..' && piece.toLowerCase() !== '.git');
}
function sourceDigest(value: unknown): value is SourceDigest {
  return object(value) && keys(value, ['rel', 'sha256']) && relativeFcstd(value.rel)
    && typeof value.sha256 === 'string' && SHA.test(value.sha256);
}
function quantityShape(value: unknown): value is QuantityInput {
  return object(value) && keys(value, ['value', 'unit', 'raw_value']) && typeof value.value === 'number'
    && typeof value.unit === 'string' && value.unit.length <= 64 && text(value.raw_value);
}
function equivalent(left: number, right: number): boolean {
  return Math.abs(left - right) <= DENSITY_EQUIVALENCE_RELATIVE_TOLERANCE * Math.max(Math.abs(left), Math.abs(right));
}
function safeQuantity(quantity: QuantityInput) {
  return { value: Number.isFinite(quantity.value) ? quantity.value : null, unit: quantity.unit, raw_value: quantity.raw_value };
}

/** Whitelist conversion only; no unitless numbers, expressions, labels or guesses. */
export function normalizeDensityQuantity(value: unknown): DensityNormalization {
  try {
    if (!quantityShape(value) || !Number.isFinite(value.value) || value.value <= 0) return { density_kg_m3: null, reason_codes: ['invalid_density'] };
    if (!Object.hasOwn(DENSITY_FACTORS, value.unit)) return { density_kg_m3: null, reason_codes: ['unsupported_density_unit'] };
    const density = value.value * DENSITY_FACTORS[value.unit];
    return Number.isFinite(density) && density > 0
      ? { density_kg_m3: density, reason_codes: [] }
      : { density_kg_m3: null, reason_codes: ['invalid_density'] };
  } catch { return { density_kg_m3: null, reason_codes: ['invalid_density'] }; }
}

/** Auditable canonical calculation. Invalid/underflow/overflow never becomes 0. */
export function calculateMassKg(volume_mm3: number, density_kg_m3: number): { mass_kg: number | null; reason_codes: PhysicalReasonCode[] } {
  if (!Number.isFinite(volume_mm3) || volume_mm3 <= 0) return { mass_kg: null, reason_codes: ['invalid_volume'] };
  if (!Number.isFinite(density_kg_m3) || density_kg_m3 <= 0) return { mass_kg: null, reason_codes: ['invalid_density'] };
  // Scale the larger operand first: avoid intermediate overflow and premature
  // underflow of a small operand when the final result is still representable.
  const mass = volume_mm3 >= density_kg_m3
    ? (volume_mm3 / 1e9) * density_kg_m3
    : volume_mm3 * (density_kg_m3 / 1e9);
  return Number.isFinite(mass) && mass > 0
    ? { mass_kg: mass, reason_codes: [] }
    : { mass_kg: null, reason_codes: ['mass_not_representable'] };
}

function identityValid(value: unknown): value is FinalEntityIdentity {
  if (!object(value) || !keys(value, ['kind', 'source_node', 'final_node'])
    || typeof value.source_node !== 'string' || !NODE.test(value.source_node)
    || typeof value.final_node !== 'string' || !NODE.test(value.final_node)) return false;
  return value.kind === 'explicit_solid' ? value.source_node === value.final_node
    : value.kind === 'body_tip' && value.source_node !== value.final_node;
}
function provenanceValid(value: unknown): value is PhysicalProvenance {
  if (!object(value) || !keys(value, ['source', 'dependencies', 'algorithm_version', 'observed_at', 'evidence_kind', 'freecad_version'])
    || !sourceDigest(value.source) || !Array.isArray(value.dependencies) || value.dependencies.length > 500
    || !value.dependencies.every(sourceDigest) || !text(value.algorithm_version, 128)
    || typeof value.observed_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value.observed_at)
    || !Number.isFinite(Date.parse(value.observed_at)) || !['synthetic', 'mock_protocol', 'native_report'].includes(String(value.evidence_kind))
    || !nullableText(value.freecad_version) || (value.evidence_kind === 'native_report' && !text(value.freecad_version))) return false;
  const rels = [value.source.rel, ...value.dependencies.map(source => source.rel)];
  return new Set(rels).size === rels.length;
}
function materialValid(value: unknown): value is SavedMaterialObservation {
  const rawMaterial = object(value) && (value.saved_text === null || value.saved_text === '' || text(value.saved_text));
  if (!object(value) || !keys(value, ['saved_text', 'native_binding']) || !rawMaterial || !object(value.native_binding)) return false;
  const binding = value.native_binding;
  if (!keys(binding, ['property', 'uuid', 'state', 'card_sha256', 'card_version']) || !nullableText(binding.property)
    || !nullableText(binding.uuid) || !nullableText(binding.card_version)
    || !(binding.card_sha256 === null || (typeof binding.card_sha256 === 'string' && SHA.test(binding.card_sha256)))
    || !['not_present', 'unresolved', 'invalid', 'resolved'].includes(String(binding.state))) return false;
  if (binding.state === 'not_present') return binding.property === null && binding.uuid === null && binding.card_sha256 === null && binding.card_version === null;
  if (binding.state === 'resolved') return text(binding.property) && nonzeroUuid(binding.uuid) && typeof binding.card_sha256 === 'string';
  return text(binding.property) && binding.card_sha256 === null && binding.card_version === null;
}
function densityEvidenceValid(value: unknown): value is DensityEvidence {
  if (!object(value) || !text(value.id, 128) || !quantityShape(value.quantity)) return false;
  const base = ['id', 'kind', 'quantity'];
  if (value.kind === 'native_material') return keys(value, [...base, 'material_uuid', 'card_sha256'])
    && nonzeroUuid(value.material_uuid) && typeof value.card_sha256 === 'string' && SHA.test(value.card_sha256);
  if (value.kind === 'explicit_override') return keys(value, [...base, 'review_ref']) && text(value.review_ref);
  if (value.kind === 'versioned_mapping') return keys(value, [...base, 'mapping_version', 'mapping_sha256', 'entry_key'])
    && text(value.mapping_version) && typeof value.mapping_sha256 === 'string' && SHA.test(value.mapping_sha256) && text(value.entry_key);
  return value.kind === 'saved_calculation' && keys(value, [...base, 'property']) && text(value.property);
}
function emptyAssessment(): SinglePartPhysicalAssessment {
  return { schema_version: 1, validation_scope: 'pure_model', native_proof: 'not_checked', source_freshness: 'not_checked',
    status: 'manual', identity: null, provenance: null, material: null, volume_mm3: null, density_kg_m3: null, mass_kg: null,
    density_evidence: [], density_conflict: false, saved_mass: null, formula: MASS_FORMULA, reason_codes: [] };
}

/** Validate producer claims and derive a single-part value, without performing or
 * certifying a native observation. Conflicts deliberately have no auto-priority. */
export function evaluateSinglePartPhysicalProperties(value: unknown): SinglePartPhysicalAssessment {
  const output = emptyAssessment();
  const add = (...codes: PhysicalReasonCode[]) => { for (const code of codes) if (!output.reason_codes.includes(code)) output.reason_codes.push(code); };
  try {
    if (!object(value) || !keys(value, ['schema_version', 'identity', 'provenance', 'material', 'geometry', 'density_evidence', 'saved_mass']) || value.schema_version !== 1) {
      add('invalid_observation'); return output;
    }
    if (!identityValid(value.identity)) add('invalid_identity');
    else output.identity = { ...value.identity };
    if (!provenanceValid(value.provenance)) add('invalid_provenance');
    else output.provenance = { ...value.provenance, source: { ...value.provenance.source }, dependencies: value.provenance.dependencies.map(source => ({ ...source })) };
    if (!materialValid(value.material)) add('invalid_observation');
    else output.material = { saved_text: value.material.saved_text, native_binding: { ...value.material.native_binding } };
    const geometry = value.geometry;
    if (!object(geometry) || !keys(geometry, ['node', 'basis', 'valid', 'closed', 'solid_count', 'volume_mm3'])
      || typeof geometry.node !== 'string' || !NODE.test(geometry.node) || geometry.basis !== 'saved_shape_no_recompute'
      || typeof geometry.valid !== 'boolean' || typeof geometry.closed !== 'boolean'
      || !Number.isSafeInteger(geometry.solid_count) || (geometry.solid_count as number) < 0
      || !(geometry.volume_mm3 === null || typeof geometry.volume_mm3 === 'number')) add('invalid_observation');
    else {
      if (geometry.node !== output.identity?.final_node) add('geometry_node_mismatch');
      if (!geometry.valid) add('invalid_shape');
      if (!geometry.closed) add('open_shape');
      if (geometry.solid_count !== 1) add('not_single_solid');
      if (geometry.volume_mm3 === null) add('missing_volume');
      else if (!Number.isFinite(geometry.volume_mm3) || (geometry.volume_mm3 as number) <= 0) add('invalid_volume');
      else if (output.identity && geometry.node === output.identity.final_node && geometry.valid && geometry.closed && geometry.solid_count === 1) output.volume_mm3 = geometry.volume_mm3 as number;
    }
    if (!Array.isArray(value.density_evidence) || value.density_evidence.length > 16 || !value.density_evidence.every(densityEvidenceValid)
      || new Set(value.density_evidence.map(item => item.id)).size !== value.density_evidence.length) add('invalid_observation');
    else {
      for (const evidence of value.density_evidence as DensityEvidence[]) {
        const normalized = normalizeDensityQuantity(evidence.quantity), codes = [...normalized.reason_codes];
        let eligible = evidence.kind !== 'saved_calculation';
        if (evidence.kind === 'saved_calculation') codes.push('unverified_saved_density');
        if (evidence.kind === 'native_material') {
          const binding = output.material?.native_binding;
          if (binding?.state !== 'resolved') { eligible = false; codes.push('unresolved_native_material'); }
          else if (binding.uuid !== evidence.material_uuid || binding.card_sha256 !== evidence.card_sha256) { eligible = false; codes.push('density_binding_mismatch'); }
        }
        const { id: _id, quantity: _quantity, ...source } = evidence;
        output.density_evidence.push({ id: evidence.id, kind: evidence.kind, source, quantity: safeQuantity(evidence.quantity),
          density_kg_m3: normalized.density_kg_m3, eligible: eligible && normalized.density_kg_m3 !== null, reason_codes: codes });
        add(...codes);
      }
      if (output.material?.native_binding.state === 'unresolved' || output.material?.native_binding.state === 'invalid') add('unresolved_native_material');
      const values = output.density_evidence.filter(item => item.density_kg_m3 !== null);
      output.density_conflict = values.some(item => !equivalent(item.density_kg_m3!, values[0].density_kg_m3!));
      if (output.density_conflict) add('density_conflict');
      const eligible = output.density_evidence.filter(item => item.eligible);
      // A malformed claimed source must not silently disappear behind another.
      if (!output.density_conflict && eligible.length && !output.density_evidence.some(item => item.density_kg_m3 === null || item.reason_codes.includes('density_binding_mismatch') || item.reason_codes.includes('unresolved_native_material'))) output.density_kg_m3 = eligible[0].density_kg_m3;
      if (output.density_kg_m3 === null && !output.density_evidence.length) add('missing_density');
    }
    if (value.saved_mass !== null) {
      const saved = value.saved_mass;
      if (!object(saved) || !keys(saved, ['value', 'unit', 'raw_value', 'property']) || !text(saved.property)
        || !quantityShape({ value: saved.value, unit: saved.unit, raw_value: saved.raw_value })) add('invalid_observation');
      else {
        const quantity = { value: saved.value, unit: saved.unit, raw_value: saved.raw_value } as QuantityInput;
        const mass = Object.hasOwn(MASS_FACTORS, quantity.unit) ? quantity.value * MASS_FACTORS[quantity.unit] : Number.NaN;
        const valid = Number.isFinite(mass) && mass > 0;
        output.saved_mass = { property: saved.property, quantity: safeQuantity(quantity), mass_kg: valid ? mass : null, comparison: valid ? 'uncompared' : 'invalid' };
        if (!valid) add('invalid_saved_mass');
      }
    }
    const hardInvalid = output.reason_codes.some(code => ['invalid_observation', 'invalid_identity', 'invalid_provenance'].includes(code));
    if (!hardInvalid && output.volume_mm3 !== null && output.density_kg_m3 !== null) {
      const calculated = calculateMassKg(output.volume_mm3, output.density_kg_m3); output.mass_kg = calculated.mass_kg; add(...calculated.reason_codes);
    }
    if (output.mass_kg !== null) {
      output.status = 'computed';
      if (output.saved_mass?.mass_kg !== null && output.saved_mass) {
        output.saved_mass.comparison = equivalent(output.mass_kg, output.saved_mass.mass_kg!) ? 'same' : 'different';
        if (output.saved_mass.comparison === 'different') add('saved_mass_differs');
      }
    } else if (!hardInvalid && output.volume_mm3 !== null && output.reason_codes.every(code => ['missing_density', 'unverified_saved_density', 'unresolved_native_material'].includes(code))) output.status = 'needs_input';
    return output;
  } catch { add('invalid_observation'); output.mass_kg = null; output.status = 'manual'; return output; }
}
