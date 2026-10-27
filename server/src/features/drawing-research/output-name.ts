import fs from 'node:fs';
import path from 'node:path';
import type { ExplicitCompanionAlias, FrozenDrawingOutputGroup } from '../../../../shared/cad-companion/contracts.js';
import { parseCadIdentity, sameCadBindingIdentity } from '../../../../shared/cad-companion/model.js';
import { allocateDrawingOutputGroup, assertOutputGroupAbsent } from '../cad-companions/output.js';
import { assertRoot, CompanionFsError, listDirectory, MAX_COMPANION_CANDIDATES, safeRelative, validateRelative } from '../cad-companions/filesystem.js';

export type DrawingOutputOptions = {
  workspace?: string; output?: string; name_override?: string; source_node?: string; explicit_aliases?: ExplicitCompanionAlias[];
};
export type DrawingOutputPlan = {
  readonly workspace: string; readonly drawing: string; readonly pdf: string; readonly notes: string;
  readonly reserved: readonly string[]; readonly companion?: FrozenDrawingOutputGroup; readonly legacy_manual: boolean;
};
const fold = (value: string) => value.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC');
function invalid(message: string): never { throw new CompanionFsError('unsafe', message); }
const drawSuffix = '.Drawing.FCStd';
const notesSuffix = '-出图说明.md';
function portableBasename(name: string): void {
  if (!name || name === '.' || name === '..' || /[<>:"/\\|?*\p{Cc}\p{Cf}\p{Cs}]/u.test(name) || /[. ]$/u.test(name)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name) || name !== name.normalize('NFC') || Buffer.byteLength(name, 'utf8') > 255) {
    invalid('输出文件名必须是安全 NFC basename，且不超过 255 字节');
  }
}
function absoluteIn(root: string, value: string): string {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) && path.normalize(value) !== value) invalid('需要规范的输出路径');
  const rel = path.isAbsolute(value) ? path.relative(root, value) : value;
  validateRelative(rel); return path.join(root, rel);
}
function relativeTo(root: string, value: string): string { return validateRelative(path.relative(root, value).replaceAll(path.sep, '/')); }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

