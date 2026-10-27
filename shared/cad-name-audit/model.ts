import { parseCadIdentity } from '../cad-companion/model.js';

/** A frozen explicit selection, not an instruction to discover more files. */
export interface SelectedNameSource {
  item_id: string;
  rel: string;
  sha256: string | null;
  error?: string;
}
export interface NameAuditGroup {
  key: string;
  item_ids: string[];
  paths: string[];
}
export interface SelectedCadNameAudit {
  schema_version: 1;
  algorithm: 'selected-cad-name-audit-v1';
  scope: 'explicit_selection';
  source: 'display_filename';
  complete: boolean;
  selected: number;
  inspected: number;
  exact_filename_duplicates: NameAuditGroup[];
  portable_filename_collisions: NameAuditGroup[];
  identity_duplicates: NameAuditGroup[];
  manual: Array<{ item_id: string; rel: string; reason: string }>;
  warnings: string[];
}

const control = /[\p{Cc}\p{Cf}\p{Cs}]/u;
const hash = /^[a-f0-9]{64}$/u;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function relative(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 2048
    && !control.test(value) && !/^[A-Za-z]:|^[\\/]/u.test(value) && !value.includes('\\')
    && value.split('/').every(part => part && part !== '.' && part !== '..' && !part.startsWith('.')
      && !['node_modules', '__pycache__'].includes(part));
}
function add(groups: Map<string, SelectedNameSource[]>, key: string, source: SelectedNameSource) {
  const rows = groups.get(key) ?? []; rows.push(source); groups.set(key, rows);
}
function duplicates(groups: Map<string, SelectedNameSource[]>): NameAuditGroup[] {
  return [...groups].filter(([, rows]) => rows.length > 1).sort(([a], [b]) => compare(a, b))
    .map(([key, rows]) => ({ key, item_ids: rows.map(row => row.item_id), paths: rows.map(row => row.rel) }));
}

/**
 * Pure, bounded grouping of exactly the frozen inputs. No recursive inventory,
 * preferences, filesystem or automatic merge/delete. A filename is not saved
 * PartNumber truth, and a duplicate file is not an assembly occurrence count.
 */
export function inspectSelectedCadNames(sources: readonly SelectedNameSource[]): SelectedCadNameAudit {
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > 200) {
    throw new Error('Name audit requires 1–200 explicitly frozen sources');
  }
  const ids = new Set<string>(), paths = new Set<string>();
  const names = new Map<string, SelectedNameSource[]>(), portable = new Map<string, SelectedNameSource[]>();
  const identities = new Map<string, SelectedNameSource[]>();
  const manual: SelectedCadNameAudit['manual'] = [];
  let inspected = 0;
  for (const source of sources) {
    if (!source || typeof source.item_id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/u.test(source.item_id)
      || !relative(source.rel) || ids.has(source.item_id) || paths.has(source.rel)
      || (source.error !== undefined && (typeof source.error !== 'string' || !source.error || source.error.length > 2048 || control.test(source.error)))
      || (source.sha256 !== null && (typeof source.sha256 !== 'string' || !hash.test(source.sha256)))) {
      throw new Error('Invalid or duplicate frozen name-audit source');
    }
    ids.add(source.item_id); paths.add(source.rel);
    if (source.error || source.sha256 === null) {
      manual.push({ item_id: source.item_id, rel: source.rel, reason: source.error ?? 'Source fingerprint unavailable' });
      continue;
    }
    const filename = source.rel.split('/').at(-1)!;
    add(names, filename, source);
    add(portable, filename.normalize('NFC').toLowerCase(), source);
    const identity = parseCadIdentity(filename);
    if (identity.parseStatus !== 'parsed') {
      manual.push({ item_id: source.item_id, rel: source.rel, reason: 'CAD filename identity requires manual confirmation; no truncated revision or guessed variant' });
      continue;
    }
    inspected++;
    // Assembly and part models occupy the model family. Independent Drawing
    // documents and their draft sequences must never collide with the model.
    const family = identity.role === 'drawing' ? 'drawing' : 'model';
    add(identities, JSON.stringify([family, identity.number, identity.revisionRaw, identity.draftSequence]), source);
  }
  const result: SelectedCadNameAudit = {
    schema_version: 1, algorithm: 'selected-cad-name-audit-v1', scope: 'explicit_selection', source: 'display_filename',
    complete: manual.length === 0, selected: sources.length, inspected,
    exact_filename_duplicates: duplicates(names), portable_filename_collisions: duplicates(portable),
    identity_duplicates: duplicates(identities), manual,
    warnings: [
      'Only the explicit frozen selection was compared; absence of a duplicate is not a workspace-wide result.',
      'Filename identity is not a saved PartNumber/PartVersion, verified geometry, or assembly occurrence identity.',
      'Portable filename collisions are advisory; original spelling, case and Unicode normalization are not rewritten.',
    ],
  };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 256 * 1024) {
    throw new Error('Name audit observation exceeds 256KiB; no truncated success result');
  }
  return result;
}
