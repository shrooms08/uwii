/**
 * Browser-only persistence. Own accounts, answers and the profile live in localStorage under the same
 * key /dev/questions uses, and are sent only in request bodies; the server never stores them.
 */
import type { GroupAnswer } from "@/lib/tax/ng/questions";
import type { ReliefInputKey } from "@/lib/tax/ng/reliefs";

export interface Saved {
  /** Other accounts the user owns, comma / whitespace / newline separated. */
  ownText: string;
  groups: Record<string, GroupAnswer>;
  /** Other taxable income in 2026 (NGN), as typed. */
  otherIncomeNgn: string;
  /** Reliefs and deductions (NTA 2025 s.30), as typed, keyed by input. */
  reliefs?: Partial<Record<ReliefInputKey, string>>;
}

export const EMPTY_SAVED: Saved = { ownText: "", groups: {}, otherIncomeNgn: "" };

const answersKey = (account: string) => `uwii:answers:${account}`;
const demoKey = (account: string) => `uwii:demo:${account}`;
export const DEMO_EVENT = "uwii:demo-change";

export function loadSaved(account: string): Saved {
  try {
    const raw = window.localStorage.getItem(answersKey(account));
    return raw ? { ...EMPTY_SAVED, ...(JSON.parse(raw) as Partial<Saved>) } : EMPTY_SAVED;
  } catch {
    return EMPTY_SAVED;
  }
}

export function storeSaved(account: string, saved: Saved): void {
  try {
    window.localStorage.setItem(answersKey(account), JSON.stringify(saved));
  } catch {
    // storage unavailable (private mode): answers still work for this visit
  }
}

export function isDemoPresetOn(account: string): boolean {
  try {
    return window.localStorage.getItem(demoKey(account)) === "1";
  } catch {
    return false;
  }
}

export function setDemoPreset(account: string, on: boolean): void {
  try {
    if (on) window.localStorage.setItem(demoKey(account), "1");
    else window.localStorage.removeItem(demoKey(account));
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(DEMO_EVENT, { detail: { account, on } }));
}

/** "4,800,000" or "4 800 000.50" -> "4800000.50"; separators are display-only. */
export const stripNgn = (s: string) => s.replace(/[\s,]/g, "");
/** Same rule the server applies (questions.ts NGN_RE): digits with up to 2 decimal places. */
export const NGN_INPUT_RE = /^\d{1,15}(\.\d{1,2})?$/;

/** A NEAR testnet anchor returned by /api/anchor or /api/verify, kept per fingerprint in this browser. */
export interface StoredAnchor {
  fingerprint: string;
  status: string;
  network: string;
  contractId: string;
  anchoredBy: string;
  blockHeight: string;
  anchoredAt: string;
  txHash: string | null;
  explorerUrl: string | null;
  blockUrl: string;
}

const anchorKey = (fingerprint: string) => `uwii:anchor:${fingerprint}`;

export function loadAnchor(fingerprint: string): StoredAnchor | null {
  try {
    const raw = window.localStorage.getItem(anchorKey(fingerprint));
    const a = raw ? (JSON.parse(raw) as StoredAnchor) : null;
    return a && a.fingerprint === fingerprint ? a : null;
  } catch {
    return null;
  }
}

export function storeAnchor(anchor: StoredAnchor): void {
  try {
    window.localStorage.setItem(anchorKey(anchor.fingerprint), JSON.stringify(anchor));
  } catch {
    // storage unavailable
  }
}

/**
 * "Cached demo result" mode for an account: the committed classified fixture is used instead of a live
 * scan (set when the hosted demo is busy). Cleared when a live scan completes.
 */
export interface CachedSource {
  source: "fixture";
  /** Attestation time recorded in the committed run. */
  recordedAt: string;
}

const sourceKey = (account: string) => `uwii:source:${account}`;
export const SOURCE_EVENT = "uwii:source-change";

export function loadSource(account: string): CachedSource | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(sourceKey(account));
    const v = raw ? (JSON.parse(raw) as CachedSource) : null;
    return v && v.source === "fixture" ? v : null;
  } catch {
    return null;
  }
}

export function setSource(account: string, value: CachedSource | null): void {
  try {
    if (value) window.localStorage.setItem(sourceKey(account), JSON.stringify(value));
    else window.localStorage.removeItem(sourceKey(account));
  } catch {
    // storage unavailable
  }
  window.dispatchEvent(new CustomEvent(SOURCE_EVENT, { detail: { account } }));
}
