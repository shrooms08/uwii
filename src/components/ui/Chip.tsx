import type { ReactNode } from "react";
import { cx } from "./cx";

export type StatusTone = "verified" | "final" | "draft" | "needs" | "neutral" | "error" | "onInk";

const tones: Record<StatusTone, { chip: string; dot: string }> = {
  verified: { chip: "bg-gold-tint border border-gold-line text-gold-ink", dot: "bg-gold-dot" },
  final: { chip: "bg-gold-tint border border-gold-line text-gold-ink", dot: "bg-gold-dot" },
  draft: { chip: "bg-amber-tint border border-amber-line text-amber-ink", dot: "bg-amber-dot" },
  needs: { chip: "bg-ink text-on-ink border border-ink", dot: "bg-on-ink" },
  neutral: { chip: "bg-surface border border-border text-ink", dot: "bg-ink" },
  error: { chip: "bg-red-tint border border-red-line text-red-ink", dot: "bg-red-dot" },
  onInk: { chip: "bg-gold-tint border border-gold-line text-gold-ink", dot: "bg-gold" },
};

/** Status chip: dot + text (colour is never the only signal). */
export function Chip({ tone, size = "md", children, className }: { tone: StatusTone; size?: "md" | "sm"; children: ReactNode; className?: string }) {
  const t = tones[tone];
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium whitespace-nowrap",
        size === "md" ? "h-7 px-3 text-label" : "h-[26px] px-[11px] text-caption",
        t.chip,
        className,
      )}
    >
      <span aria-hidden="true" className={cx("rounded-full", size === "md" ? "size-[7px]" : "size-1.5", t.dot)} />
      {children}
    </span>
  );
}

/** Table label chip (Income, Disposal, Swap, Self transfer…). */
export function LabelChip({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex h-6 items-center rounded-full border border-rule px-2.5 text-caption font-medium whitespace-nowrap", className)}>{children}</span>;
}

export type Method = "rule" | "ai" | "user" | "needs";

const methods: Record<Method, { text: string; cls: string }> = {
  rule: { text: "rule", cls: "border-border bg-chip text-ink-soft" },
  ai: { text: "private AI", cls: "border-gold-line bg-gold-tint text-gold-ink" },
  user: { text: "you", cls: "border-ink bg-surface text-ink" },
  needs: { text: "needs you", cls: "border-ink bg-ink text-on-ink" },
};

/** Who labelled a line: rule / private AI / you / needs you. */
export function MethodChip({ method, className }: { method: Method; className?: string }) {
  const m = methods[method];
  return <span className={cx("inline-flex h-6 items-center rounded-full border px-2.5 text-caption font-medium whitespace-nowrap", m.cls, className)}>{m.text}</span>;
}
