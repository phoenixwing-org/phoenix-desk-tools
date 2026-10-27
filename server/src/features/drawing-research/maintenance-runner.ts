import {nativeReferenceInspection,nativeSourceAssemblySafety} from './native-drawing-guards.js';
import {nativeCamera} from '../../lib/nativeCamera.js';
/** Internal reviewed mutations. HTTP clients select issue ids, never these patches. */
export type MaintenancePatch =
 | {kind:'label';object:string;current:string;proposed:string}
 | {kind:'text';object:string;field:string;current:string;proposed:string}
 | {kind:'property'|'view';object:string;field:'Font'|'FormatSpec'|'Visibility'|'LineWidth';current:string;proposed:string}
 | {kind:'link';object:string;current_file:string;current_node:string;proposed_file:string;proposed_node:string}
 | {kind:'resource';current:string;proposed:string;reference:string;proposed_reference:string};

const settleDrawing = String.raw`
def settle(d):
 import time,math
 d.recompute()
 started=time.monotonic();last=None;stable=started
 while time.monotonic()-started<60:
  QtWidgets.QApplication.processEvents();G.updateGui()
  views=[o for o in d.Objects if o.isDerivedFrom('TechDraw::DrawViewPart')]
  dimensions=[o for o in d.Objects if o.TypeId=='TechDraw::DrawViewDimension']
  try:
   if any(o.TypeId.startswith('TechDraw::') and any(s in ('Invalid','Error') for s in o.State) for o in d.Objects):raise RuntimeError('图纸对象存在失效状态')
   edges=[(o.Name,len(o.getVisibleEdges())) for o in views]
   values={o.Name:float(o.getRawValue()) for o in dimensions}
   if any(not math.isfinite(value) for value in values.values()):raise RuntimeError('尺寸实际值不是有限数值')
   signature=(edges,values)
   if signature!=last:last=signature;stable=time.monotonic()
   if all(count>0 for _,count in edges) and time.monotonic()-started>=4 and time.monotonic()-stable>=2:
    return values
  except Exception:last=None;stable=time.monotonic()
  time.sleep(0.1)
 raise RuntimeError('图纸视图或尺寸未稳定，保留源文件')
`;
// Identical primary/final-reopen preservation checks, excluding only runtime
// render caches. Object identities use Name, never stage-dependent doc names.
const preservationSnapshots = String.raw`
def snapshot(d):
 rows=[]
 for o in d.Objects:
  if not o.TypeId.startswith('TechDraw::') or o.TypeId=='TechDraw::DrawSVGTemplate':continue
  v={'name':o.Name,'type':o.TypeId}
  for p in ('X','Y','Scale','ScaleType','Direction','XDirection','Type','FormatSpec','FormatSpecOverTolerance','FormatSpecUnderTolerance','References2D','Text','Rotation','Font','Fontsize','FontSize','TextSize','ProjectionType','Template','Views','Source','BaseView','SectionOrigin','SectionNormal','SectionDirection','SectionSymbol','Radius','Reference','Inverted','Visibility','OverTolerance','UnderTolerance','EqualTolerance','Arbitrary','TheoreticalExact','Decimals','ShowUnit','LockPosition'):
   if p in o.PropertiesList:
    value=getattr(o,p)
    if p=='References2D':value=[[x.Name,list(s)] for x,s in value]
    elif p in ('Template','BaseView'):value=None if value is None else value.Name
    elif p in ('Views','Source'):value=[x.Name for x in value]
    elif isinstance(value,(list,tuple)):value=list(value)
    else:value=str(value)
    v[p]=value
  for p in ('Visibility','ShowFrames','Font','Fontsize','FontSize','LineWidth','HiddenWidth','ExtraWidth','IsoWidth','Color','LineColor','HiddenColor','TextColor','ArrowSize','ExtensionGap','ExtensionLineExtend','StandardAndStyle'):
   if p in o.ViewObject.PropertiesList:v['view_'+p]=str(getattr(o.ViewObject,p))
  rows.append(v)
 return rows

def metadata_snapshot(d):
 rows=[]
 for o in d.Objects:
  v={'name':o.Name,'label':o.Label}
  if o.TypeId=='TechDraw::DrawSVGTemplate':v['texts']=dict(o.EditableTexts)
  if o.TypeId.startswith('TechDraw::'):
   for p in ('Visibility',):
    if p in o.PropertiesList:v[p]=str(getattr(o,p))
    if p in o.ViewObject.PropertiesList:v['view_'+p]=str(getattr(o.ViewObject,p))
  if o.TypeId=='App::Link':v['visible']=bool(o.Visibility)
  for p in ('Font','Fontsize','FontSize'):
   if p in o.ViewObject.PropertiesList:v['view_'+p]=str(getattr(o.ViewObject,p))
  rows.append(v)
 return rows

def verify_exact_effects(before,metadata,d):
 import json
 # A setter may trigger other setters. Compare against the ORIGINAL snapshots,
 # allowing only selected fields (and the verified visibility alias endpoints),
 # never promote an arbitrary after-patch state to the preservation baseline.
 expected=json.loads(json.dumps(before));expected_meta=json.loads(json.dumps(metadata))
 views={row['name']:row for row in expected};objects={row['name']:row for row in expected_meta}
 for patch in spec['patches']:
  kind=patch['kind']
  if kind in ('resource','link'):continue
  name=patch['object'];value=patch['proposed'];row=objects[name]
  if kind=='label':row['label']=value
  elif kind=='text':row['texts'][patch['field']]=value
  elif kind in ('property','view'):
   field=patch['field'];key=('view_' if kind=='view' else '')+field
   if field=='Visibility':
    value='True' if value=='true' else 'False'
    for keys in (row,views.get(name,{})):
     for alias in ('Visibility','view_Visibility'):
      if alias in keys:keys[alias]=value
   else:
    if field=='LineWidth':value=str(A.Units.Quantity(patch['proposed']+' mm'))
    if key in row:row[key]=value
    if name in views and key in views[name]:views[name][key]=value
 if metadata_snapshot(d)!=expected_meta or snapshot(d)!=expected:raise RuntimeError('精确修正改变了未选择的布局/字体/文字/标签/可见性；保留源文件')
 return expected,expected_meta
`;
// Diagnostics never make a mutation permissible. No progress, document cleanup
// or GUI exit is attempted before the parent-created PID+nonce marker matches.
const nativeDiagnostics = String.raw`
owned=False
current_phase=''
def own_process():
 started=time.monotonic()
 while not os.path.isfile(spec['native_owner_file']) and time.monotonic()-started<5:time.sleep(0.02)
 owner=json.load(open(spec['native_owner_file'],encoding='utf8'))
 if owner.get('pid')!=os.getpid() or owner.get('nonce')!=spec['native_nonce']:raise RuntimeError('原生进程归属未确认；未打开或修改图纸')

def mark_progress(value):
 global current_phase
 if not owned:raise RuntimeError('进程归属未确认；禁止报告任务阶段')
 current_phase=('verify_' if spec.get('native_verify') else '')+value
 temporary=spec['native_progress']+'.tmp'
 with open(temporary,'w',encoding='utf8') as f:json.dump({'phase':current_phase,'native_pid':os.getpid(),'native_nonce':spec['native_nonce']},f,ensure_ascii=False)
 os.replace(temporary,spec['native_progress'])

def cleanup_error(result,step,error):
 message=step+': '+str(error)
 result.setdefault('cleanup_errors',[]).append(message)
 if result.get('status')!='failed':result['status']='failed';result['error']=message;result['phase']=current_phase

def write_report(result,key):
 try:
  temporary=spec[key]+'.tmp'
  with open(temporary,'w',encoding='utf8') as f:json.dump(result,f,ensure_ascii=False,indent=2)
  os.replace(temporary,spec[key])
  return True
 except Exception as error:
  cleanup_error(result,'验收报告写入失败',error);traceback.print_exc();return False

def finish_native(result,key):
 result.update(native_pid=os.getpid(),native_nonce=spec['native_nonce'],phase=current_phase)
 # Persist failure (or a deliberately non-successful finishing receipt) BEFORE
 # any close call: one broken document cannot swallow the original evidence.
 initial=dict(result)
 if initial.get('status')=='completed':initial['status']='finalizing'
 if owned:
  try:mark_progress('writing_report')
  except Exception as error:cleanup_error(result,'报告阶段写入失败',error);initial=dict(result)
 if not write_report(initial,key):cleanup_error(result,'初始验收报告写入失败',RuntimeError('未确认报告落盘'))
 try:
  if owned:
   try:mark_progress('closing_owned_documents')
   except Exception as error:cleanup_error(result,'关闭阶段写入失败',error)
   try:documents=list(A.listDocuments().values())
   except Exception as error:cleanup_error(result,'本任务文档枚举失败',error);documents=[]
   for doc in documents:
    try:A.closeDocument(doc.Name)
    except Exception as error:cleanup_error(result,'本任务文档关闭失败',error)
   observations=globals().get('native_solver_observations',[])
   if observations:
    cleanup_error(result,'源装配求解入口已触发',RuntimeError('不确认维护/检查成功；保持原件，需人工核对'))
    if 'source_safety' in result:result['source_safety'].update(status='manual',source_poses_and_actual_frames_unchanged=False,solver_observations=list(observations))
   if result.get('status')=='completed':
    try:mark_progress('completed');result['phase']=current_phase
    except Exception as error:cleanup_error(result,'完成阶段写入失败',error)
  write_report(result,key)
 finally:
  if owned:
   try:
    app=QtWidgets.QApplication.instance()
    if app is None:raise RuntimeError('本任务Qt应用不可用')
    try:QtCore.QTimer.singleShot(0,app.quit)
    except Exception as error:
     cleanup_error(result,'退出调度失败',error);write_report(result,key);app.quit()
   except Exception as error:cleanup_error(result,'本任务退出失败',error);write_report(result,key);traceback.print_exc()
`;
export const maintenanceNativeDiagnostics = nativeDiagnostics;
const thumbnailVerification = String.raw`
def verify_maintenance_thumbnail(png_bytes,digest):
 import hashlib,struct
 if len(png_bytes)<45 or len(png_bytes)>4*1024*1024 or png_bytes[:8]!=b'\x89PNG\r\n\x1a\n':raise RuntimeError('最终内嵌图纸缩略图格式/大小无效')
 if hashlib.sha256(png_bytes).hexdigest()!=digest:raise RuntimeError('最终内嵌图纸缩略图散列变化')
 width,height=struct.unpack('>II',png_bytes[16:24])
 if not width or not height or width>4096 or height>4096 or width*height>4*1024*1024:raise RuntimeError('最终内嵌图纸缩略图尺寸超限')
 image=QtGui.QImage.fromData(png_bytes)
 if image.isNull() or image.width()!=width or image.height()!=height:raise RuntimeError('最终内嵌图纸缩略图无法真实解码')
 def visible_pixel(x,y):
  color=image.pixelColor(x,y);alpha=color.alpha()
  return tuple(round((value*alpha+255*(255-alpha))/255) for value in (color.red(),color.green(),color.blue()))
 first=visible_pixel(0,0)
 if not any(visible_pixel(x,y)!=first for y in range(height) for x in range(width)):raise RuntimeError('最终内嵌图纸缩略图为单色空白')
`;
// The preservation whitelist describes paper objects, not an assembly graph.
// Never run the drawing save/rebind workflow on a host with joint semantics.
const jointSafety = String.raw`
def assert_joint_safe_drawing(xml):
 assembly_types={'Assembly::AssemblyObject','Assembly::AssemblyLink','Assembly::JointGroup','Assembly::Joint'}
 for obj in xml.iter('Object'):
  if obj.get('type','') in assembly_types or any(prop.get('name','') in ('Reference1','Reference2') for prop in obj.iter('Property')):raise RuntimeError('目标图纸包含装配/Joint或关节引用属性，可能受关节引用影响；暂不自动整理，保持原件；请在FreeCAD中确认，不自动删除或重绑')

def assert_drawing_link_consumers(d):
 for link in d.Objects:
  if link.TypeId!='App::Link':continue
  for consumer in link.InList:
   if not str(consumer.TypeId).startswith('TechDraw::'):raise RuntimeError('图纸引用 '+link.Name+' 被非TechDraw对象 '+consumer.Name+' 引用，可能受关节引用影响；暂不自动整理，保持原件；不自动删除或重绑')
`;
// Native bridge: document/view operations stay in FreeCAD; planning and publishing stay in TypeScript.
export const maintenanceRunner = String.raw`
import FreeCAD as A, FreeCADGui as G, TechDrawGui, Part
import json, os, zipfile, xml.etree.ElementTree as ET, traceback, time, hashlib
from PySide import QtCore, QtGui, QtSvg
try:
 from PySide import QtWidgets
except ImportError:
 QtWidgets=QtGui
spec=json.load(open(JOB_PATH,encoding='utf8'))
${nativeDiagnostics}
${jointSafety}
${settleDrawing}
${preservationSnapshots}
${nativeReferenceInspection}
${nativeSourceAssemblySafety}
${nativeCamera}

def apply_exact(d,xml):
 checks=[]
 visibility_initial={};visibility_aliases={};visibility_written=set();shared_alias_names=set()
 # Validate every selected visibility field against the initial document before
 # any setter can affect another alias. Only known paper-object alias endpoints
 # coalesced; live equality is still required before its one actual write.
 for patch in spec['patches']:
  if patch['kind'] not in ('property','view') or patch['field']!='Visibility':continue
  o=d.getObject(patch['object'])
  if o is None:raise RuntimeError('待修正可见性对象不存在')
  target=o.ViewObject if patch['kind']=='view' else o
  if 'Visibility' not in target.PropertiesList:raise RuntimeError('可见性属性已变化')
  initial=str(target.Visibility).lower()
  if initial!=patch['current']:raise RuntimeError('初始可见性原值已变化: '+o.Name)
  visibility_initial[(o.Name,patch['kind'])]=initial
  if o.TypeId in ('TechDraw::DrawSVGTemplate','TechDraw::DrawPage') or o.TypeId.startswith('TechDraw::DrawView'):
   if 'Visibility' in o.PropertiesList and 'Visibility' in o.ViewObject.PropertiesList:
    if bool(o.Visibility)!=bool(o.ViewObject.Visibility):raise RuntimeError('纸面可见性别名初始状态不一致')
    shared_alias_names.add(o.Name)
   expected=(patch['current'],patch['proposed'])
   if o.Name in visibility_aliases and visibility_aliases[o.Name]!=expected:raise RuntimeError('纸面可见性别名修正冲突')
   visibility_aliases[o.Name]=expected
 for patch in spec['patches']:
  kind=patch['kind']
  if kind=='resource':continue
  o=d.getObject(patch['object'])
  if o is None:raise RuntimeError('待修正对象不存在: '+patch['object'])
  if kind=='text':
   if o.TypeId!='TechDraw::DrawSVGTemplate':raise RuntimeError('不是图框文本对象')
   values=dict(o.EditableTexts);field=patch['field']
   if field not in values or values[field]!=patch['current']:raise RuntimeError('图框原值已变化: '+field)
   values[field]=patch['proposed'];o.EditableTexts=values
  elif kind=='label':
   if o.Label!=patch['current']:raise RuntimeError('显示标签原值已变化: '+o.Name)
   o.Label=patch['proposed']
  elif kind in ('property','view'):
   field=patch['field'];target=o.ViewObject if kind=='view' else o
   if field=='LineWidth':
    import math
    if kind!='view' or not (o.isDerivedFrom('TechDraw::DrawViewPart') or o.TypeId=='TechDraw::DrawViewDimension') or field not in target.PropertiesList or target.getTypeIdOfProperty(field)!='App::PropertyLength':raise RuntimeError('线宽对象或毫米属性类型未确证')
    current=float(patch['current']);proposed=float(patch['proposed']);quantity=getattr(target,field)
    if not all(math.isfinite(v) and 0<v<=5 for v in (current,proposed)) or not hasattr(quantity,'Value') or quantity.Unit!=A.Units.Quantity('1 mm').Unit or float(quantity.Value)!=current:raise RuntimeError('线宽原值、单位或建议值已变化；保留原文件')
    setattr(target,field,A.Units.Quantity(patch['proposed']+' mm'))
    if abs(float(getattr(target,field).Value)-proposed)>1e-10:raise RuntimeError('线宽写入后读回不一致')
    continue
   if field=='Visibility' and o.Name in shared_alias_names and o.Name in visibility_written:continue
   value=str(getattr(target,field)) if field in target.PropertiesList else ''
   if field=='Visibility':value=value.lower()
   if field not in ('Font','FormatSpec','Visibility') or field not in target.PropertiesList or value!=patch['current']:raise RuntimeError('字体/格式/可见性原值或属性已变化: '+o.Name)
   if field=='Visibility':
    if not (o.TypeId in ('TechDraw::DrawSVGTemplate','TechDraw::DrawPage') or o.TypeId.startswith('TechDraw::DrawView')) or patch['proposed'] not in ('true','false'):raise RuntimeError('可见性修正仅允许所选图框/页面/纸面视图')
    if value!=visibility_initial[(o.Name,kind)]:raise RuntimeError('可见性在精确修正前变化')
    setattr(target,field,patch['proposed']=='true')
    if o.Name in shared_alias_names:
     visibility_written.add(o.Name)
     for alias in (o,o.ViewObject):
      if 'Visibility' in alias.PropertiesList and bool(alias.Visibility)!=(patch['proposed']=='true'):raise RuntimeError('纸面可见性别名写入未一致保存')
    continue
   if field=='Font':
    requested=patch['proposed'];families=[str(f) for f in QtGui.QFontDatabase().families()]
    if requested.casefold() not in [f.casefold() for f in families]:raise RuntimeError('请求字体未安装: '+requested)
    font=QtGui.QFont(requested);actual=QtGui.QFontInfo(font).family()
    if actual.casefold()!=requested.casefold():raise RuntimeError('请求字体发生fallback: '+requested)
    content=''.join(str(x) for x in getattr(o,'Text',[])) if o.TypeId=='TechDraw::DrawViewAnnotation' else str(getattr(o,'FormatSpec',''))
    if any(ord(c)>127 for c in content):
     if not hasattr(QtGui,'QRawFont'):raise RuntimeError('无法确认请求字体字形覆盖；需人工核对')
     raw=QtGui.QRawFont.fromFont(font)
     if not raw.isValid() or any(not raw.supportsCharacter(ord(c)) for c in content if ord(c)>127):raise RuntimeError('请求字体缺少图纸所需字形；保留原文件')
    checks.append({'object':o.Name,'requested':requested,'actual_family':actual})
   elif o.TypeId!='TechDraw::DrawViewDimension' or str(o.Type)!='Diameter':raise RuntimeError('未确证Diameter语义，拒绝修改格式')
   setattr(target,field,patch['proposed'])
  elif kind=='link':
   if o.TypeId!='App::Link':raise RuntimeError('不是App::Link引用对象')
   stored=xml.find('./ObjectData/Object[@name="'+o.Name+'"]/Properties/Property[@name="LinkedObject"]/XLink')
   if stored is None or stored.get('file','')!=patch['current_file'] or stored.get('name','')!=patch['current_node']:raise RuntimeError('引用原路径或节点已变化')
   filename=os.path.realpath(os.path.join(os.path.dirname(spec['source']),patch['proposed_file']))
   source=A.openDocument(filename);target=source.getObject(patch['proposed_node'])
   if target is None:raise RuntimeError('已确认的源主节点不存在')
   placement=o.LinkPlacement;transform=o.LinkTransform;label=o.Label;visible=o.Visibility
   o.setLink(None);o.setLink(target);o.LinkPlacement=placement;o.LinkTransform=transform
   o.Label=label;o.Visibility=visible
  else:raise RuntimeError('未知精确修正类型')
 # Recheck the final content only after every selected patch has been applied;
 # Font+Diameter in either order must verify the new U+2300 glyph, not old Ø.
 checked=set()
 for patch in spec['patches']:
  if patch['kind'] not in ('property','view') or patch['field'] not in ('Font','FormatSpec'):continue
  o=d.getObject(patch['object'])
  if o.Name in checked:continue
  checked.add(o.Name)
  requested=str(o.Font) if o.TypeId=='TechDraw::DrawViewAnnotation' else str(o.ViewObject.Font)
  font=QtGui.QFont(requested);actual=QtGui.QFontInfo(font).family()
  if requested.casefold() not in [str(f).casefold() for f in QtGui.QFontDatabase().families()] or actual.casefold()!=requested.casefold():raise RuntimeError('最终字体未安装或发生fallback；保留原文件')
  content=''.join(str(x) for x in getattr(o,'Text',[])) if o.TypeId=='TechDraw::DrawViewAnnotation' else str(getattr(o,'FormatSpec',''))
  if any(ord(c)>127 for c in content):
   if not hasattr(QtGui,'QRawFont'):raise RuntimeError('无法确认最终文字字形覆盖；需人工核对')
   raw=QtGui.QRawFont.fromFont(font)
   if not raw.isValid() or any(not raw.supportsCharacter(ord(c)) for c in content if ord(c)>127):raise RuntimeError('最终字体缺少所需字形；保留原文件')
 return checks

def run():
 mark_progress('reading_archive')
 with zipfile.ZipFile(spec['source']) as z:
  x=ET.fromstring(z.read('Document.xml'))
 assert_joint_safe_drawing(x)
 saved=x.find('./Properties/Property[@name="Label"]/String')
 mark_progress('opening_source')
 d=A.openDocument(spec['source']); A.setActiveDocument(d.Name)
 assert_drawing_link_consumers(d)
 saved_label=saved.get('value','') if saved is not None else d.Label
 pages=[o for o in d.Objects if o.TypeId=='TechDraw::DrawPage']
 if len(pages)!=1:raise RuntimeError('目前仅整理单页独立图纸；多页文件保持原样')
 page=pages[0]; template=page.Template
 for source_link in [o for o in d.Objects if o.TypeId=='App::Link']:
  if source_link.LinkedObject is None:raise RuntimeError('源引用缺失；请先核对主节点')
  shape=Part.getShape(source_link)
  if shape.isNull() or not shape.isValid():raise RuntimeError('源Shape为空或无效；检查主Body/Tip可见性。外层Link隐藏不等于空图；未保存源3D')
 mark_progress('settling_initial')
 source_graph_before=native_source_graph(d)
 native_assert_frame_coverage(source_graph_before)
 before_values=settle(d);before_native_references=native_dimension_inspection(d);native_assert_reference_preservation(before_native_references,before_native_references);before=snapshot(d);initial_metadata=metadata_snapshot(d); original_text=dict(template.EditableTexts)
 native_assert_frame_coverage(native_assert_source_preservation(source_graph_before,d))
 exact='patches' in spec
 mark_progress('applying_patches')
 font_checks=apply_exact(d,x) if exact else []
 expected_metadata=None
 if exact:before,expected_metadata=verify_exact_effects(before,initial_metadata,d)
 page_visibility=bool(getattr(page.ViewObject,'Visibility',False))
 links=[o for o in d.Objects if o.TypeId=='App::Link']
 targets=[]
 link_metadata={}
 for o in links:
  target=o.LinkedObject
  if target is None:raise RuntimeError('模型引用缺失: '+o.Name)
  targets.append((o,target,o.LinkPlacement,o.LinkTransform))
  link_metadata[o.Name]=(o.Label,bool(o.Visibility))
  if not exact:o.Label=target.Label+'-Link'; o.Visibility=True
 texts=dict(template.EditableTexts)
 material_changes=[]
 for key in ('part_material','material'):
  if not exact and key in texts and texts[key].strip() in ('','待确认','未指定') and spec.get('material'):
   # A note containing a material alternative is evidence, not an empty default.
   notes='\n'.join(str(getattr(o,'Text','')) for o in d.Objects if o.TypeId=='TechDraw::DrawViewAnnotation')
   if any(word in notes for word in ('材料待确认','材质：','材料冲突','或 304','或304')):continue
   texts[key]=spec['material'];material_changes.append({'field':key,'before':original_text[key],'after':texts[key]})
 template.EditableTexts=texts
 number=texts.get('drawing_number','').strip();rev=texts.get('revision_index','').strip()
 if not exact and (not number or not rev):raise RuntimeError('缺少图号/版本，不能猜测页面名')
 kind='装配图' if '装配' in texts.get('document_type','') else '零件图'
 if '下料' in texts.get('document_type',''):kind='下料图'
 if not exact:page.Label=number+'.'+rev+'-'+kind
 if not exact:
  views=G.getDocument(d.Name).mdiViewsOfType('Gui::View3DInventor')
  if not views:raise RuntimeError('没有可用的3D视图')
  view=views[0]
  G.updateGui();QtWidgets.QApplication.processEvents()
  width,height=view.getSize()
  expected_camera=native_configure_camera(view,True,True,width/height if height>0 else 1.0)
 mark_progress('checking_preservation')
 d.recompute()
 if snapshot(d)!=before:raise RuntimeError('重算改变视图/尺寸/技术说明；保持源文件，需单独核对')
 errors=[o.Name for o in d.Objects if o.TypeId.startswith('TechDraw::') and any(s in ('Invalid','Error') for s in o.State)]
 if errors:raise RuntimeError('图纸存在失效对象: '+','.join(errors))
 page.ViewObject.show();settle(d);G.updateGui()
 if not exact:native_assert_camera_stable(view,expected_camera)
 native_assert_reference_preservation(before_native_references,native_dimension_inspection(d));native_assert_source_preservation(source_graph_before,d)
 if spec.get('export_pdf',True):
  mark_progress('exporting_pdf');TechDrawGui.exportPageAsPdf(page,spec['pdf'])
 mark_progress('exporting_thumbnail')
 TechDrawGui.exportPageAsSvg(page,spec['svg'])
 renderer=QtSvg.QSvgRenderer(spec['svg']);size=renderer.defaultSize()
 if not renderer.isValid() or size.isEmpty():raise RuntimeError('无法生成图纸缩略图')
 scale=1024.0/max(size.width(),size.height())
 image=QtGui.QImage(round(size.width()*scale),round(size.height()*scale),QtGui.QImage.Format_ARGB32);image.fill(QtGui.QColor('white'))
 painter=QtGui.QPainter(image);renderer.render(painter);painter.end()
 if not image.save(spec['png'],'PNG'):raise RuntimeError('缩略图保存失败')
 if exact and 'Visibility' in page.ViewObject.PropertiesList:page.ViewObject.Visibility=page_visibility
 if not exact:before=snapshot(d)
 mark_progress('saving_stage')
 d.saveAs(spec['stage'])
 mark_progress('rebinding_links')
 for o,target,placement,transform in targets:
  o.setLink(None);o.setLink(target);o.LinkTransform=transform;o.LinkPlacement=placement
  if exact:o.Label=link_metadata[o.Name][0];o.Visibility=link_metadata[o.Name][1]
 d.Label=saved_label;d.recompute();d.save()
 expected_links=[(o.Name,os.path.realpath(t.Document.FileName),t.Name,list(p.toMatrix().A),tr) for o,t,p,tr in targets]
 expected_label=page.Label; page_name=page.Name; template_name=template.Name
 mark_progress('closing_before_reopen')
 for doc in list(A.listDocuments().values()):A.closeDocument(doc.Name)
 mark_progress('reopening_stage')
 reopened=A.openDocument(spec['stage'])
 mark_progress('checking_reopen')
 if settle(reopened)!=before_values:raise RuntimeError('重开后尺寸实际值变化')
 if snapshot(reopened)!=before:raise RuntimeError('重开后视图/尺寸/技术说明不一致')
 if exact and metadata_snapshot(reopened)!=expected_metadata:raise RuntimeError('重开后未选择字段或精确修正内容发生变化')
 if not os.path.isfile(reopened.getObject(template_name).PageResult):raise RuntimeError('重开后图框资源缺失')
 if dict(reopened.getObject(template_name).EditableTexts)!=texts:raise RuntimeError('重开后图框内容不一致')
 for name,filename,node,placement,transform in expected_links:
  o=reopened.getObject(name);target=o.LinkedObject
  if target is None or os.path.realpath(target.Document.FileName)!=filename or target.Name!=node or any(abs(a-b)>1e-7 for a,b in zip(o.LinkPlacement.toMatrix().A,placement)) or o.LinkTransform!=transform:raise RuntimeError('重开后外链或位姿不一致: '+repr((name,filename,node,placement,transform, None if target is None else (target.Document.FileName,target.Name,list(o.LinkPlacement.toMatrix().A),o.LinkTransform))))
 if reopened.getObject(page_name).Label!=expected_label:raise RuntimeError('页面命名未保存')
 final_native_references=native_dimension_inspection(reopened);native_assert_reference_preservation(before_native_references,final_native_references)
 source_graph_after=native_assert_source_preservation(source_graph_before,reopened)
 native_assert_frame_coverage(source_graph_after)
 return {'status':'completed','native_pid':os.getpid(),'thumbnail_sha256':hashlib.sha256(open(spec['png'],'rb').read()).hexdigest(),'page_label':expected_label,'material_changes':material_changes,'source_link_verified':True,'views':sum(o.TypeId in ('TechDraw::DrawViewPart','TechDraw::DrawViewSection','TechDraw::DrawViewDetail') for o in reopened.Objects),'dimensions':sum(o.TypeId=='TechDraw::DrawViewDimension' for o in reopened.Objects),'preserved_titleblock':original_text,'final_titleblock':texts,'snapshot':before,'metadata_snapshot':expected_metadata,'font_checks':font_checks,'dimension_values':before_values,'expected_links':expected_links,'native_references':before_native_references,'final_native_references':final_native_references,'source_graph_before':source_graph_before,'source_graph_after':source_graph_after,'source_safety':native_safety_summary(source_graph_before)}
try:
 own_process();owned=True
 native_safety_initialize()
 result=run()
except Exception as e:result={'status':'failed','error':str(e),'trace':traceback.format_exc()}
finally:
 finish_native(result,'report')
 if owned:native_safety_shutdown()
`;

