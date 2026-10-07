import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "vue/compiler-sfc";

const components = ["FileOverviewPanel", "FileAttributesPanel", "FileXrefPanel"];
const cssFor = (name: string) => parse(readFileSync(new URL(`./${name}.vue`, import.meta.url), "utf8")).descriptor.styles.map(style => style.content).join("\n");
const theme = readFileSync(new URL("../../styles/theme.css", import.meta.url), "utf8");
const declarations = (css: string) => Object.fromEntries([...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]));
const light = declarations(theme.split('[data-theme="dark"] {')[0]);
const dark = { ...light, ...declarations(theme.split('[data-theme="dark"] {')[1]) };

type Rgb = [number, number, number];
function rgb(color: string, under: Rgb = [255, 255, 255]): Rgb {
  if (color.startsWith("#")) return [1, 3, 5].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16)) as Rgb;
  const channels = color.match(/[\d.]+/g)!.map(Number);
  const alpha = channels[3] ?? 1;
  return channels.slice(0, 3).map((channel, index) => channel * alpha + under[index] * (1 - alpha)) as Rgb;
}
function luminance(color: Rgb) {
  const [r, g, b] = color.map(channel => {
    const value = channel / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  return .2126 * r + .7152 * g + .0722 * b;
}
function contrast(foreground: string, background: string, surface: string) {
  const backdrop = rgb(background, rgb(surface));
  const values = [luminance(rgb(foreground, backdrop)), luminance(backdrop)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}

describe("file detail theme contract", () => {
  it("themes the assembly inputs, edited state, headers, icons and action buttons", () => {
    const sources = ["../AssemblyTreeTable.vue", "../assembly-tree/AssemblyTreeRowGroup.vue"].map(file =>
      parse(readFileSync(new URL(file, import.meta.url), "utf8")).descriptor.styles.map(style => style.content).join("\n"));
    for (const css of sources) expect(css).not.toMatch(/#[\da-f]{3,8}\b|\brgba?\(|:\s*(?:white|black)\s*[;}]/i);
    const input = sources[1].match(/\.label-input\s*\{([^}]+)\}/)![1];
    expect(input).toContain("background: var(--phoenix-bg-elevated)");
    expect(input).toContain("color: var(--phoenix-text)");
    expect(sources[1]).toContain("mask: var(--role-icon-image)");
  });
  it("themes workspace tree hover, active, directory text and guides without light-only colors", () => {
    const source = readFileSync(new URL("../TreeBranch.vue", import.meta.url), "utf8");
    const css = parse(source).descriptor.styles.map(style => style.content).join("\n");
    expect(css).not.toMatch(/#[\da-f]{3,8}\b|\brgba?\(/i);
    expect(css).toContain("background: var(--phoenix-hover-overlay)");
    expect(css).toContain("background: var(--phoenix-accent-soft)");
    expect(css).toContain("color: var(--phoenix-accent)");
    expect(css).toContain("color: var(--phoenix-text-secondary)");
    expect(css).toContain("border-left: 1px solid var(--phoenix-border)");
  });
  it.each(components)("%s avoids fixed light-only colors in its scoped CSS", name => {
    expect(cssFor(name)).not.toMatch(/#[\da-f]{3,8}\b|\brgba?\(|:\s*(?:white|black)\s*[;}]/i);
  });
  it("themes summary, table headers, warning rows, links and public button variables", () => {
    expect(cssFor("FileOverviewPanel")).toContain("background: var(--phoenix-bg-elevated)");
    const xref = cssFor("FileXrefPanel");
    expect(xref).toContain("background: var(--phoenix-bg-panel-head)");
    expect(xref).toContain("color: var(--phoenix-accent)");
    expect(xref).toContain("background: var(--phoenix-warning-bg)");
    expect(xref).toContain("--el-button-bg-color: var(--phoenix-success-bg)");
    expect(xref).toContain("--el-button-disabled-bg-color: var(--phoenix-bg-muted)");
    expect(xref).not.toMatch(/!important|:deep/);
  });
  it("pairs the name-normalization difference background with readable theme text", () => {
    const source = readFileSync(new URL("../../features/cad-name-normalize/NameNormalizePage.vue", import.meta.url), "utf8");
    const css = parse(source).descriptor.styles.map(style => style.content).join("\n");
    const difference = css.match(/\.difference\s*\{([^}]+)\}/)?.[1] ?? "";
    expect(difference).toContain("background: var(--phoenix-warning-bg)");
    expect(difference).toContain("color: var(--phoenix-warning-text)");
    expect(css).not.toContain("background: var(--el-color-warning-light-9)");
    expect(css).toContain("--el-color-error-light-9: var(--phoenix-danger-bg)");
    expect(source.match(/class="normalization-notice"/g)).toHaveLength(3);
  });
  for (const [name, tokens] of [["light", light], ["dark", dark]] as const) {
    it.each([
      ["text", "bg-elevated"], ["text-secondary", "bg-panel-head"],
      ["text-muted", "bg-elevated"], ["accent", "bg-page"],
      ["warning-text", "warning-bg"], ["success-text", "success-bg"],
      ["danger-text", "danger-bg"], ["text", "warning-bg"],
    ])(`${name} tokens keep %s legible on %s`, (foreground, background) => {
      expect(contrast(tokens[`--phoenix-${foreground}`], tokens[`--phoenix-${background}`], tokens["--phoenix-bg-page"])).toBeGreaterThanOrEqual(4.5);
    });
  }
});
