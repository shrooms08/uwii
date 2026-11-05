/**
 * Tax computation worksheet PDF, built entirely client-side with jsPDF + jspdf-autotable
 * (both loaded on demand). The same builder runs in Node for layout verification.
 * Personal fields (name, TIN, state, own accounts) are only printed; they never leave the browser
 * and are excluded from the fingerprint.
 */
import type { ReportData } from "../tax/ng/report";
import type { ReportLine } from "../tax/ng/engine";
import { DECISION_LOG, appliedDecisionIds } from "./decisions";
import { fmtNgn, fmtPrice, fmtQty, fmtUsd } from "./format";
import { privacyProofText } from "./privacy";

export interface PersonalFields {
  name?: string;
  tin?: string;
  state?: string;
  ownAccounts?: string[];
}

export const DISCLAIMER =
  "Computation for review; not tax advice. Individuals file personal income tax returns with their State Internal Revenue Service. " +
  "Annual return due 31 March. Based on NRS Information Circular No. 2026/21.";

const RATE_LABEL = "CBN NFEM (formerly NAFEM) closing rate";

/** Standard PDF fonts are WinAnsi/Latin-1: map the few non-Latin-1 characters we use, drop the rest. */
export function pdfText(s: string): string {
  return s
    .replace(/₦/g, "NGN ")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/→/g, "->")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/×/g, "x")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "?");
}

/** Diagonal, translucent "DRAFT, NOT FOR FILING" centred on the page. */
function drawWatermark(doc: import("jspdf").jsPDF, GState: typeof import("jspdf").GState, W: number, H: number) {
  const label = "DRAFT, NOT FOR FILING";
  // Along the page diagonal, scaled so the text spans ~75% of it and never runs off the page.
  const rad = Math.atan2(H, W);
  const angle = (rad * 180) / Math.PI;
  doc.saveGraphicsState();
  doc.setGState(new GState({ opacity: 0.13 }));
  doc.setFont("helvetica", "bold");
  doc.setFontSize(100);
  const target = Math.hypot(W, H) * 0.75;
  const size = (100 * target) / doc.getTextWidth(label);
  doc.setFontSize(size);
  doc.setTextColor(176, 0, 32);
  const w = doc.getTextWidth(label);
  const capHalf = (size * 0.3528 * 0.7) / 2; // half the cap height in mm (1pt = 0.3528mm)
  // jsPDF rotates counter-clockwise about the text origin (baseline start); offset so the text centre sits at the page centre.
  const x = W / 2 - (w / 2) * Math.cos(rad) - capHalf * Math.sin(rad);
  const y = H / 2 + (w / 2) * Math.sin(rad) + capHalf * Math.cos(rad);
  doc.text(label, x, y, { angle });
  doc.restoreGraphicsState();
}

