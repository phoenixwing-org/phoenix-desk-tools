/** Embedded in owned GUI workers only. No animated view APIs or document writes. */
export const nativeCamera = String.raw`
import math as camera_math
import FreeCAD as CameraApp
from pivy import coin as camera_coin

def native_camera_state(view):
 camera=view.getCameraNode()
 values={'orientation':list(camera.orientation.getValue().getValue()),'position':list(camera.position.getValue().getValue())}
 for name in ('height','heightAngle','aspectRatio','focalDistance','nearDistance','farDistance'):
  if hasattr(camera,name):values[name]=float(getattr(camera,name).getValue())
 if any(not camera_math.isfinite(x) for value in values.values() for x in (value if isinstance(value,list) else [value])):raise ValueError('相机参数不是有限数值')
 return values

def native_assert_camera_stable(view,expected):
 if expected is None:return
 actual=native_camera_state(view)
 if actual.keys()!={key for key in expected if not key.startswith('_')} or view.getCameraType()!=expected['_camera_type']:raise RuntimeError('相机类型在渲染前变化')
 if actual['nearDistance']>=actual['farDistance']:raise RuntimeError('相机裁剪范围无效')
 for key,value in expected.items():
  # Coin auto-clipping legitimately recalculates these during redraw. Check
  # coverage below, not equality with the manually seeded initial planes.
  if key.startswith('_') or key in ('nearDistance','farDistance'):continue
  first=value if isinstance(value,list) else [value]
  second=actual[key] if isinstance(actual[key],list) else [actual[key]]
  if len(first)!=len(second) or any(not camera_math.isclose(a,b,rel_tol=1e-7,abs_tol=1e-6) for a,b in zip(first,second)):raise RuntimeError('相机尚未稳定；保留原文件及缩略图')
 if '_fit_depth' in expected:
  low,high=expected['_fit_depth'];tolerance=max(1e-5,abs(high)*1e-6)
  if actual['nearDistance']>low+tolerance or actual['farDistance']<high-tolerance:raise RuntimeError('相机裁剪面未包住Fit目标；保留原文件及缩略图')

def native_visible_camera_bounds(view,width,height):
 # Coin traverses this viewport's visible scene, including world placements.
 # Do not union all document Shapes: that includes hidden construction history.
 # Match FreeCAD viewAll's auxiliary-geometry exclusion, but restore each
 # exact previous mode (including already-excluded groups) even on failure.
 scene=view.getSceneGraph();kind=camera_coin.SoType.fromName('SoSkipBoundingGroup')
 if kind.isBad():raise ValueError('不能确认Fit辅助几何排除规则')
 search=camera_coin.SoSearchAction();search.setType(kind);search.setInterest(camera_coin.SoSearchAction.ALL);search.apply(scene)
 paths=search.getPaths();groups={}
 for index in range(paths.getLength()):
  node=paths[index].getTail();groups[node.getNodeId()]=node
 saved=[]
 try:
  for node in groups.values():
   field=node.getField('mode')
   if field is None or field.isConnected():raise ValueError('辅助几何Fit模式不可安全暂存')
   saved.append((field,field.getValue()));field.setValue('EXCLUDE_BBOX')
  action=camera_coin.SoGetBoundingBoxAction(camera_coin.SbViewportRegion(width,height))
  action.apply(scene);box=action.getBoundingBox()
  if box.isEmpty():raise ValueError('当前3D视图没有可用于Fit的可见几何')
  return list(box.getMin().getValue()),list(box.getMax().getValue())
 finally:
  for field,value in reversed(saved):field.setValue(value)

def native_configure_camera(view,axonometric,fit,export_aspect=1.0,margin=1.12):
 if not axonometric and not fit:return None
 if not camera_math.isfinite(export_aspect) or export_aspect<=0 or not camera_math.isfinite(margin) or margin<1:raise ValueError('Fit比例或留白无效')
 # Explicit ISO+Fit uses an orthographic camera. Fit alone must not discard a
 # custom perspective projection, and orientation alone must retain zoom.
 if fit and axonometric and view.getCameraType()!='Orthographic':view.setCameraType('Orthographic')
 camera=view.getCameraNode()
 previous=native_camera_state(view)
 old_rotation=CameraApp.Rotation(*previous['orientation'])
 rotation=CameraApp.Rotation(CameraApp.Vector(1,1,0),CameraApp.Vector(-1,1,2),CameraApp.Vector(1,-1,1),'ZXY') if axonometric else old_rotation
 normal=rotation.multVec(CameraApp.Vector(0,0,1))
 if fit:
  width,height=view.getSize()
  if width<=0 or height<=0:raise ValueError('3D视口尺寸无效，不能安全Fit')
  low,high=native_visible_camera_bounds(view,width,height)
  if len(low)!=3 or len(high)!=3 or any(not camera_math.isfinite(x) for x in low+high) or any(a>b for a,b in zip(low,high)):raise ValueError('可见几何边界无效')
  center=CameraApp.Vector(*[(a+b)/2 for a,b in zip(low,high)])
  diagonal=camera_math.sqrt(sum((b-a)**2 for a,b in zip(low,high)))
  if not diagonal>0:raise ValueError('当前3D视图没有非空的可见几何')
  right=rotation.multVec(CameraApp.Vector(1,0,0));up=rotation.multVec(CameraApp.Vector(0,1,0))
  corners=[CameraApp.Vector(x,y,z)-center for x in (low[0],high[0]) for y in (low[1],high[1]) for z in (low[2],high[2])]
  horizontal=[right.dot(p) for p in corners];vertical=[up.dot(p) for p in corners]
  aspect=min(width/height,export_aspect)
  if view.getCameraType()=='Orthographic':
   camera_height=margin*max(max(vertical)-min(vertical),(max(horizontal)-min(horizontal))/aspect)
   if not camera_math.isfinite(camera_height) or camera_height<=0:raise ValueError('Fit高度无效')
   distance=3*diagonal
  elif view.getCameraType()=='Perspective':
   angle=previous.get('heightAngle',0)
   if not 0<angle<camera_math.pi:raise ValueError('透视相机视场角无效，不能安全Fit')
   tangent=camera_math.tan(angle/2)
   # Every corner must lie inside both the native and export frusta. Keep
   # orientation and heightAngle; only translate along the camera normal.
   distance=max(normal.dot(p)+margin*max(abs(up.dot(p)),abs(right.dot(p))/aspect)/tangent for p in corners)
   distance=max(distance,max(normal.dot(p) for p in corners)+diagonal*.01)
  else:raise ValueError('不支持此相机投影，不能安全Fit')
  position=center+normal*distance
  depths=[normal.dot(position-(p+center)) for p in corners]
  if view.getCameraType()=='Orthographic':camera.height.setValue(camera_height)
  camera.aspectRatio.setValue(export_aspect)
  camera.focalDistance.setValue(distance)
  camera.nearDistance.setValue(min(depths)*.5)
  camera.farDistance.setValue(max(depths)*1.5)
 else:
  distance=previous['focalDistance']
  if distance<=0:raise ValueError('相机焦距无效，不能安全切换轴测图')
  center=CameraApp.Vector(*previous['position'])-old_rotation.multVec(CameraApp.Vector(0,0,1))*distance
  position=center+normal*distance
 camera.orientation.setValue(camera_coin.SbRotation(*rotation.Q))
 camera.position.setValue(position.x,position.y,position.z)
 result=native_camera_state(view);result['_camera_type']=view.getCameraType()
 if fit:result['_fit_depth']=[min(depths),max(depths)]
 return result
`;
