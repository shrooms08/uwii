/**
 * On-chain strings are attacker-controlled: anyone can send any account a token whose metadata says
 * anything. Every such string is reduced to a safe form before it reaches the AI prompt, the UI, the
 * PDF or the CSV (audit finding M2).
 */

const SYMBOL_RE = /^[A-Za-z0-9._-]{1,16}$/;

/** Token symbol: up to 16 characters of [A-Za-z0-9._-], else "TOKEN". */
export function sanitizeSymbol(symbol: unknown): string {
  const s = typeof symbol === "string" ? symbol.trim() : "";
  return SYMBOL_RE.test(s) ? s : "TOKEN";
}

/** One contract method name: [A-Za-z0-9_] only, at most 48 characters; null when nothing is left. */
export function sanitizeMethodName(name: unknown): string | null {
  const s = typeof name === "string" ? name.replace(/[^A-Za-z0-9_]/g, "").slice(0, 48) : "";
  return s || null;
}

/** A comma-joined list of method names (as records store them), each sanitised; null when empty. */
export function sanitizeMethodList(list: string | null | undefined): string | null {
  if (!list) return null;
  const names = [...new Set(list.split(",").map(sanitizeMethodName).filter((m): m is string => m !== null))];
  return names.length ? names.join(",") : null;
}

// C0/C1 controls, zero-width characters and bidirectional overrides.
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]+/g;

/** Free text (memos, model reasons): control characters removed, whitespace collapsed, truncated. */
export function sanitizeFreeText(text: unknown, max = 120): string {
  const s = typeof text === "string" ? text.replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim() : "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
