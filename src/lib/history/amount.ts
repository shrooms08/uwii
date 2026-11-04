/**
 * Exact integer <-> decimal string conversion using BigInt only.
 * No JavaScript floating point is ever used for token amounts.
 */

export const ZERO = BigInt(0);
export const NS_PER_MS = BigInt(1_000_000);

const INTEGER_RE = /^-?\d+$/;

/** Parse a base-unit integer string (e.g. yoctoNEAR) into a BigInt. Throws on anything else. */
export function parseUnits(value: unknown, what = "amount"): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value !== "string" || !INTEGER_RE.test(value)) {
    throw new Error(`Expected integer string for ${what}, got ${JSON.stringify(value)}`);
  }
  return BigInt(value);
}

/** Format a base-unit integer as an exact decimal string with trailing zeros trimmed. */
export function formatUnits(value: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) throw new Error(`Invalid decimals: ${decimals}`);
  const negative = value < ZERO;
  const abs = negative ? -value : value;
  if (decimals === 0) return `${negative ? "-" : ""}${abs.toString()}`;
  const digits = abs.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function absBig(value: bigint): bigint {
  return value < ZERO ? -value : value;
}
