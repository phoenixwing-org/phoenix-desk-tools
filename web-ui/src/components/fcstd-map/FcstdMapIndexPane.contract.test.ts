import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const page = readFileSync(
  new URL("../../pages/FcstdMapPage.vue", import.meta.url),
  "utf8",
);
const pane = readFileSync(new URL("./FcstdMapIndexPane.vue", import.meta.url), "utf8");

describe("FCStd map index pane characterization", () => {
  it("冻结搜索、状态/类型筛选与显示范围", () => {
    expect(pane).toContain('id="cad-index-search"');
    expect(pane).toContain('v-model="searchQuery"');
    expect(pane).toContain('placeholder="搜索文件名、零件标识、路径…"');
    expect(pane).toContain('<el-radio-button value="all">全部</el-radio-button>');
    expect(pane).toContain('<el-radio-button value="present">存在</el-radio-button>');
    expect(pane).toContain('<el-radio-button value="missing">缺失</el-radio-button>');
    expect(pane).toContain('v-for="opt in KIND_OPTIONS"');
    expect(pane).toContain("entriesTotal ? `${pageOffset + 1}–${pageEnd}` : 0");
  });

  it("冻结十二列顺序、行身份/状态和打开动作 payload", () => {
    const columnsSource = pane.match(
      /const cadColumns: PnwTableColumnDef\[\] = \[([\s\S]*?)\n\];/,
    )?.[1];
    expect(columnsSource).toBeTruthy();
    expect([...columnsSource!.matchAll(/\{ key: "([^"]+)"/g)].map((match) => match[1])).toEqual([
      "index",
      "status",
      "kind",
      "file",
      "partKey",
      "partVersion",
      "typeCode",
      "modelSeries",
      "partName",
      "label",
      "dir",
      "meta",
    ]);

    expect((pane.match(/<td(?:\s|>)/g) ?? [])).toHaveLength(12);
    expect(pane).toContain(':key="row.repo_rel_path + row.file_status"');
    expect(pane).toContain(':class="row.file_status"');
    expect(pane).toContain("@click=\"emit('openFileDetail', row)\"");
    expect(pane).toContain("@click=\"emit('openPartKey', row)\"");
    expect(pane).toContain("{{ statusLabel(row) }}");
    expect(pane).toContain("{{ assetKindLabel(row) }}");
    expect(pane).toContain("{{ relDir(row) }}");
    expect(pane).toContain("{{ metaCell(row) }}");
  });

  it("冻结 loading、无匹配、无筛选结果、无索引和分页契约", () => {
    expect(pane).toContain('data-tour-page-fcstd-table');
    expect(pane).toContain('description="加载索引列表…"');
    expect(pane).toContain("'无匹配条目，请调整搜索或筛选'");
    expect(pane).toContain("'当前筛选无条目'");
    expect(pane).toContain("'尚无索引，点击「工程内搜索」开始扫描'");
    expect(pane).toContain('layout="total, sizes, prev, pager, next"');
    expect(pane).toContain(':page-sizes="[...PAGE_SIZE_OPTIONS]"');
    expect(pane).toContain("@current-change=\"emit('pageChange', $event)\"");
    expect(pane).toContain("@size-change=\"emit('pageSizeChange', $event)\"");
  });

  it("冻结 Page 的 Controller、Host 导航和 session 真源", () => {
    expect(page).toContain('import FcstdMapIndexPane from "../components/fcstd-map/FcstdMapIndexPane.vue"');
    expect(page).toContain('v-model:search-query="searchQuery"');
    expect(page).toContain('v-model:status-filter="statusFilter"');
    expect(page).toContain('v-model:kind-filter="kindFilter"');
    expect(page).toContain('@page-change="onPagerCurrentChange"');
    expect(page).toContain('@page-size-change="onPagerSizeChange"');
    expect(page).toContain('@open-file-detail="openFileDetail"');
    expect(page).toContain('@open-part-key="openPartKey"');
    expect(page).toContain("const entriesController = useFcstdMapEntries({");
    expect(page).toContain("usePageSession(props.workbenchTabId");
    expect(page).toContain("serializeFcstdMapPageSession({");
    expect(page).toContain("hydrateFcstdMapPageSession(snap");
    expect(page).toContain("shell.openPartKeyDetail(row.PartNumber, row.PartVersion)");
    expect(page).toContain("if (!rel || !canOpenFileDetail(row)) return");
    expect(page).toContain("shell.openFileDetailForRel(rel)");
    expect(page).not.toContain("fetchFcstdMapEntries");
    expect(page).not.toContain('id="cad-index-search"');
    expect(page).not.toContain("const cadColumns:");
    expect(pane).not.toMatch(/from ["'][^"']*api["']|useAppShell|useFcstdMapEntries|localStorage|sessionStorage/);
  });
});