const short = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n)}...` : s) : "-");

interface AutoTableDoc {
  lastAutoTable?: { finalY: number };
}

export async function buildWorksheetPdf(report: ReportData, personal: PersonalFields = {}, generatedAt = new Date()): Promise<Uint8Array> {
  const { jsPDF, GState } = await import("jspdf");
  const { autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = { left: 12, right: 12, top: 14, bottom: 22 };
  const contentW = W - M.left - M.right;
  let y = M.top;

  doc.setProperties({
    title: `Uwii Virtual Asset Tax Computation ${report.year} - ${report.account}`,
    subject: "Virtual asset tax computation worksheet (NRS Information Circular 2026/21)",
    creator: "Uwii",
    keywords: `fingerprint:${report.fingerprint}`,
  });

  const text = (s: string, x: number, yy: number, opts?: { size?: number; bold?: boolean; font?: "helvetica" | "courier"; color?: number }) => {
    doc.setFont(opts?.font ?? "helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(opts?.size ?? 9);
    doc.setTextColor(opts?.color ?? 20);
    doc.text(pdfText(s), x, yy);
  };
  const paragraph = (s: string, size = 8.5) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(30);
    const lines = doc.splitTextToSize(pdfText(s), contentW) as string[];
    const lh = size * 0.42;
    if (y + lines.length * lh > H - M.bottom) {
      doc.addPage();
      y = M.top;
    }
    doc.text(lines, M.left, y);
    y += lines.length * lh + 1.5;
  };
  const section = (title: string, minSpace = 30) => {
    if (y + minSpace > H - M.bottom) {
      doc.addPage();
      y = M.top;
    } else {
      y += 4;
    }
    text(title, M.left, y, { size: 11.5, bold: true });
    y += 2;
    doc.setDrawColor(160);
    doc.line(M.left, y, W - M.right, y);
    y += 4;
  };
  const table = (head: string[], body: string[][], columnStyles: Record<number, object> = {}, extra: object = {}) => {
    autoTable(doc, {
      startY: y,
      head: [head.map(pdfText)],
      body: body.map((r) => r.map(pdfText)),
      margin: { left: M.left, right: M.right, top: M.top, bottom: M.bottom },
      theme: "grid",
      styles: { font: "helvetica", fontSize: 7.2, cellPadding: 1.2, overflow: "linebreak", valign: "top", textColor: 20, lineColor: 200, lineWidth: 0.1 },
      headStyles: { fillColor: [235, 238, 242], textColor: 20, fontStyle: "bold" },
      rowPageBreak: "avoid",
      showHead: "everyPage",
      columnStyles,
      ...extra,
    });
    y = ((doc as unknown as AutoTableDoc).lastAutoTable?.finalY ?? y) + 3;
  };
  const right = { halign: "right" } as const;
  const rate = (l: ReportLine) => (l.nafemRate ? `${l.nafemRate}${l.rateFallback ? ` *` : ""}` : "-");
  const fallbackNote = () => paragraph(`* Rate fallback: no ${RATE_LABEL} was published on that date; the most recent prior published date was used (never interpolated).`, 7.2);

  // ---- a. header ----
  text(`Uwii: Virtual Asset Tax Computation, Year of Assessment ${report.year}`, M.left, y + 2, { size: 15, bold: true });
  y += 9;
  const accounts = [report.account, ...(personal.ownAccounts ?? []).filter((a) => a && a !== report.account)];
  const meta: [string, string][] = [
    ["Account(s)", accounts.join(", ")],
    ["Taxpayer", personal.name?.trim() || "not provided"],
    ["TIN", personal.tin?.trim() || "not provided"],
    ["State of residence", personal.state?.trim() || "not provided"],
    ["Generated", generatedAt.toISOString().replace("T", " ").slice(0, 19) + " UTC"],
  ];
  for (const [k, v] of meta) {
    text(`${k}:`, M.left, y, { size: 9, bold: true });
    text(v, M.left + 34, y, { size: 9 });
    y += 4.6;
  }
  text("Report fingerprint (SHA-256):", M.left, y, { size: 9, bold: true });
  text(report.fingerprint, M.left + 50, y, { size: 8.5, font: "courier" });
  y += 3.5;
  paragraph("The fingerprint covers the computation (lines, totals, tax, warnings, decisions, sources, privacy proof); personal fields and other-income inputs are excluded.", 7.2);

  // ---- draft box (page 1) ----
  if (report.status === "draft") {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    const bullets = report.draftReasons.map((r) => doc.splitTextToSize(pdfText(`- ${r.message}`), contentW - 8) as string[]);
    const lh = 8.5 * 0.42;
    const boxH = 9 + bullets.reduce((n, b) => n + b.length, 0) * lh + 2;
    y += 2;
    doc.setDrawColor(176, 0, 32);
    doc.setFillColor(253, 236, 238);
    doc.setLineWidth(0.5);
    doc.rect(M.left, y, contentW, boxH, "FD");
    doc.setLineWidth(0.2);
    text(
      `DRAFT, NOT FOR FILING${report.blockingQuestions ? ` - answer ${report.blockingQuestions} question${report.blockingQuestions === 1 ? "" : "s"} to finalise` : ""}`,
      M.left + 4,
      y + 5.5,
      { size: 10.5, bold: true, color: 120 },
    );
    let by = y + 10;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(60);
    for (const b of bullets) {
      doc.text(b, M.left + 4, by);
      by += b.length * lh;
    }
    y += boxH + 1;
  }

  // ---- b. summary ----
  const t = report.totals;
  section("Summary", 45);
  const taxBasis =
    report.tax.basis === "marginal_over_other_income" && report.tax.otherIncomeNgn
      ? `marginal over other income of NGN ${fmtNgn(report.tax.otherIncomeNgn)}`
      : "assumes no other income";
  table(
    ["Item", "NGN", "Basis"],
    [
      ["Total virtual-asset income", fmtNgn(t.totalVaIncomeNgn), "Income at FMV on receipt x NFEM rate (9.5)"],
      ["Net disposal gains", fmtNgn(t.netGainsNgn), `Gains ${fmtNgn(t.disposalGainsNgn)} less losses ${fmtNgn(t.disposalLossesNgn)} (9.1.2 Step 4; 9.4)`],
      ["Chargeable virtual-asset amount", fmtNgn(t.chargeableVaNgn), "Income + max(net gains, 0) (9.4)"],
      ["Tax attributable to virtual assets", fmtNgn(report.tax.taxAttributableToVaNgn), `PIT bands (D6); ${taxBasis}`],
      ["Loss carried forward", fmtNgn(report.carryForwardLossNgn), "Net disposal loss; not offset against income (9.4)"],
      ["Gas fees total", fmtNgn(t.gasFeesNgn), "Not deductible (D2); each fee is a NEAR disposal, see schedule"],
    ],
    { 0: { cellWidth: 70, fontStyle: "bold" }, 1: { cellWidth: 40, halign: "right" } },
    { styles: { font: "helvetica", fontSize: 8.5, cellPadding: 1.6, textColor: 20, lineColor: 200, lineWidth: 0.1 } },
  );
  for (const n of report.tax.notes) paragraph(`Note: ${n}`, 7.5);

  // ---- c. income schedule ----
  const income = report.lines.filter((l) => l.kind === "income");
  section(`Income schedule (${income.length})`);
  table(
    ["Date", "Label", "Asset", "Quantity", "USD value", "NFEM rate", "NGN value", "Circular ref"],
    income.map((l) => [
      l.date,
      l.label,
      l.asset,
      fmtQty(l.qty),
      l.priceStatus === "no_verifiable_price" ? "no verifiable price (excluded)" : fmtUsd(l.usdValue),
      rate(l),
      l.includedInTotals ? fmtNgn(l.incomeNgn ?? l.ngnValue) : "excluded",
      l.circularRef,
    ]),
    { 0: { cellWidth: 20 }, 1: { cellWidth: 38 }, 2: { cellWidth: 14 }, 3: { cellWidth: 46, ...right }, 4: { cellWidth: 30, ...right }, 5: { cellWidth: 22, ...right }, 6: { cellWidth: 28, ...right } },
  );
  if (income.some((l) => l.rateFallback)) fallbackNote();

  // ---- d. disposal schedule ----
  const disposals = report.lines.filter((l) => l.kind === "disposal");
  const d11 = disposals.some((l) => l.noResetGainUsd !== undefined);
  section(`Disposal schedule (${disposals.length})`);
  table(
    ["Date", "Label", "Asset", "Quantity", "Proceeds USD", "Cost USD", "Gain USD", ...(d11 ? ["No-reset gain USD (D11)"] : []), "FMV received USD (D1)", "NFEM rate", "Gain NGN", "Circular ref"],
    disposals.map((l) => [
      l.date,
      l.label,
      l.asset,
      fmtQty(l.qty),
      fmtUsd(l.proceedsUsd),
      fmtUsd(l.costUsd),
      fmtUsd(l.gainUsd),
      ...(d11 ? [l.noResetGainUsd !== undefined ? fmtUsd(l.noResetGainUsd) : "-"] : []),
      l.fmvReceivedUsd ? fmtUsd(l.fmvReceivedUsd) : "-",
      rate(l),
      l.includedInTotals ? fmtNgn(l.gainNgn) : "excluded",
      l.circularRef,
    ]),
    { 0: { cellWidth: 20 }, 1: { cellWidth: 28 }, 2: { cellWidth: 13 }, 3: { cellWidth: 28, ...right }, 4: right, 5: right, 6: right, ...(d11 ? { 7: right, 8: right, 9: right, 10: right } : { 7: right, 8: right, 9: right }) },
  );
  paragraph(
    d11
      ? "D11: for pre-2026 lots the reported gain uses cost = higher of original cost or FMV at 2025-12-31 23:59:59 UTC; the no-reset gain uses the original cost."
      : "D11: no pre-2026 lots were consumed in these disposals, so reset-based and no-reset gains are identical.",
    7.2,
  );
  if (disposals.some((l) => l.rateFallback)) fallbackNote();

  // ---- e. gas fee schedule ----
  const fees = report.lines.filter((l) => l.kind === "gas_fee");
  section(`Gas fee schedule (${fees.length}) - NEAR disposals, not deductible (D2)`);
  table(
    ["Date", "NEAR", "USD price", "Proceeds USD", "Cost USD", "Gain USD", "NFEM rate", "NGN value", "Gain NGN", "Transaction"],
    [
      ...fees.map((l) => [l.date, fmtQty(l.qty), fmtPrice(l.usdPrice), fmtUsd(l.proceedsUsd), fmtUsd(l.costUsd), fmtUsd(l.gainUsd), rate(l), fmtNgn(l.ngnValue), fmtNgn(l.gainNgn), short(l.txHash, 16)]),
      ["Total", "", "", fmtUsd(t.gasFeesUsd), "", "", "", fmtNgn(t.gasFeesNgn), "", ""],
    ],
    { 0: { cellWidth: 20 }, 1: { cellWidth: 34, ...right }, 2: right, 3: right, 4: right, 5: right, 6: right, 7: right, 8: right, 9: { cellWidth: 36, font: "courier" } },
  );

  // ---- f. warnings ----
  section(`Warnings (${report.warnings.length})`);
  if (report.warnings.length === 0) paragraph("None.");
  else table(["#", "Type", "Warning"], report.warnings.map((w, i) => [String(i + 1), w.code.replace(/_/g, " "), w.message]), { 0: { cellWidth: 8 }, 1: { cellWidth: 42 } });

  // ---- g. privacy proof ----
  const p = report.privacyProof;
  section("Privacy proof");
  paragraph(privacyProofText(p), 8.5);
  table(
    ["Evidence", "Value"],
    [
      ["Model", p.model ?? "not available"],
      ["Gateway + model attestation reports verified", p.gatewayAndModelReportsVerified === null ? "not needed (no AI decisions)" : p.gatewayAndModelReportsVerified ? "yes" : "NO"],
      ["Attestation checks passed", p.checksPassed === null ? "not available" : `${p.checksPassed}${p.checksTotal !== null ? ` of ${p.checksTotal}` : ""}`],
      ["AI decisions with verified response signatures", `${p.aiDecisionsSignatureVerified} of ${p.aiDecisions}`],
      ["AI responses with verified signatures", `${p.aiResponsesVerified} of ${p.aiResponses}`],
      ["Response signer address(es)", p.signerAddresses.length ? p.signerAddresses.join(", ") : "not available"],
      ["Attested at", p.attestedAt ?? "not available"],
      ...(p.missing.length ? [["Not available", p.missing.join("; ")]] : []),
    ],
    { 0: { cellWidth: 75, fontStyle: "bold" }, 1: { font: "courier" } },
  );

  // ---- h. method appendix ----
  const applied = appliedDecisionIds(report);
  section("Method appendix - decisions");
  table(["ID", "Decision", "Applied"], DECISION_LOG.map((d) => [d.id, d.text, applied.has(d.id) ? "yes" : "-"]), { 0: { cellWidth: 12 }, 2: { cellWidth: 16 } });
  section("Method appendix - data sources", 25);
  table(
    ["Source", "Detail", "Retrieved"],
    report.dataSources.map((s) => [s.name, s.detail, s.retrievedAt ? s.retrievedAt.replace("T", " ").slice(0, 19) + " UTC" : "-"]),
    { 0: { cellWidth: 52, fontStyle: "bold" }, 2: { cellWidth: 36 } },
  );
  paragraph(
    `Exchange rates: ${RATE_LABEL}, NGN per USD. Prices: USD from CoinGecko (granularity shown per line in the CSV); tokens without a verifiable price are excluded (9.2(4)). ` +
      "All amounts are computed at full precision and rounded to 2 decimal places only for display.",
    7.2,
  );

  // ---- i. footer (and draft watermark) on every page ----
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    if (report.status === "draft") drawWatermark(doc, GState, W, H);
    doc.setDrawColor(180);
    doc.line(M.left, H - 15, W - M.right, H - 15);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(90);
    const lines = doc.splitTextToSize(pdfText(DISCLAIMER), contentW - 45) as string[];
    doc.text(lines, M.left, H - 11.5);
    doc.text(`Page ${i} of ${pages}`, W - M.right, H - 11.5, { align: "right" });
    doc.setFont("courier", "normal");
    doc.setFontSize(6.5);
    doc.text(`fp ${report.fingerprint.slice(0, 16)}...`, W - M.right, H - 8.5, { align: "right" });
  }

  return new Uint8Array(doc.output("arraybuffer"));
}
