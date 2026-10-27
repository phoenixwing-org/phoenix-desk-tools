import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCadIdentity } from '../../../../shared/cad-companion/model.js';
import type { CompanionRequest } from '../../../../shared/cad-companion/contracts.js';
import * as filesystem from './filesystem.js';
import { discoverCompanionDocuments, readCompanionText } from './discovery.js';

const roots:string[]=[];
const BASE='R001.007P1-Independent-block';
function write(root:string,rel:string,content:string|Uint8Array='Independent synthetic note'):string{
  const filename=path.join(root,rel);fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,content);return filename;
}
function fixture(overrides:Partial<CompanionRequest>={}){
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'cad-companion-discovery-')));roots.push(root);
  const source_rel=overrides.source_rel??`models/${BASE}.FCStd`;write(root,source_rel,'Synthetic CAD placeholder; never parsed or opened by Native');
  const request:CompanionRequest={source_rel,identity:parseCadIdentity(path.posix.basename(source_rel)),purpose:'drawing_notes',...overrides};
  if(request.drawing_rel)write(root,request.drawing_rel,'Synthetic drawing placeholder');return {root,request};
}
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

describe('D0 companion discovery and inert reads',()=>{
  it('lists all three purposes for the exact binding and selects only the requested purpose',async()=>{
    const {root,request}=fixture();for(const purpose of ['模型说明','出图说明','开发文档'])write(root,`models/${BASE}-${purpose}.md`,purpose);
    const result=await discoverCompanionDocuments(root,request);expect(result.status).toBe('unique');expect(result.scope_complete).toBe(true);
    expect(result.candidates.map(candidate=>candidate.purpose).sort()).toEqual(['development_doc','drawing_notes','model_notes']);
    expect(result.selected_rel).toBe(`models/${BASE}-出图说明.md`);expect(result.proposed_rel).toBe(result.selected_rel);
    expect(result.candidates.every(candidate=>candidate.read_status==='readable'&&candidate.sha256?.length===64)).toBe(true);
  });
  it('preserves old and new equal-content aliases without a filename priority',async()=>{
    const {root,request}=fixture();const rels=[`models/${BASE}-出图说明.md`,`models/${BASE}.Drawing.ai.md`];for(const rel of rels)write(root,rel,'same bytes');
    const result=await discoverCompanionDocuments(root,request);expect(result.status).toBe('aliases_equal');expect(result.candidates.map(c=>c.rel).sort()).toEqual(rels.sort());
    expect(result.candidates.map(c=>c.naming).sort()).toEqual(['drawing_ai','purpose_v1']);expect(new Set(result.candidates.map(c=>c.sha256))).toEqual(new Set([hash('same bytes')]));
  });
  it('reports different same-purpose contents as conflict and never selects one',async()=>{
    const {root,request}=fixture();write(root,`models/${BASE}-出图说明.md`,'new content');write(root,`models/${BASE}.Drawing.ai.md`,'old retained content');
    const result=await discoverCompanionDocuments(root,request);expect(result.status).toBe('conflict');expect(result.candidates).toHaveLength(2);expect(result.selected_rel).toBeUndefined();
  });
  it('keeps bare Markdown unknown and visible until an explicit alias assigns its purpose',async()=>{
    const {root,request}=fixture(),bare=`models/${BASE}.md`,purpose=`models/${BASE}-出图说明.md`;write(root,bare,'same');write(root,purpose,'same');
    let result=await discoverCompanionDocuments(root,request);expect(result.status).toBe('manual');expect(result.candidates.find(c=>c.rel===bare)).toMatchObject({purpose:'unknown',naming:'bare',read_status:'readable'});
    result=await discoverCompanionDocuments(root,{...request,explicit_aliases:[{rel:bare,purpose:'drawing_notes'}]});
    expect(result.status).toBe('aliases_equal');expect(result.candidates.find(c=>c.rel===bare)).toMatchObject({purpose:'drawing_notes',naming:'explicit_alias'});
  });
  it('reads only direct adjacent/authorized directories and exact explicit aliases, never recursively',async()=>{
    const {root,request}=fixture();write(root,`models/nested/${BASE}-出图说明.md`,'not recursively discovered');write(root,`notes/${BASE}-出图说明.md`,'authorized');write(root,'other/reviewed-bridge.md','explicit alias');
    expect((await discoverCompanionDocuments(root,request)).status).toBe('missing');
    let result=await discoverCompanionDocuments(root,{...request,notes_directories:['notes']});expect(result.selected_rel).toBe(`notes/${BASE}-出图说明.md`);
    result=await discoverCompanionDocuments(root,{...request,explicit_aliases:[{rel:'other/reviewed-bridge.md',purpose:'drawing_notes'}]});expect(result.status).toBe('unique');expect(result.candidates.map(c=>c.rel)).toEqual(['other/reviewed-bridge.md']);
  });
  it('discovers an explicitly bound drawing neighbor without scanning another directory with the same identity',async()=>{
    const drawing_rel=`drawings/${BASE}.Drawing.FCStd`,{root,request}=fixture({drawing_rel});write(root,`drawings/${BASE}-出图说明.md`);write(root,`unrelated/${BASE}-出图说明.md`,'not in scope');
    const result=await discoverCompanionDocuments(root,request);expect(result.status).toBe('unique');expect(result.candidates.map(c=>c.rel)).toEqual([`drawings/${BASE}-出图说明.md`]);
  });
  it('distinguishes empty content from a missing explicit alias',async()=>{
    const {root,request}=fixture(),empty=`models/${BASE}-出图说明.md`;write(root,empty,'');
    let result=await discoverCompanionDocuments(root,request);expect(result.status).toBe('unique');expect(result.candidates[0]).toMatchObject({bytes:0,sha256:hash(''),read_status:'readable'});
    expect(await readCompanionText(root,empty,hash(''))).toMatchObject({text:'',bytes:0,content_type:'text/plain; charset=utf-8'});
    result=await discoverCompanionDocuments(root,{...request,explicit_aliases:[{rel:'models/missing.md',purpose:'drawing_notes'}]});
    expect(result.status).toBe('manual');expect(result.candidates.find(c=>c.rel.endsWith('missing.md'))).toMatchObject({read_status:'unreadable',sha256:null,bytes:null});
  });
  it('keeps invalid UTF-8, oversize and non-regular candidates in the visible result with nullable hashes',async()=>{
    const {root,request}=fixture(),bad=`models/${BASE}-出图说明.md`,large=`models/${BASE}.Drawing.ai.md`,directory=`models/${BASE}.md`;
    write(root,bad,Buffer.from([0xff,0xfe]));write(root,large,Buffer.alloc(2*1024*1024+1,65));fs.mkdirSync(path.join(root,directory));
    const result=await discoverCompanionDocuments(root,request);expect(result.status).toBe('manual');expect(result.candidates).toHaveLength(3);
    expect(result.candidates.find(c=>c.rel===bad)).toMatchObject({read_status:'invalid_encoding',sha256:null});
    expect(result.candidates.find(c=>c.rel===large)).toMatchObject({read_status:'unreadable',sha256:null});expect(result.candidates.find(c=>c.rel===directory)).toMatchObject({read_status:'unsafe',sha256:null});
  });
  it('does not follow a symbolic Markdown file or symbolic authorized directory',async()=>{
    const {root,request}=fixture(),target=write(root,'outside-scope/untouched.md','not loaded'),rel=`models/${BASE}-出图说明.md`;fs.symlinkSync(target,path.join(root,rel));
    let result=await discoverCompanionDocuments(root,request);expect(result.status).toBe('manual');expect(result.candidates[0]).toMatchObject({read_status:'unsafe',sha256:null});
    fs.symlinkSync(path.join(root,'outside-scope'),path.join(root,'alias-dir'));result=await discoverCompanionDocuments(root,{...request,notes_directories:['alias-dir']});expect(result.scope_complete).toBe(false);expect(result.status).toBe('manual');
    expect(fs.readFileSync(target,'utf8')).toBe('not loaded');
  });
  it('refuses path escapes, control characters and contradictory aliases before reading content',async()=>{
    const {root,request}=fixture(),read=vi.spyOn(filesystem,'readDocument');
    for(const source_rel of ['../escape.FCStd','/absolute.FCStd','models/bad\u0000.FCStd'])await expect(discoverCompanionDocuments(root,{...request,source_rel})).rejects.toMatchObject({code:'unsafe'});
    await expect(discoverCompanionDocuments(root,{...request,explicit_aliases:[{rel:'../outside.md',purpose:'drawing_notes'}]})).rejects.toMatchObject({code:'unsafe'});
    await expect(discoverCompanionDocuments(root,{...request,explicit_aliases:[{rel:'models/a.md',purpose:'drawing_notes'},{rel:'models/a.md',purpose:'model_notes'}]})).rejects.toMatchObject({code:'unsafe'});expect(read).not.toHaveBeenCalled();
  });
  it('keeps variant and initial-draft identities separate, including unknown variants',async()=>{
    const {root,request}=fixture();for(const variant of ['P','P1','P2'])write(root,`models/R001.007${variant}-Independent-block-出图说明.md`,variant);
    let result=await discoverCompanionDocuments(root,request);expect(result.status).toBe('unique');expect(result.candidates).toHaveLength(1);expect(result.candidates[0].rel).toContain('007P1');
    write(root,`models/${BASE}-初稿02-出图说明.md`,'draft two');result=await discoverCompanionDocuments(root,{...request,draft_sequence:2});expect(result.status).toBe('unique');expect(result.selected_rel).toContain('初稿02');
    const unknown=fixture({source_rel:'models/R001.007Q9-Independent-block.FCStd'});write(unknown.root,'models/R001.007Q9-Independent-block-出图说明.md');
    result=await discoverCompanionDocuments(unknown.root,unknown.request);expect(result.status).toBe('manual');expect(result.candidates).toHaveLength(1);expect(result.selected_rel).toBeUndefined();
  });
  it('does not rebind a drawing of another role or draft to the requested identity',async()=>{
    const {root,request}=fixture({drawing_rel:`drawings/${BASE}-初稿02.Drawing.FCStd`,draft_sequence:3});write(root,`models/${BASE}-初稿03-出图说明.md`);
    expect((await discoverCompanionDocuments(root,request)).status).toBe('manual');
    const wrong={...request,drawing_rel:request.source_rel,draft_sequence:1};write(root,`models/${BASE}-出图说明.md`);expect((await discoverCompanionDocuments(root,wrong)).status).toBe('manual');
  });
  it('recognizes both the explicitly reviewed name override and retained old names',async()=>{
    const {root,request}=fixture();write(root,`models/${BASE}-出图说明.md`,'old');write(root,'models/R001.007P1-Reviewed-name-出图说明.md','new');
    const result=await discoverCompanionDocuments(root,{...request,name_override:'Reviewed-name'});expect(result.status).toBe('conflict');expect(result.candidates).toHaveLength(2);expect(result.proposed_rel).toBe('models/R001.007P1-Reviewed-name-出图说明.md');
  });
  it('shows case-only potential identity aliases as manual rather than hiding or folding them',async()=>{
    const {root,request}=fixture(),rel='models/r001.007p1-independent-block-出图说明.md';write(root,rel);
    let result=await discoverCompanionDocuments(root,request);expect(result.status).toBe('manual');expect(result.candidates.map(c=>c.rel)).toEqual([rel]);expect(result.selected_rel).toBeUndefined();
    result=await discoverCompanionDocuments(root,{...request,explicit_aliases:[{rel,purpose:'drawing_notes'}]});expect(result.status).toBe('unique');
  });
  it('shows NFC-only potential aliases as manual without rewriting their paths',async()=>{
    const source_rel='models/R001.007P1-Café.FCStd',{root,request}=fixture({source_rel}),rel='models/R001.007P1-Cafe\u0301-出图说明.md';write(root,rel);
    const result=await discoverCompanionDocuments(root,request);expect(result.status).toBe('manual');expect(result.candidates).toHaveLength(1);expect(result.candidates[0].rel).toBe(rel);expect(result.selected_rel).toBeUndefined();
  });
  it('never proves uniqueness from a directory truncated at the 2000-entry budget',async()=>{
    const {root,request}=fixture(),rel=`models/${BASE}-出图说明.md`;write(root,rel);for(let i=0;i<1998;i++)write(root,`models/entry-${i}.txt`,'x');
    expect((await discoverCompanionDocuments(root,request)).status).toBe('unique');write(root,'models/over-budget.txt','x');
    const result=await discoverCompanionDocuments(root,request);expect(result.status).toBe('manual');expect(result.scope_complete).toBe(false);expect(result.selected_rel).toBeUndefined();expect(result.diagnostics.some(d=>d.code==='entry_limit')).toBe(true);
  });
  it('shares the directory-entry budget across separately authorized directories',async()=>{
    const {root,request}=fixture();write(root,`notes-a/${BASE}-出图说明.md`);for(let i=0;i<999;i++)write(root,`notes-a/a-${i}.txt`,'x');for(let i=0;i<1000;i++)write(root,`notes-b/b-${i}.txt`,'x');
    const result=await discoverCompanionDocuments(root,{...request,notes_directories:['notes-a','notes-b']});expect(result.status).toBe('manual');expect(result.scope_complete).toBe(false);expect(result.selected_rel).toBeUndefined();
  });
  it('stops before reading a candidate set larger than 100 and reports manual',async()=>{
    const {root,request}=fixture(),read=vi.spyOn(filesystem,'readDocument');write(root,`models/${BASE}-出图说明.md`);
    const explicit_aliases=Array.from({length:100},(_,i)=>({rel:`notes/reviewed-${i}.md`,purpose:'drawing_notes' as const}));
    const result=await discoverCompanionDocuments(root,{...request,explicit_aliases});expect(result.status).toBe('manual');expect(result.scope_complete).toBe(false);expect(result.candidates).toEqual([]);expect(read).not.toHaveBeenCalled();
    expect((await discoverCompanionDocuments(root,{...request,explicit_aliases:[...explicit_aliases,{rel:'notes/extra.md',purpose:'drawing_notes'}]})).status).toBe('manual');
  });
  it('detects candidates added while another document is being read',async()=>{
    const {root,request}=fixture(),rel=`models/${BASE}-出图说明.md`,original=filesystem.readDocument;write(root,rel,'first');let changed=false;
    vi.spyOn(filesystem,'readDocument').mockImplementation((...args)=>{const value=original(...args);if(!changed){changed=true;write(root,`models/${BASE}.Drawing.ai.md`,'second');}return value;});
    const result=await discoverCompanionDocuments(root,request);expect(result.status).toBe('manual');expect(result.scope_complete).toBe(false);expect(result.selected_rel).toBeUndefined();expect(result.diagnostics.some(d=>d.code==='directory_changed')).toBe(true);
  });
  it.each(['aliases_equal','unique'] as const)('rejects a stale %s proof when already-read A is edited in place before B is read',async(expectedBeforeEdit)=>{
    const {root,request}=fixture(),a=`models/${BASE}-出图说明.md`,b=expectedBeforeEdit==='aliases_equal'?`models/${BASE}.Drawing.ai.md`:`models/${BASE}-模型说明.md`;
    write(root,a,'same bytes');write(root,b,'same bytes');
    const directoryBefore=filesystem.listDirectory(root,'models'),original=filesystem.readDocument;let readA=false,changed=false;
    vi.spyOn(filesystem,'readDocument').mockImplementation((...args)=>{
      if(args[1]===b&&readA&&!changed){fs.writeFileSync(path.join(root,a),'edit bytes');changed=true;}
      const value=original(...args);if(args[1]===a)readA=true;return value;
    });
    const result=await discoverCompanionDocuments(root,request);
    expect(changed).toBe(true);expect(fs.readFileSync(path.join(root,a),'utf8')).toBe('edit bytes');
    expect(filesystem.listDirectory(root,'models')).toEqual(directoryBefore); // No directory/name change can expose this edit.
    expect(result.status).toBe('manual');expect(result.scope_complete).toBe(true);expect(result.selected_rel).toBeUndefined();
    expect(result.candidates.find(c=>c.rel===a)).toMatchObject({read_status:'unreadable',sha256:null,bytes:null});
    expect(result.diagnostics.some(d=>d.code==='candidate_changed')).toBe(true);expect(result.diagnostics.some(d=>d.code==='directory_changed')).toBe(false);
  });
  it('rejects equality when an already-read candidate becomes invalid UTF-8 before final content revalidation',async()=>{
    const {root,request}=fixture(),a=`models/${BASE}-出图说明.md`,b=`models/${BASE}.Drawing.ai.md`,original=filesystem.readDocument;
    write(root,a,'same bytes');write(root,b,'same bytes');const directoryBefore=filesystem.listDirectory(root,'models');let readA=false,changed=false;
    vi.spyOn(filesystem,'readDocument').mockImplementation((...args)=>{
      if(args[1]===b&&readA&&!changed){fs.writeFileSync(path.join(root,a),Buffer.from([0xff,0xfe]));changed=true;}
      const value=original(...args);if(args[1]===a)readA=true;return value;
    });
    const result=await discoverCompanionDocuments(root,request);
    expect(changed).toBe(true);expect(filesystem.listDirectory(root,'models')).toEqual(directoryBefore);
    expect(result.status).toBe('manual');expect(result.selected_rel).toBeUndefined();
    expect(result.candidates.find(c=>c.rel===a)).toMatchObject({read_status:'invalid_encoding',sha256:null,bytes:null});
    expect(result.diagnostics.some(d=>d.code==='candidate_changed')).toBe(true);
  });
  it('checks directory proofs after final content revalidation rather than before it',async()=>{
    const {root,request}=fixture(),a=`models/${BASE}-出图说明.md`,b=`models/${BASE}.Drawing.ai.md`,original=filesystem.readDocument;write(root,a,'same bytes');let reads=0;
    vi.spyOn(filesystem,'readDocument').mockImplementation((...args)=>{const value=original(...args);if(args[1]===a&&++reads===2)write(root,b,'same bytes');return value;});
    const result=await discoverCompanionDocuments(root,request);
    expect(reads).toBe(2);expect(fs.readFileSync(path.join(root,b),'utf8')).toBe('same bytes');
    expect(result.status).toBe('manual');expect(result.scope_complete).toBe(false);expect(result.selected_rel).toBeUndefined();expect(result.diagnostics.some(d=>d.code==='directory_changed')).toBe(true);
  });
  it('propagates cancellation during final content revalidation without returning a selection',async()=>{
    const {root,request}=fixture(),rel=`models/${BASE}-出图说明.md`,original=filesystem.readDocument,controller=new AbortController();write(root,rel,'same bytes');let reads=0;
    vi.spyOn(filesystem,'readDocument').mockImplementation((...args)=>{if(args[1]===rel&&++reads===2)controller.abort();return original(...args);});
    await expect(discoverCompanionDocuments(root,request,controller.signal)).rejects.toMatchObject({code:'cancelled'});expect(reads).toBe(2);
  });
  it('revalidates the exact discovered SHA before returning inert text and leaves all source bytes unchanged',async()=>{
    const {root,request}=fixture(),rel=`models/${BASE}-出图说明.md`,body='<script>not executed</script>\n![remote](https://invalid.example/image.png)';write(root,rel,body);
    const source=fs.readFileSync(path.join(root,request.source_rel)),result=await discoverCompanionDocuments(root,request),sha=result.candidates[0].sha256!;
    expect(await readCompanionText(root,rel,sha)).toEqual({rel,text:body,sha256:hash(body),bytes:Buffer.byteLength(body),content_type:'text/plain; charset=utf-8'});
    expect(fs.readFileSync(path.join(root,request.source_rel))).toEqual(source);expect(fs.readFileSync(path.join(root,rel),'utf8')).toBe(body);
    write(root,rel,'external edit');await expect(readCompanionText(root,rel,sha)).rejects.toMatchObject({code:'changed'});await expect(readCompanionText(root,rel,'')).rejects.toMatchObject({code:'unsafe'});
  });
  it('propagates cancellation without returning a partial selected result or text',async()=>{
    const {root,request}=fixture(),rel=`models/${BASE}-出图说明.md`;write(root,rel,'text');const controller=new AbortController();controller.abort();
    await expect(discoverCompanionDocuments(root,request,controller.signal)).rejects.toMatchObject({code:'cancelled'});await expect(readCompanionText(root,rel,hash('text'),controller.signal)).rejects.toMatchObject({code:'cancelled'});
  });
});
