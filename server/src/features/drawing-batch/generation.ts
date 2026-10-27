import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { pnwExtractXlinksFromDocumentXml } from '@phoenix-wing/cad-core';
import { fcstdFingerprint, readFcstdBatchArchive, safeFcstdPath, fcstdWorkspace } from '../../lib/fcstdBatchFiles.js';
import { fcstdXmlObjects, objectString } from '../../lib/fcstdLinkIdentity.js';
import { isStandaloneDrawing } from '../../lib/fcstdDrawing.js';
import { sourceNodes, templateCatalog } from '../drawing-research/service.js';
import { planDrawingOutputs, assertDrawingOutputPlanAbsent, type DrawingOutputPlan } from '../drawing-research/output-name.js';
import { assertDrawingGenerationSourceSafety,captureDrawingSources, drawingDefaults, startDrawing, waitDrawingJob, validateDrawingTemplate, verifyDrawingSources, type DrawingDefaults, type DrawingSourceGuards } from '../drawing-research/jobs.js';
import { scanDrawingCandidates } from './scan.js';
import { startBatchJob } from './batchJobs.js';
import { proposeDrawingPaper, type DrawingPaperCandidate } from '../drawing-research/autoPaper.js';
import type { DrawingGenerationPreview, GenerationRow, DrawingBatchResult } from './types.js';
import {parseCadIdentity} from '../../../../shared/cad-companion/model.js';
import type {CadNameIdentity} from '../../../../shared/cad-companion/contracts.js';
import {inspectReferencePdf} from './reference-pdf.js';

