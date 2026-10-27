import {fcstdWorkspace} from '../../lib/fcstdBatchFiles.js';
import {consumeDrawingAudit} from './audit.js';
import {startBatchJob} from './batchJobs.js';
import {planMaintenance,verifyMaintenancePlan,applyMaintenance,MaintenancePublicationError} from '../drawing-research/maintenance.js';
import type {DrawingBatchJob} from './types.js';
import {DRAWING_REPAIR_MAX_ISSUES_PER_FILE} from './types.js';

export function startDrawingRepairs(workspace:string,input:{plan_id:string;selections:Array<{id:string;issue_ids:string[]}>;confirmed:true}):DrawingBatchJob{
 if(!input||input.confirmed!==true||typeof input.plan_id!=='string'||!Array.isArray(input.selections)||!input.selections.length||input.selections.length>500)throw new Error('请明确确认并选择修正项');
 const root=fcstdWorkspace(workspace),seen=new Set<string>();
 let job!:DrawingBatchJob;
 let items!:Array<{id:string;rel:string;baseline:ReturnType<typeof planMaintenance>;patches:NonNullable<ReturnType<typeof planMaintenance>['patches']>;remaining:number}>;
 consumeDrawingAudit(root,input.plan_id,plan=>{items=input.selections.map(selection=>{
  if(!selection||typeof selection.id!=='string'||seen.has(selection.id)||!Array.isArray(selection.issue_ids)||!selection.issue_ids.length||new Set(selection.issue_ids).size!==selection.issue_ids.length)throw new Error('修正选择无效或重复');seen.add(selection.id);
  if(selection.issue_ids.length>DRAWING_REPAIR_MAX_ISSUES_PER_FILE)throw new Error(`每份图纸最多选择 ${DRAWING_REPAIR_MAX_ISSUES_PER_FILE} 个修正项；请减少勾选，预览票据尚未消费`);
  const entry=plan.entries.get(selection.id);if(!entry?.native)throw new Error('文件不属于计划或没有安全修正计划');
  const patches=selection.issue_ids.map(id=>{const patch=entry.patches.get(id);if(!patch||!entry.row.issues.some(issue=>issue.id===id&&issue.status==='ready'))throw new Error('只能选择当前ready修正项；人工冲突不覆盖');return patch;});
  const remaining=entry.row.issues.filter(issue=>issue.status!=='ok'&&!selection.issue_ids.includes(issue.id)).length;
  return {id:selection.id,rel:entry.row.rel,baseline:entry.native,patches,remaining};
 });
 // Reserve the queue before consuming the ticket. A busy queue is not an
 // execution attempt, so the same still-fresh preview remains available.
 job=startBatchJob(root,'repair',items,async(item,signal)=>{
  verifyMaintenancePlan(item.baseline);
  const native=planMaintenance(item.baseline.input,{patches:item.patches,audit_config:item.baseline.audit_config});
  if(JSON.stringify(native.fingerprints)!==JSON.stringify(item.baseline.fingerprints))throw new Error('图纸或依赖已变化，请重新预览');
  let result:Awaited<ReturnType<typeof applyMaintenance>>;
  try{result=await applyMaintenance(native,{signal});}
  catch(error){
   if(error instanceof MaintenancePublicationError)return {id:item.id,rel:item.rel,status:signal.aborted?'cancelled':'failed',message:error.message,outputs:error.outputs,backup:error.backup,warnings:['发布或回滚未完全确认；请核对输出和备份，不要盲目重试'],manual_review_required:true};
   throw error;
  }
  const warnings=[...(result.warnings||[]),...(item.remaining?[`仍有 ${item.remaining} 项未修正/需人工确认（含未选隐藏元素）；未自动修改`]:[])];
  return {id:item.id,rel:item.rel,status:'completed',message:'所选修正已保存并原生重开验证；仍需人工视觉验收',outputs:result.outputs.map((o:{path:string})=>o.path),backup:result.backup,...(warnings.length?{warnings}:{}),manual_review_required:true};
 });});
 return job;
}
