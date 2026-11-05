/** NEAR account id validation, safe to import in the browser (no Node or network dependencies). */

const ACCOUNT_ID_RE = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export function isValidAccountId(id: string): boolean {
  return ACCOUNT_ID_RE.test(id);
}

/** Implicit (64 hex) accounts shortened as 52435fe9…62c8d; named accounts unchanged. */
export function shortParty(a: string | null): string {
  if (a === null) return "unknown account";
  return /^[0-9a-f]{64}$/.test(a) ? `${a.slice(0, 8)}…${a.slice(-4)}` : a;
}

/** Split a comma / whitespace / newline separated list into normalised account ids. */
export function parseAccountList(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
}
