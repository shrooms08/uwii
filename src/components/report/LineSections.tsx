"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { LabelChip, MethodChip } from "@/components/ui/Chip";
import { cx } from "@/components/ui/cx";
import { fmtQtyShort, lineCategory, lineMethod, lineSign, shortLabel, type LineCategory, type MethodFilter } from "@/lib/report/explain";
import { fmtDate, fmtNgn, fmtUsd } from "@/lib/report/format";
import { lineSections, rowLines, splitRef, type LineSection, type SectionId, type SectionRow } from "@/lib/report/sections";
import type { ReportLine } from "@/lib/tax/ng/engine";

const METHOD_TEXT: Record<MethodFilter, string> = { rule: "rule", ai: "private AI", user: "you", needs: "needs you" };
const CATEGORY_ORDER: LineCategory[] = ["Income", "Purchase", "Disposal", "Swap", "Self transfer", "Gift", "Loan", "Gas", "Opening", "Unresolved", "Other"];

const ngn = (v: string | null | undefined) => {
  if (v === null || v === undefined || v === "") return "–";
  const t = fmtNgn(v);
  return t.startsWith("-") ? `−₦${t.slice(1)}` : `₦${t}`;
};
const usd = (v: string | null | undefined) => {
  if (v === null || v === undefined || v === "") return "–";
  const t = fmtUsd(v);
  return t.startsWith("-") ? `−$${t.slice(1)}` : `$${t}`;
};
const rate = (v: string | null, fallback: boolean) => (v ? `${fmtNgn(v)}${fallback ? "*" : ""}` : "–");
const qty = (l: ReportLine) => `${lineSign(l)}${fmtQtyShort(l.qty, false)}`;
const legs = (ls: ReportLine[]) => ls.map((l) => `${fmtQtyShort(l.qty)} ${l.asset}`).join(" + ");

/** The line a row opens in the drawer (for a swap: the leg given up). */
const primaryLine = (r: SectionRow) => (r.type === "swap" ? (r.gives[0] ?? r.gets[0]) : r.line);
const rowKey = (r: SectionRow, i: number) => (r.type === "swap" ? r.pairingId : `${r.line.recordId}-${r.line.kind}-${r.line.asset}-${r.line.timestamp}-${i}`);
const rowLabel = (r: SectionRow) => (r.type === "swap" ? "Swap" : shortLabel(r.line.label));
const rowWhat = (r: SectionRow) => (r.type === "swap" ? `${legs(r.gives)} → ${legs(r.gets)}` : r.line.asset);

function RefCell({ circularRef }: { circularRef: string }) {
  const { ref, decision } = splitRef(circularRef);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-caption text-ink-soft">{ref}</span>
      {decision && decision !== ref && (
        <span className="inline-flex h-[18px] items-center rounded-full border border-rule px-1.5 font-mono text-[10px] text-ink-2" title={`Decision ${decision} (see the line detail)`}>
          {decision}
        </span>
      )}
    </span>
  );
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx("h-[30px] flex-none rounded-full border px-3 text-label whitespace-nowrap", on ? "border-ink bg-ink text-white" : "border-border-strong bg-surface text-ink hover:border-ink")}
    >
      {children}
    </button>
  );
}

interface Column {
  head: string;
  align?: "right";
  cell: (r: SectionRow) => ReactNode;
  muted?: boolean;
}

const dateCol: Column = { head: "Date", cell: (r) => fmtDate(r.type === "swap" ? r.timestamp : r.line.timestamp) };
const labelCol: Column = { head: "Label", cell: (r) => <LabelChip>{rowLabel(r)}</LabelChip> };
const assetCol: Column = { head: "Asset", cell: (r) => <span className="font-medium">{rowWhat(r)}</span> };
const qtyCol: Column = { head: "Quantity", align: "right", cell: (r) => qty(primaryLine(r)) };
const usdValueCol: Column = { head: "USD value", align: "right", cell: (r) => (primaryLine(r).usdValue ? usd(primaryLine(r).usdValue) : primaryLine(r).priceStatus === "no_verifiable_price" ? "no price" : "–") };
const rateCol: Column = { head: "NFEM rate", align: "right", muted: true, cell: (r) => (r.type === "swap" ? rate(r.nafemRate, r.rateFallback) : rate(r.line.nafemRate, r.line.rateFallback)) };
const refCol: Column = { head: "Circular ref", cell: (r) => <RefCell circularRef={primaryLine(r).circularRef} /> };
const methodCol: Column = { head: "Method", cell: (r) => <MethodChip method={lineMethod(primaryLine(r))} /> };

