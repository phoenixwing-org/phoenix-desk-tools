"""BOM 森林构建算法 — 纯函数单元测试（不需要 FCStd 文件）。"""

from __future__ import annotations

import unittest

from phoenix.services.cad_index.bom_compute import (
    BomNode,
    BomForestResult,
    RefEdge,
    build_bom_forest,
    build_ref_edges,
)


def _mk_bom(part_number="", part_version="", **kw):
    return {"PartNumber": part_number, "PartVersion": part_version, **kw}


def _mk_xlink(file, label=""):
    return {"file": file, "label": label}


class TestBuildBomForest(unittest.TestCase):
    """BOM 森林构建测试。"""

    def test_empty_input_returns_empty(self):
        result = build_bom_forest({}, {})
        self.assertEqual(len(result.roots), 0)
        self.assertEqual(len(result.bom_lines), 0)
        self.assertEqual(len(result.ref_edges), 0)

    def test_single_file_no_xlinks(self):
        """单文件无引用 → 只有一个根，无行。"""
        data = {
            "./assem.FCStd": {"bom": _mk_bom("8000", "001"), "xlinks": []},
        }
        basename_map = {"assem.FCStd": ["./assem.FCStd"]}
        result = build_bom_forest(data, basename_map)

        self.assertEqual(len(result.roots), 1)
        self.assertIn("./assem.FCStd", result.roots)
        self.assertEqual(len(result.bom_lines), 0)

    def test_simple_two_level(self):
        """装配 → 零件（单层展开）。"""
        data = {
            "./assem.ASSY.FCStd": {
                "bom": _mk_bom("8000", "001"),
                "xlinks": [_mk_xlink("partA.FCStd"), _mk_xlink("partB.FCStd")],
            },
            "./partA.PART.FCStd": {"bom": _mk_bom("8001", "001"), "xlinks": []},
            "./partB.PART.FCStd": {"bom": _mk_bom("8001", "002"), "xlinks": []},
        }
        basename_map = {
            "assem.ASSY.FCStd": ["./assem.ASSY.FCStd"],
            "partA.FCStd": ["./partA.PART.FCStd"],
            "partB.FCStd": ["./partB.PART.FCStd"],
        }
        result = build_bom_forest(data, basename_map)

        self.assertEqual(len(result.roots), 1)
        root = result.roots["./assem.ASSY.FCStd"]
        self.assertEqual(len(root.children), 2)

        # 展平行
        self.assertEqual(len(result.bom_lines), 2)
        lines_by_part = {l["part_rel"]: l for l in result.bom_lines}

        self.assertIn("./partA.PART.FCStd", lines_by_part)
        self.assertEqual(lines_by_part["./partA.PART.FCStd"]["assembly_rel"], "./assem.ASSY.FCStd")
        self.assertEqual(lines_by_part["./partA.PART.FCStd"]["depth"], 1)
        self.assertEqual(lines_by_part["./partA.PART.FCStd"]["part_key"], "8001.001")

        self.assertIn("./partB.PART.FCStd", lines_by_part)
        self.assertEqual(lines_by_part["./partB.PART.FCStd"]["part_key"], "8001.002")

    def test_three_level_nesting(self):
        """总成 → 子装 → 零件。"""
        data = {
            "./top.ASSY.FCStd": {
                "bom": _mk_bom("8000", "001"),
                "xlinks": [_mk_xlink("sub.ASSY.FCStd")],
            },
            "./sub.ASSY.FCStd": {
                "bom": _mk_bom("7000", "001"),
                "xlinks": [_mk_xlink("screw.PART.FCStd")],
            },
            "./screw.PART.FCStd": {"bom": _mk_bom("6000", "001"), "xlinks": []},
        }
        basename_map = {
            "top.ASSY.FCStd": ["./top.ASSY.FCStd"],
            "sub.ASSY.FCStd": ["./sub.ASSY.FCStd"],
            "screw.PART.FCStd": ["./screw.PART.FCStd"],
        }
        result = build_bom_forest(data, basename_map)

        self.assertEqual(len(result.bom_lines), 2)
        # 子装深度 1
        sub_line = next(l for l in result.bom_lines if l["part_rel"] == "./sub.ASSY.FCStd")
        self.assertEqual(sub_line["depth"], 1)
        self.assertEqual(sub_line["assembly_rel"], "./top.ASSY.FCStd")
        self.assertEqual(sub_line["part_key"], "7000.001")

        # 螺丝深度 2
        screw_line = next(l for l in result.bom_lines if l["part_rel"] == "./screw.PART.FCStd")
        self.assertEqual(screw_line["depth"], 2)
        self.assertEqual(screw_line["assembly_rel"], "./top.ASSY.FCStd")
        self.assertEqual(screw_line["bom_path"], "top.ASSY.FCStd/sub.ASSY.FCStd/screw.PART.FCStd")

    def test_cycle_detection_cuts_branch(self):
        """A → B → A：循环被检测并截断。"""
        data = {
            "./a.ASSY.FCStd": {
                "bom": _mk_bom("8000", "001"),
                "xlinks": [_mk_xlink("b.ASSY.FCStd")],
            },
            "./b.ASSY.FCStd": {
                "bom": _mk_bom("8000", "002"),
                "xlinks": [_mk_xlink("a.ASSY.FCStd")],  # 回指 A，形成循环
            },
        }
        basename_map = {
            "a.ASSY.FCStd": ["./a.ASSY.FCStd"],
            "b.ASSY.FCStd": ["./b.ASSY.FCStd"],
        }
        result = build_bom_forest(data, basename_map)

        # B 的子节点 A 应标记 cycle_detected
        self.assertGreaterEqual(len(result.cycles), 1)
        b_child = next(
            (l for l in result.bom_lines if l["part_rel"] == "./a.ASSY.FCStd" and l["cycle_detected"]),
            None,
        )
        self.assertIsNotNone(b_child, "循环节点应被标记")

    def test_cycle_does_not_recurse(self):
        """循环被截断后不继续扩展。"""
        data = {
            "./a.ASSY.FCStd": {
                "bom": _mk_bom("8000", "001"),
                "xlinks": [_mk_xlink("b.ASSY.FCStd")],
            },
            "./b.ASSY.FCStd": {
                "bom": _mk_bom("8000", "002"),
                "xlinks": [_mk_xlink("a.ASSY.FCStd"), _mk_xlink("c.PART.FCStd")],
            },
            "./c.PART.FCStd": {"bom": _mk_bom("6000", "001"), "xlinks": []},
        }
        basename_map = {
            "a.ASSY.FCStd": ["./a.ASSY.FCStd"],
            "b.ASSY.FCStd": ["./b.ASSY.FCStd"],
            "c.PART.FCStd": ["./c.PART.FCStd"],
        }
        result = build_bom_forest(data, basename_map)

        # A 是根（fallback），A→B (depth1), B→A (depth2, cycle), B→C (depth2)
        self.assertEqual(len(result.bom_lines), 3)
        # 循环节点在 depth 2 被标记
        cycle_line = next(
            (l for l in result.bom_lines if l["part_rel"] == "./a.ASSY.FCStd" and l["cycle_detected"]),
            None,
        )
        self.assertIsNotNone(cycle_line)
        self.assertEqual(cycle_line["depth"], 2)
        # C 只出现一次
        c_lines = [l for l in result.bom_lines if l["part_rel"] == "./c.PART.FCStd"]
        self.assertEqual(len(c_lines), 1)

    def test_deeply_nested_no_cycle(self):
        """5 层深度无循环。"""
        n = 5
        data = {}
        basename_map = {}
        for i in range(n):
            rel = f"./l{i}.FCStd"
            data[rel] = {
                "bom": _mk_bom(str(8000 + i), "001"),
                "xlinks": [_mk_xlink(f"l{i + 1}.FCStd")] if i < n - 1 else [],
            }
            basename_map[f"l{i}.FCStd"] = [rel]
        basename_map[f"l{n - 1}.FCStd"] = [f"./l{n - 1}.FCStd"]

        result = build_bom_forest(data, basename_map)
        self.assertEqual(len(result.bom_lines), n - 1)
        max_depth = max(l["depth"] for l in result.bom_lines)
        self.assertEqual(max_depth, n - 1)

    def test_multiple_roots(self):
        """两个独立的装配（互不引用）。"""
        data = {
            "./assem1.ASSY.FCStd": {
                "bom": _mk_bom("8000", "001"),
                "xlinks": [_mk_xlink("part1.FCStd")],
            },
            "./assem2.ASSY.FCStd": {
                "bom": _mk_bom("8000", "002"),
                "xlinks": [_mk_xlink("part2.FCStd")],
            },
            "./part1.PART.FCStd": {"bom": _mk_bom("8001", "001"), "xlinks": []},
            "./part2.PART.FCStd": {"bom": _mk_bom("8001", "002"), "xlinks": []},
        }
        basename_map = {
            "assem1.ASSY.FCStd": ["./assem1.ASSY.FCStd"],
            "assem2.ASSY.FCStd": ["./assem2.ASSY.FCStd"],
            "part1.FCStd": ["./part1.PART.FCStd"],
            "part2.FCStd": ["./part2.PART.FCStd"],
        }
        result = build_bom_forest(data, basename_map)
        self.assertEqual(len(result.roots), 2)
        # 每个根各有一个子零件
        lines1 = [l for l in result.bom_lines if l["assembly_rel"] == "./assem1.ASSY.FCStd"]
        lines2 = [l for l in result.bom_lines if l["assembly_rel"] == "./assem2.ASSY.FCStd"]
        self.assertEqual(len(lines1), 1)
        self.assertEqual(len(lines2), 1)

    def test_part_key_without_version(self):
        """只有 PartNumber 无 PartVersion。"""
        data = {
            "./a.FCStd": {
                "bom": _mk_bom(part_number="PN123"),
                "xlinks": [_mk_xlink("b.FCStd")],
            },
            "./b.FCStd": {"bom": _mk_bom(part_number="PN456"), "xlinks": []},
        }
        basename_map = {"a.FCStd": ["./a.FCStd"], "b.FCStd": ["./b.FCStd"]}
        result = build_bom_forest(data, basename_map)
        line = result.bom_lines[0]
        self.assertEqual(line["part_key"], "PN456")


