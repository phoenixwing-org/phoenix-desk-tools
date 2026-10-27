/** Shared read-only native evidence. Selectors are handed to TechDraw's real
 * selection APIs; no guessed edge numbering, text substitution or rebind. */
export const nativeReferenceInspection = String.raw`
def native_finite(value):
 import math
 value=float(value)
 if not math.isfinite(value):raise ValueError('非有限几何/尺寸值')
 return value

def native_vector(value):return [native_finite(v) for v in value]

def native_object_failure(obj):
 # Only persistent failure flags participate in preservation. Transient
 # Touched/Recompute flags may legitimately change while a Drawing settles.
 states=obj.State
 if not isinstance(states,(list,tuple)) or any(not isinstance(value,str) for value in states):raise ValueError('对象状态接口不能确认: '+obj.Name)
 failures=sorted(value for value in states if value in ('Error','Invalid'))
 return {'states':failures,'status':str(obj.getStatusString()) if failures else ''}

def native_equal(a,b,tolerance=1e-6):
 if isinstance(a,bool) or isinstance(b,bool):return type(a)==type(b) and a==b
 if isinstance(a,dict) and isinstance(b,dict):return a.keys()==b.keys() and all(native_equal(a[k],b[k],tolerance) for k in a)
 if isinstance(a,(list,tuple)) and isinstance(b,(list,tuple)):return len(a)==len(b) and all(native_equal(x,y,tolerance) for x,y in zip(a,b))
 if isinstance(a,(int,float)) and isinstance(b,(int,float)):return abs(a-b)<=tolerance
 return a==b

def native_edge_geometry(edge):
 import math
 if edge is None or edge.isNull() or not edge.isValid():raise ValueError('引用Edge为空或无效')
 curve=edge.Curve
 first=native_finite(edge.FirstParameter);last=native_finite(edge.LastParameter)
 result={'kind':'Edge','coordinate_space':'view_projection','curve':type(curve).__name__,'length':native_finite(edge.Length),'bbox':[native_finite(getattr(edge.BoundBox,k)) for k in ('XMin','YMin','ZMin','XMax','YMax','ZMax')],'endpoints':[native_vector(edge.valueAt(first)),native_vector(edge.valueAt(last))],'samples':[native_vector(edge.valueAt(first+(last-first)*f)) for f in (0,.25,.5,.75,1)]}
 for key,field in (('Center','center'),('Axis','axis'),('Direction','direction')):
  if hasattr(curve,key):result[field]=native_vector(getattr(curve,key))
 if hasattr(curve,'Radius'):result['radius']=native_finite(curve.Radius)
 if result['curve']=='Circle':result['full_circle']=abs(result['length']-2*math.pi*result['radius'])<=1e-6
 return result

def native_projected_reference(view,sub):
 row={'view':getattr(view,'Name',''),'sub':str(sub),'status':'manual'}
 if view is None:row.update(status='invalid',reason='引用View不存在');return row
 if not isinstance(sub,str) or not sub:row.update(status='invalid',reason='引用选择器为空');return row
 if not hasattr(view,'isDerivedFrom') or not view.isDerivedFrom('TechDraw::DrawViewPart'):row['reason']='本版不支持该View的真实投影选择接口';return row
 try:
  failure=native_object_failure(view)
  if failure['states']:row['reason']='引用View失效，缓存投影不能作为有效证据: '+failure['status'];return row
 except Exception as error:row['reason']='引用View状态不能确认: '+str(error);return row
 try:
  if sub.startswith('Vertex'):
   if not hasattr(view,'getVertexBySelection'):row['reason']='本版没有getVertexBySelection';return row
   vertex=view.getVertexBySelection(sub)
   if vertex is None or vertex.isNull() or not vertex.isValid():raise ValueError('引用Vertex为空或无效')
   geometry={'kind':'Vertex','coordinate_space':'view_projection','point':native_vector(vertex.Point)}
  elif sub.startswith('Edge'):
   if not hasattr(view,'getEdgeBySelection'):row['reason']='本版没有getEdgeBySelection';return row
   geometry=native_edge_geometry(view.getEdgeBySelection(sub))
  else:row['reason']='未支持的真实选择器；未猜测索引';return row
  row.update(status='valid',geometry=geometry)
 except Exception as error:row.update(status='invalid',reason='真实投影选择失败: '+str(error))
 return row

def native_dimension_inspection(d):
 rows=[]
 for dimension in d.Objects:
  if dimension.TypeId!='TechDraw::DrawViewDimension':continue
  row={'dimension':dimension.Name,'type':str(dimension.Type),'status':'valid','actual_value':None,'references':[]}
  try:row['actual_value']=native_finite(dimension.getRawValue())
  except Exception as error:row.update(status='invalid',reason='尺寸真实值不可读: '+str(error))
  try:
   refs=dimension.References2D
   for view,subs in refs:
    if not subs:row['references'].append({'view':getattr(view,'Name',''),'sub':'','status':'invalid','reason':'引用选择器列表为空'})
    else:row['references'].extend(native_projected_reference(view,sub) for sub in subs)
   if not row['references']:row.update(status='invalid',reason='References2D为空')
  except Exception as error:row.update(status='invalid',reason='References2D不可读: '+str(error))
  if any(value['status']=='invalid' for value in row['references']):row['status']='invalid'
  elif row['status']=='valid' and any(value['status']=='manual' for value in row['references']):row['status']='manual'
  if any(state in ('Invalid','Error') for state in dimension.State):row.update(status='invalid',reason='原生尺寸对象失效: '+str(dimension.getStatusString()))
  rows.append(row)
 return rows

def native_geometry_equal(a,b):
 if not isinstance(a,dict) or not isinstance(b,dict) or a.get('kind')!=b.get('kind'):return False
 left=dict(a);right=dict(b)
 if a.get('kind')=='Vertex':return native_equal(left,right)
 if left.get('curve')!=right.get('curve'):return False
 for field in ('axis','direction'):
  if (field in left)!=(field in right):return False
  if field in left:
   av=left.pop(field);bv=right.pop(field)
   if not native_equal(av,bv) and not native_equal(av,[-v for v in bv]):return False
 if left.get('curve')=='Circle' and left.get('full_circle') and right.get('full_circle'):
  for field in ('endpoints','samples'):left.pop(field,None);right.pop(field,None)
  return native_equal(left,right)
 le=left.pop('endpoints',None);re=right.pop('endpoints',None);ls=left.pop('samples',None);rs=right.pop('samples',None)
 if not native_equal(left,right):return False
 return (native_equal(le,re) and native_equal(ls,rs)) or (isinstance(re,list) and isinstance(rs,list) and native_equal(le,list(reversed(re))) and native_equal(ls,list(reversed(rs))))

def native_assert_reference_preservation(before,after):
 if len(before)!=len(after):raise RuntimeError('真实尺寸数量变化；保持原件')
 for old,new in zip(before,after):
  if old['status']!='valid' or new['status']!='valid':raise RuntimeError('真实Edge/Vertex不能确证；保持原件，不猜测修复: '+old['dimension'])
  if old['dimension']!=new['dimension'] or old['type']!=new['type'] or not native_equal(old['actual_value'],new['actual_value']) or len(old['references'])!=len(new['references']):raise RuntimeError('真实尺寸语义或数值变化；保持原件')
  for a,b in zip(old['references'],new['references']):
   if a['view']!=b['view'] or a['sub']!=b['sub'] or not native_geometry_equal(a.get('geometry'),b.get('geometry')):raise RuntimeError('真实投影引用几何变化，号码/数值相同不能通过: '+old['dimension'])
`;

