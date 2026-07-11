import {
  loadWorkspaceSection,
  replaceWorkspaceSection,
} from "./workspacePrefsService.js";

export type ModuleScope = "all" | "cad" | "code";

export type WorkspaceNavModules = {
  scope: ModuleScope;
  enabled: string[];
};

const DEFAULT_ENABLED = ["cad", "code"];

function normalizeScope(raw: unknown): ModuleScope {
  const value = String(raw || "").trim().toLowerCase();
  return value === "cad" || value === "code" ? value : "all";
}

function enabledFromScope(scope: ModuleScope): string[] {
  if (scope === "cad") return ["cad"];
  if (scope === "code") return ["code"];
  return [...DEFAULT_ENABLED];
}

function normalizeEnabled(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_ENABLED];
  const enabled: string[] = [];
  for (const item of raw) {
    const value = String(item || "").trim().toLowerCase();
    if (!DEFAULT_ENABLED.includes(value) || enabled.includes(value)) continue;
    enabled.push(value);
  }
  return enabled.length ? enabled : [...DEFAULT_ENABLED];
}

function scopeFromEnabled(enabled: string[]): ModuleScope {
  if (enabled.length === 1 && enabled[0] === "cad") return "cad";
  if (enabled.length === 1 && enabled[0] === "code") return "code";
  return "all";
}

export function normalizeWorkspaceNavModules(raw: unknown): WorkspaceNavModules {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const block = raw as Record<string, unknown>;
    if (block.scope != null) {
      const scope = normalizeScope(block.scope);
      return { scope, enabled: enabledFromScope(scope) };
    }
    if (block.enabled != null) {
      const enabled = normalizeEnabled(block.enabled);
      return { scope: scopeFromEnabled(enabled), enabled };
    }
  }
  return { scope: "all", enabled: [...DEFAULT_ENABLED] };
}

export function loadWorkspaceNavModules(workspace: string): WorkspaceNavModules {
  return normalizeWorkspaceNavModules(loadWorkspaceSection(workspace, "nav_modules", {}));
}

export function saveWorkspaceNavModules(
  workspace: string,
  patch: { scope?: unknown; enabled?: unknown },
): WorkspaceNavModules {
  let payload: WorkspaceNavModules;
  if (patch.scope != null) {
    const scope = normalizeScope(patch.scope);
    payload = { scope, enabled: enabledFromScope(scope) };
  } else if (patch.enabled != null) {
    const enabled = normalizeEnabled(patch.enabled);
    payload = { scope: scopeFromEnabled(enabled), enabled };
  } else {
    throw new Error("scope or enabled is required");
  }
  replaceWorkspaceSection(workspace, "nav_modules", payload);
  return payload;
}