class TestBuildRefEdges(unittest.TestCase):
    """引用边构建测试。"""

    def test_direct_reference(self):
        data = {
            "./host.FCStd": {
                "bom": _mk_bom("8000", "001"),
                "xlinks": [_mk_xlink("target.FCStd", "Link001")],
            },
            "./target.FCStd": {"bom": _mk_bom("8001", "001"), "xlinks": []},
        }
        basename_map = {
            "host.FCStd": ["./host.FCStd"],
            "target.FCStd": ["./target.FCStd"],
        }
        edges = build_ref_edges(data, basename_map)
        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0].host_rel, "./host.FCStd")
        self.assertEqual(edges[0].target_rel, "./target.FCStd")
        self.assertEqual(edges[0].link_label, "Link001")
        self.assertTrue(edges[0].is_direct)

    def test_indirect_via_missing_target(self):
        """目标不在 all_bom_data 中 → is_direct=False。"""
        data = {
            "./host.FCStd": {
                "bom": _mk_bom("8000", "001"),
                "xlinks": [_mk_xlink("missing.FCStd")],
            },
        }
        basename_map = {"missing.FCStd": ["./missing.FCStd"]}
        edges = build_ref_edges(data, basename_map)
        self.assertEqual(len(edges), 1)
        self.assertFalse(edges[0].is_direct)

    def test_multiple_xlinks_in_one_host(self):
        data = {
            "./host.FCStd": {
                "bom": _mk_bom("8000", "001"),
                "xlinks": [
                    _mk_xlink("a.FCStd"),
                    _mk_xlink("b.FCStd"),
                    _mk_xlink("c.FCStd"),
                ],
            },
            "./a.FCStd": {"bom": _mk_bom(), "xlinks": []},
            "./b.FCStd": {"bom": _mk_bom(), "xlinks": []},
            "./c.FCStd": {"bom": _mk_bom(), "xlinks": []},
        }
        basename_map = {
            "host.FCStd": ["./host.FCStd"],
            "a.FCStd": ["./a.FCStd"],
            "b.FCStd": ["./b.FCStd"],
            "c.FCStd": ["./c.FCStd"],
        }
        edges = build_ref_edges(data, basename_map)
        self.assertEqual(len(edges), 3)

    def test_empty_xlink_skipped(self):
        data = {
            "./host.FCStd": {
                "bom": _mk_bom(),
                "xlinks": [_mk_xlink(""), _mk_xlink("   ")],
            },
        }
        basename_map = {}
        edges = build_ref_edges(data, basename_map)
        self.assertEqual(len(edges), 0)

    def test_non_fcstd_target_skipped(self):
        data = {
            "./host.FCStd": {
                "bom": _mk_bom(),
                "xlinks": [_mk_xlink("readme.md")],
            },
        }
        basename_map = {"readme.md": ["./readme.md"]}
        edges = build_ref_edges(data, basename_map)
        self.assertEqual(len(edges), 0)

    def test_target_not_in_basename_map(self):
        data = {
            "./host.FCStd": {
                "bom": _mk_bom(),
                "xlinks": [_mk_xlink("orphan.FCStd")],
            },
        }
        basename_map = {}
        edges = build_ref_edges(data, basename_map)
        self.assertEqual(len(edges), 0)


