"use client";

import { useCallback, useMemo, useState } from "react";
import { LineDrawer } from "@/components/report/LineDrawer";
import { NextSteps } from "@/components/report/NextSteps";
import { PrivacyPanel, proofAllVerified, proofCounts } from "@/components/report/PrivacyPanel";
import { Button, ButtonLink, TextButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip, LabelChip, MethodChip } from "@/components/ui/Chip";
import { cx } from "@/components/ui/cx";
import { Money } from "@/components/ui/Money";
import { useReport } from "@/lib/client/useReport";
import { dec } from "@/lib/money";
import { lineAssetText, lineCategory, lineMethod, lineSign, fmtQtyShort, shortLabel, type LineCategory, type MethodFilter } from "@/lib/report/explain";
import { fmtDate, fmtNgn, fmtUsd } from "@/lib/report/format";
import { plainWarnings } from "@/lib/report/warnings";
import { LABELS, type LabelId } from "@/lib/tax/ng/labels";
import type { ReportLine } from "@/lib/tax/ng/engine";
import type { ReportData } from "@/lib/tax/ng/report";

const METHOD_TEXT: Record<MethodFilter, string> = { rule: "rule", ai: "private AI", user: "you", needs: "needs you" };
const CATEGORY_ORDER: LineCategory[] = ["Income", "Purchase", "Disposal", "Swap", "Self transfer", "Gift", "Loan", "Gas", "Opening", "Unresolved", "Other"];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
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

function StatCard({ label, value, note, wide }: { label: string; value: string; note: string; wide?: boolean }) {
  return (
    <Card className={cx("flex gap-2.5 p-5", wide ? "col-span-full flex-wrap items-end justify-between" : "flex-col")}>
      <div className="flex flex-col gap-2.5">
        <span className="text-small text-ink-2">{label}</span>
        <Money value={value} className={cx("leading-none tracking-[-0.01em]", wide ? "text-[clamp(36px,3.4cqi,52px)]" : "text-[clamp(28px,2.6cqi,40px)]")} />
      </div>
      <span className={cx("font-mono text-caption text-ink-2", wide && "text-right")}>{note}</span>
    </Card>
  );
}

/** Decorative seal for the final hero card (the uwii mark, drawn large and faint). */
function Seal() {
  const dots = Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6;
    return [170 + 145 * Math.cos(a), 170 + 145 * Math.sin(a)];
  });
  return (
    <svg aria-hidden="true" viewBox="0 0 340 340" className="pointer-events-none absolute right-[-12%] bottom-[-22%] w-[clamp(220px,52%,340px)] opacity-[0.09]">
      <g fill="#fff">
        <circle cx="170" cy="170" r="145" />
        {dots.map(([x, y]) => (
          <circle key={`${x.toFixed(1)}-${y.toFixed(1)}`} cx={x} cy={y} r="25" />
        ))}
      </g>
    </svg>
  );
}

function incomeNote(r: ReportData): string {
  const inc = r.lines.filter((l) => l.kind === "income" && l.includedInTotals);
  if (!inc.length) return "no income lines";
  const labels = [...new Set(inc.map((l) => l.label))];
  if (labels.length === 1 && labels[0] in LABELS) return `${plural(inc.length, shortLabel(labels[0]).toLowerCase())} · ${LABELS[labels[0] as LabelId].circularRef}`;
  return `${plural(inc.length, "income line")} · 9.5`;
}

function gainsNote(r: ReportData): string {
  const disp = r.lines.filter((l) => l.kind === "disposal" && l.includedInTotals);
  const nil = r.lines.filter((l) => l.kind === "disposal" && l.notes.some((n) => n.startsWith("missing acquisition history"))).length;
  return `${plural(disp.length, "disposal")} · 9.1.2${nil ? ` · ${nil} with nil cost` : ""}`;
}

