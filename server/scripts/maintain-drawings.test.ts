import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
const ports=vi.hoisted(()=>({registry:vi.fn(),configure:vi.fn(),plan:vi.fn(),apply:vi.fn()}));
vi.mock('../src/lib/deskToolsRegistration.js',()=>({deskToolsRegistrationDirectory:ports.registry}));
vi.mock('../src/features/drawing-research/executionGate.js',()=>({configureDrawingExecutionBarrier:ports.configure}));
vi.mock('../src/features/drawing-research/maintenance.js',()=>({planMaintenance:ports.plan,applyMaintenance:ports.apply}));
import {runMaintenanceCli} from './maintain-drawings.js';
const roots:string[]=[];
afterEach(()=>{vi.resetAllMocks();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'independent-maintenance-cli-'));roots.push(root);
 const manifest=path.join(root,'manifest.json'),report=path.join(root,'report.json'),registry=path.join(root,'host-registry');
 fs.writeFileSync(manifest,JSON.stringify([{workspace:path.join(root,'workspace'),rel:'Example.Drawing.FCStd'}]));
 ports.registry.mockReturnValue(registry);ports.plan.mockReturnValue({rel:'Example.Drawing.FCStd'});ports.apply.mockResolvedValue({status:'completed'});
 return {manifest,report,registry};
}
it('preview does not initialize a native scope or apply a plan',async()=>{
 const f=fixture();expect(await runMaintenanceCli([f.manifest,'--preview',f.report])).toBe(0);
 expect(ports.registry).not.toHaveBeenCalled();expect(ports.configure).not.toHaveBeenCalled();expect(ports.apply).not.toHaveBeenCalled();
 expect(JSON.parse(fs.readFileSync(f.report,'utf8'))).toHaveLength(1);
});
it('apply configures the ordinary server host scope before any plan or native write',async()=>{
 const f=fixture();expect(await runMaintenanceCli([f.manifest,'--apply',f.report])).toBe(0);
 expect(ports.configure).toHaveBeenCalledExactlyOnceWith(path.join(f.registry,'native-freecad-v1'));
 expect(ports.configure.mock.invocationCallOrder[0]).toBeLessThan(ports.plan.mock.invocationCallOrder[0]);
 expect(ports.configure.mock.invocationCallOrder[0]).toBeLessThan(ports.apply.mock.invocationCallOrder[0]);
 expect(fs.lstatSync(f.registry).isDirectory()).toBe(true);
});
it('fails closed on unavailable host configuration, without planning or applying',async()=>{
 const f=fixture();ports.configure.mockImplementation(()=>{throw new Error('host scope unavailable');});
 await expect(runMaintenanceCli([f.manifest,'--apply',f.report])).rejects.toThrow('host scope unavailable');
 expect(ports.plan).not.toHaveBeenCalled();expect(ports.apply).not.toHaveBeenCalled();expect(fs.existsSync(f.report)).toBe(false);
});
it('rejects a malformed manifest before creating any host scope',async()=>{
 const f=fixture();fs.writeFileSync(f.manifest,'{}');
 await expect(runMaintenanceCli([f.manifest,'--apply',f.report])).rejects.toThrow('must be an array');expect(ports.configure).not.toHaveBeenCalled();
});