type Input = { directory: string; recursive?: boolean; template_root?: string; template?: string; paper?: string; scale?: string; allow_without_pdf?:boolean; signal?:AbortSignal };
type LineWidths = Pick<DrawingDefaults,'contour_line_width_mm'|'dimension_line_width_mm'>;
type Item = { row: GenerationRow; fingerprints: DrawingSourceGuards; template_hash: string; output: DrawingOutputPlan; material: string; line_widths: LineWidths; companion_name?:string; reference?: {rel:string;hash:string}; reference_scope:Array<{rel:string;hash:string}> };
type Plan = { root: string; expires: number; items: Item[]; allow_without_pdf:boolean };
const plans = new Map<string, Plan>();
const TTL = 30 * 60_000;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const relPath = (root: string, filename: string) => path.relative(root, filename).replace(/\\/g, '/');
const pdfIdentity=(name:string)=>parseCadIdentity(path.basename(name).replace(/\.pdf$/i,'.FCStd'));
async function referencePdfs(root:string,warnings:string[],strict=false,filter?:CadNameIdentity){
 const files:Array<{rel:string;identity:CadNameIdentity;hash:string}>=[],stack=[root];let visited=0,pdfs=0;
 while(stack.length)for(const entry of fs.readdirSync(stack.pop()!,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
  if(++visited>20000){if(strict)throw new Error('参考PDF搜索超过20000项，无法证明候选唯一，请缩小工作空间');warnings.push('参考PDF搜索达到20000项上限：未采用候选，按无原PDF研究稿处理');return [];}if(visited%50===0)await setImmediate();
  if(entry.name.startsWith('.')||['node_modules','__pycache__','.venv'].includes(entry.name)||entry.isSymbolicLink())continue;
  const filename=path.join(entry.parentPath,entry.name),rel=relPath(root,filename);safeFcstdPath(root,rel);
  if(entry.isDirectory()){stack.push(filename);continue;}if(!entry.isFile()||!/\.pdf$/i.test(entry.name))continue;if(++pdfs>500){if(strict)throw new Error('参考PDF超过500个，无法证明候选唯一');warnings.push('参考PDF达到500个上限：未采用候选，按无原PDF研究稿处理');return [];}
  const identity=pdfIdentity(entry.name);if(identity.number===null||identity.revisionRaw===null)continue;
  if(filter&&(identity.number!==filter.number||identity.revisionRaw!==filter.revisionRaw))continue;
  if(identity.parseStatus!=='parsed')warnings.push(`${rel}：PDF身份需人工核对，未截断版次或忽略variant`);
  const stat=fs.statSync(filename);if(stat.size>64*1024*1024){warnings.push(`${rel}：参考PDF超过64MiB，需人工处理`);continue;}
  const raw=fs.readFileSync(filename);if(!/^%PDF-\d\.\d/.test(raw.subarray(0,16).toString('latin1'))||!raw.subarray(Math.max(0,raw.length-1024)).toString('latin1').includes('%%EOF')){warnings.push(`${rel}：不是可核对的PDF容器，已跳过`);continue;}
  files.push({rel,identity,hash:fcstdFingerprint(raw)});
 }
 return files;
}
async function verifyReferenceSelection(root:string,item:Item,signal:AbortSignal):Promise<void>{
 if(!item.reference)return;
 const active=()=>{if(signal.aborted)throw new Error('出图任务已取消，未启动原生生成');};active();
 const identity=parseCadIdentity(path.basename(item.row.rel));
 const current=await referencePdfs(root,[],true,identity);active();
 const signature=(values:Array<{rel:string;hash:string}>)=>JSON.stringify(values.map(value=>[value.rel,value.hash]).sort(([a],[b])=>a<b?-1:a>b?1:0));
 if(signature(current)!==signature(item.reference_scope))throw new Error('参考PDF候选集合已变化，请重新预览；未替换冻结参考');
 const pdf=current.find(value=>value.rel===item.reference!.rel);
 if(!pdf||pdf.hash!==item.reference.hash)throw new Error('参考PDF已变化，请重新预览');
 const inspection=await inspectReferencePdf(root,{pdf_rel:pdf.rel,binding:{source_rel:item.row.rel,source_node:item.row.node,identity,purpose:'drawing_notes',draft_sequence:pdf.identity.draftSequence??1,name_override:item.companion_name},signal});active();
 if(inspection.classification!=='candidate'||inspection.pdf_sha256!==item.reference.hash)throw new Error('参考PDF来源证据已变化或需人工确认，请重新预览；未启动原生生成');
 // Never upgrade the frozen choice after the asynchronous evidence check.
 const after=await referencePdfs(root,[],true,identity);active();
 if(signature(after)!==signature(item.reference_scope))throw new Error('参考PDF候选集合在核对期间变化，请重新预览');
}

/** Fixed-template previews are static. Auto paper reads native projections,
 * never saving CAD or changing preferences in the user's GUI. */
export async function previewDrawingGeneration(workspace: string, input: Input): Promise<DrawingGenerationPreview> {
  const checkCancelled=()=>{if(input.signal?.aborted)throw new Error('出图预览已取消，未保存计划');};checkCancelled();
  if (typeof input.recursive !== 'undefined' && typeof input.recursive !== 'boolean') throw new Error('递归选项须为布尔值');
  if(input.allow_without_pdf!==undefined&&typeof input.allow_without_pdf!=='boolean')throw new Error('参考PDF筛选选项须为布尔值');
  const allowWithoutPdf=input.allow_without_pdf!==false;
  if (input.paper && !['auto', 'A4', 'A3', 'A2', 'A1', 'A0'].includes(input.paper)) throw new Error('纸幅仅支持自动或 A4/A3/A2/A1/A0');
  const scale = input.scale || 'auto';
  if (!['auto','1:1','2:1','5:1','1:2','1:5','1:10','1:20','1:50','1:100','1:200','1:1000'].includes(scale)) throw new Error('比例无效');
  const scan = await scanDrawingCandidates(workspace, input.directory, input.recursive);
  // Installation frames, never an implicit private machine/template preference.
  const catalog = templateCatalog(input.template_root || '');
  const candidates = catalog.items.flatMap(item => {
    if (input.template && item.rel !== input.template) return [];
    try { return [{ ...item, ...validateDrawingTemplate(catalog.root, item.rel, input.paper) }]; }
    catch { return []; }
  }).sort((a, b) => ['A4','A3','A2','A1','A0'].indexOf(a.paper) - ['A4','A3','A2','A1','A0'].indexOf(b.paper) || Number(/advanced|ISO/i.test(b.rel)) - Number(/advanced|ISO/i.test(a.rel)) || a.rel.localeCompare(b.rel));
  if (!candidates.length) throw new Error('没有可用的 A4/A3/A2/A1/A0 工程图框：须含实际边框及图号、版本、标题/材料、比例可编辑字段');
  const automatic=(!input.paper||input.paper==='auto')&&!input.template;
  let automaticError='';let automaticCandidates:DrawingPaperCandidate[]=[];
  if(automatic){
    const installed=templateCatalog('');
    if(!installed.root||catalog.root!==installed.root)automaticError='自动纸幅只使用可证明的 FreeCAD 安装目录 ISO5457 advanced 同族；自定义目录请明确选择模板和纸幅';
    else{
      automaticCandidates=candidates.filter(frame=>/^ISO\/A[0-4]_Landscape_ISO5457_advanced\.svg$/.test(frame.rel)).map(frame=>({paper:frame.paper as DrawingPaperCandidate['paper'],rel:frame.rel,filename:frame.filename,hash:frame.hash,width:Number.parseFloat(frame.width),height:Number.parseFloat(frame.height)}));
      if(!['A4','A3','A2'].every(paper=>automaticCandidates.some(frame=>frame.paper===paper)))automaticError='自动纸幅缺少可验证的 A4/A3/A2 同族模板，请补齐或明确手动纸幅；不静默回退 A4';
    }
  }
  const defaultFrame = candidates[0], items: Item[] = [], rows: GenerationRow[] = [], warnings = [...scan.warnings];
  const configuredDefaults=drawingDefaults(scan.root),lineWidths:LineWidths={contour_line_width_mm:configuredDefaults.contour_line_width_mm,dimension_line_width_mm:configuredDefaults.dimension_line_width_mm};
  const pdfs=await referencePdfs(scan.root,warnings,!allowWithoutPdf);
  const drawingSources = new Set<string>();
  // Only exact, actual source links establish existing drawing provenance.
  for (const rel of scan.files) try {
    const archive = readFcstdBatchArchive(safeFcstdPath(scan.root, rel));
    if (!isStandaloneDrawing(rel, archive.xml)) continue;
    for (const link of pnwExtractXlinksFromDocumentXml(archive.xml)) try {
      drawingSources.add(relPath(scan.root, safeFcstdPath(scan.root, path.posix.join(path.posix.dirname(rel), link.file.replace(/\\/g, '/')))));
    } catch { /* Unresolved links do not authorize assembly generation. */ }
  } catch (error) { warnings.push(`${rel}：${errorText(error)}`); }
  for (const rel of scan.files) {
    checkCancelled();
    let row: GenerationRow | undefined;
    try {
      const source = safeFcstdPath(scan.root, rel), archive = readFcstdBatchArchive(source);
      if (isStandaloneDrawing(rel, archive.xml)) continue;
      const nodes = sourceNodes(archive.xml);
      for (const node of nodes) {
        const fingerprints = captureDrawingSources(scan.root, rel);
        if (fingerprints[rel] !== fcstdFingerprint(archive.bytes)) throw new Error('源模型在预览中变化，请重新预览');
        const assembly = /\.assy\.fcstd$/i.test(rel) || ['Assembly::AssemblyObject','App::Part'].includes(node.type);
        let frame=defaultFrame,selectedScale=scale,paperReason=automaticError;
        let sourceSafetyError='';try{assertDrawingGenerationSourceSafety(scan.root,fingerprints);}catch(error){sourceSafetyError=errorText(error);}
        if(automatic&&sourceSafetyError)paperReason='自动纸幅需人工处理：'+sourceSafetyError;
        if(automatic&&!assembly&&!paperReason){
          try{
            const proposal=await proposeDrawingPaper(scan.root,rel,node.name,automaticCandidates,scale,input.signal);checkCancelled();
            const chosen=candidates.find(candidate=>candidate.rel===proposal.template&&candidate.paper===proposal.paper&&candidate.hash===proposal.template_hash);
            if(!chosen)throw new Error('自动纸幅回执与冻结同族模板不一致');
            frame=chosen;selectedScale=proposal.scale;paperReason=proposal.reason;
          }catch(error){checkCancelled();paperReason='自动纸幅需人工处理：'+errorText(error);}
        }
        const object = fcstdXmlObjects(archive.xml).find(item => item.name === node.name),sourceIdentity=parseCadIdentity(path.basename(rel));
        // Only an explicit saved PartName supplies a shorter note name. Never
        // infer classification/project segments by cutting the CAD basename.
        const savedName=object?objectString(object,'PartName').trim():'';
        if(savedName&&/^[a-z]$/i.test(savedName))throw new Error('属性PartName仅为一个英文字母，禁止批量名称推荐；请人工确认，不静默回退');
        const companionName=sourceIdentity.parseStatus==='parsed'&&savedName?savedName:undefined;
        const output = planDrawingOutputs(source,{workspace:scan.root,source_node:node.name,name_override:companionName});
        assertDrawingOutputPlanAbsent(output);
        const sourceMaterial = object ? objectString(object, 'PartMaterial') || objectString(object, 'Material') : '';
        const configured = configuredDefaults.material;
        const material = sourceMaterial || configured || 'Q235';
        const number=object?objectString(object,'PartNumber').trim():'',version=object?objectString(object,'PartVersion').trim():'';
        const identityConflict=sourceIdentity.parseStatus==='parsed'&&Boolean(number&&number!==sourceIdentity.number||version&&version!==sourceIdentity.revisionRaw&&version!==sourceIdentity.revision);
        const matching=sourceIdentity.parseStatus==='parsed'&&!identityConflict?pdfs.filter(pdf=>pdf.identity.number===sourceIdentity.number&&pdf.identity.revisionRaw===sourceIdentity.revisionRaw):[];
        const references:typeof pdfs=[],manualReferences:Array<{rel:string;message:string}>=[];
        for(const pdf of matching){
          checkCancelled();
          const inspection=await inspectReferencePdf(scan.root,{pdf_rel:pdf.rel,binding:{source_rel:rel,source_node:node.name,identity:sourceIdentity,purpose:'drawing_notes',draft_sequence:pdf.identity.draftSequence??1,name_override:companionName},signal:input.signal});
          checkCancelled();
          if(inspection.pdf_sha256!==pdf.hash)throw new Error('参考PDF在来源核对期间变化，请重新预览');
          if(inspection.classification==='candidate')references.push(pdf);
          else if(inspection.classification==='manual'){const message=inspection.diagnostics.map(item=>item.message).join('；');manualReferences.push({rel:pdf.rel,message});warnings.push(`${pdf.rel}：${message}`);}
        }
        // A visible unresolved candidate prevents selecting a different PDF as
        // uniquely authoritative. With explicit no-PDF research it is not used.
        const reference=references.length===1&&!manualReferences.length?references[0]:undefined;
        row = { id: randomUUID(), rel, node: node.name, label: node.label, kind: assembly ? 'assembly' : 'part', eligible: !assembly&&(Boolean(reference)||allowWithoutPdf),
          message: assembly ? drawingSources.has(rel) ? '已有源关联装配图：仅供研究，须人工选择方案，暂不自动批量生成' : '没有已关联装配图：需人工确认，不自动生成生产装配图' : '新研究稿；静态预览不推断几何尺寸，待原生 fit 与人工审核',
          paper: frame.paper, scale:selectedScale, template_root: catalog.root, template: frame.rel,...lineWidths,
          material, material_source: sourceMaterial ? '源模型属性' : configured ? '工作区/本机配置缺省建议' : 'Q235 缺省建议，待审核',
          output_paths: [output.drawing,output.pdf,output.notes].map(file => relPath(scan.root, file)) };
        Object.assign(row,{reference_pdf:reference?.rel,reference_candidates:[...references.map(item=>({rel:item.rel,status:'candidate' as const})),...manualReferences.map(item=>({...item,status:'manual' as const}))],reference_status:reference?'candidate_needs_review':manualReferences.length?'manual':allowWithoutPdf?'missing_allowed':references.length?'ambiguous':'missing'});
        if(!reference&&!assembly)row.message=allowWithoutPdf?references.length?'多个PDF未明确原版次，未采用参考：仅从3D生成无原图研究稿，待工程审核':'无原PDF：仅从3D生成研究稿，视图、尺寸、工程要求待人工审核':references.length?'多个同编号/版本PDF尚未明确，须人工确认；当前筛选不补图纸':'无可核对同编号/版本的PDF，当前筛选暂不补图纸';
        else row.message+='；PDF仅按编号/版本核对为候选，尚未读取工程要求，不等于工程审批';
        if(manualReferences.length)row.message+='；PDF来源需人工核对，未采用为原参考：'+manualReferences.map(item=>item.rel).join('、');
        if(identityConflict){row.eligible=false;row.message+='；保存编号/版本与文件名身份冲突，需人工确认；未忽略variant';}
        row.message+=`；线宽：轮廓 ${lineWidths.contour_line_width_mm} mm / 尺寸及界线 ${lineWidths.dimension_line_width_mm} mm（本次预览冻结）`;
        if(automatic){
          const proven=!assembly&&!automaticError&&paperReason&&!paperReason.startsWith('自动纸幅需人工处理');
          row.eligible=row.eligible&&Boolean(proven);row.message+='；'+(paperReason||'总成自动纸幅待人工确认');
          if(!proven){row.paper='待确认';row.scale='待确认';}
        }else row.message+='；固定所选模板纸幅，不自动换纸；自动比例只在此纸张内适配';
        if(sourceSafetyError){row.eligible=false;row.message+='；'+sourceSafetyError;}
        // Do not upgrade the baseline after asynchronous native projection.
        // A dependency could change while the main source bytes stay identical.
        verifyDrawingSources(scan.root, fingerprints);
        rows.push(row); items.push({ row, fingerprints, template_hash: frame.hash, output, material,line_widths:{...lineWidths},companion_name:companionName,reference:reference?{rel:reference.rel,hash:reference.hash}:undefined,reference_scope:matching.map(item=>({rel:item.rel,hash:item.hash})) });
      }
      if (!nodes.length) warnings.push(`${rel}：没有可选择的模型主节点`);
    } catch (error) { checkCancelled();if (row) { row.eligible = false; row.message = errorText(error); if (!rows.includes(row)) rows.push(row); } else warnings.push(`${rel}：${errorText(error)}`); }
  }
  // Two roots from one file must not silently compete for the same output.
  const destinations = new Map<string, GenerationRow[]>();
  for (const row of rows) for (const output of row.output_paths) { const key = output.normalize('NFC').toLowerCase(); destinations.set(key, [...(destinations.get(key) || []), row]); }
  for (const group of destinations.values()) if (group.length > 1) for (const row of group) { row.eligible = false; row.message = '多个候选节点使用同一输出；请到单件详情确认主节点'; }
  const now = Date.now(); for (const [id, plan] of plans) if (plan.expires <= now) plans.delete(id);
  if (plans.size >= 8) plans.delete(plans.keys().next().value!);
  const plan_id = randomUUID(), expires = now + TTL;
  checkCancelled();plans.set(plan_id, { root: scan.root, expires, items:items.map(item=>({...item,row:structuredClone(item.row)})),allow_without_pdf:allowWithoutPdf });
  return { plan_id, workspace: scan.root, directory: scan.directory, recursive: scan.recursive, expires_at: new Date(expires).toISOString(), scanned: scan.scanned, rows, warnings };
}

export function startDrawingGeneration(workspace: string, input: { plan_id: string; ids: string[]; confirmed: boolean }) {
  const root = fcstdWorkspace(workspace), plan = plans.get(input.plan_id);
  if (!plan || plan.root !== root || plan.expires <= Date.now()) throw new Error('预览已失效，请重新预览');
  if (input.confirmed !== true || !Array.isArray(input.ids) || !input.ids.length) throw new Error('请勾选并确认新稿生成');
  const items = [...new Set(input.ids)].map(id => plan.items.find(item => item.row.id === id));
  if (items.some(item => !item?.row.eligible)) throw new Error('选择包含不可自动生成的项目');
  // All selections are verified before the accepted task writes anything.
  for (const item of items as Item[]) { if(!item.reference&&!plan.allow_without_pdf||item.reference&&fcstdFingerprint(fs.readFileSync(safeFcstdPath(root,item.reference.rel)))!==item.reference.hash)throw new Error('参考PDF已变化或缺失，请重新预览');verifyDrawingSources(root, item.fingerprints);assertDrawingGenerationSourceSafety(root,item.fingerprints); assertDrawingOutputPlanAbsent(item.output); if (validateDrawingTemplate(item.row.template_root,item.row.template,item.row.paper).hash !== item.template_hash) throw new Error('图框模板已变化，请重新预览'); }
  const job=startBatchJob(root,'generation',(items as Item[]).map(item => ({ ...item,id:item.row.id,rel:item.row.rel })),async(item,signal):Promise<DrawingBatchResult> => {
    await verifyReferenceSelection(root,item,signal);
    const job = startDrawing({ workspace:root,rel:item.row.rel,node:item.row.node,template_root:item.row.template_root,template:item.row.template,
      paper:item.row.paper,scale:item.row.scale,output:relPath(root,item.output.drawing),companion_name:item.companion_name,fingerprints:item.fingerprints,template_hash:item.template_hash,reference_pdf:item.reference?.rel,reference_hash:item.reference?.hash,defaults:{material:item.material,...item.line_widths} });
    const done = await waitDrawingJob(root,job.id,{signal});
    return { id:item.id,rel:item.rel,status:done.status === 'completed' ? 'completed' : done.status === 'cancelled' ? 'cancelled' : 'failed',message:done.error || '研究新稿已生成；必须工程审核',outputs:done.outputs,warnings:done.warnings,manual_review_required:true };
  });
  plans.delete(input.plan_id);
  return job;
}
