"use client";

import { ButtonLink, TextButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { fmtNgn } from "@/lib/report/format";
import { REVIEW_COPY, reviewContactUrl } from "@/lib/report/review";
import type { TaxTip } from "@/lib/report/tips";
import { dec } from "@/lib/money";
import { RELIEFS, RELIEFS_NOTE } from "@/lib/tax/ng/reliefs";
import type { TaxReliefs } from "@/lib/tax/ng/engine";

const naira = (v: string) => `₦${fmtNgn(v)}`;

/** One line under the hero: what the reliefs did to the crypto tax (and to total income tax when that differs). */
export function reliefSavedText(rel: TaxReliefs): string {
  const saving = dec(rel.reliefSavingNgn);
  const total = dec(rel.totalPitSavingNgn);
  if (saving.gt(0)) return `Reliefs saved you ${naira(rel.reliefSavingNgn)} on your crypto tax.`;
  return total.gt(0)
    ? `Reliefs saved you ₦0.00 on your crypto tax; they lower the tax on your total income by ${naira(rel.totalPitSavingNgn)}.`
    : "Reliefs saved you ₦0.00: your income after reliefs is already within the 0% band.";
}

/** Small card: each relief as applied (after caps), the total, and the effect. */
export function ReliefsBreakdown({ rel }: { rel: TaxReliefs }) {
  return (
    <Card aria-labelledby="rel-h" className="flex flex-col gap-3 p-[clamp(20px,2.4cqi,28px)]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="rel-h" className="text-lg font-semibold tracking-[-0.01em]">
          Reliefs and deductions
        </h2>
        <span className="font-mono text-caption text-ink-2">NTA 2025 s.30 · D15</span>
      </div>
      <dl className="grid grid-cols-[1fr_auto] text-small">
        {rel.items.map((i) => (
          <div key={i.id} className="contents">
            <dt className="border-b border-line py-2.5 pr-3 text-ink-2">
              {i.label}
              <span className="block text-caption">{RELIEFS.find((r) => r.id === i.id)?.rule}{i.capped ? " (cap reached)" : ""}</span>
            </dt>
            <dd className="border-b border-line py-2.5 text-right font-mono tabular-nums">{naira(i.allowedNgn)}</dd>
          </div>
        ))}
        <dt className="py-2.5 pr-3 font-medium">Total off your income</dt>
        <dd className="py-2.5 text-right font-mono font-medium tabular-nums">{naira(rel.totalNgn)}</dd>
        <dt className="border-t border-line py-2.5 pr-3 text-ink-2">Crypto tax without reliefs</dt>
        <dd className="border-t border-line py-2.5 text-right font-mono tabular-nums">{naira(rel.taxAttributableWithoutReliefsNgn)}</dd>
        <dt className="py-2.5 pr-3 text-ink-2">Saved on your crypto tax</dt>
        <dd className="py-2.5 text-right font-mono tabular-nums">{naira(rel.reliefSavingNgn)}</dd>
        <dt className="py-2.5 pr-3 text-ink-2">Saved on your total income tax</dt>
        <dd className="py-2.5 text-right font-mono tabular-nums">{naira(rel.totalPitSavingNgn)}</dd>
      </dl>
      <p className="rounded-inset border border-amber-line bg-amber-tint px-3.5 py-2.5 text-label leading-normal text-amber-ink">{RELIEFS_NOTE}</p>
    </Card>
  );
}

/** "Ways to pay less, legally": tips from this report only. Renders nothing when no tip applies. */
export function TipsCard({ tips, onView }: { tips: TaxTip[]; onView: (recordId: string) => void }) {
  if (tips.length === 0) return null;
  return (
    <Card aria-labelledby="tips-h" className="flex flex-col p-[clamp(20px,2.4cqi,28px)]">
      <h2 id="tips-h" className="text-lg font-semibold tracking-[-0.01em]">
        Ways to pay less, legally
      </h2>
      <p className="mt-1 text-label text-ink-2">Worked out from your report only. Each one cites the rule it relies on.</p>
      <ul className="mt-3 flex flex-col">
        {tips.map((t) => (
          <li key={t.id} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 border-t border-line py-4">
            <div className="flex min-w-0 flex-[1_1_420px] flex-col items-start gap-1.5">
              <h3 className="text-ui font-semibold">{t.title}</h3>
              <p className="text-small leading-normal text-pretty text-ink-soft">{t.text}</p>
              <span className="flex flex-wrap items-center gap-3">
                <span className="inline-flex h-5 items-center rounded-full border border-rule px-2 font-mono text-caption text-ink-2">{t.citation}</span>
                {t.recordIds.length > 0 && (
                  <TextButton onClick={() => onView(t.recordIds[0])} className="text-label text-ink-2">
                    {t.recordIds.length > 1 ? `View the first of ${t.recordIds.length} lines` : "View the line"}
                  </TextButton>
                )}
              </span>
            </div>
            {t.amountNgn !== null && (
              <div className="flex flex-col items-end gap-0.5">
                <span className="font-mono text-ui font-semibold tabular-nums">{naira(t.amountNgn)}</span>
                {t.amountLabel && <span className="text-caption text-ink-2">{t.amountLabel}</span>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Optional expert review call to action: only when NEXT_PUBLIC_REVIEW_CONTACT_URL is set. */
export function ReviewCard({ url = reviewContactUrl(process.env.NEXT_PUBLIC_REVIEW_CONTACT_URL) }: { url?: string | null }) {
  if (!url) return null;
  return (
    <Card aria-labelledby="review-h" className="flex flex-wrap items-center justify-between gap-4 p-[clamp(20px,2.4cqi,28px)]">
      <div className="flex flex-col gap-1">
        <h2 id="review-h" className="text-lg font-semibold tracking-[-0.01em]">
          {REVIEW_COPY.title}
        </h2>
        <p className="text-small text-ink-2">{REVIEW_COPY.body}</p>
      </div>
      <ButtonLink href={url} variant="secondary" size="md" arrow target="_blank" rel="noreferrer">
        {REVIEW_COPY.button}
      </ButtonLink>
    </Card>
  );
}
