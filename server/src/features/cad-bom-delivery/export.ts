import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CAD_BOM_TRANSFER_MAX_BYTES } from "./envelope.js";
import { revalidateCadBomTransfer, type PreparedCadBomTransfer } from "./snapshot.js";

type Workspace = Parameters<typeof revalidateCadBomTransfer>[0];
type Identity = Pick<fs.Stats, "dev" | "ino">;

export interface CadBomTransferExportReceipt {
  readonly status: "created" | "existing";
  /** Canonical, user-selected directory plus the requested basename. */
  readonly targetPath: string;
  readonly transferId: string;
  readonly payloadHash: string;
  readonly bytes: number;
  /** A failure here does not undo publication. No power-loss guarantee is implied. */
  readonly directorySync: "synced" | "failed";
  readonly warnings: readonly string[];
}

/** Server-side dependency injection only; never populate hooks from a route payload. */
export interface CadBomTransferExportOptions {
  readonly assertActive?: () => void;
  readonly testHooks?: {
    readonly beforeRevalidate?: () => void;
    readonly beforeLink?: () => void;
  };
}

function sameIdentity(left: Identity, right: Identity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function code(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runHook(hook: (() => void) | undefined): void {
  const result: unknown = hook?.();
  if (result && (typeof result === "object" || typeof result === "function") && "then" in result) {
    throw new Error("CAD BOM export hooks must be synchronous");
  }
}

function withFd<T>(filename: string, flags: number, action: (fd: number) => T): T {
  const fd = fs.openSync(filename, flags);
  let value!: T;
  let failure: unknown;
  let failed = false;
  try { value = action(fd); } catch (error) { failed = true; failure = error; }
  try { fs.closeSync(fd); } catch (error) {
    if (failed) throw new AggregateError([failure, error], "CAD BOM export read and close failed");
    throw error;
  }
  if (failed) throw failure;
  return value;
}

function readRegular(filename: string, expectedBytes: Uint8Array, expectedIdentity?: Identity): Identity {
  const before = fs.lstatSync(filename);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("CAD BOM export target is not a regular file");
  if (expectedIdentity && !sameIdentity(before, expectedIdentity)) throw new Error("CAD BOM export file identity changed");
  if (before.size !== expectedBytes.byteLength || before.size > CAD_BOM_TRANSFER_MAX_BYTES) {
    throw new Error("CAD BOM export target already exists with different bytes");
  }
  return withFd(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0), fd => {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || !sameIdentity(before, opened)) throw new Error("CAD BOM export file identity changed");
    // A concurrently growing target must not turn a bounded export into an
    // unbounded read. At most the expected bytes plus one are ever allocated/read.
    const bytes = Buffer.alloc(expectedBytes.byteLength + 1);
    let length = 0;
    while (length < bytes.byteLength) {
      const count = fs.readSync(fd, bytes, length, bytes.byteLength - length, null);
      if (count === 0) break;
      length += count;
    }
    const after = fs.fstatSync(fd);
    const located = fs.lstatSync(filename);
    if (!sameIdentity(opened, after) || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs || !located.isFile() || located.isSymbolicLink() ||
        !sameIdentity(located, opened) || located.size !== after.size || located.mtimeMs !== after.mtimeMs || located.ctimeMs !== after.ctimeMs) {
      throw new Error("CAD BOM export file changed during verification");
    }
    if (length !== expectedBytes.byteLength || !bytes.subarray(0, length).equals(Buffer.from(expectedBytes))) {
      throw new Error("CAD BOM export target already exists with different bytes");
    }
    return opened;
  });
}

function existingTarget(filename: string, bytes: Uint8Array): Identity | undefined {
  try { return readRegular(filename, bytes); } catch (error) {
    if (code(error) === "ENOENT") return undefined;
    throw error;
  }
}

function locateTarget(targetPath: string) {
  if (typeof targetPath !== "string" || !path.isAbsolute(targetPath) || targetPath.includes("\0")) {
    throw new Error("CAD BOM export target must be an absolute file path");
  }
  const basename = path.basename(targetPath);
  if (!basename || basename === "." || basename === ".." || targetPath.endsWith(path.sep) || path.normalize(targetPath) !== targetPath) {
    throw new Error("CAD BOM export target basename is unsafe");
  }
  const requestedParent = path.dirname(targetPath);
  const requested = fs.lstatSync(requestedParent);
  if (!requested.isDirectory() || requested.isSymbolicLink()) throw new Error("CAD BOM export parent is unsafe");
  // Resolve OS aliases once (e.g. macOS /var). All IO uses this canonical parent;
  // the selected spelling and directory identity are checked again before link.
  const parent = fs.realpathSync(requestedParent);
  const identity = fs.lstatSync(parent);
  if (!identity.isDirectory() || identity.isSymbolicLink() || !sameIdentity(requested, identity)) {
    throw new Error("CAD BOM export parent identity changed");
  }
  const fd = fs.openSync(parent, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0) | (fs.constants.O_NOFOLLOW ?? 0));
  const assertCurrent = () => {
    const canonical = fs.lstatSync(parent), selected = fs.lstatSync(requestedParent), opened = fs.fstatSync(fd);
    if (!canonical.isDirectory() || canonical.isSymbolicLink() || !selected.isDirectory() || selected.isSymbolicLink() ||
        fs.realpathSync(requestedParent) !== parent || !sameIdentity(canonical, identity) ||
        !sameIdentity(selected, identity) || !sameIdentity(opened, identity)) {
      throw new Error("CAD BOM export parent identity changed");
    }
  };
  try { assertCurrent(); } catch (error) {
    try { fs.closeSync(fd); } catch (closeError) { throw new AggregateError([error, closeError], "CAD BOM export parent setup and close failed"); }
    throw error;
  }
  return { parent, fd, target: path.join(parent, basename), assertCurrent };
}

