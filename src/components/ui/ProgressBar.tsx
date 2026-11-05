import { cx } from "./cx";

/** Outlined pill progress bar (scan). value is 0-100. */
export function ProgressBar({ value, label, className }: { value: number; label: string; className?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      aria-label={label}
      className={cx("h-3.5 rounded-full border-[1.5px] border-ink p-0.5", className)}
    >
      <div className="h-full rounded-full bg-ink transition-[width] duration-500 ease-out" style={{ width: `${v}%` }} />
    </div>
  );
}

/** Segmented progress (questions answered): lime = done. Pair it with a visible "x/N" text. */
export function SegmentBar({ total, done, height = "h-1.5", className }: { total: number; done: number; height?: string; className?: string }) {
  return (
    <div aria-hidden="true" className={cx("flex gap-1", className)}>
      {Array.from({ length: Math.max(total, 1) }, (_, i) => (
        <span key={i} className={cx("flex-1 rounded-[9px]", height, i < done ? "bg-lime" : "bg-border")} />
      ))}
    </div>
  );
}
