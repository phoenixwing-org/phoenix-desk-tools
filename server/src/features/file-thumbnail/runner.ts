import { nativeCamera } from '../../lib/nativeCamera.js';
/** Isolated GUI process. Render only: never save a document or change user preferences. */
export const thumbnailRunner = String.raw`
import json, os, time, hashlib
from pathlib import Path

# This guard runs before importing anything that can touch a user GUI/document.
_config = Path(JOB_PATH)
if _config.is_symlink() or _config.stat().st_size > 16384:
    raise RuntimeError('invalid owned thumbnail configuration')
spec = json.loads(_config.read_text(encoding='utf-8'))
_proof = {'version': 1, 'native_pid': os.getpid(), 'native_nonce': spec['nonce']}
_deadline = time.monotonic() + 10.0
_owner = Path(spec['owner'])
while not _owner.exists():
    if time.monotonic() >= _deadline:
        Path(spec['report']).write_text(json.dumps(dict(_proof, status='failed', reason='owner_timeout')), encoding='utf-8')
        raise RuntimeError('owned thumbnail authorization missing')
    time.sleep(0.02)
if _owner.is_symlink() or _owner.stat().st_size > 4096 or json.loads(_owner.read_text(encoding='utf-8')) != {'pid': os.getpid(), 'nonce': spec['nonce']}:
    Path(spec['report']).write_text(json.dumps(dict(_proof, status='failed', reason='owner_mismatch')), encoding='utf-8')
    raise RuntimeError('thumbnail macro does not belong to this process')

import FreeCAD as App, FreeCADGui as Gui
from PySide import QtCore, QtGui, QtWidgets
from pivy import coin
_private_root = _config.parent.resolve()
for _key, _directory in {'UserHomePath': 'home', 'UserConfigPath': 'home', 'UserAppData': 'data', 'UserCachePath': 'temp', 'AppTempPath': 'temp'}.items():
    if Path(App.ConfigGet(_key)).resolve() != (_private_root / _directory).resolve():
        Path(spec['report']).write_text(json.dumps(dict(_proof, status='failed', reason='private_path_mismatch')), encoding='utf-8')
        raise RuntimeError('thumbnail private path mismatch')
if App.listDocuments():
    Path(spec['report']).write_text(json.dumps(dict(_proof, status='failed', reason='unexpected_document')), encoding='utf-8')
    raise RuntimeError('unexpected initial document')
${nativeCamera}

def stage(name):
    Path(spec['report']).write_text(json.dumps(dict(_proof, status='rendering', stage=name)), encoding='utf-8')

def thumbnail_image_bounds(image):
    colors = set()
    left, top, right, bottom = image.width(), image.height(), -1, -1
    # Sparse samples may estimate color variety, but must never define a crop:
    # a detached one-pixel edge can lie entirely between the sample columns.
    for y in range(image.height()):
        for x in range(image.width()):
            c = image.pixelColor(x, y)
            red, green, blue, alpha = c.red(), c.green(), c.blue(), c.alpha()
            if x % 4 == 0 and y % 4 == 0:
                colors.add((red // 16, green // 16, blue // 16, alpha // 16))
            if alpha > 32 and min(red, green, blue) < 245:
                left, top, right, bottom = min(left, x), min(top, y), max(right, x), max(bottom, y)
    return colors, (left, top, right, bottom)

def thumbnail_render_size(view, fit):
    if fit:
        return 1024, 1024
    import math
    try:
        aspect = float(view.getCameraNode().aspectRatio.getValue())
    except (AttributeError, TypeError, ValueError, OverflowError):
        aspect = float('nan')
    if not math.isfinite(aspect) or aspect <= 0:
        width, height = (float(value) for value in view.getSize())
        if not all(math.isfinite(value) and value > 0 for value in (width, height)):
            raise ValueError('原相机和视口比例无效，不能保留取景')
        aspect = width / height
    return (512, max(1, round(512 / aspect))) if aspect >= 1 else (max(1, round(512 * aspect)), 512)

def thumbnail_letterbox(image, output):
    # Resize the whole original frame, never its foreground bounds. No Fit or
    # camera write is allowed when the user only requests a square thumbnail.
    scaled = image.scaled(512, 512, QtCore.Qt.KeepAspectRatio, QtCore.Qt.SmoothTransformation)
    result_image = QtGui.QImage(512, 512, QtGui.QImage.Format_ARGB32)
    result_image.fill(QtGui.QColor('white'))
    painter = QtGui.QPainter(result_image)
    try:
        painter.drawImage((512-scaled.width())//2, (512-scaled.height())//2, scaled)
    finally:
        painter.end()
    if not result_image.save(output):
        raise ValueError('无法保存缩略图 PNG')

def render():
    result = {'status': 'failed'}
    owned_documents = []
    try:
        stage('opening')
        if App.listDocuments():
            raise RuntimeError('unexpected document before owned open')
        doc = App.openDocument(spec['source'])
        owned_documents = list(App.listDocuments().values())
        views = Gui.getDocument(doc.Name).mdiViewsOfType('Gui::View3DInventor')
        if not views:
            raise ValueError('当前文件没有可用的3D视图')
        view = views[0]
        stage('preparing')
        if spec['options']['color'] == 'neutral':
            for opened in owned_documents:
                for obj in opened.Objects:
                    vp = obj.ViewObject
                    if vp is None:
                        continue
                    if 'ShapeAppearance' in vp.PropertiesList:
                        materials = list(vp.ShapeAppearance)
                        for material in materials:
                            material.DiffuseColor = (0.78, 0.80, 0.83)
                        vp.ShapeAppearance = materials
                    else:
                        if hasattr(vp, 'ShapeColor'):
                            vp.ShapeColor = (0.78, 0.80, 0.83)
                        if hasattr(vp, 'DiffuseColor'):
                            vp.DiffuseColor = [(0.78, 0.80, 0.83)] * max(1, len(vp.DiffuseColor))
        view.setAxisCross(False)
        view.setCornerCrossSize(0)
        Gui.updateGui()
        QtWidgets.QApplication.processEvents()
        expected_camera = native_configure_camera(view, spec['options']['axonometric'], spec['options']['fit'])
        Gui.updateGui()
        for attempt in range(3):
            stage('rendering')
            # Process pending GUI/OpenGL events; rapid consecutive launches can initially paint white.
            loop = QtCore.QEventLoop()
            QtCore.QTimer.singleShot(350, loop.quit)
            (getattr(loop, 'exec', None) or loop.exec_)()
            view.redraw()
            Gui.updateGui()
            native_assert_camera_stable(view, expected_camera)
            render_width, render_height = thumbnail_render_size(view, spec['options']['fit'])
            view.saveImage(spec['output'], render_width, render_height, 'White')
            image = QtGui.QImage(spec['output'])
            if image.isNull():
                raise ValueError('FreeCAD 没有生成有效 PNG')
            colors, (left, top, right, bottom) = thumbnail_image_bounds(image)
            if len(colors) >= 3:
                break
        if len(colors) < 3:
            raise ValueError('渲染结果为空，请检查模型可见性，或勾选轴测图和 Fit 后重试')
        if spec['options']['fit'] and (left < 8 or top < 8 or right >= image.width()-8 or bottom >= image.height()-8):
            raise ValueError('Fit渲染触及图片边界，可能被裁切；原缩略图保留')
        if spec['options']['fit'] and right >= left:
            stage('fitting')
            # Normalize white margins after the GUI viewport has been projected to a square.
            pad = 6
            crop = image.copy(max(0, left-pad), max(0, top-pad), min(image.width()-max(0,left-pad),right-left+pad*2+1), min(image.height()-max(0,top-pad),bottom-top+pad*2+1))
            scaled = crop.scaled(456, 456, QtCore.Qt.KeepAspectRatio, QtCore.Qt.SmoothTransformation)
            result_image = QtGui.QImage(512, 512, QtGui.QImage.Format_ARGB32)
            result_image.fill(QtGui.QColor('white'))
            painter = QtGui.QPainter(result_image)
            painter.drawImage((512-scaled.width())//2, (512-scaled.height())//2, scaled)
            painter.end()
            if not result_image.save(spec['output']):
                raise ValueError('无法保存缩略图 PNG')
        elif not spec['options']['fit']:
            thumbnail_letterbox(image, spec['output'])
        result = {'status': 'completed'}
    except Exception:
        result = {'status': 'failed', 'reason': 'render_failed'}
    finally:
        stage('closing')
        try:
            for opened in owned_documents:
                App.closeDocument(opened.Name)
            if App.listDocuments():
                raise RuntimeError('unexpected remaining document')
        except Exception:
            result = {'status': 'failed', 'reason': 'close_failed'}
        finally:
            if result['status'] == 'completed':
                try:
                    output = Path(spec['output'])
                    if output.is_symlink():
                        raise RuntimeError('unsafe output')
                    with output.open('rb') as stream:
                        png = stream.read(4 * 1024 * 1024 + 1)
                    if not png or len(png) > 4 * 1024 * 1024:
                        raise RuntimeError('output limit')
                    result = dict(_proof, status='completed', private_paths_checked=True, documents_closed=True,
                        output_sha256=hashlib.sha256(png).hexdigest(), output_bytes=len(png))
                except Exception:
                    result = {'status': 'failed', 'reason': 'output_invalid'}
            if result['status'] != 'completed':
                result = dict(_proof, status='failed', reason=result.get('reason', 'render_failed'))
            Path(spec['report']).write_text(json.dumps(result, ensure_ascii=True, allow_nan=False), encoding='utf-8')
            QtCore.QTimer.singleShot(100, QtWidgets.QApplication.quit)

App.ParamGet('User parameter:BaseApp/Preferences/Document').SetBool('AutoSaveEnabled', False)
stage('starting')
QtCore.QTimer.singleShot(200, render)
`;
