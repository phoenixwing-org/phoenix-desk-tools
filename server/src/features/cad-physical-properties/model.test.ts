import { describe, expect, it } from 'vitest';
import {
  CAD_PHYSICAL_SCHEMA_VERSION,
  MASS_FORMULA,
  calculateMassKg,
  evaluateSinglePartPhysicalProperties,
  normalizeDensityQuantity,
  type DensityEvidence,
  type SinglePartPhysicalObservation,
} from '../../../../shared/cad-physical-properties/model.js';

// Independent mathematical inputs only. No real geometry/CAD files are loaded,
// and neither constants nor mock/native labels establish a native measurement.
const SOURCE_SHA = 'a'.repeat(64), DEPENDENCY_SHA = 'b'.repeat(64), CARD_SHA = 'c'.repeat(64), MAP_SHA = 'd'.repeat(64);
const CARD_UUID = '71a79c3a-e825-4ad8-8c29-7fa412d3774f', OTHER_CARD_UUID = 'aa30268a-d0e7-4edb-ad6c-7f134dc5cb8f';
const quantity = (value: number, unit = 'kg/m^3', raw_value = String(value)) => ({ value, unit, raw_value });
const explicit = (value = 1000, unit = 'kg/m^3'): DensityEvidence => ({
  id: 'reviewed-input', kind: 'explicit_override', review_ref: 'independent-test-density-v1', quantity: quantity(value, unit),
});
function observation(): SinglePartPhysicalObservation {
  return {
    schema_version: CAD_PHYSICAL_SCHEMA_VERSION,
    identity: { kind: 'body_tip', source_node: 'Body', final_node: 'Pocket' },
    provenance: { source: { rel: 'public-fixture/AnalyticSolid.FCStd', sha256: SOURCE_SHA },
      dependencies: [], algorithm_version: 'single-part-v1', observed_at: '2026-01-01T00:00:00Z', evidence_kind: 'synthetic', freecad_version: null },
    material: { saved_text: null, native_binding: { property: null, uuid: null, state: 'not_present', card_sha256: null, card_version: null } },
    geometry: { node: 'Pocket', basis: 'saved_shape_no_recompute', valid: true, closed: true, solid_count: 1,
      // A 20x20x10 mathematical block minus a radius-2, depth-10 through hole.
      // Its bounding-box product (4000) deliberately differs from final volume.
      volume_mm3: 4000 - 40 * Math.PI },
    density_evidence: [explicit()], saved_mass: null,
  };
}
function nativeEvidence(input: SinglePartPhysicalObservation, value = 1000): void {
  input.material = { saved_text: 'arbitrary displayed material', native_binding: {
    property: 'Material', uuid: CARD_UUID, state: 'resolved', card_sha256: CARD_SHA, card_version: 'independent-card-v1',
  } };
  input.density_evidence = [{ id: 'card', kind: 'native_material', material_uuid: CARD_UUID, card_sha256: CARD_SHA, quantity: quantity(value) }];
}

