/** Personal income tax bands (D6), NGN per year. */
import { Dec, ZERO_D, dec } from "../../money";

export const PIT_BANDS: { width: string | null; rate: string }[] = [
  { width: "800000", rate: "0" },
  { width: "2200000", rate: "0.15" },
  { width: "9000000", rate: "0.18" },
  { width: "13000000", rate: "0.21" },
  { width: "25000000", rate: "0.23" },
  { width: null, rate: "0.25" }, // above 50,000,000
];

export interface PitBandUse {
  from: string;
  to: string | null;
  rate: string;
  taxableInBand: string;
  tax: string;
}

/** PIT on annual chargeable income (full precision), with the band breakdown. */
export function pit(income: Dec | string): { tax: Dec; bands: PitBandUse[] } {
  let remaining = typeof income === "string" ? dec(income) : income;
  if (remaining.isNeg()) remaining = ZERO_D;
  let lower = ZERO_D;
  let tax = ZERO_D;
  const bands: PitBandUse[] = [];
  for (const b of PIT_BANDS) {
    if (remaining.lte(0)) break;
    const width = b.width === null ? remaining : Dec.min(remaining, dec(b.width));
    const t = width.mul(dec(b.rate));
    bands.push({
      from: lower.toFixed(),
      to: b.width === null ? null : lower.plus(dec(b.width)).toFixed(),
      rate: b.rate,
      taxableInBand: width.toFixed(),
      tax: t.toFixed(),
    });
    tax = tax.plus(t);
    remaining = remaining.minus(width);
    if (b.width !== null) lower = lower.plus(dec(b.width));
  }
  return { tax, bands };
}
