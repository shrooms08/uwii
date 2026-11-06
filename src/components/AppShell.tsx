import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "./ui/cx";
import { CachedLabel } from "./CachedLabel";
import { DemoLabel } from "./DemoLabel";
import { Wordmark } from "./ui/Mark";
import { StepBar, StepNav, type StepId } from "./ui/StepNav";

/** Account pill (mono) shown in the header during the flow. */
function AccountPill({ account }: { account: string }) {
  return (
    <span className="inline-flex h-9 max-w-[60vw] min-w-0 items-center gap-2 rounded-full border border-border bg-surface px-3.5 font-mono text-label font-medium">
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-ink" />
      <span className="sr-only">Account </span>
      <span className="truncate">{account}</span>
    </span>
  );
}

/**
 * Product shell: header (mark, step nav, account pill), content, footer with the NearBlocks
 * attribution and the circular reference. Responsive by container width (760px breakpoint).
 */
export function AppShell({ step, account, children, mainClassName, landing }: { step?: StepId; account?: string; children: ReactNode; mainClassName?: string; landing?: boolean }) {
  return (
    <div className="uwii @container flex min-h-screen flex-1 flex-col">
      <div className={cx("mx-auto flex w-full max-w-[1440px] flex-1 flex-col", landing ? "px-[clamp(20px,4cqi,64px)]" : "px-[clamp(16px,4cqi,64px)]")}>
        <header className="flex items-center justify-between gap-4 py-5">
          <Wordmark />
          {step && account && <StepNav current={step} account={account} />}
          <span className="flex min-w-0 items-center gap-4">
            <Link href="/guide" className={cx("text-label font-medium text-ink underline-offset-[3px] hover:underline", account && "hidden @min-[760px]:inline")}>
              Tax guide
            </Link>
            {account ? (
              <AccountPill account={account} />
            ) : (
              <span className="inline-flex h-8 items-center rounded-full border border-border bg-surface px-3.5 text-label font-medium whitespace-nowrap">Tax year 2026</span>
            )}
          </span>
        </header>
        {step && step !== "scan" && <StepBar current={step} />}
        {account && (
          <div className="flex flex-wrap gap-2 empty:hidden">
            <DemoLabel account={account} />
            <CachedLabel account={account} />
          </div>
        )}
        <main className={cx("flex flex-1 flex-col", mainClassName)}>{children}</main>
        <footer className="mt-12 flex flex-wrap justify-between gap-3 border-t border-rule pt-[22px] pb-7 text-label text-ink-2">
          <span data-testid="attribution">
            Powered by{" "}
            <a href="https://nearblocks.io" target="_blank" rel="noreferrer" className="text-ink underline underline-offset-[3px]">
              NearBlocks.io
            </a>{" "}
            APIs
          </span>
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            <span>Computation for review; not tax advice.</span>
            <Link href="/guide" className="text-ink underline underline-offset-[3px]">
              Crypto tax guide
            </Link>
            <Link href="/verify" className="text-ink underline underline-offset-[3px]">
              Verify a report
            </Link>
            <span>Based on NRS Information Circular 2026/21</span>
          </span>
        </footer>
      </div>
    </div>
  );
}