export default function ResultClient({ account }: { account: string }) {
  const { report, flow, error, retry } = useReport(account);
  const [fLabel, setFLabel] = useState<LineCategory | "All">("All");
  const [fMethod, setFMethod] = useState<MethodFilter | "All">("All");
  const [openLine, setOpenLine] = useState<ReportLine | null>(null);
  const [proofOpen, setProofOpen] = useState(false);
  const [warnOpen, setWarnOpen] = useState(false);
  const closeLine = useCallback(() => setOpenLine(null), []);
  const closeProof = useCallback(() => setProofOpen(false), []);

  const warnings = useMemo(() => (report ? plainWarnings(report) : []), [report]);
  const categories = useMemo(() => (report ? CATEGORY_ORDER.filter((c) => report.lines.some((l) => lineCategory(l) === c)) : []), [report]);
  const methods = useMemo(() => (report ? (["rule", "ai", "user", "needs"] as MethodFilter[]).filter((m) => report.lines.some((l) => lineMethod(l) === m)) : []), [report]);

  if (error && !report) {
    return (
      <Card role="alert" className="mx-auto mt-16 flex max-w-[580px] flex-col items-start gap-4 border-red-line p-7">
        <Chip tone="error">Could not compute your result</Chip>
        <p className="text-ui text-ink-2">{error}</p>
        <Button variant="secondary" onClick={retry}>
          Try again
        </Button>
      </Card>
    );
  }
  if (!report || !flow) {
    return (
      <p role="status" className="py-24 text-center text-ui text-ink-2">
        Computing your 2026 tax…
      </p>
    );
  }

  const r = report;
  const isDraft = r.status === "draft";
  const proof = r.privacyProof;
  const verified = proofAllVerified(proof);
  const counts = proofCounts(proof);
  const proofSummary = proof.aiDecisions === 0 ? "rules only" : `${counts ? `${counts.passed}/${counts.total} checks` : "checks not recorded"} · ${proof.aiResponsesVerified}/${proof.aiResponses} signatures`;
  const shown = r.lines.filter((l) => (fLabel === "All" || lineCategory(l) === fLabel) && (fMethod === "All" || lineMethod(l) === fMethod));
  const q = (path: string) => `${path}?account=${encodeURIComponent(account)}`;
  const firstLineFor = (recordId: string) => r.lines.find((l) => l.recordId === recordId && l.kind !== "gas_fee") ?? r.lines.find((l) => l.recordId === recordId) ?? null;
  const subline = r.tax.basis === "marginal_over_other_income" && r.tax.otherIncomeNgn ? (
    <>
      Marginal over other income of <span className={cx("font-mono", isDraft ? "text-ink" : "text-white")}>₦{fmtNgn(r.tax.otherIncomeNgn).replace(/\.00$/, "")}</span>
    </>
  ) : (
    "Assumes no other income"
  );

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4 pt-[clamp(20px,3cqi,40px)] pb-[clamp(20px,2.4cqi,28px)]">
        <div>
          <h1 className="font-serif text-[clamp(44px,5cqi,72px)] leading-none font-normal tracking-[-0.02em]">Your {r.year} crypto tax</h1>
          <p className="mt-3 text-ui text-ink-2">
            <span className="font-mono">{r.account}</span> · {plural(flow.total, "transaction")} · 1 Jan to 31 Dec {r.year}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="md" onClick={() => setProofOpen(true)}>
            <span aria-hidden="true" className={cx("size-[7px] rounded-full", verified ? "bg-lime-dot" : proof.aiDecisions === 0 ? "bg-ink" : "bg-red-dot")} />
            Privacy proof
          </Button>
          <ButtonLink href={q("/export")} size="md" arrow>
            Export worksheet
          </ButtonLink>
        </div>
      </div>

      {isDraft && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-tile border border-amber-line bg-amber-tint py-3.5 pr-3.5 pl-[18px]">
          <Chip tone="draft" className="bg-surface">
            Draft
          </Chip>
          <div className="flex flex-[1_1_300px] flex-col gap-1 text-ui leading-[1.45] text-[#3F2700]">
            <span className="font-medium">
              {r.blockingQuestions > 0 ? `Answer ${plural(r.blockingQuestions, "question")} to finalise.` : "This report is still a draft."}
            </span>
            <ul className="flex flex-col gap-1 text-small">
              {r.draftReasons.map((d) => (
                <li key={d.code}>{d.message}</li>
              ))}
            </ul>
          </div>
          <ButtonLink href={q("/questions")} size="md" className="h-10">
            Answer questions
          </ButtonLink>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] gap-4">
        {isDraft ? (
          <section aria-label="Provisional tax result" className="flex min-h-[340px] flex-col justify-between gap-9 rounded-hero border border-dashed border-[#BDB9B1] bg-sunken p-[clamp(24px,2.6cqi,36px)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <span className="max-w-[260px] text-ui leading-[1.4] text-ink-2">Tax attributable to your crypto, {r.year}</span>
              <Chip tone="draft">Draft</Chip>
            </div>
            <div>
              <span className="mb-2.5 inline-block font-mono text-caption tracking-[0.08em] text-ink-2 uppercase">Provisional</span>
              <div className="text-[clamp(68px,7.6cqi,116px)] leading-[0.9] tracking-[-0.03em] text-[#5E5A53]">
                <Money value={r.tax.taxAttributableToVaNgn} />
              </div>
              <p className="mt-4 text-ui text-ink-2">
                {subline}. {r.blockingQuestions > 0 ? `May change once ${plural(r.blockingQuestions, "question")} ${r.blockingQuestions === 1 ? "is" : "are"} answered.` : "May change once the draft reasons above are resolved."}
              </p>
            </div>
          </section>
        ) : (
          <section aria-label="Tax result" className="relative flex min-h-[340px] flex-col justify-between gap-9 overflow-hidden rounded-hero bg-ink p-[clamp(24px,2.6cqi,36px)] text-white">
            <Seal />
            <div className="relative flex flex-wrap items-start justify-between gap-3">
              <span className="max-w-[260px] text-ui leading-[1.4] text-onink">Tax attributable to your crypto, {r.year}</span>
              <span className="flex flex-wrap gap-1.5">
                <Chip tone="onInk">Final</Chip>
                {verified ? (
                  <Chip tone="onInk">Verified private</Chip>
                ) : (
                  <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-white/16 bg-white/8 px-3 text-label font-medium text-white">
                    <span aria-hidden="true" className="size-[7px] rounded-full bg-onink" />
                    {proofSummary}
                  </span>
                )}
              </span>
            </div>
            <div className="relative">
              <div className="text-[clamp(68px,7.6cqi,116px)] leading-[0.9] tracking-[-0.03em]">
                <Money value={r.tax.taxAttributableToVaNgn} />
              </div>
              <p className="mt-4 text-ui text-onink">{subline}</p>
            </div>
          </section>
        )}

        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Total VA income" value={r.totals.totalVaIncomeNgn} note={incomeNote(r)} />
          <StatCard label="Net disposal gains" value={r.totals.netGainsNgn} note={gainsNote(r)} />
          <StatCard label="Chargeable VA" value={r.totals.chargeableVaNgn} note="income + net disposal gains" wide />
          <StatCard label="Gas fees (not deductible)" value={r.totals.gasFeesNgn} note={`${plural(r.lines.filter((l) => l.kind === "gas_fee").length, "transaction")} · D2`} />
          <StatCard
            label="Loss carried forward"
            value={r.carryForwardLossNgn}
            note={dec(r.carryForwardLossNgn).gt(0) ? "net disposal loss, carried forward" : `no net disposal loss in ${r.year}`}
          />
        </div>
      </div>

      <div className="mt-4">
        <NextSteps isDraft={isDraft} account={account} />
      </div>

      <Card aria-labelledby="lines-h" className="mt-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3.5 px-[clamp(16px,2cqi,24px)] py-5">
          <h2 id="lines-h" className="text-lg font-semibold tracking-[-0.01em]">
            All lines{" "}
            <span className="font-mono text-small font-normal text-ink-2">
              {shown.length} of {r.lines.length}
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
        </div>

        <div className="hidden overflow-x-auto @min-[760px]:block">
          <table className="w-full min-w-[1100px] border-collapse text-left text-small" aria-labelledby="lines-h">
            <thead>
              <tr className="border-y border-line bg-panel text-caption text-ink-2">
                <th scope="col" className="py-2.5 pr-3 pl-[clamp(16px,2cqi,24px)] font-normal">Date</th>
                <th scope="col" className="px-3 font-normal">Label</th>
                <th scope="col" className="px-3 font-normal">Asset</th>
                <th scope="col" className="px-3 text-right font-normal">Quantity</th>
                <th scope="col" className="px-3 text-right font-normal">USD</th>
                <th scope="col" className="px-3 text-right font-normal">NFEM rate</th>
                <th scope="col" className="px-3 text-right font-normal">NGN value</th>
                <th scope="col" className="px-3 font-normal">Circular ref</th>
                <th scope="col" className="pr-[clamp(16px,2cqi,24px)] pl-3 font-normal">Method</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l, i) => (
                <tr key={`${l.recordId}-${l.kind}-${l.asset}-${l.timestamp}-${i}`} className={cx("relative border-b border-line hover:bg-muted", openLine === l && "bg-page")}>
                  <td className="py-3 pr-3 pl-[clamp(16px,2cqi,24px)] font-mono text-label whitespace-nowrap text-ink-soft">
                    <button type="button" onClick={() => setOpenLine(l)} className="text-left after:absolute after:inset-0 after:content-['']" aria-label={`${shortLabel(l.label)}, ${l.asset}, ${fmtDate(l.timestamp)}: open line detail`}>
                      {fmtDate(l.timestamp)}
                    </button>
                  </td>
                  <td className="px-3">
                    <LabelChip>{shortLabel(l.label)}</LabelChip>
                  </td>
                  <td className="px-3 font-medium">{lineAssetText(l, r.lines)}</td>
                  <td className="px-3 text-right font-mono text-label tabular-nums">
                    {lineSign(l)}
                    {fmtQtyShort(l.qty, false)}
                  </td>
                  <td className="px-3 text-right font-mono text-label tabular-nums">{l.usdValue ? `$${fmtUsd(l.usdValue)}` : l.priceStatus === "no_verifiable_price" ? "no price" : "–"}</td>
                  <td className="px-3 text-right font-mono text-label text-ink-2 tabular-nums">
                    {l.nafemRate ? fmtNgn(l.nafemRate) : "–"}
                    {l.rateFallback && <span title="Prior published rate (no rate on this date)">*</span>}
                  </td>
                  <td className="px-3 text-right font-mono text-label font-medium tabular-nums">{l.ngnValue ? `₦${fmtNgn(l.ngnValue)}` : "–"}</td>
                  <td className="max-w-[260px] px-3 font-mono text-caption leading-[1.35] text-ink-soft">{l.circularRef}</td>
                  <td className="pr-[clamp(16px,2cqi,24px)] pl-3">
                    <MethodChip method={lineMethod(l)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="border-t border-line @min-[760px]:hidden">
          {shown.map((l, i) => (
            <li key={`${l.recordId}-${l.kind}-${l.asset}-${l.timestamp}-${i}`} className="border-b border-line">
              <button
                type="button"
                onClick={() => setOpenLine(l)}
                aria-label={`${shortLabel(l.label)}, ${l.asset}, ${fmtDate(l.timestamp)}: open line detail`}
                className="flex w-full flex-col gap-2 px-4 py-3.5 text-left hover:bg-muted"
              >
                <span className="flex items-center justify-between gap-2">
                  <LabelChip>{shortLabel(l.label)}</LabelChip>
                  <span className="font-mono text-caption text-ink-2">{fmtDate(l.timestamp)}</span>
                </span>
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-ui font-medium">
                    {lineAssetText(l, r.lines)}{" "}
                    <span className="font-mono text-label font-normal text-ink-2">
                      {lineSign(l)}
                      {fmtQtyShort(l.qty, false)}
                    </span>
                  </span>
                  <span className="font-mono text-small font-medium">{l.ngnValue ? `₦${fmtNgn(l.ngnValue)}` : "–"}</span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[11px] text-ink-2">{l.circularRef}</span>
                  <MethodChip method={lineMethod(l)} className="h-[22px] flex-none px-[9px] text-[11px]" />
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-between gap-2 px-[clamp(16px,2cqi,24px)] py-3.5 text-label text-ink-2">
          <span>Select any line to see how it was worked out.</span>
          {r.lines.some((l) => l.rateFallback) && <span>* prior published NFEM rate (no rate on that date)</span>}
        </div>
      </Card>

      <Card className="mt-4 overflow-hidden">
        <button
          type="button"
          aria-expanded={warnOpen}
          aria-controls="warn-list"
          onClick={() => setWarnOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-3 px-[clamp(16px,2cqi,24px)] py-5 text-left"
        >
          <span className="flex items-center gap-2.5 text-lg font-semibold tracking-[-0.01em]">
            Warnings
            <span className="inline-grid h-[26px] min-w-[26px] place-items-center rounded-full bg-amber-tint px-1.5 font-mono text-label font-medium text-amber-ink">{warnings.length}</span>
          </span>
          <span aria-hidden="true" className="grid size-8 place-items-center rounded-full border border-border-strong text-small">
            {warnOpen ? "−" : "+"}
          </span>
        </button>
        {warnOpen && (
          <ol id="warn-list" className="px-[clamp(16px,2cqi,24px)] pb-3">
            {warnings.map((w, i) => {
              const target = w.recordIds.length ? firstLineFor(w.recordIds[0]) : null;
              return (
                <li key={`${w.code}-${i}`} className="flex gap-3.5 border-t border-line py-3.5 text-ui leading-normal">
                  <span className="flex-none pt-[3px] font-mono text-caption text-ink-2">{String(i + 1).padStart(2, "0")}</span>
                  <span className="flex flex-col items-start gap-1.5 text-pretty">
                    {w.text}
                    {target && (
                      <TextButton onClick={() => setOpenLine(target)} className="text-label text-ink-2">
                        {w.recordIds.length > 1 ? `View the first of ${w.recordIds.length} lines` : "View the line"}
                      </TextButton>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      <p className="mt-6 text-label text-ink-2">Computation for review; not tax advice.</p>

      {openLine && <LineDrawer line={openLine} report={r} onClose={closeLine} />}
      {proofOpen && <PrivacyPanel proof={proof} account={account} ruleCount={flow.total - proof.aiDecisions} onClose={closeProof} />}
    </>
  );
}
