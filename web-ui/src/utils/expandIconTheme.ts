/** 展开/折叠三角（与 TreeBranch、装配树、BOM 分组等共用） */
const TWISTIE_COLLAPSED = encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path fill='%23475569' d='M6.2 3.8 11.4 8l-5.2 4.2z'/></svg>",
);
const TWISTIE_EXPANDED = encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path fill='%23475569' d='M3.8 5.8 8 11l4.2-5.2z'/></svg>",
);

export const EXPAND_ICON_SIZE_MIN = 16;
export const EXPAND_ICON_SIZE_MAX = 32;
export const EXPAND_ICON_SIZE_DEFAULT = 24;

export function clampExpandIconSize(px: number): number {
  return Math.min(EXPAND_ICON_SIZE_MAX, Math.max(EXPAND_ICON_SIZE_MIN, Math.round(px)));
}

export function expandGlyphSizePx(boxPx: number): number {
  return Math.max(10, Math.round(boxPx * 0.67));
}

export function applyExpandIconCssVars(boxPx: number): void {
  const box = clampExpandIconSize(boxPx);
  const glyph = expandGlyphSizePx(box);
  const root = document.documentElement;
  root.style.setProperty("--fcdesk-expand-size", `${box}px`);
  root.style.setProperty("--fcdesk-expand-glyph", `${glyph}px`);
  root.style.setProperty(
    "--fcdesk-expand-icon-collapsed",
    `url("data:image/svg+xml,${TWISTIE_COLLAPSED}")`,
  );
  root.style.setProperty(
    "--fcdesk-expand-icon-expanded",
    `url("data:image/svg+xml,${TWISTIE_EXPANDED}")`,
  );
}
