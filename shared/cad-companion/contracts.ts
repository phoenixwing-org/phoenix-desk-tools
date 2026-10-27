/** Pure D0 contracts. These describe observations and names, never write authorization. */
export type CompanionPurpose = 'model_notes' | 'drawing_notes' | 'development_doc' | 'unknown';
export type CompanionDiagnostic = { code: string; message: string };
export type CadNameIdentity = {
  number: string | null;
  revisionRaw: string | null;
  revision: string | null;
  variantRaw: string | null;
  variantStatus: 'known' | 'unknown' | 'none';
  name: string;
  rawStem: string;
  displayFilename: string;
  role: 'model' | 'drawing' | 'assembly' | 'unknown';
  draftSequence: number | null;
  parseStatus: 'parsed' | 'manual';
};
export type CompanionNameProposal = {
  status: 'ready' | 'manual';
  filename: string | null;
  diagnostics: CompanionDiagnostic[];
};
export type ExplicitCompanionAlias = { rel: string; purpose: CompanionPurpose };
export type CompanionRequest = {
  source_rel: string;
  source_node?: string;
  drawing_rel?: string;
  identity: CadNameIdentity;
  purpose: CompanionPurpose;
  draft_sequence?: number;
  /** Explicit reviewed name, not inferred removal of classification segments. */
  name_override?: string;
  explicit_aliases?: ExplicitCompanionAlias[];
  notes_directories?: string[];
};
export type CompanionCandidate = {
  rel: string;
  purpose: CompanionPurpose;
  naming: 'purpose_v1' | 'drawing_ai' | 'bare' | 'explicit_alias';
  read_status: 'readable' | 'unreadable' | 'invalid_encoding' | 'unsafe';
  sha256: string | null;
  bytes: number | null;
  diagnostics: CompanionDiagnostic[];
};
export type CompanionDiscoveryResult = {
  version: 1;
  binding: CompanionRequest;
  status: 'unique' | 'aliases_equal' | 'missing' | 'conflict' | 'manual';
  candidates: CompanionCandidate[];
  scope_complete: boolean;
  selected_rel?: string;
  proposed_rel?: string;
  diagnostics: CompanionDiagnostic[];
};
export type CompanionTextResult = {
  rel: string;
  text: string;
  sha256: string;
  bytes: number;
  content_type: 'text/plain; charset=utf-8';
};
export type FrozenDrawingOutputGroup = {
  version: 1;
  binding: CompanionRequest;
  draft_sequence: number;
  drawing_rel: string;
  pdf_rel: string;
  notes_rel: string;
  reserved_rels: string[];
};
export type SidecarProvenance = {
  schema: 'phoenix-cad-companion';
  version: 1;
  generated_draft: true;
  source_rel: string;
  source_node?: string;
  source_sha256: string;
  drawing_rel: string;
  drawing_sha256: string;
  pdf_rel: string;
  pdf_sha256: string;
  revisionRaw: string;
  variantRaw: string | null;
  draft_sequence: number;
  reference_pdf: { rel: string; sha256: string } | null;
};
