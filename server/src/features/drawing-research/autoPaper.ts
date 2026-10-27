import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
import {fcstdWorkspace,safeFcstdPath,readFcstdBatchArchive,fcstdFingerprint} from '../../lib/fcstdBatchFiles.js';
import {captureDrawingSources,verifyDrawingSources} from './jobs.js';
import {sourceNodes} from './service.js';
import {acquireDrawingExecution} from './executionGate.js';
import {runMaintenanceNative} from './maintenance.js';
import {maintenanceNativeDiagnostics} from './maintenance-runner.js';
import {nativeReferenceInspection,nativeSourceAssemblySafety} from './native-drawing-guards.js';
import {drawingPaperProjectionSupport} from './runner.js';

export type DrawingPaper='A0'|'A1'|'A2'|'A3'|'A4';
export interface DrawingPaperCandidate {paper:DrawingPaper;rel:string;filename:string;hash:string;width:number;height:number}
type ViewName='Front'|'Side'|'Iso';
type ProjectionBounds=Record<ViewName,[number,number,number,number]>;
export interface DrawingPaperLayout {
 scale:number;note_y:number;orientation:'columns'|'rows';
 positions:Record<ViewName,[number,number]>;rectangles:ProjectionBounds;
}
export interface DrawingPaperProposal {
 paper:DrawingPaper;scale:string;template:string;template_hash:string;reason:string;
 projection_bounds:ProjectionBounds;layout:DrawingPaperLayout;
}
const papers:DrawingPaper[]=['A4','A3','A2','A1','A0'];
const dimensions:Record<DrawingPaper,[number,number]>={A4:[297,210],A3:[420,297],A2:[594,420],A1:[841,594],A0:[1189,841]};
const scales=['auto','1:1','2:1','5:1','1:2','1:5','1:10','1:20','1:50','1:100','1:200','1:1000'];
function manual(message:string):never {throw new Error('自动纸幅需人工确认：'+message);}
function active(signal?:AbortSignal){if(signal?.aborted)throw new Error('自动纸幅预览已取消；未生成或保存图纸');}
function boundedRead(file:string,limit:number):Buffer {
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const before=fs.fstatSync(fd);if(!before.isFile()||before.size>limit)manual('模板或回执不是受控普通文件/超出大小上限');
  const bytes=Buffer.alloc(before.size+1);let size=0;
  while(size<bytes.length){const n=fs.readSync(fd,bytes,size,bytes.length-size,size);if(!n)break;size+=n;}
  const after=fs.fstatSync(fd),leaf=fs.lstatSync(file);
  if(size!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||!leaf.isFile()||leaf.dev!==before.dev||leaf.ino!==before.ino)manual('模板或回执在读取中变化');
  return bytes.subarray(0,size);
 }finally{fs.closeSync(fd);}
}
function checkedCandidates(input:DrawingPaperCandidate[]):DrawingPaperCandidate[]{
 if(!Array.isArray(input)||!input.length||input.length>5)manual('缺少已验证的同族 stock ISO 图框');
 const seen=new Set<string>();let family='';
 const result=input.map(c=>{
  if(!c||!papers.includes(c.paper)||seen.has(c.paper))manual('图框纸幅重复或未知');seen.add(c.paper);
  const expected=`ISO/${c.paper}_Landscape_ISO5457_advanced.svg`;
  if(c.rel!==expected||!path.isAbsolute(c.filename)||fs.realpathSync(c.filename)!==path.resolve(c.filename)||!/^[0-9a-f]{64}$/.test(c.hash))manual('只接受 canonical stock ISO advanced 同模板族');
  const root=path.dirname(path.dirname(c.filename));
  if(path.resolve(root,...expected.split('/'))!==c.filename||family&&family!==root)manual('模板候选跨越目录或模板族');family=root;
  const [width,height]=dimensions[c.paper];
  if(!Number.isFinite(c.width)||!Number.isFinite(c.height)||Math.abs(c.width-width)>0.25||Math.abs(c.height-height)>0.25)manual('stock 图框实际纸幅无法确认');
  const bytes=boundedRead(c.filename,2*1024*1024);
  if(createHash('sha256').update(bytes).digest('hex')!==c.hash)manual('图框模板已变化，请重新预览');
  return {paper:c.paper,rel:c.rel,filename:c.filename,hash:c.hash,width:c.width,height:c.height};
 });
 if(!['A4','A3','A2'].every(p=>seen.has(p)))manual('自动纸幅要求同族 A4/A3/A2 图框齐全；缺少模板时不跳过猜选');
 return result.sort((a,b)=>papers.indexOf(a.paper)-papers.indexOf(b.paper));
}