describe('P0 explicit quantity conversions (pure TS, not native unit parsing)', () => {
  it.each(['kg/m^3', 'kg/m3'])('accepts canonical explicit density unit %s', unit => {
    expect(normalizeDensityQuantity(quantity(1000, unit))).toEqual({ density_kg_m3: 1000, reason_codes: [] });
  });
  it.each(['g/cm^3', 'g/cm3'])('normalizes %s without material-name defaults', unit => {
    expect(normalizeDensityQuantity(quantity(1, unit))).toEqual(normalizeDensityQuantity(quantity(1000)));
  });
  it.each(['kg/mm^3', 'kg/mm3'])('normalizes %s explicitly', unit => {
    expect(normalizeDensityQuantity(quantity(0.000001, unit))).toEqual(normalizeDensityQuantity(quantity(1000)));
  });
  it.each(['', 'N', 'kg', 'm^3', 'steel', 'kg/m^2', 'kg/m^3 ', '__proto__', 'constructor'])('rejects missing/wrong/unknown density dimension %j', unit => {
    expect(normalizeDensityQuantity(quantity(1000, unit))).toEqual({ density_kg_m3: null, reason_codes: ['unsupported_density_unit'] });
  });
  it.each([0, -1, Number.NaN, Infinity, -Infinity, Number.MAX_VALUE])('rejects invalid or overflowing density %s', value => {
    expect(normalizeDensityQuantity(quantity(value, 'g/cm^3')).density_kg_m3).toBeNull();
  });
  it('does not evaluate an arbitrary expression or infer a missing numeric quantity', () => {
    expect(normalizeDensityQuantity({ raw_value: '1000 kg/m^3' }).density_kg_m3).toBeNull();
    expect(normalizeDensityQuantity({ ...quantity(1000), expression: 'ignored?' }).density_kg_m3).toBeNull();
  });
  it('uses the explicit mm^3 x kg/m^3 / 1e9 formula', () => {
    expect(MASS_FORMULA).toBe('volume_mm3 * density_kg_m3 / 1e9');
    expect(calculateMassKg(6000, 1000)).toEqual({ mass_kg: 0.006, reason_codes: [] });
    expect(calculateMassKg(1e308, 1e-308).mass_kg).toBeCloseTo(1e-9, 20);
    expect(calculateMassKg(Number.MIN_VALUE, 1e308).mass_kg).toBeGreaterThan(0);
  });
  it.each([[0, 1000], [-2, 1000], [Number.NaN, 1000], [100, 0], [100, -2], [100, Infinity], [1e308, 1e308], [1e-308, 1e-308]])('never masks unknown, negative, overflow or underflow as a mass (%s,%s)', (volume, density) => {
    const result = calculateMassKg(volume, density); expect(result.mass_kg).toBeNull(); expect(result.reason_codes.length).toBeGreaterThan(0);
  });
});

