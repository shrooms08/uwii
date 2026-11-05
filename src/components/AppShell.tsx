import type { ReactNode } from "react";
import { cx } from "./ui/cx";
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
          {account ? (
            <AccountPill account={account} />
          ) : (
            <span className="inline-flex h-8 items-center rounded-full border border-border bg-surface px-3.5 text-label font-medium">Tax year 2026</span>
          )}
        </header>
        {step && step !== "scan" && <StepBar current={step} />}
        {account && <DemoLabel account={account} />}
        <main className={cx("flex flex-1 flex-col", mainClassName)}>{children}</main>
        <footer className="mt-12 flex flex-wrap justify-between gap-3 border-t border-rule pt-[22px] pb-7 text-label text-ink-2">
          <span data-testid="attribution">
            Powered by{" "}
            <a href="https://nearblocks.io" target="_blank" rel="noreferrer" className="text-ink underline underline-offset-[3px]">
              NearBlocks.io
            </a>{" "}
            APIs
          </span>
          <span>Based on NRS Information Circular 2026/21</span>
        </footer>
      </div>
    </div>
  );
}
