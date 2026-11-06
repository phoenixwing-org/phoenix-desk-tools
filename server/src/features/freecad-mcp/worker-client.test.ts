import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {deflateSync} from 'node:zlib';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {connectThumbnailWorkerClient,type OwnedWorkerMcpProcess,type ThumbnailWorkerJobInput} from './worker-client.js';

// Independently constructed protocol peer and RGB PNG pixels: no processes,
// sockets, installed resources, CAD files or provider fixtures are used.
const IDS={workerId:'11111111-1111-4111-8111-111111111111',sessionId:'22222222-2222-4222-8222-222222222222'};
const JOB='33333333-3333-4333-8333-333333333333',NEXT='44444444-4444-4444-8444-444444444444',SHA='a'.repeat(64);
const input:ThumbnailWorkerJobInput={jobId:JOB,file:'/synthetic/literal `$(not-run)` "sample".FCStd',expectedSha256:SHA,width:2,height:2};
const digest=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
function png(width=2,height=2){
 const chunk=(kind:string,data=Buffer.alloc(0))=>{
  const body=Buffer.concat([Buffer.from(kind),data]),out=Buffer.alloc(body.length+8);out.writeUInt32BE(data.length);body.copy(out,4);
  let crc=0xffffffff;for(const value of body){crc^=value;for(let bit=0;bit<8;bit++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;
 };
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 const row=width*3+1,raw=Buffer.alloc(row*height);for(let n=0;n<raw.length;n++)raw[n]=n%row? n*17&255:0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw,{level:0})),chunk('IEND')]);
}
const status=()=>({schema_version:1,worker_id:IDS.workerId,session_id:IDS.sessionId,state:'ready',active_job_id:null,saves_cad:false,
 render_profile:'native-isometric-white-v1',supported_file_scope:'trusted-native-self-contained',jobs_retained:20,max_jobs:256,max_input_bytes:67108864,max_png_bytes:4194304,
 dimensions:{max_width:1024,max_height:1024,max_pixels:1048576}});
function job(state='queued',jobId=JOB,image=png()){
 return {schema_version:1,worker_id:IDS.workerId,session_id:IDS.sessionId,job_id:jobId,state,phase:state,cancel_requested:state==='cancelled',
  input_revision:state==='queued'?null:{sha256:SHA,bytes:1234},result:state==='done'?{png_base64:image.toString('base64'),sha256:digest(image),width:image.readUInt32BE(16),height:image.readUInt32BE(20),bytes:image.length,
   camera_restored:true,documents_closed:true,saved_cad:false,worker_reusable:true,render_profile:'native-isometric-white-v1'}:null,error:state==='failed'?{code:'WORKER_JOB_FAILED',message:'Synthetic provider diagnostic'}:null};
}
const success=(data:unknown)=>({structuredContent:{ok:true,source_kind:'isolated_thumbnail_worker',data},
 content:[{type:'text',text:JSON.stringify({summary:'Neutral summary, not an equal payload',png_base64:'[available in structuredContent]'})}]});