// Validate the final ZIP, after thumbnail/resource rewriting, before publication.
export const maintenanceVerificationRunner = String.raw`
import FreeCAD as A, FreeCADGui as G
import json,os,zipfile,hashlib,traceback,time,xml.etree.ElementTree as ET, Part
from PySide import QtCore,QtGui
try:
 from PySide import QtWidgets
except ImportError:QtWidgets=QtGui
spec=json.load(open(JOB_PATH,encoding='utf8'))
${nativeDiagnostics}
${thumbnailVerification}
${jointSafety}
${settleDrawing}
${preservationSnapshots}
${nativeReferenceInspection}
${nativeSourceAssemblySafety}
try:
 own_process();owned=True
 native_safety_initialize()
 expected=json.load(open(spec['report'],encoding='utf8'))
 mark_progress('opening_stage')
 if hashlib.sha256(open(spec['stage'],'rb').read()).hexdigest()!=spec['stage_hash']:raise RuntimeError('最终暂存图纸在重开前变化')
 with zipfile.ZipFile(spec['stage']) as z:assert_joint_safe_drawing(ET.fromstring(z.read('Document.xml')))
 d=A.openDocument(spec['stage'])
 assert_drawing_link_consumers(d)
 source_graph_before=native_source_graph(d)
 native_assert_frame_coverage(source_graph_before)
 if not native_equal(source_graph_before,expected['source_graph_before']):raise RuntimeError('最终重开源装配位姿或实际Frames与原始基线不同；保持原件')
 saved_page_visibility={o.Name:bool(o.ViewObject.Visibility) for o in d.Objects if o.TypeId=='TechDraw::DrawPage' and 'Visibility' in o.ViewObject.PropertiesList}
 mark_progress('checking_templates')
 templates=[o for o in d.Objects if o.TypeId=='TechDraw::DrawSVGTemplate']
 if not templates:raise RuntimeError('最终文件缺少图框')
 with zipfile.ZipFile(spec['stage']) as z:
  if spec['thumbnail_sha256']!=expected['thumbnail_sha256']:raise RuntimeError('最终缩略图验收散列回执不一致')
  verify_maintenance_thumbnail(z.read('thumbnails/Thumbnail.png'),spec['thumbnail_sha256'])
  for t in templates:
   if not os.path.isfile(t.PageResult):raise RuntimeError('最终文件图框资源未加载: '+t.Name)
   if hashlib.sha256(open(t.PageResult,'rb').read()).digest()!=hashlib.sha256(z.read(os.path.basename(t.PageResult))).digest():raise RuntimeError('图框内容不一致')
   if dict(t.EditableTexts)!=expected['final_titleblock']:raise RuntimeError('图框文字不一致')
 mark_progress('checking_links')
 for name,filename,node,placement,transform in expected['expected_links']:
  o=d.getObject(name);target=o.LinkedObject
  if target is None or os.path.realpath(target.Document.FileName)!=filename or target.Name!=node or o.LinkTransform!=transform or any(abs(a-b)>1e-7 for a,b in zip(o.LinkPlacement.toMatrix().A,placement)):raise RuntimeError('最终文件引用不一致: '+name)
 pages=[o for o in d.Objects if o.TypeId=='TechDraw::DrawPage']
 if len(pages)!=1 or pages[0].Label!=expected['page_label']:raise RuntimeError('最终文件页面不一致')
 pages[0].ViewObject.show();G.updateGui()
 mark_progress('settling_views')
 if settle(d)!=expected['dimension_values']:raise RuntimeError('最终文件尺寸实际值变化')
 for name,visible in saved_page_visibility.items():d.getObject(name).ViewObject.Visibility=visible
 mark_progress('checking_preservation')
 if snapshot(d)!=expected['snapshot']:raise RuntimeError('最终文件页面布局/视图/字体/引用/样式不一致')
 if expected.get('metadata_snapshot') is not None and metadata_snapshot(d)!=expected['metadata_snapshot']:raise RuntimeError('最终文件精确字段或未选择属性不一致')
 native_references=native_dimension_inspection(d);native_assert_reference_preservation(expected['native_references'],native_references)
 source_graph_after=native_assert_source_preservation(expected['source_graph_before'],d)
 native_assert_frame_coverage(source_graph_after)
 result={'status':'completed','native_pid':os.getpid(),'templates':len(templates),'native_references':native_references,'source_graph_before':source_graph_before,'source_graph_after':source_graph_after,'source_safety':native_safety_summary(source_graph_before)}
except Exception as e:result={'status':'failed','error':str(e),'trace':traceback.format_exc()}
finally:
 finish_native(result,'verification_report')
 if owned:native_safety_shutdown()
`;