/** Policy only. Layout is always the generator's existing full-curve algorithm. */
export const autoPaperPolicyPython=String.raw`
def choose_auto_paper(candidates,bounds,requested):
 by_paper={candidate['paper']:candidate for candidate in candidates}
 if len(by_paper)!=len(candidates) or not all(p in by_paper for p in ('A4','A3','A2')):raise RuntimeError('自动纸幅缺少同族A4/A3/A2模板；需人工确认')
 common=['1:1','1:2','1:5','1:10']
 allowed=common+['2:1','5:1','1:20','1:50','1:100','1:200','1:1000']
 if requested!='auto' and requested not in allowed:raise RuntimeError('未支持的明确比例；需人工确认')
 selected_scales=common if requested=='auto' else [requested]
 for tier in (('A4','A3','A2'),('A1','A0')):
  for scale in selected_scales:
   for paper in tier:
    candidate=by_paper.get(paper)
    if candidate is None:continue
    try:layout=choose_owned_draft_layout(candidate['width'],candidate['height'],bounds,scale)
    except RuntimeError:continue
    reason=('基于三个实际1:1完整曲线投影及现有尺寸余量布局；常用比例优先，小纸幅优先' if requested=='auto' else '基于三个实际1:1完整曲线投影及现有尺寸余量布局；保持用户明确比例，不自动降档')
    if paper in ('A1','A0'):reason+='；A4/A3/A2全部候选不适配后使用可用大纸幅'
    return {'paper':paper,'scale':scale,'template':candidate['rel'],'template_hash':candidate['hash'],'reason':reason,'projection_bounds':bounds,'layout':layout}
 raise RuntimeError('实际投影与尺寸余量超出可用纸幅/允许比例；需人工确认，不自动缩到非常用小比例')
`;