/** Initialize only AFTER the PID+nonce owner check. Source assembly properties
 * are read, never assigned/recomputed. Actual calls to Python preSolve,
 * solveIfAllowed and Python-to-native solve are observed and stopped. */
export const nativeSourceAssemblySafety = String.raw`
native_solver_observations=[]
native_assembly_utils=None
native_observer_restore=[]
native_original_profile=None
native_profile_callback=None
native_preflight_placements={}
native_private_preferences=None
native_observer_coverage=[]

def native_matrix(placement):return [native_finite(value) for value in placement.toMatrix().A]

def native_solver_profile(frame,event,arg):
 if event=='c_call' and getattr(arg,'__name__','')=='solve':
  target=getattr(arg,'__self__',None)
  if str(getattr(target,'TypeId','')).startswith('Assembly::'):
   native_solver_observations.append({'kind':'solve','object':getattr(target,'Name','')})
   raise RuntimeError('观察到原生Assembly.solve调用，已阻止；需人工核对源总成')

def native_safety_initialize():
 global native_assembly_utils,native_original_profile,native_profile_callback,native_private_preferences
 import sys
 if not owned:raise RuntimeError('归属未确认；不修改配置或打开文档')
 folder=os.path.realpath(os.path.dirname(spec['native_owner_file']))
 configuration={name:os.path.realpath(A.ConfigGet(name)) for name in ('UserParameter','SystemParameter')}
 if any(not value or os.path.commonpath([folder,value])!=folder for value in configuration.values()):raise RuntimeError('未确认独立-u/-s配置；不打开源文件')
 preferences=A.ParamGet('User parameter:BaseApp/Preferences/Mod/Assembly')
 preferences.SetBool('SolveOnRecompute',False);preferences.SetBool('SolveInJointCreation',False)
 if preferences.GetBool('SolveOnRecompute',True) or preferences.GetBool('SolveInJointCreation',True):raise RuntimeError('不能关闭源装配自动求解；需人工核对')
 native_private_preferences={'SolveOnRecompute':preferences.GetBool('SolveOnRecompute',True),'SolveInJointCreation':preferences.GetBool('SolveInJointCreation',True)}
 if 'source_fingerprints' not in spec:raise RuntimeError('缺少完整源指纹守护；不打开源文件')
 assembly_files=[]
 for filename,digest in spec['source_fingerprints'].items():
  if hashlib.sha256(open(filename,'rb').read()).hexdigest()!=digest:raise RuntimeError('源字节已变化；不打开源文件')
  if not filename.lower().endswith('.fcstd'):continue
  with zipfile.ZipFile(filename) as archive:xml=ET.fromstring(archive.read('Document.xml'))
  types={o.get('name'):o.get('type','') for o in xml.findall('./Objects/Object')}
  has_assembly=any(t.startswith('Assembly::') for t in types.values()) or any(p.get('name') in ('Reference1','Reference2') for p in xml.iter('Property'))
  if has_assembly:assembly_files.append(filename)
  placements={}
  for obj in xml.findall('./ObjectData/Object'):
   props={p.get('name'):p for p in obj.findall('./Properties/Property')}
   if has_assembly and ('Reference1' in props or 'Reference2' in props) and any(name not in props for name in ('Placement1','Placement2','Offset1','Offset2')):raise RuntimeError('源Joint缺少本版可验证连接Frame；保持原件，需人工核对')
   for name in ('Placement','LinkPlacement','Placement1','Placement2','Offset1','Offset2'):
    if name not in props:continue
    # PartDesign features also use Offset1/Offset2 for ordinary lengths. Only
    # actual placement properties (or mandatory Joint frames) are placements.
    joint=types.get(obj.get('name'))=='Assembly::Joint' or 'Reference1' in props or 'Reference2' in props
    if name not in ('Placement','LinkPlacement') and not joint and props[name].get('type')!='App::PropertyPlacement':continue
    p=props[name].find('PropertyPlacement')
    if p is None:raise RuntimeError('源位姿序列化无法确证；需人工核对')
    required=('Px','Py','Pz','Q0','Q1','Q2','Q3')
    if any(key not in p.attrib for key in required):raise RuntimeError('源位姿字段不完整；需人工核对')
    values=[native_finite(p.get(key)) for key in required]
    placements.setdefault(obj.get('name'),{})[name]=native_matrix(A.Placement(A.Vector(*values[:3]),A.Rotation(*values[3:])))
  native_preflight_placements[os.path.realpath(filename)]=placements
 candidates=[os.path.join(A.getHomePath(),'Mod','Assembly'),os.path.join(A.getResourceDir(),'Mod','Assembly')]
 module_path=next((path for path in candidates if os.path.isfile(os.path.join(path,'JointObject.py'))),None)
 if module_path is not None:
  if module_path not in sys.path:sys.path.insert(0,module_path)
  import JointObject,UtilsAssembly
  if any(os.path.commonpath([os.path.realpath(module_path),os.path.realpath(module.__file__)])!=os.path.realpath(module_path) for module in (JointObject,UtilsAssembly)):raise RuntimeError('Assembly模块不是已确认安装目录；源总成入口需人工确认')
  native_assembly_utils=UtilsAssembly
  if not all(hasattr(UtilsAssembly,name) for name in ('findPlacement','getGlobalPlacement','getJcsGlobalPlc','getElementName','isRefValid','getObject')):raise RuntimeError('本版Assembly实际Frame接口缺失；保持原件，需人工核对')
  def observed_pre(proxy,joint,*args,**kwargs):
   native_solver_observations.append({'kind':'preSolve','object':joint.Name});raise RuntimeError('观察到preSolve，已阻止；需人工核对源总成')
  def observed_solve(assembly,*args,**kwargs):
   native_solver_observations.append({'kind':'solveIfAllowed','object':assembly.Name if assembly else ''});raise RuntimeError('观察到solveIfAllowed，已阻止；需人工核对源总成')
  native_observer_restore.extend([(JointObject.Joint,'preSolve',JointObject.Joint.preSolve),(JointObject,'solveIfAllowed',JointObject.solveIfAllowed)])
  JointObject.Joint.preSolve=observed_pre;JointObject.solveIfAllowed=observed_solve
  native_observer_coverage.extend(['Python Joint.preSolve','Python solveIfAllowed'])
 elif assembly_files:raise RuntimeError('未安装可核验的Assembly接口；源总成入口需人工确认')
 native_original_profile=sys.getprofile()
 if native_original_profile is not None:raise RuntimeError('不能独立观察原生solve调用；源总成入口需人工确认')
 native_profile_callback=native_solver_profile;sys.setprofile(native_profile_callback)
 native_observer_coverage.extend(['CPython c_call into native Assembly.solve','Native internal C++ automatic solve disabled by private preferences; not instrumented'])
 return {'configuration':configuration,'preferences':{'SolveOnRecompute':False,'SolveInJointCreation':False},'assembly_source_files':assembly_files}

def native_assert_solver_quiet():
 import sys
 if native_solver_observations:raise RuntimeError('检测到源装配求解入口；保持原件，需人工核对')
 if native_profile_callback is None or sys.getprofile() is not native_profile_callback:raise RuntimeError('原生solve观察器不再生效；保持原件，需人工核对')

def native_source_reference(ref):
 target,subs=ref
 return {'object':target.Name if target else None,'file':os.path.realpath(target.Document.FileName) if target else None,'subs':list(subs)}

def native_source_graph(drawing):
 native_assert_solver_quiet()
 result={}
 for d in A.listDocuments().values():
  if d is drawing:continue
  filename=os.path.realpath(d.FileName)
  if filename not in spec['source_fingerprints']:raise RuntimeError('原生加载了未守护的源文档；保持原件')
  r={'placements':{},'links':{},'joints':{}}
  for o in d.Objects:
   for prop,expected in native_preflight_placements.get(filename,{}).get(o.Name,{}).items():
    if prop not in o.PropertiesList or not native_equal(native_matrix(getattr(o,prop)),expected,1e-7):raise RuntimeError('源存储位姿与实际读取不同；保持原件，需人工核对: '+o.Name+'.'+prop)
   if 'Placement' in o.PropertiesList:r['placements'][o.Name]=native_matrix(o.Placement)
   if 'LinkedObject' in o.PropertiesList:
    target=o.LinkedObject;link={'type':o.TypeId,'target':target.Name if target else None,'file':os.path.realpath(target.Document.FileName) if target else None,'failure_state':native_object_failure(o)}
    for prop in ('Placement','LinkPlacement'):
     if prop in o.PropertiesList:link[prop]=native_matrix(getattr(o,prop))
    for prop in ('LinkTransform','Rigid'):
     if prop in o.PropertiesList:link[prop]=bool(getattr(o,prop))
    if 'ScaleVector' in o.PropertiesList:link['ScaleVector']=native_vector(o.ScaleVector)
    if native_assembly_utils is not None:link['world']=native_matrix(native_assembly_utils.getGlobalPlacement((o,['']),o))
    elif hasattr(o,'getGlobalPlacement'):link['world']=native_matrix(o.getGlobalPlacement())
    else:raise RuntimeError('本版不能确证源Link世界位姿；保持原件，需人工核对')
    r['links'][o.Name]=link
   if 'Reference1' in o.PropertiesList or 'Reference2' in o.PropertiesList:
    if native_assembly_utils is None or not hasattr(getattr(o,'Proxy',None),'findPlacement'):raise RuntimeError('源Joint没有实际Frame接口；保持原件，需人工核对')
    joint={'type':str(o.JointType),'Reference1':native_source_reference(o.Reference1),'Reference2':native_source_reference(o.Reference2),'failure_state':native_object_failure(o)}
    for prop in ('Placement1','Placement2','Offset1','Offset2'):joint[prop]=native_matrix(getattr(o,prop))
    for prop in ('Detach1','Detach2','Suppressed'):
     if prop in o.PropertiesList:joint[prop]=bool(getattr(o,prop))
    for side in (1,2):
     reference=getattr(o,'Reference'+str(side));target,subs=reference
     try:
      if target is None or not native_assembly_utils.isRefValid(reference,2):raise ValueError('invalid_reference_structure')
      if native_assembly_utils.getObject(reference) is None:raise ValueError('missing_reference_object')
      first=target.getSubObject(subs[0])
      if first is None or isinstance(first,Part.Shape) and (first.isNull() or not first.isValid()):raise ValueError('missing_or_invalid_primary')
      selectors=[]
      for index,sub in enumerate(subs):
       element=native_assembly_utils.getElementName(sub)
       shape=first.getElement(element) if index==1 and isinstance(first,Part.Shape) and first.ShapeType=='Face' and element.startswith('Edge') else target.getSubObject(sub)
       if shape is None or isinstance(shape,Part.Shape) and (shape.isNull() or not shape.isValid()):raise ValueError('missing_or_invalid_selector')
       item={'sub':sub,'type':shape.ShapeType if isinstance(shape,Part.Shape) else shape.TypeId}
       if isinstance(shape,Part.Shape) and shape.ShapeType=='Edge':item['geometry']=native_edge_geometry(shape);item['geometry']['coordinate_space']='source_topology'
       elif isinstance(shape,Part.Shape) and shape.ShapeType=='Vertex':item['point']=native_vector(shape.Point)
       selectors.append(item)
      computed=o.Proxy.findPlacement(o,reference,side-1)
      joint['actual_local'+str(side)]=native_matrix(computed);joint['actual_world'+str(side)]=native_matrix(native_assembly_utils.getGlobalPlacement(reference)*computed);joint['selectors'+str(side)]=selectors
     except Exception as error:joint['unresolved'+str(side)]=str(error)
     joint['stored_world'+str(side)]=native_matrix(native_assembly_utils.getJcsGlobalPlc(getattr(o,'Placement'+str(side)),reference))
    r['joints'][o.Name]=joint
  result[filename]=r
 native_assert_solver_quiet()
 return result

def native_assert_source_preservation(before,drawing):
 after=native_source_graph(drawing)
 if not native_equal(before,after):raise RuntimeError('源Link/Joint故障状态、局部/世界位姿或实际连接Frames变化；保持原件，不求解或修关节')
 for filename,digest in spec['source_fingerprints'].items():
  if hashlib.sha256(open(filename,'rb').read()).hexdigest()!=digest:raise RuntimeError('源文档字节变化；不确认成功')
 return after

def native_frame_coverage_failures(graph):
 failures=[]
 for filename,value in graph.items():
  for name,joint in value['joints'].items():
   for side in (1,2):
    key='unresolved'+str(side)
    if key in joint:failures.append(os.path.basename(filename)+':'+name+'.Reference'+str(side)+': '+joint[key])
    elif any(field+str(side) not in joint for field in ('actual_local','actual_world','selectors')):failures.append(os.path.basename(filename)+':'+name+'.Reference'+str(side)+': 本版实际Frame证据不完整')
 return failures

def native_assert_frame_coverage(graph):
 failures=native_frame_coverage_failures(graph)
 if failures:raise RuntimeError('源总成已有引用或本版接口不能确认全部实际Joint Frames；禁止维护入口，保持原件，需人工核对: '+'; '.join(failures[:16]))

def native_safety_summary(graph,status='verified',reason=None):
 failures=native_frame_coverage_failures(graph)
 if failures:
  status='manual'
  message='源总成已有引用或本版接口不能确认全部实际Joint Frames；只读证据保留，禁止维护入口，需人工核对: '+'; '.join(failures[:16])
  reason=(reason+'; ' if reason else '')+message
 errors=[]
 for filename,value in graph.items():
  for group in ('links','joints'):
   for name,entry in value[group].items():
    failure=entry.get('failure_state')
    if failure is None:
     status='manual';reason=(reason+'; ' if reason else '')+'源对象故障状态证据缺失: '+name
    elif failure['states']:errors.append({'file':os.path.basename(filename),'object':name,'kind':'link' if group=='links' else 'joint',**failure})
 result={'status':status,'preferences':native_private_preferences or {'SolveOnRecompute':None,'SolveInJointCreation':None},'solver_observations':list(native_solver_observations),'source_document_count':len(graph),'source_link_count':sum(len(value['links']) for value in graph.values()),'source_joint_count':sum(len(value['joints']) for value in graph.values()),'source_poses_and_actual_frames_unchanged':status=='verified','existing_unresolved_joint_sides':sum(('unresolved'+str(side)) in joint for value in graph.values() for joint in value['joints'].values() for side in (1,2)),'observer_coverage':list(native_observer_coverage),'source_object_errors':errors}
 if errors:reason=(reason+'; ' if reason else '')+'已有源Link/Joint故障保留且未修复；仅确认本次Frames/位姿及故障状态保持，不代表源工程健康'
 if reason:result['reason']=reason
 return result

def native_source_hashes_unchanged():
 for filename,digest in spec.get('source_fingerprints',{}).items():
  try:
   if hashlib.sha256(open(filename,'rb').read()).hexdigest()!=digest:return False
  except OSError:return False
 return bool(spec.get('source_fingerprints'))

def native_safety_shutdown():
 import sys
 if native_profile_callback is not None:sys.setprofile(native_original_profile)
 for module,name,original in reversed(native_observer_restore):setattr(module,name,original)
`;
