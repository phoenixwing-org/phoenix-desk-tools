import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {planMaintenance,applyMaintenance} from '../src/features/drawing-research/maintenance.js';
import {configureDrawingExecutionBarrier} from '../src/features/drawing-research/executionGate.js';
import {deskToolsRegistrationDirectory} from '../src/lib/deskToolsRegistration.js';

export async function runMaintenanceCli(args:string[]):Promise<number>{
 const [manifest,mode,report]=args;
 if(!manifest||!['--preview','--apply'].includes(mode)||!report||args.length!==3)throw new Error('Usage: tsx scripts/maintain-drawings.ts manifest.json --preview|--apply result.json');
 const inputs=JSON.parse(fs.readFileSync(manifest,'utf8'));
 if(!Array.isArray(inputs))throw new Error('Maintenance manifest must be an array');
 if(mode==='--apply'){
  // The same fixed host scope as server.ts, never a manifest/workspace/PID scope.
  const registry=deskToolsRegistrationDirectory();
  fs.mkdirSync(registry,{recursive:true,mode:0o700});
  configureDrawingExecutionBarrier(path.join(registry,'native-freecad-v1'));
 }
 const results=[];
 for(const input of inputs){
  try{const plan=planMaintenance(input);const result=mode==='--apply'?await applyMaintenance(plan):plan;results.push({rel:input.rel,status:'completed',result});}
  catch(e){results.push({rel:input.rel,status:'failed',error:e instanceof Error?e.message:String(e)});}
  fs.writeFileSync(report,JSON.stringify(results,null,2)+'\n');
  console.log(results.length+'/'+inputs.length,results.at(-1)?.status,input.rel);
 }
 return results.some(r=>r.status==='failed')?1:0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=await runMaintenanceCli(process.argv.slice(2));