/** Inspect actual references without patches, saveAs, exports or publication. */
export const maintenanceInspectionRunner = String.raw`
import FreeCAD as A, FreeCADGui as G, Part
import json,os,zipfile,hashlib,traceback,time,xml.etree.ElementTree as ET
from PySide import QtCore,QtGui
try:
 from PySide import QtWidgets
except ImportError:QtWidgets=QtGui
spec=json.load(open(JOB_PATH,encoding='utf8'))
${nativeDiagnostics}
${jointSafety}
${nativeReferenceInspection}
${nativeSourceAssemblySafety}

def native_readonly_facts(d):
 def quantity(owner,name):
  if name not in owner.PropertiesList:return None
  value=getattr(owner,name)
  return {'value':native_finite(value.Value if hasattr(value,'Value') else value),'property_type':owner.getTypeIdOfProperty(name),'unit':str(value.Unit) if hasattr(value,'Unit') else None}
 result={'pages':[],'templates':[],'views':[],'dimensions':[]}
 for o in d.Objects:
  if o.TypeId=='TechDraw::DrawPage':result['pages'].append({'name':o.Name,'scale':quantity(o,'Scale'),'template':o.Template.Name if o.Template else None})
  elif o.TypeId=='TechDraw::DrawSVGTemplate':result['templates'].append({'name':o.Name,'width':quantity(o,'Width'),'height':quantity(o,'Height'),'editable_texts':dict(o.EditableTexts)})
  elif o.TypeId=='TechDraw::DrawViewDimension':
   fonts={}
   for name in ('Fontsize','FontSize'):
    if name in o.ViewObject.PropertiesList:fonts[name]=quantity(o.ViewObject,name)
   result['dimensions'].append({'name':o.Name,'font_heights':fonts,'font':str(o.ViewObject.Font) if 'Font' in o.ViewObject.PropertiesList else None,'standard_and_style':str(o.ViewObject.StandardAndStyle) if 'StandardAndStyle' in o.ViewObject.PropertiesList else None,'line_width':quantity(o.ViewObject,'LineWidth')})
  elif o.TypeId.startswith('TechDraw::Draw') and ('Scale' in o.PropertiesList or 'ScaleType' in o.PropertiesList):
   row={'name':o.Name,'type':o.TypeId,'scale':quantity(o,'Scale'),'scale_type':str(o.ScaleType) if 'ScaleType' in o.PropertiesList else None,'effective_scale':None,'effective_scale_method':None,'line_width':quantity(o.ViewObject,'LineWidth')}
   if hasattr(o,'getScale'):
    try:row['effective_scale']=native_finite(o.getScale());row['effective_scale_method']='native getScale()'
    except Exception as error:row['effective_scale_reason']=str(error)
   else:row['effective_scale_reason']='本版没有导出的getScale()；提供真实Scale/ScaleType属性，未推断有效局部比例'
   result['views'].append(row)
 return result

def native_inspection_settle(d):
 d.recompute();started=time.monotonic();last=None;stable=started
 while time.monotonic()-started<60:
  QtWidgets.QApplication.processEvents();G.updateGui();native_assert_solver_quiet()
  views=[o for o in d.Objects if o.isDerivedFrom('TechDraw::DrawViewPart')]
  for view in views:
   failure=native_object_failure(view)
   if failure['states']:raise RuntimeError('View失效，缓存投影不能作为有效证据: '+view.Name+': '+failure['status'])
  try:
   signature=[(o.Name,len(o.getVisibleEdges())) for o in views]
   signature=[signature,native_dimension_inspection(d)]
   if last is None or not native_equal(signature,last):last=signature;stable=time.monotonic()
   if all(count>0 for _,count in signature[0]) and time.monotonic()-started>=4 and time.monotonic()-stable>=2:return True
  except Exception:last=None;stable=time.monotonic()
  time.sleep(.1)
 return False

source_graph_before={}
try:
 own_process();owned=True
 native_safety_initialize()
 mark_progress('reading_archive')
 with zipfile.ZipFile(spec['source']) as archive:assert_joint_safe_drawing(ET.fromstring(archive.read('Document.xml')))
 mark_progress('opening_source')
 d=A.openDocument(spec['source']);assert_drawing_link_consumers(d)
 source_graph_before=native_source_graph(d)
 mark_progress('settling_initial')
 stable=native_inspection_settle(d)
 mark_progress('checking_preservation')
 dimensions=native_dimension_inspection(d)
 if not stable:
  for row in dimensions:
   if row['status']=='valid':row.update(status='manual',reason='View实际投影未稳定，不能确证缓存几何')
 source_graph_after=native_assert_source_preservation(source_graph_before,d)
 result={'status':'completed','dimensions':dimensions,'facts':native_readonly_facts(d),'source_graph_before':source_graph_before,'source_graph_after':source_graph_after,'source_safety':native_safety_summary(source_graph_before),'source_fingerprints_unchanged':True}
except Exception as error:
 # The scan completed with an explicit manual barrier, never permission to
 # mutate. The caller retains bounded diagnostics; no bad-ref repair is guessed.
 result={'status':'completed','dimensions':[],'facts':{'pages':[],'templates':[],'views':[],'dimensions':[]},'source_safety':native_safety_summary(source_graph_before,'manual',str(error)),'source_fingerprints_unchanged':native_source_hashes_unchanged(),'inspection_error':str(error)}
finally:
 if not owned:result['status']='failed'
 finish_native(result,'report')
 if owned:native_safety_shutdown()
`;
