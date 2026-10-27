import fs from 'node:fs';
import path from 'node:path';
import { setImmediate as yieldToHost } from 'node:timers/promises';
import type { CadNameIdentity, CompanionCandidate, CompanionDiagnostic, CompanionDiscoveryResult, CompanionPurpose,
  CompanionRequest, CompanionTextResult } from '../../../../shared/cad-companion/contracts.js';
import { parseCadIdentity, parseCompanionFilename, proposeCompanionFilename, sameCadBindingIdentity } from '../../../../shared/cad-companion/model.js';
import { assertNotCancelled, assertRoot, CompanionFsError, listDirectory, MAX_COMPANION_CANDIDATES,
  MAX_DIRECTORY_ENTRIES, readDocument, safeRelative, validateRelative } from './filesystem.js';

const PURPOSES:CompanionPurpose[]=['model_notes','drawing_notes','development_doc','unknown'];
type CandidateName=Pick<CompanionCandidate,'rel'|'purpose'|'naming'>;
type DirectoryProof={rel:string;limit:number;names:string[];complete:boolean;proof:string};
function diagnostic(code:string,message:string):CompanionDiagnostic{return {code,message};}
function invalid(message:string):never{throw new CompanionFsError('unsafe',message);}
function parent(rel:string):string{const directory=path.posix.dirname(rel);return directory==='.'?'':directory;}
function join(directory:string,name:string):string{return directory?`${directory}/${name}`:name;}
function directoryRel(value:string):string{return value===''||value==='.'?'':validateRelative(value);}
function checkedRequest(request:CompanionRequest):CompanionRequest{
  if(!request||typeof request!=='object'||!PURPOSES.includes(request.purpose)||!request.identity||typeof request.identity!=='object')invalid('伴随文档绑定无效');
  validateRelative(request.source_rel);if(request.drawing_rel!==undefined)validateRelative(request.drawing_rel);
  if(request.source_node!==undefined&&(typeof request.source_node!=='string'||!request.source_node||request.source_node.length>256||/[\u0000-\u001f\u007f]/u.test(request.source_node)))invalid('内部对象身份无效');
  if(request.draft_sequence!==undefined&&(!Number.isSafeInteger(request.draft_sequence)||request.draft_sequence<1||request.draft_sequence>9999))invalid('初稿序号无效');
  const identity=request.identity;
  if(typeof identity.name!=='string'||typeof identity.rawStem!=='string'||typeof identity.displayFilename!=='string'
    ||!['model','drawing','assembly','unknown'].includes(identity.role)||!['parsed','manual'].includes(identity.parseStatus)
    ||!['known','unknown','none'].includes(identity.variantStatus)
    ||[identity.number,identity.revisionRaw,identity.revision,identity.variantRaw].some(value=>value!==null&&typeof value!=='string')
    ||(identity.draftSequence!==null&&(!Number.isSafeInteger(identity.draftSequence)||identity.draftSequence<1)))invalid('名称身份字段无效');
  if(request.name_override!==undefined&&(typeof request.name_override!=='string'||!request.name_override||request.name_override.length>255))invalid('明确名称无效');
  if(request.notes_directories!==undefined&&!Array.isArray(request.notes_directories))invalid('说明目录无效');
  if((request.notes_directories?.length??0)>MAX_COMPANION_CANDIDATES)throw new CompanionFsError('limit','明确说明目录超过上限');
  for(const directory of request.notes_directories??[])directoryRel(directory);
  if(request.explicit_aliases!==undefined&&!Array.isArray(request.explicit_aliases))invalid('说明别名无效');
  if((request.explicit_aliases?.length??0)>MAX_COMPANION_CANDIDATES)throw new CompanionFsError('limit','明确说明别名超过上限');
  const aliases=new Map<string,CompanionPurpose>();
  for(const alias of request.explicit_aliases??[]){
    if(!alias||typeof alias!=='object'||!PURPOSES.includes(alias.purpose))invalid('说明别名用途无效');
    validateRelative(alias.rel);if(!/\.md$/i.test(alias.rel))invalid('说明别名必须是 Markdown');
    if(aliases.has(alias.rel)&&aliases.get(alias.rel)!==alias.purpose)invalid('同一说明别名不能绑定两个用途');aliases.set(alias.rel,alias.purpose);
  }
  return structuredClone(request);
}
function identityMatch(candidate:CadNameIdentity,binding:CompanionRequest):'exact'|'manual'|undefined{
  if((candidate.draftSequence??1)!==(binding.draft_sequence??binding.identity.draftSequence??1))return undefined;
  const identities=[binding.identity,...(binding.name_override!==undefined?[{...binding.identity,name:binding.name_override}]:[])];
  if(identities.some(identity=>sameCadBindingIdentity(candidate,identity)))return 'exact';
  const fold=(value:string|null)=>value===null?null:value.normalize('NFC').toLocaleLowerCase('en-US');
  const keys:readonly('number'|'revisionRaw'|'revision'|'variantRaw'|'name')[]=['number','revisionRaw','revision','variantRaw','name'];
  // Folding detects a possible collision only. It never establishes identity or
  // authorizes selection of a differently spelled name without an explicit alias.
  if(identities.some(identity=>candidate.rawStem===identity.rawStem||fold(candidate.rawStem)===fold(identity.rawStem)
    ||(candidate.number!==null&&candidate.revisionRaw!==null&&identity.number!==null&&identity.revisionRaw!==null
      &&keys.every(key=>fold(candidate[key])===fold(identity[key])))))return 'manual';
  return undefined;
}
function addReadFailure(error:unknown):Pick<CompanionCandidate,'read_status'|'sha256'|'bytes'|'diagnostics'>{
  if(error instanceof CompanionFsError&&error.code==='cancelled')throw error;
  const code=error instanceof CompanionFsError?error.code:'unreadable';
  const read_status=code==='unsafe'?'unsafe':code==='invalid_encoding'?'invalid_encoding':'unreadable';
  const message=code==='changed'?'说明在读取期间变化':code==='limit'?'说明超过 2 MiB 读取上限':code==='invalid_encoding'?'说明不是有效 UTF-8 文本':code==='unsafe'?'说明路径不是安全普通文件':'说明缺失或不可读取';
  return {read_status,sha256:null,bytes:null,diagnostics:[diagnostic(code,message)]};
}
function resolve(result:CompanionDiscoveryResult,forcedManual:boolean):void{
  const eligible=result.candidates.filter(candidate=>candidate.purpose===result.binding.purpose);
  const hashes=new Set(eligible.filter(candidate=>candidate.read_status==='readable').map(candidate=>candidate.sha256));
  if(!result.scope_complete){result.status='manual';return;}
  if(hashes.size>1){result.status='conflict';result.diagnostics.push(diagnostic('content_conflict','同用途候选内容不同，请逐项核对'));return;}
  if(forcedManual||result.binding.purpose==='unknown'||result.candidates.some(candidate=>candidate.purpose==='unknown')
    ||eligible.some(candidate=>candidate.read_status!=='readable')){result.status='manual';return;}
  if(!eligible.length){result.status='missing';return;}
  result.status=eligible.length===1?'unique':'aliases_equal';result.selected_rel=eligible[0].rel;
}

