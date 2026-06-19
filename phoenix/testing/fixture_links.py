"""将 manifest 中的外部测试工程 symlink 到 tests/fixtures/。"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

log = logging.getLogger("phoenix.testing.fixture_links")

MANIFEST_NAME = "external-links.manifest.json"
SKIP_ENV = "PHOENIX_SKIP_FIXTURE_LINKS"


@dataclass(frozen=True)
class LinkResult:
    name: str
    status: str
    detail: str


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def fixtures_dir() -> Path:
    return repo_root() / "tests" / "fixtures"


def manifest_path() -> Path:
    return fixtures_dir() / MANIFEST_NAME


def load_manifest() -> dict[str, Any]:
    path = manifest_path()
    if not path.is_file():
        return {"version": 0, "links": []}
    return json.loads(path.read_text(encoding="utf-8"))


def _skip_enabled() -> bool:
    return os.environ.get(SKIP_ENV, "").strip().lower() in ("1", "true", "yes")


def resolve_link_target(link: dict[str, Any], root: Path | None = None) -> Path | None:
    root = root or repo_root()
    name = str(link.get("name") or "").strip()
    env_key = f"PHOENIX_FIXTURE_{name}" if name else ""
    env_val = os.environ.get(env_key, "").strip() if env_key else ""
    if env_val:
        candidate = Path(env_val).expanduser()
        if candidate.is_dir():
            return candidate.resolve()

    for raw in link.get("candidates") or []:
        candidate = (root / str(raw)).expanduser()
        if candidate.is_dir():
            return candidate.resolve()

    target = link.get("target")
    if target:
        candidate = (root / str(target)).expanduser()
        if candidate.is_dir():
            return candidate.resolve()
    return None


def _relative_symlink_target(link_path: Path, target: Path) -> str:
    try:
        rel = os.path.relpath(target, link_path.parent)
        if not rel.startswith(".."):
            return rel
    except ValueError:
        pass
    return str(target)


def _existing_link_target(link_path: Path) -> Path | None:
    if not link_path.is_symlink():
        return None
    try:
        return link_path.resolve()
    except OSError:
        return None


def ensure_link(name: str, target: Path, *, dry_run: bool = False) -> LinkResult:
    link_path = fixtures_dir() / name
    target = target.resolve()

    if link_path.is_symlink():
        current = _existing_link_target(link_path)
        if current == target:
            return LinkResult(name, "ok", f"已链接 → {target}")
        if dry_run:
            return LinkResult(name, "would_relink", f"{current} → {target}")
        link_path.unlink()
    elif link_path.exists():
        return LinkResult(
            name,
            "skipped",
            f"已存在非 symlink 目录 {link_path.name}，未覆盖",
        )

    dest = _relative_symlink_target(link_path, target)
    if dry_run:
        return LinkResult(name, "would_link", f"{link_path.name} → {dest}")

    link_path.parent.mkdir(parents=True, exist_ok=True)
    os.symlink(dest, link_path, target_is_directory=True)
    return LinkResult(name, "linked", f"{link_path.name} → {target}")


def ensure_fixture_links(*, dry_run: bool = False) -> list[LinkResult]:
    if _skip_enabled():
        log.debug("fixture link skipped (%s set)", SKIP_ENV)
        return []

    manifest = load_manifest()
    results: list[LinkResult] = []
    root = repo_root()

    for link in manifest.get("links") or []:
        name = str(link.get("name") or "").strip()
        if not name:
            continue
        target = resolve_link_target(link, root)
        if target is None:
            results.append(
                LinkResult(
                    name,
                    "missing",
                    "本机未找到 clone；可设 PHOENIX_FIXTURE_"
                    + name
                    + " 或 clone 到仓库同级目录",
                )
            )
            continue
        try:
            results.append(ensure_link(name, target, dry_run=dry_run))
        except OSError as exc:
            results.append(LinkResult(name, "error", str(exc)))

    return results


def ensure_fixture_links_logged(*, dry_run: bool = False) -> list[LinkResult]:
    results = ensure_fixture_links(dry_run=dry_run)
    for item in results:
        if item.status in ("linked", "would_link", "would_relink"):
            log.info("fixture %s: %s — %s", item.name, item.status, item.detail)
        elif item.status == "ok":
            log.debug("fixture %s: %s", item.name, item.detail)
        elif item.status == "missing":
            log.debug("fixture %s missing: %s", item.name, item.detail)
        else:
            log.warning("fixture %s: %s — %s", item.name, item.status, item.detail)
    return results
