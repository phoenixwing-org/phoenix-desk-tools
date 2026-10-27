import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { nativeCamera } from './nativeCamera.js';

// Independent arithmetic and a fake Coin scene: no CAD files or GUI process.
const fixture = String.raw`
import math,types,sys
class Vector:
 def __init__(self,x=0,y=0,z=0):self.x=x;self.y=y;self.z=z
 def __iter__(self):return iter((self.x,self.y,self.z))
 def __add__(self,b):return Vector(self.x+b.x,self.y+b.y,self.z+b.z)
 def __sub__(self,b):return Vector(self.x-b.x,self.y-b.y,self.z-b.z)
 def __mul__(self,n):return Vector(self.x*n,self.y*n,self.z*n)
 def dot(self,b):return self.x*b.x+self.y*b.y+self.z*b.z
class Rotation:
 def __init__(self,*args):
  if isinstance(args[-1],str):
   assert tuple(args[0])==(1,1,0) and tuple(args[1])==(-1,1,2) and tuple(args[2])==(1,-1,1) and args[3]=='ZXY'
   # Independently derive the quaternion from the orthonormal basis matrix.
   r=(1/math.sqrt(2),1/math.sqrt(2),0);u=(-1/math.sqrt(6),1/math.sqrt(6),2/math.sqrt(6));n=(1/math.sqrt(3),-1/math.sqrt(3),1/math.sqrt(3))
   w=math.sqrt(1+r[0]+u[1]+n[2])/2
   self.Q=((u[2]-n[1])/(4*w),(n[0]-r[2])/(4*w),(r[1]-u[0])/(4*w),w)
  else:self.Q=args
 def multVec(self,p):
  x,y,z,w=self.Q;v=Vector(x,y,z);cross=Vector(y*p.z-z*p.y,z*p.x-x*p.z,x*p.y-y*p.x)
  return p*(w*w-v.dot(v))+v*(2*v.dot(p))+cross*(2*w)
class Field:
 def __init__(self,value):self.value=value
 def getValue(self):return self.value
 def setValue(self,*value):self.value=value[0] if len(value)==1 else VecValue(value)
class VecValue:
 def __init__(self,value):self.value=value
 def getValue(self):return self.value
class CoinRotation(VecValue):
 def __init__(self,*value):super().__init__(value)
class Box:
 def isEmpty(self):return empty
 def getMin(self):return VecValue(low)
 def getMax(self):return VecValue(high)
class BoundsAction:
 def __init__(self,viewport):assert viewport==size
 def apply(self,scene):
  assert scene is visible_scene;calls.append('visible-world-scene')
  assert all(group.field.getValue()=='EXCLUDE_BBOX' for group in groups)
  if bounds_fail:raise RuntimeError('independent bounds failure')
 def getBoundingBox(self):return Box()
class Search:
 ALL=9
 def setType(self,kind):pass
 def setInterest(self,interest):assert interest==self.ALL
 def apply(self,scene):assert scene is visible_scene
 def getPaths(self):return Paths()
class Paths:
 def getLength(self):return len(groups)
 def __getitem__(self,index):return types.SimpleNamespace(getTail=lambda:groups[index])
class Group:
 def __init__(self,key,value):self.key=key;self.field=Field(value);self.field.isConnected=lambda:False
 def getNodeId(self):return self.key
 def getField(self,name):assert name=='mode';return self.field
class View:
 def __init__(self):
  self.kind='Perspective';self.camera=types.SimpleNamespace(orientation=Field(CoinRotation(0,0,math.sin(.2),math.cos(.2))),position=Field(VecValue((7,11,80))),heightAngle=Field(.7),aspectRatio=Field(1.7),focalDistance=Field(60.0),nearDistance=Field(.5),farDistance=Field(800.0))
 def getCameraNode(self):return self.camera
 def getCameraType(self):return self.kind
 def setCameraType(self,kind):
  calls.append('projection');self.kind=kind
  if kind=='Orthographic':del self.camera.heightAngle;self.camera.height=Field(37.0)
 def getSize(self):return size
 def getSceneGraph(self):return visible_scene
calls=[];size=(400,300);low=[-20,-7,-2];high=[25,12,14];empty=False;visible_scene=object();groups=[];bounds_fail=False
coin=types.SimpleNamespace(SbRotation=CoinRotation,SbViewportRegion=lambda w,h:(w,h),SoGetBoundingBoxAction=BoundsAction,SoType=types.SimpleNamespace(fromName=lambda name:types.SimpleNamespace(isBad=lambda:False)),SoSearchAction=Search)
sys.modules['FreeCAD']=types.SimpleNamespace(Vector=Vector,Rotation=Rotation)
sys.modules['pivy']=types.SimpleNamespace(coin=coin)
`;
function check(body: string) {
  const result = spawnSync('python3', ['-c', `${fixture}\n${nativeCamera}\n${body}`], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
}
it('preserves the whole camera with no request and projection/zoom with orientation only', () => check(String.raw`
view=View();before=native_camera_state(view)
assert native_configure_camera(view,False,False) is None
assert native_camera_state(view)==before and not calls
expected=native_configure_camera(view,True,False)
assert view.kind=='Perspective' and not calls
assert 'height' not in expected
for key in ('heightAngle','aspectRatio','focalDistance','nearDistance','farDistance'):assert expected[key]==before[key]
old=Rotation(*before['orientation']);new=Rotation(*expected['orientation'])
old_center=Vector(*before['position'])-old.multVec(Vector(0,0,1))*before['focalDistance']
new_center=Vector(*expected['position'])-new.multVec(Vector(0,0,1))*expected['focalDistance']
assert all(abs(a-b)<1e-10 for a,b in zip(old_center,new_center))
right=new.multVec(Vector(1,0,0));up=new.multVec(Vector(0,1,0))
lengths=[math.hypot(right.dot(p),up.dot(p)) for p in (Vector(1,0,0),Vector(0,1,0),Vector(0,0,1))]
assert all(abs(n-math.sqrt(2/3))<1e-12 for n in lengths)
assert abs(right.z)<1e-12 and up.z>0
native_assert_camera_stable(view,expected)
view.camera.nearDistance.setValue(.1);view.camera.farDistance.setValue(900.)
native_assert_camera_stable(view,expected)
view.camera.position.setValue(1,2,3)
try:native_assert_camera_stable(view,expected)
except RuntimeError:pass
else:raise AssertionError('camera drift accepted')
`));
it('fits all eight world-space corners for native and export aspect, retaining orientation unless requested', () => check(String.raw`
for size in ((400,300),(300,600),(900,300)):
 for iso in (False,True):
  for aspect in (1.0,4/3):
   view=View();before=native_camera_state(view);calls.clear()
   expected=native_configure_camera(view,iso,True,aspect)
   assert calls==(['projection','visible-world-scene'] if iso else ['visible-world-scene'])
   assert view.kind==('Orthographic' if iso else 'Perspective')
   if not iso:assert expected['orientation']==before['orientation'] and expected['heightAngle']==before['heightAngle']
   rotation=Rotation(*expected['orientation']);right=rotation.multVec(Vector(1,0,0));up=rotation.multVec(Vector(0,1,0));normal=rotation.multVec(Vector(0,0,1))
   center=Vector(*[(a+b)/2 for a,b in zip(low,high)]);position=Vector(*expected['position'])
   for x in (low[0],high[0]):
    for y in (low[1],high[1]):
     for z in (low[2],high[2]):
      p=Vector(x,y,z);relative=p-center;depth=normal.dot(position-p)
      half_height=expected['height']/2 if iso else depth*math.tan(expected['heightAngle']/2)
      assert abs(up.dot(relative))<half_height
      for a in (size[0]/size[1],aspect):assert abs(right.dot(relative))<half_height*a
      assert expected['nearDistance']<depth<expected['farDistance']
   native_assert_camera_stable(view,expected)
   height_field=view.camera.height if iso else view.camera.heightAngle
   old_height=height_field.getValue();height_field.setValue(old_height*1.01)
   try:native_assert_camera_stable(view,expected)
   except RuntimeError:pass
   else:raise AssertionError('view height drift accepted')
   height_field.setValue(old_height)
   view.camera.nearDistance.setValue(expected['_fit_depth'][0]-.1);view.camera.farDistance.setValue(expected['_fit_depth'][1]+.1)
   native_assert_camera_stable(view,expected)
   view.camera.nearDistance.setValue(expected['_fit_depth'][0]+1)
   try:native_assert_camera_stable(view,expected)
   except RuntimeError:pass
   else:raise AssertionError('clipped Fit accepted')
`));
it('excludes guide groups only while measuring and restores every original mode on error', () => check(String.raw`
first=Group(101,'INCLUDE_BBOX');second=Group(102,'EXCLUDE_BBOX');groups=[first,second,first]
low_before=list(low);high_before=list(high)
assert native_visible_camera_bounds(View(),400,300)==(low_before,high_before)
assert first.field.getValue()=='INCLUDE_BBOX' and second.field.getValue()=='EXCLUDE_BBOX'
bounds_fail=True
try:native_visible_camera_bounds(View(),400,300)
except RuntimeError:pass
else:raise AssertionError('bounds failure swallowed')
assert first.field.getValue()=='INCLUDE_BBOX' and second.field.getValue()=='EXCLUDE_BBOX'
`));
it('fails closed on empty/invalid visible geometry, viewport or options', () => check(String.raw`
for problem in ('empty','nan','point','inverted','viewport','aspect','margin'):
 low=[-20,-7,-2];high=[25,12,14];empty=False;size=(400,300);aspect=1.;margin=1.12
 if problem=='empty':empty=True
 if problem=='nan':high[0]=float('nan')
 if problem=='point':high=list(low)
 if problem=='inverted':high[0]=low[0]-1
 if problem=='viewport':size=(0,300)
 if problem=='aspect':aspect=float('inf')
 if problem=='margin':margin=.9
 try:native_configure_camera(View(),True,True,aspect,margin)
 except ValueError:pass
 else:raise AssertionError('invalid Fit accepted: '+problem)
`));