describe('P0 versioned single-final-entity physical observation', () => {
  it('computes the independent holed-solid constant, not its bounding box; preserves the caller input', () => {
    const input = observation(), before = structuredClone(input), result = evaluateSinglePartPhysicalProperties(input);
    expect(result.status).toBe('computed'); expect(result.volume_mm3).toBe(4000 - 40 * Math.PI);
    expect(result.mass_kg).toBeCloseTo((4000 - 40 * Math.PI) / 1e6, 14); expect(result.volume_mm3).not.toBe(4000);
    expect(result.reason_codes).toEqual([]); expect(input).toEqual(before);
    result.provenance!.source.sha256 = DEPENDENCY_SHA; expect(input.provenance.source.sha256).toBe(SOURCE_SHA);
    expect(result.density_evidence[0].source).toEqual({ kind: 'explicit_override', review_ref: 'independent-test-density-v1' });
  });
  it.each(['synthetic', 'mock_protocol', 'native_report'] as const)('does not upgrade declared %s evidence to native proof or source freshness', evidence_kind => {
    const input = observation(); input.provenance.evidence_kind = evidence_kind; input.provenance.freecad_version = evidence_kind === 'native_report' ? 'declared-engine-version' : null;
    const result = evaluateSinglePartPhysicalProperties(input);
    expect(result.status).toBe('computed'); expect(result.provenance?.evidence_kind).toBe(evidence_kind);
    expect(result.validation_scope).toBe('pure_model'); expect(result.native_proof).toBe('not_checked'); expect(result.source_freshness).toBe('not_checked');
  });
  it('accepts an explicit single solid but never treats Body plus Tip/history as a summation', () => {
    const input = observation(); input.identity = { kind: 'explicit_solid', source_node: 'FinalSolid', final_node: 'FinalSolid' }; input.geometry.node = 'FinalSolid';
    expect(evaluateSinglePartPhysicalProperties(input).status).toBe('computed');
    const repeated = { ...input, geometry: [input.geometry, input.geometry] };
    expect(evaluateSinglePartPhysicalProperties(repeated).reason_codes).toContain('invalid_observation');
    input.geometry.node = 'Body'; expect(evaluateSinglePartPhysicalProperties(input).reason_codes).toContain('geometry_node_mismatch');
    input.identity = { kind: 'body_tip', source_node: 'Body', final_node: 'Body' };
    expect(evaluateSinglePartPhysicalProperties(input).reason_codes).toContain('invalid_identity');
  });
  it.each([
    { valid: false }, { closed: false }, { solid_count: 0 }, { solid_count: 2 },
    { volume_mm3: null }, { volume_mm3: Number.NaN }, { volume_mm3: Infinity }, { volume_mm3: -25 }, { volume_mm3: 0 },
  ])('keeps invalid/open/multiple/missing/nonpositive final geometry manual: %j', patch => {
    const input = observation(); Object.assign(input.geometry, patch); const result = evaluateSinglePartPhysicalProperties(input);
    expect(result.status).toBe('manual'); expect(result.volume_mm3).toBeNull(); expect(result.mass_kg).toBeNull(); expect(result.reason_codes.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain('NaN');
  });
  it.each([null, '', 'steel', 'arbitrary material name'])('keeps volume but no density/mass when only saved material text exists: %j', saved_text => {
    const input = observation(); input.material.saved_text = saved_text; input.density_evidence = [];
    const result = evaluateSinglePartPhysicalProperties(input); expect(result.status).toBe('needs_input');
    expect(result.volume_mm3).toBe(input.geometry.volume_mm3); expect(result.density_kg_m3).toBeNull(); expect(result.mass_kg).toBeNull();
    expect(result.material?.saved_text).toBe(saved_text); expect(result.reason_codes).toContain('missing_density');
  });
  it.each(['unresolved', 'invalid'] as const)('never resolves %s native UUID to a guessed density', state => {
    const input = observation(); input.material.native_binding = { property: 'Material', uuid: 'unavailable-card', state, card_sha256: null, card_version: null }; input.density_evidence = [];
    const result = evaluateSinglePartPhysicalProperties(input); expect(result.status).toBe('needs_input'); expect(result.mass_kg).toBeNull(); expect(result.reason_codes).toContain('unresolved_native_material');
  });
  it('requires a resolved exact native UUID and card digest when native material claims density', () => {
    const input = observation(); nativeEvidence(input); expect(evaluateSinglePartPhysicalProperties(input).status).toBe('computed');
    input.material.native_binding.uuid = OTHER_CARD_UUID; let result = evaluateSinglePartPhysicalProperties(input);
    expect(result.mass_kg).toBeNull(); expect(result.reason_codes).toContain('density_binding_mismatch');
    input.material.native_binding.uuid = CARD_UUID; input.material.native_binding.card_sha256 = DEPENDENCY_SHA;
    result = evaluateSinglePartPhysicalProperties(input); expect(result.mass_kg).toBeNull(); expect(result.reason_codes).toContain('density_binding_mismatch');
    input.material.native_binding.state = 'unresolved'; input.material.native_binding.card_sha256 = null; input.material.native_binding.card_version = null;
    expect(evaluateSinglePartPhysicalProperties(input).reason_codes).toContain('unresolved_native_material');
  });
  it.each(['not-a-uuid', '00000000-0000-0000-0000-000000000000', '71a79c3a-e825-4ad8-8c29-7fa412d3774', '{71a79c3a-e825-4ad8-8c29-7fa412d3774f}', ` ${CARD_UUID}`])('rejects invalid/zero/noncanonical resolved UUID claims %j without rewriting them', uuid => {
    const input = observation(); nativeEvidence(input); input.material.native_binding.uuid = uuid;
    expect(evaluateSinglePartPhysicalProperties(input).mass_kg).toBeNull(); expect(input.material.native_binding.uuid).toBe(uuid);
    nativeEvidence(input); (input.density_evidence[0] as Extract<DensityEvidence, { kind: 'native_material' }>).material_uuid = uuid;
    expect(evaluateSinglePartPhysicalProperties(input).reason_codes).toContain('invalid_observation');
    expect(evaluateSinglePartPhysicalProperties(input).mass_kg).toBeNull();
  });
  it('preserves an uppercase valid UUID spelling and requires exact binding equality', () => {
    const input = observation(); nativeEvidence(input); const upper = CARD_UUID.toUpperCase(); input.material.native_binding.uuid = upper;
    const native = input.density_evidence[0] as Extract<DensityEvidence, { kind: 'native_material' }>; native.material_uuid = upper;
    const result = evaluateSinglePartPhysicalProperties(input); expect(result.status).toBe('computed'); expect(result.material?.native_binding.uuid).toBe(upper);
    native.material_uuid = CARD_UUID; expect(evaluateSinglePartPhysicalProperties(input).reason_codes).toContain('density_binding_mismatch');
  });
  it('does not replace unresolved native density with a different valid candidate silently', () => {
    const input = observation(); nativeEvidence(input); input.material.native_binding.state = 'unresolved'; input.material.native_binding.card_sha256 = null; input.material.native_binding.card_version = null;
    input.density_evidence.push(explicit()); expect(evaluateSinglePartPhysicalProperties(input).mass_kg).toBeNull();
  });
  it('permits a genuinely explicit density input without inferring anything from an unresolved material label', () => {
    const input = observation(); input.material.native_binding = { property: 'Material', uuid: 'unavailable-card', state: 'unresolved', card_sha256: null, card_version: null };
    const result = evaluateSinglePartPhysicalProperties(input); expect(result.status).toBe('computed'); expect(result.reason_codes).toContain('unresolved_native_material');
  });
  it('retains a versioned mapping identity/digest, and does not silently make a material-name map', () => {
    const input = observation(); input.density_evidence = [{ id: 'chosen-entry', kind: 'versioned_mapping', entry_key: 'explicit-entry', mapping_version: 'v1', mapping_sha256: MAP_SHA, quantity: quantity(1, 'g/cm^3') }];
    const result = evaluateSinglePartPhysicalProperties(input); expect(result.density_kg_m3).toBe(1000);
    expect(result.density_evidence[0].source).toEqual({ kind: 'versioned_mapping', entry_key: 'explicit-entry', mapping_version: 'v1', mapping_sha256: MAP_SHA });
    delete (input.density_evidence[0] as Partial<DensityEvidence>).kind;
    expect(evaluateSinglePartPhysicalProperties(input).reason_codes).toContain('invalid_observation');
  });
  it('compares equivalent density units; conflicting card/calculation/override inputs stay manual without priority', () => {
    const input = observation(); nativeEvidence(input); input.density_evidence.push({ id: 'saved', kind: 'saved_calculation', property: 'CalculationDensity', quantity: quantity(1, 'g/cm^3') });
    expect(evaluateSinglePartPhysicalProperties(input).status).toBe('computed');
    input.density_evidence[1].quantity.value = 2;
    let result = evaluateSinglePartPhysicalProperties(input); expect(result.status).toBe('manual'); expect(result.mass_kg).toBeNull(); expect(result.density_conflict).toBe(true); expect(result.reason_codes).toContain('density_conflict');
    input.density_evidence[1] = explicit(2000); result = evaluateSinglePartPhysicalProperties(input);
    expect(result.mass_kg).toBeNull(); expect(result.density_conflict).toBe(true);
  });
  it('never treats saved CalculationDensity alone as verified current density', () => {
    const input = observation(); input.density_evidence = [{ id: 'saved', kind: 'saved_calculation', property: 'CalculationDensity', quantity: quantity(1000) }];
    const result = evaluateSinglePartPhysicalProperties(input); expect(result.status).toBe('needs_input'); expect(result.density_kg_m3).toBeNull(); expect(result.mass_kg).toBeNull(); expect(result.reason_codes).toContain('unverified_saved_density');
  });
  it.each([0, -3, Number.NaN, Infinity])('does not discard invalid density %s behind an otherwise valid source', value => {
    const input = observation(); input.density_evidence.push({ ...explicit(value), id: 'second-input' });
    const result = evaluateSinglePartPhysicalProperties(input); expect(result.status).toBe('manual'); expect(result.mass_kg).toBeNull(); expect(result.reason_codes).toContain('invalid_density');
    expect(result.density_evidence[1].quantity.raw_value).toBe(String(value)); expect(JSON.stringify(result)).not.toContain('"value":null,"unit":"kg/m^3","raw_value":null');
  });
  it('retains unknown raw density units instead of guessing their dimension', () => {
    const input = observation(); input.density_evidence[0].quantity.unit = 'N';
    const result = evaluateSinglePartPhysicalProperties(input); expect(result.mass_kg).toBeNull(); expect(result.density_evidence[0].quantity).toEqual(quantity(1000, 'N')); expect(result.reason_codes).toContain('unsupported_density_unit');
  });
  it('retains saved mass and its disagreement, but never substitutes it for current derived mass', () => {
    const input = observation(); input.saved_mass = { ...quantity(8, 'kg', '8'), property: 'Mass' };
    let result = evaluateSinglePartPhysicalProperties(input); expect(result.status).toBe('computed'); expect(result.mass_kg).not.toBe(8); expect(result.saved_mass?.mass_kg).toBe(8); expect(result.saved_mass?.comparison).toBe('different'); expect(result.reason_codes).toContain('saved_mass_differs');
    input.density_evidence = []; result = evaluateSinglePartPhysicalProperties(input); expect(result.mass_kg).toBeNull(); expect(result.saved_mass?.mass_kg).toBe(8); expect(result.saved_mass?.comparison).toBe('uncompared');
    input.density_evidence = [explicit()]; input.saved_mass = { ...quantity((input.geometry.volume_mm3! / 1e6) * 1000, 'g'), property: 'Mass' };
    result = evaluateSinglePartPhysicalProperties(input); expect(result.saved_mass?.comparison).toBe('same');
  });
  it.each(['N', '', 'not-a-mass'])('keeps invalid saved mass units %j separate from calculated current mass', unit => {
    const input = observation(); input.saved_mass = { ...quantity(8, unit), property: 'Mass' }; const result = evaluateSinglePartPhysicalProperties(input);
    expect(result.status).toBe('computed'); expect(result.saved_mass?.comparison).toBe('invalid'); expect(result.saved_mass?.mass_kg).toBeNull(); expect(result.reason_codes).toContain('invalid_saved_mass');
  });
  it.each([
    (input: SinglePartPhysicalObservation) => { (input as { schema_version: number }).schema_version = 2; },
    (input: SinglePartPhysicalObservation) => { input.provenance.source.sha256 = 'missing'; },
    (input: SinglePartPhysicalObservation) => { input.provenance.source.rel = '../outside.FCStd'; },
    (input: SinglePartPhysicalObservation) => { input.provenance.dependencies = [{ ...input.provenance.source }]; },
    (input: SinglePartPhysicalObservation) => { input.provenance.dependencies = [{ rel: 'dependency.FCStd', sha256: DEPENDENCY_SHA }, { rel: 'dependency.FCStd', sha256: DEPENDENCY_SHA }]; },
    (input: SinglePartPhysicalObservation) => { input.provenance.evidence_kind = 'native_report'; },
    (input: SinglePartPhysicalObservation) => { input.density_evidence.push({ ...input.density_evidence[0] }); },
    (input: SinglePartPhysicalObservation) => { (input as unknown as { geometry: unknown }).geometry = null; },
  ])('fails closed on invalid version/identity/digests/duplicates/protocol structure [%#]', mutate => {
    const input = observation(); mutate(input); const result = evaluateSinglePartPhysicalProperties(input); expect(result.status).toBe('manual'); expect(result.mass_kg).toBeNull(); expect(result.reason_codes.length).toBeGreaterThan(0);
  });
  it('records source/dependency digests without claiming to have read or verified files', () => {
    const input = observation(); input.provenance.dependencies = [{ rel: 'dependency/IndependentPart.FCStd', sha256: DEPENDENCY_SHA }];
    const result = evaluateSinglePartPhysicalProperties(input); expect(result.provenance).toEqual(input.provenance); expect(result.source_freshness).toBe('not_checked');
  });
  it.each([null, undefined, [], {}, { schema_version: 99 }])('returns a bounded manual assessment for malformed input %j', value => {
    const result = evaluateSinglePartPhysicalProperties(value); expect(result.mass_kg).toBeNull(); expect(result.reason_codes).toEqual(['invalid_observation']); expect(result.status).toBe('manual');
  });
});
