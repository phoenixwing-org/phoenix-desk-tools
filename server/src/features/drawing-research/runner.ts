import { titleblockPython } from './titleblock.js';
/** Owned-process diagnostics only. No document, geometry or source-file edits. */
const drawingDiagnosticsPython = String.raw`
_draft_progress_owned=False
_draft_phase=''
_draft_progress_warnings=[]

def draft_execution_owned():
 return _draft_progress_owned and job.get('expected_pid')==os.getpid()

def mark_draft_progress(phase):
 global _draft_phase
 if not draft_execution_owned():return
 _draft_phase=phase
 try:
  target=job.get('progress') or pathlib.Path(job['report']).with_name('progress.json')
  pathlib.Path(target).write_text(json.dumps({'phase':phase}),encoding='utf-8')
 except Exception as ex:_draft_progress_warnings.append('阶段记录失败: '+type(ex).__name__)

def draft_cleanup_error(result,step,error):
 message=step+': '+str(error)[:1000]
 result['status']='failed';result.setdefault('phase',_draft_phase)
 result['warnings']=(list(result.get('warnings',[]))+[message])[-100:]
 result['error']=(str(result.get('error',''))+'；'+message).lstrip('；')[-4000:]

def write_draft_report(result,key):
 if _draft_progress_warnings:result['warnings']=(list(result.get('warnings',[]))+_draft_progress_warnings)[-100:]
 try:
  pathlib.Path(job[key]).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
  return True
 except Exception as ex:
  draft_cleanup_error(result,'验收报告写入失败',ex)
  try:
   pathlib.Path(job[key]).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
   return True
  except Exception:print('[DrawingNative] report_write_failed',flush=True)
  return False

def cleanup_draft_stages(staged,result):
 if not draft_execution_owned():return
 for item in staged:
  try:
   if item.exists():item.unlink()
  except Exception as ex:draft_cleanup_error(result,'本任务暂存文件清理失败',ex)

def close_owned_draft_documents(result,preferred='',prefix=''):
 if not draft_execution_owned():return
 mark_draft_progress(prefix+'closing_owned_documents')
 try:names=[document.Name for document in reversed(list(A.listDocuments().values()))]
 except Exception as ex:draft_cleanup_error(result,'本任务文档枚举失败',ex);return
 if preferred in names:names.remove(preferred);names.insert(0,preferred)
 for name in names:
  try:A.closeDocument(name)
  except Exception as ex:draft_cleanup_error(result,'本任务文档关闭失败',ex)

def finish_draft_execution(result,key,prefix=''):
 try:
  mark_draft_progress(prefix+'writing_report')
  write_draft_report(result,key)
 finally:
  if draft_execution_owned():
   if result.get('status')=='completed':mark_draft_progress(prefix+'completed')
   try:QtCore.QTimer.singleShot(100,G.getMainWindow().close)
   except Exception as ex:
    draft_cleanup_error(result,'本任务退出调度失败',ex);write_draft_report(result,key)
`;
/** Native contracts use complete curves; paper bounds are Y-up and scaled once. */
const drawingProjectionPython = String.raw`
def projection_tolerance(span):
 return max(0.00001,abs(float(span))*0.000001)

def curve_projection_bounds(view):
 import math
 scale=float(view.Scale)
 if str(view.ScaleType)!='Custom' or not math.isfinite(scale) or scale<=0:raise RuntimeError('投影视图比例不是明确的有效Custom比例')
 edges=list(view.getVisibleEdges(True))
 if not edges:raise RuntimeError('投影视图缺少实际曲线')
 boxes=[edge.BoundBox for edge in edges]
 paper=[min(float(b.XMin) for b in boxes),max(float(b.XMax) for b in boxes),min(float(b.YMin) for b in boxes),max(float(b.YMax) for b in boxes)]
 if any(not math.isfinite(v) for v in paper) or paper[1]<paper[0] or paper[3]<paper[2]:raise RuntimeError('实际投影曲线包围盒无效')
 if max(paper[1]-paper[0],paper[3]-paper[2])<=0.0000001:raise RuntimeError('实际投影曲线没有有效跨度')
 model=[v/scale for v in paper]
 if any(not math.isfinite(v) for v in model):raise RuntimeError('实际投影模型坐标不是有限数值')
 return {'paper':paper,'model':model,'scale':scale}

def projection_snapshot(d,names):
 result={}
 for name in names:
  view=d.getObject(name)
  if view is None:raise RuntimeError('投影视图缺失: '+name)
  result[name]=curve_projection_bounds(view)
 return result

def verify_projection_data(actual,expected,scale=None):
 for name,bounds in expected.items():
  current=actual[name]
  if scale is not None and abs(current['scale']-scale)>0.000000001:raise RuntimeError('实际投影视图比例与计划不一致: '+name)
  tol=projection_tolerance(max(bounds[1]-bounds[0],bounds[3]-bounds[2]))
  if any(abs(a-b)>tol for a,b in zip(current['model'],bounds)):raise RuntimeError('实际完整曲线包围盒尚未稳定或已变化: '+name)

def draft_view_padding(name):
 return [12.0,5.0,5.0,12.0] if name in ('Front','Side') else [4.0,4.0,4.0,4.0]

def choose_owned_draft_layout(width,height,bounds,requested='auto'):
 import math
 names=['Front','Side','Iso'];note_y=90.0;floor=note_y+12.0
 available_w=width-20.0;available_h=height-10.0-floor;gap=8.0
 if available_w<=0 or available_h<=0:raise RuntimeError('实际纸面无法保留标题栏与说明安全区')
 candidates=[1.0,.5,.2,.1,.05,.02,.01,.005,.001] if requested=='auto' else [float(requested.split(':')[0])/float(requested.split(':')[1])]
 # Prefer two columns: orthographic views stacked at left, isometric at right.
 partitions=[[[names[0],names[1]],[names[2]]],[[names[0],names[2]],[names[1]]],[[names[1],names[2]],[names[0]]],[[name for name in names]]]
 for scale in candidates:
  if not math.isfinite(scale) or scale<=0:raise RuntimeError('比例不是正有限值')
  sizes={}
  for name in names:
   b=bounds[name];p=draft_view_padding(name)
   sizes[name]=[(b[1]-b[0])*scale+p[0]+p[1],(b[3]-b[2])*scale+p[2]+p[3]]
  for orientation in ('columns','rows'):
   for groups in partitions:
    if orientation=='columns':
     group_w=[max(sizes[n][0] for n in g) for g in groups];group_h=[sum(sizes[n][1] for n in g)+gap*(len(g)-1) for g in groups]
     total_w=sum(group_w)+gap*(len(groups)-1);total_h=max(group_h)
    else:
     group_w=[sum(sizes[n][0] for n in g)+gap*(len(g)-1) for g in groups];group_h=[max(sizes[n][1] for n in g) for g in groups]
     total_w=max(group_w);total_h=sum(group_h)+gap*(len(groups)-1)
    if total_w>available_w+0.000001 or total_h>available_h+0.000001:continue
    positions={};rectangles={};cursor_x=(width-total_w)/2;cursor_y=floor+(available_h+total_h)/2
    for index,group in enumerate(groups):
     if orientation=='columns':
      top=floor+(available_h+group_h[index])/2
      for name in group:
       w,h=sizes[name];left=cursor_x+(group_w[index]-w)/2;bottom=top-h;top=bottom-gap
       b=bounds[name];p=draft_view_padding(name);positions[name]=[left+p[0]-b[0]*scale,bottom+p[2]-b[2]*scale];rectangles[name]=[left,left+w,bottom,bottom+h]
      cursor_x+=group_w[index]+gap
     else:
      left=(width-group_w[index])/2;bottom=cursor_y-group_h[index]
      for name in group:
       w,h=sizes[name];low=bottom+(group_h[index]-h)/2
       b=bounds[name];p=draft_view_padding(name);positions[name]=[left+p[0]-b[0]*scale,low+p[2]-b[2]*scale];rectangles[name]=[left,left+w,low,low+h];left+=w+gap
      cursor_y=bottom-gap
    return {'scale':scale,'note_y':note_y,'positions':positions,'rectangles':rectangles,'orientation':orientation}
 raise RuntimeError('实际投影曲线加尺寸余量无法放入纸面；请选择更大纸幅或明确更小比例')

def verify_owned_draft_layout(d,width,height,layout):
 rectangles={};floor=layout['note_y']+12.0
 for name in layout['positions']:
  view=d.getObject(name);bounds=curve_projection_bounds(view)['paper'];p=draft_view_padding(name)
  r=[float(view.X)+bounds[0]-p[0],float(view.X)+bounds[1]+p[1],float(view.Y)+bounds[2]-p[2],float(view.Y)+bounds[3]+p[3]]
  if r[0]<10.0-0.00001 or r[1]>width-10.0+0.00001 or r[2]<floor-0.00001 or r[3]>height-10.0+0.00001:raise RuntimeError('实际投影/尺寸余量越出纸面或压住标题栏/说明: '+name)
  rectangles[name]=r
 names=list(rectangles)
 for index,name in enumerate(names):
  a=rectangles[name]
  for other in names[index+1:]:
   b=rectangles[other]
   if min(a[1],b[1])-max(a[0],b[0])>0.00001 and min(a[3],b[3])-max(a[2],b[2])>0.00001:raise RuntimeError('实际投影与尺寸预留区重叠: '+name+' / '+other)
 return rectangles

def candidate_projection_axis(points,model_bounds,axis):
 import math
 low=model_bounds[axis*2];high=model_bounds[axis*2+1];span=high-low;tol=projection_tolerance(span)
 if span<=tol:return None,'完整曲线投影跨度近零'
 if not points:return None,'没有可确认的原生索引顶点'
 if any(not math.isfinite(float(value)) for point in points for value in point[1:3]):return None,'原生索引顶点含非有限坐标，保留人工标注'
 lo=min(points,key=lambda p:p[axis+1]);hi=max(points,key=lambda p:p[axis+1])
 if abs(lo[axis+1]-low)>tol or abs(hi[axis+1]-high)>tol or abs((hi[axis+1]-lo[axis+1])-span)>tol:return None,'顶点极值未覆盖完整曲线边界；圆/曲线投影需人工直径或外缘标注'
 return {'lo':lo[0],'hi':hi[0],'span':span},''

def dimension_paper_position(paper_bounds,axis):
 return [(paper_bounds[0]+paper_bounds[1])/2,paper_bounds[3]+8.0] if axis==0 else [paper_bounds[0]-8.0,(paper_bounds[2]+paper_bounds[3])/2]

def dimension_contract_errors(d,contracts,values):
 errors=[]
 for name,contract in contracts.items():
  bounds=curve_projection_bounds(d.getObject(contract['view']))['model'];axis=contract['axis'];span=bounds[axis*2+1]-bounds[axis*2];tol=projection_tolerance(span)
  value=values[name]
  if abs(span-contract['expected_span'])>tol or abs(value-span)>tol:errors.append((name,'尺寸实际值不等于完整曲线投影跨度；该轴保留人工标注，不发布误值'))
 return errors
`;
/** Shared native wait: real projection/measurement, never cached scalar substitutes. */
const drawingSettlePython = String.raw`
def settle_drawing(d,view_names,dimension_names,projection_expectations=None,expected_scale=None):
 import time,math
 d.recompute()
 started=time.monotonic();last=None;stable=started;reason='尚未取得稳定投影或尺寸'
 while time.monotonic()-started<60:
  QtWidgets.QApplication.processEvents();G.updateGui();d.recompute()
  try:
   invalid=[o.Name for o in d.Objects if o.TypeId.startswith('TechDraw::') and any(state in ('Invalid','Error') for state in getattr(o,'State',[]))]
   if invalid:raise RuntimeError('图纸对象存在失效状态: '+', '.join(invalid))
   edges={}
   for name in view_names:
    view=d.getObject(name)
    if view is None:raise RuntimeError('投影视图缺失: '+name)
    edges[name]=len(view.getVisibleEdges())
   if not edges or any(count<=0 for count in edges.values()):raise RuntimeError('投影视图无实际可见边；请检查源主Body/Tip，未修改源3D')
   values={}
   for name in dimension_names:
    dim=d.getObject(name)
    if dim is None:raise RuntimeError('尺寸对象缺失: '+name)
    value=float(dim.getRawValue())
    if not math.isfinite(value) or value<=0:raise RuntimeError('尺寸实际值尚未完成、非有限数或不大于零: '+name)
    values[name]=value
   projection_signature=()
   if projection_expectations is not None:
    current_projections=projection_snapshot(d,view_names);verify_projection_data(current_projections,projection_expectations,expected_scale)
    projection_signature=tuple((name,)+tuple(data['paper'])+(data['scale'],) for name,data in sorted(current_projections.items()))
   signature=(tuple(sorted(edges.items())),tuple(sorted(values.items())),projection_signature)
   now=time.monotonic()
   if signature!=last:last=signature;stable=now
   if now-started>=4 and now-stable>=2:return edges,values
  except Exception as ex:last=None;stable=time.monotonic();reason=str(ex)
  time.sleep(0.1)
 raise RuntimeError('投影视图或尺寸在60秒内未稳定，未发布: '+reason)
`;
/** Final reopen decodes the exact embedded PNG, not an external preview. */
const drawingThumbnailCheckPython = String.raw`
def verify_draft_thumbnail(png_bytes,digest):
 assert hashlib.sha256(png_bytes).hexdigest()==digest,'重开后内嵌图纸缩略图散列变化'
 image=QtGui.QImage.fromData(png_bytes)
 assert not image.isNull() and image.width()>0 and image.height()>0,'重开后内嵌图纸缩略图无法解码'
 assert image.width()*image.height()<=4000000,'重开后内嵌图纸缩略图尺寸超限'
 first=image.pixel(0,0)
 assert any(image.pixel(x,y)!=first for y in range(image.height()) for x in range(image.width())),'重开后内嵌图纸缩略图为单色空白'
`;
/** Verified FreeCAD PropertyLength/mm only; presentation defaults for new objects. */
const drawingLineWidthPython = String.raw`
def owned_draft_line_widths(defaults):
 import math
 result={}
 for key,fallback in (('contour_line_width_mm',0.5),('dimension_line_width_mm',0.25)):
  value=defaults.get(key,fallback)
  if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value<=0 or value>5:raise RuntimeError('新稿线宽必须是大于0且不超过5mm的有限数字')
  result[key]=float(value)
 if result['contour_line_width_mm']<=result['dimension_line_width_mm']:raise RuntimeError('新稿轮廓线宽必须大于尺寸线宽')
 return result

def owned_draft_line_width(obj,expected_type):
 import math
 if obj is None or obj.TypeId!=expected_type:raise RuntimeError('新稿线宽目标类型无法确认')
 provider=obj.ViewObject
 if 'LineWidth' not in provider.PropertiesList or provider.getTypeIdOfProperty('LineWidth')!='App::PropertyLength':raise RuntimeError('新稿LineWidth不是已确认的PropertyLength，未发布')
 value=provider.LineWidth
 if str(value.Unit)!=str(A.Units.Quantity('1 mm').Unit):raise RuntimeError('新稿LineWidth不是已确认的毫米Length单位，未发布')
 width=float(value.Value)
 if not math.isfinite(width) or width<=0 or width>5:raise RuntimeError('新稿LineWidth实际毫米值无效，未发布')
 return width

def set_owned_draft_line_width(obj,width,expected_type):
 owned_draft_line_width(obj,expected_type)
 provider=obj.ViewObject
 untouched={key:str(getattr(provider,key)) for key in ('ExtraWidth','HiddenWidth','IsoWidth') if key in provider.PropertiesList}
 provider.LineWidth=width
 if abs(owned_draft_line_width(obj,expected_type)-width)>0.000000001:raise RuntimeError('新稿LineWidth未保持请求的毫米值，未发布')
 if untouched!={key:str(getattr(provider,key)) for key in untouched}:raise RuntimeError('新稿线宽设置影响了未选择的其他线宽，未发布')

def verify_owned_draft_line_widths(d,view_names,dimension_names,defaults):
 widths=owned_draft_line_widths(defaults);result={}
 for names,key,kind in ((view_names,'contour_line_width_mm','TechDraw::DrawViewPart'),(dimension_names,'dimension_line_width_mm','TechDraw::DrawViewDimension')):
  for name in names:
   value=owned_draft_line_width(d.getObject(name),kind)
   if abs(value-widths[key])>0.000000001:raise RuntimeError('新稿对象实际LineWidth与冻结配置不一致: '+name)
   result[name]=value
 return result
`;
/** New owned draft presentation only; never apply these defaults to existing drawings. */
const ownedDraftPython = String.raw`
def owned_filename_identity(stem):
 import re
 match=re.match(r'^([0-9]{4,})\.([0-9]{1,6})(?=[._\- ]|$)',str(stem))
 return match.groups() if match else ('','')

def owned_draft_labels(number,revision,title,source_label):
 number=str(number).strip();revision=str(revision).strip();title=str(title).strip()
 page_label=number+'.'+revision+'-零件图' if number and revision else '研究稿-'+(title or number or '未编号')+'-零件图'
 return page_label,str(source_label)+'-Link'

def clear_owned_template_examples(fields):
 result=dict(fields)
 for key,token in {'supplementary_title_1':'ST1','supplementary_title_2':'ST2','responsible_department':'RD'}.items():
  if result.get(key)==token:result[key]=''
 return result

def render_owned_draft_thumbnail(page,svg_path,png_path):
 svg=pathlib.Path(svg_path);png=pathlib.Path(png_path)
 assert not svg.exists() and not png.exists(),'本任务图纸缩略图暂存路径已占用'
 TechDrawGui.exportPageAsSvg(page,str(svg))
 renderer=QtSvg.QSvgRenderer(str(svg));size=renderer.defaultSize()
 assert renderer.isValid() and not size.isEmpty(),'实际图纸SVG导出失败，未发布'
 factor=1024.0/max(size.width(),size.height())
 image=QtGui.QImage(max(1,round(size.width()*factor)),max(1,round(size.height()*factor)),QtGui.QImage.Format_ARGB32)
 image.fill(QtGui.QColor('white'));painter=QtGui.QPainter(image)
 try:renderer.render(painter)
 finally:painter.end()
 first=image.pixel(0,0)
 assert any(image.pixel(x,y)!=first for y in range(image.height()) for x in range(image.width())),'实际图纸缩略图为单色空白，未发布'
 assert image.save(str(png),'PNG'),'实际图纸缩略图PNG保存失败，未发布'
 return str(png),hashlib.sha256(png.read_bytes()).hexdigest()
`;
/** Read-only paper proposals use the identical native projection/layout rules. */
export const drawingPaperProjectionSupport = drawingProjectionPython + '\n' + drawingSettlePython;

