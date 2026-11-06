/**
 * Deterministic report fingerprint (for on-chain anchoring in Phase 8), shared by server and browser.
 *
 * Canonical JSON: object keys sorted (UTF-16 code-unit order), no whitespace, strings JSON-escaped,
 * decimal strings kept exactly as they are, arrays in order, undefined values omitted (as JSON does).
 * Hash: SHA-256 (Web Crypto, available in Node >= 20 and browsers), lowercase hex.
 *
 * Excluded from the fingerprint:
 *  - personal fields: `personal` (taxpayer name, TIN, state of residence), `tax.otherIncomeNgn` and the raw
 *    relief amounts `tax.reliefs.inputs` (the allowed amounts and relief totals are computed, so covered);
 *  - volatile delivery metadata that does not change the computation: `generatedAt`, `origin`;
 *  - the `fingerprint` field itself.
 */

export const FINGERPRINT_EXCLUDED_PATHS = ["fingerprint", "generatedAt", "origin", "personal", "tax.otherIncomeNgn", "tax.reliefs.inputs"] as const;

const EXCLUDED = new Set<string>(FINGERPRINT_EXCLUDED_PATHS);

function canonical(value: unknown, path: string): string | undefined {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return undefined;
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Non-finite number at ${path || "(root)"}`);
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") throw new Error(`BigInt at ${path || "(root)"}: serialise as a decimal string first`);
  if (Array.isArray(value)) return `[${value.map((v, i) => canonical(v, `${path}[${i}]`) ?? "null").join(",")}]`;
  const obj = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(obj).sort()) {
    const childPath = path ? `${path}.${key}` : key;
    if (EXCLUDED.has(childPath)) continue;
    const c = canonical(obj[key], childPath);
    if (c !== undefined) parts.push(`${JSON.stringify(key)}:${c}`);
  }
  return `{${parts.join(",")}}`;
}

/** Canonical JSON of a report with the excluded paths removed. */
export function canonicalReportJson(report: unknown): string {
  return canonical(report, "") ?? "null";
}

export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto (crypto.subtle) is unavailable; a secure context (https or localhost) is required");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function reportFingerprint(report: unknown): Promise<string> {
  return sha256Hex(canonicalReportJson(report));
}
