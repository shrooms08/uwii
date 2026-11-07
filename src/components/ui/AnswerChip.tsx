import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

export function CheckIcon({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" className={className}>
      <path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Selectable answer: a toggle button (aria-pressed). Selected = ink fill + check mark. */
export function AnswerChip({ selected, className, children, ...rest }: { selected: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cx(
        "inline-flex min-h-[38px] items-center gap-1.5 rounded-full border px-[15px] text-small font-medium transition-colors",
        selected ? "border-ink bg-ink text-on-ink" : "border-border-strong bg-surface text-ink hover:border-ink",
        className,
      )}
      {...rest}
    >
      {selected && <CheckIcon size={12} />}
      {children}
    </button>
  );
}
