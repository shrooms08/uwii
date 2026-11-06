/**
 * Reliefs and deductions for individuals under the Nigeria Tax Act 2025, s.30 (decision D15).
 * Each allowed amount is deducted from the income base before the PIT bands (D6) apply.
 * Amounts are exact decimal strings; no floating point.
 *
 * The rules are Uwii's reading of s.30 (decision D17): every surface that shows reliefs carries RELIEFS_NOTE.
 */
import { Dec, ZERO_D, dec, full } from "../../money";

/** Shown wherever reliefs appear (Questions, Result, guide, PDF); decision D17. */
export const RELIEFS_NOTE = "Reliefs follow Nigeria Tax Act 2025 s.30 as Uwii reads it. Confirm them with your tax adviser before filing.";

export type ReliefId = "rent_relief" | "pension" | "nhf" | "nhis" | "life_insurance" | "mortgage_interest";

/** User inputs (NGN, decimal strings). Personal: they stay in the browser and in request bodies. */
export interface ReliefInputs {
  rentPaidNgn?: string | null;
  pensionNgn?: string | null;
  nhfNgn?: string | null;
  nhisNgn?: string | null;
  lifeInsuranceNgn?: string | null;
  mortgageInterestNgn?: string | null;
}

export type ReliefInputKey = keyof ReliefInputs;

export interface ReliefDef {
  id: ReliefId;
  /** Which input it reads. */
  input: ReliefInputKey;
  label: string;
  /** What the user types into the field. */
  inputLabel: string;
  /** Plain explanation shown next to the field. */
  explanation: string;
  /** The rule as applied. */
  rule: string;
  /** Cap on the allowed amount (NGN), or null for none. */
  capNgn: string | null;
  /** Share of the input allowed before the cap ("0.2" = 20%); "1" = the full amount. */
  rate: string;
  citation: string;
}

export const RELIEFS: ReliefDef[] = [
  {
    id: "rent_relief",
    input: "rentPaidNgn",
    label: "Rent relief",
    inputLabel: "Rent you paid in 2026 for the home you live in",
    explanation: "20% of the annual rent you pay for your home.",
    rule: "20% of annual rent paid, capped at ₦500,000",
    capNgn: "500000",
    rate: "0.2",
    citation: "NTA 2025 s.30",
  },
  {
    id: "pension",
    input: "pensionNgn",
    label: "Pension contributions",
    inputLabel: "Your pension contributions in 2026",
    explanation: "What you contributed to your pension under the Pension Reform Act.",
    rule: "Contributions under the Pension Reform Act, in full",
    capNgn: null,
    rate: "1",
    citation: "NTA 2025 s.30; Pension Reform Act",
  },
  {
    id: "nhf",
    input: "nhfNgn",
    label: "National Housing Fund",
    inputLabel: "Your National Housing Fund contributions in 2026",
    explanation: "What you contributed to the National Housing Fund.",
    rule: "National Housing Fund contributions, in full",
    capNgn: null,
    rate: "1",
    citation: "NTA 2025 s.30",
  },
  {
    id: "nhis",
    input: "nhisNgn",
    label: "National Health Insurance",
    inputLabel: "Your National Health Insurance contributions in 2026",
    explanation: "What you contributed to the National Health Insurance scheme.",
    rule: "National Health Insurance contributions, in full",
    capNgn: null,
    rate: "1",
    citation: "NTA 2025 s.30",
  },
  {
    id: "life_insurance",
    input: "lifeInsuranceNgn",
    label: "Life insurance or annuity",
    inputLabel: "Life insurance or deferred annuity premiums you paid in 2026",
    explanation: "Premiums you paid on life insurance or a deferred annuity.",
    rule: "Life insurance or deferred annuity premiums, in full",
    capNgn: null,
    rate: "1",
    citation: "NTA 2025 s.30",
  },
  {
    id: "mortgage_interest",
    input: "mortgageInterestNgn",
    label: "Mortgage interest",
    inputLabel: "Interest you paid in 2026 on a loan for the home you live in",
    explanation: "Interest on a loan for a house you own and live in.",
    rule: "Interest on a loan for an owner-occupied residential house, in full",
    capNgn: null,
    rate: "1",
    citation: "NTA 2025 s.30",
  },
];

export interface ReliefItem {
  id: ReliefId;
  label: string;
  /** Allowed after the rate and cap (full precision). */
  allowedNgn: string;
  capped: boolean;
}

export interface ReliefComputation {
  items: ReliefItem[];
  totalNgn: string;
}

const present = (v: string | null | undefined): v is string => typeof v === "string" && v.trim() !== "";

/** True when any relief input is entered (zero counts as entered). */
export function hasReliefInputs(inputs: ReliefInputs | null | undefined): boolean {
  return Boolean(inputs) && RELIEFS.some((r) => present(inputs![r.input]));
}

/** Allowed amount per entered relief and the total, after rates and caps. */
export function computeReliefs(inputs: ReliefInputs | null | undefined): ReliefComputation {
  const items: ReliefItem[] = [];
  let total: Dec = ZERO_D;
  for (const r of RELIEFS) {
    const raw = inputs?.[r.input];
    if (!present(raw)) continue;
    const amount = dec(raw);
    if (amount.isNeg()) throw new Error(`${r.label}: amount cannot be negative`);
    const share = amount.mul(dec(r.rate));
    const capped = r.capNgn !== null && share.gt(dec(r.capNgn));
    const allowed = capped ? dec(r.capNgn!) : share;
    items.push({ id: r.id, label: r.label, allowedNgn: full(allowed), capped });
    total = total.plus(allowed);
  }
  return { items, totalNgn: full(total) };
}
