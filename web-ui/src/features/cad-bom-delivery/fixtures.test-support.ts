import { createHash } from "node:crypto";
import type { BomDeliveryPreview, BomDeliveryReceipt } from "./types";
// Fixed transport keys, sorted solely for the independently constructed test JSON.
const jsonKeys = ["attachments", "attributes", "bomKey", "boms", "createdAt", "description", "fingerprint", "id", "items", "name", "partNo", "parts", "payloadHash", "producer", "qty", "revision", "scanId", "scannedAt", "schema", "schemaVersion", "source", "term", "transferId", "type", "version", "workspace"].sort();
// Independently invented transport records, no engineering files or source inventory.
export function syntheticPreview(): BomDeliveryPreview {
  const transferId = "a1000000-0000-4000-8000-000000000001";
  const envelope: BomDeliveryPreview["envelope"] = {
    schema: "phoenix-bom.transfer-envelope", schemaVersion: 1, transferId, createdAt: "2030-01-01T00:00:00.000Z", producer: { id: "phoenix-desk-tools", version: "test" },
    workspace: { schemaVersion: 13, fingerprint: `sha256:${"1".repeat(64)}`, scanId: transferId, scannedAt: "2030-01-01T00:00:00.000Z" }, payloadHash: "",
    parts: [{ partNo: "EXAMPLE-CHILD", revision: "V1", name: "Independent child", type: "", term: "", source: "", description: "", attributes: {} }, { partNo: "EXAMPLE", revision: "V1", name: "Independent parent", type: "", term: "", source: "", description: "", attributes: {} }],
    boms: [{ bomKey: "EXAMPLE@V1", partNo: "EXAMPLE", revision: "V1", name: "Example parent", description: "", attributes: {}, items: [{ partNo: "EXAMPLE-CHILD", revision: "V1", qty: 2, attributes: {} }] }], attachments: [],
  };
  const payloadHash = `sha256:${createHash("sha256").update(JSON.stringify({ parts: envelope.parts, boms: envelope.boms, attachments: envelope.attachments }, jsonKeys)).digest("hex")}`;
  const complete = { ...envelope, payloadHash };
  return { preview_id: "b1000000-0000-4000-8000-000000000001", expires_at: "2030-01-01T00:10:00.000Z", bytes: Buffer.byteLength(JSON.stringify(complete, jsonKeys)), suggested_filename: `phoenix-bom-${transferId}.json`, envelope: complete };
}
export function syntheticReceipt(targetPath = "/example/.phoenix/outbox/example.json"): BomDeliveryReceipt {
  const value = syntheticPreview();
  return { status: "created", targetPath, transferId: value.envelope.transferId, payloadHash: value.envelope.payloadHash, bytes: value.bytes, directorySync: "synced", warnings: [] };
}
export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