/** Private owned process only: unsaved projection document; no exports or saves. */
export const autoPaperRunner=String.raw`
import FreeCAD as A,FreeCADGui as G,Part
import json,os,zipfile,hashlib,traceback,time,xml.etree.ElementTree as ET
from PySide import QtCore,QtGui
try:
 from PySide import QtWidgets
except ImportError:QtWidgets=QtGui
spec=json.load(open(JOB_PATH,encoding='utf8'))
${maintenanceNativeDiagnostics}
${nativeReferenceInspection}
${nativeSourceAssemblySafety}
${drawingPaperProjectionSupport}
${autoPaperPolicyPython}

def paper_inputs_unchanged():
 for filename,digest in spec['source_fingerprints'].items():
  if hashlib.sha256(open(filename,'rb').read()).hexdigest()!=digest:raise RuntimeError('源模型或链依赖已变化；需重新预览')
 for candidate in spec['candidates']:
  if hashlib.sha256(open(candidate['filename'],'rb').read()).hexdigest()!=candidate['hash']:raise RuntimeError('图框模板已变化；需重新预览')

def propose_paper():
 mark_progress('opening_source');paper_inputs_unchanged()
 source=A.openDocument(spec['source']);body=source.getObject(spec['node'])
 if body is None:raise RuntimeError('源主节点不存在；需人工确认')
 projection=A.newDocument('PaperProjection')
 source_before=native_source_graph(projection);native_assert_frame_coverage(source_before)
 shape=Part.getShape(body)
 if shape.isNull() or not shape.isValid() or not shape.Solids:raise RuntimeError('源主实体为空或无效；不保存源3D')
 bb=shape.BoundBox;sizes=[native_finite(bb.XLength),native_finite(bb.YLength),native_finite(bb.ZLength)]
 normal=min(range(3),key=lambda i:sizes[i]);horizontal=max([i for i in range(3) if i!=normal],key=lambda i:sizes[i]);vertical=next(i for i in range(3) if i not in (normal,horizontal))
 def unit(i):return A.Vector(*(1 if j==i else 0 for j in range(3)))
 # A cross-document App::Link requires a saved owner. Keep this preview truly
 # unsaved, but use the generator's App::Link projection semantics (including
 # its default LinkTransform/LinkPlacement) against a local effective-shape copy.
 holder=projection.addObject('Part::Feature','ProjectedShape');holder.Shape=shape.copy()
 link=projection.addObject('App::Link','SourceModel');link.setLink(holder)
 page=projection.addObject('TechDraw::DrawPage','Page');template=projection.addObject('TechDraw::DrawSVGTemplate','Template')
 first=spec['candidates'][0];template.Template=first['filename'];page.Template=template
 if abs(float(template.Width)-first['width'])>.25 or abs(float(template.Height)-first['height'])>.25:raise RuntimeError('原生图框纸幅与预检不同；需人工确认')
 for name,direction,x_direction in [('Front',unit(normal),unit(horizontal)),('Side',unit(vertical),unit(horizontal)),('Iso',A.Vector(1,-1,1),unit(horizontal))]:
  view=projection.addObject('TechDraw::DrawViewPart',name);view.Source=[link];view.Direction=direction;view.XDirection=x_direction;view.ScaleType='Custom';view.Scale=1.0;page.addView(view)
 page.ViewObject.show();projection.recompute();G.updateGui()
 mark_progress('settling_initial')
 names=['Front','Side','Iso'];settle_drawing(projection,names,[],{},1.0)
 bounds={name:value['model'] for name,value in projection_snapshot(projection,names).items()}
 proposal=choose_auto_paper(spec['candidates'],bounds,spec['requested_scale'])
 mark_progress('checking_preservation');paper_inputs_unchanged()
 after=native_assert_source_preservation(source_before,projection);native_assert_frame_coverage(after)
 return {'status':'completed','proposal':proposal,'source_safety':native_safety_summary(after),'source_fingerprints_unchanged':True}

try:
 own_process();owned=True;native_safety_initialize()
 result=propose_paper()
except Exception as error:result={'status':'failed','error':str(error),'trace':traceback.format_exc()}
finally:
 finish_native(result,'report')
 if owned:native_safety_shutdown()
`;

const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const names:ViewName[]=['Front','Side','Iso'];
const exactKeys=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(key=>Object.hasOwn(v,key));
function tuples(v:unknown,length:number):v is Record<ViewName,number[]> {
 return object(v)&&Object.keys(v).length===3&&names.every(name=>Array.isArray(v[name])&&(v[name] as unknown[]).length===length&&(v[name] as unknown[]).every(finite));
}
function proposal(value:unknown,candidates:DrawingPaperCandidate[],requested:string):DrawingPaperProposal {
 if(!object(value)||!exactKeys(value,['paper','scale','template','template_hash','reason','projection_bounds','layout'])||!object(value.layout)||!exactKeys(value.layout,['scale','note_y','orientation','positions','rectangles'])||typeof value.reason!=='string'||!value.reason||value.reason.length>4096||/[\x00-\x1f\x7f]/.test(value.reason)||!tuples(value.projection_bounds,4))manual('原生投影/纸幅回执缺失或不完整');
 const candidate=candidates.find(c=>c.paper===value.paper&&c.rel===value.template&&c.hash===value.template_hash);
 if(!candidate||typeof value.scale!=='string'||!scales.includes(value.scale)||value.scale==='auto'||requested!=='auto'&&value.scale!==requested||requested==='auto'&&!['1:1','1:2','1:5','1:10'].includes(value.scale))manual('原生选择不属于已确认模板或允许比例');
 const layout=value.layout,scale=value.scale.split(':').map(Number),numeric=scale[0]/scale[1];
 if(!finite(layout.scale)||Math.abs(layout.scale-numeric)>1e-10||!finite(layout.note_y)||layout.note_y<0||!['columns','rows'].includes(String(layout.orientation))||!tuples(layout.positions,2)||!tuples(layout.rectangles,4))manual('原生布局回执无效');
 for(const name of names){
  const bounds=value.projection_bounds[name],rect=layout.rectangles[name];
  if(bounds[1]<bounds[0]||bounds[3]<bounds[2]||Math.max(bounds[1]-bounds[0],bounds[3]-bounds[2])<=0||rect[0]<10-1e-5||rect[1]>candidate.width-10+1e-5||rect[2]<layout.note_y+12-1e-5||rect[3]>candidate.height-10+1e-5||rect[1]<=rect[0]||rect[3]<=rect[2])manual('原生投影或布局边界无效');
 }
 for(let i=0;i<names.length;i++)for(const name of names.slice(i+1)){
  const a=layout.rectangles[names[i]],b=layout.rectangles[name];
  if(Math.min(a[1],b[1])-Math.max(a[0],b[0])>1e-5&&Math.min(a[3],b[3])-Math.max(a[2],b[2])>1e-5)manual('原生布局预留区重叠');
 }
 return {paper:candidate.paper,scale:value.scale,template:candidate.rel,template_hash:candidate.hash,reason:value.reason,projection_bounds:structuredClone(value.projection_bounds) as ProjectionBounds,layout:{scale:layout.scale,note_y:layout.note_y,orientation:layout.orientation==='columns'?'columns':'rows',positions:structuredClone(layout.positions) as Record<ViewName,[number,number]>,rectangles:structuredClone(layout.rectangles) as ProjectionBounds}};
}

