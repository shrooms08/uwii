"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { useFinishedDemo } from "@/components/CachedLabel";
import { LineSections } from "@/components/report/LineSections";
import { NextSteps } from "@/components/report/NextSteps";
import { proofAllVerified, proofCounts } from "@/lib/report/privacy-summary";
import { ReliefsBreakdown, ReviewCard, TipsCard, reliefSavedText } from "@/components/report/TaxHelp";
import { Button, ButtonLink, TextButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { cx } from "@/components/ui/cx";
import { PercentMark } from "@/components/ui/Mark";
import { Money } from "@/components/ui/Money";
import { useReport } from "@/lib/client/useReport";
import { dec } from "@/lib/money";
import { shortLabel } from "@/lib/report/explain";
import { fmtNgn } from "@/lib/report/format";
import { taxTips } from "@/lib/report/tips";
import { plainWarnings } from "@/lib/report/warnings";
import { LABELS, type LabelId } from "@/lib/tax/ng/labels";
import type { ReportLine } from "@/lib/tax/ng/engine";
import type { ReportData } from "@/lib/tax/ng/report";

// Opened on demand: kept out of the first load.
const LineDrawer = dynamic(() => import("@/components/report/LineDrawer").then((m) => m.LineDrawer), { ssr: false });
const PrivacyPanel = dynamic(() => import("@/components/report/PrivacyPanel").then((m) => m.PrivacyPanel), { ssr: false });

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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

/** Faint "%" mark on the final hero card (decorative). */
function HeroMark() {
  return <PercentMark size="100%" className="pointer-events-none absolute right-[-6%] bottom-[-14%] aspect-square h-auto w-[clamp(200px,44%,300px)] text-white opacity-[0.08]" />;
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
  const [openLine, setOpenLine] = useState<ReportLine | null>(null);
  const [proofOpen, setProofOpen] = useState(false);
  const [warnOpen, setWarnOpen] = useState(false);
  const finishedDemo = useFinishedDemo(account);
  const closeLine = useCallback(() => setOpenLine(null), []);
  const closeProof = useCallback(() => setProofOpen(false), []);

  const warnings = useMemo(() => (report ? plainWarnings(report) : []), [report]);
  const tips = useMemo(() => (report ? taxTips(report) : []), [report]);

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
      // Fills the viewport so the footer does not jump when the report arrives (no layout shift).
      <p role="status" className="flex min-h-[100svh] items-start justify-center pt-24 text-center text-ui text-ink-2">
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
  const q = (path: string) => `${path}?account=${encodeURIComponent(account)}`;
  const rel = r.tax.reliefs ?? null;
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

      {finishedDemo && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-tile border border-border bg-surface py-3.5 pr-3.5 pl-[18px]">
          <p className="max-w-[760px] flex-[1_1_320px] text-small leading-normal text-ink-soft">
            <span className="font-medium text-ink">This is a finished example.</span> It uses the committed classification of {account} and illustrative answers;
            nothing was sent to an AI to show it. Run the real scan to see the attested AI step live.
          </p>
          <ButtonLink href={`/scan?account=${encodeURIComponent(account)}`} size="md" arrow className="h-10">
            Run it live yourself
          </ButtonLink>
        </div>
      )}

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
                <Money value={r.tax.taxAttributableToVaNgn} koboClassName="opacity-80" />
              </div>
              <p className="mt-4 text-ui text-ink-2">
                {subline}. {r.blockingQuestions > 0 ? `May change once ${plural(r.blockingQuestions, "question")} ${r.blockingQuestions === 1 ? "is" : "are"} answered.` : "May change once the draft reasons above are resolved."}
              </p>
              {rel && <p className="mt-2 text-small text-ink-2">{reliefSavedText(rel)}</p>}
            </div>
          </section>
        ) : (
          <section aria-label="Tax result" className="relative flex min-h-[340px] flex-col justify-between gap-9 overflow-hidden rounded-hero bg-ink p-[clamp(24px,2.6cqi,36px)] text-white">
            <HeroMark />
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
              {rel && <p className="mt-2 text-small text-onink">{reliefSavedText(rel)}</p>}
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

      <div className="mt-4 flex flex-col gap-4">
        {rel && <ReliefsBreakdown rel={rel} />}
        <TipsCard
          tips={tips}
          onView={(id) => {
            const l = firstLineFor(id);
            if (l) setOpenLine(l);
          }}
        />
        <ReviewCard />
        <NextSteps isDraft={isDraft} account={account} />
      </div>

      <LineSections lines={r.lines} openLine={openLine} onOpen={setOpenLine} />

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
