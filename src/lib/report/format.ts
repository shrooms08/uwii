/** Presentation-only formatting of exact decimal strings (no floating point). Shared by page and PDF. */
import { Dec, dec } from "../money";

const groups = (whole: string) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** NGN: 2 dp, half-up, thousands separators. "-" for missing. */
export function fmtNgn(v: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "-";
  const s = dec(v).toDecimalPlaces(2, Dec.ROUND_HALF_UP).toFixed(2);
  const neg = s.startsWith("-");
  const [w, f] = (neg ? s.slice(1) : s).split(".");
  const out = `${groups(w)}.${f}`;
  return neg && out !== "0.00" ? `-${out}` : out;
}

/** USD: 2 dp with separators from 1 upwards; non-zero values below 1 keep 6 significant digits so small amounts stay readable. */
export function fmtUsd(v: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "-";
  const d = dec(v);
  if (!d.isZero() && d.abs().lt(1)) return d.toSignificantDigits(6, Dec.ROUND_HALF_UP).toFixed();
  return fmtNgn(v);
}

/** Price per unit: up to 8 significant digits. */
export function fmtPrice(v: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "-";
  return dec(v).toSignificantDigits(8, Dec.ROUND_HALF_UP).toFixed();
}

/** Quantity: exact, with separators on the whole part. */
export function fmtQty(v: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "-";
  const neg = v.startsWith("-");
  const [w, f] = (neg ? v.slice(1) : v).split(".");
  return `${neg ? "-" : ""}${groups(w)}${f ? `.${f}` : ""}`;
}