class TestResolveTarget(unittest.TestCase):
    """目标解析优先级测试。"""

    def test_same_dir_preferred(self):
        """同目录候选优先于其他目录。"""
        from phoenix.services.cad_index.bom_compute import _resolve_target

        basename_map = {
            "part.FCStd": [
                "./other/part.FCStd",
                "./assem/part.FCStd",  # 与宿主同目录
            ],
        }
        result = _resolve_target("part.FCStd", "./assem/host.FCStd", basename_map)
        self.assertEqual(result, "./assem/part.FCStd")

    def test_single_candidate_always_wins(self):
        from phoenix.services.cad_index.bom_compute import _resolve_target

        basename_map = {"part.FCStd": ["./only/part.FCStd"]}
        result = _resolve_target("part.FCStd", "./assem/host.FCStd", basename_map)
        self.assertEqual(result, "./only/part.FCStd")

    def test_relative_path_with_dirs(self):
        """XLink 带相对路径如 ../parts/Child.FCStd。"""
        from phoenix.services.cad_index.bom_compute import _resolve_target

        basename_map = {"Child.FCStd": ["./parts/Child.FCStd"]}
        result = _resolve_target("../parts/Child.FCStd", "./assem/host.FCStd", basename_map)
        self.assertEqual(result, "./parts/Child.FCStd")
