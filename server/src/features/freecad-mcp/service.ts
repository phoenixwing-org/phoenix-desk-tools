import path from 'node:path';
import fs from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import type {FreecadMcpConnection, FreecadMcpInstallPlan, FreecadMcpInstallResult, FreecadMcpStatus} from '../../../../shared/freecad-mcp/contracts.js';
import {resolveFreecadGuiRuntime} from '../../lib/freecadGuiRuntime.js';
import {checkedDirectory, loadPinnedResource, withFrozenResource} from './resource.js';
import {applyInstall, inspectInstallation, prepareInstall, type FrozenInstallPlan} from './installation.js';
import {probeMcpStdio} from './stdio.js';
import {FreecadMcpError, FreecadMcpSettingsStore} from './settings.js';
import {OwnedWorkerManagerError} from './worker-manager.js';
import {ownedWorkerHost, type OwnedWorkerHost} from './worker-host.js';
import type {OwnedWorkerObservation} from '../../../../shared/freecad-mcp/worker.js';

const batchReason = 'Tools 已提供类型化 worker 生命周期；Desk 独立 worker 控制仅限宿主显式开启的候选测试，现有批量任务队列的版本化接线尚未完成，常驻批处理暂不开放。视觉与支持范围仍待验；不会接管用户实例或自动重放任务。';
const unchecked = (): FreecadMcpConnection => ({state: 'not_checked', phase: 'none', reason: '尚未通过正式 MCP 检查连接；磁盘安装不代表运行中已加载', bridge_version: null, supported_methods: [], mcp_verified: false});
const blocked = (reason: string): FreecadMcpConnection => ({...unchecked(), state: 'blocked', reason});
type Dependencies = {
  store: FreecadMcpSettingsStore; resource: typeof loadPinnedResource; inspect: typeof inspectInstallation;
  prepare: typeof prepareInstall; apply: typeof applyInstall; freeze: typeof withFrozenResource; probe: typeof probeMcpStdio;
  runtime: typeof resolveFreecadGuiRuntime; now: () => number;
  worker: OwnedWorkerHost; ownedWorkerTest: boolean; platform: NodeJS.Platform;
};
type Plan = {frozen: FrozenInstallPlan; revision: string; resourceDigest: string; expiry: number};

