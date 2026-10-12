import { jsonFetch } from "../../api";
import { isCadLightInfoResult, type CadLightInfoResult } from "./types";

export async function fetchCadLightInfo(workspacePath: string, filePath: string, signal?: AbortSignal): Promise<CadLightInfoResult> {
  const response = await jsonFetch<{ success?: boolean; data?: unknown }>("/api/cad/light-info", {
    method: "POST", body: JSON.stringify({ workspacePath, filePath }), signal,
  });
  if (response?.success !== true || !isCadLightInfoResult(response.data)) throw new Error("轻量摘要响应格式无效，未显示不完整结果。");
  return response.data;
}
