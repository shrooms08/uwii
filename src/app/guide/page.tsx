import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { guideMeta, guideSections } from "@/content/guide";

export const metadata: Metadata = {
  title: "Crypto tax in Nigeria, explained · Uwii",
  description: "What is taxable, what is not, how gains are worked out, reliefs, key dates and where to file, with references to NRS Circular 2026/21 and the Nigeria Tax Act 2025.",
};

function Cite({ children }: { children: string }) {
  return <span className="inline-flex min-h-5 items-center rounded-full border border-rule px-2 font-mono text-caption leading-tight text-ink-2">{children}</span>;
}

export default function GuidePage() {
  return (
    <AppShell>
      <article className="mx-auto w-full max-w-[880px] pt-[clamp(20px,3cqi,40px)] pb-[clamp(32px,4cqi,64px)]">
        <h1 className="font-serif text-[clamp(44px,5cqi,72px)] leading-none font-normal tracking-[-0.02em] text-balance">{guideMeta.title}</h1>
        <p className="mt-4 max-w-[700px] text-body leading-[1.55] text-pretty text-ink-2">{guideMeta.intro}</p>

        <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-2">
          {guideSections.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="inline-flex h-8 items-center rounded-full border border-border-strong bg-surface px-3.5 text-label hover:border-ink">
              {s.title}
            </a>
          ))}
        </nav>

        {guideSections.map((s) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="mt-[clamp(40px,5cqi,64px)] scroll-mt-6">
            <h2 id={`${s.id}-h`} className="font-serif text-[clamp(32px,3.4cqi,44px)] leading-none font-normal tracking-[-0.02em]">
              {s.title}
            </h2>
            {s.intro && <p className="mt-3 text-ui leading-normal text-pretty text-ink-2">{s.intro}</p>}
            <ul className="mt-5 flex flex-col rounded-card border border-border bg-surface px-[clamp(16px,2.4cqi,28px)]">
              {s.items.map((it) => (
                <li key={it.title} className="flex flex-col gap-1.5 border-b border-line py-4 last:border-b-0">
                  <h3 className="text-ui font-semibold">{it.title}</h3>
                  <p className="text-small leading-normal text-pretty text-ink-soft">{it.body}</p>
                  <span>
                    <Cite>{it.cite}</Cite>
                  </span>
                </li>
              ))}
            </ul>
            {s.examples?.map((ex) => (
              <div key={ex.title} className="mt-4 rounded-card border border-border bg-muted p-[clamp(18px,2.4cqi,28px)]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-ui font-semibold">{ex.title}</h3>
                  <Cite>{ex.cite}</Cite>
                </div>
                <ol className="mt-3 flex flex-col gap-2">
                  {ex.steps.map((st, i) => (
                    <li key={st} className="flex gap-3 text-small leading-normal">
                      <span aria-hidden="true" className="w-5 flex-none font-mono text-caption leading-[1.6] text-ink-2">
                        {i + 1}
                      </span>
                      <span className="text-pretty">{st}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
            {s.note && <p className="mt-3 text-label leading-normal text-ink-2">{s.note}</p>}
          </section>
        ))}

        <div className="mt-[clamp(40px,5cqi,64px)] flex flex-col items-start gap-3 rounded-card border border-border bg-surface p-[clamp(20px,2.4cqi,32px)]">
          <h2 className="text-lg font-semibold">Work out yours</h2>
          <p className="text-small text-ink-2">Uwii reads your NEAR transactions and applies these rules line by line, citing the Circular on every line.</p>
          <Link href="/" className="text-small font-medium text-ink underline underline-offset-[3px]">
            Start a private scan <span aria-hidden="true">→</span>
          </Link>
        </div>
        <p className="mt-6 text-label text-ink-2">A guide, not tax advice.</p>
      </article>
    </AppShell>
  );
}