/** Pure three-path mapping, also used for owned hidden .id.Drawing.FCStd stages. */
export function drawingOutputPaths(drawing: string): string[] {
  if (typeof drawing !== 'string' || !/\.Drawing\.FCStd$/i.test(drawing)) invalid('目标须为 Drawing.FCStd');
  const stem = drawing.slice(0, -drawSuffix.length), result = [drawing, `${stem}.Drawing.pdf`, `${stem}${notesSuffix}`];
  for (const file of result) portableBasename(path.basename(file));
  return result;
}
function compatibleReservations(drawing: string): string[] {
  const stem = drawing.slice(0, -'.FCStd'.length);
  return [...drawingOutputPaths(drawing), `${stem}.ai.md`, `${stem}.md`];
}
function directoryRel(root: string, drawing: string): string { return path.dirname(drawing) === root ? '' : relativeTo(root, path.dirname(drawing)); }
function listing(root: string, drawing: string) {
  const result = listDirectory(root, directoryRel(root, drawing));
  if (!result.complete) throw new CompanionFsError('limit', '输出目录超过 2000 条完整扫描预算');
  return result;
}
function occupied(names: string[], reserved: readonly string[]): boolean {
  const keys = new Set(reserved.map(file => fold(path.basename(file)))); return names.some(name => keys.has(fold(name)));
}
function assertCompatibleAbsent(root: string, drawing: string, reserved: readonly string[]): void {
  const before = listing(root, drawing);
  if (occupied(before.names, reserved)) invalid('预览输出或旧说明已被占位，请重新预览；不会自动换名');
  for (const file of reserved) {
    portableBasename(path.basename(file)); const target = safeRelative(root, relativeTo(root, file), {allowMissingLeaf: true});
    try { fs.lstatSync(target); invalid('预览输出或旧说明已被占位，请重新预览；不会自动换名'); }
    catch (error) { if (error instanceof CompanionFsError) throw error; if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new CompanionFsError('unreadable', '输出占位无法核对'); }
  }
  const after = listing(root, drawing);
  if (before.proof !== after.proof || JSON.stringify(before.names) !== JSON.stringify(after.names)) throw new CompanionFsError('changed', '输出目录已变化，请重新预览');
}
function legacyDraft(base: string, drawing: string): number {
  const stem = path.basename(drawing).slice(0, -drawSuffix.length);
  if (stem === base) return 1;
  const digits = stem.startsWith(`${base}-初稿`) ? stem.slice(base.length + '-初稿'.length) : '';
  const draft = /^\d+$/u.test(digits) ? Number(digits) : 0;
  if (draft < 2 || draft > 9999 || String(draft).padStart(2, '0') !== digits) invalid('显式输出必须保持源基名及有效初稿序号');
  return draft;
}
function legacyPlan(root: string, source: string, output?: string): DrawingOutputPlan {
  const base = parseCadIdentity(path.basename(source)).rawStem;
  const explicit = output === undefined ? undefined : absoluteIn(root, output);
  if (explicit && path.dirname(explicit) !== path.dirname(source)) invalid('新稿必须在源模型同目录');
  if (explicit) { drawingOutputPaths(explicit); legacyDraft(base, explicit); }
  const first = explicit ? legacyDraft(base, explicit) : 1, end = explicit ? first : 9999;
  const initial = listing(root, source);
  for (let draft = first; draft <= end; draft++) {
    const drawing = explicit ?? path.join(path.dirname(source), `${base}${draft === 1 ? '' : '-初稿' + String(draft).padStart(2, '0')}${drawSuffix}`);
    const [, pdf, notes] = drawingOutputPaths(drawing), reserved = compatibleReservations(drawing);
    if (occupied(initial.names, reserved)) continue;
    const plan: DrawingOutputPlan = {workspace: root, drawing, pdf, notes, reserved, legacy_manual: true};
    assertDrawingOutputPlanAbsent(plan); return freeze(plan);
  }
  invalid('输出或旧说明已占位，或初稿文件名已达到上限，请重新预览');
}

/** Initial preview only; it never creates outputs, invents a revision or grants publication permission. */
export function planDrawingOutputs(sourceAbs: string, options: DrawingOutputOptions = {}): DrawingOutputPlan {
  if (typeof sourceAbs !== 'string' || !path.isAbsolute(sourceAbs) || path.normalize(sourceAbs) !== sourceAbs || !options || typeof options !== 'object') invalid('需要明确的普通源模型绝对路径');
  const root = assertRoot(options.workspace ?? path.dirname(sourceAbs)), source = absoluteIn(root, sourceAbs), sourceRel = relativeTo(root, source);
  const sourcePath = safeRelative(root, sourceRel), identity = parseCadIdentity(path.basename(source));
  portableBasename(path.basename(source));
  if (!fs.lstatSync(sourcePath).isFile() || !['model', 'assembly'].includes(identity.role)) invalid('新稿源须为普通模型或总成 FCStd，不能是既有图纸');
  if (options.source_node !== undefined && (typeof options.source_node !== 'string' || !options.source_node || options.source_node.length > 256 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(options.source_node))) invalid('源对象身份无效');
  if (identity.parseStatus !== 'parsed') {
    // A malformed/unknown revision-like identity must not bypass the core by
    // posing as an unnumbered research sample. Preserve only truly plain names.
    if (identity.number !== null || identity.variantStatus === 'unknown' || /^[A-Za-z0-9_]+\.(?:[0-9]|[^-]*-)/u.test(identity.rawStem) || /-初稿[^-]*$/u.test(identity.rawStem)) invalid('源名称包含未确认版次或初稿身份，不能使用无编号兼容模式');
    if (options.name_override !== undefined || options.explicit_aliases !== undefined) invalid('无编号兼容模式不接受名称覆盖或结构化别名');
    return legacyPlan(root, source, options.output);
  }
  if (options.name_override !== undefined && typeof options.name_override !== 'string') invalid('明确名称无效');
  if (options.explicit_aliases !== undefined) {
    if (!Array.isArray(options.explicit_aliases) || options.explicit_aliases.length > MAX_COMPANION_CANDIDATES) invalid('说明别名超过上限或格式无效');
    for (const alias of options.explicit_aliases) {
      if (!alias || !['model_notes','drawing_notes','development_doc','unknown'].includes(alias.purpose) || typeof alias.rel !== 'string' || !/\.md$/i.test(alias.rel)) invalid('说明别名无效');
      validateRelative(alias.rel);
    }
  }
  const output = options.output === undefined ? undefined : absoluteIn(root, options.output);
  if (output && path.dirname(output) !== path.dirname(source)) invalid('新稿必须在源模型同目录');
  const outputIdentity = output ? parseCadIdentity(path.basename(output)) : undefined;
  if (outputIdentity && (outputIdentity.role !== 'drawing' || !sameCadBindingIdentity(identity, outputIdentity))) invalid('显式输出与源模型身份不一致');
  const group = allocateDrawingOutputGroup(root, {source_rel: sourceRel, source_node: options.source_node, identity, purpose: 'drawing_notes',
    name_override: options.name_override, explicit_aliases: options.explicit_aliases,
    ...(output ? {drawing_rel: relativeTo(root, output), draft_sequence: outputIdentity!.draftSequence ?? 1} : {})}, {allowNextDraft: output === undefined});
  const plan: DrawingOutputPlan = {workspace: root, drawing: path.join(root, group.drawing_rel), pdf: path.join(root, group.pdf_rel), notes: path.join(root, group.notes_rel),
    reserved: group.reserved_rels.map(rel => path.join(root, rel)), companion: group, legacy_manual: false};
  for (const file of plan.reserved) portableBasename(path.basename(file));
  return freeze(plan);
}

