/** Explicit isolated proof only; never accepts an existing workspace/CAD file.
 * Inject a pinned candidate resource into THIS process, then run with --allow-native.
 * No resource location, receipt, generated image or CAD is stored in the repository.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {inflateSync} from 'node:zlib';
import {loadPinnedResource} from '../src/features/freecad-mcp/resource.js';
import {withOwnedThumbnailWorker} from '../src/features/freecad-mcp/worker-session.js';
import type {ThumbnailWorkerClient,ThumbnailWorkerJobInput} from '../src/features/freecad-mcp/worker-client.js';
import {publishWorkerThumbnail} from '../src/features/freecad-mcp/thumbnail-publication.js';
import {resolveFreecadGuiRuntime} from '../src/lib/freecadGuiRuntime.js';
import {thumbnailBytes} from '../src/features/part-gallery/service.js';
import {createSyntheticGuiThumbnailFixtures} from './thumbnail-worker-fixtures.js';

const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const SOURCES=['server/scripts/verify-thumbnail-worker.ts','server/scripts/thumbnail-worker-fixtures.ts',
  ...['resource','worker-session','worker-client','worker-png','thumbnail-publication'].map(name=>`server/src/features/freecad-mcp/${name}.ts`),
  'server/src/features/drawing-research/executionGate.ts','server/src/features/cad-native-measurement/host-barrier.ts'];
function sourceHashes(){const repo=fileURLToPath(new URL('../../',import.meta.url));return Object.fromEntries(SOURCES.map(rel=>[rel,sha(fs.readFileSync(path.join(repo,rel)))]));}
function assert(condition:unknown,code:string):asserts condition{if(!condition)throw Object.assign(new Error('Independent thumbnail workflow not verified'),{code});}
// Verification-only visual guard for THESE white-background primitive fixtures;
// never a universal promise that structurally valid PNGs depict correct CAD.
function hasFixturePixels(png:Buffer){
  const width=png.readUInt32BE(16),height=png.readUInt32BE(20),bpp=png[25]===6?4:3,parts:Buffer[]=[];
  for(let offset=8;offset<png.length;){const length=png.readUInt32BE(offset);if(png.toString('ascii',offset+4,offset+8)==='IDAT')parts.push(png.subarray(offset+8,offset+8+length));offset+=length+12;}
  const stride=width*bpp,raw=inflateSync(Buffer.concat(parts),{maxOutputLength:(stride+1)*height}),pixels=Buffer.alloc(stride*height);
  const paeth=(a:number,b:number,c:number)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  let visible=0;
  for(let y=0;y<height;y++){
    const filter=raw[y*(stride+1)];
    for(let x=0;x<stride;x++){
      const at=y*stride+x,a=x>=bpp?pixels[at-bpp]:0,b=y?pixels[at-stride]:0,c=y&&x>=bpp?pixels[at-stride-bpp]:0;
      pixels[at]=(raw[y*(stride+1)+1+x]+(filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):filter===4?paeth(a,b,c):0))&255;
    }
    for(let x=0;x<stride;x+=bpp)if((bpp===3||pixels[y*stride+x+3]>0)&&Math.min(...pixels.subarray(y*stride+x,y*stride+x+3))<240)visible++;
  }
  return visible>width*height/100;
}
async function completed(client:ThumbnailWorkerClient,input:ThumbnailWorkerJobInput){
  let job;
  try{job=await client.render(input);}catch(error){
    assert(['worker_timeout','BRIDGE_TIMEOUT','CONNECTION_FAILED'].includes(String((error as {code?:string})?.code)),'render_not_accepted');
    job=await client.get(input); // Same identity only; never resubmit the render.
  }
  const deadline=Date.now()+120_000;
  while(!['done','failed','cancelled'].includes(job.state)){
    assert(Date.now()<deadline,'job_observation_timeout');await delay(100);job=await client.get(input);
  }
  assert(job.state==='done'&&job.result&&job.input_revision,'job_not_completed');return job;
}
export async function verifyThumbnailWorker(){
  assert(process.env.PHOENIX_FREECAD_MCP_RESOURCE_MANIFEST&&process.env.PHOENIX_FREECAD_MCP_RESOURCE_SHA256,'explicit_candidate_required');
  const sources=sourceHashes(),loaded=loadPinnedResource();assert(loaded.state==='ready','candidate_not_verified');
  const runtime=resolveFreecadGuiRuntime();
  const seeded=await createSyntheticGuiThumbnailFixtures({executable:runtime.executable});
  assert(seeded.receipt.state==='seeded'&&seeded.receipt.gui_documents_verified&&seeded.proof.actual_close_observed&&seeded.proof.exit_code===0,'fixture_not_verified');
  const workspace=seeded.directory,rels=['Plate.FCStd','Spacer.FCStd'];
  const before=Object.fromEntries(rels.map(rel=>[rel,sha(fs.readFileSync(path.join(workspace,rel)))]));
  const artifact=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'desk-worker-proof-')));fs.chmodSync(artifact,0o700);
  const checks:Record<string,boolean>={},closed:unknown[]=[],jobs:unknown[]=[],imageHashes:string[]=[];
  let identity:unknown,frozenRoot='';
  const profile=path.join(artifact,'Worker');
  try { await withOwnedThumbnailWorker({resource:loaded.resource,profile,executable:runtime.executable,forbidden_roots:[workspace]},async session=>{
    identity=session.identity;
    frozenRoot=path.dirname(path.dirname(fs.realpathSync(path.join(profile,'Mod','PhoenixFreeCADTools'))));
    const initial=await session.client.status();checks.worker_has_fixed_isolated_scope=initial.state==='ready'&&initial.saves_cad===false&&initial.render_profile==='native-isometric-white-v1';
    for(const rel of rels){
      const input={jobId:randomUUID(),file:path.join(workspace,rel),expectedSha256:before[rel],width:128,height:128};
      const job=await completed(session.client,input),image=job.result!,revision=job.input_revision!;
      checks[`nonblank_${rel.split('.')[0].toLowerCase()}`]=hasFixturePixels(image.png);imageHashes.push(image.sha256);
      assert(job.worker_id===session.identity.workerId&&job.session_id===session.identity.sessionId,'job_identity_changed');
      const published=await publishWorkerThumbnail({workspacePath:workspace,filePath:rel,expectedSourceSha256:before[rel],
        worker:{workerId:session.identity.workerId,sessionId:session.identity.sessionId,jobId:input.jobId},
        inputRevision:revision,renderProfile:'native-isometric-white-v1',
        image:{png:image.png,sha256:image.sha256,bytes:image.bytes,width:image.width,height:image.height},
        cameraRestored:image.camera_restored,documentsClosed:image.documents_closed,savedCad:image.saved_cad,workerReusable:image.worker_reusable});
      assert(published.status==='published'&&published.registered===true&&published.sourceWritten===false,'external_cache_not_published');
      checks[`cache_matches_${rel.split('.')[0].toLowerCase()}`]=sha(thumbnailBytes(workspace,rel))===image.sha256;
      const again=await session.client.get(input);checks[`same_job_observed_${rel.split('.')[0].toLowerCase()}`]=again.state==='done'&&again.result?.sha256===image.sha256;
      const ready=await session.client.status();assert(ready.state==='ready'&&ready.active_job_id===null,'worker_not_reusable');
      jobs.push({rel,input,job:{...job,result:{...image,png:undefined}},published});
    }
    checks.same_worker_session_for_both_files=true;
    checks.independent_geometries_have_different_images=new Set(imageHashes).size===rels.length;
    const cancelledInput={jobId:randomUUID(),file:path.join(workspace,rels[0]),expectedSha256:before[rels[0]],width:128,height:128};
    await session.client.render(cancelledInput);
    let cancelled=await session.client.cancel(cancelledInput),deadline=Date.now()+120_000;
    while(!['done','failed','cancelled'].includes(cancelled.state)){assert(Date.now()<deadline,'cancel_observation_timeout');await delay(100);cancelled=await session.client.get(cancelledInput);}
    checks.cancel_observed_terminal_without_replay=cancelled.state==='cancelled'||cancelled.state==='done';
    const final=await session.client.status();checks.final_worker_ready=final.state==='ready'&&final.active_job_id===null;
    checks.original_cad_bytes_unchanged_during_session=rels.every(rel=>sha(fs.readFileSync(path.join(workspace,rel)))===before[rel]);
    jobs.push({cancellation:{state:cancelled.state,cancel_requested:cancelled.cancel_requested}});
  },{onChildClose:(kind,proof)=>closed.push({kind,...proof,resource_present:!!frozenRoot&&fs.existsSync(frozenRoot)})});
  }catch(error){
    const fd=fs.openSync(path.join(artifact,'workflow-failure.json'),'wx',0o600);
    try{fs.writeFileSync(fd,JSON.stringify({sources,checks,identity,closed,jobs,workspace,
      resource:{digest:loaded.resource.digest,version:loaded.version},code:String((error as {code?:string})?.code??'unverified')},null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    throw Object.assign(error instanceof Error?error:new Error('Workflow not verified'),{artifact:path.basename(artifact)});
  }
  checks.both_actual_child_close_observed=closed.length===2&&closed.every(value=>!!value&&typeof value==='object')
    &&(closed[0] as {kind:string}).kind==='mcp'&&(closed[1] as {kind:string}).kind==='native'
    &&closed.every(value=>(value as {resource_present:boolean}).resource_present)
    &&(closed[1] as {pid:number}).pid===(identity as {nativePid:number}).nativePid
    &&(closed[0] as {pid:number}).pid!==(closed[1] as {pid:number}).pid;
  checks.resources_released_only_after_actual_closes=!!frozenRoot&&!fs.existsSync(frozenRoot);
  checks.original_cad_bytes_unchanged_after_close=rels.every(rel=>sha(fs.readFileSync(path.join(workspace,rel)))===before[rel]);
  const staging=path.join(profile,'runtime','thumbnail-input');
  checks.worker_staging_empty=!fs.existsSync(staging)||fs.readdirSync(staging).length===0;
  checks.production_sources_unchanged=JSON.stringify(sources)===JSON.stringify(sourceHashes());
  const receipt={state:Object.values(checks).every(Boolean)?'passed':'blocked',resource:{digest:loaded.resource.digest,version:loaded.version},sources,checks,identity,closed,jobs,seed:seeded.proof,workspace};
  const file=path.join(artifact,'workflow.json'),fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(receipt,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  if(receipt.state!=='passed')throw Object.assign(new Error('Independent thumbnail workflow not verified'),{code:'workflow_not_verified',artifact:path.basename(artifact)});
  return {state:receipt.state,checks,artifact:path.basename(artifact)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.slice(2).join(' ')!=='--allow-native'){console.error('Explicit --allow-native and pinned candidate environment are required. No existing CAD input is accepted.');process.exitCode=2;}
  else verifyThumbnailWorker().then(result=>console.log(JSON.stringify(result))).catch(error=>{const code=String(error?.code??'workflow_unverified'),artifact=String(error?.artifact??'');console.error(JSON.stringify({state:'blocked',code:/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(code)?code:'workflow_unverified',artifact:/^desk-worker-proof-[A-Za-z0-9-]+$/.test(artifact)?artifact:null}));process.exitCode=1;});
}