const COLUMNS: Record<SectionId, Column[]> = {
  income: [dateCol, labelCol, assetCol, qtyCol, usdValueCol, rateCol, { head: "NGN value", align: "right", cell: (r) => <strong className="font-medium">{ngn(primaryLine(r).incomeNgn ?? primaryLine(r).ngnValue)}</strong> }, refCol, methodCol],
  disposals: [
    dateCol,
    labelCol,
    { head: "What", cell: (r) => <span className="font-medium">{r.type === "swap" ? rowWhat(r) : `${fmtQtyShort(r.line.qty)} ${r.line.asset}`}</span> },
    { head: "Proceeds USD", align: "right", cell: (r) => usd(r.type === "swap" ? r.proceedsUsd : r.line.proceedsUsd) },
    { head: "Cost USD", align: "right", cell: (r) => usd(r.type === "swap" ? r.costUsd : r.line.costUsd) },
    { head: "Gain USD", align: "right", cell: (r) => usd(r.type === "swap" ? r.gainUsd : r.line.gainUsd) },
    rateCol,
    { head: "Gain NGN", align: "right", cell: (r) => <strong className="font-medium">{ngn(r.type === "swap" ? r.gainNgn : r.line.gainNgn)}</strong> },
    refCol,
    methodCol,
  ],
  gas: [dateCol, assetCol, qtyCol, usdValueCol, rateCol, { head: "NGN value", align: "right", cell: (r) => <strong className="font-medium">{ngn(primaryLine(r).ngnValue)}</strong> }, refCol, methodCol],
  not_taxable: [
    dateCol,
    labelCol,
    assetCol,
    qtyCol,
    { ...usdValueCol, muted: true },
    { head: "Tax", cell: () => <span className="text-ink-2">Not taxable</span> },
    refCol,
    methodCol,
  ],
  excluded: [dateCol, labelCol, assetCol, qtyCol, { head: "Reason", cell: (r) => <span className="text-amber-ink">{r.reason}</span> }, refCol, methodCol],
};

/** The figure shown on the right of a stacked (mobile) row. */
function rowFigure(id: SectionId, r: SectionRow): ReactNode {
  const l = primaryLine(r);
  if (id === "income") return ngn(l.incomeNgn ?? l.ngnValue);
  if (id === "disposals") return ngn(r.type === "swap" ? r.gainNgn : l.gainNgn);
  if (id === "gas") return ngn(l.ngnValue);
  if (id === "not_taxable") return <span className="font-sans text-label font-normal text-ink-2">Not taxable</span>;
  return <span className="font-sans text-label font-normal text-amber-ink">{r.reason}</span>;
}