/** Rechecks exactly the frozen group; this is an observation, not atomic publication or a retry allocator. */
export function assertDrawingOutputPlanAbsent(plan: DrawingOutputPlan): void {
  if (!plan || typeof plan.legacy_manual !== 'boolean' || !Array.isArray(plan.reserved)) invalid('冻结输出计划无效');
  const root = assertRoot(plan.workspace);
  if (root !== plan.workspace) invalid('冻结工作空间已改变');
  for (const file of [plan.drawing, plan.pdf, plan.notes, ...plan.reserved]) { if (absoluteIn(root, file) !== file) invalid('冻结输出路径已改变'); portableBasename(path.basename(file)); }
  if (plan.legacy_manual) {
    const [, pdf, notes] = drawingOutputPaths(plan.drawing), reserved = compatibleReservations(plan.drawing);
    if (plan.companion !== undefined || plan.pdf !== pdf || plan.notes !== notes || JSON.stringify(plan.reserved) !== JSON.stringify(reserved)) invalid('无编号冻结输出组已改变');
    assertCompatibleAbsent(root, plan.drawing, reserved); return;
  }
  const group = plan.companion;
  if (!group || plan.drawing !== path.join(root, group.drawing_rel) || plan.pdf !== path.join(root, group.pdf_rel) || plan.notes !== path.join(root, group.notes_rel)
    || JSON.stringify(plan.reserved) !== JSON.stringify(group.reserved_rels.map(rel => path.join(root, rel)))) invalid('结构化冻结输出组已改变');
  assertOutputGroupAbsent(root, group);
}

/** Compatibility names-only guard. New execution code should retain and assert a DrawingOutputPlan. */
export function assertDrawingOutputsAbsent(drawing: string): void {
  if (typeof drawing !== 'string' || !path.isAbsolute(drawing) || path.normalize(drawing) !== drawing) invalid('需要明确图纸绝对路径');
  const root = assertRoot(path.dirname(drawing)); absoluteIn(root, drawing);
  assertCompatibleAbsent(root, drawing, compatibleReservations(drawing));
}
export function nextDrawingOutput(source: string, options: DrawingOutputOptions = {}): string {
  return planDrawingOutputs(source, options).drawing;
}
