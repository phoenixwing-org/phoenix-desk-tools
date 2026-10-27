import type {
  CadNameIdentity,
  CompanionDiagnostic,
  CompanionNameProposal,
  CompanionPurpose,
} from './contracts.js';

const PURPOSE_LABELS = {
  model_notes: '模型说明',
  drawing_notes: '出图说明',
  development_doc: '开发文档',
} as const;
const KNOWN_VARIANTS = new Set(['P', 'P1', 'P2']);
const UNSAFE_CHARACTERS = /[<>:"/\\|?*\p{Cc}\p{Cf}\p{Cs}]/u;
const RESERVED_BASENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const MAX_FILENAME_BYTES = 255;
const MAX_DRAFT_SEQUENCE = 9999;

export type ParsedCompanionFilename = {
  purpose: CompanionPurpose;
  naming: 'purpose_v1' | 'drawing_ai' | 'bare';
  identity: CadNameIdentity;
};

export type CompanionFilenameOptions = { name?: string; draftSequence?: number };

function isBasename(value: string): boolean {
  return value.length > 0 && value !== '.' && value !== '..' && !UNSAFE_CHARACTERS.test(value);
}

function validDraftSequence(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_DRAFT_SEQUENCE;
}

/** Check an output basename without changing its spelling or normalization. */
function filenameDiagnostics(filename: string): CompanionDiagnostic[] {
  const diagnostics: CompanionDiagnostic[] = [];
  if (!isBasename(filename) || /[. ]$/u.test(filename) || RESERVED_BASENAME.test(filename)) {
    diagnostics.push({ code: 'unsafe_filename', message: '新文件名必须是安全的单个 basename，不能包含路径、控制字符或保留名称。' });
  }
  if (filename !== filename.normalize('NFC')) {
    diagnostics.push({ code: 'non_nfc_filename', message: '新文件名必须已经是 Unicode NFC；请显式核对名称，不能自动改写原名。' });
  }
  if (new TextEncoder().encode(filename).byteLength > MAX_FILENAME_BYTES) {
    diagnostics.push({ code: 'filename_too_long', message: '新文件名超过 255 UTF-8 字节。' });
  }
  return diagnostics;
}

function parseStem(
  displayFilename: string,
  rawStem: string,
  role: CadNameIdentity['role'],
  allowUnknownRole = false,
  allowDraftSequence = role === 'drawing',
): CadNameIdentity {
  const identity: CadNameIdentity = {
    number: null,
    revisionRaw: null,
    revision: null,
    variantRaw: null,
    variantStatus: 'none',
    name: rawStem,
    rawStem,
    displayFilename,
    role,
    draftSequence: role === 'drawing' ? 1 : null,
    parseStatus: 'manual',
  };
  let stem = rawStem;
  let validDraft = true;
  const draft = /-初稿([^\-]*)$/u.exec(stem);
  if (draft) {
    if (!allowDraftSequence) {
      // A model's real name (or an unassigned bare note) must not silently
      // become a different name plus a Drawing-specific sequence.
      validDraft = false;
      identity.draftSequence = null;
    } else {
      stem = stem.slice(0, draft.index);
      const digits = draft[1];
      const sequence = /^[0-9]+$/u.test(digits) ? Number(digits) : Number.NaN;
      validDraft = validDraftSequence(sequence) && sequence >= 2 && String(sequence).padStart(2, '0') === digits;
      identity.draftSequence = Number.isSafeInteger(sequence) ? sequence : null;
    }
  }
  // The optional variant must begin with an ASCII letter. In particular 0007
  // must not be silently split into revision 000 and a numeric variant 7.
  const match = /^([A-Za-z0-9_]+)\.([0-9]{3})([A-Za-z][A-Za-z0-9]*)?-(.+)$/u.exec(stem);
  if (!match) return identity;
  const [, number, revision, variant, name] = match;
  identity.number = number;
  identity.revision = revision;
  identity.variantRaw = variant ?? null;
  identity.revisionRaw = revision + (variant ?? '');
  identity.variantStatus = variant ? (KNOWN_VARIANTS.has(variant) ? 'known' : 'unknown') : 'none';
  identity.name = name;
  if (
    isBasename(displayFilename)
    && name.trim().length > 0
    && validDraft
    && identity.variantStatus !== 'unknown'
    && (role !== 'unknown' || allowUnknownRole)
  ) identity.parseStatus = 'parsed';
  return identity;
}

/** Parse only a display basename; never strip a path or rewrite the original. */
export function parseCadIdentity(displayFilename: string): CadNameIdentity {
  const suffixes = [
    { suffix: '.Drawing.FCStd', role: 'drawing' },
    { suffix: '.ASSY.FCStd', role: 'assembly' },
    { suffix: '.FCStd', role: 'model' },
  ] as const;
  for (const { suffix, role } of suffixes) {
    if (displayFilename.toLowerCase().endsWith(suffix.toLowerCase())) {
      return parseStem(displayFilename, displayFilename.slice(0, -suffix.length), role);
    }
  }
  return parseStem(displayFilename, displayFilename, 'unknown');
}

/**
 * Parse bounded-discovery candidate names. Bare Markdown deliberately keeps an
 * unknown purpose; a caller needs an explicit alias to assign one.
 */
export function parseCompanionFilename(displayFilename: string): ParsedCompanionFilename | null {
  if (!displayFilename.toLowerCase().endsWith('.md')) return null;
  const withoutExtension = displayFilename.slice(0, -3);
  for (const [purpose, label] of Object.entries(PURPOSE_LABELS)) {
    const suffix = `-${label}`;
    if (withoutExtension.endsWith(suffix)) {
      const role = purpose === 'model_notes' ? 'model' : purpose === 'drawing_notes' ? 'drawing' : 'unknown';
      return {
        purpose: purpose as Exclude<CompanionPurpose, 'unknown'>,
        naming: 'purpose_v1',
        identity: parseStem(displayFilename, withoutExtension.slice(0, -suffix.length), role, true),
      };
    }
  }
  const legacySuffix = '.Drawing.ai';
  if (withoutExtension.toLowerCase().endsWith(legacySuffix.toLowerCase())) {
    return {
      purpose: 'drawing_notes',
      naming: 'drawing_ai',
      identity: parseStem(displayFilename, withoutExtension.slice(0, -legacySuffix.length), 'drawing', true),
    };
  }
  // A bare sidecar may retain a known CAD role suffix, but never a purpose.
  const cad = parseCadIdentity(`${withoutExtension}.FCStd`);
  return {
    purpose: 'unknown',
    naming: 'bare',
    identity: parseStem(displayFilename, cad.rawStem, cad.role === 'model' ? 'unknown' : cad.role, true, false),
  };
}

/** Compare the exact base identity only. Callers must separately check drafts. */
export function sameCadBindingIdentity(left: CadNameIdentity, right: CadNameIdentity): boolean {
  return left.parseStatus === 'parsed'
    && right.parseStatus === 'parsed'
    && left.variantStatus !== 'unknown'
    && right.variantStatus !== 'unknown'
    && left.number !== null
    && left.revisionRaw !== null
    && left.number === right.number
    && left.revisionRaw === right.revisionRaw
    && left.revision === right.revision
    && left.variantRaw === right.variantRaw
    && left.name === right.name;
}

/** Propose a new purpose-labelled basename; this never grants write authority. */
export function proposeCompanionFilename(
  identity: CadNameIdentity,
  purpose: CompanionPurpose,
  options: CompanionFilenameOptions = {},
): CompanionNameProposal {
  const manual = (code: string, message: string): CompanionNameProposal => ({
    status: 'manual', filename: null, diagnostics: [{ code, message }],
  });
  if (identity.parseStatus !== 'parsed' || identity.variantStatus === 'unknown') {
    return manual('manual_identity', '原名称身份需人工确认，不能生成猜测的新名称。');
  }
  const variant = identity.variantRaw ?? '';
  if (
    !identity.number || !/^[A-Za-z0-9_]+$/u.test(identity.number)
    || !identity.revision || !/^[0-9]{3}$/u.test(identity.revision)
    || (variant !== '' && !KNOWN_VARIANTS.has(variant))
    || identity.revisionRaw !== identity.revision + variant
  ) return manual('invalid_identity', '图号、三位版本与 variant 身份不一致，需人工确认。');
  if (purpose === 'unknown' || !Object.hasOwn(PURPOSE_LABELS, purpose)) {
    return manual('unknown_purpose', '未明确伴随文档用途，不能推断输出后缀。');
  }
  const draftSequence = options.draftSequence ?? identity.draftSequence ?? 1;
  if (!validDraftSequence(draftSequence)) {
    return manual('invalid_draft_sequence', '初稿序号必须是 1 至 9999 的整数。');
  }
  if (
    options.draftSequence !== undefined
    && identity.draftSequence !== null
    && identity.draftSequence > 1
    && options.draftSequence !== identity.draftSequence
  ) return manual('draft_sequence_conflict', '已有初稿身份与请求序号冲突，不能改绑为另一初稿。');
  const name = options.name ?? identity.name;
  if (!name.trim() || /-初稿[^\-]*$/u.test(name)) {
    return manual('ambiguous_name', '名称不能为空或与保留的初稿序号后缀混同。');
  }
  const draftSuffix = draftSequence === 1 ? '' : `-初稿${String(draftSequence).padStart(2, '0')}`;
  const filename = `${identity.number}.${identity.revisionRaw}-${name}${draftSuffix}-${PURPOSE_LABELS[purpose]}.md`;
  const diagnostics = filenameDiagnostics(filename);
  return diagnostics.length
    ? { status: 'manual', filename: null, diagnostics }
    : { status: 'ready', filename, diagnostics: [] };
}