function SectionCard({ section, rows, open, onToggle, openLine, onOpen }: { section: LineSection; rows: SectionRow[]; open: boolean; onToggle: () => void; openLine: ReportLine | null; onOpen: (l: ReportLine) => void }) {
  const cols = COLUMNS[section.id];
  const bodyId = `sec-${section.id}`;
  const hid = `sec-${section.id}-h`;
  const pad = "px-[clamp(16px,2cqi,24px)]";
  return (
    <Card aria-labelledby={hid} className="overflow-clip">
      <div className={cx("sticky top-0 z-10 flex flex-col gap-1.5 border-b border-line bg-surface py-4", pad)}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h3 id={hid} className="flex items-center gap-2.5 text-[17px] font-semibold tracking-[-0.01em]">
            <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={onToggle} className="flex items-center gap-2.5 text-left">
              <span aria-hidden="true" className={cx("grid size-6 place-items-center rounded-full border border-border-strong text-caption transition-transform", open && "rotate-90")}>
                ›
              </span>
              {section.title}
            </button>
            <span className="rounded-full bg-chip px-2 py-0.5 font-mono text-caption font-normal text-ink-2">
              {rows.length === section.rows.length ? section.rows.length : `${rows.length} of ${section.rows.length}`} {section.rows.length === 1 ? "row" : "rows"}
            </span>
          </h3>
          {section.subtotalNgn !== null && (
            <span className="flex items-baseline gap-2 text-small">
              <span className="text-ink-2">{section.subtotalLabel}</span>
              <span className="font-mono text-ui font-semibold tabular-nums">{ngn(section.subtotalNgn)}</span>
            </span>
          )}
        </div>
        <p className="max-w-[860px] text-label leading-normal text-ink-2">{section.explanation}</p>
      </div>

      {open && (
        <div id={bodyId}>
          {rows.length === 0 ? (
            <p className={cx("py-4 text-label text-ink-2", pad)}>{section.rows.length === 0 ? "Nothing in this section." : "No rows match the filters."}</p>
          ) : (
            <>
              <div className="hidden overflow-x-auto @min-[760px]:block">
                <table className="w-full min-w-[980px] border-collapse text-left text-small" aria-labelledby={hid}>
                  <thead>
                    <tr className="border-b border-line bg-panel text-caption text-ink-2">
                      {cols.map((c, i) => (
                        <th
                          key={c.head}
                          scope="col"
                          className={cx("py-2.5 font-normal", c.align === "right" ? "text-right" : "", i === 0 ? "pr-3 pl-[clamp(16px,2cqi,24px)]" : i === cols.length - 1 ? "pr-[clamp(16px,2cqi,24px)] pl-3" : "px-3")}
                        >
                          {c.head}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, ri) => {
                      const l = primaryLine(r);
                      return (
                        <tr key={rowKey(r, ri)} className={cx("relative border-b border-line hover:bg-muted", openLine && rowLines(r).includes(openLine) && "bg-page")}>
                          {cols.map((c, i) => (
                            <td
                              key={c.head}
                              className={cx(
                                "py-3",
                                c.align === "right" && "text-right font-mono text-label tabular-nums",
                                c.muted && "text-ink-2",
                                i === 0 ? "pr-3 pl-[clamp(16px,2cqi,24px)] font-mono text-label whitespace-nowrap text-ink-soft" : i === cols.length - 1 ? "pr-[clamp(16px,2cqi,24px)] pl-3" : "px-3",
                              )}
                            >
                              {i === 0 ? (
                                <button
                                  type="button"
                                  onClick={() => onOpen(l)}
                                  className="text-left after:absolute after:inset-0 after:content-['']"
                                  aria-label={`${rowLabel(r)}, ${rowWhat(r)}, ${fmtDate(l.timestamp)}: open line detail`}
                                >
                                  {c.cell(r)}
                                </button>
                              ) : (
                                c.cell(r)
                              )}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                  {section.subtotalNgn !== null && (
                    <tfoot>
                      <tr className="bg-panel text-small">
                        <td colSpan={cols.findIndex((c) => c.head === "NGN value" || c.head === "Gain NGN")} className="py-3 pr-3 pl-[clamp(16px,2cqi,24px)] font-medium">
                          {section.subtotalLabel} subtotal
                          {section.id === "gas" && section.gainNgn !== undefined && (
                            <span className="ml-2 font-normal text-ink-2">(gain on the NEAR spent, counted in net gains: {ngn(section.gainNgn)})</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-label font-semibold tabular-nums">{ngn(section.subtotalNgn)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              <ul className="@min-[760px]:hidden">
                {rows.map((r, ri) => {
                  const l = primaryLine(r);
                  return (
                    <li key={rowKey(r, ri)} className="border-b border-line last:border-b-0">
                      <button
                        type="button"
                        onClick={() => onOpen(l)}
                        aria-label={`${rowLabel(r)}, ${rowWhat(r)}, ${fmtDate(l.timestamp)}: open line detail`}
                        className="flex w-full flex-col gap-2 px-4 py-3.5 text-left hover:bg-muted"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <LabelChip>{rowLabel(r)}</LabelChip>
                          <span className="font-mono text-caption text-ink-2">{fmtDate(r.type === "swap" ? r.timestamp : l.timestamp)}</span>
                        </span>
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 text-ui font-medium">
                            {r.type === "swap" ? rowWhat(r) : `${l.asset} `}
                            {r.type !== "swap" && <span className="font-mono text-label font-normal text-ink-2">{qty(l)}</span>}
                          </span>
                          <span className="flex-none text-right font-mono text-small font-medium">{rowFigure(section.id, r)}</span>
                        </span>
                        <span className="flex items-center justify-between gap-2">
                          <RefCell circularRef={l.circularRef} />
                          <MethodChip method={lineMethod(l)} className="h-[22px] flex-none px-[9px] text-[11px]" />
                        </span>
                      </button>
                    </li>
                  );
                })}
                {section.subtotalNgn !== null && (
                  <li className="flex items-baseline justify-between gap-3 bg-panel px-4 py-3 text-small">
                    <span className="font-medium">{section.subtotalLabel} subtotal</span>
                    <span className="font-mono font-semibold tabular-nums">{ngn(section.subtotalNgn)}</span>
                  </li>
                )}
              </ul>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

/** All report lines, grouped into the five sections, with label and method filters applied within sections. */
export function LineSections({ lines, openLine, onOpen }: { lines: ReportLine[]; openLine: ReportLine | null; onOpen: (l: ReportLine) => void }) {
  const sections = useMemo(() => lineSections({ lines }), [lines]);
  const [fLabel, setFLabel] = useState<LineCategory | "All">("All");
  const [fMethod, setFMethod] = useState<MethodFilter | "All">("All");
  const categories = useMemo(() => CATEGORY_ORDER.filter((c) => lines.some((l) => lineCategory(l) === c)), [lines]);
  const methods = useMemo(() => (["rule", "ai", "user", "needs"] as MethodFilter[]).filter((m) => lines.some((l) => lineMethod(l) === m)), [lines]);
  const [open, setOpen] = useState<Record<SectionId, boolean>>({ income: true, disposals: true, gas: true, not_taxable: true, excluded: true });

  useEffect(() => {
    // Sections start collapsed on narrow screens (headers still show counts and subtotals).
    if (window.matchMedia("(max-width: 759px)").matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen({ income: false, disposals: false, gas: false, not_taxable: false, excluded: false });
    }
  }, []);

  const matches = (r: SectionRow) =>
    rowLines(r).some((l) => (fLabel === "All" || lineCategory(l) === fLabel) && (fMethod === "All" || lineMethod(l) === fMethod));
  const shownTotal = sections.reduce((n, s) => n + s.rows.filter(matches).length, 0);
  const total = sections.reduce((n, s) => n + s.rows.length, 0);

  return (
    <section aria-labelledby="lines-h" className="mt-4 flex flex-col gap-3">
      <Card className="flex flex-wrap items-center justify-between gap-3.5 px-[clamp(16px,2cqi,24px)] py-5">
        <h2 id="lines-h" className="text-lg font-semibold tracking-[-0.01em]">
          All lines{" "}
          <span className="font-mono text-small font-normal text-ink-2">
            {shownTotal} of {total} rows · {lines.length} lines
          </span>
        </h2>
        <div className="flex flex-wrap gap-x-5 gap-y-3">
          <div role="group" aria-label="Filter by label" className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-caption text-ink-2">Label</span>
            {(["All", ...categories] as const).map((c) => (
              <FilterChip key={c} on={fLabel === c} onClick={() => setFLabel(c)}>
                {c}
              </FilterChip>
            ))}
          </div>
          <div role="group" aria-label="Filter by method" className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-caption text-ink-2">Method</span>
            {(["All", ...methods] as const).map((m) => (
              <FilterChip key={m} on={fMethod === m} onClick={() => setFMethod(m)}>
                {m === "All" ? "All" : METHOD_TEXT[m]}
              </FilterChip>
            ))}
          </div>
        </div>
      </Card>
      {sections.map((s) => (
        <SectionCard
          key={s.id}
          section={s}
          rows={s.rows.filter(matches)}
          open={open[s.id]}
          onToggle={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))}
          openLine={openLine}
          onOpen={onOpen}
        />
      ))}
      <p className="px-1 text-label text-ink-2">
        Select any row to see how it was worked out. A swap is one row; its detail shows both legs.
        {lines.some((l) => l.rateFallback) && " * prior published NFEM rate (no rate on that date)."}
      </p>
    </section>
  );
}
