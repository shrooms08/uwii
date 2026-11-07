import Link from "next/link";
import type { ReactNode } from "react";

/** Shared layout for the 404 and error pages: a chip, a serif heading, one line, and the way back. */
export function StatusPage({ chip, title, children, actions }: { chip: string; title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section aria-labelledby="status-h" className="mx-auto flex w-full max-w-[640px] flex-col items-start gap-5 py-[clamp(48px,8cqi,120px)]">
      <span className="inline-flex h-7 items-center rounded-full border border-border bg-surface px-3 font-mono text-caption text-ink-2">{chip}</span>
      <h1 id="status-h" className="font-serif text-[clamp(44px,5.4cqi,72px)] leading-none font-normal tracking-[-0.045em] text-balance">
        {title}
      </h1>
      <div className="text-body leading-[1.55] text-pretty text-ink-2">{children}</div>
      <div className="flex flex-wrap items-center gap-3">
        {actions}
        <Link href="/" className="inline-flex h-12 items-center rounded-full border border-border-strong bg-surface px-6 text-ui font-medium text-ink hover:border-ink">
          Back to the start
        </Link>
      </div>
    </section>
  );
}
