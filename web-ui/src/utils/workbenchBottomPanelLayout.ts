export type WorkbenchBottomPanelHeightBounds = {
  hostHeight: number;
  minPanelHeight: number;
  minPrimaryHeight: number;
  layoutGap: number;
  maxViewportHeight: number;
};

/**
 * Resolve a bottom-panel height without allowing it to cover the primary View.
 *
 * The host-height constraint wins over the preferred minimum on very small
 * windows so the table/editor always retains a usable region.
 */
export function resolveWorkbenchBottomPanelHeight(
  requestedHeight: number,
  bounds: WorkbenchBottomPanelHeightBounds,
): number {
  const hostHeight = Math.max(0, Math.round(bounds.hostHeight));
  const minimum = Math.max(36, Math.round(bounds.minPanelHeight));
  const maximumByPrimary = Math.max(
    36,
    hostHeight - Math.max(0, Math.round(bounds.minPrimaryHeight))
      - Math.max(0, Math.round(bounds.layoutGap)),
  );
  const maximum = Math.max(
    36,
    Math.min(maximumByPrimary, Math.max(36, Math.round(bounds.maxViewportHeight))),
  );
  const effectiveMinimum = Math.min(minimum, maximum);
  const finiteRequested = Number.isFinite(requestedHeight) ? requestedHeight : effectiveMinimum;
  return Math.round(Math.min(maximum, Math.max(effectiveMinimum, finiteRequested)));
}
