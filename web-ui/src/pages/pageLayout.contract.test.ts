import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "vue/compiler-sfc";

const sourceRoot = path.resolve(import.meta.dirname, "..");
function vueFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? vueFiles(filename) : entry.name.endsWith(".vue") ? [filename] : [];
  });
}

const headerPages = [
  ...vueFiles(path.join(sourceRoot, "pages")),
  ...vueFiles(path.join(sourceRoot, "features")),
].filter((filename) => fs.readFileSync(filename, "utf8").includes('phoenix-wing/layout/PnwPageHeader.vue'));
const source = (relative: string) => fs.readFileSync(path.join(sourceRoot, relative), "utf8");

describe("Wing workbench Main layout contract", () => {
  it("keeps name-normalization result filters in Header and usage help last in Primary", () => {
    const text = source("features/cad-name-normalize/NameNormalizePage.vue");
    const center = text.match(/<template #center>([\s\S]*?)<\/template>/u)?.[1] ?? "";
    expect(center).toContain('v-model="filenameSearch"');
    expect(center).toContain('v-model="statusFilter"');
    expect(center).toContain("el-radio-button");
    expect(text.indexOf('id: "name-help"')).toBeGreaterThan(text.indexOf('id: "name-references"'));
    expect(text).not.toContain("<p>从主对象 Label");
    expect(text).toContain("已有 PartName 优先");
    expect(text).toContain('nameSource = ref<BomNameSource>("label")');
    expect(text).toContain('label: "名称补全来源"');
    expect(text).not.toContain("按 Label 提取的名称写入");
    expect(text).toContain('@click.exact.prevent="openDetail(row.rel)"');
    expect(text).toContain('shell.openFileDetailForRel(detailRel(rel), { subTab: "edit" })');
    expect(text).toContain('encodeURIComponent(detailRel(row.rel))');
    expect(text).toContain('v-for="{ row, state } in visibleRows"');
    expect(text).toContain('v-for="{ row, state } in visibleRenameRows"');
    expect(text).toContain('class="status-tag"');
    expect(text).toContain("hiddenRenameSelected");
  });
  it("gives the Host page wrapper a definite height inside Wing's block Editor", () => {
    const shell = source("layout/AppShell.vue");
    const wrapper = shell.match(/\.shell-pages\s*\{([^}]+)\}/u)?.[1] ?? "";
    expect(wrapper).toContain("height: 100%");
    expect(wrapper).toContain("min-height: 0");
    expect(wrapper).toContain("overflow: hidden");
  });
  it("covers the current CAD, CAA and system header pages", () => {
    const names = headerPages.map((filename) => path.basename(filename));
    expect(names).toEqual(expect.arrayContaining([
      "CadIndexPage.vue", "PartCatalogPage.vue", "BatchAttributesPage.vue", "GitPage.vue",
      "FileDetailPage.vue", "CaaDialogEditorPage.vue", "CodeIgnorePage.vue", "AudioExtractPage.vue",
    ]));
  });

  it.each(headerPages.map((filename) => [path.relative(sourceRoot, filename), filename]))(
    "%s places its public Header outside the scrolling Main body",
    (_label, filename) => {
      const text = fs.readFileSync(filename, "utf8");
      const { descriptor, errors } = parse(text, { filename });
      expect(errors).toEqual([]);
      expect(text).toContain('phoenix-wing/layout/PnwPageLayout.vue');
      const root = descriptor.template?.ast?.children.find((node) => node.type === 1);
      expect(root?.type).toBe(1);
      if (!root || root.type !== 1) throw new Error("Page needs one layout root");
      expect(root.tag).toBe("PageLayout");
      const header = root.children.find((node) => node.type === 1 && node.tag === "template"
        && node.props.some((prop) => prop.type === 7 && prop.name === "slot"
          && prop.arg?.type === 4 && prop.arg.content === "header"));
      expect(header?.type).toBe(1);
      if (!header || header.type !== 1) throw new Error("Header needs the public header slot");
      expect(header.children.filter((node) => node.type === 1).map((node) => node.tag)).toEqual(["PageHeader"]);
      const pageHeader = header.children.find((node) => node.type === 1 && node.tag === "PageHeader");
      if (!pageHeader || pageHeader.type !== 1) throw new Error("Missing PageHeader");
      const slotNames = pageHeader.children.filter((node) => node.type === 1).flatMap((node) =>
        node.type === 1 ? node.props.flatMap((prop) => prop.type === 7 && prop.name === "slot"
          && prop.arg?.type === 4 ? [prop.arg.content] : []) : []);
      expect(slotNames).not.toContain("actions");
      expect(slotNames).not.toContain("help");
      expect(pageHeader.props.some((prop) => (prop.type === 6 && prop.name === "page-id")
        || (prop.type === 7 && prop.arg?.type === 4 && prop.arg.content === "page-id"))).toBe(false);
      expect(root.children.filter((node) => node.type === 1 && node.tag === "PageHeader")).toEqual([]);
      expect(root.props.some((prop) => prop.type === 6 && prop.name === "class"
        && prop.value?.content.split(/\s+/u).includes("page"))).toBe(false);
      expect(text).not.toMatch(/:deep\(\.pnw-(?:page-head|head-|page-title)/u);
    },
  );

  it("keeps catalog filters in center and commands in right without duplicate Main controls", () => {
    const text = source("pages/PartCatalogPage.vue");
    const center = text.match(/<template #center>([\s\S]*?)<\/template>/u)?.[1] ?? "";
    const right = text.match(/<template #right>([\s\S]*?)<\/template>/u)?.[1] ?? "";
    expect(center).toContain('v-model="search"');
    expect(center).toContain('v-model="statusFilter"');
    expect(center).not.toContain("<el-button");
    expect(right).toContain("CAD 索引");
    expect(right).toContain('@click="refreshList"');
    expect(text.match(/v-model="search"/gu)).toHaveLength(1);
    expect(center.match(/v-model="statusFilter"/gu)).toHaveLength(2); // Mutually exclusive wide/compact controls share one state.
    expect(text.match(/v-model="statusFilter"/gu)).toHaveLength(2);
    expect(source("pages/CadBatchToolsPage.vue")).not.toContain("#center");
  });

  it("adapts catalog business controls to the actual center slot width", () => {
    const text = source("pages/PartCatalogPage.vue");
    expect(text).toContain("container: pdt-catalog-filters / inline-size");
    expect(text).toContain("@container pdt-catalog-filters");
    expect(text).toContain('<PnwSelect v-model="statusFilter" :options="statusOptions"');
    expect(text).toContain('aria-label="搜索零件目录"');
    expect(text).not.toMatch(/:deep\(\.pnw-head/u);
  });

  it("filters only the batch preview in Header center and makes hidden selections explicit", () => {
    const text = source("pages/BatchAttributesPage.vue");
    const center = text.match(/<template #center>([\s\S]*?)<\/template>/u)?.[1] ?? "";
    expect(center).toContain('v-model="filenameSearch"');
    expect(center).toContain('v-model="statusFilter"');
    expect(center).not.toMatch(/@(?:input|change).*?(?:analyze|preview|fetch)/);
    expect(center).toContain('<el-radio-group v-model="statusFilter"');
    expect(center).toContain('<el-radio-button v-for="option in statusOptions"');
    expect(center).not.toContain("<PnwSelect");
    expect(text).toContain(':rows="visibleRows"');
    expect(text).toContain('@click="selectVisible"');
    expect(text).toContain('for (const row of visibleRows.value)');
    expect(text).toContain('if (!row.diagnosticMessages?.length) batch.selectFile(row.rel, true)');
    expect(text).toContain('batchAttributePreviewRows(batch.displayPreview)');
    expect(text).not.toContain('aria-label="跳过与错误"');
    expect(text).toContain("个已勾选文件被当前筛选隐藏，仍会写入");
    expect(text).toContain('defaultChoiceId: "cancel"');
    expect(text).not.toMatch(/:deep\(\.pnw-head/u);
  });

  it("keeps owned table scrolling explicit and leaves the multi-panel CAA editor body scrollable", () => {
    for (const name of ["PartCatalogPage", "CaaDialogHomePage", "FileDetailPage", "PartKeyDetailPage"]) {
      const text = source(`pages/${name}.vue`);
      expect(text).toContain(':body-scroll="false"');
      expect(text).toContain("desk-page-body--fill");
    }
    const editor = source("pages/CaaDialogEditorPage.vue");
    expect(editor).not.toContain(':body-scroll="false"');
    expect(editor).toContain("<CaaDialogEditorView");
    expect(editor).toContain("<CaaNlsTreeEditor");
  });

  it("keeps CAD scan progress in the first Primary section and confirms explicit reset", () => {
    const text = source("pages/CadIndexPage.vue");
    expect(text).not.toContain("#center");
    expect(text).toContain('sections: [{ id: "scope", title: "索引维护", progress: computed(() => cadIndexProgress(job.value))');
    expect(text).toContain('label: "已处理文件"');
    expect(text).toContain('title: "清理旧 CAD 索引", defaultChoiceId: "cancel"');
    expect(text).toContain("包括人工关联");
    expect(text).toContain("自动保存数据库备份");
  });

  it("keeps CAD metadata in Primary and a structured maintenance guide in Main", () => {
    const text = source("pages/CadIndexPage.vue");
    const { descriptor } = parse(text);
    const script = descriptor.scriptSetup?.content ?? "";
    const template = descriptor.template?.content ?? "";
    expect(script).toContain("showContext: false");
    expect(script).toContain('readonlyLayout: "properties"');
    for (const label of ["工作空间", "数据库位置", "Schema 实际 / 预期", "条目 / 缺失", "最后成功扫描", "最近扫描状态", "最近扫描范围"]) {
      expect(script).toContain(`label: "${label}"`);
    }
    expect(template).not.toContain('class="index-facts"');
    expect(template).not.toContain("<dl");
    expect(template).toContain('class="maintenance-steps"');
    expect(template).toContain("不必先清理旧索引");
    expect(template).toContain("全部文件关联（含人工关联）");
    expect(template).toContain("更新索引不会修正源文件");
    expect(template.match(/<SidebarBlock /gu)).toHaveLength(3);
    for (const title of ["如何维护", "遇到问题时", "范围与注意事项"]) {
      expect(template).toContain(`<SidebarBlock title="${title}" variant="card">`);
    }
    expect(template).not.toContain(':collapsible="false"');
    expect(source("style.css")).not.toContain(".pnw-expand-twistie");
    expect(source("style.css")).not.toContain("--pnw-expand-icon");
    const primary = source("components/primary/GenericPagePrimaryBlock.vue");
    expect(primary).toContain("primaryContribution?.showContext !== false");
    expect(primary).toContain('.is-properties .readonly-control dd { white-space: normal; overflow-wrap: anywhere; }');
  });

  it("does not add page-header inset or private Wing Header overrides in shared CSS", () => {
    const shared = source("pages/page-shared.css");
    expect(shared).not.toMatch(/\.tool-page\s*\{/u);
    expect(shared).not.toMatch(/\.head-row|\.page-head|\.page-title/u);
    expect(shared).toContain("flex-wrap: nowrap");
    expect(shared).toContain("gap: var(--pnw-page-header-gap, 8px)");
    const shell = source("layout/AppShell.vue");
    expect(shell).toContain("> .page:not(.desk-page-layout)");
    expect(shell).not.toContain(".config-modal-panel .config-page");
    expect(source("pages/GitPage.vue")).not.toContain("git-page-head");
  });
});

describe("CAA custom Primary layout contract", () => {
  it("uses the public full-height Primary Panel with natural section flow", () => {
    const text = source("components/caa/CaaDialogPrimaryBlock.vue");
    const { descriptor, errors } = parse(text);
    expect(errors).toEqual([]);
    expect(text).toContain('phoenix-wing/layout/PnwPrimaryPanel.vue');
    const root = descriptor.template?.ast?.children.find((node) => node.type === 1);
    expect(root?.type === 1 && root.tag).toBe("PrimaryPanel");
    expect(text).toContain('title="CAA 对话框"');
    expect(text).toContain('<CaaDialogIndexPanel />');
    expect(text).toContain('v-if="props.pageId === CAA_EDITOR_PAGE_ID"');
    expect(text).not.toContain("<style");
    expect(text).not.toContain(":body-scroll=\"false\"");
  });

  it.each(["CaaDialogIndexPanel", "CaaDialogTreePanel"])(
    "%s uses a public collapsible Section and preserves its business controls",
    (name) => {
      const text = source(`components/caa/${name}.vue`);
      const { descriptor, errors } = parse(text);
      expect(errors).toEqual([]);
      expect(text).toContain('phoenix-wing/layout/PnwPrimarySection.vue');
      const root = descriptor.template?.ast?.children.find((node) => node.type === 1);
      expect(root?.type === 1 && root.tag).toBe("PrimarySection");
      expect(text).toContain('v-model:expanded="expanded"');
      expect(text).toContain("padding: 8px");
      expect(text).not.toMatch(/SidebarBlock|sidebar-block|:deep\(|min-height:\s*150px|flex:\s*1 1 50%/u);
      expect(text).not.toMatch(/(?:min-)?height:\s*(?:26|28|40)px/u);
      if (name === "CaaDialogIndexPanel") {
        expect(text).toContain('<template #suffix>');
        expect(text).toContain('<template #actions>');
        expect(text).toContain('@click.stop="loadIndex()"');
        expect(text).toContain('@click.stop="rescan"');
        expect(text).toContain('@click="openDialog(item)"');
        expect(text).toContain('@click="openDialog(row)"');
      } else {
        expect(text).toContain(':current-node-key="currentNodeKey"');
        expect(text).toContain('@node-click="onNodeClick"');
        expect(text).toContain('v-if="store.ir"');
      }
    },
  );
});

describe("File detail sub-tab toolbars", () => {
  it("places file content navigation in the public Header center slot instead of a body row", () => {
    const text = source("pages/FileDetailPage.vue");
    const template = parse(text).descriptor.template!.content;
    const header = template.split('<PageHeader title="文件详情">')[1].split("</PageHeader>")[0];
    expect(header).toContain("<template #center>");
    expect(header).toContain("data-tour-page-filedetail-tabs");
    expect(header).toContain("<template #right>");
    expect(template.split("</PageHeader>")[1]).not.toContain('class="sub-tabs"');
    expect(text).toContain("flex-wrap: nowrap");
  });

  it("keeps one attribute per row with separate name/original/edit/action columns and one options strip", () => {
    const text = source("components/file-detail/FileAttributesPanel.vue");
    expect(parse(text).errors).toEqual([]);
    expect(text).toContain('class="attribute-options"');
    expect(text).not.toContain('class="doc-kind-block"');
    expect(text).toContain("grid-template-columns: 100px minmax(0, 1fr) minmax(0, 1.3fr) 106px");
    expect(text).toContain('class="attribute-columns"');
    expect(text).toContain('class="field-actions"');
    expect(text).toContain('class="field-original"');
    expect(text).toContain('<span>原值</span>');
    expect(text).toContain('<span>编辑值</span>');
    expect(text).not.toContain('repeat(2, minmax(0, 1fr))');
    expect(text).toContain('`原值：${displayInitial(row.key)}`');
    expect(text).toContain('@submit.prevent="onSave"');
    expect(text).toContain('@click="onRecommendField(row.key as EditableKey)"');
    expect(text).toContain('v-for="row in visibleFieldRows"');
    expect(text).toContain('bomReadonly.value ? FIELD_ROWS.filter(row => row.key === "filename") : FIELD_ROWS');
    expect(text).toContain(':readonly="!row.editable"');
    expect(text).not.toContain("onGoRename");
    expect(text).not.toContain('{ key: "repo_rel_path"');
    expect(text.split("</form>")[1]).toContain('class="file-location"');
    expect(text).toContain('<code :title="rel">{{ rel }}</code>');
  });

  it("restores one edited field from its loaded original without writing the file", () => {
    const text = source("components/file-detail/FileAttributesPanel.vue");
    const script = parse(text).descriptor.scriptSetup!.content;
    const restore = script.split("function onRestoreField(")[1].split("\n}")[0];
    expect(restore).toContain("bomReadonly.value");
    expect(restore).toContain('patchField(key as keyof BomFields, String(initialFields.value[key as keyof BomFields] ?? ""))');
    expect(restore).not.toMatch(/saveBom|reloadFile|recommendBomField/u);
    expect(text).toContain('@click="onRestoreField(row.key as EditableKey)"');
    expect(restore).toContain('bomReadonly.value && key !== "filename"');
    expect(text).toContain('!!recommendingField || !isDirty(row.key)');
  });

  it.each(["FileOverviewPanel", "FileAttributesPanel", "FileXrefPanel", "FileAssemblyPanel"])(
    "%s keeps its local title and actions in a shared single row",
    (name) => {
      const text = source(`components/file-detail/${name}.vue`);
      expect(parse(text).errors).toEqual([]);
      if (name === "FileAssemblyPanel") {
        expect(text).toContain('<template #toolbar-title>');
        expect(text).toContain('<template #toolbar-actions>');
        const table = source("components/AssemblyTreeTable.vue");
        expect(table.indexOf('class="asm-tree-toolbar"')).toBeLessThan(table.indexOf('class="table-scroll"'));
        expect(table).not.toContain("max-height: 420px");
      } else expect(text).toContain('<header class="file-panel-header">');
      expect(text).toContain('<h3 class="panel-title">');
      expect(text).toContain('<div class="file-panel-actions">');
      expect(text).toContain('@import "./file-panel-header.css";');
      expect(text).not.toContain('class="toolbar"');
    },
  );
});
