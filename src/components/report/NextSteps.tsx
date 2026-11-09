import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { NEXT_STEPS, NEXT_STEPS_DRAFT, NEXT_STEPS_RERUN, NEXT_STEPS_TITLE } from "@/content/next-steps";

/** "What to do next" (final), or a pointer back to the questions (draft). Shown on Result and Export. */
export function NextSteps({ isDraft, account, rescan }: { isDraft: boolean; account: string; rescan?: boolean }) {
  return (
    <Card aria-labelledby="next-h" className="flex flex-col gap-4 p-[clamp(20px,2.4cqi,32px)]">
      <h2 id="next-h" className="text-lg font-semibold tracking-[-0.01em]">
        {NEXT_STEPS_TITLE}
      </h2>
      {isDraft ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-ui text-ink-2">{rescan ? NEXT_STEPS_RERUN : NEXT_STEPS_DRAFT}</p>
          <ButtonLink href={`/${rescan ? "scan" : "questions"}?account=${encodeURIComponent(account)}`} size="md" arrow>
            {rescan ? "Scan again" : "Answer questions"}
          </ButtonLink>
        </div>
      ) : (
        <ol className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-3">
          {NEXT_STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3.5 rounded-tile bg-muted p-[18px]">
              <span aria-hidden="true" className="grid size-7 flex-none place-items-center rounded-full bg-ink font-mono text-label text-on-ink">
                {i + 1}
              </span>
              <span className="flex flex-col gap-1">
                <span className="text-ui leading-snug font-medium">{s.title}</span>
                <span className="text-label leading-normal text-ink-2">{s.body}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
