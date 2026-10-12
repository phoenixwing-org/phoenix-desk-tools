/** Frontend transport DTOs only. No server/Wing-private domain imports. */
export type BomAttributes = Readonly<Record<string, string>>;
export interface BomDeliveryPart {
  readonly partNo: string; readonly revision: string; readonly name: string;
  readonly type: string; readonly term: string; readonly source: string;
  readonly description: string; readonly attributes: BomAttributes;
}
export interface BomDeliveryItem {
  readonly partNo: string; readonly revision: string; readonly qty: number; readonly attributes: BomAttributes;
}
export interface BomDeliveryBom {
  readonly bomKey: string; readonly partNo: string; readonly revision: string; readonly name: string;
  readonly description: string; readonly items: readonly BomDeliveryItem[]; readonly attributes: BomAttributes;
}
export interface BomDeliveryEnvelope {
  readonly schema: "phoenix-bom.transfer-envelope"; readonly schemaVersion: 1;
  readonly transferId: string; readonly createdAt: string;
  readonly producer: { readonly id: "phoenix-desk-tools"; readonly version: string };
  readonly workspace: { readonly schemaVersion: 13; readonly fingerprint: string; readonly scanId: string; readonly scannedAt: string };
  readonly payloadHash: string; readonly parts: readonly BomDeliveryPart[];
  readonly boms: readonly BomDeliveryBom[]; readonly attachments: readonly [];
}
export interface BomDeliveryPreview {
  readonly preview_id: string; readonly expires_at: string; readonly envelope: BomDeliveryEnvelope;
  readonly bytes: number; readonly suggested_filename: string;
}
export interface BomDeliveryReceipt {
  readonly status: "created" | "existing"; readonly targetPath: string;
  readonly transferId: string; readonly payloadHash: string; readonly bytes: number;
  readonly directorySync: "synced" | "failed"; readonly warnings: readonly string[];
}
export type BomDeliveryPhase = "idle" | "previewing" | "confirming" | "exporting" | "choosing";
export type BomDeliveryStatus = "idle" | "ready" | "expired" | "published" | "failed" | "cancelled" | "unconfirmed";
