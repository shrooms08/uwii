/**
 * Tax computation worksheet PDF, built entirely client-side with jsPDF + jspdf-autotable (both loaded
 * on demand, with the embedded fonts fetched from /pdf-fonts only when a PDF is built). The same
 * builder runs in Node for layout verification (pass a font loader that reads the files from disk).
 * Personal fields (name, TIN, state, own accounts) are only printed; they never leave the browser
 * and are excluded from the fingerprint.
 *
 * Fonts (SIL OFL 1.1, see public/pdf-fonts): Geist for text, the title and headline figures; Geist Mono
 * for numbers and hashes. Neither has the naira sign, so "₦" is drawn from IBM Plex Mono wherever it
 * appears. The header carries the gold brand accent (the % mark, a rule, the Final chip).
 */
import type { jsPDF as JsPdf } from "jspdf";
import type { CellHookData, UserOptions } from "jspdf-autotable";
import type { ReportData } from "../tax/ng/report";
import type { ReportLine } from "../tax/ng/engine";
import { NEXT_STEPS, NEXT_STEPS_DRAFT, NEXT_STEPS_RERUN, NEXT_STEPS_TITLE } from "../../content/next-steps";
import { needsRescan } from "./status";
import { DECISION_LOG, appliedDecisionIds } from "./decisions";
import { fmtQtyShort, shortLabel } from "./explain";
import { fmtDate, fmtNgn, fmtPrice, fmtQty, fmtUsd } from "./format";
import { privacyProofText } from "./privacy";
import { lineSections, reconcileSections, splitRef, type LineSection, type SectionId, type SectionRow } from "./sections";
import { plainWarnings } from "./warnings";
import { taxTips } from "./tips";
import { RELIEFS, RELIEFS_NOTE } from "../tax/ng/reliefs";
import { Dec, dec, full } from "../money";

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

/** A NEAR testnet anchor of this report fingerprint (Phase 8), printed on page 1 when it matches. */
export interface PdfAnchor {
  fingerprint: string;
  txHash: string | null;
  blockHeight: string;
  anchoredAt: string;
  contractId: string;
  network: string;
}

/** Reads one font file from public/pdf-fonts (the browser default fetches it from the site). */
export type PdfFontLoader = (file: string) => Promise<ArrayBuffer | Uint8Array>;

const FONT_FILES = {
  geist: "Geist-Regular.ttf",
  geistBold: "Geist-SemiBold.ttf",
  mono: "GeistMono-Regular.ttf",
  monoBold: "GeistMono-Medium.ttf",
  naira: "IBMPlexMono-Regular.ttf",
} as const;

const defaultFontLoader: PdfFontLoader = async (file) => {
  const res = await fetch(`/pdf-fonts/${file}`);
  if (!res.ok) throw new Error(`Could not load the PDF font ${file} (HTTP ${res.status})`);
  return res.arrayBuffer();
};

