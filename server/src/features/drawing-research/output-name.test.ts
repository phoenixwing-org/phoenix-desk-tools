import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nextDrawingOutput, drawingOutputPaths, planDrawingOutputs, assertDrawingOutputPlanAbsent, assertDrawingOutputsAbsent } from './output-name.js';
import * as companionFilesystem from '../cad-companions/filesystem.js';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true}); });
function fixture(name = '1357.004P1-Independent-widget.FCStd', folder = 'parts') {
 const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'drawing-name-'))); roots.push(root);
 const directory = path.join(root, folder); fs.mkdirSync(directory, {recursive: true});
 const source = path.join(directory, name); fs.writeFileSync(source, 'Independent synthetic source bytes; not a CAD model');
 return {root, source, directory};
}
const names = (files: readonly string[]) => files.map(file => path.basename(file));

describe('drawing output plan wrapper and compatibility mapping', () => {
 it('keeps legacy research names, strips ASSY only, and checks the complete compatible group', () => {
  const {source, directory: dir} = fixture('Example.ASSY.FCStd');
  expect(path.basename(nextDrawingOutput(source))).toBe('Example.Drawing.FCStd');
  fs.writeFileSync(path.join(dir, 'Example.Drawing.pdf'), 'keep');
  expect(path.basename(nextDrawingOutput(source))).toBe('Example-初稿02.Drawing.FCStd');
  fs.writeFileSync(path.join(dir, 'Example-初稿02.Drawing.ai.md'), 'keep');
  fs.writeFileSync(path.join(dir, 'Example-初稿03.Drawing.FCStd'), 'keep');
  expect(path.basename(nextDrawingOutput(source))).toBe('Example-初稿04.Drawing.FCStd');
  expect(fs.readFileSync(path.join(dir, 'Example.Drawing.pdf'), 'utf8')).toBe('keep');
 });
 it('treats case variants and directories as occupied, and defaults to purpose-labelled notes', () => {
  const {source, directory: dir} = fixture('Example.FCStd');
  fs.mkdirSync(path.join(dir, 'example.drawing.fcstd'));
  const output = nextDrawingOutput(source);
  expect(names(drawingOutputPaths(output))).toEqual(['Example-初稿02.Drawing.FCStd', 'Example-初稿02.Drawing.pdf', 'Example-初稿02-出图说明.md']);
 });
 it('uses the core structured binding with full workspace paths and deeply freezes the returned plan', () => {
  const {root, source, directory} = fixture('1357.004P1-Independent-widget.Classification.ASSY.FCStd');
  const before = fs.readdirSync(directory), plan = planDrawingOutputs(source, {workspace: root, source_node: 'Body'});
  expect(plan).toMatchObject({workspace: root, legacy_manual: false, companion: {binding: {source_rel: 'parts/1357.004P1-Independent-widget.Classification.ASSY.FCStd', source_node: 'Body', draft_sequence: 1}}});
  expect(names([plan.drawing, plan.pdf, plan.notes])).toEqual(['1357.004P1-Independent-widget.Classification.Drawing.FCStd', '1357.004P1-Independent-widget.Classification.Drawing.pdf', '1357.004P1-Independent-widget.Classification-出图说明.md']);
  expect(Object.isFrozen(plan)).toBe(true); expect(Object.isFrozen(plan.reserved)).toBe(true); expect(Object.isFrozen(plan.companion!.binding.identity)).toBe(true);
  expect(fs.readdirSync(directory)).toEqual(before); expect(() => assertDrawingOutputPlanAbsent(plan)).not.toThrow();
 });
 it('defaults workspace to the source parent while preserving explicit full workspace-relative bindings', () => {
  const {root, source} = fixture(), implicit = planDrawingOutputs(source), explicit = planDrawingOutputs(source, {workspace: root});
  expect(implicit.workspace).toBe(path.dirname(source)); expect(implicit.companion!.binding.source_rel).toBe(path.basename(source));
  expect(explicit.companion!.binding.source_rel).toBe(`parts/${path.basename(source)}`); expect(implicit.drawing).toBe(explicit.drawing);
 });
 it('changes only notes for a reviewed name override and reserves old full-name and short-name aliases', () => {
  const {root, source} = fixture(), plan = planDrawingOutputs(source, {workspace: root, name_override: 'Reviewed-name'});
  expect(path.basename(plan.drawing)).toBe('1357.004P1-Independent-widget.Drawing.FCStd'); expect(path.basename(plan.pdf)).toBe('1357.004P1-Independent-widget.Drawing.pdf');
  expect(path.basename(plan.notes)).toBe('1357.004P1-Reviewed-name-出图说明.md');
  expect(names(plan.reserved)).toEqual(expect.arrayContaining(['1357.004P1-Independent-widget-出图说明.md', '1357.004P1-Independent-widget.Drawing.ai.md', '1357.004P1-Independent-widget.Drawing.md', '1357.004P1-Reviewed-name.Drawing.ai.md', '1357.004P1-Reviewed-name.Drawing.md']));
 });
 it('protects exact reviewed bare aliases without assigning unrelated unknown-purpose Markdown', () => {
  const {root, source} = fixture(), alias = 'parts/1357.004P1-Independent-widget.md';
  const plan = planDrawingOutputs(source, {workspace: root, explicit_aliases: [{rel: alias, purpose: 'drawing_notes'}]});
  expect(plan.reserved).toContain(path.join(root, alias)); fs.writeFileSync(path.join(root, alias), 'Protected reviewed human note');
  expect(() => assertDrawingOutputPlanAbsent(plan)).toThrow(/占位/);
  const unrelated = planDrawingOutputs(source, {workspace: root, explicit_aliases: [{rel: alias, purpose: 'model_notes'}]});
  expect(unrelated.reserved).not.toContain(path.join(root, alias));
 });
 it.each(['P', 'P1', 'P2'])('keeps known variant %s and draft identity independent', variant => {
  const {root, source} = fixture(`1357.004${variant}-Independent-widget.FCStd`), output = `parts/1357.004${variant}-Independent-widget-初稿02.Drawing.FCStd`;
  const plan = planDrawingOutputs(source, {workspace: root, output});
  expect(plan.drawing).toBe(path.join(root, output)); expect(plan.companion).toMatchObject({draft_sequence: 2, binding: {identity: {revision: '004', revisionRaw: `004${variant}`, variantRaw: variant}}});
  fs.writeFileSync(plan.notes, 'racing occupant'); expect(() => assertDrawingOutputPlanAbsent(plan)).toThrow(/占位/);
  expect(() => planDrawingOutputs(source, {workspace: root, output})).toThrow(/占位/); expect(plan.companion!.draft_sequence).toBe(2);
 });
 it('allocates the next draft only when no explicit output is supplied', () => {
  const {root, source} = fixture(), first = planDrawingOutputs(source, {workspace: root}); fs.writeFileSync(first.notes, 'keep first draft');
  const second = planDrawingOutputs(source, {workspace: root}); expect(path.basename(second.drawing)).toContain('-初稿02.Drawing.FCStd');
  expect(() => planDrawingOutputs(source, {workspace: root, output: first.drawing})).toThrow(/占位/); expect(fs.readFileSync(first.notes, 'utf8')).toBe('keep first draft');
 });
 it.each(['Example.FCStd', 'Model.Example.FCStd'])('retains truly unnumbered %s as legacy_manual without machine provenance', name => {
  const {root, source} = fixture(name), plan = planDrawingOutputs(source, {workspace: root, source_node: 'Body'});
  expect(plan.legacy_manual).toBe(true); expect(plan.companion).toBeUndefined(); expect(path.basename(plan.drawing)).toBe(name.replace(/\.FCStd$/i, '.Drawing.FCStd'));
  expect(() => planDrawingOutputs(source, {workspace: root, name_override: 'Other'})).toThrow(/兼容模式/);
  expect(() => planDrawingOutputs(source, {workspace: root, explicit_aliases: []})).toThrow(/兼容模式/);
 });
 it.each(['1357.04-Widget.FCStd', '1357.0007-Widget.FCStd', '1357.004Q9-Widget.FCStd', '1357.004P3-Widget.FCStd', '1357.004Widget.FCStd', '1357.004-Widget-初稿02.FCStd'])('never launders malformed/unknown structured identity %s through legacy mode', name => {
  const {root, source} = fixture(name); expect(() => planDrawingOutputs(source, {workspace: root})).toThrow(/版次|身份/);
 });
 it('requires source files, rejects existing drawings, path escapes, cross-directory outputs and identity changes', () => {
  const {root, source} = fixture();
  expect(() => planDrawingOutputs(path.join(root, 'parts/Missing.FCStd'), {workspace: root})).toThrow();
  expect(() => planDrawingOutputs(source, {workspace: path.join(root, 'parts/absent')})).toThrow();
  expect(() => planDrawingOutputs(source, {workspace: root, output: '../escape.Drawing.FCStd'})).toThrow();
  expect(() => planDrawingOutputs(source, {workspace: root, output: 'Elsewhere.Drawing.FCStd'})).toThrow(/同目录/);
  expect(() => planDrawingOutputs(source, {workspace: root, output: 'parts/1357.004P2-Independent-widget.Drawing.FCStd'})).toThrow(/身份/);
  expect(() => planDrawingOutputs(source, {workspace: root, output: 'parts/1357.004P1-Independent-widget-初稿01.Drawing.FCStd'})).toThrow(/身份/);
  const drawing = fixture('1357.004-Widget.Drawing.FCStd'); expect(() => planDrawingOutputs(drawing.source, {workspace: drawing.root})).toThrow(/既有图纸/);
  fs.unlinkSync(source); fs.mkdirSync(source); expect(() => planDrawingOutputs(source, {workspace: root})).toThrow(/普通/);
 });
 it('checks legacy explicit output identity and never silently switches its frozen sequence', () => {
  const {root, source} = fixture('Example.FCStd'), output = 'parts/Example-初稿02.Drawing.FCStd';
  const plan = planDrawingOutputs(source, {workspace: root, output}); expect(plan.drawing).toBe(path.join(root, output));
  expect(() => planDrawingOutputs(source, {workspace: root, output: 'parts/Different.Drawing.FCStd'})).toThrow(/基名/);
  fs.writeFileSync(plan.notes, 'keep exact draft'); expect(() => planDrawingOutputs(source, {workspace: root, output})).toThrow(/占位/);
 });
 it('blocks forged or reduced frozen plans instead of dropping required reservations', () => {
  const {root, source} = fixture(), plan = planDrawingOutputs(source, {workspace: root});
  expect(() => assertDrawingOutputPlanAbsent({...plan, reserved: plan.reserved.slice(0, 3)})).toThrow(/改变/);
  expect(() => assertDrawingOutputPlanAbsent({...plan, notes: path.join(root, 'wrong.md')})).toThrow(/改变/);
  const legacy = fixture('Example.FCStd'), old = planDrawingOutputs(legacy.source, {workspace: legacy.root});
  expect(() => assertDrawingOutputPlanAbsent({...old, reserved: old.reserved.slice(0, 3)})).toThrow(/改变/);
  expect(() => assertDrawingOutputPlanAbsent({...plan, legacy_manual: true})).toThrow(/改变/);
 });
 it.each(['Drawing.ai.md', 'Drawing.md', 'Drawing.FCStd', 'Drawing.pdf'])('protects legacy and output %s occupants in the compatibility guard', suffix => {
  const {directory} = fixture('Example.FCStd'), drawing = path.join(directory, 'Example.Drawing.FCStd');
  fs.writeFileSync(path.join(directory, `Example.${suffix}`), 'do not overwrite'); expect(() => assertDrawingOutputsAbsent(drawing)).toThrow(/占位/);
 });
 it('protects NFC/case aliases and refuses unsafe, non-NFC and overlong output basenames', () => {
  const {root, source} = fixture('1357.004-Café.FCStd'), plan = planDrawingOutputs(source, {workspace: root});
  fs.writeFileSync(path.join(path.dirname(plan.notes), path.basename(plan.notes).normalize('NFD').toUpperCase()), 'protected alias'); expect(() => assertDrawingOutputPlanAbsent(plan)).toThrow(/占位/);
  for (const stem of ['CON', 'Unsafe?', 'Cafe\u0301']) { const sample = fixture(`${stem}.FCStd`); expect(() => planDrawingOutputs(sample.source, {workspace: sample.root})).toThrow(/文件名/); }
  const long = fixture(`1357.004-${'A'.repeat(235)}.FCStd`); expect(() => planDrawingOutputs(long.source, {workspace: long.root})).toThrow(/255|名称/);
 });
 it('does not follow a linked source, source parent, or occupied dangling target', () => {
  const {root, source, directory} = fixture(), linked = path.join(directory, 'Example.FCStd'); fs.symlinkSync(source, linked);
  expect(() => planDrawingOutputs(linked, {workspace: root})).toThrow(/别名/);
  fs.symlinkSync(directory, path.join(root, 'alias')); expect(() => planDrawingOutputs(path.join(root, 'alias', path.basename(source)), {workspace: root})).toThrow(/别名/);
  const plan = planDrawingOutputs(source, {workspace: root}); fs.symlinkSync(path.join(root, 'missing-target'), plan.notes); expect(() => assertDrawingOutputPlanAbsent(plan)).toThrow(/占位/);
 });
 it('fails a race after initial allocation rather than silently selecting a different draft', () => {
  const {root, source} = fixture(), first = planDrawingOutputs(source, {workspace: root}), original = companionFilesystem.listDirectory; let injected = false;
  vi.spyOn(companionFilesystem, 'listDirectory').mockImplementation((...args) => { const value = original(...args); if (!injected) { injected = true; fs.writeFileSync(first.notes, 'racing occupant'); } return value; });
  expect(() => planDrawingOutputs(source, {workspace: root})).toThrow(/占位/); expect(injected).toBe(true);
  expect(fs.readdirSync(path.dirname(source)).some(name => name.includes('初稿02'))).toBe(false); expect(fs.readFileSync(first.notes, 'utf8')).toBe('racing occupant');
 });
 it('maps owned stage IDs to the same three suffixes without requiring a CAD identity or filesystem reads', () => {
  expect(drawingOutputPaths('/isolated/.synthetic-id.Drawing.FCStd')).toEqual(['/isolated/.synthetic-id.Drawing.FCStd', '/isolated/.synthetic-id.Drawing.pdf', '/isolated/.synthetic-id-出图说明.md']);
 });
});
