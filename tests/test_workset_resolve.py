"""工作集路径展开 · 单元测试（normalize / resolve）。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from phoenix.code.workset_resolve import (
    normalize_workset_paths,
    resolve_workset_to_dirs,
    resolve_workset_to_files,
)


class TestNormalizeWorksetPaths(unittest.TestCase):
    def test_empty(self) -> None:
        self.assertEqual(normalize_workset_paths([]), [])

    def test_trims_and_normalizes(self) -> None:
        paths = ["  src/module/  ", "src\\sub\\file.cpp", "./src/other"]
        result = normalize_workset_paths(paths)
        self.assertEqual(result, ["src/module", "src/other", "src/sub/file.cpp"])

    def test_skips_dotdot(self) -> None:
        self.assertEqual(normalize_workset_paths(["src/../escape"]), [])

    def test_deduplicates(self) -> None:
        paths = ["src/a", "src/a", "src/b"]
        result = normalize_workset_paths(paths)
        self.assertEqual(result, ["src/a", "src/b"])

    def test_removes_nested_children(self) -> None:
        """父目录包含子目录时，去掉子目录。"""
        paths = ["src/", "src/sub/", "src/sub/deep/", "other/"]
        result = normalize_workset_paths(paths)
        self.assertEqual(result, ["other", "src"])

    def test_keeps_sibling_dirs(self) -> None:
        paths = ["src/core/", "src/ui/"]
        result = normalize_workset_paths(paths)
        self.assertEqual(result, ["src/core", "src/ui"])

    def test_sorts_by_depth_then_name(self) -> None:
        paths = ["zzz/aaa/", "a/", "zzz/"]
        result = normalize_workset_paths(paths)
        # "zzz" 包含 "zzz/aaa"（目录嵌套），所以 "zzz/aaa" 被去嵌套移除
        self.assertEqual(result, ["a", "zzz"])

    def test_file_inside_dir_is_nested(self) -> None:
        """目录 + 目录内文件 → 目录包含文件，去掉单独的文件。"""
        paths = ["src/", "src/file.cpp"]
        result = normalize_workset_paths(paths)
        self.assertEqual(result, ["src"])

    def test_standalone_file_kept(self) -> None:
        """单独文件（无父目录在工作集中）保留。"""
        paths = ["top.cpp", "other/"]
        result = normalize_workset_paths(paths)
        self.assertEqual(result, ["other", "top.cpp"])


class TestResolveWorksetToFiles(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.ws = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _make(self, rel: str, content: str = "") -> Path:
        p = self.ws / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        return p

    def test_empty_paths(self) -> None:
        result = resolve_workset_to_files([], str(self.ws), ["*.h", "*.cpp"])
        self.assertEqual(result, [])

    def test_single_file_matched(self) -> None:
        self._make("src/a.cpp")
        result = resolve_workset_to_files(["src/a.cpp"], str(self.ws), ["*.cpp", "*.h"])
        self.assertEqual(result, ["src/a.cpp"])

    def test_single_file_not_matched(self) -> None:
        self._make("readme.txt")
        result = resolve_workset_to_files(["readme.txt"], str(self.ws), ["*.cpp", "*.h"])
        self.assertEqual(result, [])

    def test_dir_expands_to_files(self) -> None:
        self._make("mod/a.cpp")
        self._make("mod/b.h")
        self._make("mod/readme.md")
        result = resolve_workset_to_files(["mod"], str(self.ws), ["*.cpp", "*.h"])
        self.assertEqual(result, ["mod/a.cpp", "mod/b.h"])

    def test_nested_dirs_collapsed(self) -> None:
        """工作集同时有 mod/ 和 mod/sub/ — 去嵌套后只扫描 mod/。"""
        self._make("mod/a.cpp")
        self._make("mod/sub/b.cpp")
        result = resolve_workset_to_files(
            ["mod", "mod/sub"], str(self.ws), ["*.cpp"]
        )
        self.assertEqual(result, ["mod/a.cpp", "mod/sub/b.cpp"])

    def test_ignored_dir_skipped(self) -> None:
        self._make("src/a.cpp")
        self._make("src/build/b.cpp")
        result = resolve_workset_to_files(
            ["src"], str(self.ws), ["*.cpp"],
            ignore_patterns=["build"],
        )
        self.assertEqual(result, ["src/a.cpp"])

    def test_mixed_files_and_dirs(self) -> None:
        self._make("top.h")
        self._make("mod/a.cpp")
        self._make("mod/b.h")
        result = resolve_workset_to_files(
            ["top.h", "mod"], str(self.ws), ["*.cpp", "*.h"]
        )
        self.assertEqual(result, ["mod/a.cpp", "mod/b.h", "top.h"])

    def test_missing_entry_skipped(self) -> None:
        self._make("src/a.cpp")
        result = resolve_workset_to_files(
            ["src/a.cpp", "nonexistent/"], str(self.ws), ["*.cpp"]
        )
        self.assertEqual(result, ["src/a.cpp"])

    def test_ext_pattern_matching(self) -> None:
        self._make("src/main.cpp")
        self._make("src/main.hpp")
        self._make("src/main.h")
        result = resolve_workset_to_files(
            ["src"], str(self.ws), ["*.h", "*.hpp"]
        )
        self.assertEqual(result, ["src/main.h", "src/main.hpp"])

    def test_dedup_result(self) -> None:
        self._make("mod/a.cpp")
        result = resolve_workset_to_files(
            ["mod/a.cpp", "mod/"], str(self.ws), ["*.cpp"]
        )
        self.assertEqual(result, ["mod/a.cpp"])


class TestResolveWorksetToDirs(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.ws = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _mkdir(self, rel: str) -> Path:
        p = self.ws / rel
        p.mkdir(parents=True, exist_ok=True)
        return p

    def test_empty(self) -> None:
        self.assertEqual(resolve_workset_to_dirs([], str(self.ws)), [])

    def test_dirs_only(self) -> None:
        self._mkdir("src")
        self._mkdir("include")
        result = resolve_workset_to_dirs(["src", "include"], str(self.ws))
        self.assertEqual(result, ["include", "src"])

    def test_files_skipped(self) -> None:
        self._mkdir("src")
        p = self.ws / "top.cpp"
        p.write_text("", encoding="utf-8")
        result = resolve_workset_to_dirs(["src", "top.cpp"], str(self.ws))
        self.assertEqual(result, ["src"])

    def test_nested_collapsed(self) -> None:
        self._mkdir("src/sub/deep")
        result = resolve_workset_to_dirs(["src", "src/sub"], str(self.ws))
        self.assertEqual(result, ["src"])


if __name__ == "__main__":
    unittest.main()
