import { CAA_NLS_LOCALE_SIMPLIFIED_CHINESE, parseCatNls } from "@desk-tools/catdlg-core";
import type { CaaDialogIr } from "../types/caaDialogIr";
import { nlsFlatMapsEqual } from "../utils/caaDialogTree";

export type CaaNlsFlat = Record<string, string>;
export type CaaNlsLocaleFlats = Record<string, CaaNlsFlat>;

/**
 * UI-neutral NLS session value. The Page deliberately keeps the six matching
 * refs; this object only projects immutable transition results into them.
 */
export interface CaaDialogNlsSessionValue {
  readonly baselineNlsFlat: CaaNlsFlat;
  readonly currentNlsFlat: CaaNlsFlat;
  readonly nlsSourceText: string;
  readonly localeNlsFlats: CaaNlsLocaleFlats;
  readonly localeBaselineFlats: CaaNlsLocaleFlats;
  readonly localeSourceTexts: Record<string, string>;
}

export interface CaaDialogNlsDraftInput {
  readonly nlsFlat?: Readonly<CaaNlsFlat>;
  readonly nlsSourceText?: string;
  readonly localeNlsFlats?: Readonly<Record<string, Readonly<CaaNlsFlat>>>;
  readonly localeSourceTexts?: Readonly<Record<string, string>>;
}

export interface CaaDialogNlsSnapshotOverlay {
  readonly currentNlsFlat?: Readonly<CaaNlsFlat>;
  readonly nlsSourceText?: string;
  readonly localeNlsFlats?: Readonly<Record<string, Readonly<CaaNlsFlat>>>;
}

export interface CaaNlsKeyCountMismatch {
  readonly en: number;
  readonly cn: number;
  readonly missingInCn: string[];
  readonly missingInEn: string[];
}

function cloneFlat(flat: Readonly<CaaNlsFlat> | undefined): CaaNlsFlat {
  return { ...(flat ?? {}) };
}

function cloneLocaleFlats(
  locales: Readonly<Record<string, Readonly<CaaNlsFlat>>> | undefined,
): CaaNlsLocaleFlats {
  const cloned: CaaNlsLocaleFlats = {};
  for (const [id, flat] of Object.entries(locales ?? {})) {
    cloned[id] = cloneFlat(flat);
  }
  return cloned;
}

export function buildCaaDialogNlsSessionFromIr(ir: CaaDialogIr): CaaDialogNlsSessionValue {
  const source = ir.parseMeta?.catNlsSourceText ?? "";
  const flat = source ? parseCatNls(source) : {};
  const localeNlsFlats: CaaNlsLocaleFlats = {};
  const localeBaselineFlats: CaaNlsLocaleFlats = {};
  const localeSourceTexts: Record<string, string> = {};
  const metaTexts = ir.parseMeta?.localeNlsSourceTexts ?? {};

  for (const locale of ir.parseMeta?.locales ?? []) {
    if (locale.id === "default") continue;
    const localeSource = locale.sourceText ?? metaTexts[locale.id] ?? "";
    if (!localeSource) continue;
    const parsed = parseCatNls(localeSource);
    localeNlsFlats[locale.id] = cloneFlat(parsed);
    localeBaselineFlats[locale.id] = cloneFlat(parsed);
    localeSourceTexts[locale.id] = localeSource;
  }

  for (const [id, parsed] of Object.entries(ir.localeNls ?? {})) {
    if (!localeNlsFlats[id] && Object.keys(parsed).length) {
      localeNlsFlats[id] = cloneFlat(parsed);
      localeBaselineFlats[id] = cloneFlat(parsed);
    }
  }

  return {
    baselineNlsFlat: cloneFlat(flat),
    currentNlsFlat: cloneFlat(flat),
    nlsSourceText: source,
    localeNlsFlats,
    localeBaselineFlats,
    localeSourceTexts,
  };
}

export function buildCaaDialogNlsSessionFromDraft(
  input: CaaDialogNlsDraftInput = {},
): CaaDialogNlsSessionValue {
  const currentNlsFlat = cloneFlat(input.nlsFlat);
  const localeNlsFlats = cloneLocaleFlats(input.localeNlsFlats);
  return {
    baselineNlsFlat: cloneFlat(currentNlsFlat),
    currentNlsFlat,
    nlsSourceText: input.nlsSourceText ?? "",
    localeNlsFlats,
    localeBaselineFlats: cloneLocaleFlats(localeNlsFlats),
    localeSourceTexts: { ...(input.localeSourceTexts ?? {}) },
  };
}