export async function proposeDrawingPaper(root:string,rel:string,node:string,candidates:DrawingPaperCandidate[],requestedScale:string,signal?:AbortSignal):Promise<DrawingPaperProposal> {
 active(signal);root=fcstdWorkspace(root);
 if(!/^[A-Za-z_]\w*$/.test(node)||!scales.includes(requestedScale))manual('主节点或比例无效');
 const checked=checkedCandidates(candidates),source=safeFcstdPath(root,rel),archive=readFcstdBatchArchive(source);
 if(/\.drawing\.fcstd$/i.test(source)||!sourceNodes(archive.xml).some(o=>o.name===node))manual('请选择可验证的源模型主节点');
 const fingerprints=captureDrawingSources(root,rel),sourceRel=path.relative(root,source).replace(/\\/g,'/');
 if(fingerprints[sourceRel]!==fcstdFingerprint(archive.bytes))manual('源模型在预检期间变化');
 active(signal);const release=acquireDrawingExecution('auto-paper:'+sourceRel);
 try{
  await setImmediate();active(signal);verifyDrawingSources(root,fingerprints);
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'desk-auto-paper-')),config=path.join(folder,'job.json'),report=path.join(folder,'result.json'),macro=path.join(folder,'inspect.FCMacro');
  fs.writeFileSync(config,JSON.stringify({source,node,candidates:checked,requested_scale:requestedScale,report,source_fingerprints:Object.fromEntries(Object.entries(fingerprints).map(([file,digest])=>[safeFcstdPath(root,file),digest]))}),{mode:0o600});
  fs.writeFileSync(macro,'JOB_PATH = '+JSON.stringify(config)+'\n'+autoPaperRunner,{mode:0o600});
  const pid=await runMaintenanceNative(macro,folder,root,config,signal,release);active(signal);
  verifyDrawingSources(root,fingerprints);checkedCandidates(checked);
  const result:unknown=JSON.parse(boundedRead(report,2*1024*1024).toString('utf8'));
  if(!object(result)||result.status!=='completed'||result.native_pid!==pid||result.source_fingerprints_unchanged!==true||!object(result.source_safety)||result.source_safety.status!=='verified'||!object(result.source_safety.preferences)||result.source_safety.preferences.SolveOnRecompute!==false||result.source_safety.preferences.SolveInJointCreation!==false||!Array.isArray(result.source_safety.solver_observations)||result.source_safety.solver_observations.length||result.source_safety.source_poses_and_actual_frames_unchanged!==true||result.source_safety.existing_unresolved_joint_sides!==0)manual('原生源保护回执未完成或不能确认；保留源文件');
  active(signal);return proposal(result.proposal,checked,requestedScale);
 }finally{release();}
}
