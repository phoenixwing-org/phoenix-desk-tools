"""
PyInstaller 打包脚本 - 生成 phoenix-freecad-desktop 的单文件 exe

用法:
  1. 安装 PyInstaller: pip install pyinstaller
  2. 安装项目依赖: pip install -e .
  3. 运行本脚本: python scripts/build_exe.py

注意: 这是纯 UI 工具的打包，FreeCAD 集成功能需要单独配置 FreeCAD 环境。
"""

import os
import sys
import shutil
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DIST_DIR = REPO_ROOT / "dist"
BUILD_DIR = REPO_ROOT / "build"


def clean_build_dirs():
    """清理之前的构建目录"""
    for d in (DIST_DIR, BUILD_DIR):
        if d.exists():
            shutil.rmtree(d)
            print(f"已清理: {d}")


def get_imports_for_app():
    """返回 app.py 需要的隐藏导入"""
    hidden_imports = [
        "customtkinter",
        "darkdetect",
        "tkinter",
        "tkinter.ttk",
        "tkinter.filedialog",
        "tkinter.messagebox",
        "PIL",
        "darkdetect._dummy",
        "darkdetect._windows_detect",
    ]
    return hidden_imports


def build_spec_content(app_name: str, console: bool) -> str:
    """生成 PyInstaller spec 文件内容"""
    hidden = ", ".join(f"'{h}'" for h in get_imports_for_app())

    repo_root_str = str(REPO_ROOT).replace("\\", "\\\\")
    main_py_path = str((REPO_ROOT / "fcdesk" / "__main__.py").resolve()).replace("\\", "\\\\")
    config_json_path = str((REPO_ROOT / "fcdesk" / "config" / "app_config.json").resolve()).replace("\\", "\\\\")

    debug_str = "True" if console else "False"

    content = f'''# -*- mode: python ; coding: utf-8 -*-

block_cipher = None

a = Analysis(
    ['{main_py_path}'],
    pathex=['{repo_root_str}'],
    binaries=[],
    datas=[
        ('{config_json_path}', 'fcdesk/config'),
    ],
    hiddenimports=[{hidden}],
    hookspath=[],
    hooksconfig={{}},
    runtime_hooks=[],
    excludes=[
        'matplotlib',
        'numpy',
        'scipy',
        'pandas',
        'PyQt5',
        'PyQt6',
        'PySide2',
        'PySide6',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='{app_name}',
    debug={debug_str},
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console={console},
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='{app_name}',
)
'''
    return content


def write_spec_file(app_name: str, console: bool):
    """写 spec 文件到项目根目录"""
    spec_path = REPO_ROOT / f"{app_name}.spec"
    content = build_spec_content(app_name, console)

    with open(spec_path, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"已生成: {spec_path}")
    return spec_path


def run_pyinstaller(spec_path: Path):
    """运行 PyInstaller"""
    cmd = ["pyinstaller", "--clean", str(spec_path)]
    print(f"执行命令: {' '.join(cmd)}")
    result = os.system(" ".join(cmd))
    if result == 0:
        print(f"\\n打包完成！输出目录: {DIST_DIR / spec_path.stem}")
    else:
        print(f"\\n打包失败！退出码: {result}")
    return result


def main():
    app_name = "phoenix-fcdesktop"
    console = False

    if "--console" in sys.argv:
        console = True
        print("已启用控制台窗口（用于调试）")

    if "--clean" in sys.argv:
        clean_build_dirs()

    print(f"开始打包: {app_name}")
    print(f"项目根目录: {REPO_ROOT}")

    spec_path = write_spec_file(app_name, console)
    result = run_pyinstaller(spec_path)

    if result == 0 and not console:
        exe_path = DIST_DIR / app_name / f"{app_name}.exe"
        if exe_path.exists():
            size_mb = exe_path.stat().st_size / (1024 * 1024)
            print(f"\\n打包成功！")
            print(f"   exe 路径: {exe_path}")
            print(f"   文件大小: {size_mb:.1f} MB")


if __name__ == "__main__":
    main()