/**
 * Restores current edits without moving the parsed/draft baseline. Locale maps
 * are merged because older snapshots may only contain the locales edited in
 * that browser session.
 */
export function overlayCaaDialogNlsSnapshot(
  base: CaaDialogNlsSessionValue,
  overlay: CaaDialogNlsSnapshotOverlay,
): CaaDialogNlsSessionValue {
  return {
    baselineNlsFlat: cloneFlat(base.baselineNlsFlat),
    currentNlsFlat: overlay.currentNlsFlat
      ? cloneFlat(overlay.currentNlsFlat)
      : cloneFlat(base.currentNlsFlat),
    nlsSourceText: overlay.nlsSourceText ?? base.nlsSourceText,
    localeNlsFlats: {
      ...cloneLocaleFlats(base.localeNlsFlats),
      ...cloneLocaleFlats(overlay.localeNlsFlats),
    },
    localeBaselineFlats: cloneLocaleFlats(base.localeBaselineFlats),
    localeSourceTexts: { ...base.localeSourceTexts },
  };
}

/**
 * The locale API creates the file first. Its disk values remain the baseline,
 * while the editable map is seeded from the current English values.
 */
export function addCaaDialogNlsLocale(
  base: CaaDialogNlsSessionValue,
  input: {
    readonly localeId: string;
    readonly diskNlsFlat: Readonly<CaaNlsFlat>;
    readonly sourceText: string;
  },
): CaaDialogNlsSessionValue {
  const current: CaaNlsFlat = {};
  for (const key of Object.keys(input.diskNlsFlat)) {
    current[key] = base.currentNlsFlat[key] ?? "";
  }
  return {
    baselineNlsFlat: cloneFlat(base.baselineNlsFlat),
    currentNlsFlat: cloneFlat(base.currentNlsFlat),
    nlsSourceText: base.nlsSourceText,
    localeNlsFlats: {
      ...cloneLocaleFlats(base.localeNlsFlats),
      [input.localeId]: current,
    },
    localeBaselineFlats: {
      ...cloneLocaleFlats(base.localeBaselineFlats),
      [input.localeId]: cloneFlat(input.diskNlsFlat),
    },
    localeSourceTexts: {
      ...base.localeSourceTexts,
      [input.localeId]: input.sourceText,
    },
  };
}

export function isCaaDialogNlsFlatDirty(
  baseline: Readonly<CaaNlsFlat>,
  current: Readonly<CaaNlsFlat>,
): boolean {
  return !nlsFlatMapsEqual(baseline as CaaNlsFlat, current as CaaNlsFlat);
}

export function isCaaDialogNlsSessionDirty(session: CaaDialogNlsSessionValue): boolean {
  if (isCaaDialogNlsFlatDirty(session.baselineNlsFlat, session.currentNlsFlat)) {
    return true;
  }
  for (const [id, current] of Object.entries(session.localeNlsFlats)) {
    if (isCaaDialogNlsFlatDirty(session.localeBaselineFlats[id] ?? {}, current)) {
      return true;
    }
  }
  return false;
}

export function projectCaaNlsKeyCountMismatch(input: {
  readonly hasChineseLocale: boolean;
  readonly currentNlsFlat: Readonly<CaaNlsFlat>;
  readonly localeNlsFlats: Readonly<Record<string, Readonly<CaaNlsFlat>>>;
}): CaaNlsKeyCountMismatch | null {
  if (!input.hasChineseLocale) return null;
  const enKeys = Object.keys(input.currentNlsFlat);
  const cnKeys = Object.keys(
    input.localeNlsFlats[CAA_NLS_LOCALE_SIMPLIFIED_CHINESE] ?? {},
  );

  // Characterized current behavior: equal counts do not compare key identity.
  if (enKeys.length === cnKeys.length) return null;

  const cnKeySet = new Set(cnKeys);
  const enKeySet = new Set(enKeys);
  return {
    en: enKeys.length,
    cn: cnKeys.length,
    missingInCn: enKeys.filter((key) => !cnKeySet.has(key)),
    missingInEn: cnKeys.filter((key) => !enKeySet.has(key)),
  };
}
