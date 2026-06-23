"""壳层 Git 插件 HTTP 路由（薄层 → phoenix.shell.git）。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from phoenix.shell.git import GitCommitConfigError, git_changes, git_commit, git_diff, git_info, git_init, git_restore, git_stage

router = APIRouter(prefix="/api/git", tags=["git"])


def _workspace():
    from phoenix.web.app import get_workspace

    return get_workspace()


class GitStageBody(BaseModel):
    paths: list[str] = Field(min_length=1)


class GitRestoreBody(BaseModel):
    paths: list[str] = Field(min_length=1)
    scope: str = "worktree"


class GitCommitBody(BaseModel):
    message: str = Field(min_length=1, max_length=4096)


@router.get("/info")
def api_git_info() -> dict:
    return git_info(_workspace())


@router.get("/changes")
def api_git_changes() -> dict:
    try:
        return git_changes(_workspace())
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/diff")
def api_git_diff(
    path: str = Query(..., min_length=1),
    scope: str = Query("worktree"),
) -> dict:
    try:
        return git_diff(_workspace(), path, scope=scope)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/init")
def api_git_init() -> dict:
    try:
        return git_init(_workspace())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/stage")
def api_git_stage(body: GitStageBody) -> dict:
    try:
        return git_stage(_workspace(), body.paths)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/restore")
def api_git_restore(body: GitRestoreBody) -> dict:
    try:
        return git_restore(_workspace(), body.paths, scope=body.scope)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/commit")
def api_git_commit(body: GitCommitBody) -> dict:
    try:
        return git_commit(_workspace(), body.message)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except GitCommitConfigError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


def register_git_routes(app) -> None:
    app.include_router(router)
