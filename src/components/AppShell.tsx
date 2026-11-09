import Link from "next/link";
import type { ReactNode } from "react";
import { FinishedReportButton } from "@/app/FinishedReportButton";
import { REPO_URL } from "@/content/landing";
import { DEMO_ACCOUNT } from "@/lib/demo/illustrative-answers";
import { cx } from "./ui/cx";
import { ClearDataButton } from "./ClearDataButton";
import { CachedLabel } from "./CachedLabel";
import { DemoLabel } from "./DemoLabel";
import { MotionRoot } from "./Motion";
import { NavStartButton } from "./NavStartButton";
import { Wordmark } from "./ui/Mark";
import { StepBar, StepNav, type StepId } from "./ui/StepNav";

/** Account pill (mono) shown in the header during the flow. */
function AccountPill({ account }: { account: string }) {
  return (
    <span className="inline-flex h-9 max-w-[52vw] min-w-0 items-center gap-2 rounded-control border border-border bg-sunken px-3 font-mono text-label font-medium">
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-gold shadow-[0_0_8px_rgb(230_187_121_/0.8)]" />
      <span className="sr-only">Account </span>
      <span className="truncate">{account}</span>
    </span>
  );
}

/** Page gutter: 16-64px (about 58px on a 1440px screen). */
const GUTTER = "px-[clamp(16px,4vw,64px)]";
/** Landing: wide layout (1600px); app screens keep 1440px. */
const WIDTH = (landing?: boolean) => (landing ? "max-w-[1600px]" : "max-w-[1440px]");

const navLink = "rounded-[8px] px-3 py-2 text-label text-ink-2 transition-colors duration-200 hover:bg-white/[0.04] hover:text-ink";

const footLink = "text-small text-ink-2 transition-colors duration-200 hover:text-ink";