export class FreecadMcpManager {
  private readonly deps: Dependencies;
  private readonly plans = new Map<string, Plan>();
  private installing = false;
  private checking = false;
  private preparing = 0;
  private generation = 0;
  private staleWorkerId?: string;
  private observation?: {key: string; expires: number; value: FreecadMcpConnection};
  constructor(deps: Partial<Dependencies> = {}) {
    this.deps = {store: new FreecadMcpSettingsStore(), resource: loadPinnedResource, inspect: inspectInstallation,
      prepare: prepareInstall, apply: applyInstall, freeze: withFrozenResource, probe: probeMcpStdio,
      runtime: resolveFreecadGuiRuntime, now: Date.now, worker: ownedWorkerHost,
      ownedWorkerTest: process.env.PHOENIX_FREECAD_MCP_OWNED_WORKER_TEST === '1', platform: process.platform, ...deps};
  }
  private snapshot() {
    const saved = this.deps.store.read(), resource = this.deps.resource();
    return {...saved, resource, generation: this.generation, key: saved.revision + ':' + (resource.state === 'ready' ? resource.resource.digest : resource.state)};
  }
  private assertRevision(revision: unknown) {
    if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) throw new FreecadMcpError('invalid_revision', '配置版本无效');
    const current = this.snapshot();
    if (current.revision !== revision) throw new FreecadMcpError('settings_changed', '配置已变化，请重新检测', 409);
    return current;
  }
  private assertWorkerIdle(): void {
    if (this.deps.worker.status().owned) throw new FreecadMcpError('owned_worker_busy', '独立自有 worker 尚未实际关闭；请先显式停止，再更改配置、安装或检查已有实例', 409);
  }
  private workerRevision(current: ReturnType<FreecadMcpManager['snapshot']>, executable: string): string {
    return createHash('sha256').update(JSON.stringify([current.revision,
      current.resource.state === 'ready' ? current.resource.resource.digest : current.resource.state, executable])).digest('hex');
  }
  private workerControl(current: ReturnType<FreecadMcpManager['snapshot']>, executable: string | null): NonNullable<FreecadMcpStatus['owned_worker']> {
    let observation = this.deps.worker.status();
    const resource = current.resource.state === 'ready' ? current.resource.resource : undefined;
    const matching = executable !== null && observation.configuration_revision === this.workerRevision(current, executable)
      && observation.id !== this.staleWorkerId;
    // An old ready observation is not a capability for a changed resource or
    // runtime. Keep its UUID/ownership so it can still be explicitly stopped.
    if (observation.owned && !matching) {
      this.staleWorkerId = observation.id ?? undefined;
      observation = {...observation, phase: 'unknown', reason_code: 'session_not_reusable',
        message: '配置、固定资源或图形程序已变化；旧会话不再视为当前就绪，只允许停止原自有会话。'};
    }
    let reason: string | undefined;
    if (this.deps.worker.stopping) reason = '宿主正在退出，已停止接收新的自有 worker 启动。';
    else if (!observation.owned && (observation.phase === 'unknown' || observation.reason_code === 'cleanup_failed')) reason = '上次自有会话的关闭结果未确认；不会启动新会话、清理或切换持久门禁。';
    else if (!this.deps.ownedWorkerTest) reason = '宿主未显式开启独立 worker 候选测试，专用实例暂不开放；批量队列版本化接线尚未完成。';
    else if (this.deps.platform !== 'darwin') reason = '当前独立 worker 候选仅支持已验收的 macOS 图形程序启动路径。';
    else if (current.settings.mode !== 'owned_batch') reason = '请先显式选择工具专用实例模式；不会接管已有用户实例。';
    else if (current.resource.state !== 'ready') reason = current.resource.reason;
    else if (!resource || resource.addonDir !== 'addon/PhoenixFreeCADTools' || !resource.mcpEntry || !resource.files[resource.mcpEntry]
      || ['scripts/thumbnail-worker.mjs', 'scripts/dev-freecad.mjs', 'addon/PhoenixFreeCADTools/pft_thumbnail_worker.py'].some(name => !resource.files[name]))
      reason = '固定资源未包含完整独立 worker 入口与生命周期材料；不会从开发目录补齐。';
    else if (!executable || !path.isAbsolute(executable) || path.resolve(executable) !== executable || /\/Contents\/MacOS\/FreeCAD$/i.test(executable))
      reason = '未检测到可直接执行的 FreeCAD 图形程序，不能使用应用包装器或命令行程序代替。';
    else if (observation.owned && !matching) reason = observation.message;
    return {enabled: !reason, reason: reason ?? '独立 worker 候选控制已启用；须显式启动，仅提供自有会话控制，不执行批量 CAD 任务。视觉与支持范围仍待验。', observation};
  }
  private modDirectory(directory: string, confirmed: boolean): FreecadMcpStatus['mod_directory'] {
    const evidence = confirmed ? 'user_confirmed' as const : 'none' as const;
    if (!directory) return {state: 'unselected', evidence: 'none', reason: '请先在 FreeCAD 中核对其 Mod 目录，再填写确切绝对路径'};
    try {
      if (!path.isAbsolute(directory) || path.basename(directory).toLowerCase() !== 'mod' || directory === path.parse(directory).root) throw new Error('unsafe');
      try { fs.lstatSync(directory); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {state: 'missing', evidence, reason: '所选 Mod 目录不存在；不会自动创建或猜测其他用户目录'};
        throw error;
      }
      checkedDirectory(directory);
      return {state: 'filesystem_checked', evidence, reason: confirmed
        ? '仅核验了确切目录与用户确认；不代表当前 FreeCAD 正在使用或已加载插件'
        : '目录安全检查通过；安装前仍须确认这是 FreeCAD 使用的 Mod 目录'};
    } catch { return {state: 'unsafe', evidence, reason: '必须选择已存在、不经符号链接的确切 Mod 目录；未进行修改'}; }
  }
  status(): FreecadMcpStatus {
    const current = this.snapshot(), mod = this.modDirectory(current.settings.mod_directory, current.settings.mod_directory_confirmed);
    let freecad: FreecadMcpStatus['freecad'];
    try { const runtime = this.deps.runtime(); freecad = {state: 'available', executable: runtime.executable, reason: '仅检测到可执行文件；不代表插件、连接或批处理就绪'}; }
    catch { freecad = {state: 'unavailable', executable: null, reason: '未检测到 FreeCAD 图形程序；可在安装目录设置中配置'}; }
    const installation = mod.state === 'filesystem_checked' ? this.deps.inspect(current.settings.mod_directory).installation
      : {state: 'not_checked' as const, version: null, reason: '未检查其他目录或用户配置'};
    const {state, version, reason} = current.resource;
    const connection = this.observation?.key === current.key && this.observation.expires > this.deps.now() ? this.observation.value : unchecked();
    return structuredClone({schema_version: 1, revision: current.revision, settings: current.settings, freecad, mod_directory: mod,
      installation, resource: {state, version, reason}, connection, batch: {state: 'blocked', reason: batchReason}, owned_worker: this.workerControl(current, freecad.executable)});
  }
  save(settings: unknown, expectedRevision: unknown): FreecadMcpStatus {
    this.assertWorkerIdle();
    if (this.installing) throw new FreecadMcpError('install_busy', '安装处理中，暂不能更改配置', 409);
    this.deps.store.save(settings, expectedRevision); ++this.generation; this.plans.clear(); this.observation = undefined;
    return this.status();
  }
  async preview(revision: unknown): Promise<FreecadMcpInstallPlan> {
    this.assertWorkerIdle();
    const current = this.assertRevision(revision);
    if (this.installing) throw new FreecadMcpError('install_busy', '安装处理中，请稍后重新检测', 409);
    if (current.resource.state !== 'ready') return {state: 'blocked', reason: current.resource.reason};
    const mod = this.modDirectory(current.settings.mod_directory, current.settings.mod_directory_confirmed);
    if (mod.state !== 'filesystem_checked' || mod.evidence !== 'user_confirmed') return {state: 'blocked', reason: mod.reason};
    const inspection = this.deps.inspect(current.settings.mod_directory);
    if (!['absent', 'managed'].includes(inspection.installation.state)) return {state: 'blocked', reason: inspection.installation.reason};
    let frozen: FrozenInstallPlan;
    ++this.preparing;
    try { frozen = await this.deps.prepare(current.resource.resource, current.settings.mod_directory); }
    catch { throw new FreecadMcpError('install_preview_failed', '安装资源或插件目录未通过预览核验；未执行安装', 409); }
    finally { --this.preparing; }
    const after = this.snapshot();
    if (after.key !== current.key || after.generation !== current.generation) throw new FreecadMcpError('settings_changed', '配置或资源已变化，请重新预览', 409);
    for (const [id, plan] of this.plans) if (plan.expiry <= this.deps.now()) this.plans.delete(id);
    while (this.plans.size >= 16) this.plans.delete(this.plans.keys().next().value!);
    const id = randomUUID(), expiry = this.deps.now() + 5 * 60_000;
    this.plans.set(id, {frozen, revision: current.revision, resourceDigest: current.resource.resource.digest, expiry});
    return structuredClone({...frozen.preview, plan_id: id, expires_at: new Date(expiry).toISOString()});
  }
  async apply(id: unknown, confirmed: unknown): Promise<FreecadMcpInstallResult> {
    this.assertWorkerIdle();
    if (confirmed !== true || typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new FreecadMcpError('confirmation_required', '请显式确认本次安装预览');
    if (this.installing || this.checking) throw new FreecadMcpError('install_busy', '安装或连接检查正在处理，请等待结束后重新检测', 409);
    const plan = this.plans.get(id); this.plans.delete(id); // One explicit attempt; never silently replay a possible write.
    if (!plan || plan.expiry <= this.deps.now()) throw new FreecadMcpError('plan_expired', '计划已使用或过期，请重新检测并预览', 409);
    const current = this.assertRevision(plan.revision);
    if (current.resource.state !== 'ready' || current.resource.resource.digest !== plan.resourceDigest)
      throw new FreecadMcpError('resource_changed', '资源已变化，请重新预览', 409);
    this.installing = true; ++this.generation; this.observation = undefined; this.plans.clear();
    try {
      const result = await this.deps.apply(plan.frozen);
      return {...result, restart_required: result.state === 'installed', status: this.status()};
    } catch { throw new FreecadMcpError('outcome_unknown', '未能确认安装最终结果；请重新检测磁盘与连接，不要自动重试。未重启 FreeCAD。', 503); }
    finally { this.installing = false; }
  }
  async check(revision: unknown, signal?: AbortSignal): Promise<FreecadMcpConnection> {
    this.assertWorkerIdle();
    const current = this.assertRevision(revision);
    if (this.checking || this.installing) throw new FreecadMcpError('connection_busy', '检查或安装正在进行，请稍后再试', 409);
    let result: FreecadMcpConnection;
    if (current.settings.mode !== 'existing') result = blocked('此检查仅检测显式选择的已有实例；Desk 专用 worker 候选需另行显式启动，批量队列接线尚未完成。未启动实例，也不会连接用户的默认端口');
    else if (current.resource.state !== 'ready') result = blocked(current.resource.reason);
    else if (!current.resource.resource.mcpEntry) result = blocked('可信资源不含正式 MCP stdio 入口，未使用桥接端口冒充连接成功');
    else {
      this.checking = true;
      try {
        const resource = current.resource.resource;
        result = await this.deps.freeze(resource, async frozen => {
          if (!frozen.mcpEntry) return blocked('可信资源缺少 MCP stdio 入口');
          return this.deps.probe({entry: frozen.mcpEntry, entry_sha256: createHash('sha256').update(fs.readFileSync(frozen.mcpEntry)).digest('hex'),
            port: current.settings.existing_port, signal});
        });
      } catch { result = {...unchecked(), state: 'failed', reason: '正式 MCP 检查未完成；未对 CAD 执行写入，也未重试'}; }
      finally { this.checking = false; }
    }
    const after = this.snapshot();
    if (after.key !== current.key || after.generation !== current.generation || signal?.aborted) throw new FreecadMcpError('check_stale', '检查已取消或配置、资源已变化，请重新检测', 409);
    this.observation = {key: current.key, expires: this.deps.now() + 30_000, value: structuredClone(result)};
    return result;
  }
  start(revision: unknown, confirmed: unknown): OwnedWorkerObservation {
    const current = this.assertRevision(revision);
    if (confirmed !== true) throw new FreecadMcpError('confirmation_required', '必须显式确认启动');
    this.assertWorkerIdle();
    if (this.checking || this.installing || this.preparing) throw new FreecadMcpError('owned_worker_busy', '安装、预览或连接检查正在处理，不能同时启动自有 worker', 409);
    let executable: string | null = null;
    try { executable = this.deps.runtime().executable; } catch { /* Safe disabled reason below. */ }
    const control = this.workerControl(current, executable);
    if (!control.enabled || !executable || current.resource.state !== 'ready') throw new FreecadMcpError('missing_task_lifecycle', control.reason, 409);
    try {
      const result = this.deps.worker.start({resource: current.resource.resource, executable, configurationRevision: this.workerRevision(current, executable)});
      ++this.generation; this.plans.clear(); this.observation = undefined;
      return result;
    } catch (error) { return this.workerError(error); }
  }
  async stop(id: unknown, confirmed: unknown): Promise<OwnedWorkerObservation> {
    if (confirmed !== true) throw new FreecadMcpError('confirmation_required', '必须显式确认停止本次自有会话');
    if (typeof id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) throw new FreecadMcpError('invalid_session_id', '仅接受本次管理器的会话 UUID，不接受 PID、URL 或程序路径');
    let result: OwnedWorkerObservation;
    try { result = await this.deps.worker.stop(id); }
    catch (error) { return this.workerError(error); }
    if (result.owned || result.phase === 'unknown' || result.reason_code === 'cleanup_failed')
      throw new FreecadMcpError('owned_worker_close_unknown', '原自有会话的关闭结果未确认；请读取原会话观察，不要重试启动或切换持久门禁', 503);
    return result;
  }
  private workerError(error: unknown): never {
    if (error instanceof OwnedWorkerManagerError) throw new FreecadMcpError(error.code, error.message, 409);
    throw new FreecadMcpError('owned_worker_operation_failed', '自有 worker 操作未确认完成；请读取原会话状态，不要自动重试或接管其他实例', 503);
  }
}
