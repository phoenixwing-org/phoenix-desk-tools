import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createCaaApp } from "./dialog.js";
import { cadRoutes } from "./cad.js";
import { shellRoutes } from "./shell.js";
import { unitTestRoutes } from "./unit-tests.js";

type ApiCall = {
  file: string;
  line: number;
  method: string | null;
  path: string;
  dynamicTail: boolean;
};

type RegisteredRoute = { method: string; path: string };

function staticUrl(node: ts.Expression): { path: string; dynamicTail: boolean } | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text.startsWith("/api/") ? { path: node.text.split("?", 1)[0], dynamicTail: false } : null;
  }
  if (!ts.isTemplateExpression(node) || !node.head.text.startsWith("/api/")) return null;
  const head = node.head.text.split("?", 1)[0];
  return { path: head, dynamicTail: !node.head.text.includes("?") };
}

function requestMethod(node: ts.CallExpression): string | null {
  const init = node.arguments[1];
  if (!init) return "GET";
  if (!ts.isObjectLiteralExpression(init)) return null;
  for (const property of init.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = property.name.getText().replace(/["']/g, "");
    if (name !== "method") continue;
    if (ts.isStringLiteral(property.initializer)) return property.initializer.text.toUpperCase();
  }
  return "GET";
}

function collectApiCalls(filePath: string): ApiCall[] {
  const sourceText = fs.readFileSync(filePath, "utf8");
  const source = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const calls: ApiCall[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const callee = node.expression.text;
      if ((callee === "jsonFetch" || callee === "fetch") && node.arguments[0]) {
        const url = staticUrl(node.arguments[0]);
        if (url) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          calls.push({ file: path.basename(filePath), line, method: requestMethod(node), ...url });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}

function mountedRoutes(prefix: string, routes: Array<{ method: string; path: string }>): RegisteredRoute[] {
  return routes.map((route) => ({
    method: route.method.toUpperCase(),
    path: `${prefix}${route.path === "/" ? "" : route.path}`.replace(/\/{2,}/g, "/"),
  }));
}

function routePathMatches(call: ApiCall, routePath: string): boolean {
  if (call.dynamicTail) return routePath.startsWith(call.path);
  const pattern = routePath
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/:[^/]+/g, "[^/]+");
  return new RegExp(`^${pattern}$`).test(call.path);
}

describe("frontend API contract", () => {
  it("registers every statically discoverable frontend API path and method", () => {
    const webRoot = path.resolve(process.cwd(), "../web-ui/src");
    const calls = [
      ...collectApiCalls(path.join(webRoot, "api.ts")),
      ...collectApiCalls(path.join(webRoot, "api/caaDialog.ts")),
    ];
    const caaApp = createCaaApp();
    const registered = [
      ...mountedRoutes("", shellRoutes.routes),
      ...mountedRoutes("/api/cad", cadRoutes.routes),
      ...mountedRoutes("", caaApp.routes),
      ...mountedRoutes("/api/caa/unit-tests", unitTestRoutes.routes),
    ];

    const missing = calls.filter((call) => !registered.some((route) => {
      const methodMatches = call.method == null || route.method === call.method || route.method === "ALL";
      return methodMatches && routePathMatches(call, route.path);
    }));

    expect(missing, missing.map((call) => `${call.method || "ANY"} ${call.path} (${call.file}:${call.line})`).join("\n")).toEqual([]);

    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const route of registered) {
      const key = `${route.method} ${route.path}`;
      if (seen.has(key)) duplicates.push(key);
      else seen.add(key);
    }
    expect(duplicates, `Duplicate API route ownership:\n${duplicates.join("\n")}`).toEqual([]);
  });
});