function FootCol({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-mono text-eyebrow font-medium text-ink-3 uppercase">{title}</h2>
      <ul className="flex flex-col gap-2.5">{children}</ul>
    </div>
  );
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={footLink}>
      {children}
      <span aria-hidden="true" className="text-ink-3">
        {" "}
        <span className="sys-glyph">↗</span>
      </span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/**
 * Product shell: a floating pill header (landing: section links and the two calls to action; flow: step
 * nav and account), content, and a three-column footer with the NearBlocks attribution, the disclaimer
 * and the painting credit. Responsive by container width (760px breakpoint).
 */
export function AppShell({
  step,
  account,
  children,
  mainClassName,
  landing,
  recordedAt,
}: {
  step?: StepId;
  account?: string;
  children: ReactNode;
  mainClassName?: string;
  landing?: boolean;
  /** Landing only: when the demo run was recorded (the nav's "See a finished report"). */
  recordedAt?: string;
}) {
  return (
    <div className="uwii @container flex min-h-screen flex-1 flex-col overflow-x-clip">
      <MotionRoot />
      {/* Sticky header, full width: transparent at the very top, glass with a hairline once scrolled (html[data-scrolled]). */}
      <header className="uwii-header sticky top-0 z-50 w-full border-b border-transparent">
        <div className={cx("mx-auto flex h-[71px] w-full items-center justify-between gap-3", WIDTH(landing), GUTTER)}>
          <Wordmark />
          {landing && (
            <nav aria-label="Sections" className="hidden items-center gap-0.5 @min-[900px]:flex">
              <Link href="/#how" className={navLink}>
                How it works
              </Link>
              <Link href="/#trust" className={navLink}>
                Trust
              </Link>
              <Link href="/guide" className={navLink}>
                Guide
              </Link>
              <Link href="/verify" className={navLink}>
                Verify
              </Link>
            </nav>
          )}
          {step && account && <StepNav current={step} account={account} />}
          <span className="flex min-w-0 items-center gap-2">
            {landing ? (
              <>
                {recordedAt && (
                  <span className="hidden @min-[760px]:contents">
                    <FinishedReportButton recordedAt={recordedAt} compact />
                  </span>
                )}
                <NavStartButton />
              </>
            ) : (
              <>
                <Link href="/guide" className={cx(navLink, account && "hidden @min-[760px]:inline")}>
                  Tax guide
                </Link>
                {account ? (
                  <AccountPill account={account} />
                ) : (
                  <span className="inline-flex h-9 items-center rounded-control border border-border px-3 font-mono text-[11px] font-medium tracking-[0.12em] whitespace-nowrap text-ink-2 uppercase">
                    Tax year 2026
                  </span>
                )}
              </>
            )}
          </span>
        </div>
      </header>
      <div className={cx("mx-auto flex w-full flex-1 flex-col", WIDTH(landing), GUTTER)}>
        {step && step !== "scan" && <StepBar current={step} />}
        {account &&
          (account === DEMO_ACCOUNT ? (
            // The demo labels depend on this browser's storage, so they appear after hydration. For the demo
            // account (the only one they can show for) the row's height is reserved by an invisible chip with
            // the longest label text, stacked under the real one: no layout shift when it appears.
            <div className="grid">
              <p aria-hidden="true" className="invisible inline-flex items-center gap-2 self-start rounded-[14px] border px-3 py-1 text-label font-medium [grid-area:1/1]">
                <span className="size-[7px] rounded-full" />
                Cached demo result · attestation recorded 2026-11-05 22:54 UTC
              </p>
              <div className="flex flex-wrap gap-2 self-start [grid-area:1/1]">
                <DemoLabel account={account} />
                <CachedLabel account={account} />
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 empty:hidden">
              <DemoLabel account={account} />
              <CachedLabel account={account} />
            </div>
          ))}
        <main className={cx("flex min-h-[calc(100svh-72px)] flex-1 flex-col", mainClassName)}>{children}</main>
        <footer className="mt-16 w-full border-t border-white/8 pt-12 pb-10">
          <div className="grid gap-10 @min-[760px]:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div className="flex max-w-[340px] flex-col gap-4">
              <Wordmark />
              <p className="text-small leading-[1.6] text-ink-2">
                A private crypto-tax agent on NEAR, for individuals filing under NRS Information Circular 2026/21.
              </p>
            </div>
            <FootCol title="Product">
              <li>
                <Link href="/" className={footLink}>
                  Start a private scan
                </Link>
              </li>
              <li>
                <Link href="/guide" className={footLink}>
                  Crypto tax guide
                </Link>
              </li>
              <li>
                <Link href="/verify" className={footLink}>
                  Verify a report
                </Link>
              </li>
            </FootCol>
            <FootCol title="Proof">
              <li>
                <Ext href={`${REPO_URL}/blob/main/src/lib/tax/ng/engine.test.ts`}>Tests on GitHub</Ext>
              </li>
              <li>
                <Ext href="https://testnet.nearblocks.io/address/uwii-anchor.testnet">Anchor contract</Ext>
              </li>
              <li>
                <Ext href={`${REPO_URL}/blob/main/docs/SECURITY-AUDIT.md`}>Security audit</Ext>
              </li>
            </FootCol>
            <FootCol title="Project">
              <li>
                <Ext href={REPO_URL}>GitHub</Ext>
              </li>
              <li>
                <Ext href={`${REPO_URL}/blob/main/docs/CREDITS.md`}>Credits</Ext>
              </li>
              <li>
                <ClearDataButton className="text-left text-small text-ink-2 transition-colors duration-200 hover:text-ink" />
              </li>
            </FootCol>
          </div>
          <div className="mt-12 flex flex-col gap-2 border-t border-white/8 pt-6 text-caption leading-[1.6] text-ink-3">
            <p>Computation for review; not tax advice. Based on NRS Information Circular 2026/21.</p>
            <p className="flex flex-wrap gap-x-6 gap-y-1">
              <span data-testid="attribution">
                Powered by{" "}
                <a href="https://nearblocks.io" target="_blank" rel="noreferrer" className="text-ink-2 underline underline-offset-[3px] hover:text-ink">
                  NearBlocks.io
                </a>{" "}
                APIs
              </span>
              <span>
                Glyph art after Marinus van Reymerswaele,{" "}
                <a
                  href="https://commons.wikimedia.org/wiki/File:Marinus_van_Reymerswale_-_The_Tax_Collectors_-_WGA19332.jpg"
                  target="_blank"
                  rel="noreferrer"
                  className="text-ink-2 italic underline underline-offset-[3px] hover:text-ink"
                >
                  The Tax Collectors
                </a>{" "}
                (1540s), public domain
              </span>
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
