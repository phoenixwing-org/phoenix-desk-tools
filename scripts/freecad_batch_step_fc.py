"""
STEP→FCStd（PartDesign Body + BaseFeature）。**仅**在 FreeCAD / FreeCADCmd 的解释器内执行。

纯逻辑见包 ``fcdesk.batch_step``；本文件只保留对 FreeCADGui / Import 的依赖。
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Callable, List, Optional, Tuple

import FreeCAD as App
import Import

from fcdesk.batch_step.step_naming import body_label_from_file_stem_and_step, internal_name_from_stem


def ensure_part_design_nodes_visible(imported_feat, body) -> None:
    """将 STEP 导入的底座对象与 Body 在树视图中设为显示（写入 FCStd 时尽可能保留）。

    FreeCADCmd 下常无 ViewObject，则跳过；有 ViewObject 时一律 ``Visibility=True``。
    """
    for obj in (imported_feat, body):
        if obj is None:
            continue
        vo = getattr(obj, "ViewObject", None)
        if vo is None:
            continue
        try:
            vo.Visibility = True
        except Exception:
            pass


def view_isometric_fit(doc_name: str) -> None:
    """当前会话内等轴测 + ViewFit（不作为写入 FCStd 视角的保证）。"""
    if not getattr(App, "GuiUp", False):
        return
    try:
        import FreeCADGui as Gui
    except ImportError:
        return
    try:
        App.setActiveDocument(doc_name)
        Gui.setActiveDocument(doc_name)
        ad = Gui.activeDocument()
        if ad is None:
            return
        view = ad.activeView()
        if view is not None and hasattr(view, "viewIsometric"):
            view.viewIsometric()
        Gui.SendMsgToActiveView("ViewFit")
    except Exception:
        pass


def _unique_object_name(doc, base: str) -> str:
    name = base
    n = 1
    while doc.getObject(name) is not None:
        name = f"{base}_{n}"
        n += 1
    return name


def _unique_open_document_name(stem: str) -> str:
    base = internal_name_from_stem(stem) + "_fc"
    name = base
    n = 1
    while name in App.listDocuments():
        name = f"{base}_{n}"
        n += 1
    return name


def _pick_imported_solid(added):
    for obj in added:
        if getattr(obj, "Shape", None) is not None and obj.Shape.isNull() is False:
            return obj
    return added[0] if added else None


def import_step_into_new_doc_with_body(step_path: Path | str):
    """新建文档，导入 STEP，Body(BaseFeature)。返回 (doc, stem, display_label)。"""
    step_path = Path(step_path).resolve()
    stem = step_path.stem
    doc = App.newDocument(_unique_open_document_name(stem))

    names_before = {o.Name for o in doc.Objects}
    Import.insert(str(step_path), doc.Name)
    doc.recompute()

    added = [o for o in doc.Objects if o.Name not in names_before]
    feat = _pick_imported_solid(added)
    if feat is None:
        App.closeDocument(doc.Name)
        raise RuntimeError("Import.insert 后未发现新增几何对象")

    display_label = body_label_from_file_stem_and_step(stem, step_path)

    body_name = _unique_object_name(doc, internal_name_from_stem(stem))
    body = doc.addObject("PartDesign::Body", body_name)
    body.Label = display_label
    body.AllowCompound = True
    body.BaseFeature = feat
    doc.recompute()
    ensure_part_design_nodes_visible(feat, body)
    return doc, stem, display_label


def save_step_as_fcstd(
    step_path: Path | str,
    out_dir: Path | str,
    *,
    view_fit: bool = True,
    close_doc: bool = False,
):
    """导入单个 STEP 并保存为 out_dir/{stem}.FCStd。"""
    out_dir = Path(out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    step_path = Path(step_path).resolve()
    stem = step_path.stem
    doc, _stem_ret, display_label = import_step_into_new_doc_with_body(step_path)
    out_fcstd = out_dir / (stem + ".FCStd")
    doc_name = doc.Name
    doc.saveAs(str(out_fcstd))
    if view_fit and getattr(App, "GuiUp", False):
        view_isometric_fit(doc_name)
    if close_doc:
        App.closeDocument(doc_name)
    return str(out_fcstd), display_label, doc_name


def batch_save_steps_to_fcstd(
    step_dir: Path | str,
    out_dir: Path | str,
    *,
    view_fit_last: bool = False,
    view_fit_all: bool = False,
    skip_existing: bool = False,
    sorted_paths: list[Path] | None = None,
    log_duplicate_stems_to_stderr: Callable[[str], None] | None = None,
) -> List[Tuple[str, Optional[str], Optional[str]]]:
    """遍历 step_dir；若给定 ``sorted_paths`` 则不再扫描目录。"""
    from collections import Counter
    from fcdesk.batch_step.step_paths import iter_step_paths

    step_dir = Path(step_dir).resolve()
    out_dir = Path(out_dir).resolve()
    paths = sorted_paths if sorted_paths is not None else list(iter_step_paths(step_dir))
    stems = Counter(p.stem for p in paths)
    dupes = {s for s, c in stems.items() if c > 1}
    if dupes and log_duplicate_stems_to_stderr:
        preview = sorted(dupes)[:12]
        log_duplicate_stems_to_stderr(
            f"[fcdesk] 警告：下列 STEP 文件名（不含后缀）重复，输出到同一 .FCStd 会互相覆盖：{preview}"
            + (" …" if len(dupes) > 12 else "")
            + "\n"
        )
    results: List[Tuple[str, Optional[str], Optional[str]]] = []
    for i, step_path in enumerate(paths):
        stem = step_path.stem
        out_fcstd = out_dir / (stem + ".FCStd")
        if skip_existing and out_fcstd.is_file():
            results.append((str(step_path), None, "skip_existing"))
            continue
        last = i == len(paths) - 1
        if view_fit_all:
            vf = True
        else:
            vf = bool(view_fit_last and last)
        try:
            path_saved, _label, _dn = save_step_as_fcstd(
                step_path,
                out_dir,
                view_fit=vf,
                close_doc=True,
            )
            results.append((str(step_path), path_saved, None))
        except Exception as e:
            results.append((str(step_path), None, str(e)))
    return results


def run_step_batch_from_environ() -> None:
    """读环境变量 ``FCD_BATCH_*``，执行批量并写报告。"""
    import sys

    def _fcd_stderr(msg: str) -> None:
        try:
            sys.stderr.buffer.write(msg.encode("utf-8"))
        except (AttributeError, TypeError):
            try:
                sys.stderr.write(msg)
            except:
                pass
        if hasattr(sys.stderr, "flush"):
            sys.stderr.flush()
        try:
            App.Console.PrintMessage(msg)
        except Exception:
            pass

    def _fcd_stderr_err(msg: str) -> None:
        try:
            sys.stderr.buffer.write(msg.encode("utf-8"))
        except (AttributeError, TypeError):
            try:
                sys.stderr.write(msg)
            except:
                pass
        if hasattr(sys.stderr, "flush"):
            sys.stderr.flush()
        try:
            App.Console.PrintError(msg)
        except Exception:
            pass

    from fcdesk.batch_step.report import write_batch_step_report_md
    from fcdesk.batch_step.step_paths import list_step_paths_for_batch, step_tree_stats

    step_dir_s = os.environ.get("FCD_BATCH_STEP_DIR", "").strip()
    out_dir = os.environ.get("FCD_BATCH_OUT_DIR", "").strip()
    if not step_dir_s or not out_dir:
        _fcd_stderr_err("缺少环境变量 FCD_BATCH_STEP_DIR 或 FCD_BATCH_OUT_DIR\n")
        raise SystemExit(2)

    skip_existing = os.environ.get("FCD_BATCH_SKIP_EXISTING", "").strip() in ("1", "true", "yes", "on")
    view_fit_all = os.environ.get("FCD_BATCH_VIEW_FIT_ALL", "").strip() in ("1", "true", "yes", "on")
    view_fit_last = os.environ.get("FCD_BATCH_VIEW_FIT_LAST", "").strip() in ("1", "true", "yes", "on")
    if view_fit_all:
        view_fit_last = False

    recursive = os.environ.get("FCD_BATCH_STEP_RECURSIVE", "").strip() in ("1", "true", "yes", "on")
    verbose = os.environ.get("FCD_BATCH_VERBOSE", "").strip() in ("1", "true", "yes", "on")

    report_name = os.environ.get("FCD_BATCH_REPORT_NAME", "batch_step_convert_report.md").strip() or "batch_step_convert_report.md"
    project_tag = os.environ.get("FCD_BATCH_PROJECT_TAG", "").strip()

    fc_ver_line = ""
    try:
        v_attr = getattr(App, "Version", None)
        if callable(v_attr):
            ver_repr = repr(v_attr())
        elif isinstance(v_attr, (tuple, list)):
            ver_repr = repr(tuple(v_attr))
        elif v_attr is not None:
            ver_repr = repr(v_attr)
        else:
            ver_repr = "None"
        fc_ver_line = f"[fcdesk] FreeCAD 版本：{ver_repr}\n"
    except Exception as e:
        fc_ver_line = f"[fcdesk] （无法读取 FreeCAD 版本: {e}）\n"

    _fcd_stderr(
        fc_ver_line
        + f"[fcdesk] 递归扫描 STEP 子目录: {recursive}（设为 1 / true 则用 FCD_BATCH_STEP_RECURSIVE）\n"
        + f"[fcdesk] skip_existing={skip_existing} view_fit_all={view_fit_all} view_fit_last={view_fit_last}\n",
    )

    top_n = deep_n = -1
    try:
        top_n, deep_n = step_tree_stats(step_dir_s)
    except (OSError, NotADirectoryError) as e:
        _fcd_stderr_err(f"[fcdesk] 无效 STEP 目录 {step_dir_s!r}: {e}\n")
        raise SystemExit(3) from e

    paths = list_step_paths_for_batch(step_dir_s, recursive=recursive)
    scan_n = len(paths)
    nested_only = deep_n - top_n if top_n >= 0 and deep_n >= 0 else 0

    _fcd_stderr(
        f"[fcdesk] STEP 根目录：{step_dir_s}\n"
        f"[fcdesk] 仅顶层 STEP 个数：{top_n} | 全盘（含子目录）STEP 个数：{deep_n}\n"
        f"[fcdesk] 本次将处理的文件数量：{scan_n}"
        + (" （递归列出）\n" if recursive else "\n")
        + f"[fcdesk] 输出目录：{out_dir}\n",
    )
    if nested_only > 0 and not recursive and top_n == 0:
        _fcd_stderr(
            "[fcdesk] 提示：顶层没有 STEP，但在子目录下共发现 "
            f"{deep_n} 个 STEP。默认只扫描「当前目录第一层」。\n"
            "[fcdesk] 请导出环境变量后再运行： export FCD_BATCH_STEP_RECURSIVE=1\n"
            "或在桌面「STEP 批量」勾选「包含子文件夹中的 STEP」。\n",
        )
    if scan_n == 0:
        _fcd_stderr("[fcdesk] 未发现可转换的 STEP，仍会写 Markdown 报告（合计 0）。\n")

    if verbose and paths:
        show = paths[:40]
        for p in show:
            _fcd_stderr(f"  → {p}\n")
        if len(paths) > 40:
            _fcd_stderr(f"  … 另有 {len(paths) - 40} 条未列出（FCD_BATCH_VERBOSE=1 仅打印前 40 条）。\n")

    results = batch_save_steps_to_fcstd(
        step_dir_s,
        out_dir,
        view_fit_last=view_fit_last,
        view_fit_all=view_fit_all,
        skip_existing=skip_existing,
        sorted_paths=paths,
        log_duplicate_stems_to_stderr=_fcd_stderr,
    )

    ok = skip = fail = 0
    for step_path, out_path, err in results:
        line = ""
        if err == "skip_existing":
            line = f"[跳过已存在] {step_path}\n"
            _fcd_stderr(line)
            skip += 1
        elif err:
            line = f"[失败] {step_path}\n  {err}\n"
            _fcd_stderr_err(line)
            fail += 1
        else:
            line = f"[OK] {out_path}\n"
            _fcd_stderr(line)
            ok += 1

    report_path = Path(out_dir) / report_name
    write_batch_step_report_md(
        report_path,
        step_dir=step_dir_s,
        out_dir=out_dir,
        results=results,
        ok=ok,
        skip=skip,
        fail=fail,
        project_tag=project_tag,
    )

    summary = (
        f"批量结束：成功 {ok}，跳过 {skip}，失败 {fail}，共 {len(results)} 个 STEP。\n报告：{report_path}\n"
    )
    try:
        App.Console.PrintMessage(summary)
    except Exception:
        pass
    _fcd_stderr(
        summary + f"[fcdesk] OK={ok} skip={skip} fail={fail} total={len(results)}\n",
    )
