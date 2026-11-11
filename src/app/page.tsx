import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { GlyphArt } from "@/components/GlyphArt";
import { CheckIcon } from "@/components/ui/AnswerChip";
import { Chip } from "@/components/ui/Chip";
import { Eyebrow, TwoTone } from "@/components/ui/Eyebrow";
import { PercentMark } from "@/components/ui/Mark";
import { DEMO_ACCOUNT_ID, faq, hero, howItWorks, liveStats, scope, sections, trust, whoFor } from "@/content/landing";
import stats from "@/content/stats.json";
import { demoPrivacyProof, demoRecordedAt, demoRuleCount } from "@/lib/demo/demo-proof";
import { proofCounts } from "@/lib/report/privacy-summary";
import { FinishedReportButton } from "./FinishedReportButton";
import { LandingForm } from "./LandingForm";
import { LandingProofButton } from "./LandingProofButton";

/** Same gutter as the shell (src/components/AppShell.tsx): 16-64px, about 58px at 1440px. */
const GUTTER = "px-[clamp(16px,4vw,64px)]";

function Section({ id, head, children }: { id: string; head: { index: string; label: string; headline: string; muted: string; body: string }; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="w-full scroll-mt-[72px] pt-[clamp(80px,9cqi,126px)] text-left">
      <div data-reveal="">
        <Eyebrow index={head.index}>{head.label}</Eyebrow>
        <TwoTone id={`${id}-h`} lead={head.headline} muted={head.muted} className="mt-5 max-w-[900px] text-[clamp(34px,4.2cqi,56px)]" />
        {head.body && <p className="mt-4 max-w-[620px] text-[17px] leading-[1.6] text-pretty text-ink-2">{head.body}</p>}
      </div>
      <div className="mt-[clamp(28px,3.4cqi,48px)]">{children}</div>
    </section>
  );
}

/** A row of numbered cards (2 / 3 / 4 across as the width allows); each reveals on scroll and lifts on hover. */
function Row({ children, cols }: { children: ReactNode; cols: 3 | 4 }) {
  return (
    <ol className={`grid gap-3 ${cols === 4 ? "@min-[640px]:grid-cols-2 @min-[1040px]:grid-cols-4" : "@min-[760px]:grid-cols-3"}`}>
      {children}
    </ol>
  );
}

/** Card surface: hairline border, lifts 2px with a gold glow on hover. */
const CARD = "card-lift rounded-card border border-border bg-surface/50";

const linkClass = "self-start text-small font-medium text-gold underline-offset-[3px] hover:underline";