const tools=()=>['get_thumbnail_worker_status','render_document_thumbnail','get_thumbnail_job','cancel_thumbnail_job'].map((name,index)=>{
 const fields=index===0?[]:index===1?['workerId','sessionId','jobId','file','expectedSha256','width','height']:['workerId','sessionId','jobId'];
 const properties=Object.fromEntries(fields.map(field=>[field,field==='width'||field==='height'?{type:'integer',minimum:1,maximum:1024,default:512}:
  {type:'string',...(field==='file'?{minLength:1,maxLength:4096}:field==='expectedSha256'?{pattern:'^[a-f0-9]{64}$'}:{pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'})}]));
 return {name,inputSchema:{type:'object',properties,additionalProperties:false,required:fields.filter(field=>!['width','height'].includes(field))},
  annotations:{readOnlyHint:index===0||index===2,destructiveHint:false,idempotentHint:true,openWorldHint:false}};
});
type Rpc={jsonrpc:string;id?:number;method:string;params?:Record<string,any>};
type FakeChild=EventEmitter&{stdin:PassThrough;stdout:PassThrough;stderr:PassThrough;kill:ReturnType<typeof vi.fn>};
interface Peer {
 child:FakeChild;owned:OwnedWorkerMcpProcess;calls:Rpc[];
 state:{status:any;job:unknown;toolList:any[];initialize:any};
 reply(id:number,value:unknown):boolean;handle(request:Rpc):unknown;
}
const peers:Peer[]=[];
function peer():Peer {
 const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn()});
 let resolve!:()=>void;const closed=new Promise<void>(done=>{resolve=done;});child.once('close',()=>resolve());
 const owned:OwnedWorkerMcpProcess={child:child as unknown as ChildProcessWithoutNullStreams,closed,close:vi.fn(async()=>{await closed;})};
 const calls:Rpc[]=[],state={status:status() as any,job:undefined as unknown,toolList:tools() as any[],initialize:{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'phoenix-freecad-mcp',version:'0.3.2'}} as any};
 const reply=(id:number,value:unknown)=>child.stdout.write(Buffer.from(JSON.stringify({jsonrpc:'2.0',id,result:value})+'\n'));
 const fixture:Peer={child,owned,calls,state,reply,handle:(request:Rpc):unknown=>{
  if(request.method==='initialize')return state.initialize;
  if(request.method==='tools/list')return {tools:state.toolList};
  if(request.method==='tools/call')return success(request.params?.name==='get_thumbnail_worker_status'?state.status:state.job??job('queued',request.params?.arguments.jobId));
 }};
 let buffer='';child.stdin.on('data',chunk=>{buffer+=String(chunk);let end:number;while((end=buffer.indexOf('\n'))!==-1){
  const request=JSON.parse(buffer.slice(0,end)) as Rpc;buffer=buffer.slice(end+1);calls.push(request);
  if(request.id!==undefined){const result=fixture.handle(request);if(result!==undefined)reply(request.id,result);}
 }});
 peers.push(fixture);return fixture;
}
async function connect(f=peer(),options:{timeout_ms?:number;signal?:AbortSignal}={}){
 const client=await connectThumbnailWorkerClient({process:f.owned,identity:IDS,...options});return {f,client};
}
afterEach(()=>{for(const f of peers.splice(0))f.child.emit('close',0);vi.useRealTimers();});

describe('owned-only thumbnail worker MCP client',()=>{
 it('uses the fixed handshake and four literal methods without process ownership actions',async()=>{
  const {f,client}=await connect();expect(await client.status()).toEqual(status());
  expect((await client.render(input)).state).toBe('queued');
  f.state.job={...job('opening'),cancel_requested:true};expect((await client.cancel(input)).cancel_requested).toBe(true);
  f.state.job={...job('done'),cancel_requested:true};const done=await client.get(input);
  expect(done.result?.png).toEqual(png());expect(done.result).not.toHaveProperty('png_base64');expect(done.result?.documents_closed).toBe(true);
  expect(f.calls.map(call=>call.method)).toEqual(['initialize','notifications/initialized','tools/list','tools/call','tools/call','tools/call','tools/call']);
  expect(f.calls[0].params).toMatchObject({protocolVersion:'2025-11-25',capabilities:{}});
  expect(f.calls.slice(3).map(call=>call.params)).toEqual([
   {name:'get_thumbnail_worker_status',arguments:{}},
   {name:'render_document_thumbnail',arguments:{...IDS,...input}},
   {name:'cancel_thumbnail_job',arguments:{...IDS,jobId:JOB}},
   {name:'get_thumbnail_job',arguments:{...IDS,jobId:JOB}},
  ]);
  expect(f.child.kill).not.toHaveBeenCalled();expect(f.owned.close).not.toHaveBeenCalled();
 });
 it('validates one large PNG only in structuredContent and accepts the smaller text summary',async()=>{
  const {f,client}=await connect();const image=png(1024,1024);expect(image.length).toBeGreaterThan(3*1024*1024);
  f.state.job=job('done',JOB,image);const done=await client.get({...input,width:1024,height:1024});expect(done.result?.png.equals(image)).toBe(true);
 });
 it('defaults dimensions to 512 and never dispatches before status proves readiness',async()=>{
  const {f,client}=await connect();await expect(client.render(input)).rejects.toMatchObject({code:'worker_not_ready'});
  await client.status();await client.render({jobId:JOB,file:input.file,expectedSha256:SHA});
  expect(f.calls.at(-1)?.params?.arguments).toMatchObject({width:512,height:512});
 });
 it.each(['protocol','version','server','capability','missing','extra','duplicate','write','schema','required','dimension','pattern'])('rejects incompatible %s handshake/tool contracts',async mode=>{
  const f=peer();
  if(mode==='protocol')f.state.initialize.protocolVersion='2099-01-01';if(mode==='version')f.state.initialize.serverInfo.version='0.3.3';
  if(mode==='server')f.state.initialize.serverInfo.name='untrusted';if(mode==='capability')f.state.initialize.capabilities.resources={};
  if(mode==='missing')f.state.toolList.pop();if(mode==='extra')f.state.toolList.push({...f.state.toolList[0],name:'execute_script'});
  if(mode==='duplicate')f.state.toolList[3]=f.state.toolList[0];if(mode==='write')f.state.toolList[0].annotations.readOnlyHint=false;
  if(mode==='schema')f.state.toolList[0].inputSchema.additionalProperties=true;if(mode==='required')f.state.toolList[1].inputSchema.required.push('width');
  if(mode==='dimension')f.state.toolList[1].inputSchema.properties.width.maximum=2048;if(mode==='pattern')f.state.toolList[1].inputSchema.properties.jobId.pattern='.*';
  await expect(connect(f)).rejects.toMatchObject({name:'ThumbnailWorkerClientError'});expect(f.calls.every(call=>call.method!=='tools/call')).toBe(true);
 });
 it.each([{jobId:'opaque'},{file:'relative.FCStd'},{file:'/synthetic/\u0000.FCStd'},{expectedSha256:'A'.repeat(64)},{width:0},{height:1025},{width:2.5},{workerId:IDS.workerId}])('rejects invalid public arguments without a wire call: %j',async patch=>{
  const {f,client}=await connect();await client.status();const count=f.calls.length;
  await expect(client.render({...input,...patch})).rejects.toMatchObject({code:'worker_invalid_argument'});expect(f.calls).toHaveLength(count);
 });
 it.each([{session_id:JOB},{worker_id:JOB},{state:'busy'},{active_job_id:JOB},{saves_cad:true},{max_jobs:257},{jobs_retained:21},{dimensions:{max_width:2048,max_height:1024,max_pixels:1048576}},{extra:true}])('rejects full-status identity/state/budget drift: %j',async patch=>{
  const {f,client}=await connect();f.state.status={...status(),...patch};await expect(client.status()).rejects.toMatchObject({code:'worker_invalid_response'});
 });
 it.each(['identity','phase','source','revision','result','error','camera','closed','saved','reuse','profile','base64','sha','dimensions','crc'])('rejects invalid job proof: %s',async mode=>{
  const {f,client}=await connect();const value:any=job('done');
  if(mode==='identity')value.session_id=JOB;if(mode==='phase')value.phase='closing';if(mode==='source')value.input_revision.sha256='b'.repeat(64);
  if(mode==='revision')value.input_revision=null;if(mode==='result')value.result=null;if(mode==='error')value.error={code:'WORKER_JOB_FAILED',message:'Synthetic'};
  if(mode==='camera')value.result.camera_restored=false;if(mode==='closed')value.result.documents_closed=false;if(mode==='saved')value.result.saved_cad=true;
  if(mode==='reuse')value.result.worker_reusable=false;if(mode==='profile')value.result.render_profile='arbitrary';if(mode==='base64')value.result.png_base64+='\n';
  if(mode==='sha')value.result.sha256='b'.repeat(64);if(mode==='dimensions')value.result.width=3;
  if(mode==='crc'){const bytes=png();bytes[bytes.length-1]^=1;value.result.png_base64=bytes.toString('base64');value.result.sha256=digest(bytes);}
  f.state.job=value;await expect(client.get(input)).rejects.toMatchObject({code:'worker_invalid_response'});
 });
 it('binds job parameters, never repeats render, and waits for terminal cleanup/readiness before another ID',async()=>{
  const {f,client}=await connect();await client.status();await client.render(input);const count=f.calls.length;
  await expect(client.render(input)).rejects.toMatchObject({code:'worker_render_not_replayed'});
  await expect(client.get({...input,file:'/synthetic/other.FCStd'})).rejects.toMatchObject({code:'worker_job_conflict'});
  await expect(client.render({...input,jobId:NEXT})).rejects.toMatchObject({code:'worker_query_original_job'});expect(f.calls).toHaveLength(count);
  f.state.job=job('cancelled');await client.get(input);
  await expect(client.render({...input,jobId:NEXT})).rejects.toMatchObject({code:'worker_not_ready'});
  await client.status();f.state.job=job('queued',NEXT);await client.render({...input,jobId:NEXT});
  expect(f.calls.filter(call=>call.params?.name==='render_document_thumbnail')).toHaveLength(2);
 });
 it('keeps a timed-out render query-only for its original binding, but permits explicit same-job cancellation',async()=>{
  vi.useFakeTimers();const {f,client}=await connect(undefined,{timeout_ms:100});await client.status();
  const normal=f.handle;f.handle=request=>request.params?.name==='render_document_thumbnail'?undefined:normal(request);
  const running=client.render(input),rejected=expect(running).rejects.toMatchObject({code:'worker_timeout'});await vi.advanceTimersByTimeAsync(101);await rejected;
  const count=f.calls.length;await expect(client.render(input)).rejects.toMatchObject({code:'worker_query_original_job'});
  await expect(client.render({...input,jobId:NEXT})).rejects.toMatchObject({code:'worker_query_original_job'});
  await expect(client.get({...input,jobId:NEXT})).rejects.toMatchObject({code:'worker_query_original_job'});expect(f.calls).toHaveLength(count);
  await client.status();await expect(client.render({...input,jobId:NEXT})).rejects.toMatchObject({code:'worker_query_original_job'});
  f.state.job={...job('opening'),cancel_requested:true};expect((await client.cancel(input)).cancel_requested).toBe(true);
  expect(f.calls.filter(call=>call.params?.name==='render_document_thumbnail')).toHaveLength(1);
 });
 it('does not confuse a late timed-out reply with the current query and rejects concurrent RPCs',async()=>{
  vi.useFakeTimers();const {f,client}=await connect(undefined,{timeout_ms:100});await client.status();const normal=f.handle;
  f.handle=request=>request.params?.name==='render_document_thumbnail'?undefined:normal(request);
  const rendering=client.render(input),timedOut=expect(rendering).rejects.toMatchObject({code:'worker_timeout'}),oldId=f.calls.at(-1)!.id!;
  await vi.advanceTimersByTimeAsync(101);await timedOut;
  f.handle=request=>request.params?.name==='get_thumbnail_job'?undefined:normal(request);
  let settled=false;const querying=client.get(input).finally(()=>{settled=true;}),queryId=f.calls.at(-1)!.id!;
  await expect(client.status()).rejects.toMatchObject({code:'worker_rpc_busy'});
  f.reply(oldId,success(job()));await Promise.resolve();expect(settled).toBe(false);
  f.reply(queryId,success(job('done')));expect((await querying).state).toBe('done');
 });
 it.each(['JOB_RESULT_EXPIRED','JOB_NOT_FOUND','BRIDGE_TIMEOUT','UNKNOWN_PROVIDER_SECRET'])('does not leak remote diagnostics or automatically retry %s',async code=>{
  const {f,client}=await connect();const normal=f.handle;
  f.handle=request=>request.params?.name==='get_thumbnail_job'?{isError:true,structuredContent:{ok:false,error:{code,message:'SECRET provider absolute path'}},content:[{type:'text',text:'{"provider":"SECRET"}'}]}:normal(request);
  let failure:unknown;try{await client.get(input);}catch(error){failure=error;}
  expect(failure).toMatchObject({code:code==='UNKNOWN_PROVIDER_SECRET'?'worker_remote_error':code});expect(String(failure)).not.toContain('SECRET');
  expect(f.calls.filter(call=>call.method==='tools/call')).toHaveLength(1);
 });
 it.each(['nonjson','utf8','request','wrongid','duplicate','stdout','stderr','imagecontent','duplicatepng'])('bounds and rejects invalid wire output: %s',async mode=>{
  const {f,client}=await connect();const normal=f.handle;
  f.handle=request=>{
   if(request.params?.name!=='get_thumbnail_worker_status')return normal(request);
   if(mode==='imagecontent')return {...success(status()),content:[{type:'image',data:'not-requested',mimeType:'image/png'}]};
   if(mode==='duplicatepng')return {...success(status()),content:[{type:'text',text:JSON.stringify({png_base64:png().toString('base64')})}]};
   if(mode==='nonjson')f.child.stdout.write('SECRET provider text\n');
   if(mode==='utf8')f.child.stdout.write(Buffer.from([0xff,10]));
   if(mode==='request')f.child.stdout.write(JSON.stringify({jsonrpc:'2.0',id:100,method:'sampling/createMessage'})+'\n');
   if(mode==='wrongid')f.reply(777,success(status()));
   if(mode==='duplicate'){f.reply(request.id!,success(status()));f.reply(request.id!,success(status()));}
   if(mode==='stdout')f.child.stdout.write(Buffer.alloc(6*1024*1024+1,120));
   if(mode==='stderr')f.child.stderr.write(Buffer.alloc(64*1024+1,120));
   return undefined;
  };
  await expect(client.status()).rejects.toMatchObject({name:'ThumbnailWorkerClientError'});
 });
 it('does not dispatch after abort or actual close, and never invokes close/kill itself',async()=>{
  const signal=new AbortController(),{f,client}=await connect(undefined,{signal:signal.signal});signal.abort();const count=f.calls.length;
  await expect(client.status()).rejects.toMatchObject({code:'worker_cancelled'});expect(f.calls).toHaveLength(count);
  const second=await connect();second.f.child.emit('close',0);await expect(second.client.status()).rejects.toMatchObject({code:'worker_closed'});
  expect(f.owned.close).not.toHaveBeenCalled();expect(f.child.kill).not.toHaveBeenCalled();
 });
});
