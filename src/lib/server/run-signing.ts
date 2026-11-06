/**
 * Signed classification runs. /api/scan returns the run to the browser with
 * runSig = HMAC-SHA256(UWII_RUN_SECRET, canonical JSON of the run), hex. The browser keeps it and sends
 * it back with every questions/report/anchor request, so any server instance can use it without a
 * shared cache, and no user's request can change another user's run. The server accepts a run only
 * when the signature verifies (timing-safe) and the run belongs to the requested account.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "../report/fingerprint";
import { CLASSIFIED_SCHEMA_VERSION, type ClassifiedRun } from "../tax/ng/types";

/** Shortest accepted secret (characters). */
export const RUN_SECRET_MIN_LENGTH = 32;
export const RUN_SIG_RE = /^[0-9a-f]{64}$/;

/** UWII_RUN_SECRET, or null when unset or too short (live scans are then refused with 503). */
export function runSecret(env: Record<string, string | undefined> = process.env): string | null {
  const s = env.UWII_RUN_SECRET?.trim();
  return s && s.length >= RUN_SECRET_MIN_LENGTH ? s : null;
}

export function signRun(run: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canonicalJson(run)).digest("hex");
}

export function verifyRunSignature(run: unknown, sig: string, secret: string): boolean {
  if (!RUN_SIG_RE.test(sig)) return false;
  const expected = Buffer.from(signRun(run, secret), "hex");
  const given = Buffer.from(sig, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The run as sent to the browser: the raw indexer rows are dropped (nothing after classification reads them). */
export function slimRun(run: ClassifiedRun): ClassifiedRun {
  return { ...run, records: run.records.map((r) => ({ ...r, raw: null })) };
}

/** Scheme and host of an RPC URL only: never a path, query or credentials (N2). */
export function urlOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "(unparseable URL)";
  }
}

export type RunCheck = { ok: true; run: ClassifiedRun } | { ok: false; status: 400 | 503; code: string; error: string };

/** Verifies a run sent back by the browser for `account`. */
export function checkSignedRun(account: string, run: unknown, sig: unknown, secret: string | null): RunCheck {
  if (!secret) return { ok: false, status: 503, code: "scans_not_configured", error: "Live scans are not configured on this server. Load the cached demo instead." };
  if (typeof sig !== "string" || !RUN_SIG_RE.test(sig) || !run || typeof run !== "object") {
    return { ok: false, status: 400, code: "bad_run", error: "The saved scan is incomplete. Scan the account again." };
  }
  if (!verifyRunSignature(run, sig, secret)) {
    return { ok: false, status: 400, code: "bad_run_signature", error: "The saved scan was changed or comes from another server. Scan the account again." };
  }
  const r = run as ClassifiedRun;
  if (r.accountId !== account) return { ok: false, status: 400, code: "run_account_mismatch", error: "The saved scan belongs to a different account." };
  if (r.schemaVersion !== CLASSIFIED_SCHEMA_VERSION) return { ok: false, status: 400, code: "bad_run", error: "The saved scan is from an older version of Uwii. Scan the account again." };
  return { ok: true, run: r };
}
