"use client";

import { useRef } from "react";
import { CheckIcon } from "@/components/ui/AnswerChip";
import { ButtonLink } from "@/components/ui/Button";
import { LabelChip, MethodChip } from "@/components/ui/Chip";
import { cx } from "@/components/ui/cx";
import { Money } from "@/components/ui/Money";
import { useModal } from "@/components/ui/useModal";
import { lineMethod, lineTitle, plainExplanation, shortLabel, swapCounterpart, treatment } from "@/lib/report/explain";
import { fmtDate, fmtNgn, fmtPrice, fmtQty, fmtUsd } from "@/lib/report/format";
import type { ReportLine } from "@/lib/tax/ng/engine";
import type { ReportData } from "@/lib/tax/ng/report";

const shortHash = (h: string) => (h.length > 12 ? `${h.slice(0, 4)}…${h.slice(-4)}` : h);
const shortId = (h: string) => (h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h);
const usd = (v: string | null | undefined) => {
  if (v === null || v === undefined) return null;
  const t = fmtUsd(v);
  return t.startsWith("-") ? `−$${t.slice(1)}` : `$${t}`;
};
const ngn = (v: string | null | undefined) => (v === null || v === undefined ? null : `₦${fmtNgn(v)}`);
const utc = (iso: string) => `${fmtDate(iso)}, ${iso.slice(11, 19)} UTC`;

