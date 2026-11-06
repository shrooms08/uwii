/** One-line summaries of the decision log (docs/rules-ng-2026-21.md) for the method appendix. */
export const DECISION_LOG: { id: string; text: string }[] = [
  { id: "D1", text: "Swap proceeds = dollar FMV of the asset given up (9.3.2, Illustration 3); FMV of the asset received is stored too; 9.1.2 Step 2(b) wording flagged." },
  { id: "D2", text: "Each gas payment is a NEAR disposal at FMV (7.1 event 5); not deductible; shown separately." },
  { id: "D3", text: "Native staking rewards are income recognised daily on receipt (7.1 event 9; 9.5(4)), from pool balance snapshots." },
  { id: "D4", text: "Liquid-staking deposit is a receipt (10.2): no disposal; cost carried to the receipt token; accrual taxed on disposal." },
  { id: "D5", text: "FIFO cost method (9.3.3(3)); NEAR and wNEAR share one lot pool (10.1)." },
  { id: "D6", text: "PIT bands: 0% to 800,000; 15% next 2,200,000; 18% next 9,000,000; 21% next 13,000,000; 23% next 25,000,000; 25% above 50,000,000." },
  { id: "D7", text: "USD prices: CoinGecko historical (hourly where available) until NRS publishes its approved aggregator list (9.2(2))." },
  { id: "D8", text: "USD/NGN: CBN NFEM (formerly NAFEM) closing rate on the transaction date; prior published date if none; never interpolated." },
  { id: "D9", text: "Gift received: cost base = market value at receipt (NTA s.36(1)); gift given: no tax on the donor (possible NTA conflict noted)." },
  { id: "D10", text: "VAT on professional fees received in virtual assets is out of scope for this computation." },
  { id: "D11", text: "Pre-2026 holdings: cost base = higher of original cost or FMV at 2025-12-31 23:59:59 UTC; both gains shown." },
  { id: "D12", text: "Technical non-taxable movements (round trips, dust, storage deposits) and post-AI consistency guards." },
  { id: "D13", text: "acquisition_swap for the received leg; loans received/repaid are non-taxable; repayment in a different asset is flagged." },
  { id: "D14", text: "User answers apply as method 'user' labels; answers and personal inputs stay in the browser." },
  { id: "D15", text: "Reliefs and deductions (NTA 2025 s.30): rent relief 20% of rent capped at 500,000; pension, NHF, NHIS, life insurance and owner-occupied mortgage interest in full; deducted from the income base before the PIT bands." },
];

const TECHNICAL_D12 = ["round_trip", "dust_no_value", "storage_deposit"];

/**
 * Decisions that shaped this report: those the engine applied, plus classification-level ones
 * visible in the output (D12 technical labels skipped; D13 swap-acquisition/loan labels present).
 */
export function appliedDecisionIds(report: { decisionsApplied: { id: string }[]; skippedTechnical: Record<string, number>; lines: { label: string }[] }): Set<string> {
  const ids = new Set(report.decisionsApplied.map((d) => d.id));
  if (TECHNICAL_D12.some((l) => (report.skippedTechnical[l] ?? 0) > 0)) ids.add("D12");
  if (report.lines.some((l) => l.label === "acquisition_swap" || l.label === "loan_received" || l.label === "loan_repayment")) ids.add("D13");
  return ids;
}
