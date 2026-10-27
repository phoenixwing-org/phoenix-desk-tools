import type {ActionDescriptor,TaskDraft} from '../../../../shared/batch-tasks/contracts.js';
import {NATIVE_SAVED_SHAPE_ACTION_V3} from '../../../../shared/batch-tasks/native-protocol.js';
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** Routing only, never validation or Native execution authority. Mixed or
 * malformed Native definitions must reach the strict host profile validator. */
export function hasNativeTaskAction(value:unknown):boolean {
 return object(value)&&Array.isArray(value.actions)&&value.actions.some(action=>object(action)&&action.key===NATIVE_SAVED_SHAPE_ACTION_V3.key);
}
export function relativeFile(value:unknown):string {
 if(typeof value!=='string'||value.length>2048||/[\u0000-\u001f\u007f]/u.test(value)||/^[A-Za-z]:|^[\\/]/.test(value))throw new Error('请选择工作空间内的相对文件路径');
 const rel=value.replace(/\\/g,'/');
 if(rel.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.')||['node_modules','__pycache__'].includes(p)))throw new Error('首期不处理隐藏目录、缓存、空段或越界路径');
 return rel;
}
export function taskDraft(value:unknown,catalog:readonly ActionDescriptor[]):TaskDraft {
 if(hasNativeTaskAction(value))throw new Error('Native动作须由显式宿主配置与独立V3契约校验，不能按V2采集保存');
 if(!object(value)||Object.keys(value).some(k=>!['name','subjects','actions'].includes(k)))throw new Error('任务定义字段无效');
 if(typeof value.name!=='string'||!value.name.trim()||value.name.length>120||/[\u0000-\u001f]/u.test(value.name))throw new Error('任务名称须为1–120个字符');
 if(!Array.isArray(value.subjects)||value.subjects.length<1||value.subjects.length>200)throw new Error('请选择1–200个明确文件，不隐式扫描整个工作空间');
 const subjects=value.subjects.map(s=>{if(!object(s)||Object.keys(s).some(k=>!['kind','rel'].includes(k))||!['file','cad_model'].includes(String(s.kind)))throw new Error('输入对象无效');return {kind:s.kind as 'file'|'cad_model',rel:relativeFile(s.rel)};});
 if(new Set(subjects.map(s=>s.rel.normalize('NFC').toLowerCase())).size!==subjects.length)throw new Error('文件清单不能重复');
 if(!Array.isArray(value.actions)||!value.actions.length||value.actions.length>8)throw new Error('请选择1–8个动作');
 const actions=value.actions.map(a=>{if(!object(a)||Object.keys(a).some(k=>!['instance_id','key','version','params'].includes(k))||typeof a.instance_id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(a.instance_id)||!Number.isSafeInteger(a.version)||Number(a.version)<1||!catalog.some(d=>d.key===a.key&&d.version===a.version)||!object(a.params)||Object.keys(a.params).length)throw new Error('动作、版本或参数无效；仅开放注册的只读采集');return {instance_id:a.instance_id,key:String(a.key),version:Number(a.version),params:{}};});
 if(new Set(actions.map(a=>a.instance_id)).size!==actions.length)throw new Error('动作实例不能重复');
 return {name:value.name.trim(),subjects,actions};
}