/** Discover only the declared adjacent directories and explicit aliases. No CAD or database is opened. */
export async function discoverCompanionDocuments(workspace:string,request:CompanionRequest,signal?:AbortSignal):Promise<CompanionDiscoveryResult>{
  assertNotCancelled(signal);const root=assertRoot(workspace);let binding:CompanionRequest;
  try{binding=checkedRequest(request);}catch(error){
    if(!(error instanceof CompanionFsError)||error.code!=='limit')throw error;
    return {version:1,binding:structuredClone(request),status:'manual',candidates:[],scope_complete:false,diagnostics:[diagnostic('candidate_limit','明确发现范围超过安全上限，未证明候选完整')]};
  }
  const result:CompanionDiscoveryResult={version:1,binding,status:'manual',candidates:[],scope_complete:true,diagnostics:[]};
  let forcedManual=binding.identity.parseStatus!=='parsed'||binding.identity.variantStatus==='unknown';
  if(forcedManual)result.diagnostics.push(diagnostic('identity_manual','名称身份需人工确认，未自动选择说明'));
  // These are only filename bindings. This service never claims that an XLink or source node was verified.
  for(const [role,rel] of [['source',binding.source_rel],['drawing',binding.drawing_rel]] as const){
    if(!rel)continue;
    try{
      const filename=safeRelative(root,rel);if(!fs.lstatSync(filename).isFile())throw new CompanionFsError('unsafe','绑定不是普通文件');
      const identity=parseCadIdentity(path.posix.basename(rel));
      if(!sameCadBindingIdentity(identity,binding.identity)||(role==='drawing'&&(identity.role!=='drawing'
          ||(identity.draftSequence??1)!==(binding.draft_sequence??binding.identity.draftSequence??1)))
        ||(role==='source'&&!['model','assembly'].includes(identity.role))){forcedManual=true;result.diagnostics.push(diagnostic('binding_identity_manual','源或图纸名称与声明身份无法唯一核对'));}
    }catch(error){if(error instanceof CompanionFsError&&error.code==='cancelled')throw error;forcedManual=true;result.diagnostics.push(diagnostic('binding_unavailable','源或图纸路径不可安全核对'));}
  }
  const proposal=proposeCompanionFilename(binding.identity,binding.purpose,{name:binding.name_override,draftSequence:binding.draft_sequence??binding.identity.draftSequence??1});
  if(proposal.diagnostics.some(item=>item.code==='draft_sequence_conflict')){forcedManual=true;result.diagnostics.push(...proposal.diagnostics);}
  if(proposal.status==='ready'&&proposal.filename){
    const proposed=join(parent(binding.purpose==='drawing_notes'&&binding.drawing_rel?binding.drawing_rel:binding.source_rel),proposal.filename);
    try{safeRelative(root,proposed,{allowMissingLeaf:true});result.proposed_rel=proposed;}catch{result.diagnostics.push(diagnostic('proposal_unavailable','建议路径不可安全使用'));}
  }
  const directories=[...new Set([parent(binding.source_rel),...(binding.drawing_rel?[parent(binding.drawing_rel)]:[]),...(binding.notes_directories??[]).map(directoryRel)])];
  const names=new Map<string,CandidateName>(),ambiguousNames=new Set<string>(),proofs:DirectoryProof[]=[];let entries=0,overflow=false;
  for(const directory of directories){
    await yieldToHost();assertNotCancelled(signal);
    try{
      const limit=MAX_DIRECTORY_ENTRIES-entries,listing=listDirectory(root,directory,limit);entries+=listing.names.length;
      proofs.push({rel:directory,limit,names:listing.names,complete:listing.complete,proof:listing.proof});
      if(!listing.complete){result.scope_complete=false;result.diagnostics.push(diagnostic('entry_limit','候选目录超过 2000 个直接条目，未证明候选完整'));}
      for(const name of listing.names){
        const parsed=parseCompanionFilename(name);if(!parsed)continue;const match=identityMatch(parsed.identity,binding);if(!match)continue;
        const rel=join(directory,name);names.set(rel,{rel,purpose:parsed.purpose,naming:parsed.naming});
        if(match==='manual')ambiguousNames.add(rel);
        if(names.size>MAX_COMPANION_CANDIDATES){overflow=true;break;}
      }
    }catch(error){if(error instanceof CompanionFsError&&error.code==='cancelled')throw error;result.scope_complete=false;result.diagnostics.push(diagnostic('directory_unavailable','明确候选目录不可完整读取'));}
    if(overflow)break;
  }
  for(const alias of binding.explicit_aliases??[]){names.set(alias.rel,{rel:alias.rel,purpose:alias.purpose,naming:'explicit_alias'});ambiguousNames.delete(alias.rel);if(names.size>MAX_COMPANION_CANDIDATES){overflow=true;break;}}
  if(overflow){result.scope_complete=false;result.diagnostics.push(diagnostic('candidate_limit','候选超过 100 个，未读取截断集合或证明唯一'));return result;}
  for(const name of [...names.values()].sort((a,b)=>a.rel<b.rel?-1:a.rel>b.rel?1:0)){
    await yieldToHost();assertNotCancelled(signal);
    const nameDiagnostics=ambiguousNames.has(name.rel)?[diagnostic('identity_alias_manual','名称身份不完全一致或仅大小写/NFC相似，需明确映射')]:[];
    try{const read=readDocument(root,name.rel,signal);result.candidates.push({...name,read_status:'readable',sha256:read.sha256,bytes:read.bytes,diagnostics:nameDiagnostics});}
    catch(error){const failure=addReadFailure(error);result.candidates.push({...name,...failure,diagnostics:[...nameDiagnostics,...failure.diagnostics]});}
  }
  // Directory stamps do not change when an existing file is edited in place.
  // Re-read every successful observation before resolving the candidate set;
  // neither a stale hash nor a failed second read may prove unique/equal content.
  let contentsCurrent=true;
  for(const candidate of result.candidates){
    if(candidate.read_status!=='readable')continue;
    await yieldToHost();assertNotCancelled(signal);
    try{
      const current=readDocument(root,candidate.rel,signal);
      if(current.sha256!==candidate.sha256||current.bytes!==candidate.bytes)throw new CompanionFsError('changed','说明在候选复核期间变化');
    }catch(error){
      const failure=addReadFailure(error);contentsCurrent=false;
      Object.assign(candidate,{...failure,diagnostics:[...candidate.diagnostics,...failure.diagnostics]});
    }
  }
  if(!contentsCurrent)result.diagnostics.push(diagnostic('candidate_changed','候选内容在发现后变化或不可复核，未自动选择说明'));
  for(const proof of proofs){
    assertNotCancelled(signal);
    try{const current=listDirectory(root,proof.rel,proof.limit);if(current.complete!==proof.complete||current.proof!==proof.proof||JSON.stringify(current.names)!==JSON.stringify(proof.names)){
      result.scope_complete=false;result.diagnostics.push(diagnostic('directory_changed','发现期间候选目录变化，未自动选择说明'));
    }}catch{result.scope_complete=false;result.diagnostics.push(diagnostic('directory_changed','发现期间候选目录变化，未自动选择说明'));}
  }
  if(ambiguousNames.size){forcedManual=true;result.diagnostics.push(diagnostic('identity_alias_manual','存在未明确映射的名称候选，未自动选择说明'));}
  assertNotCancelled(signal);
  if(!contentsCurrent){result.status='manual';delete result.selected_rel;return result;}
  resolve(result,forcedManual);return result;
}

/** Return inert UTF-8 text only after the exact discovered byte hash has been revalidated. */
export async function readCompanionText(workspace:string,rel:string,expectedSha:string,signal?:AbortSignal):Promise<CompanionTextResult>{
  assertNotCancelled(signal);validateRelative(rel);if(typeof expectedSha!=='string'||!/^[a-f0-9]{64}$/.test(expectedSha))invalid('读取说明需要明确 SHA256');
  const root=assertRoot(workspace);await yieldToHost();assertNotCancelled(signal);const read=readDocument(root,rel,signal);
  if(read.sha256!==expectedSha)throw new CompanionFsError('changed','说明指纹已变化，请重新发现候选');
  return {rel,text:read.text,sha256:read.sha256,bytes:read.bytes,content_type:'text/plain; charset=utf-8'};
}