function toBase64(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

type Rgb = [number, number, number];
const C = {
  ink: [14, 14, 12] as Rgb,
  ink2: [95, 91, 84] as Rgb,
  soft: [58, 55, 50] as Rgb,
  warm: [244, 242, 238] as Rgb,
  panel: [250, 249, 247] as Rgb,
  line: [232, 228, 222] as Rgb,
  white: [255, 255, 255] as Rgb,
  // Brand gold (#E6BB79) for fills behind ink text; a deeper gold for marks and rules on white; and
  // a gold-brown for text on white (6.6:1).
  gold: [230, 187, 121] as Rgb,
  goldDeep: [201, 151, 72] as Rgb,
  goldInk: [118, 82, 26] as Rgb,
  amberTint: [251, 239, 213] as Rgb,
  amberLine: [243, 221, 174] as Rgb,
  amberInk: [110, 67, 0] as Rgb,
};

type Family = "Geist" | "GeistMono" | "Display";
interface FontSpec {
  family: Family;
  bold?: boolean;
  size: number;
}

const NAIRA = "₦";
/** Stands in for "₦" while autotable measures and wraps cells (same advance as Plex Mono's ₦ in Geist Mono). */
const STANDIN = "¤";

const money = (sym: "₦" | "$", v: string | null | undefined, fmt: (v: string) => string) => {
  if (v === null || v === undefined || v === "") return "–";
  const t = fmt(v);
  return t.startsWith("-") ? `−${sym}${t.slice(1)}` : `${sym}${t}`;
};
const ngn = (v: string | null | undefined) => money("₦", v, fmtNgn);
const usd = (v: string | null | undefined) => money("$", v, fmtUsd);
const utc = (iso: string) => `${iso.replace("T", " ").slice(0, 19)} UTC`;
const sumOrNull = (vals: (string | null | undefined)[]) => {
  const xs = vals.filter((v): v is string => v !== null && v !== undefined && v !== "");
  return xs.length ? full(xs.reduce((s, v) => s.plus(dec(v)), new Dec(0))) : null;
};

/** The uwii "%" mark (same geometry as the web PercentMark, viewBox 100), drawn at (x, y) with size s mm. */
function drawMark(doc: JsPdf, x: number, y: number, s: number, color: Rgb) {
  const k = s / 100;
  doc.setDrawColor(...color);
  doc.setLineWidth(10.5 * k);
  doc.ellipse(x + 26 * k, y + 27 * k, 14.5 * k, 20.5 * k, "S");
  doc.ellipse(x + 74 * k, y + 73 * k, 14.5 * k, 20.5 * k, "S");
  doc.setLineWidth(13 * k);
  doc.setLineCap("butt");
  doc.line(x + 81 * k, y + 3 * k, x + 19 * k, y + 97 * k);
  doc.setLineCap("round");
  doc.setLineWidth(0.2);
}

/** Diagonal, translucent "DRAFT, NOT FOR FILING" centred on the page. */
function drawWatermark(doc: JsPdf, GState: typeof import("jspdf").GState, W: number, H: number) {
  const label = "DRAFT, NOT FOR FILING";
  const rad = Math.atan2(H, W);
  const angle = (rad * 180) / Math.PI;
  doc.saveGraphicsState();
  doc.setGState(new GState({ opacity: 0.1 }));
  doc.setFont("Geist", "bold");
  doc.setFontSize(100);
  const target = Math.hypot(W, H) * 0.72;
  const size = (100 * target) / doc.getTextWidth(label);
  doc.setFontSize(size);
  doc.setTextColor(...C.amberInk);
  const w = doc.getTextWidth(label);
  const capHalf = (size * 0.3528 * 0.7) / 2;
  const x = W / 2 - (w / 2) * Math.cos(rad) - capHalf * Math.sin(rad);
  const y = H / 2 + (w / 2) * Math.sin(rad) + capHalf * Math.cos(rad);
  doc.text(label, x, y, { angle });
  doc.restoreGraphicsState();
}

interface AutoTableDoc {
  lastAutoTable?: { finalY: number };
}

/** A column of a section table in the PDF. */
interface PdfCol {
  head: string;
  right?: boolean;
  mono?: boolean;
  width?: number | "wrap";
  cell: (r: SectionRow) => string;
  /** Subtotal row text under this column (sections with a subtotal). */
  foot?: (s: LineSection) => string;
}

const primary = (r: SectionRow) => (r.type === "swap" ? (r.gives[0] ?? r.gets[0]) : r.line);
const legs = (ls: ReportLine[]) => ls.map((l) => `${fmtQtyShort(l.qty)} ${l.asset}`).join(" + ");
const rateText = (v: string | null, fallback: boolean) => (v ? `${fmtNgn(v)}${fallback ? " *" : ""}` : "–");
const shortHash = (h: string) => (!h ? "–" : h.length > 20 ? `${h.slice(0, 10)}…${h.slice(-8)}` : h);
const refText = (r: SectionRow) => {
  const { ref, decision } = splitRef(primary(r).circularRef);
  return decision && decision !== ref ? `${ref} · ${decision}` : ref;
};

const dateCol: PdfCol = { head: "Date", width: "wrap", mono: true, cell: (r) => fmtDate(r.type === "swap" ? r.timestamp : r.line.timestamp) };
const labelCol: PdfCol = { head: "Label", width: 30, cell: (r) => (r.type === "swap" ? "Swap" : shortLabel(r.line.label)) };
const assetCol: PdfCol = { head: "Asset", width: 22, cell: (r) => (r.type === "swap" ? `${legs(r.gives)} → ${legs(r.gets)}` : r.line.asset) };
const qtyCol: PdfCol = { head: "Quantity", right: true, mono: true, width: "wrap", cell: (r) => fmtQty(primary(r).qty) };
const usdValueCol: PdfCol = {
  head: "USD value",
  right: true,
  mono: true,
  width: "wrap",
  cell: (r) => (primary(r).usdValue ? usd(primary(r).usdValue) : primary(r).priceStatus === "no_verifiable_price" ? "no price" : "–"),
};
const rateCol: PdfCol = { head: "NFEM rate", right: true, mono: true, width: "wrap", cell: (r) => (r.type === "swap" ? rateText(r.nafemRate, r.rateFallback) : rateText(r.line.nafemRate, r.line.rateFallback)) };
const refCol: PdfCol = { head: "Circular ref", cell: refText };

function sectionColumns(id: SectionId, d11: boolean): PdfCol[] {
  switch (id) {
    case "income":
      return [
        { ...dateCol, foot: (s) => s.subtotalLabel ?? "" },
        labelCol,
        assetCol,
        qtyCol,
        { head: "USD price", right: true, mono: true, width: "wrap", cell: (r) => (primary(r).usdPrice ? `$${fmtPrice(primary(r).usdPrice)}` : "–") },
        usdValueCol,
        rateCol,
        { head: "₦ value", right: true, mono: true, width: "wrap", cell: (r) => ngn(primary(r).incomeNgn ?? primary(r).ngnValue), foot: (s) => ngn(s.subtotalNgn) },
        refCol,
      ];
    case "disposals":
      return [
        { ...dateCol, foot: (s) => s.subtotalLabel ?? "" },
        { ...labelCol, width: 26 },
        { head: "What", width: 46, cell: (r) => (r.type === "swap" ? `${legs(r.gives)} → ${legs(r.gets)}` : `${fmtQtyShort(r.line.qty)} ${r.line.asset}`) },
        { head: "Proceeds USD", right: true, mono: true, width: "wrap", cell: (r) => usd(r.type === "swap" ? r.proceedsUsd : r.line.proceedsUsd) },
        { head: "Cost USD", right: true, mono: true, width: "wrap", cell: (r) => usd(r.type === "swap" ? r.costUsd : r.line.costUsd) },
        { head: "Gain USD", right: true, mono: true, width: "wrap", cell: (r) => usd(r.type === "swap" ? r.gainUsd : r.line.gainUsd) },
        ...(d11
          ? [
              {
                head: "No-reset gain USD (D11)",
                right: true,
                mono: true,
                cell: (r: SectionRow) => usd(r.type === "swap" ? sumOrNull(r.gives.map((g) => g.noResetGainUsd)) : (r.line.noResetGainUsd ?? null)),
              } satisfies PdfCol,
            ]
          : []),
        rateCol,
        { head: "Gain ₦", right: true, mono: true, width: "wrap", cell: (r) => ngn(r.type === "swap" ? r.gainNgn : r.line.gainNgn), foot: (s) => ngn(s.subtotalNgn) },
        refCol,
      ];
    case "gas":
      return [
        { ...dateCol, foot: (s) => s.subtotalLabel ?? "" },
        { ...qtyCol, head: "NEAR" },
        { head: "USD price", right: true, mono: true, width: "wrap", cell: (r) => (primary(r).usdPrice ? `$${fmtPrice(primary(r).usdPrice)}` : "–") },
        usdValueCol,
        { head: "Cost USD", right: true, mono: true, width: "wrap", cell: (r) => usd(primary(r).costUsd) },
        { head: "Gain USD", right: true, mono: true, width: "wrap", cell: (r) => usd(primary(r).gainUsd) },
        rateCol,
        { head: "₦ value", right: true, mono: true, width: "wrap", cell: (r) => ngn(primary(r).ngnValue), foot: (s) => ngn(s.subtotalNgn) },
        { head: "Gain ₦", right: true, mono: true, width: "wrap", cell: (r) => ngn(primary(r).gainNgn), foot: (s) => ngn(s.gainNgn) },
        { head: "Transaction", mono: true, width: "wrap", cell: (r) => shortHash(primary(r).txHash) },
        refCol,
      ];
    case "not_taxable":
      return [dateCol, labelCol, { ...assetCol, width: 46 }, qtyCol, usdValueCol, { head: "Tax", width: "wrap", cell: () => "Not taxable" }, refCol];
    case "excluded":
      return [dateCol, labelCol, { ...assetCol, width: 46 }, qtyCol, { head: "Reason", width: 70, cell: (r) => r.reason ?? "" }, refCol];
  }
}

export interface PdfOptions {
  /** Font file loader; defaults to fetching /pdf-fonts/<file> (browser). */
  loadFont?: PdfFontLoader;
}

export async function buildWorksheetPdf(
  report: ReportData,
  personal: PersonalFields = {},
  generatedAt = new Date(),
  anchor?: PdfAnchor | null,
  options: PdfOptions = {},
): Promise<Uint8Array> {
  const [{ jsPDF, GState }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const load = options.loadFont ?? defaultFontLoader;
  const fontData = Object.fromEntries(await Promise.all(Object.entries(FONT_FILES).map(async ([k, f]) => [k, toBase64(await load(f))] as const))) as Record<keyof typeof FONT_FILES, string>;

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  const reg = (file: string, data: string, family: string, style: "normal" | "bold") => {
    doc.addFileToVFS(file, data);
    doc.addFont(file, family, style);
  };
  reg(FONT_FILES.geist, fontData.geist, "Geist", "normal");
  reg(FONT_FILES.geistBold, fontData.geistBold, "Geist", "bold");
  reg(FONT_FILES.mono, fontData.mono, "GeistMono", "normal");
  reg(FONT_FILES.monoBold, fontData.monoBold, "GeistMono", "bold");
  // Display role (title, wordmark, headline figures): Geist Regular.
  reg(FONT_FILES.geist, fontData.geist, "Display", "normal");
  reg(FONT_FILES.naira, fontData.naira, "PlexMono", "normal");

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = { left: 14, right: 14, top: 14, bottom: 24 };
  /** Top margin on continuation pages (below the running header). */
  const TOP2 = 22;
  const contentW = W - M.left - M.right;
  const bottomY = H - M.bottom;
  let y = M.top;

  doc.setProperties({
    title: `Uwii Virtual Asset Tax Computation ${report.year} - ${report.account}`,
    subject: "Virtual asset tax computation worksheet (NRS Information Circular 2026/21)",
    creator: "Uwii",
    keywords: `fingerprint:${report.fingerprint}`,
  });

  // ---------- rich text: Geist / Geist Mono, with "₦" from Plex Mono ----------
  const setFont = (f: FontSpec) => {
    doc.setFont(f.family, f.family === "Display" ? "normal" : f.bold ? "bold" : "normal");
    doc.setFontSize(f.size);
  };
  const segments = (s: string) => s.split(/(₦)/).filter((x) => x !== "");
  const measure = (s: string, f: FontSpec) => {
    let w = 0;
    for (const seg of segments(s)) {
      if (seg === NAIRA) {
        doc.setFont("PlexMono", "normal");
        doc.setFontSize(f.size);
      } else setFont(f);
      w += doc.getTextWidth(seg);
    }
    return w;
  };
  const draw = (s: string, x: number, yy: number, f: FontSpec, color: Rgb = C.ink, align: "left" | "right" | "center" = "left") => {
    const w = measure(s, f);
    let cx = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
    doc.setTextColor(...color);
    for (const seg of segments(s)) {
      if (seg === NAIRA) {
        doc.setFont("PlexMono", "normal");
        doc.setFontSize(f.size);
      } else setFont(f);
      doc.text(seg, cx, yy);
      cx += doc.getTextWidth(seg);
    }
    return w;
  };
  /** Word-wraps rich text to a width (long unbroken words are split by character). */
  const wrap = (s: string, maxW: number, f: FontSpec): string[] => {
    const out: string[] = [];
    for (const para of s.split("\n")) {
      let line = "";
      for (const word of para.split(" ")) {
        const next = line ? `${line} ${word}` : word;
        if (measure(next, f) <= maxW || !line) {
          if (!line && measure(word, f) > maxW) {
            let chunk = "";
            for (const ch of word) {
              if (measure(chunk + ch, f) > maxW && chunk) {
                out.push(chunk);
                chunk = "";
              }
              chunk += ch;
            }
            line = chunk;
          } else line = next;
        } else {
          out.push(line);
          line = word;
        }
      }
      out.push(line);
    }
    return out;
  };
  const lineH = (size: number) => size * 0.3528 * 1.38;
  const newPage = () => {
    doc.addPage();
    y = TOP2;
  };
  const ensure = (h: number) => {
    if (y + h > bottomY) newPage();
  };
  const paragraph = (s: string, f: FontSpec = { family: "Geist", size: 8.4 }, color: Rgb = C.soft, width = contentW, x = M.left) => {
    const lines = wrap(s, width, f);
    const lh = lineH(f.size);
    for (const ln of lines) {
      ensure(lh);
      draw(ln, x, y + f.size * 0.3528 * 0.8, f, color);
      y += lh;
    }
    y += 1.2;
  };
  const heading = (title: string, minSpace = 34) => {
    if (y + minSpace > bottomY) newPage();
    else y += 5;
    draw(title, M.left, y + 4.6, { family: "Display", size: 17 });
    y += 9;
  };

  // ---------- tables: app styling, rich cells, repeated headers, rows never split ----------
  const stash = new WeakMap<object, string[]>();
  const richHooks = (extra?: (d: CellHookData) => void) => ({
    didParseCell: (d: CellHookData) => {
      d.cell.text = d.cell.text.map((t) => t.replace(/₦/g, STANDIN));
      extra?.(d);
    },
    willDrawCell: (d: CellHookData) => {
      // Header cells are redrawn on every page: keep the text stashed the first time.
      if (!stash.has(d.cell)) stash.set(d.cell, d.cell.text);
      d.cell.text = [""];
    },
    didDrawCell: (d: CellHookData) => {
      const lines = stash.get(d.cell);
      if (!lines || lines.every((l) => l === "")) return;
      const c = d.cell;
      const st = c.styles;
      const k = doc.internal.scaleFactor;
      const fs = st.fontSize / k;
      const lh = fs * doc.getLineHeightFactor();
      const pos = c.getTextPos();
      let yy = pos.y + fs * (2 - 1.15);
      if (st.valign === "middle") yy -= (lines.length / 2) * lh;
      else if (st.valign === "bottom") yy -= lines.length * lh;
      const tc = st.textColor;
      const color: Rgb = Array.isArray(tc) ? [tc[0], tc[1], tc[2]] : typeof tc === "number" ? [tc, tc, tc] : C.ink;
      const f: FontSpec = { family: (st.font as Family) || "Geist", bold: st.fontStyle === "bold", size: st.fontSize };
      const align = st.halign === "right" ? "right" : st.halign === "center" ? "center" : "left";
      for (const ln of lines) {
        draw(ln.replace(/¤/g, NAIRA), pos.x, yy, f, color, align);
        yy += lh;
      }
    },
  });
  const baseTable = (opts: UserOptions, extraHook?: (d: CellHookData) => void) => {
    autoTable(doc, {
      startY: y,
      margin: { left: M.left, right: M.right, top: TOP2, bottom: M.bottom },
      theme: "plain",
      headStyles: { font: "Geist", fontStyle: "normal", fontSize: 6.9, textColor: C.ink2, fillColor: C.warm, valign: "bottom" },
      footStyles: { font: "Geist", fontStyle: "bold", fillColor: C.warm, textColor: C.ink, lineWidth: 0 },
      alternateRowStyles: { fillColor: C.panel },
      rowPageBreak: "avoid",
      showHead: "everyPage",
      showFoot: "lastPage",
      ...opts,
      styles: { font: "Geist", fontSize: 7.6, cellPadding: { top: 1.9, bottom: 1.9, left: 2.2, right: 2.2 }, overflow: "linebreak", valign: "top", textColor: C.ink, lineColor: C.line, lineWidth: { bottom: 0.15 }, ...opts.styles },
      ...richHooks(extraHook),
    });
    y = ((doc as unknown as AutoTableDoc).lastAutoTable?.finalY ?? y) + 3;
  };
  const rightNum = { halign: "right", font: "GeistMono" } as const;

  // ================= page 1 =================
  const isDraft = report.status === "draft";
  // brand row
  drawMark(doc, M.left, y, 8.4, C.goldDeep);
  draw("uwii", M.left + 10.6, y + 7.1, { family: "Display", size: 23 });
  const chip = isDraft ? "Draft, not for filing" : "Final";
  const chipF: FontSpec = { family: "Geist", bold: true, size: 8 };
  const chipW = measure(chip, chipF) + 8;
  const chipX = W - M.right - chipW;
  if (isDraft) {
    doc.setFillColor(...C.amberTint);
    doc.setDrawColor(...C.amberLine);
    doc.setLineWidth(0.3);
    doc.roundedRect(chipX, y + 1.2, chipW, 6.6, 3.3, 3.3, "FD");
  } else {
    doc.setFillColor(...C.gold);
    doc.roundedRect(chipX, y + 1.2, chipW, 6.6, 3.3, 3.3, "F");
  }
  draw(chip, chipX + chipW / 2, y + 5.65, chipF, isDraft ? C.amberInk : C.ink, "center");
  draw(`Generated ${utc(generatedAt.toISOString())}`, chipX - 4, y + 5.65, { family: "Geist", size: 7.6 }, C.ink2, "right");
  y += 12;
  doc.setDrawColor(...C.line);
  doc.setLineWidth(0.25);
  doc.line(M.left, y, W - M.right, y);
  doc.setDrawColor(...C.goldDeep);
  doc.setLineWidth(0.7);
  doc.line(M.left, y, M.left + 42, y);
  y += 4;

  // title
  draw("Virtual asset tax computation", M.left, y + 8.4, { family: "Display", size: 27 });
  y += 11.5;
  draw(`Year of assessment ${report.year} · NRS Information Circular No. 2026/21 · Individuals`, M.left, y + 3.4, { family: "Geist", size: 8.6 }, C.ink2);
  y += 7;

  // meta grid
  const accounts = [report.account, ...(personal.ownAccounts ?? []).filter((a) => a && a !== report.account)];
  const meta: [string, string, number][] = [
    ["Account(s)", accounts.join(", "), 2],
    ["Taxpayer", personal.name?.trim() || "not provided", 1.2],
    ["TIN", personal.tin?.trim() || "not provided", 0.9],
    ["State of residence", personal.state?.trim() || "not provided", 0.9],
  ];
  const unit = contentW / meta.reduce((n, m) => n + m[2], 0);
  let mx = M.left;
  let metaH = 0;
  for (const [k, v, span] of meta) {
    draw(k, mx, y + 2.4, { family: "Geist", size: 6.9 }, C.ink2);
    const vf: FontSpec = { family: k === "Account(s)" ? "GeistMono" : "Geist", size: 8.6 };
    const lines = wrap(v, span * unit - 5, vf);
    lines.forEach((ln, i) => draw(ln, mx, y + 7 + i * lineH(8.6), vf, v === "not provided" ? C.ink2 : C.ink));
    metaH = Math.max(metaH, 7 + (lines.length - 1) * lineH(8.6));
    mx += span * unit;
  }
  y += metaH + 4;

  // fingerprint (and anchor) panel
  const anchored = anchor && anchor.fingerprint === report.fingerprint ? anchor : null;
  const anchorText = anchored
    ? `Anchored on NEAR ${anchored.network}: ${anchored.txHash ?? "transaction not located"}, block ${anchored.blockHeight}, ${utc(anchored.anchoredAt)}, contract ${anchored.contractId}`
    : null;
  const anchorLines = anchorText ? wrap(anchorText, contentW - 14, { family: "Geist", size: 7.6 }) : [];
  const fpH = 17 + anchorLines.length * lineH(7.6) + (anchorLines.length ? 1.5 : 0);
  doc.setFillColor(...C.warm);
  doc.roundedRect(M.left, y, contentW, fpH, 2.5, 2.5, "F");
  draw("Report fingerprint (SHA-256)", M.left + 5, y + 5.4, { family: "Geist", size: 6.9 }, C.ink2);
  draw(report.fingerprint, M.left + 5, y + 10.4, { family: "GeistMono", bold: true, size: 9.2 });
  draw(
    "Covers the computation (lines, totals, tax, warnings, decisions, sources, privacy proof); personal fields and other-income inputs are excluded.",
    M.left + 5,
    y + 14.6,
    { family: "Geist", size: 6.9 },
    C.ink2,
  );
  if (anchorLines.length) {
    const ay = y + 19.4;
    doc.setFillColor(...C.goldDeep);
    doc.circle(M.left + 6.2, ay - 1.05, 1.2, "F");
    anchorLines.forEach((ln, i) => draw(ln, M.left + 9.5, ay + i * lineH(7.6), { family: "Geist", size: 7.6 }, C.goldInk));
  }
  y += fpH + 3.5;

  // draft box
  if (isDraft) {
    const bf: FontSpec = { family: "Geist", size: 8 };
    const bullets = report.draftReasons.map((r) => wrap(`• ${r.message}`, contentW - 10, bf));
    const boxH = 10 + bullets.reduce((n, b) => n + b.length, 0) * lineH(8) + 1;
    doc.setFillColor(...C.amberTint);
    doc.setDrawColor(...C.amberLine);
    doc.setLineWidth(0.3);
    doc.roundedRect(M.left, y, contentW, boxH, 2.5, 2.5, "FD");
    const q = report.blockingQuestions;
    draw(`Draft, not for filing${q ? `: answer ${q} question${q === 1 ? "" : "s"} to finalise` : ""}`, M.left + 5, y + 6, { family: "Geist", bold: true, size: 9 }, C.amberInk);
    let by = y + 11;
    for (const b of bullets) {
      for (const ln of b) {
        draw(ln, M.left + 5, by, bf, C.amberInk);
        by += lineH(8);
      }
    }
    y += boxH + 3.5;
  }

  // headline figures
  const t = report.totals;
  const cards: [string, string, boolean][] = [
    ["Total virtual-asset income", t.totalVaIncomeNgn, false],
    ["Net disposal gains", t.netGainsNgn, false],
    ["Chargeable virtual-asset amount", t.chargeableVaNgn, false],
    ["Tax attributable to virtual assets", report.tax.taxAttributableToVaNgn, true],
  ];
  const gap = 4;
  const cardW = (contentW - gap * (cards.length - 1)) / cards.length;
  const cardH = 19.5;
  cards.forEach(([k, v, dark], i) => {
    const cx = M.left + i * (cardW + gap);
    if (dark) {
      doc.setFillColor(...C.ink);
      doc.roundedRect(cx, y, cardW, cardH, 2.5, 2.5, "F");
      doc.saveGraphicsState();
      doc.setGState(new GState({ opacity: 0.1, "stroke-opacity": 0.1 }));
      drawMark(doc, cx + cardW - 20, y + 2, 17, C.white);
      doc.restoreGraphicsState();
    } else {
      doc.setDrawColor(...C.line);
      doc.setLineWidth(0.3);
      doc.roundedRect(cx, y, cardW, cardH, 2.5, 2.5, "S");
    }
    draw(k, cx + 5, y + 6, { family: "Geist", size: 7.4 }, dark ? [200, 198, 192] : C.ink2);
    draw(ngn(v), cx + 5, y + 15.2, { family: "Display", size: 21 }, dark ? C.gold : C.ink);
  });
  y += cardH + 4.5;

  // summary (left) and section subtotals (right), side by side
  const sections = lineSections(report);
  const recon = reconcileSections(sections, t);
  const sec = (id: SectionId) => sections.find((s) => s.id === id)!;
  const leftW = contentW * 0.585;
  const rightX = M.left + leftW + 6;
  const rightW = contentW - leftW - 6;
  // Both tables sit side by side on one page: move them together if they would not fit.
  const compact = { cellPadding: { top: 1.45, bottom: 1.45, left: 2.2, right: 2.2 } };
  const rel = report.tax.reliefs ?? null;
  const summaryRows = 6 + (rel ? 3 : 0);
  if (y + 6 + summaryRows * 5.6 + 5.5 + 8 > bottomY) newPage();
  draw("Summary", M.left, y + 3.6, { family: "Geist", bold: true, size: 9.4 });
  draw("By section", rightX, y + 3.6, { family: "Geist", bold: true, size: 9.4 });
  y += 6;
  const tablesY = y;
  const taxBasis =
    report.tax.basis === "marginal_over_other_income" && report.tax.otherIncomeNgn ? `marginal over other income of ${ngn(report.tax.otherIncomeNgn)}` : "assumes no other income";
  baseTable({
    startY: tablesY,
    margin: { left: M.left, right: W - M.left - leftW, top: TOP2, bottom: M.bottom },
    tableWidth: leftW,
    styles: { ...compact },
    head: [["Item", "Amount", "Basis"]],
    body: [
      ["Total virtual-asset income", ngn(t.totalVaIncomeNgn), "Income at FMV on receipt × NFEM rate (9.5)"],
      ["Net disposal gains", ngn(t.netGainsNgn), `Gains ${ngn(t.disposalGainsNgn)} less losses ${ngn(t.disposalLossesNgn)} (9.1.2 Step 4; 9.4)`],
      ["Chargeable virtual-asset amount", ngn(t.chargeableVaNgn), "Income + max(net gains, 0) (9.4)"],
      ["Tax attributable to virtual assets", ngn(report.tax.taxAttributableToVaNgn), `PIT bands (D6); ${taxBasis}`],
      ...(rel
        ? [
            ["Reliefs and deductions", ngn(rel.totalNgn), `${rel.items.map((i) => `${i.label} ${ngn(i.allowedNgn)}${i.capped ? " (capped)" : ""}`).join("; ")} (NTA 2025 s.30; D15). ${RELIEFS_NOTE}`],
            ["Saved by reliefs", ngn(rel.reliefSavingNgn), `On the crypto tax (without reliefs ${ngn(rel.taxAttributableWithoutReliefsNgn)}); total income tax lower by ${ngn(rel.totalPitSavingNgn)}`],
          ]
        : []),
      ["Loss carried forward", ngn(report.carryForwardLossNgn), "Net disposal loss; not offset against income (9.4)"],
      ["Gas fees total", ngn(t.gasFeesNgn), "Not deductible (D2); each fee is a small NEAR disposal"],
    ],
    columnStyles: { 0: { cellWidth: 50, fontStyle: "bold" }, 1: { cellWidth: "wrap", ...rightNum }, 2: { textColor: C.ink2 } },
  });
  const leftEnd = y;
  y = tablesY;
  const subtotalCell = (s: LineSection) => {
    if (s.id === "not_taxable") return "Not taxable";
    if (s.id === "excluded") return "Not in totals";
    return ngn(s.subtotalNgn);
  };
  baseTable(
    {
      startY: tablesY,
      margin: { left: rightX, right: M.right, top: TOP2, bottom: M.bottom },
      tableWidth: rightW,
      styles: { ...compact },
      head: [["Section", "Rows", "Lines", "Subtotal"]],
      body: sections.map((s) => [s.title, String(s.rows.length), String(s.lineCount), subtotalCell(s)]),
      columnStyles: { 0: { fontStyle: "bold" }, 1: { cellWidth: "wrap", ...rightNum }, 2: { cellWidth: "wrap", ...rightNum }, 3: { cellWidth: "wrap", ...rightNum } },
    },
    (d) => {
      if (d.section === "body" && d.column.index === 3 && (d.row.index === 3 || d.row.index === 4)) {
        d.cell.styles.font = "Geist";
        d.cell.styles.textColor = C.ink2;
      }
    },
  );
  const reconText =
    `Reconciles with the totals: income ${ngn(sec("income").subtotalNgn)}; net disposal gains ${ngn(t.netGainsNgn)} = disposals ${ngn(sec("disposals").subtotalNgn)} + gain on the NEAR spent as gas ${ngn(sec("gas").gainNgn)}; gas fees ${ngn(sec("gas").subtotalNgn)}.` +
    (recon.income && recon.netGains && recon.gas ? "" : " (Mismatch: check the line totals.)");
  paragraph(reconText, { family: "Geist", size: 7 }, C.ink2, rightW, rightX);
  // Tax notes sit in the right column under the reconciliation (page 1 stays one page).
  if (report.tax.notes.length) {
    y += 1;
    const nf: FontSpec = { family: "Geist", size: 7 };
    const notesText = `Notes: ${report.tax.notes.map((n) => n.replace(/\.$/, "")).join(". ")}.`;
    const noteLines = [wrap(notesText, rightW, nf)];
    const need = noteLines.reduce((h, ls) => h + ls.length * lineH(nf.size) + 1.2, 0);
    // They may use the space down to the footer rule; otherwise they flow onto the next page.
    if (y + need <= H - 18) {
      for (const ls of noteLines) {
        for (const ln of ls) {
          draw(ln, rightX, y + nf.size * 0.3528 * 0.8, nf, C.ink2);
          y += lineH(nf.size);
        }
        y += 1.2;
      }
    } else paragraph(notesText, nf, C.ink2, rightW, rightX);
  }
  y = Math.max(y, leftEnd);

  // ================= sections =================
  const d11 = report.lines.some((l) => l.kind === "disposal" && l.noResetGainUsd !== undefined);
  for (const s of sections) {
    // A section starts on a new page only when less than ~25% of the page is left.
    if (bottomY - y < H * 0.25) newPage();
    else y += 6;
    // header bar
    const barH = 10;
    doc.setFillColor(...C.warm);
    doc.roundedRect(M.left, y, contentW, barH, 2, 2, "F");
    const tw = draw(s.title, M.left + 4.5, y + 6.6, { family: "Geist", bold: true, size: 10.6 });
    const count = `${s.rows.length} ${s.rows.length === 1 ? "row" : "rows"}${s.lineCount !== s.rows.length ? ` · ${s.lineCount} lines` : ""}`;
    const cf: FontSpec = { family: "GeistMono", size: 7 };
    const cw = measure(count, cf) + 5;
    doc.setFillColor(...C.white);
    doc.roundedRect(M.left + 4.5 + tw + 3.5, y + 2.6, cw, 4.8, 2.4, 2.4, "F");
    draw(count, M.left + 4.5 + tw + 3.5 + cw / 2, y + 5.95, cf, C.ink2, "center");
    if (s.subtotalNgn !== null) {
      const amt = ngn(s.subtotalNgn);
      const aw = draw(amt, W - M.right - 4.5, y + 6.6, { family: "GeistMono", bold: true, size: 10 }, C.ink, "right");
      draw(s.subtotalLabel ?? "", W - M.right - 4.5 - aw - 3, y + 6.6, { family: "Geist", size: 8 }, C.ink2, "right");
    }
    y += barH + 2.6;
    paragraph(s.explanation, { family: "Geist", size: 7.8 }, C.ink2);
    y += 0.6;

    if (s.rows.length === 0) {
      paragraph("Nothing in this section.", { family: "Geist", size: 8 }, C.ink2);
      continue;
    }
    const cols = sectionColumns(s.id, d11);
    const hasFoot = s.subtotalNgn !== null;
    baseTable({
      head: [cols.map((c) => c.head)],
      body: s.rows.map((r) => cols.map((c) => c.cell(r))),
      ...(hasFoot ? { foot: [cols.map((c) => (c.foot ? c.foot(s) : ""))] } : {}),
      columnStyles: Object.fromEntries(
        cols.map((c, i) => [
          i,
          {
            ...(c.right ? { halign: "right" as const } : {}),
            ...(c.mono ? { font: "GeistMono" } : {}),
            ...(c.width !== undefined ? { cellWidth: c.width } : {}),
          },
        ]),
      ),
    }, (d) => {
      const c = cols[d.column.index];
      if (d.section === "head" && c?.right) d.cell.styles.halign = "right";
      if (d.section === "foot") {
        if (c?.right) {
          d.cell.styles.halign = "right";
          d.cell.styles.font = "GeistMono";
        }
        d.cell.styles.fontStyle = "bold";
      }
      if (d.section === "body" && s.id === "excluded" && c?.head === "Reason") d.cell.styles.textColor = C.amberInk;
      if (d.section === "body" && (c?.head === "Circular ref" || c?.head === "Transaction" || (s.id === "not_taxable" && c?.head === "Tax"))) d.cell.styles.textColor = C.ink2;
    });
    if (cols.includes(rateCol) && s.rows.some((r) => (r.type === "swap" ? r.rateFallback : r.line.rateFallback)))
      paragraph(`* Rate fallback: no ${RATE_LABEL} was published on that date; the most recent prior published date was used (never interpolated).`, { family: "Geist", size: 7 }, C.ink2);
    if (s.id === "disposals")
      paragraph(
        d11
          ? "D11: for pre-2026 lots the reported gain uses cost = higher of original cost or FMV at 2025-12-31 23:59:59 UTC; the no-reset gain uses the original cost."
          : "D11: no pre-2026 lots were consumed in these disposals, so reset-based and no-reset gains are identical. Both legs of each swap are listed in the CSV export (pairingId).",
        { family: "Geist", size: 7 },
        C.ink2,
      );
  }

  // ================= warnings =================
  const warnings = plainWarnings(report);
  heading(`Warnings (${warnings.length})`);
  if (warnings.length === 0) paragraph("None.");
  else
    baseTable({
      head: [["#", "Warning"]],
      body: warnings.map((w, i) => [String(i + 1), w.text]),
      columnStyles: { 0: { cellWidth: 10, font: "GeistMono", textColor: C.ink2 } },
    });
  if (report.warnings.length) paragraph("The technical message for each affected line is in the CSV export.", { family: "Geist", size: 7 }, C.ink2);

  // ================= privacy proof =================
  const p = report.privacyProof;
  heading("Privacy proof");
  paragraph(privacyProofText(p), { family: "Geist", size: 8.2 });
  baseTable({
    head: [["Evidence", "Value"]],
    body: [
      ["Model", p.model ?? "not available"],
      ["Gateway + model attestation reports verified", p.gatewayAndModelReportsVerified === null ? "not needed (no AI decisions)" : p.gatewayAndModelReportsVerified ? "yes" : "NO"],
      ["Attestation checks passed", p.checksPassed === null ? "not available" : `${p.checksPassed}${p.checksTotal !== null ? ` of ${p.checksTotal}` : ""}`],
      ["AI decisions with verified response signatures", `${p.aiDecisionsSignatureVerified} of ${p.aiDecisions}`],
      ["AI responses with verified signatures", `${p.aiResponsesVerified} of ${p.aiResponses}`],
      ["Response signer address(es)", p.signerAddresses.length ? p.signerAddresses.join(", ") : "not available"],
      ["Attested at", p.attestedAt ?? "not available"],
      ...(p.missing.length ? [["Not available", p.missing.join("; ")]] : []),
    ],
    columnStyles: { 0: { cellWidth: 78, fontStyle: "bold" }, 1: { font: "GeistMono" } },
  });

  // ================= ways to pay less, legally =================
  const tips = taxTips(report);
  if (tips.length) {
    heading("Ways to pay less, legally");
    paragraph("Worked out from this report only. Each one cites the rule it relies on.", { family: "Geist", size: 7.6 }, C.ink2);
    baseTable({
      head: [["Tip", "What it means for you", "Amount", "Reference"]],
      body: tips.map((tp) => [tp.title, tp.text, tp.amountNgn !== null ? `${ngn(tp.amountNgn)}${tp.amountLabel ? `\n${tp.amountLabel}` : ""}` : "–", tp.citation]),
      columnStyles: { 0: { cellWidth: 52, fontStyle: "bold" }, 2: { cellWidth: "wrap", halign: "right", font: "GeistMono" }, 3: { cellWidth: 44, textColor: C.ink2 } },
    });
  }

  // ================= what to do next =================
  heading(NEXT_STEPS_TITLE, 30);
  if (isDraft) paragraph(needsRescan(report) ? NEXT_STEPS_RERUN : NEXT_STEPS_DRAFT, { family: "Geist", size: 9 }, C.ink);
  else
    NEXT_STEPS.forEach((st, i) => {
      ensure(12);
      draw(`${i + 1}`, M.left, y + 3, { family: "GeistMono", size: 9 }, C.ink2);
      const before = y;
      paragraph(st.title, { family: "Geist", bold: true, size: 9 }, C.ink, contentW - 8, M.left + 7);
      paragraph(st.body, { family: "Geist", size: 8.6 }, C.ink2, contentW - 8, M.left + 7);
      if (y - before < 4) y = before + 4;
      y += 1;
    });

  // ================= method appendix =================
  const applied = appliedDecisionIds(report);
  heading("Method appendix: decisions");
  baseTable({
    head: [["ID", "Decision", "Applied"]],
    body: DECISION_LOG.map((d) => [d.id, d.text, applied.has(d.id) ? "yes" : "–"]),
    columnStyles: { 0: { cellWidth: 12, font: "GeistMono" }, 2: { cellWidth: 16, textColor: C.ink2 } },
  });
  if (rel) {
    heading("Method appendix: reliefs used (D15)", 30);
    baseTable({
      head: [["Relief", "Rule", "Allowed", "Reference"]],
      body: [
        ...rel.items.map((i) => [i.label, `${RELIEFS.find((d) => d.id === i.id)?.rule ?? ""}${i.capped ? " (cap reached)" : ""}`, ngn(i.allowedNgn), RELIEFS.find((d) => d.id === i.id)?.citation ?? "NTA 2025 s.30"]),
        ["Total", "Deducted from the income base before the bands (D15)", ngn(rel.totalNgn), "NTA 2025 s.30"],
      ],
      columnStyles: { 0: { cellWidth: 52, fontStyle: "bold" }, 2: { cellWidth: "wrap", halign: "right", font: "GeistMono" }, 3: { cellWidth: 52, textColor: C.ink2 } },
    });
    paragraph(`${RELIEFS_NOTE} (D17)`, { family: "Geist", size: 7.6 }, C.amberInk);
  }

  // ================= data sources =================
  heading("Data sources", 28);
  baseTable({
    head: [["Source", "Detail", "Retrieved"]],
    body: report.dataSources.map((s) => [s.name, s.detail, s.retrievedAt ? utc(s.retrievedAt) : "–"]),
    columnStyles: { 0: { cellWidth: 54, fontStyle: "bold" }, 2: { cellWidth: "wrap", font: "GeistMono", textColor: C.ink2 } },
  });
  paragraph(
    `Exchange rates: ${RATE_LABEL}, ₦ per USD. Prices: USD from CoinGecko (granularity shown per line in the CSV); tokens without a verifiable price are excluded (9.2(4)). ` +
      "All amounts are computed at full precision and rounded to 2 decimal places only for display.",
    { family: "Geist", size: 7.2 },
    C.ink2,
  );

  // ================= running header, footer and draft watermark on every page =================
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    if (isDraft) drawWatermark(doc, GState, W, H);
    if (i > 1) {
      drawMark(doc, M.left, 8.6, 4.4, C.goldDeep);
      draw("uwii", M.left + 5.8, 12.3, { family: "Display", size: 12 });
      draw(`Virtual asset tax computation ${report.year} · ${report.account}${isDraft ? " · DRAFT" : ""}`, W - M.right, 12.1, { family: "Geist", size: 7 }, C.ink2, "right");
      doc.setDrawColor(...C.line);
      doc.setLineWidth(0.25);
      doc.line(M.left, 15.4, W - M.right, 15.4);
    }
    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.25);
    doc.line(M.left, H - 16, W - M.right, H - 16);
    const lines = wrap(DISCLAIMER, contentW - 60, { family: "Geist", size: 6.8 });
    lines.forEach((ln, j) => draw(ln, M.left, H - 12 + j * lineH(6.8), { family: "Geist", size: 6.8 }, C.ink2));
    draw(`Page ${i} of ${pages}`, W - M.right, H - 12, { family: "Geist", size: 6.8 }, C.ink2, "right");
    draw(`fp ${report.fingerprint.slice(0, 16)}…`, W - M.right, H - 8.8, { family: "GeistMono", size: 6.3 }, C.ink2, "right");
  }

  return new Uint8Array(doc.output("arraybuffer"));
}

