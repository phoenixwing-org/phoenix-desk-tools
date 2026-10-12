import { jsonFetch } from "../../api";
import { isCadObjectInfoResult, type CadObjectInfoResult } from "./types";

export async function fetchCadObjectInfo(workspacePath: string, filePath: string, signal?: AbortSignal): Promise<CadObjectInfoResult> {
  const response = await jsonFetch<{ success?: boolean; data?: unknown }>("/api/cad/object-info", {
    method: "POST", body: JSON.stringify({ workspacePath, filePath }), signal,
  });
  if (!response?.success || !isCadObjectInfoResult(response.data)) throw new Error("对象信息响应格式无效，未显示不完整结果。");
  return response.data;
}