/**
 * Offline export only. The caller must separately authorize the selected absolute
 * target. No directory is inferred from workspace, and an existing file is never
 * replaced. Directory checks are fail-closed at each boundary; this is not an
 * openat-based sandbox against a hostile actor continuously renaming ancestors.
 */
export async function exportPreparedCadBomTransfer(
  workspace: Workspace,
  prepared: PreparedCadBomTransfer,
  targetPath: string,
  options: CadBomTransferExportOptions = {},
): Promise<CadBomTransferExportReceipt> {
  options.assertActive?.();
  // Authenticate before reading caller-visible getters or doing any export IO.
  // A second full validation below closes the temp-write/source-change window.
  const initial = await revalidateCadBomTransfer(workspace, prepared, trusted => ({
    bytes: Uint8Array.from(trusted.bytes),
  }));
  options.assertActive?.();
  const directory = locateTarget(targetPath);
  let temporaryPath: string | undefined;
  let temporaryIdentity: Identity | undefined;
  let receipt: Omit<CadBomTransferExportReceipt, "warnings"> | undefined;
  let failure: unknown;
  let failed = false;
  const warnings: string[] = [];
  try {
    directory.assertCurrent();
    temporaryPath = path.join(directory.parent, `.cad-bom-export-${randomUUID()}.tmp`);
    const fd = fs.openSync(temporaryPath, "wx", 0o600);
    let writeFailure: unknown;
    let writeFailed = false;
    try {
      temporaryIdentity = fs.fstatSync(fd);
      for (let offset = 0; offset < initial.bytes.byteLength;) {
        const written = fs.writeSync(fd, initial.bytes, offset, initial.bytes.byteLength - offset, null);
        if (!Number.isSafeInteger(written) || written <= 0) throw new Error("CAD BOM export write made no progress");
        offset += written;
      }
      fs.fsyncSync(fd);
    } catch (error) { writeFailed = true; writeFailure = error; }
    try { fs.closeSync(fd); } catch (error) {
      if (writeFailed) throw new AggregateError([writeFailure, error], "CAD BOM export write and close failed");
      throw error;
    }
    if (writeFailed) throw writeFailure;
    runHook(options.testHooks?.beforeRevalidate);
    options.assertActive?.();
    await revalidateCadBomTransfer(workspace, prepared, trusted => {
      if (!Buffer.from(initial.bytes).equals(Buffer.from(trusted.bytes))) throw new Error("CAD BOM export prepared bytes changed");
      directory.assertCurrent(); options.assertActive?.();
      readRegular(temporaryPath!, trusted.bytes, temporaryIdentity);
      const existing = existingTarget(directory.target, trusted.bytes);
      runHook(options.testHooks?.beforeLink);
      directory.assertCurrent(); options.assertActive?.();
      readRegular(temporaryPath!, trusted.bytes, temporaryIdentity);
      if (existing) readRegular(directory.target, trusted.bytes, existing);
      options.assertActive?.();
      trusted.assertCurrent();
      if (!existing) fs.linkSync(temporaryPath!, directory.target); // Atomic no-replace; EEXIST is never converted into overwrite.
      receipt = {
        status: existing ? "existing" : "created", targetPath: directory.target,
        transferId: trusted.envelope.transferId, payloadHash: trusted.envelope.payloadHash,
        bytes: trusted.bytes.byteLength, directorySync: "failed",
      };
      try { fs.fsyncSync(directory.fd); receipt = { ...receipt, directorySync: "synced" }; }
      catch (error) { warnings.push(`File is ${receipt.status}, but directory sync failed: ${message(error)}`); }
    });
  } catch (error) { failed = true; failure = error; }
  // Cleanup is ownership-checked; never remove a replacement file or follow a
  // replaced directory. Publication receipts survive cleanup/lease-close errors.
  if (temporaryPath && temporaryIdentity) {
    try {
      directory.assertCurrent();
      let current: fs.Stats | undefined;
      try { current = fs.lstatSync(temporaryPath); } catch (error) { if (code(error) !== "ENOENT") throw error; }
      if (current) {
        if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(current, temporaryIdentity)) {
          throw new Error("CAD BOM export temporary file identity changed; replacement was not removed");
        }
        fs.unlinkSync(temporaryPath);
      }
    } catch (error) {
      if (receipt) warnings.push(`File is ${receipt.status}, but temporary cleanup failed: ${message(error)}`);
      else if (failed) failure = new AggregateError([failure, error], "CAD BOM export and temporary cleanup failed");
      else { failed = true; failure = error; }
    }
  } else if (temporaryPath) {
    // An open/fstat failure means ownership cannot safely be proven. Do not
    // remove an arbitrary collision/replacement just because its name matches.
    try {
      if (fs.existsSync(temporaryPath)) {
        throw new Error("CAD BOM export could not prove temporary ownership; file was not removed");
      }
    } catch (error) {
      if (failed) failure = new AggregateError([failure, error], "CAD BOM export and temporary ownership failed");
      else { failed = true; failure = error; }
    }
  }
  try { fs.closeSync(directory.fd); } catch (error) {
    if (receipt) warnings.push(`File is ${receipt.status}, but directory close failed: ${message(error)}`);
    else if (failed) failure = new AggregateError([failure, error], "CAD BOM export and directory close failed");
    else { failed = true; failure = error; }
  }
  if (receipt) {
    if (failed) warnings.push(`File is ${receipt.status}, but source lease cleanup failed: ${message(failure)}`);
    return Object.freeze({ ...receipt, warnings: Object.freeze(warnings) });
  }
  if (failed) throw failure;
  throw new Error("CAD BOM export did not publish a receipt");
}