/** Owned draft stages; only the host publishes after an independent native reopen. */
export const drawingRunner = titleblockPython + '\n' + drawingDiagnosticsPython + '\n' + drawingProjectionPython + '\n' + drawingSettlePython + '\n' + drawingLineWidthPython + '\n' + ownedDraftPython + '\n' + String.raw`import FreeCAD as A,FreeCADGui as G,Part,TechDrawGui,pathlib,json,hashlib,os,math,traceback,datetime
from PySide import QtCore,QtWidgets,QtGui,QtSvg
job=json.loads(pathlib.Path(JOB_PATH).read_text(encoding='utf-8'))
report={'status':'failed'};staged=[]
def guard_inputs():
 for filename,digest in job['fingerprints'].items():
  assert hashlib.sha256(pathlib.Path(filename).read_bytes()).hexdigest()==digest,('参考PDF已变化，请重新预览' if filename==job.get('reference_pdf') else '源模型或链依赖已变化，请重新预览')
 assert hashlib.sha256(pathlib.Path(job['template']).read_bytes()).hexdigest()==job['template_hash'],'图框模板已变化，请重新预览'

def refresh():
 G.updateGui();QtWidgets.QApplication.processEvents()
def generate():
 global report,_draft_progress_owned
 owned=False;owned_drawing_name=''
 try:
  job.update(json.loads(pathlib.Path(JOB_PATH).read_text(encoding='utf-8')))
  assert job.get('expected_pid')==os.getpid(),'宏未运行在本任务子进程，保留用户FreeCAD'
  owned=True;_draft_progress_owned=True
  mark_draft_progress('opening_source')
  A.ParamGet('User parameter:BaseApp/Preferences/Document').SetInt('CountBackupFiles',0)
  src=pathlib.Path(job['source']);target=pathlib.Path(job['output']);pdf=pathlib.Path(job['pdf']);md=pathlib.Path(job['notes'])
  assert all(p.parent==src.parent for p in [target,pdf,md]),'固定三件输出不在源目录'
  guard_inputs()
  for p in [target,pdf,md]:assert not p.exists(),'同名输出已存在，保留原文件'
  s=A.openDocument(str(src));body=s.getObject(job['node']);assert body,'模型节点不存在'
  mark_draft_progress('source_geometry')
  shape=Part.getShape(body)
  assert not shape.isNull() and len(shape.Solids)>0,'源主实体为空：请检查主Body/Tip可见性；外层Link隐藏不等于空图，未修改或保存源3D'
  assert shape.isValid(),'源实体无效：请检查主Body/Tip及实体状态；未自动打开Sketch/历史Feature，未保存源3D'
  mark_draft_progress('creating_page')
  d=A.newDocument('DrawingDraft');owned_drawing_name=d.Name;d.Label=target.stem
  stage=pathlib.Path(job['stage']);staged.append(stage)
  d.saveAs(str(stage));link=d.addObject('App::Link','SourceModel');link.setLink(body)
  page=d.addObject('TechDraw::DrawPage','Page');tpl=d.addObject('TechDraw::DrawSVGTemplate','Template');tpl.Template=job['template'];page.Template=tpl
  prefs=job['defaults'];line_width_settings=owned_draft_line_widths(prefs);fields=dict(tpl.EditableTexts)
  def prop(name,fallback=''):
   v=getattr(body,name,'');return str(v).strip() if isinstance(v,(str,int,float)) and str(v).strip() else fallback
  filename_number,filename_revision=owned_filename_identity(src.stem);values={'drawing_number':prop('PartNumber',filename_number),'revision_index':prop('PartVersion',filename_revision),'title':prop('PartName',body.Label),'creator':prefs.get('creator',''),'approval_person':'','legal_owner_1':prefs.get('company',''),'legal_owner_2':'','legal_owner_3':'','legal_owner_4':'','part_material':prop('PartMaterial',prop('Material',prefs.get('material',''))) or '待确认','general_tolerances':prefs.get('tolerances','') or '待确认','document_type':'初稿待审核','date_of_issue':datetime.date.today().isoformat(),'sheet_number':'1 / 1'}
  company_lines=prefs.get('company','').splitlines()
  if 'legal_owner_2' in fields:
   for i in range(4):values['legal_owner_'+str(i+1)]=company_lines[i] if i<len(company_lines) else ''
  else:values['legal_owner_1']=' '.join(company_lines)
  aliases={'creator':['Designed_by_Name'],'date_of_issue':['FC-Date'],'title':['FC-Title'],'drawing_number':['Drawing_number'],'sheet_number':['FC-SH']}
  matched=set()
  for key,value in values.items():
   for field in [key]+aliases.get(key,[]):
    if field in fields:fields[field]=value;matched.add(key)
  tpl.EditableTexts=fields
  width=float(tpl.Width);height=float(tpl.Height);assert width>100 and height>100,'模板尺寸过小'
  bb=shape.BoundBox;sizes=[bb.XLength,bb.YLength,bb.ZLength];normal=min(range(3),key=lambda i:sizes[i]);horizontal=max([i for i in range(3) if i!=normal],key=lambda i:sizes[i]);vertical=next(i for i in range(3) if i not in [normal,horizontal])
  def unit(i):return A.Vector(*(1 if j==i else 0 for j in range(3)))
  paper_dims={'A4':(210,297),'A3':(297,420),'A2':(420,594),'A1':(594,841),'A0':(841,1189)}
  assert job['paper'] in paper_dims and all(abs(a-b)<3 for a,b in zip(sorted([width,height]),paper_dims[job['paper']])),'模板纸幅与预览不一致或不支持自动纸幅'
  scale=1.0;requested=job.get('scale','auto')
  def view(name,axis,xdir,x,y):
   v=d.addObject('TechDraw::DrawViewPart',name);v.Source=[link];v.Direction=axis;v.XDirection=xdir;v.ScaleType='Custom';v.Scale=scale;set_owned_draft_line_width(v,line_width_settings['contour_line_width_mm'],'TechDraw::DrawViewPart');page.addView(v);d.recompute();v.X=x;v.Y=y;v.LockPosition=True;return v
  front=view('Front',unit(normal),unit(horizontal),0,0);side=view('Side',unit(vertical),unit(horizontal),0,0);iso=view('Iso',A.Vector(1,-1,1),unit(horizontal),0,0)
  page.Label,link.Label=owned_draft_labels(values['drawing_number'],values['revision_index'],values['title'],body.Label)
  d.Label=values['title'];d.CreatedBy=values['creator'];d.Company=prefs.get('company','')
  prepare_page(page,link);page.ApprovalPerson=values['approval_person'];page.GeneralTolerances=values['general_tolerances'];page.DrawingType=values['document_type'];page.IssueDate=values['date_of_issue']
  page.Scale=scale;f=dict(tpl.EditableTexts)
  for field in ['scale','FC-SC']:
   if field in f:f[field]=str(scale)+' : 1'
  tpl.EditableTexts=f
  property_sync=synchronize(page,initial=True)
  filled=dict(tpl.EditableTexts)
  for key in ['drawing_number','revision_index','part_material']:
   for field in [key]+aliases.get(key,[]):
    if field in filled and not filled[field]:filled[field]=values[key]
  filled=clear_owned_template_examples(filled);tpl.EditableTexts=filled
  snapshots=json.loads(dict(d.Meta).get(SNAPSHOT,'{}'));snapshots[tpl.Name]=dict(filled);metadata=dict(d.Meta);metadata[SNAPSHOT]=json.dumps(snapshots,ensure_ascii=False);d.Meta=metadata
  link.Visibility=True;d.recompute();G.activeDocument().getObject(page.Name).show();refresh()
  mark_draft_progress('settling_views_1to1')
  view_names=[front.Name,side.Name,iso.Name];settle_drawing(d,view_names,[],{})
  mark_draft_progress('choosing_layout')
  projection_expectations={name:data['model'] for name,data in projection_snapshot(d,view_names).items()}
  layout=choose_owned_draft_layout(width,height,projection_expectations,requested);scale=layout['scale'];note_y=layout['note_y']
  mark_draft_progress('settling_scaled_views')
  for name,position in layout['positions'].items():
   v=d.getObject(name);v.Scale=scale;v.X=position[0];v.Y=position[1]
  page.Scale=scale;property_sync=synchronize(page,initial=True)
  f=dict(tpl.EditableTexts)
  for field in ['scale','FC-SC']:
   if field in f:f[field]=str(scale)+' : 1'
  tpl.EditableTexts=clear_owned_template_examples(f)
  settle_drawing(d,view_names,[],projection_expectations,scale);verify_owned_draft_layout(d,width,height,layout)
  dimensions=[];dimension_contracts={};warnings=[]
  if scale not in [1,2,5,.5,.2]:warnings.append('原生fit选择非常用小比例，请人工核对纸幅与可读性')
  missing=[key for key in ['drawing_number','revision_index','title','creator','approval_person','legal_owner_1','part_material'] if key not in matched]
  if missing:warnings.append('模板缺少可编辑字段：'+', '.join(missing)+'；请更换模板或人工填写')
  mark_draft_progress('building_dimensions')
  for v in [front,side]:
   points=[];bounds=curve_projection_bounds(v)
   for i in range(500):
    try:p=v.getVertexByIndex(i).Point;points.append((i,float(p.x),float(p.y)))
    except:break
   for axis in [0,1]:
    candidate,reason=candidate_projection_axis(points,bounds['model'],axis)
    if candidate is None:warnings.append(v.Name+' '+('X' if axis==0 else 'Y')+'轴跳过：'+reason);continue
    dim=d.addObject('TechDraw::DrawViewDimension',v.Name+('Width' if axis==0 else 'Height'));dim.Type='DistanceX' if axis==0 else 'DistanceY';dim.References2D=[(v,['Vertex'+str(candidate['lo']),'Vertex'+str(candidate['hi'])])];set_owned_draft_line_width(dim,line_width_settings['dimension_line_width_mm'],'TechDraw::DrawViewDimension');page.addView(dim);d.recompute()
    dim.X,dim.Y=dimension_paper_position(bounds['paper'],axis);dimensions.append(dim.Name);dimension_contracts[dim.Name]={'view':v.Name,'axis':axis,'expected_span':candidate['span']}
  mark_draft_progress('settling_dimensions')
  note=d.addObject('TechDraw::DrawViewAnnotation','DraftNote');note.Text=['AI 初稿：视图方向、尺寸、公差及材料待审核'];page.addView(note);d.recompute();note.X=width*.3;note.Y=note_y;note.TextSize=2.5
  visible_objects=[]
  for owned_object in d.Objects:
   if owned_object.TypeId.startswith('TechDraw::') or owned_object.Name==link.Name:
    if 'Visibility' in owned_object.PropertiesList:owned_object.Visibility=True
    if 'Visibility' in owned_object.ViewObject.PropertiesList:owned_object.ViewObject.Visibility=True
    visible_objects.append(owned_object.Name)
  d.Meta={**dict(d.Meta),'AI.TitleBlockSnapshot':json.dumps({tpl.Name:dict(tpl.EditableTexts)},ensure_ascii=False),'AI.SourceSHA256':job['source_hash']};d.CreatedBy=prefs.get('creator','');d.Company=prefs.get('company','');d.recompute();refresh();d.save()
  view_edges,dimension_values=settle_drawing(d,view_names,dimensions,projection_expectations,scale)
  for name,message in dimension_contract_errors(d,dimension_contracts,dimension_values):
   d.removeObject(name);dimensions.remove(name);del dimension_contracts[name];visible_objects.remove(name);warnings.append(name+' 已删除：'+message)
  view_edges,dimension_values=settle_drawing(d,view_names,dimensions,projection_expectations,scale);verify_owned_draft_layout(d,width,height,layout)
  assert not dimension_contract_errors(d,dimension_contracts,dimension_values),'有效尺寸与完整曲线跨度不一致，未发布'
  line_widths=verify_owned_draft_line_widths(d,view_names,dimensions,prefs)
  warnings.append('投影边与尺寸值检查不等于语义尺寸覆盖；曲面、圆弧、公差及工程要求须人工审核')
  d.save()
  mark_draft_progress('exporting_thumbnail')
  thumbnail_png=pathlib.Path(job['page_png']);page_svg=pathlib.Path(job['page_svg']);staged.extend([page_svg,thumbnail_png])
  thumbnail_png,thumbnail_sha256=render_owned_draft_thumbnail(page,job['page_svg'],job['page_png'])
  mark_draft_progress('exporting_pdf')
  temp_pdf=pathlib.Path(job['stage_pdf']);staged.append(temp_pdf);TechDrawGui.exportPageAsPdf(page,str(temp_pdf));assert temp_pdf.stat().st_size>1000,'PDF导出失败'
  temp_md=pathlib.Path(job['stage_notes']);staged.append(temp_md);temp_md.write_text('# '+target.stem+'\n\n状态：AI初稿待工程师审核。\n\n源模型：'+src.name+'\n\n源SHA256：'+job['source_hash']+'\n\n节点：'+body.Name+'\n\n已完成：两个正交视图、一个轴测视图、可定位时的投影顶点间尺寸（实际数量见验证记录）、标题栏、PDF。\n\n待完成：检查视图方向、投影制式、孔径、剖视、尺寸、公差、材料、技术要求。顶点间尺寸不一定覆盖圆弧的极值，不能当作完整外形尺寸。当前未读取参考PDF的工程要求。\n\n'+ '\n'.join(warnings),encoding='utf-8')
  with temp_md.open('a',encoding='utf-8') as note_file:
   note_file.write('\n\n模板：'+str(job['template'])+'\n\n验证：源实体有效；已生成三个投影视图及 '+str(len(dimensions))+' 个尺寸对象；PDF已导出。自动检查不等于工程审核。\n\n标题栏属性：文档Label/CreatedBy/Company；页面MetadataSource/ApprovalPerson/GeneralTolerances/IssueDate。源材料缺失时保留待确认。\n\n下一步：\n1. 核对源模型和参考PDF的编号、版本及装配状态。\n2. 调整视图方向、比例与位置；补齐圆弧外缘、孔径、孔距、剖视及公差。\n3. 检查图纸标题栏，必要时在Desk中预览并应用标题栏同步。\n4. 在FreeCAD中保存，再导出PDF并逐页审查；记录人工或AI的修改及未解决项。\n')
  with temp_md.open('a',encoding='utf-8') as note_file:
   reference=job.get('reference_pdf','')
   note_file.write('\n\n参考PDF：'+(pathlib.Path(reference).name if reference else '无原PDF，仅从3D生成研究稿')+'\n\n参考PDF SHA256：'+(job['fingerprints'].get(reference,'') if reference else '无')+'\n\n参考状态：'+('仅编号/版本候选，未读取工程要求' if reference else 'missing_allowed')+'；必须人工审核，不视为正式工程审批。\n')
  guard_inputs()
  expected_fields=dict(tpl.EditableTexts);page_label=page.Label;source_label=link.Label
  mark_draft_progress('closing_drawing')
  A.closeDocument(d.Name)
  report={'status':'completed','staged_outputs':[str(p) for p in [stage,temp_pdf,temp_md]],'dimensions':dimensions,'warnings':warnings,'source_hash':job['source_hash'],'editable_fields':expected_fields,'view_edges':view_edges,'visible_objects':visible_objects,'dimension_values':dimension_values,'dimension_contracts':dimension_contracts,'line_widths':line_widths,'projection_expectations':projection_expectations,'layout':layout,'paper_dimensions':[width,height],'page':'Page','template_object':'Template','page_label':page_label,'source_label':source_label,'thumbnail_png':thumbnail_png,'thumbnail_sha256':thumbnail_sha256,'scale':scale,'paper':job['paper'],'manual_review_required':True}
 except Exception as ex:
  report={'status':'failed','error':str(ex),'traceback':traceback.format_exc(),'phase':_draft_phase}
  write_draft_report(report,'report')

 finally:
  try:
   if report['status']!='completed':cleanup_draft_stages(staged,report)
   if owned:close_owned_draft_documents(report,owned_drawing_name)
  except Exception as ex:draft_cleanup_error(report,'本任务清理失败',ex)
  finally:finish_draft_execution(report,'report')
QtCore.QTimer.singleShot(300,generate)
`;
export const drawingVerificationRunner = drawingDiagnosticsPython + '\n' + drawingProjectionPython + '\n' + drawingSettlePython + '\n' + drawingThumbnailCheckPython + '\n' + drawingLineWidthPython + '\n' + String.raw`import FreeCAD as A,FreeCADGui as G,json,pathlib,hashlib,os,zipfile,math,traceback
from PySide import QtCore,QtWidgets,QtGui
job=json.loads(pathlib.Path(JOB_PATH).read_text(encoding='utf-8'))
def verify():
 global _draft_progress_owned
 result={'status':'failed'};owned=False;owned_drawing_name=''
 try:
  job.update(json.loads(pathlib.Path(JOB_PATH).read_text(encoding='utf-8')))
  assert job.get('expected_pid')==os.getpid(),'验证宏未运行在本任务子进程，保留用户FreeCAD'
  owned=True;_draft_progress_owned=True
  mark_draft_progress('verify_opening_source')
  stage=pathlib.Path(job['stage'])
  assert hashlib.sha256(stage.read_bytes()).hexdigest()==job['stage_hash'],'暂存图纸已变化'
  for filename,digest in job['fingerprints'].items():assert hashlib.sha256(pathlib.Path(filename).read_bytes()).hexdigest()==digest,('参考PDF已变化' if filename==job.get('reference_pdf') else '源模型或链依赖已变化')
  assert hashlib.sha256(pathlib.Path(job['template']).read_bytes()).hexdigest()==job['template_hash'],'图框模板已变化'
  expected=json.loads(pathlib.Path(job['report']).read_text(encoding='utf-8'))
  d=A.openDocument(str(stage));owned_drawing_name=d.Name;page=d.getObject(expected['page']);tpl=d.getObject(expected['template_object']);link=d.getObject('SourceModel')
  assert page and tpl and link,'重开后页面/模板/模型引用缺失'
  assert page.Label==expected['page_label'] and link.Label==expected['source_label'],'重开后页面或源引用显示标签变化'
  mark_draft_progress('verify_settling_dimensions')
  reopened_edges,reopened_values=settle_drawing(d,list(expected['view_edges']),list(expected['dimension_values']),expected['projection_expectations'],expected['scale'])
  assert verify_owned_draft_line_widths(d,list(expected['view_edges']),list(expected['dimension_values']),job['defaults'])==expected['line_widths'],'重开后新稿线宽回执与实际毫米值不一致'
  verify_owned_draft_layout(d,*expected['paper_dimensions'],expected['layout'])
  assert not dimension_contract_errors(d,expected['dimension_contracts'],reopened_values),'重开后尺寸不匹配实际完整曲线投影跨度'
  assert os.path.isfile(tpl.PageResult),'重开后内嵌图框未加载'
  mark_draft_progress('verify_exporting_thumbnail')
  with zipfile.ZipFile(stage) as archive:
   assert hashlib.sha256(pathlib.Path(tpl.PageResult).read_bytes()).digest()==hashlib.sha256(archive.read(os.path.basename(tpl.PageResult))).digest(),'内嵌图框内容不一致'
   assert job['thumbnail_sha256']==expected['thumbnail_sha256'],'缩略图验证回执不一致'
   verify_draft_thumbnail(archive.read('thumbnails/Thumbnail.png'),job['thumbnail_sha256'])
  assert dict(tpl.EditableTexts)==expected['editable_fields'],'重开后标题栏内容变化'
  for name in expected['visible_objects']:
   obj=d.getObject(name)
   assert obj,'重开后纸面对象缺失'
   if 'Visibility' in obj.PropertiesList:assert obj.Visibility,'重开后纸面对象隐藏: '+name
   if 'Visibility' in obj.ViewObject.PropertiesList:assert obj.ViewObject.Visibility,'重开后纸面ViewProvider隐藏: '+name
  # ShowFrames is an editing aid, not SVG template visibility; leave it alone.
  mark_draft_progress('verify_source_geometry')
  linked=link.LinkedObject
  if isinstance(linked,tuple):linked=linked[0]
  assert linked and linked.Name==job['node'] and os.path.realpath(linked.Document.FileName)==os.path.realpath(job['source']),'重开后外链目标变化'
  for name,count in expected['view_edges'].items():
   view=d.getObject(name)
   assert view and len(view.getVisibleEdges())>0 and 'Invalid' not in view.State and 'Error' not in view.State,'重开后投影视图无实际边或存在错误状态'
  for name,value in expected['dimension_values'].items():
   actual=reopened_values[name]
   assert math.isfinite(actual) and actual>0 and abs(actual-value)<1e-6,'重开后尺寸实际值变化'
  assert all(not any(state in ('Invalid','Error') for state in getattr(obj,'State',[])) for obj in d.Objects),'重开后存在无效或错误对象'
  result={'status':'completed','native_reopened':True,'manual_review_required':True}
 except Exception as ex:
  result={'status':'failed','error':str(ex),'traceback':traceback.format_exc(),'phase':_draft_phase}
  write_draft_report(result,'verification_report')
 finally:
  try:
   if owned:close_owned_draft_documents(result,owned_drawing_name,'verify_')
  except Exception as ex:draft_cleanup_error(result,'本任务验证清理失败',ex)
  finally:finish_draft_execution(result,'verification_report','verify_')
QtCore.QTimer.singleShot(300,verify)
`;
