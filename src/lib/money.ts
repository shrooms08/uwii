/**
 * Arbitrary-precision decimal arithmetic for prices, FX rates and USD/NGN values (decimal.js).
 *
 * Why decimal.js: tax values need non-integer division (NGN / rate, qty x price) whose results do not
 * terminate (e.g. 1,970,000 / 1,500). BigInt is integer-only; JavaScript numbers are binary floats and
 * must never hold amounts. decimal.js gives exact decimal representation with explicit precision and
 * rounding, and has no dependencies.
 *
 * Precision is 100 significant digits internally; NGN is rounded to 2 dp only at presentation.
 */
import Decimal from "decimal.js";

export const Dec = Decimal.clone({ precision: 100, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -60, toExpPos: 60 });
export type Dec = InstanceType<typeof Dec>;

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/** Parse an exact decimal string. Never accepts JavaScript numbers. */
export function dec(value: string | Dec): Dec {
  if (value instanceof Dec) return value;
  if (typeof value !== "string" || !DECIMAL_RE.test(value.trim())) throw new Error(`Expected a decimal string, got ${JSON.stringify(value)}`);
  return new Dec(value.trim());
}

export const ZERO_D = new Dec(0);

export function sum(values: Dec[]): Dec {
  return values.reduce((a, b) => a.plus(b), ZERO_D);
}

/** Full-precision string (no exponent). */
export const full = (d: Dec): string => d.toFixed();

/** Presentation rounding: 2 dp, half-up. Use only at the edge (report lines, totals, UI). */
export const money2 = (d: Dec): string => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

/**
 * JSON.parse that keeps every JSON number as its exact source text (string), so a price such as
 * 1.5124648365738596 is never converted to a binary float. Requires JSON.parse source-text access (Node >= 21).
 */
export function parseJsonExact<T = unknown>(text: string): T {
  return JSON.parse(text, (_key, value, context?: { source?: string }) =>
    typeof value === "number" && context?.source !== undefined ? context.source : value,
  ) as T;
}
