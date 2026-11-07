import Link from "next/link";
import { CheckIcon } from "./AnswerChip";
import { cx } from "./cx";

export type StepId = "scan" | "questions" | "result" | "export";

const STEPS: { id: StepId; label: string; path: string }[] = [
  { id: "scan", label: "Scan", path: "/scan" },
  { id: "questions", label: "Questions", path: "/questions" },
  { id: "result", label: "Result", path: "/result" },
  { id: "export", label: "Export", path: "/export" },
];

const item = "flex h-9 items-center gap-2 rounded-full pr-4 pl-2 text-small font-medium";

/**
 * Pill progress nav (wide containers) and a segmented bar with "Step n of 4" (narrow containers).
 * Done steps are links back; the current step carries aria-current; the step right after the current
 * one is a link (you may move on with a draft); later steps are plain text.
 */
export function StepNav({ current, account }: { current: StepId; account: string }) {
  const at = STEPS.findIndex((s) => s.id === current);
  const href = (path: string) => `${path}?account=${encodeURIComponent(account)}`;
  return (
    <>
      <nav aria-label="Progress" className="hidden gap-0.5 rounded-full border border-border bg-surface p-1 @min-[760px]:flex">
        {STEPS.map((s, i) => {
          if (i === at) {
            return (
              <span key={s.id} aria-current="step" className={cx(item, "bg-ink text-on-ink")}>
                <span className="grid size-5 place-items-center rounded-full bg-on-ink font-mono text-[11px] font-medium text-ink">{i + 1}</span>
                {s.label}
              </span>
            );
          }
          const done = i < at;
          const badge = done ? (
            <span className="grid size-5 place-items-center rounded-full bg-gold text-on-ink">
              <CheckIcon size={11} />
            </span>
          ) : (
            <span className="grid size-5 place-items-center rounded-full border border-border-strong font-mono text-[11px]">{i + 1}</span>
          );
          const content = (
            <>
              {badge}
              {s.label}
              <span className="sr-only">{done ? " (done)" : " (not started)"}</span>
            </>
          );
          return done || i === at + 1 ? (
            <Link key={s.id} href={href(s.path)} className={cx(item, done ? "text-ink" : "text-ink-2", "hover:bg-chip")}>
              {content}
            </Link>
          ) : (
            <span key={s.id} className={cx(item, "text-ink-2")}>
              {content}
            </span>
          );
        })}
      </nav>
    </>
  );
}

/** Narrow-screen progress: four segments and "Step n of 4 · Label". */
export function StepBar({ current }: { current: StepId }) {
  const at = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="flex flex-col gap-2 pt-1 pb-2 @min-[760px]:hidden">
      <div aria-hidden="true" className="flex gap-1">
        {STEPS.map((s, i) => (
          <span key={s.id} className={cx("h-1 flex-1 rounded-[9px]", i < at ? "bg-gold" : i === at ? "bg-ink" : "bg-border-strong")} />
        ))}
      </div>
      <span className="text-label text-ink-2">
        Step {at + 1} of {STEPS.length} · {STEPS[at].label}
      </span>
    </div>
  );
}
