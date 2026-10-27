import fs from 'node:fs';
import path from 'node:path';
import {createHash}from'node:crypto';
import {setImmediate}from'node:timers/promises';
import type{ActionDescriptor,SubjectRef,CurrentPlannedItem}from'../../../../shared/batch-tasks/contracts.js';
import {inspectSelectedCadNames}from'../../../../shared/cad-name-audit/model.js';
import {readGeometryCacheSnapshot,type GeometryCacheSnapshot}from'./geometry-cache.js';
import {fcstdWorkspace,safeFcstdPath}from'../../lib/fcstdBatchFiles.js';
import {readCadObjectInfo}from'../cad-object-info/service.js';
import {CadObjectInfoBudget,measureCadObjectInfoJsonBytes}from'../cad-object-info/budget.js';
import {relativeFile}from'./model.js';
export const assertActive=(signal?:AbortSignal)=>{if(signal?.aborted)throw new Error('任务取消请求已确认停止当前只读步骤');};
export function readSubject(workspace:string,subject:SubjectRef,signal?:AbortSignal){
 assertActive(signal);const root=fcstdWorkspace(workspace),rel=relativeFile(subject.rel),filename=safeFcstdPath(root,rel);
 const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const before=fs.fstatSync(fd);if(!before.isFile()||before.size>64*1024*1024)throw new Error('只读取不超过64MiB的普通文件');
  const bytes=Buffer.alloc(before.size+1);let length=0;
  while(length<bytes.length){assertActive(signal);const size=fs.readSync(fd,bytes,length,Math.min(64*1024,bytes.length-length),length);if(!size)break;length+=size;}
  const after=fs.fstatSync(fd),leaf=fs.lstatSync(filename);
  if(length!==before.size||after.size!==before.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||!leaf.isFile()||leaf.ino!==before.ino||leaf.dev!==before.dev||safeFcstdPath(root,rel)!==filename)throw new Error('文件在读取期间变化，请重新预览');
  const data=bytes.subarray(0,length);return {data,sha256:createHash('sha256').update(data).digest('hex'),bytes:length,filename};
 }finally{fs.closeSync(fd);}
}
export interface BatchCachePreparation {key:'workspace_cad_geometry';selector:string;schema_version:1;algorithm_version:'geometry-cache-snapshot-v1';value:GeometryCacheSnapshot}
export interface BatchActionContext {preparation?:BatchCachePreparation}
/** Legacy file ports remain single-file; a whole-batch port is explicit and never receives a fake first file. */
export interface BatchActionAdapter {
 descriptor:ActionDescriptor;applicable(subject:SubjectRef):string|undefined;
 execute(root:string,subject:SubjectRef,signal:AbortSignal,context?:BatchActionContext):Promise<Record<string,unknown>>;
 prepare?(root:string,subject:SubjectRef,signal:AbortSignal):Promise<BatchCachePreparation>;
 executeBatch?(root:string,items:readonly CurrentPlannedItem[],signal:AbortSignal):Promise<Record<string,unknown>>;
}
const descriptor=(key:string,title:string,description:string):ActionDescriptor=>({key,version:1,title,description,effects:['read_file','write_task_db'],phase:'collect',cancellable:true,
 scope:'file',source_read_only:true,cancellation:'cooperative',result_schema_version:1,algorithm_version:key+'-v1'});
