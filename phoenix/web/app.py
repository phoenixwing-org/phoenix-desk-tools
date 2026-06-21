"""FastAPI：Phoenix 桌面辅助工具 Web 服务（工作空间树、各功能页 API）。"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from phoenix.config.loader import DEFAULT_APP_TITLE
from phoenix.freecad.fcstd_embedded_attrs import PhoenixFcstdEmbeddedError
from phoenix.services.bom_apply_service import (
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
    recommend_bom_fields_all,
    rename_bom_fcstd_file,
    save_bom_to_fcstd,
)
from phoenix.services.fcstd_map_service import (
    export_fcstd_map_to_json,
    get_fcstd_map_prefs,
    load_fcstd_map_payload,
    purge_missing_fcstd_map_entries,
    run_fcstd_map_scan,
    save_fcstd_map_prefs,
    search_fcstd_map_entries,
)
from phoenix.services.onboarding_service import onboarding_status_payload
from phoenix.services.phoenix_database_service import (
    phoenix_database_recreate,
    phoenix_database_status,
)
from phoenix.services.launcher_service import (
    activate_workspace,
    add_recent_workspace_entry,
    app_config_payload,
    get_workspace_nav_modules_payload,
    launcher_prefs_payload,
    pick_workspace_directory_via_dialog,
    remove_recent_workspace_entry,
    prune_recent_workspace_entries,
    update_launcher_freecad,
    update_shell_layout,
    update_nav_modules,
    update_workspace_nav_modules,
)
from phoenix.services.part_key_service import (
    resolve_part_key_from_workspace_rel,
    load_part_assembly_tree_payload,
    load_part_key_detail_payload,
    load_part_keys_payload,
    patch_part_file_link,
    patch_part_key,
)
from phoenix.services.part_dedup_service import (
    export_part_dedup_csv,
    get_part_dedup_prefs,
    save_part_dedup_prefs,
    scan_part_dedup,
)
from phoenix.code.reorder_self_test import run_reorder_avoidance_self_test
from phoenix.services.code_index_service import (
    export_code_index_to_json,
    load_code_index_payload,
    purge_missing_code_index_entries,
    run_code_index_scan,
    search_code_index_entries,
)
from phoenix.services.code_ignore_service import (
    get_code_ignore_prefs,
    list_process_dir_suggestions,
    save_code_ignore_prefs,
)
from phoenix.services.code_rename_service import (
    apply_code_rename,
    get_code_rename_prefs,
    preview_code_rename,
    save_code_rename_prefs,
)
from phoenix.services.code_uuid_service import apply_code_uuids, scan_code_uuids
from phoenix.services.file_workset_service import (
    get_file_worksets_api,
    prune_missing_workset_paths,
    put_file_worksets_api,
)
from phoenix.services.reorder_members_service import (
    get_reorder_members_prefs,
    list_reorder_top_level_entries,
    run_reorder_members_batch,
    save_reorder_members_prefs,
)
from phoenix.services.step_batch_service import (
    get_step_batch_prefs,
    preview_step_batch,
    run_step_batch,
    save_step_batch_prefs,
)
from phoenix.services.sw_step_export_service import (
    get_sw_step_prefs,
    preview_sw_step_export,
    run_sw_step_export,
    save_sw_step_prefs,
)
from phoenix.services.workspace_service import build_workspace_tree, scan_workspace_files
from phoenix.services.xlink_fix_service import (
    analyze_xlink_fix,
    apply_xlink_fix_override,
    get_xlink_prefs,
    list_xlink_fix_candidates,
    run_xlink_fix,
    save_xlink_prefs,
)
from phoenix.services.rename_analysis_service import (
    analyze_rename_references,
    apply_rename_analysis_corrections,
    apply_reference_label_corrections,
    export_rename_analysis_report,
    list_rename_logs_payload,
    load_rename_analysis,
)
from phoenix.freecad.rename_analysis.types import RenameAnalysisError
from phoenix.services.rename_ref_service import execute_file_rename, load_file_rename_context, preview_rename_unsaved
from phoenix.services.cad_index import (
    rebuild_bom_xrefs_from_last_scan,
    refresh_bom_xref_index_for_host,
)
from phoenix.services.bom_xref_service import (
    apply_explicit_link_labels,
    load_assembly_bom_catalog,
    load_assembly_tree,
    load_target_usage_stats,
    load_bom_xref_payload,
    search_bom_xref_edges,
    search_incoming_refs,
    search_outgoing_refs,
)
from phoenix.services.runtime_catalog_service import (
    get_runtime_catalog_status,
    get_test_case_catalog,
    get_test_module_catalog,
    sync_runtime_catalog_now,
)
from phoenix.services.unit_test_service import (
    cancel_unit_test_run,
    iter_run_unit_tests_events,
    list_unit_test_suites,
    plan_unit_tests,
    run_unit_tests,
)
from phoenix.services.workbench_service import get_workbench_session_payload, save_workbench_session

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
    path: str


class PickDirectoryBody(BaseModel):
    path_hint: str = ""


class LauncherRecentAddBody(BaseModel):
    path: str = ""


class ShellLayoutBody(BaseModel):
    nav_rail_mode: int | None = None
    ribbon_mode: int | None = None
    right_panel_open: bool | None = None
    mid_right_sash_px: int | None = None
    left_panel_width_px: int | None = None
    right_panel_width_px: int | None = None
    log_panel_open: bool | None = None
    log_panel_height_px: int | None = None
    log_auto_open_on_append: bool | None = None
    workspace_tree_dock: str | None = None
    shell_log_dock: str | None = None
    properties_panel_open: bool | None = None
    properties_panel_height_px: int | None = None
    properties_panel_dock: str | None = None
    properties_name_col_width_px: int | None = None


class NavModulesBody(BaseModel):
    enabled: list[str] = Field(default_factory=list)


class WorkspaceNavModulesBody(BaseModel):
    path: str | None = None
    scope: str | None = None
    enabled: list[str] | None = None


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
    force_update_part_name: bool | None = None


class FcstdMapPrefsBody(BaseModel):
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


class XlinkFixOverrideBody(BaseModel):
    host_repo_rel: str
    old_path: str
    target_repo_rel: str


class BomXrefRefreshHostBody(BaseModel):
    host_repo_rel: str
    recursive: bool = True
    max_hosts: int = 64


class LinkLabelPatchItem(BaseModel):
    host_repo_rel: str
    xlink_file_attr: str
    link_label: str


class LinkLabelPatchBody(BaseModel):
    patches: list[LinkLabelPatchItem]


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
    sync_reference_labels: bool | None = False
    labels_only: bool | None = False
    label_scope: str | None = "incoming"
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


class ReorderMembersPrefsBody(BaseModel):
    include_cpp: bool | None = None
    include_header: bool | None = None
    cpp_only: bool | None = None  # 兼容旧客户端
    header_only: bool | None = None
    sort_members: bool | None = None
    verbose: bool | None = None
    kevin_system_code_mode: str | None = None
    last_selected: list[str] | None = None


class ReorderMembersRunBody(ReorderMembersPrefsBody):
    targets: list[str] | None = None
    top_dirs: list[str] | None = None  # 兼容旧字段名
    dry_run: bool = False


class CodeRenamePrefsBody(BaseModel):
    old: str | None = None
    new: str | None = None
    levels: list[str] | None = None
    scope: str | None = None
    target_encoding: str | None = None
    include_ignored: bool | None = None
    rescan_index: bool | None = None


class CodeIgnorePrefsBody(BaseModel):
    custom_ignore: list[str] | str | None = None
    ignore_preset: str | None = None


class CodeRenameRunBody(CodeRenamePrefsBody):
    confirm_token: str | None = None
    use_index_scope: bool | None = None
    repo_rel_paths: list[str] | None = None


class CodeUuidScanBody(BaseModel):
    scope: str | None = None
    kinds: list[str] | None = None
    use_index_scope: bool | None = None
    repo_rel_paths: list[str] | None = None
    include_ignored: bool | None = None


class FileWorksetsBody(BaseModel):
    worksets: list[dict] = Field(default_factory=list)


class FileWorksetPruneBody(BaseModel):
    workset_id: str | None = None


class CodeUuidApplyBody(BaseModel):
    hit_ids: list[str]
    strategy: str | None = "map_per_value"
    dry_run: bool = False


class UnitTestRunBody(BaseModel):
    suite: str | None = None
    suites: list[str] | None = None
    exclude_cases: list[str] | None = None
    include_cases: list[str] | None = None
    include_modules: list[str] | None = None


class UnitTestPlanBody(BaseModel):
    suites: list[str] | None = None
    exclude_cases: list[str] | None = None
    include_cases: list[str] | None = None
    include_modules: list[str] | None = None
    include_case_details: bool = False


class UnitTestCancelBody(BaseModel):
    run_id: str

def _ensure_phoenix_logging() -> None:
    """保证 ``phoenix.*`` 的 INFO 日志输出到终端（与 uvicorn 并列可见）。"""
    root = logging.getLogger("phoenix")
    if root.handlers:
        return
    root.setLevel(logging.INFO)
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(levelname)s [%(name)s] %(message)s"))
    root.addHandler(handler)
    root.propagate = False


def create_app(*, static_dir: Path | None = None) -> FastAPI:
    app = FastAPI(title=DEFAULT_APP_TITLE, version="0.1.0")
    _ensure_phoenix_logging()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.on_event("startup")
    def _startup_sync_runtime_catalog() -> None:
        try:
            sync_runtime_catalog_now()
        except Exception as exc:
            logging.getLogger("phoenix.runtime").warning("runtime catalog sync failed: %s", exc)
        try:
            from phoenix.testing.fixture_links import ensure_fixture_links_logged

            ensure_fixture_links_logged()
        except Exception as exc:
            logging.getLogger("phoenix.testing").warning("fixture link setup failed: %s", exc)

    @app.get("/api/config/app")
    def api_config_app() -> dict:
        return app_config_payload()

    @app.get("/api/config/launcher")
    def api_config_launcher_get() -> dict:
        return launcher_prefs_payload()

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

    @app.post("/api/config/launcher/recent/add")
    def api_config_launcher_recent_add(body: LauncherRecentAddBody) -> dict:
        try:
            return add_recent_workspace_entry(body.path)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/config/pick-workspace-directory")
    def api_config_pick_workspace_directory(body: PickDirectoryBody) -> dict:
        try:
            return pick_workspace_directory_via_dialog(
                current_workspace=get_workspace(),
                path_hint=body.path_hint,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"无法打开选目录对话框: {e}",
            ) from e

    @app.post("/api/config/launcher/recent/prune")
    def api_config_launcher_recent_prune() -> dict:
        return prune_recent_workspace_entries()

    @app.patch("/api/config/launcher/shell-layout")
    def api_config_shell_layout(body: ShellLayoutBody) -> dict:
        patch = body.model_dump(exclude_none=True)
        if not patch:
            raise HTTPException(status_code=400, detail="无有效字段")
        return update_shell_layout(patch)

    @app.patch("/api/config/launcher/nav-modules")
    def api_config_nav_modules(body: NavModulesBody) -> dict:
        return update_nav_modules(body.enabled)

    @app.get("/api/workspace/nav-modules")
    def api_workspace_nav_modules_get(path: str | None = Query(None)) -> dict:
        target = get_workspace()
        if path and path.strip():
            target = Path(path.strip()).expanduser().resolve(strict=False)
            if not target.is_dir():
                raise HTTPException(status_code=400, detail=f"不是有效目录: {target}")
        return get_workspace_nav_modules_payload(target)

    @app.patch("/api/workspace/nav-modules")
    def api_workspace_nav_modules_patch(body: WorkspaceNavModulesBody) -> dict:
        target = get_workspace()
        if body.path and body.path.strip():
            target = Path(body.path.strip()).expanduser().resolve(strict=False)
            if not target.is_dir():
                raise HTTPException(status_code=400, detail=f"不是有效目录: {target}")
        if body.scope is None and body.enabled is None:
            raise HTTPException(status_code=400, detail="需要 scope 或 enabled")
        try:
            return update_workspace_nav_modules(
                target,
                scope=body.scope,
                enabled=body.enabled,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

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

    @app.get("/api/onboarding/status")
    def api_onboarding_status() -> dict:
        return onboarding_status_payload(get_workspace())

    @app.get("/api/phoenix/database/status")
    def api_phoenix_database_status() -> dict:
        return phoenix_database_status(get_workspace())

    @app.post("/api/phoenix/database/recreate")
    def api_phoenix_database_recreate() -> dict:
        try:
            return phoenix_database_recreate(get_workspace())
        except OSError as e:
            raise HTTPException(status_code=409, detail=str(e)) from e

    @app.post("/api/workspace")
    def api_set_workspace(body: WorkspaceBody) -> dict:
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
        cpp: bool = Query(False, alias="cpp"),
        header: bool = Query(False, alias="header"),
    ) -> dict:
        ws = get_workspace()
        if not ws.is_dir():
            raise HTTPException(status_code=400, detail=f"工作空间不是目录: {ws}")
        files = scan_workspace_files(
            ws,
            want_fcstd=fcstd,
            want_sw_part=sw,
            want_cpp=cpp,
            want_header=header,
        )
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
        payload: dict = {
            "rel_path": preview.rel_path,
            "fields": preview.fields,
            "source_note": preview.source_note,
            "abs_path_display": preview.abs_path_display,
            "is_fcstd": preview.is_fcstd,
            "document_kinds": preview.document_kinds,
            "embedded_warning": preview.embedded_warning,
            "file_size_bytes": preview.file_size_bytes,
            "file_size_display": preview.file_size_display,
            "bom_readonly": preview.bom_readonly,
            "bom_source_rel": preview.bom_source_rel,
        }
        if preview.is_fcstd:
            from phoenix.services.bom_xref_service import (
                bom_xref_index_is_built,
                empty_xref_counts_payload,
                query_xref_counts_for_rel,
            )

            if bom_xref_index_is_built(ws):
                payload["xref_counts"] = query_xref_counts_for_rel(ws, preview.rel_path)
            else:
                payload["xref_counts"] = empty_xref_counts_payload()
                payload["xref_index_pending"] = True
        return payload

    @app.put("/api/bom")
    def api_bom_put(rel: str = Query(...), body: BomFieldsBody = ...) -> dict[str, str]:
        ws = get_workspace()
        vals = body.model_dump()
        try:
            save_bom_to_fcstd(ws, Path(rel), vals)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except PhoenixFcstdEmbeddedError as e:
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

    @app.post("/api/bom/recommend-all-fields")
    def api_bom_recommend_all_fields(
        rel: str = Query(...),
        body: BomOperationBody = ...,
    ) -> dict:
        try:
            return recommend_bom_fields_all(
                get_workspace(),
                Path(rel),
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
        except PhoenixFcstdEmbeddedError as e:
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
        except PhoenixFcstdEmbeddedError as e:
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
            if body.labels_only:
                scope = body.label_scope if body.label_scope == "host_all" else "incoming"
                return apply_reference_label_corrections(
                    ws,
                    rename_log_id=body.rename_log_id,
                    old_basename=body.old_basename,
                    new_basename=body.new_basename,
                    exclude_repo_rel=body.exclude_repo_rel,
                    target_repo_rel=body.target_repo_rel,
                    transitive=body.transitive if body.transitive is not None else True,
                    host_repo_rel_paths=body.host_repo_rel_paths,
                    label_scope=scope,
                )
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
                    body.sync_reference_labels if body.sync_reference_labels is not None else False
                ),
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except RenameAnalysisError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.get("/api/rename-analysis/logs")
    def api_rename_analysis_logs(
        limit: int = Query(50, ge=1, le=200),
        rel: str | None = Query(None, description="筛选与该仓库路径相关（新路径或旧路径）的记录"),
    ) -> dict:
        return list_rename_logs_payload(get_workspace(), limit=limit, repo_rel_path=rel)

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
            if body.labels_only:
                scope = body.label_scope if body.label_scope == "host_all" else "incoming"
                return apply_reference_label_corrections(
                    ws,
                    rename_log_id=body.rename_log_id,
                    old_basename=body.old_basename,
                    new_basename=body.new_basename,
                    exclude_repo_rel=body.exclude_repo_rel,
                    target_repo_rel=body.target_repo_rel,
                    transitive=body.transitive if body.transitive is not None else True,
                    host_repo_rel_paths=body.host_repo_rel_paths,
                    label_scope=scope,
                )
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
                    body.sync_reference_labels if body.sync_reference_labels is not None else False
                ),
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except RenameAnalysisError as e:
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
        return load_fcstd_map_payload(ws, include_entries=False)

    @app.get("/api/fcstd-map/entries")
    def api_fcstd_map_entries(
        offset: int = Query(0, ge=0),
        limit: int = Query(20, ge=1, le=500),
        status: str | None = Query(None),
        kind: str | None = Query(None),
        search: str | None = Query(None),
    ) -> dict:
        try:
            return search_fcstd_map_entries(
                get_workspace(),
                offset=offset,
                limit=limit,
                status=status,
                kind=kind,
                search=search,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.get("/api/fcstd-map/prefs")
    def api_fcstd_map_prefs_get() -> dict:
        return get_fcstd_map_prefs(get_workspace())

    @app.put("/api/fcstd-map/prefs")
    def api_fcstd_map_prefs_put(body: FcstdMapPrefsBody) -> dict:
        try:
            return save_fcstd_map_prefs(
                get_workspace(),
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

    @app.post("/api/fcstd-map/purge-missing")
    def api_fcstd_map_purge_missing() -> dict:
        ws = get_workspace()
        try:
            return purge_missing_fcstd_map_entries(ws)
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
            from phoenix.services.bom_xref_service import ensure_bom_xref_built

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
        refresh_disk: bool = Query(False),
    ) -> dict:
        try:
            return search_outgoing_refs(
                get_workspace(),
                rel,
                limit=limit,
                refresh_disk=refresh_disk,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.get("/api/file-detail/xrefs")
    def api_file_detail_xrefs(
        rel: str = Query(..., min_length=1),
        limit: int = Query(500, ge=1, le=2000),
        transitive: bool = Query(False),
        refresh_disk: bool = Query(False),
        scope: str = Query("both", pattern="^(both|outgoing|incoming)$"),
    ) -> dict:
        """文件详情「引用」Tab：``scope`` 可仅拉出向或入向（出向优先、更快）。"""
        ws = get_workspace()
        try:
            from phoenix.services.bom_xref_service import search_file_detail_xrefs

            return search_file_detail_xrefs(
                ws,
                rel,
                limit=limit,
                transitive=transitive,
                refresh_disk=refresh_disk,
                scope=scope,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.get("/api/bom-xrefs/counts")
    def api_bom_xref_counts(rel: str = Query(..., min_length=1)) -> dict:
        ws = get_workspace()
        from phoenix.services.bom_xref_service import (
            bom_xref_index_is_built,
            empty_xref_counts_payload,
            query_xref_counts_for_rel,
        )

        if not bom_xref_index_is_built(ws):
            return {**empty_xref_counts_payload(), "index_pending": True}
        return {**query_xref_counts_for_rel(ws, rel), "index_pending": False}

    @app.get("/api/bom-xrefs/assembly-tree")
    def api_bom_xrefs_assembly_tree(
        host_rel: str = Query(..., min_length=1),
        full: bool = Query(False),
        refresh_disk: bool = Query(False),
    ) -> dict:
        try:
            return load_assembly_tree(
                get_workspace(), host_rel, full=full, refresh_disk=refresh_disk
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except RenameAnalysisError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except LookupError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e

    @app.post("/api/bom-xrefs/patch-labels")
    def api_bom_xrefs_patch_labels(body: LinkLabelPatchBody) -> dict:
        try:
            return apply_explicit_link_labels(
                get_workspace(),
                [p.model_dump() for p in body.patches],
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except RenameAnalysisError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/bom-xrefs/refresh-host-index")
    def api_bom_xrefs_refresh_host_index(body: BomXrefRefreshHostBody) -> dict:
        try:
            return refresh_bom_xref_index_for_host(
                get_workspace(),
                body.host_repo_rel,
                recursive=body.recursive,
                max_hosts=body.max_hosts,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.get("/api/bom-xrefs/assembly-hosts")
    def api_bom_xrefs_assembly_hosts(
        search: str | None = Query(None),
    ) -> dict:
        try:
            return load_assembly_bom_catalog(get_workspace(), search=search)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.get("/api/bom-xrefs/usage-stats")
    def api_bom_xrefs_usage_stats(
        rel: str = Query(..., min_length=1),
    ) -> dict:
        try:
            return load_target_usage_stats(get_workspace(), rel)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.get("/api/bom-xrefs/edges")
    def api_bom_xrefs_edges(
        offset: int = Query(0, ge=0),
        limit: int = Query(100, ge=1, le=500),
        search: str | None = Query(None),
    ) -> dict:
        try:
            return search_bom_xref_edges(
                get_workspace(),
                offset=offset,
                limit=limit,
                search=search,
            )
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

    @app.get("/api/part-key-infer")
    @app.get("/api/part-keys/infer-from-path")
    def api_part_key_infer_from_path(rel: str = Query(..., min_length=1)) -> dict:
        try:
            return resolve_part_key_from_workspace_rel(get_workspace(), rel)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e

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

    @app.post("/api/xlink-fix/analyze")
    def api_xlink_analyze(body: XlinkFixRunBody = ...) -> dict:
        ws = get_workspace()
        patch = body.model_dump(exclude_none=True)
        batch_dir = patch.pop("batch_dir", None)
        all_in_dir = patch.pop("all_in_dir", None)
        try:
            return analyze_xlink_fix(ws, batch_dir_input=batch_dir, all_in_dir=all_in_dir)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/xlink-fix/run")
    def api_xlink_run(body: XlinkFixRunBody = ...) -> dict:
        ws = get_workspace()
        patch = body.model_dump(exclude_none=True)
        batch_dir = patch.pop("batch_dir", None)
        try:
            return run_xlink_fix(ws, batch_dir_input=batch_dir, **patch)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/xlink-fix/apply-override")
    def api_xlink_apply_override(body: XlinkFixOverrideBody) -> dict:
        try:
            return apply_xlink_fix_override(
                get_workspace(),
                host_repo_rel=body.host_repo_rel,
                old_path=body.old_path,
                target_repo_rel=body.target_repo_rel,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.get("/api/xlink-fix/candidates")
    def api_xlink_candidates(
        basename: str = "",
        part_number: str = "",
        part_version: str = "",
        exclude_repo_rel: str = "",
    ) -> dict:
        try:
            return list_xlink_fix_candidates(
                get_workspace(),
                basename=basename,
                part_number=part_number or None,
                part_version=part_version or None,
                exclude_repo_rel=exclude_repo_rel or None,
            )
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

    @app.get("/api/code/index")
    def api_code_index_get() -> dict:
        return load_code_index_payload(get_workspace())

    @app.get("/api/code/index/entries")
    def api_code_index_entries(
        offset: int = Query(0, ge=0),
        limit: int = Query(50, ge=1, le=500),
        status: str | None = Query(None),
        kind: str | None = Query(None),
        q: str | None = Query(None),
        search_mode: str | None = Query(None),
    ) -> dict:
        return search_code_index_entries(
            get_workspace(),
            offset=offset,
            limit=limit,
            status=status,
            kind=kind,
            q=q,
            search_mode=search_mode,
        )

    @app.post("/api/code/index/scan")
    def api_code_index_scan() -> dict:
        ws = get_workspace()
        try:
            return run_code_index_scan(ws)
        except OSError as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @app.post("/api/code/index/purge-missing")
    def api_code_index_purge_missing() -> dict:
        ws = get_workspace()
        try:
            return purge_missing_code_index_entries(ws)
        except OSError as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @app.post("/api/code/index/export-json")
    def api_code_index_export_json() -> dict:
        ws = get_workspace()
        try:
            return export_code_index_to_json(ws)
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e
        except OSError as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @app.get("/api/code/reorder-members/prefs")
    def api_reorder_members_prefs_get() -> dict:
        return get_reorder_members_prefs(get_workspace())

    @app.put("/api/code/reorder-members/prefs")
    def api_reorder_members_prefs_put(body: ReorderMembersPrefsBody) -> dict:
        patch = body.model_dump(exclude_none=True)
        try:
            return save_reorder_members_prefs(get_workspace(), patch)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.get("/api/code/reorder-members/top-level")
    @app.get("/api/code/reorder-members/top-dirs")
    def api_reorder_members_top_level() -> dict:
        try:
            return list_reorder_top_level_entries(get_workspace())
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/code/reorder-members/run")
    def api_reorder_members_run(body: ReorderMembersRunBody) -> dict:
        patch = body.model_dump(exclude_none=True)
        targets = patch.pop("targets", None) or patch.pop("top_dirs", None) or []
        dry_run = bool(patch.pop("dry_run", False))
        try:
            return run_reorder_members_batch(
                get_workspace(),
                targets=targets,
                dry_run=dry_run,
                patch=patch or None,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/code/reorder-members/self-test")
    def api_reorder_members_self_test() -> dict:
        try:
            return run_reorder_avoidance_self_test()
        except OSError as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @app.get("/api/code/ignore/prefs")
    def api_code_ignore_prefs_get() -> dict:
        return get_code_ignore_prefs(get_workspace())

    @app.put("/api/code/ignore/prefs")
    def api_code_ignore_prefs_put(body: CodeIgnorePrefsBody) -> dict:
        patch = body.model_dump(exclude_none=True)
        try:
            return save_code_ignore_prefs(get_workspace(), patch)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.get("/api/code/ignore/suggestions")
    def api_code_ignore_suggestions() -> dict:
        return list_process_dir_suggestions(get_workspace())

    @app.get("/api/code/rename/prefs")
    def api_code_rename_prefs_get() -> dict:
        return get_code_rename_prefs(get_workspace())

    @app.put("/api/code/rename/prefs")
    def api_code_rename_prefs_put(body: CodeRenamePrefsBody) -> dict:
        patch = body.model_dump(exclude_none=True)
        try:
            return save_code_rename_prefs(get_workspace(), patch)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/code/rename/preview")
    def api_code_rename_preview(body: CodeRenameRunBody) -> dict:
        try:
            return preview_code_rename(get_workspace(), body.model_dump(exclude_none=True))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/code/rename/apply")
    def api_code_rename_apply(body: CodeRenameRunBody) -> dict:
        try:
            return apply_code_rename(get_workspace(), body.model_dump(exclude_none=True))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/code/uuid/scan")
    def api_code_uuid_scan(body: CodeUuidScanBody) -> dict:
        try:
            return scan_code_uuids(get_workspace(), body.model_dump(exclude_none=True))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/code/uuid/apply")
    def api_code_uuid_apply(body: CodeUuidApplyBody) -> dict:
        try:
            return apply_code_uuids(get_workspace(), body.model_dump(exclude_none=True))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.get("/api/file-worksets")
    def api_file_worksets_get() -> dict:
        try:
            return get_file_worksets_api(get_workspace())
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.put("/api/file-worksets")
    def api_file_worksets_put(body: FileWorksetsBody) -> dict:
        try:
            return put_file_worksets_api(get_workspace(), body.model_dump(exclude_none=True))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/file-worksets/prune-missing")
    def api_file_worksets_prune_missing(body: FileWorksetPruneBody = ...) -> dict:
        try:
            return prune_missing_workset_paths(
                get_workspace(),
                workset_id=body.workset_id,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.get("/api/unit-tests/suites")
    def api_unit_tests_suites() -> dict:
        return list_unit_test_suites()

    @app.post("/api/unit-tests/plan")
    def api_unit_tests_plan(body: UnitTestPlanBody = ...) -> dict:
        try:
            return plan_unit_tests(
                body.suites,
                exclude_case_ids=body.exclude_cases,
                include_case_ids=body.include_cases,
                include_module_names=body.include_modules,
                include_cases=body.include_case_details,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/unit-tests/run")
    def api_unit_tests_run(body: UnitTestRunBody = ...) -> dict:
        try:
            if body.suites is not None:
                return run_unit_tests(
                    suites=body.suites,
                    exclude_case_ids=body.exclude_cases,
                    include_case_ids=body.include_cases,
                    include_module_names=body.include_modules,
                )
            return run_unit_tests(
                suite=body.suite or "all",
                exclude_case_ids=body.exclude_cases,
                include_case_ids=body.include_cases,
                include_module_names=body.include_modules,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/unit-tests/run/stream")
    def api_unit_tests_run_stream(body: UnitTestRunBody = ...) -> StreamingResponse:
        from phoenix.testing.run_cancel import begin_run, end_run, is_cancelled, new_run_id

        run_id = new_run_id()
        begin_run(run_id)

        def _lines():
            try:
                for event in iter_run_unit_tests_events(
                    suite=body.suite,
                    suites=body.suites,
                    exclude_case_ids=body.exclude_cases,
                    include_case_ids=body.include_cases,
                    include_module_names=body.include_modules,
                    cancel_check=lambda: is_cancelled(run_id),
                ):
                    if event.get("type") == "start":
                        event = {**event, "run_id": run_id}
                    yield json.dumps(event, ensure_ascii=False) + "\n"
            except ValueError as e:
                yield json.dumps({"type": "error", "message": str(e)}, ensure_ascii=False) + "\n"
            finally:
                end_run(run_id)

        return StreamingResponse(_lines(), media_type="application/x-ndjson")

    @app.post("/api/unit-tests/cancel")
    def api_unit_tests_cancel(body: UnitTestCancelBody) -> dict:
        ok = cancel_unit_test_run(body.run_id.strip())
        if not ok:
            raise HTTPException(status_code=404, detail="run not found or already finished")
        return {"ok": True}

    @app.get("/api/runtime-catalog/status")
    def api_runtime_catalog_status() -> dict:
        return get_runtime_catalog_status()

    @app.post("/api/runtime-catalog/sync")
    def api_runtime_catalog_sync(force: bool = Query(False)) -> dict:
        return sync_runtime_catalog_now(force=force)

    @app.get("/api/runtime-catalog/test-modules")
    def api_runtime_catalog_test_modules(
        modules: list[str] = Query(default=[]),
    ) -> dict:
        names = [m.strip() for m in modules if m and m.strip()]
        return get_test_module_catalog(names or None)

    @app.get("/api/runtime-catalog/test-cases")
    def api_runtime_catalog_test_cases(
        ids: list[str] = Query(default=[]),
    ) -> dict:
        full_ids = [i.strip() for i in ids if i and i.strip()]
        return get_test_case_catalog(full_ids or None)

    if static_dir is not None and static_dir.is_dir():
        app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")

    return app
