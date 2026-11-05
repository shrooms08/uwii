/**
 * User-supplied source leg of a NEAR Intents swap (the asset given up inside Intents, which is not
 * visible on-chain). Pure validation, safe to import in the browser.
 */
import { isValidAccountId } from "../../near/account-id";
import type { UserSourceLeg } from "./types";

/** Input as entered: timestamp optional (defaults to the receipt time). */
export interface SourceLegInput {
  asset: { symbol: string; contract: string | null };
  quantity: string;
  timestamp?: string;
}

/** Positive exact decimal (no sign, no exponent, no separators). */
export const QUANTITY_RE = /^\d{1,30}(\.\d{1,40})?$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

export function isPositiveQuantity(q: string): boolean {
  return QUANTITY_RE.test(q) && /[1-9]/.test(q);
}

/**
 * Validate and normalise against the receipt it belongs to. The disposal must happen in the receipt's
 * calendar year and not after the receipt (you give up the asset, then receive the other one).
 */
export function normalizeSourceLeg(input: SourceLegInput, receiptTimestamp: string): { ok: true; leg: UserSourceLeg } | { ok: false; error: string } {
  const symbol = input.asset.symbol.trim();
  const contract = input.asset.contract === null ? null : input.asset.contract.trim().toLowerCase();
  if (!symbol || symbol.length > 64) return { ok: false, error: "asset symbol is required (max 64 characters)" };
  if (contract !== null && !isValidAccountId(contract)) return { ok: false, error: `"${contract}" is not a valid token contract account id` };
  const quantity = input.quantity.trim();
  if (!isPositiveQuantity(quantity)) return { ok: false, error: "quantity must be a positive decimal number" };
  const raw = input.timestamp?.trim() || receiptTimestamp;
  if (!ISO_RE.test(raw) || Number.isNaN(Date.parse(raw))) return { ok: false, error: `"${raw}" is not an ISO date-time` };
  const timestamp = new Date(raw).toISOString();
  if (timestamp > receiptTimestamp) return { ok: false, error: "the source leg cannot be after the asset was received" };
  if (timestamp.slice(0, 4) !== receiptTimestamp.slice(0, 4)) return { ok: false, error: `the source leg must be in ${receiptTimestamp.slice(0, 4)}, the year it was received` };
  return { ok: true, leg: { asset: { symbol, contract: contract === "" ? null : contract }, quantity, timestamp } };
}

export const USER_SOURCE_LEG_NOTE = "source leg provided by user (inside NEAR Intents, not visible on-chain)";
export const USER_SOURCE_LEG_REF = "9.1.2; 9.3.2; Illustration 3";
