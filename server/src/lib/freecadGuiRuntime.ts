import fs from 'node:fs';
import path from 'node:path';
import {runtimeUserDataDir} from './appRuntimePaths.js';

export interface FreecadGuiRuntime {executable:string;installationRoot:string;templates:string}
const inside=(root:string,file:string)=>{const rel=path.relative(root,file);return rel===''||!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);};
function configuredRoot():string {
 try{const value:unknown=JSON.parse(fs.readFileSync(path.join(runtimeUserDataDir(),'launcher-prefs.json'),'utf8')).freecad_dir;return typeof value==='string'&&path.isAbsolute(value)?value:'';}catch{return '';}
}
/** GUI and default stock templates must come from the same usable installation.
 * Explicit custom-template selection remains a separate caller-owned choice. */
export function resolveFreecadGuiRuntime():FreecadGuiRuntime {
 const configured=configuredRoot();
 const candidates=[
  ...(configured?['Contents/Resources/bin/freecad','bin/FreeCAD.exe','bin/freecad'].map(rel=>({root:configured,file:path.join(configured,rel)})):[]),
  {root:'/Applications/FreeCAD.app',file:'/Applications/FreeCAD.app/Contents/Resources/bin/freecad'},
  {root:'/usr',file:'/usr/bin/freecad'},
 ];
 for(const candidate of candidates)try{
  const installationRoot=fs.realpathSync(candidate.root),executable=fs.realpathSync(candidate.file);
  if(!fs.statSync(installationRoot).isDirectory()||!inside(installationRoot,executable)||!fs.lstatSync(executable).isFile())continue;
  fs.accessSync(executable,fs.constants.X_OK);
  // Never obtain templates from a rejected preference or another installation.
  const locations=['Contents/Resources/share/Mod/TechDraw/Templates','data/Mod/TechDraw/Templates','Mod/TechDraw/Templates','share/freecad/Mod/TechDraw/Templates','share/freecad/data/Mod/TechDraw/Templates'];
  let templates='';
  for(const rel of locations)try{const actual=fs.realpathSync(path.join(installationRoot,rel));if(inside(installationRoot,actual)&&fs.statSync(actual).isDirectory()){templates=actual;break;}}catch{/* This installation may not contain stock templates. */}
  return {executable,installationRoot,templates};
 }catch{/* Preserve the existing configured-first, system-fallback GUI order. */}
 throw new Error('未找到FreeCAD图形程序，请先设置FreeCAD安装目录');
}
