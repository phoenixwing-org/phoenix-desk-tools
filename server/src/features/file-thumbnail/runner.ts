/** Isolated GUI process. Render only: never save a document or change user preferences. */
export const thumbnailRunner = String.raw`
import json
from pathlib import Path
import FreeCAD as App, FreeCADGui as Gui
from PySide import QtCore, QtGui, QtWidgets
from pivy import coin

spec = json.loads(Path(JOB_PATH).read_text(encoding='utf-8'))

def stage(name):
    Path(spec['report']).write_text(json.dumps({'status': 'rendering', 'stage': name}), encoding='utf-8')

def render():
    result = {'status': 'failed'}
    try:
        stage('opening')
        doc = App.openDocument(spec['source'])
        view = Gui.activeDocument().activeView()
        stage('preparing')
        if spec['options']['color'] == 'neutral':
            for opened in App.listDocuments().values():
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
        if spec['options']['axonometric']:
            view.viewAxonometric()
        view.setAxisCross(False)
        view.setCornerCrossSize(0)
        Gui.updateGui()
        QtWidgets.QApplication.processEvents()
        if spec['options']['fit']:
            view.setCameraType('Orthographic')
            view.fitAll()
            # fitAll fits the GUI viewport; export is square and needs its own margin.
            width, height = view.getSize()
            camera = view.getCameraNode()
            camera.height = camera.height.getValue() * max(1.0, width / max(1, height)) * 1.12
            Gui.updateGui()
        for attempt in range(3):
            stage('rendering')
            # Process pending GUI/OpenGL events; rapid consecutive launches can initially paint white.
            loop = QtCore.QEventLoop()
            QtCore.QTimer.singleShot(350, loop.quit)
            (getattr(loop, 'exec', None) or loop.exec_)()
            view.redraw()
            Gui.updateGui()
            size = 1024 if spec['options']['fit'] else 512
            view.saveImage(spec['output'], size, size, 'White')
            image = QtGui.QImage(spec['output'])
            if image.isNull():
                raise ValueError('FreeCAD 没有生成有效 PNG')
            colors = set()
            left, top, right, bottom = image.width(), image.height(), -1, -1
            for y in range(0, image.height(), 4):
                for x in range(0, image.width(), 4):
                    c = image.pixelColor(x, y)
                    colors.add((c.red() // 16, c.green() // 16, c.blue() // 16, c.alpha() // 16))
                    if c.alpha() > 32 and min(c.red(), c.green(), c.blue()) < 245:
                        left, top, right, bottom = min(left, x), min(top, y), max(right, x), max(bottom, y)
            if len(colors) >= 3:
                break
        if len(colors) < 3:
            raise ValueError('渲染结果为空，请检查模型可见性，或勾选轴测图和 Fit 后重试')
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
        result = {'status': 'completed'}
    except Exception as error:
        result = {'status': 'failed', 'error': str(error)}
    finally:
        stage('closing')
        try:
            for opened in list(App.listDocuments().values()):
                App.closeDocument(opened.Name)
        except Exception as error:
            result = {'status': 'failed', 'error': str(error)}
        finally:
            Path(spec['report']).write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
            QtCore.QTimer.singleShot(100, QtWidgets.QApplication.quit)

App.ParamGet('User parameter:BaseApp/Preferences/Document').SetBool('AutoSaveEnabled', False)
stage('starting')
QtCore.QTimer.singleShot(200, render)
`;
