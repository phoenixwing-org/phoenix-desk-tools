/** Read-only D0 CLI. No publisher, CAD engine, database or workspace migration. */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCadIdentity } from '../../shared/cad-companion/model.js';
import type { CompanionPurpose, CompanionRequest, ExplicitCompanionAlias } from '../../shared/cad-companion/contracts.js';
import { discoverCompanionDocuments, readCompanionText } from '../src/features/cad-companions/discovery.js';

const USAGE = `Read-only CAD companion inspection
  --workspace ABSOLUTE_DIRECTORY --source RELATIVE.FCStd --purpose model_notes|drawing_notes|development_doc
  [--drawing RELATIVE.Drawing.FCStd] [--source-node INTERNAL_NAME] [--name REVIEWED_NAME]
  [--draft-sequence POSITIVE_INTEGER] [--notes-dir RELATIVE_DIRECTORY]
  [--alias PURPOSE=RELATIVE.md]
Read one exact document instead:
  --workspace ABSOLUTE_DIRECTORY --read RELATIVE.md --sha256 EXPECTED_SHA256
No files are modified. Output is JSON on stdout. No CAD/GUI process is started.
`;
type Ports = { out(value: string): void; error(value: string): void };
const purposes = new Set<CompanionPurpose>(['model_notes', 'drawing_notes', 'development_doc', 'unknown']);
function options(args: string[]) {
  const single = new Map<string, string>(), directories: string[] = [], aliases: ExplicitCompanionAlias[] = [];
  const keys = new Set(['--workspace', '--source', '--purpose', '--drawing', '--source-node', '--name', '--draft-sequence', '--read', '--sha256']);
  if (args.length > 220) throw new Error('参数超过上限');
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error('参数需要明确值');
    if (key === '--notes-dir') { if (directories.length >= 5) throw new Error('说明目录超过上限'); directories.push(value); }
    else if (key === '--alias') {
      const split = value.indexOf('=');
      const purpose = value.slice(0, split) as CompanionPurpose;
      if (split < 1 || !purposes.has(purpose) || aliases.length >= 100) throw new Error('别名需要有效用途和相对路径');
      aliases.push({ purpose, rel: value.slice(split + 1) });
    } else {
      if (!keys.has(key) || single.has(key)) throw new Error('存在未知或重复参数');
      single.set(key, value);
    }
  }
  return { single, directories, aliases };
}
export async function runCompanionCli(args: string[], ports: Ports, signal?: AbortSignal): Promise<number> {
  try {
    if (args.length === 1 && args[0] === '--help') { ports.out(USAGE); return 0; }
    const { single, directories, aliases } = options(args), workspace = single.get('--workspace');
    if (!workspace) throw new Error('需要明确工作空间');
    if (single.has('--read')) {
      if (single.size !== 3 || directories.length || aliases.length || !single.has('--sha256')) throw new Error('文本读取与发现参数不能混用');
      const result = await readCompanionText(workspace, single.get('--read')!, single.get('--sha256')!, signal);
      ports.out(JSON.stringify(result, null, 2) + '\n'); return 0;
    }
    if (single.has('--sha256')) throw new Error('读取指纹仅用于明确文本读取');
    const source = single.get('--source'), purpose = single.get('--purpose') as CompanionPurpose;
    if (!source || !purposes.has(purpose)) throw new Error('需要明确源文件和文档用途');
    const sequence = single.get('--draft-sequence');
    if (sequence !== undefined && (!/^[1-9][0-9]{0,3}$/.test(sequence) || Number(sequence) > 9999)) throw new Error('初稿序号无效');
    const sourceNode = single.get('--source-node');
    if (sourceNode && !/^[A-Za-z_]\w{0,255}$/.test(sourceNode)) throw new Error('内部节点名无效');
    const request: CompanionRequest = {
      source_rel: source, identity: parseCadIdentity(path.posix.basename(source)), purpose,
      ...(single.has('--drawing') ? { drawing_rel: single.get('--drawing') } : {}),
      ...(sourceNode ? { source_node: sourceNode } : {}),
      ...(single.has('--name') ? { name_override: single.get('--name') } : {}),
      ...(sequence !== undefined ? { draft_sequence: Number(sequence) } : {}),
      ...(directories.length ? { notes_directories: directories } : {}),
      ...(aliases.length ? { explicit_aliases: aliases } : {}),
    };
    const result = await discoverCompanionDocuments(workspace, request, signal);
    ports.out(JSON.stringify(result, null, 2) + '\n');
    return result.status === 'conflict' || result.status === 'manual' ? 3 : 0;
  } catch (cause) {
    ports.error((cause instanceof Error ? cause.message : '文档检查失败') + '\n'); return 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.exitCode = await runCompanionCli(process.argv.slice(2), { out: value => process.stdout.write(value), error: value => process.stderr.write(value) }, controller.signal);
}
