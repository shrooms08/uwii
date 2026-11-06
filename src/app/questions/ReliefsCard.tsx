"use client";

import { Card } from "@/components/ui/Card";
import { cx } from "@/components/ui/cx";
import { NGN_INPUT_RE, stripNgn } from "@/lib/client/storage";
import { fmtNgn } from "@/lib/report/format";
import { RELIEFS, RELIEFS_NOTE, type ReliefInputKey } from "@/lib/tax/ng/reliefs";
import type { TaxReliefs } from "@/lib/tax/ng/engine";

type Values = Partial<Record<ReliefInputKey, string>>;

function LockNote({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-2 text-label leading-normal text-ink-2">
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" className="mt-0.5 flex-none">
        <rect x="4" y="9" width="12" height="8.5" rx="2" />
        <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
      </svg>
      {children}
    </p>
  );
}

/** Optional reliefs and deductions (NTA 2025 s.30). Amounts stay in this browser and are sent only in request bodies. */
export function ReliefsCard({
  values,
  onChange,
  open,
  onToggle,
  applied,
}: {
  values: Values;
  onChange: (key: ReliefInputKey, v: string) => void;
  open: boolean;
  onToggle: () => void;
  /** Reliefs as applied in the latest computation (null when none). */
  applied: TaxReliefs | null;
}) {
  const entered = RELIEFS.filter((r) => (values[r.input] ?? "").trim() !== "").length;
  return (
    <Card aria-labelledby="reliefs-h" className="flex flex-col gap-3 p-6">
      <h2 id="reliefs-h" className="text-small font-medium">
        <button type="button" aria-expanded={open} aria-controls="reliefs-body" onClick={onToggle} className="flex w-full items-center justify-between gap-3 text-left">
          <span>Reliefs and deductions</span>
          <span className="flex items-center gap-2">
            {entered > 0 && <span className="rounded-full bg-chip px-2 py-0.5 font-mono text-caption font-normal text-ink-2">{entered} entered</span>}
            <span aria-hidden="true" className={cx("grid size-7 place-items-center rounded-full border border-border-strong text-caption transition-transform", open && "rotate-90")}>
              ›
            </span>
          </span>
        </button>
      </h2>
      <p className="text-label leading-normal text-ink-2">Optional. Each one is taken off your income before the tax bands apply (Nigeria Tax Act 2025 s.30).</p>
      <p className="rounded-inset border border-amber-line bg-amber-tint px-3 py-2 text-caption leading-normal text-amber-ink">{RELIEFS_NOTE}</p>
      {open && (
        <div id="reliefs-body" className="flex flex-col gap-4 border-t border-line pt-4">
          {RELIEFS.map((r) => {
            const value = values[r.input] ?? "";
            const stripped = stripNgn(value);
            const invalid = stripped !== "" && !NGN_INPUT_RE.test(stripped);
            const id = `relief-${r.id}`;
            const item = applied?.items.find((i) => i.id === r.id);
            return (
              <div key={r.id} className="flex flex-col gap-1.5">
                <label htmlFor={id} className="text-label font-medium">
                  {r.inputLabel}
                </label>
                <span className={cx("flex h-[42px] items-center rounded-full border pr-1.5 pl-4", invalid ? "border-red-dot" : "border-border-strong")}>
                  <span aria-hidden="true" className="font-mono text-ink-2">
                    ₦
                  </span>
                  <input
                    id={id}
                    inputMode="decimal"
                    autoComplete="off"
                    value={value}
                    onChange={(e) => onChange(r.input, e.target.value)}
                    placeholder="0"
                    aria-invalid={invalid || undefined}
                    aria-describedby={`${id}-help`}
                    className="h-9 min-w-0 flex-1 rounded-full px-2 font-mono text-small text-ink"
                  />
                </span>
                <p id={`${id}-help`} className="text-caption leading-normal text-ink-2">
                  {r.explanation}
                  {r.capNgn ? ` Capped at ₦${fmtNgn(r.capNgn).replace(/\.00$/, "")}.` : ""}
                  {item && !invalid ? ` Applied: ₦${fmtNgn(item.allowedNgn)}${item.capped ? " (capped)" : ""}.` : ""}
                </p>
                {invalid && (
                  <p role="alert" className="text-caption text-red-ink">
                    Use digits only, with up to 2 decimal places (commas are fine).
                  </p>
                )}
              </div>
            );
          })}
          {applied && (
            <p className="flex items-baseline justify-between gap-3 border-t border-line pt-3 text-small">
              <span className="text-ink-2">Total reliefs applied</span>
              <span className="font-mono font-medium tabular-nums">₦{fmtNgn(applied.totalNgn)}</span>
            </p>
          )}
        </div>
      )}
      <LockNote>Stays in your browser.</LockNote>
    </Card>
  );
}