function Facts({ rows }: { rows: [string, string | null][] }) {
  const shown = rows.filter((r): r is [string, string] => r[1] !== null);
  return (
    <dl className="grid grid-cols-[auto_1fr] text-small">
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="border-b border-line py-[11px] pr-4 text-ink-2">{k}</dt>
          <dd className="border-b border-line py-[11px] text-right font-mono text-label break-words tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Line detail drawer (design 05): how one line was worked out, from the report's own values. */
export function LineDrawer({ line, report, onClose }: { line: ReportLine; report: ReportData; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useModal(true, panel, onClose);

  const method = lineMethod(line);
  const ai = line.recordId ? report.privacyProof.aiEvidence?.find((e) => e.recordId === line.recordId) : undefined;
  const lineWarnings = line.recordId ? report.warnings.filter((w) => w.recordId === line.recordId) : [];
  const other = swapCounterpart(line, report.lines);

  let priceText: string | null;
  let sourceText: string | null;
  if (line.priceStatus === "ok") {
    priceText = `$${fmtPrice(line.usdPrice)} / ${line.asset}`;
    sourceText = [line.priceSource, line.priceGranularity].filter(Boolean).join(" ") || line.priceMethod;
  } else if (line.priceStatus === "no_verifiable_price") {
    priceText = "No verifiable price (9.2(4))";
    sourceText = line.priceMethod ? `Checked: ${line.priceMethod}` : null;
  } else {
    priceText = "Not needed";
    sourceText = line.label === "acquisition_fiat" || line.label === "disposal_sale_fiat" ? "Naira amount you gave" : null;
  }
  const rateText = line.nafemRate
    ? `₦${fmtNgn(line.nafemRate)} · ${fmtDate(line.rateDate ?? line.date).replace(/^0/, "")}${line.rateFallback ? ` (none published on ${fmtDate(line.date).replace(/^0/, "")})` : ""}`
    : null;

  const facts: [string, string | null][] = [
    ["Date", utc(line.timestamp)],
    ["Quantity", `${fmtQty(line.qty)} ${line.asset}`],
    ["USD price", priceText],
    ["Price source", sourceText],
    ["Value (USD)", usd(line.usdValue)],
    ["CBN NFEM (formerly NAFEM) rate", rateText],
    ["NFEM rate fallback", line.nafemRate ? (line.rateFallback ? "Yes, prior published date" : "No") : null],
    ["Value (NGN)", ngn(line.ngnValue)],
    ["Income (USD)", usd(line.incomeUsd)],
    ["Cost (USD)", usd(line.costUsd)],
    ["Proceeds (USD)", usd(line.proceedsUsd)],
    ["FMV received (USD)", usd(line.fmvReceivedUsd)],
    ["Gain (USD)", usd(line.gainUsd)],
    ["Cost without D11 reset (USD)", usd(line.noResetCostUsd)],
    ["Gain without D11 reset (USD)", usd(line.noResetGainUsd)],
    ["In the totals", line.includedInTotals ? "Yes" : "No"],
  ];
  if (other) facts.splice(2, 0, [line.label === "disposal_swap" ? "Received" : "Gave up", `${fmtQty(other.qty)} ${other.asset}`]);

  const big: { k: string; v: string } | null = line.gainNgn ? { k: "Gain (NGN)", v: line.gainNgn } : line.incomeNgn ? { k: "Income (NGN)", v: line.incomeNgn } : null;
  const tech = treatment(line.label);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-ink/32" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="line-h"
        tabIndex={-1}
        className="relative flex h-full w-[min(520px,100%)] flex-col gap-[22px] overflow-y-auto bg-surface px-[clamp(20px,2.4cqi,32px)] pt-6 pb-8 shadow-[-24px_0_64px_-24px_rgb(14_14_12/0.35)] outline-none"
      >
        <div className="flex items-center justify-between">
          <span className="font-mono text-caption tracking-[0.06em] text-ink-2 uppercase">Line detail</span>
          <button type="button" onClick={onClose} aria-label="Close line detail" data-autofocus className="grid size-10 place-items-center rounded-full border border-border-strong bg-surface text-lg leading-none hover:border-ink">
            ×
          </button>
        </div>
        <div className="flex flex-col gap-3.5">
          <h2 id="line-h" className="font-serif text-[34px] leading-[1.05] font-normal tracking-[-0.01em] text-balance">
            {lineTitle(line, report.lines)}
          </h2>
          <div className="flex flex-wrap gap-1.5">
            <LabelChip className="h-7 px-3 text-label">{shortLabel(line.label)}</LabelChip>
            <MethodChip method={method} className="h-7 px-3 text-label" />
          </div>
        </div>
        <div className="flex flex-col gap-2 rounded-tile bg-muted p-[18px]">
          <span className="text-caption text-ink-2">NRS Circular 2026/21</span>
          <span className="font-mono text-small font-medium">{line.circularRef}</span>
          <p className="text-ui leading-normal text-pretty">{plainExplanation(line)}</p>
          {tech && <p className="text-label leading-normal text-ink-2">Rule: {tech}</p>}
        </div>

        <Facts rows={facts} />

        {big && (
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-small text-ink-2">{big.k}</span>
            <Money value={big.v} className="text-[40px] leading-none" />
          </div>
        )}

        {line.notes.length > 0 && (
          <section aria-labelledby="line-notes" className="flex flex-col gap-2">
            <h3 id="line-notes" className="text-small font-semibold">
              How it was worked out
            </h3>
            <ul className="flex flex-col gap-1.5">
              {line.notes.map((n) => (
                <li key={n} className="rounded-inset bg-muted px-3.5 py-2.5 font-mono text-caption leading-normal break-words text-ink-soft">
                  {n}
                </li>
              ))}
            </ul>
          </section>
        )}

        {lineWarnings.length > 0 && (
          <section aria-labelledby="line-warn" className="flex flex-col gap-2">
            <h3 id="line-warn" className="text-small font-semibold">
              Warnings on this transaction
            </h3>
            <ul className="flex flex-col gap-1.5">
              {lineWarnings.map((w, i) => (
                <li key={`${w.code}-${i}`} className="rounded-inset border border-amber-line bg-amber-tint px-3.5 py-2.5 text-caption leading-normal break-words text-amber-ink">
                  <span className="font-mono">{w.code}</span>: {w.message}
                </li>
              ))}
            </ul>
          </section>
        )}

        {line.txHash ? (
          <a
            href={`https://nearblocks.io/txns/${line.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="flex h-12 items-center justify-between gap-3 rounded-full border border-border-strong px-[18px] text-small hover:border-ink"
          >
            <span>Transaction on NearBlocks</span>
            <span className="font-mono text-label" title={line.txHash}>
              {shortHash(line.txHash)} ↗<span className="sr-only"> (opens in a new tab)</span>
            </span>
          </a>
        ) : null}

        {ai && (method === "ai" || method === "needs" || method === "user") && (
          <div
            className={cx(
              "flex items-center gap-3 rounded-inset border px-4 py-3.5 text-small font-medium",
              ai.signatureVerified ? "border-lime-line bg-lime-tint text-lime-ink" : "border-red-line bg-red-tint text-red-ink",
            )}
          >
            <span className={cx("grid size-6 flex-none place-items-center rounded-full", ai.signatureVerified ? "bg-lime text-ink" : "bg-white text-red-ink")}>
              {ai.signatureVerified ? <CheckIcon size={12} /> : <span aria-hidden="true">!</span>}
            </span>
            <span className="flex-1">
              {method === "user" ? "Answered by you; first classified privately" : "Classified privately"}
              {ai.signatureVerified ? " · signature verified" : ` · signature NOT verified${ai.detail ? `: ${ai.detail}` : ""}`}
            </span>
            <span className="font-mono text-caption font-normal" title={`Chat ${ai.chatId}`}>
              chat {shortId(ai.chatId)}
            </span>
          </div>
        )}

        {method === "needs" && (
          <ButtonLink href={`/questions?account=${encodeURIComponent(report.account)}`} arrow size="md" className="self-start">
            Answer on the Questions page
          </ButtonLink>
        )}
      </div>
    </div>
  );
}