export default function Landing() {
  const checks = proofCounts(demoPrivacyProof);
  const statItems: [string, string][] = [
    [String(stats.tests.passing), liveStats.tests],
    [String(stats.illustrations.reproduced), liveStats.illustrations],
    [checks ? `${checks.passed}/${checks.total}` : "–", liveStats.checks],
    [String(stats.anchors.count), `${liveStats.anchors} as of ${stats.generatedAt.slice(0, 10)}`],
  ];
  return (
    <AppShell landing recordedAt={demoRecordedAt} mainClassName="pb-[clamp(48px,6cqi,96px)]">
      {/* Hero: text first (it is the LCP); the glyph art is drawn after first paint. */}
      <section aria-labelledby="hero-h" className={`relative -mx-[clamp(16px,4vw,64px)] -mt-[72px] ${GUTTER} pt-[72px]`}>
        {/* Full-bleed: the canvas spans the viewport width (the shell clips any overflow on x). */}
        <GlyphArt className="pointer-events-none absolute inset-y-0 left-[calc(50%-50vw)] h-full w-screen" />
        {/* Wide screens: the art spans edge to edge; a left-to-right fade (0.85 to clear by half the width) keeps the text AA,
            a top fade keeps the transparent header legible, and a bottom fade eases the art into the page. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-[calc(50%-50vw)] hidden w-screen bg-[linear-gradient(180deg,rgb(11_12_14/0.85)_0px,rgb(11_12_14/0)_140px,rgb(11_12_14/0)_calc(100%_-_160px),rgb(11_12_14)_100%),linear-gradient(90deg,rgb(11_12_14/0.85)_0%,rgb(11_12_14/0.6)_25%,rgb(11_12_14/0)_50%)] @min-[760px]:block"
        />
        {/* Narrow screens: the art sits behind the headline, so a scrim keeps the text AA. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-[calc(50%-50vw)] w-screen bg-[linear-gradient(to_bottom,rgb(11_12_14/0.6)_0px,rgb(11_12_14/0)_64px,rgb(11_12_14/0)_190px,rgb(11_12_14/0.6)_290px,rgb(11_12_14/0.82)_400px,rgb(11_12_14/0.82)_100%)] @min-[760px]:hidden"
        />
        <p className="sr-only">
          Decorative background: Marinus van Reymerswaele&apos;s painting The Tax Collectors (1540s, public domain), drawn in gold text characters.
        </p>
        <div className="relative w-full pt-[230px] pb-[clamp(56px,7cqi,104px)] @min-[760px]:pt-[clamp(96px,11cqi,168px)]">
          <div className="flex max-w-[620px] flex-col items-start gap-6">
            <Eyebrow star>{hero.eyebrow}</Eyebrow>
            {/* Below ~440px the size follows the width so "Know your crypto tax." stays on one line; unchanged above. */}
            <h1 id="hero-h" className="font-serif text-[clamp(30px,10cqi,44px)] leading-[1.04] tracking-[-0.05em] @min-[760px]:text-[clamp(44px,4.7cqi,68px)]">
              <span className="block text-ink">{hero.headline}</span>
              <span className="block text-ink-3 @min-[1100px]:whitespace-nowrap">
                {hero.headlineMuted}
                <PercentMark size="0.56em" className="ml-[0.16em] inline-block align-[-0.04em] text-gold drop-shadow-[0_0_14px_rgb(230_187_121_/0.75)]" />
              </span>
            </h1>
            <p className="max-w-[520px] text-[17px] leading-[1.6] text-pretty text-ink-2">{hero.subline}</p>
            <LandingForm />
            <div className="flex flex-wrap items-center gap-3">
              <FinishedReportButton recordedAt={demoRecordedAt} />
              <Chip tone="neutral" className="h-8 border-border bg-transparent px-3.5 text-ink-2">
                {hero.deadline}
              </Chip>
            </div>
            <p className="-mt-2 text-caption text-ink-3">Finished report: cached demo result · questions answered for illustration · no AI call</p>
          </div>
        </div>
      </section>

      {/* Live numbers: each one measured (npm run stats; the committed demo run), never typed by hand. */}
      <section aria-label="Live numbers" data-reveal="" className="relative w-full">
        <div className="flex flex-wrap items-center gap-x-10 gap-y-4 rounded-card border border-border bg-surface/60 px-6 py-5">
          <span className="flex items-center gap-2 font-mono text-eyebrow font-medium text-green-dot uppercase">
            <span aria-hidden="true" className="size-[7px] rounded-full bg-green-dot shadow-[0_0_10px_rgb(127_209_139_/0.8)]" />
            {liveStats.label}
          </span>
          {statItems.map(([v, l]) => (
            <span key={l} className="flex items-baseline gap-2">
              <span data-countup="" className="font-mono text-[22px] text-ink tabular-nums">
                {v}
              </span>
              <span className="text-label text-ink-2">{l}</span>
            </span>
          ))}
        </div>
        <p className="mt-2 px-1 text-caption text-ink-3">
          Measured {stats.generatedAt.slice(0, 10)}: the test suite, the anchor contract&apos;s state on testnet ({stats.anchors.contract}), and the demo scan ({demoRuleCount} of{" "}
          {demoRuleCount + demoPrivacyProof.aiDecisions} transactions labelled by the NRS rules).
        </p>
      </section>

      <Section id="how" head={sections.how}>
        <Row cols={3}>
          {howItWorks.steps.map((s) => (
            <li key={s.number} data-reveal="" className={`${CARD} flex flex-col gap-3 p-[clamp(20px,2.4cqi,32px)]`}>
              <span aria-hidden="true" className="font-mono text-eyebrow font-medium text-gold">
                {s.number}
              </span>
              <h3 className="text-[19px] font-medium tracking-[-0.03em]">
                <span className="sr-only">Step {s.number}: </span>
                {s.title}
              </h3>
              <p className="text-small leading-[1.6] text-ink-2">{s.body}</p>
            </li>
          ))}
        </Row>
      </Section>

      <Section id="trust" head={sections.trust}>
        <Row cols={4}>
          {trust.cards.map((c, i) => (
            <li key={c.title} data-reveal="" className={`${CARD} flex flex-col gap-3 p-[clamp(20px,2.2cqi,28px)]`}>
              <span aria-hidden="true" className="flex items-center gap-2 font-mono text-eyebrow font-medium text-gold">
                {String(i + 1).padStart(2, "0")}
                <span className="grid size-5 place-items-center rounded-full bg-gold-tint text-gold">
                  <CheckIcon size={10} />
                </span>
              </span>
              <h3 className="text-[17px] leading-snug font-medium tracking-[-0.02em]">{c.title}</h3>
              <p className="flex-1 text-small leading-[1.6] text-ink-2">{c.body}</p>
              {c.action.kind === "privacy" ? (
                <LandingProofButton proof={demoPrivacyProof} account={DEMO_ACCOUNT_ID} ruleCount={demoRuleCount} label={c.action.label} />
              ) : c.action.external ? (
                <a href={c.action.href} target="_blank" rel="noreferrer" className={linkClass}>
                  {c.action.label}
                  <span aria-hidden="true"> <span className="sys-glyph">↗</span></span>
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                <Link href={c.action.href} className={linkClass}>
                  {c.action.label}
                  <span aria-hidden="true"> →</span>
                </Link>
              )}
            </li>
          ))}
        </Row>
      </Section>

      <Section id="who" head={sections.who}>
        <Row cols={4}>
          {whoFor.items.map((w, i) => (
            <li key={w.who} data-reveal="" className={`${CARD} flex flex-col gap-2 p-[clamp(20px,2.2cqi,28px)]`}>
              <span aria-hidden="true" className="font-mono text-eyebrow font-medium text-gold">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-[17px] leading-snug font-medium tracking-[-0.02em]">{w.who}</span>
              <span className="text-small leading-[1.6] text-ink-2">{w.line}</span>
            </li>
          ))}
        </Row>
      </Section>

      <Section id="scope" head={sections.scope}>
        <div className="grid gap-3 @min-[760px]:grid-cols-2">
          <div data-reveal="" className={`${CARD} p-[clamp(20px,2.4cqi,32px)]`}>
            <h3 className="font-mono text-eyebrow font-medium text-gold uppercase">{scope.can.title}</h3>
            <ul className="mt-3 flex flex-col">
              {scope.can.items.map((it) => (
                <li key={it} className="flex items-start gap-3 border-t border-line py-3 text-ui first:border-t-0">
                  <span className="mt-0.5 grid size-5 flex-none place-items-center rounded-full bg-gold text-on-ink" aria-hidden="true">
                    <CheckIcon size={11} />
                  </span>
                  {it}
                </li>
              ))}
            </ul>
          </div>
          <div data-reveal="" className={`${CARD} p-[clamp(20px,2.4cqi,32px)]`}>
            <h3 className="font-mono text-eyebrow font-medium text-ink-2 uppercase">{scope.cant.title}</h3>
            <ul className="mt-3 flex flex-col">
              {scope.cant.items.map((it) => (
                <li key={it} className="flex items-start gap-3 border-t border-line py-3 text-ui text-ink-soft first:border-t-0">
                  <span className="mt-0.5 grid size-5 flex-none place-items-center rounded-full border border-border-strong text-[11px] leading-none text-ink-2" aria-hidden="true">
                    ×
                  </span>
                  <span>
                    <span className="sr-only">Not supported: </span>
                    {it}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p data-reveal="" className="mt-4 rounded-tile border border-amber-line bg-amber-tint px-5 py-4 text-ui leading-normal text-amber-ink">{scope.note}</p>
      </Section>

      <Section id="faq" head={sections.faq}>
        <div data-reveal="" className="rounded-card border border-border bg-surface/30 px-[clamp(16px,2.4cqi,32px)]">
          {faq.items.map((f) => (
            <details key={f.q} className="group border-b border-line last:border-b-0">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-body font-medium tracking-[-0.01em] [&::-webkit-details-marker]:hidden">
                {f.q}
                <span aria-hidden="true" className="grid size-8 flex-none place-items-center rounded-full border border-border-strong text-small text-gold transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="max-w-[760px] pb-5 text-ui leading-[1.65] text-ink-2">{f.a}</p>
            </details>
          ))}
        </div>
        <p className="mt-4 text-ui text-ink-2">
          New to crypto tax?{" "}
          <Link href="/guide" className="font-medium text-gold underline-offset-[3px] hover:underline">
            Read the plain-English guide
          </Link>
          <span aria-hidden="true" className="text-gold">
            {" "}
            →
          </span>
        </p>
      </Section>
    </AppShell>
  );
}
