# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec（Windows）。克隆目录名现为 phoenix-desk-tools；按本机路径修改下方绝对路径。

block_cipher = None

a = Analysis(
    ['F:\\HSJ\\phoenix-desk-tools\\phoenix\\__main__.py'],
    pathex=['F:\\HSJ\\phoenix-desk-tools'],
    binaries=[],
    datas=[
        ('F:\\HSJ\\phoenix-desk-tools\\phoenix\\config\\app_config.json', 'phoenix/config'),
    ],
    hiddenimports=['customtkinter', 'darkdetect', 'tkinter', 'tkinter.ttk', 'tkinter.filedialog', 'tkinter.messagebox', 'PIL', 'darkdetect._dummy', 'darkdetect._windows_detect'],
    hookspath=[],
    hooksconfig={},
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
    name='phoenix-desktop',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
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
    name='phoenix-desktop',
)
