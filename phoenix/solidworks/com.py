"""Windows SolidWorks COM：连接已打开的进程并批量导出 STEP。

说明与排障：``doc/cad/SolidWorks批量STEP导出.md``。
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

LogFn = Callable[[str], None]


def windows_only() -> bool:
    return sys.platform == "win32"


def _noop_log(_: str) -> None:
    pass


def attach_solidworks():
    """优先挂入已运行的 ``SldWorks.Application``，否则拉起（若系统中已注册单机）。"""
    if not windows_only():
        raise OSError("SolidWorks automation 仅在 Windows")

    try:
        import pythoncom

        pythoncom.CoInitialize()
    except Exception as e:
        pass

    import win32com.client

    try:
        sw_app = win32com.client.GetActiveObject("SldWorks.Application")
        if sw_app is not None:
            return sw_app
    except Exception:
        pass

    try:
        sw_app = win32com.client.Dispatch("SldWorks.Application")
        if sw_app is None:
            raise RuntimeError("Dispatch SldWorks.Application 返回 None")
        return sw_app
    except Exception as e:
        raise RuntimeError(f"无法连接或启动 SolidWorks: {e}")


def _env(name: str, legacy: str, default: str = "") -> str:
    return os.environ.get(name, "").strip() or os.environ.get(legacy, "").strip() or default


def _parsed_save_pair(default_a: int, default_b: int) -> tuple[int, int]:
    raw = _env("PHOENIX_SW_SAVEAS_SILENT_OPTS", "PHOENIX_SW_SAVEAS_SILENT_OPTS")
    if not raw:
        return default_a, default_b
    ps = raw.split(",")
    if len(ps) != 2:
        return default_a, default_b
    try:
        return int(ps[0].strip()), int(ps[1].strip())
    except ValueError:
        return default_a, default_b


def _extension_save_step(model, dest: Path, log: LogFn) -> tuple[bool, str]:
    """对当前打开的 ``model`` 执行 STEP 另存。"""
    import pythoncom
    from win32com.client import VARIANT

    ext = model.Extension
    outp = Path(dest)
    outp.parent.mkdir(parents=True, exist_ok=True)
    if outp.suffix.lower() not in (".step", ".stp"):
        outp = outp.with_suffix(".step")
    ds = str(outp.resolve())

    errs = VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0)
    warns = VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0)

    sv, silent = _parsed_save_pair(128, 8)

    success = False
    last_error = ""

    if hasattr(ext, "SaveAs3"):
        try:
            result = ext.SaveAs3(ds, sv, silent, pythoncom.Missing, errs, warns)
            if result:
                success = True
            else:
                last_error = f"SaveAs3 返回 {result}, errs={errs.value}, warns={warns.value}"
                log(f"[SaveAs3] {last_error}")
        except Exception as exc:
            last_error = str(exc)
            log(f"[SaveAs3] {exc}")

    if not success and hasattr(ext, "SaveAs2"):
        try:
            result = ext.SaveAs2(ds, sv, silent)
            if result:
                success = True
            else:
                last_error = f"SaveAs2 返回 {result}"
                log(f"[SaveAs2] {last_error}")
        except Exception as exc2:
            last_error = str(exc2)
            log(f"[SaveAs2] {exc2}")

    if not success:
        try:
            result = model.SaveAs(ds)
            if result:
                success = True
            else:
                last_error = f"SaveAs 返回 {result}"
        except Exception as exc3:
            last_error = repr(exc3)

    if success and outp.is_file():
        return True, ""
    elif success:
        return False, "SaveAs 无异常但未生成 STEP 文件"
    else:
        return False, last_error or "STEP 导出失败"


def _close_doc(sw_app, title: str) -> None:
    if not title:
        return
    try:
        sw_app.CloseDoc(title)
    except Exception:
        pass


@dataclass
class BatchExportOutcome:
    ok: list[Path] = field(default_factory=list)
    failed: list[tuple[Path, str]] = field(default_factory=list)


def batch_export_models_to_step(
    sw_app,
    *,
    paths: list[Path],
    out_step_dir: Path,
    log: LogFn = _noop_log,
) -> BatchExportOutcome:
    """逐项打开三维模型 → 导出 ``{{stem}}.step`` 到指定目录。"""
    import pythoncom
    from win32com.client import VARIANT

    from phoenix.solidworks.models import sw_doc_type_suffix

    out_step_dir = Path(out_step_dir).expanduser().resolve()
    out_step_dir.mkdir(parents=True, exist_ok=True)

    outs = BatchExportOutcome()
    sw_app.Visible = True

    open_opts = int(_env("PHOENIX_SW_OPEN_OPTIONS", "PHOENIX_SW_OPEN_OPTIONS", "1"))

    for src in paths:
        dt = sw_doc_type_suffix(src.name)
        if dt is None:
            outs.failed.append((src, "非 .sldprt/.sldasm"))
            continue
        fp = Path(src).expanduser().resolve()
        if not fp.is_file():
            outs.failed.append((src, "文件不存在"))
            continue
        outp = out_step_dir / (fp.stem + ".step")

        errs = VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0)
        warns = VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0)

        title = ""

        try:
            log(f"打开: {fp}")
            open_result = sw_app.OpenDoc6(
                str(fp),
                dt,
                open_opts,
                "",
                errs,
                warns,
            )
            
            doc = None
            if open_result is not None:
                doc = open_result
            else:
                doc = sw_app.ActiveDoc
            
            if doc is None:
                ev = getattr(errs, "value", repr(errs))
                wv = getattr(warns, "value", repr(warns))
                raise RuntimeError(f"OpenDoc6 返回 {open_result}, ActiveDoc=None (errs={ev}, warns={wv})")

            title = ""
            gt = getattr(doc, "GetTitle", None)
            if callable(gt):
                title = gt() or ""
            if not title:
                title = getattr(doc, "Title", "") or fp.name

            good, errmsg = _extension_save_step(doc, outp, log)
            if good and outp.is_file():
                outs.ok.append(outp)
            else:
                outs.failed.append((fp, errmsg or "STEP 导出失败"))
        except Exception as e:
            outs.failed.append((fp, repr(e)))
        finally:
            _close_doc(sw_app, title)

    return outs