const cadApplicable=(subject:SubjectRef)=>/\.fcstd$/i.test(subject.rel)?undefined:'只适用于FCStd文件';
const savedViewTypes=['TechDraw::DrawViewPart','TechDraw::DrawProjGroupItem','TechDraw::DrawViewSection','TechDraw::DrawViewDetail'] as const;
async function savedDocument(root:string,subject:SubjectRef,signal:AbortSignal){
 const result=await readCadObjectInfo(root,subject.rel,signal);
 if(result.document.objects.length>500)throw new Error('对象超过500个，首期结果上限需缩小样例');
 return result;
}
async function boundedSavedObservation(result:Record<string,unknown>,signal:AbortSignal):Promise<Record<string,unknown>>{
 try{await measureCadObjectInfoJsonBytes(result,new CadObjectInfoBudget(signal,{bytes:256*1024}));}
 catch(error){if((error as {code?:unknown})?.code==='resource_limit')throw new Error('观察结果超过256KiB安全上限，未保存截断结果');throw error;}
 assertActive(signal);return result;
}
export function defaultBatchAdapters():BatchActionAdapter[]{return [
 {descriptor:descriptor('file.metadata','文件基本信息','读取大小、后缀和SHA256；只写任务观察记录'),applicable:()=>undefined,execute:async(root,subject,signal)=>{await setImmediate();const {sha256,bytes}=readSubject(root,subject,signal);return {bytes,extension:path.extname(subject.rel),sha256};}},
 {descriptor:descriptor('file.text-stats','文本统计','UTF-8文本的行数、字符和词数；不保存原文'),applicable:s=>/\.(fcstd|png|jpe?g|gif|pdf|zip|step|stp|catpart|catproduct|catdrawing)$/i.test(s.rel)?'此类型不作为普通文本处理':undefined,execute:async(root,subject,signal)=>{await setImmediate();const {data}=readSubject(root,subject,signal);if(data.byteLength>2*1024*1024||data.includes(0))throw new Error('文本超过2MiB或含二进制内容');const text=new TextDecoder('utf-8',{fatal:true}).decode(data);return {encoding:'UTF-8',lines:text?text.split(/\r\n|\r|\n/).length:0,characters:Array.from(text).length,words:text.trim()?text.trim().split(/\s+/u).length:0};}},
 {descriptor:descriptor('cad.saved-properties','CAD已保存属性','读取FCStd对象标签、属性及材料字符串；不打开FreeCAD、不读取关联模型或计算质量'),applicable:cadApplicable,execute:async(root,subject,signal)=>{const result=await savedDocument(root,subject,signal);return {source:'saved_document_xml',physical_material:false,objects:result.document.objects.map(o=>({name:o.name,type:o.type_id,label:o.label,material:o.material,properties:Object.fromEntries(Object.entries(o.properties).filter(([key])=>['PartNumber','PartVersion','PartName','PartMaterial','PartType','ModelSeries'].includes(key)))})),warnings:result.warnings};}},
 {descriptor:descriptor('cad.saved-links','CAD已保存链接','只采所选FCStd保存的外链路径与显示标签（缺省可回退宿主），保留重复；不查目标、不搜索候选、不代表BOM数量'),applicable:cadApplicable,execute:async(root,subject,signal)=>{
  const result=await savedDocument(root,subject,signal);
  return boundedSavedObservation({source:'saved_document_xml',target_resolution:'not_attempted',link_count:result.document.xlinks.length,
   links:result.document.xlinks.map(link=>({file:link.file,label:link.label})),
   label_semantics:'explicit_xlink_label_or_host_label_fallback',
   warnings:[...result.warnings,'链接数仅为所选文件保存的 XLink 条目数，保留重复；未读取目标，不等于 BOM 或采购数量。',
    'label 是读取器的显示标签投影：可能为显式 XLink 标签，也可能缺省回退宿主 Label；不是经核验的目标文档或节点名称。']},signal);
 }},
 {descriptor:descriptor('cad.saved-drawing','CAD已保存图纸摘要','只统计所选FCStd保存的TechDraw类型、页、已知视图和维度对象；结构字段明确未知，不验证图纸有效性'),applicable:cadApplicable,execute:async(root,subject,signal)=>{
  const result=await savedDocument(root,subject,signal),objects=result.document.objects.filter(object=>object.type_id.startsWith('TechDraw::'));
  const counts=new Map<string,number>();for(const object of objects)counts.set(object.type_id,(counts.get(object.type_id)??0)+1);
  const knownTypes=new Set<string>(['TechDraw::DrawPage','TechDraw::DrawViewDimension','TechDraw::DrawSVGTemplate','TechDraw::DrawViewAnnotation','TechDraw::DrawProjGroup',...savedViewTypes]);
  const unclassified_types=[...counts.keys()].filter(type=>!knownTypes.has(type)).sort();
  return boundedSavedObservation({source:'saved_document_xml',verification:'saved_types_only',
   counts:{techdraw_objects:objects.length,pages:counts.get('TechDraw::DrawPage')??0,views:savedViewTypes.reduce((sum,type)=>sum+(counts.get(type)??0),0),dimensions:counts.get('TechDraw::DrawViewDimension')??0},
   types:[...counts].sort(([left],[right])=>left<right?-1:left>right?1:0).map(([type,count])=>({type,count})),
   objects:objects.map(object=>({name:object.name,type:object.type_id,label:object.label})),view_types_counted:[...savedViewTypes],unclassified_types,
   structured_fields:{page_view_links:'unknown',template_links:'unknown',editable_texts:'unknown',dimension_references:'unknown'},
   warnings:[...result.warnings,'仅统计保存的对象类型；视图数只包含 view_types_counted 所列类型，未归类类型不能作为零视图依据。',
    '页面关系、模板链接、图框文字及尺寸引用未投影，均为 unknown；未打开 FreeCAD，不验证实际页面、投影或尺寸有效性。']},signal);
 }},
 {descriptor:{...descriptor('cad.geometry-cache','尺寸缓存状态','只读所选文件的现有尺寸缓存，未核验依赖均为unverified；会使用自有临时读锁，不创建或更新缓存、不启动Native'),effects:['read_file','read_cache','write_task_db']},applicable:cadApplicable,
  prepare:async(root,subject,signal)=>({key:'workspace_cad_geometry',selector:subject.rel,schema_version:1,algorithm_version:'geometry-cache-snapshot-v1',value:await readGeometryCacheSnapshot(root,subject.rel,signal)}),
  execute:async(_root,subject,signal,context)=>{assertActive(signal);const prepared=context?.preparation;if(!prepared||prepared.selector!==subject.rel||prepared.key!=='workspace_cad_geometry')throw new Error('尺寸缓存缺少本次冻结投影，未执行查询');
   return {schema_version:1,source:'existing_geometry_cache',source_measurement:false,...structuredClone(prepared.value),warnings:['只报告现有缓存，freshness 为 unverified；未读取清单外依赖、未测量或写 CAD。']};}},
 {descriptor:{...descriptor('cad.name-audit','所选整批名称查重','仅分析完整冻结选择集的文件名身份，保留完整版本与variant；不递归、不保存偏好、不合并/删除文件'),scope:'batch'},applicable:()=>undefined,
  execute:async()=>{throw new Error('整批动作不能作为单文件步骤执行');},
  executeBatch:async(_root,items,signal)=>{assertActive(signal);return {...inspectSelectedCadNames(items.map(item=>({item_id:item.id,rel:item.subject.rel,sha256:item.sha256,error:item.error})))};}},
 ];}
