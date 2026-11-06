import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { CheckIcon } from "@/components/ui/AnswerChip";
import { Chip } from "@/components/ui/Chip";
import { DEMO_ACCOUNT_ID, faq, hero, howItWorks, scope, trust, whoFor } from "@/content/landing";
import { demoPrivacyProof, demoRuleCount } from "@/lib/demo/demo-proof";
import { LandingForm } from "./LandingForm";
import { LandingProofButton } from "./LandingProofButton";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mx-auto mt-[clamp(72px,9cqi,128px)] w-full max-w-[1120px] text-left">
      <h2 id={id} className="font-serif text-[clamp(36px,4cqi,56px)] leading-none font-normal tracking-[-0.02em] text-balance">
        {title}
      </h2>
      <div className="mt-[clamp(20px,2.4cqi,32px)]">{children}</div>
    </section>
  );
}

const linkClass = "self-start text-small font-medium text-ink underline underline-offset-[3px] hover:text-ink-soft";

export default function Landing() {
  return (
    <AppShell landing mainClassName="items-center text-center pt-[clamp(28px,5cqi,80px)] pb-[clamp(48px,6cqi,96px)]">
      {/* Hero: the scan input stays above the fold. */}
      <Chip tone="neutral" className="h-8 px-3.5">
        {hero.deadline}
      </Chip>
      <h1 className="mt-6 max-w-[1000px] font-serif text-[clamp(46px,6.6cqi,100px)] leading-[0.98] font-normal tracking-[-0.025em] text-balance">
        {hero.headline}
        <em className="block italic">{hero.headlineItalic}</em>
      </h1>
      <p className="mt-5 max-w-[660px] text-[clamp(17px,1.4cqi,20px)] leading-[1.55] text-pretty text-ink-2">{hero.subline}</p>
      <LandingForm />

      <Section id="how-h" title={howItWorks.title}>
        <ol className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-3">
          {howItWorks.steps.map((s) => (
            <li key={s.number} className="flex flex-col gap-3 rounded-card border border-border bg-surface p-[clamp(20px,2.2cqi,28px)]">
              <span aria-hidden="true" className="font-mono text-label text-ink-2">
                {s.number}
              </span>
              <h3 className="font-serif text-[28px] leading-[1.05] tracking-[-0.01em]">
                <span className="sr-only">Step {s.number}: </span>
                {s.title}
              </h3>
              <p className="text-ui leading-normal text-ink-2">{s.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="trust-h" title={trust.title}>
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,250px),1fr))] gap-3">
          {trust.cards.map((c) => (
            <li key={c.title} className="flex flex-col gap-3 rounded-card border border-border bg-surface p-[clamp(20px,2.2cqi,24px)]">
              <span className="grid size-8 place-items-center rounded-full bg-lime-tint text-lime-ink" aria-hidden="true">
                <CheckIcon size={13} />
              </span>
              <h3 className="text-[17px] leading-snug font-semibold tracking-[-0.01em]">{c.title}</h3>
              <p className="flex-1 text-small leading-normal text-ink-2">{c.body}</p>
              {c.action.kind === "privacy" ? (
                <LandingProofButton proof={demoPrivacyProof} account={DEMO_ACCOUNT_ID} ruleCount={demoRuleCount} label={c.action.label} />
              ) : c.action.external ? (
                <a href={c.action.href} target="_blank" rel="noreferrer" className={linkClass}>
                  {c.action.label}
                  <span aria-hidden="true"> ↗</span>
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
        </ul>
      </Section>

      <Section id="who-h" title={whoFor.title}>
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-x-8 rounded-card border border-border bg-surface px-[clamp(20px,2.4cqi,32px)] py-2">
          {whoFor.items.map((w) => (
            <li key={w.who} className="flex flex-col gap-1 border-b border-line py-4 last:border-b-0 @min-[1040px]:[&:nth-last-child(2)]:border-b-0">
              <span className="text-body font-semibold">{w.who}</span>
              <span className="text-ui leading-normal text-ink-2">{w.line}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="scope-h" title={scope.title}>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-3">
          <div className="rounded-card border border-border bg-surface p-[clamp(20px,2.4cqi,32px)]">
            <h3 className="text-lg font-semibold">{scope.can.title}</h3>
            <ul className="mt-3 flex flex-col">
              {scope.can.items.map((it) => (
                <li key={it} className="flex items-start gap-3 border-t border-line py-3 text-ui first:border-t-0">
                  <span className="mt-0.5 grid size-5 flex-none place-items-center rounded-full bg-lime text-ink" aria-hidden="true">
                    <CheckIcon size={11} />
                  </span>
                  {it}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-card border border-border bg-muted p-[clamp(20px,2.4cqi,32px)]">
            <h3 className="text-lg font-semibold">{scope.cant.title}</h3>
            <ul className="mt-3 flex flex-col">
              {scope.cant.items.map((it) => (
                <li key={it} className="flex items-start gap-3 border-t border-border py-3 text-ui text-ink-soft first:border-t-0">
                  <span className="mt-0.5 grid size-5 flex-none place-items-center rounded-full border border-border-strong bg-surface text-[11px] leading-none text-ink-2" aria-hidden="true">
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
        <p className="mt-4 rounded-tile border border-amber-line bg-amber-tint px-5 py-4 text-ui leading-normal text-amber-ink">{scope.note}</p>
      </Section>

      <Section id="faq-h" title={faq.title}>
        <div className="rounded-card border border-border bg-surface px-[clamp(16px,2.4cqi,32px)]">
          {faq.items.map((f) => (
            <details key={f.q} className="group border-b border-line last:border-b-0">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-body font-semibold [&::-webkit-details-marker]:hidden">
                {f.q}
                <span aria-hidden="true" className="grid size-8 flex-none place-items-center rounded-full border border-border-strong text-small transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="max-w-[760px] pb-5 text-ui leading-[1.6] text-ink-2">{f.a}</p>
            </details>
          ))}
        </div>
        <p className="mt-4 text-ui text-ink-2">
          New to crypto tax?{" "}
          <Link href="/guide" className="font-medium text-ink underline underline-offset-[3px]">
            Read the plain-English guide
          </Link>
          <span aria-hidden="true"> →</span>
        </p>
      </Section>
    </AppShell>
  );
}
