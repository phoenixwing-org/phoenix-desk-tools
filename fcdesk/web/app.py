"""FastAPI：FreeCAD 管理工具 Web 服务（工作空间树、各功能页 API）。"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from fcdesk.freecad.fcstd_embedded_attrs import FcdeskFcstdEmbeddedError
from fcdesk.config.user_prefs import migrate_launcher_prefs_to_web, migrate_legacy_workspace_prefs
from fcdesk.services.bom_apply_service import (
    KindFiltersInput,
    apply_label_formula,
    fill_bom_from_embedded,
    fill_bom_from_filename_hints,
    fill_empty_fields_from_prefs,
    get_bom_apply_prefs,
    load_bom_preview,
    read_document_kinds,
    recommend_filename_for_values,
    recommend_bom_field,
    rename_bom_fcstd_file,
    save_bom_to_fcstd,
)
from fcdesk.services.fcstd_map_service import (
    export_fcstd_map_to_json,
    get_fcstd_map_prefs,
    load_fcstd_map_payload,
    run_fcstd_map_scan,
    save_fcstd_map_prefs,
)
from fcdesk.services.launcher_service import (
    activate_workspace,
    app_config_payload,
    launcher_prefs_payload,
    remove_recent_workspace_entry,
    prune_recent_workspace_entries,
    sync_launcher_from_legacy,
    update_launcher_freecad,
    update_shell_layout,
)
from fcdesk.services.part_key_service import (
    load_part_assembly_tree_payload,
    load_part_key_detail_payload,
    load_part_keys_payload,
    patch_part_file_link,
    patch_part_key,
)
from fcdesk.services.part_dedup_service import (
    export_part_dedup_csv,
    get_part_dedup_prefs,
    save_part_dedup_prefs,
    scan_part_dedup,
)
from fcdesk.services.step_batch_service import (
    get_step_batch_prefs,
    preview_step_batch,
    run_step_batch,
    save_step_batch_prefs,
)
from fcdesk.services.sw_step_export_service import (
    get_sw_step_prefs,
    preview_sw_step_export,
    run_sw_step_export,
    save_sw_step_prefs,
)
from fcdesk.services.workspace_service import build_workspace_tree, scan_workspace_files
from fcdesk.services.xlink_fix_service import get_xlink_prefs, run_xlink_fix, save_xlink_prefs
from fcdesk.services.rename_analysis_service import (
    analyze_rename_references,
    apply_rename_analysis_corrections,
    export_rename_analysis_report,
    list_rename_logs_payload,
    load_rename_analysis,
)
from fcdesk.freecad.rename_analysis.types import RenameAnalysisError
from fcdesk.services.rename_ref_service import execute_file_rename, load_file_rename_context, preview_rename_unsaved
from fcdesk.services.bom_xref_service import (
    load_bom_xref_payload,
    rebuild_bom_xrefs_from_last_scan,
    search_incoming_refs,
    search_outgoing_refs,
)
from fcdesk.services.workbench_service import get_workbench_session_payload, save_workbench_session

# 运行时工作空间根（``POST /api/workspace`` 或启动参数设置）
_active_workspace: Path = Path.cwd().resolve()


def get_workspace() -> Path:
    return _active_workspace.expanduser().resolve(strict=False)


def set_workspace(path: Path) -> Path:
    global _active_workspace
    p = path.expanduser().resolve(strict=False)
    if not p.is_dir():
        raise ValueError(f"不是有效目录: {p}")
    _active_workspace = p
    return p


class WorkspaceBody(BaseModel):
    path: str


class WorkbenchSessionBody(BaseModel):
    version: int = 1
    active_tab_id: str = ""
    tabs: list[dict] = []


class BomFieldsBody(BaseModel):
    PartNumber: str = ""
    PartVersion: str = ""
    TypeCode: str = ""
    ModelSeries: str = ""
    PartName: str = ""
    label: str = ""
    filename: str = ""


class BomKindFiltersBody(BaseModel):
    part: bool = True
    assembly: bool = True
    drawing: bool = True
    drawing_and_assembly: bool = True


class BomOperationBody(BomFieldsBody):
    kind_filters: BomKindFiltersBody | None = None
    baseline: BomFieldsBody | None = None
    original_filename: str = ""
    fill_empty_from_prefs: bool = True
    write_attrs_first: bool = False


def _bom_vals(body: BomFieldsBody) -> dict[str, str]:
    return body.model_dump()


def _kind_filters(body: BomOperationBody) -> KindFiltersInput:
    raw = body.kind_filters.model_dump() if body.kind_filters else None
    return KindFiltersInput.from_mapping(raw)


class LauncherFreecadBody(BaseModel):
    path: str = ""


class LauncherRecentRemoveBody(BaseModel):
    path: str = ""


class ShellLayoutBody(BaseModel):
    nav_rail_mode: int | None = None
    right_panel_open: bool | None = None
    mid_right_sash_px: int | None = None
    right_panel_width_px: int | None = None
    log_panel_open: bool | None = None
    log_panel_height_px: int | None = None
    log_auto_open_on_append: bool | None = None


class ShellLogBody(BaseModel):
    text: str = ""
    source: str = "server"


_SHELL_LOG: list[dict[str, str]] = []
_SHELL_LOG_MAX = 300


def append_shell_log(text: str, source: str = "server") -> None:
    chunk = str(text).strip()
    if not chunk:
        return
    _SHELL_LOG.append({"text": chunk, "source": source})
    if len(_SHELL_LOG) > _SHELL_LOG_MAX:
        del _SHELL_LOG[: len(_SHELL_LOG) - _SHELL_LOG_MAX]


def shell_log_total() -> int:
    return len(_SHELL_LOG)


def shell_log_since(after: int) -> dict[str, object]:
    start = max(0, min(after, len(_SHELL_LOG)))
    return {"lines": _SHELL_LOG[start:], "total": len(_SHELL_LOG)}


class FcstdMapScanBody(BaseModel):
    scan_root: str = ""
    force_update_part_name: bool | None = None


class FcstdMapPrefsBody(BaseModel):
    scan_root: str = ""
    force_update_part_name: bool | None = None


class PartKeyPatchBody(BaseModel):
    TypeCode: str | None = None
    ModelSeries: str | None = None
    PartName: str | None = None
    label: str | None = None
    notes: str | None = None
    status: str | None = None


class PartFileLinkPatchBody(BaseModel):
    file_role: str | None = None
    link_notes: str | None = None
    link_status: str | None = None


class XlinkFixPrefsBody(BaseModel):
    batch_dir: str = ""
    dry_run: bool | None = None
    all_in_dir: bool | None = None


class XlinkFixRunBody(BaseModel):
    batch_dir: str | None = None
    dry_run: bool | None = None
    all_in_dir: bool | None = None


class FileRenameScanBody(BaseModel):
    rename_log_id: int | None = None
    old_basename: str | None = None
    new_basename: str | None = None
    old_repo_rel_path: str | None = None
    target_repo_rel: str | None = None
    new_repo_rel_path: str | None = None
    transitive: bool | None = True
    persist: bool | None = True


class FileRenameApplyBody(BaseModel):
    rename_log_id: int | None = None
    old_basename: str | None = None
    new_basename: str | None = None
    exclude_repo_rel: str | None = None
    target_repo_rel: str | None = None
    transitive: bool | None = True
    sync_reference_labels: bool | None = True
    host_repo_rel_paths: list[str]


class RenameAnalysisExportBody(BaseModel):
    rename_log_id: int | None = None
    scan: dict
    note: str | None = None


class PartDedupPrefsBody(BaseModel):
    extension: str | None = None
    code_len: int | None = None
    ver_len: int | None = None
    check_code: bool | None = None
    check_version: bool | None = None
    code_must_be_digit: bool | None = None
    scan_dir: str | None = None


class PartDedupScanBody(PartDedupPrefsBody):
    pass


class PartDedupExportBody(BaseModel):
    results: dict | None = None


class StepBatchPrefsBody(BaseModel):
    step_dir: str | None = None
    out_dir: str | None = None
    skip_existing: bool | None = None
    view_fit: str | None = None
    use_inbox_bridge: bool | None = None
    step_recursive: bool | None = None


class SwStepPrefsBody(BaseModel):
    source_dir: str | None = None
    out_step_dir: str | None = None
    recursive_scan: bool | None = None


def create_app(*, static_dir: Path | None = None) -> FastAPI:
    app = FastAPI(title="FreeCAD 管理工具", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.on_event("startup")
    def _migrate_launcher_on_startup() -> None:
        migrate_launcher_prefs_to_web()
        migrate_legacy_workspace_prefs()

    @app.get("/api/config/app")
    def api_config_app() -> dict:
        return app_config_payload()

    @app.get("/api/config/launcher")
    def api_config_launcher_get() -> dict:
        return launcher_prefs_payload()

    @app.post("/api/config/launcher/sync-legacy")
    def api_config_launcher_sync_legacy() -> dict:
        return sync_launcher_from_legacy()

    @app.post("/api/config/launcher/freecad")
    def api_config_launcher_freecad(body: LauncherFreecadBody) -> dict[str, str]:
        try:
            fc = update_launcher_freecad(body.path or None)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        return {"freecad_dir": fc}

    @app.post("/api/config/launcher/recent/remove")
    def api_config_launcher_recent_remove(body: LauncherRecentRemoveBody) -> dict:
        try:
            return remove_recent_workspace_entry(body.path)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/config/launcher/recent/prune")
    def api_config_launcher_recent_prune() -> dict:
        return prune_recent_workspace_entries()

    @app.patch("/api/config/launcher/shell-layout")
    def api_config_shell_layout(body: ShellLayoutBody) -> dict:
        patch = body.model_dump(exclude_none=True)
        if not patch:
            raise HTTPException(status_code=400, detail="无有效字段")
        return update_shell_layout(patch)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/shutdown")
    @app.get("/api/shutdown")
    def api_shutdown(request: Request) -> dict[str, str]:
        client = request.client
        if client and client.host not in ("127.0.0.1", "::1", "localhost"):
            raise HTTPException(status_code=403, detail="仅允许本机关闭")
        import threading

        def _stop() -> None:
            import os
            import signal

            os.kill(os.getpid(), signal.SIGTERM)

        threading.Timer(0.15, _stop).start()
        return {"status": "stopping"}

    @app.post("/api/shell/log")
    def api_shell_log_append(body: ShellLogBody) -> dict[str, int]:
        append_shell_log(body.text, body.source or "server")
        return {"total": shell_log_total()}

    @app.get("/api/shell/log")
    def api_shell_log_get(after: int = Query(0, ge=0)) -> dict:
        return shell_log_since(after)

    @app.get("/api/workspace")
    def api_get_workspace() -> dict[str, str]:
        ws = get_workspace()
        return {"path": str(ws), "name": ws.name or str(ws)}

    @app.post("/api/workspace")
    def api_set_workspace(body: WorkspaceBody) -> dict[str, str]:
        try:
            ws = activate_workspace(Path(body.path))
            set_workspace(Path(ws["path"]))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        return ws

    @app.get("/api/workbench/session")
    def api_workbench_session_get() -> dict:
        return get_workbench_session_payload(get_workspace())

    @app.put("/api/workbench/session")
    def api_workbench_session_put(body: WorkbenchSessionBody) -> dict:
        return save_workbench_session(get_workspace(), body.model_dump())

    @app.get("/api/tree")
    def api_tree(
        fcstd: bool = Query(True, alias="fcstd"),
        sw: bool = Query(False, alias="sw"),
    ) -> dict:
        ws = get_workspace()
        if not ws.is_dir():
            raise HTTPException(status_code=400, detail=f"工作空间不是目录: {ws}")
        files = scan_workspace_files(ws, want_fcstd=fcstd, want_sw_part=sw)
        return build_workspace_tree(ws, files)

    @app.get("/api/bom/prefs")
    def api_bom_prefs_get() -> dict:
        return get_bom_apply_prefs(get_workspace())

    @app.get("/api/bom")
    def api_bom_get(rel: str = Query(..., description="相对工作空间路径")) -> dict:
        ws = get_workspace()
        rel_path = Path(rel)
        try:
            preview = load_bom_preview(ws, rel_path)
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        return {
            "rel_path": preview.rel_path,
            "fields": preview.fields,
            "source_note": preview.source_note,
            "abs_path_display": preview.abs_path_display,
            "is_fcstd": preview.is_fcstd,
            "document_kinds": preview.document_kinds,
            "embedded_warning": preview.embedded_warning,
        }

    @app.put("/api/bom")
    def api_bom_put(rel: str = Query(...), body: BomFieldsBody = ...) -> dict[str, str]:
        ws = get_workspace()
        vals = body.model_dump()
        try:
            save_bom_to_fcstd(ws, Path(rel), vals)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except FcdeskFcstdEmbeddedError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e
        except PermissionError as e:
            raise HTTPException(status_code=409, detail=f"文件占用或权限: {e}") from e
        except OSError as e:
            raise HTTPException(status_code=500, detail=str(e)) from e
        return {"status": "saved", "rel_path": rel}

    @app.post("/api/bom/recommend-filename")
    def api_recommend_filename(rel: str = Query(...), body: BomOperationBody = ...) -> dict:
        ws = get_workspace()
        try:
            return recommend_filename_for_values(
                ws,
                Path(rel),
                _bom_vals(body),
                fill_empty_from_prefs=body.fill_empty_from_prefs,
                kind_filters=_kind_filters(body),
                original_filename=body.original_filename or None,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/bom/recommend-field")
    def api_bom_recommend_field(
        rel: str = Query(...),
        field: str = Query(..., description="PartNumber / PartVersion / … / filename"),
        body: BomOperationBody = ...,
    ) -> dict:
        try:
            return recommend_bom_field(
                get_workspace(),
                Path(rel),
                field,
                _bom_vals(body),
                kind_filters=_kind_filters(body),
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/bom/fill-recommended-values")
    def api_bom_fill_recommended(rel: str = Query(...), body: BomFieldsBody = ...) -> dict:
        try:
            return fill_empty_fields_from_prefs(get_workspace(), _bom_vals(body))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/bom/fill-from-embedded")
    def api_bom_fill_embedded(rel: str = Query(...), body: BomOperationBody = ...) -> dict:
        try:
            return fill_bom_from_embedded(
                get_workspace(),
                Path(rel),
                kind_filters=_kind_filters(body),
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except FcdeskFcstdEmbeddedError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e

    @app.post("/api/bom/fill-from-filename")
    def api_bom_fill_filename(rel: str = Query(...)) -> dict:
        try:
            fields = fill_bom_from_filename_hints(get_workspace(), Path(rel))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        return {"fields": fields}

    @app.post("/api/bom/apply-label-formula")
    def api_bom_label_formula(rel: str = Query(...), body: BomOperationBody = ...) -> dict:
        _ = rel
        try:
            return apply_label_formula(
                get_workspace(),
                _bom_vals(body),
                fill_empty_from_prefs=body.fill_empty_from_prefs,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.get("/api/bom/document-kinds")
    def api_bom_document_kinds(rel: str = Query(...)) -> dict:
        try:
            kinds = read_document_kinds(get_workspace(), Path(rel))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        if kinds is None:
            raise HTTPException(status_code=400, detail="无法识别文档类型")
        return {"document_kinds": kinds}

    @app.post("/api/bom/rename")
    def api_bom_rename(rel: str = Query(...), body: BomOperationBody = ...) -> dict:
        ws = get_workspace()
        baseline = _bom_vals(body.baseline) if body.baseline else _bom_vals(body)
        try:
            return rename_bom_fcstd_file(
                ws,
                Path(rel),
                body.filename,
                baseline=baseline,
                current=_bom_vals(body),
                write_attrs_first=body.write_attrs_first,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except OSError as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @app.get("/api/file-rename/context")
    def api_file_rename_context(rel: str = Query(...)) -> dict:
        ws = get_workspace()
        try:
            return load_file_rename_context(ws, Path(rel))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except FcdeskFcstdEmbeddedError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/file-rename/rename")
    def api_file_rename_execute(rel: str = Query(...), body: BomOperationBody = ...) -> dict:
        ws = get_workspace()
        baseline = _bom_vals(body.baseline) if body.baseline else _bom_vals(body)
        try:
            return execute_file_rename(
                ws,
                Path(rel),
                new_filename=body.filename,
                baseline=baseline,
                current=_bom_vals(body),
                write_attrs_first=body.write_attrs_first,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except OSError as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @app.post("/api/file-rename/scan-refs")
    def api_file_rename_scan_refs(body: FileRenameScanBody) -> dict:
        ws = get_workspace()
        try:
            return analyze_rename_references(
                ws,
                rename_log_id=body.rename_log_id,
                old_basename=body.old_basename,
                new_basename=body.new_basename,
                exclude_repo_rel=body.old_repo_rel_path,
                target_repo_rel=body.target_repo_rel,
                new_repo_rel_path=body.new_repo_rel_path,
                transitive=body.transitive if body.transitive is not None else True,
                persist=body.persist if body.persist is not None else True,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except RenameAnalysisError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/file-rename/apply-refs")
    def api_file_rename_apply_refs(body: FileRenameApplyBody) -> dict:
        ws = get_workspace()
        try:
            return apply_rename_analysis_corrections(
                ws,
                rename_log_id=body.rename_log_id,
                old_basename=body.old_basename,
                new_basename=body.new_basename,
                exclude_repo_rel=body.exclude_repo_rel,
                target_repo_rel=body.target_repo_rel,
                transitive=body.transitive if body.transitive is not None else True,
                host_repo_rel_paths=body.host_repo_rel_paths,
                sync_reference_labels=(
                    body.sync_reference_labels if body.sync_reference_labels is not None else True
                ),
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except RenameAnalysisError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.get("/api/rename-analysis/logs")
    def api_rename_analysis_logs(limit: int = Query(50, ge=1, le=200)) -> dict:
        return list_rename_logs_payload(get_workspace(), limit=limit)

    @app.post("/api/rename-analysis/analyze")
    def api_rename_analysis_analyze(body: FileRenameScanBody) -> dict:
        ws = get_workspace()
        try:
            return analyze_rename_references(
                ws,
                rename_log_id=body.rename_log_id,
                old_basename=body.old_basename,
                new_basename=body.new_basename,
                exclude_repo_rel=body.old_repo_rel_path,
                target_repo_rel=body.target_repo_rel,
                new_repo_rel_path=body.new_repo_rel_path,
                transitive=body.transitive if body.transitive is not None else True,
                persist=body.persist if body.persist is not None else True,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except RenameAnalysisError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/rename-analysis/apply")
    def api_rename_analysis_apply(body: FileRenameApplyBody) -> dict:
        ws = get_workspace()
        try:
            return apply_rename_analysis_corrections(
                ws,
                rename_log_id=body.rename_log_id,
                old_basename=body.old_basename,
                new_basename=body.new_basename,
                exclude_repo_rel=body.exclude_repo_rel,
                target_repo_rel=body.target_repo_rel,
                transitive=body.transitive if body.transitive is not None else True,
                host_repo_rel_paths=body.host_repo_rel_paths,
                sync_reference_labels=(
                    body.sync_reference_labels if body.sync_reference_labels is not None else True
                ),
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.get("/api/rename-analysis/load")
    def api_rename_analysis_load(rename_log_id: int = Query(...)) -> dict:
        ws = get_workspace()
        try:
            return load_rename_analysis(ws, rename_log_id)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e

    @app.post("/api/rename-analysis/export-report")
    def api_rename_analysis_export(body: RenameAnalysisExportBody) -> dict:
        ws = get_workspace()
        try:
            return export_rename_analysis_report(
                ws,
                scan=body.scan,
                rename_log_id=body.rename_log_id,
                note=body.note,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except OSError as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @app.get("/api/fcstd-map")
    def api_fcstd_map_get() -> dict:
        ws = get_workspace()
        return load_fcstd_map_payload(ws)

    @app.get("/api/fcstd-map/prefs")
    def api_fcstd_map_prefs_get() -> dict:
        return get_fcstd_map_prefs(get_workspace())

    @app.put("/api/fcstd-map/prefs")
    def api_fcstd_map_prefs_put(body: FcstdMapPrefsBody) -> dict:
        try:
            return save_fcstd_map_prefs(
                get_workspace(),
                body.scan_root,
                force_update_part_name=body.force_update_part_name,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/fcstd-map/scan")
    def api_fcstd_map_scan(body: FcstdMapScanBody = ...) -> dict:
        ws = get_workspace()
        try:
            return run_fcstd_map_scan(
                ws,
                scan_root_input=body.scan_root or None,
                force_update_part_name=body.force_update_part_name,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except OSError as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @app.post("/api/fcstd-map/export-json")
    def api_fcstd_map_export_json() -> dict:
        ws = get_workspace()
        try:
            return export_fcstd_map_to_json(ws)
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e
        except OSError as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @app.get("/api/bom-xrefs/meta")
    def api_bom_xrefs_meta() -> dict:
        return load_bom_xref_payload(get_workspace())

    @app.get("/api/bom-xrefs/incoming")
    def api_bom_xrefs_incoming(
        rel: str | None = Query(None),
        basename: str | None = Query(None),
        limit: int = Query(500, ge=1, le=2000),
        transitive: bool = Query(True),
    ) -> dict:
        ws = get_workspace()
        try:
            from fcdesk.services.bom_xref_service import ensure_bom_xref_built

            ensure_bom_xref_built(ws)
            return search_incoming_refs(
                ws,
                repo_rel=rel,
                basename=basename,
                limit=limit,
                transitive=transitive,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except RenameAnalysisError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.get("/api/bom-xrefs/outgoing")
    def api_bom_xrefs_outgoing(
        rel: str = Query(...),
        limit: int = Query(500, ge=1, le=2000),
    ) -> dict:
        try:
            return search_outgoing_refs(get_workspace(), rel, limit=limit)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/bom-xrefs/rebuild")
    def api_bom_xrefs_rebuild() -> dict:
        try:
            return rebuild_bom_xrefs_from_last_scan(get_workspace())
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.get("/api/part-keys")
    def api_part_keys_list() -> dict:
        return load_part_keys_payload(get_workspace())

    @app.get("/api/part-keys/{part_number}/{part_version}")
    def api_part_key_detail(part_number: str, part_version: str) -> dict:
        try:
            return load_part_key_detail_payload(get_workspace(), part_number, part_version)
        except LookupError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e

    @app.get("/api/part-keys/{part_number}/{part_version}/assembly-tree")
    def api_part_assembly_tree(
        part_number: str,
        part_version: str,
        host_rel: str = Query(..., min_length=1),
        full: bool = Query(False),
    ) -> dict:
        try:
            return load_part_assembly_tree_payload(
                get_workspace(),
                part_number,
                part_version,
                host_rel,
                full=full,
            )
        except LookupError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.patch("/api/part-keys/{part_number}/{part_version}")
    def api_part_key_patch(part_number: str, part_version: str, body: PartKeyPatchBody) -> dict:
        try:
            return patch_part_key(
                get_workspace(),
                part_number,
                part_version,
                type_code=body.TypeCode,
                model_series=body.ModelSeries,
                part_name=body.PartName,
                label=body.label,
                notes=body.notes,
                status=body.status,
            )
        except LookupError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e

    @app.patch("/api/part-keys/{part_number}/{part_version}/files/{file_asset_id}")
    def api_part_file_link_patch(
        part_number: str,
        part_version: str,
        file_asset_id: int,
        body: PartFileLinkPatchBody,
    ) -> dict:
        try:
            return patch_part_file_link(
                get_workspace(),
                part_number,
                part_version,
                file_asset_id,
                file_role=body.file_role,
                link_notes=body.link_notes,
                link_status=body.link_status,
            )
        except LookupError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e

    @app.get("/api/xlink-fix/prefs")
    def api_xlink_prefs_get() -> dict:
        return get_xlink_prefs(get_workspace())

    @app.put("/api/xlink-fix/prefs")
    def api_xlink_prefs_put(body: XlinkFixPrefsBody) -> dict:
        patch = body.model_dump(exclude_none=True)
        return save_xlink_prefs(get_workspace(), patch)

    @app.post("/api/xlink-fix/run")
    def api_xlink_run(body: XlinkFixRunBody = ...) -> dict:
        ws = get_workspace()
        patch = body.model_dump(exclude_none=True)
        batch_dir = patch.pop("batch_dir", None)
        try:
            return run_xlink_fix(ws, batch_dir_input=batch_dir, **patch)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.get("/api/part-dedup/prefs")
    def api_part_dedup_prefs_get() -> dict:
        return get_part_dedup_prefs(get_workspace())

    @app.put("/api/part-dedup/prefs")
    def api_part_dedup_prefs_put(body: PartDedupPrefsBody) -> dict:
        patch = body.model_dump(exclude_none=True)
        return save_part_dedup_prefs(get_workspace(), patch)

    @app.post("/api/part-dedup/scan")
    def api_part_dedup_scan(body: PartDedupScanBody = ...) -> dict:
        ws = get_workspace()
        patch = body.model_dump(exclude_none=True)
        try:
            return scan_part_dedup(ws, patch or None)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/part-dedup/export-csv")
    def api_part_dedup_export(body: PartDedupExportBody = ...) -> dict:
        ws = get_workspace()
        try:
            if body.results:
                return export_part_dedup_csv(ws, {"results": body.results})
            scan = scan_part_dedup(ws)
            return export_part_dedup_csv(ws, scan)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.get("/api/step-batch/prefs")
    def api_step_batch_prefs_get() -> dict:
        return get_step_batch_prefs(get_workspace())

    @app.put("/api/step-batch/prefs")
    def api_step_batch_prefs_put(body: StepBatchPrefsBody) -> dict:
        patch = body.model_dump(exclude_none=True)
        return save_step_batch_prefs(get_workspace(), patch)

    @app.post("/api/step-batch/preview")
    def api_step_batch_preview(body: StepBatchPrefsBody = ...) -> dict:
        ws = get_workspace()
        patch = body.model_dump(exclude_none=True)
        try:
            return preview_step_batch(ws, patch or None)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/step-batch/run")
    def api_step_batch_run(body: StepBatchPrefsBody = ...) -> dict:
        ws = get_workspace()
        patch = body.model_dump(exclude_none=True)
        try:
            return run_step_batch(ws, patch or None)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.get("/api/sw-step-export/prefs")
    def api_sw_step_prefs_get() -> dict:
        return get_sw_step_prefs(get_workspace())

    @app.put("/api/sw-step-export/prefs")
    def api_sw_step_prefs_put(body: SwStepPrefsBody) -> dict:
        patch = body.model_dump(exclude_none=True)
        return save_sw_step_prefs(get_workspace(), patch)

    @app.post("/api/sw-step-export/preview")
    def api_sw_step_preview(body: SwStepPrefsBody = ...) -> dict:
        ws = get_workspace()
        patch = body.model_dump(exclude_none=True)
        try:
            return preview_sw_step_export(ws, patch or None)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/sw-step-export/run")
    def api_sw_step_run(body: SwStepPrefsBody = ...) -> dict:
        ws = get_workspace()
        patch = body.model_dump(exclude_none=True)
        try:
            return run_sw_step_export(ws, patch or None)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    if static_dir is not None and static_dir.is_dir():
        app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")

    return app
