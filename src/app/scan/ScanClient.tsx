"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon } from "@/components/ui/AnswerChip";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { cx } from "@/components/ui/cx";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { saveRun } from "@/lib/client/runs";
import { loadSaved, setSource } from "@/lib/client/storage";
import { DEMO_ACCOUNT } from "@/lib/demo/illustrative-answers";
import { parseAccountList } from "@/lib/near/account-id";
import { sseDecode, type ScanEvent } from "@/lib/scan/events";
import { INITIAL_SCAN_VIEW, activeStepIndex, applyScanEvent, labelledCount, scanProgress, scanSteps, type ScanView, type StepState } from "@/lib/scan/view";

/** Cosmetic pacing only: each checklist step stays visible at least this long. Numbers are never invented. */
const MIN_STEP_MS = 600;
const AUTO_CONTINUE_MS = 2500;

const PHASE_LABELS = [
  "Reading your 2026 transactions…",
  "Applying NRS circular rules…",
  "Checking hardware attestation…",
  "Classifying privately in sealed hardware…",
  "Verifying AI response signatures…",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function wavePath(amp: number, phase: number): string {
  let d = "";
  for (let x = 0; x <= 720; x += 8) d += `${x ? "L" : "M"}${x} ${(amp * Math.sin((x / 240) * Math.PI * 2 + phase)).toFixed(2)}`;
  return `${d}L720 220L0 220Z`;
}
const BACK = wavePath(5, 1.4);
const FRONT = wavePath(6, 0);
const BOWL = "M6 20 C6 98 66 148 140 148 C214 148 274 98 274 20 C230 34 186 40 140 40 C94 40 50 34 6 20 Z";

/** The vessel fills with the share of transactions labelled (decorative; the number above is the data). */
function Vessel({ fraction }: { fraction: number }) {
  const level = 0.1 + 0.8 * Math.max(0, Math.min(1, fraction));
  const y = 148 - level * 128;
  return (
    <svg viewBox="0 0 280 150" width="100%" aria-hidden="true" className="block overflow-visible">
      <defs>
        <clipPath id="uwii-bowl">
          <path d={BOWL} />
        </clipPath>
      </defs>
      <path d={BOWL} fill="var(--color-muted)" />
      <g clipPath="url(#uwii-bowl)">
        <g style={{ transform: `translateY(${y.toFixed(2)}px)`, transition: "transform 700ms ease-out" }}>
          <g style={{ animation: "uwii-wave 5.5s linear infinite reverse" }}>
            <path d={BACK} fill="#7a6240" />
          </g>
          <g transform="translate(0 7)">
            <g style={{ animation: "uwii-wave 3.6s linear infinite" }}>
              <path d={FRONT} fill="var(--color-gold)" />
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}

function StepIcon({ state }: { state: StepState }) {
  switch (state) {
    case "done":
      return (
        <span className="grid size-6 place-items-center rounded-full bg-gold text-on-ink">
          <CheckIcon size={12} />
        </span>
      );
    case "active":
      return <span className="size-5 rounded-full border-2 border-border border-t-ink [animation:uwii-spin_.8s_linear_infinite]" />;
    case "warn":
      return <span className="grid size-6 place-items-center rounded-full bg-amber-tint font-mono text-[13px] font-medium text-amber-ink ring-1 ring-amber-line">!</span>;
    case "failed":
      return (
        <span className="grid size-6 place-items-center rounded-full bg-red-tint text-red-ink ring-1 ring-red-line">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </span>
      );
    case "skipped":
      return <span className="h-0.5 w-3 rounded-full bg-ink-3" />;
    default:
      return <span className="size-5 rounded-full border-[1.5px] border-dashed border-dash" />;
  }
}

const SR_STATE: Record<StepState, string> = {
  done: "done",
  active: "in progress",
  pending: "waiting",
  warn: "needs attention",
  failed: "failed",
  skipped: "not needed",
};

const BUSY_CODES = new Set(["rate_limited", "daily_cap", "busy"]);
const utcTime = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

export default function ScanClient({ account, cached = false }: { account: string; cached?: boolean }) {
  const router = useRouter();
  const [view, setView] = useState<ScanView>(INITIAL_SCAN_VIEW);
  const [run, setRun] = useState(0);
  const [stayed, setStayed] = useState(false);
  const viewRef = useRef<ScanView>(INITIAL_SCAN_VIEW);
  const queue = useRef<ScanEvent[]>([]);
  const pumping = useRef(false);
  const alive = useRef(true);
  const activeSince = useRef(0);

  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    while (queue.current.length && alive.current) {
      const e = queue.current.shift()!;
      const next = applyScanEvent(viewRef.current, e);
      if (activeStepIndex(next) !== activeStepIndex(viewRef.current)) {
        const wait = MIN_STEP_MS - (Date.now() - activeSince.current);
        if (wait > 0) await sleep(wait);
        activeSince.current = Date.now();
      }
      if (!alive.current) break;
      viewRef.current = next;
      setView(next);
    }
    pumping.current = false;
  }, []);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    const push = (e: ScanEvent) => {
      queue.current.push(e);
      void pump();
    };
    // Deferred so React's dev double-mount cancels the first start before it sends anything.
    const timer = setTimeout(async () => {
      activeSince.current = Date.now();
      let finished = false;
      try {
        const res = await fetch("/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ account, ownAccounts: parseAccountList(loadSaved(account).ownText).filter((a) => a !== account), source: cached ? "cached" : "live" }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const j = await res.json().then(
            (x: { error?: string; code?: string }) => x,
            () => ({}) as { error?: string; code?: string },
          );
          const code = j.code === "rate_limited" || j.code === "daily_cap" ? j.code : j.code === "scans_not_configured" ? "busy" : undefined;
          push({ type: "error", stage: "input", message: j.error ?? `HTTP ${res.status}`, code });
          return;
        }
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          const { events, rest } = sseDecode(buffer);
          buffer = rest;
          for (const e of events) {
            if (e.type === "done" || e.type === "error") finished = true;
            if (e.type === "done" && e.run && e.runSig) {
              // Keep the signed run in this browser before moving on; the page state never holds it.
              await saveRun(account, { run: e.run, runSig: e.runSig });
              push({ ...e, run: undefined, runSig: undefined });
            } else push(e);
          }
        }
        if (!finished) push({ type: "error", stage: "classification", message: "The connection closed before the scan finished." });
      } catch (e) {
        if (!controller.signal.aborted) push({ type: "error", stage: "classification", message: e instanceof Error ? e.message : String(e) });
      }
    }, 0);
    return () => {
      alive.current = false;
      clearTimeout(timer);
      controller.abort();
      queue.current = [];
      pumping.current = false;
    };
  }, [account, run, pump, cached]);

  const steps = scanSteps(view);
  const active = activeStepIndex(view);
  const count = labelledCount(view);
  const done = view.done;
  const attFailed = view.attestation.state === "failed";
  const failed = Boolean(view.error);
  const questions = done?.questions ?? 0;
  const nextHref = questions > 0 ? `/questions?account=${encodeURIComponent(account)}` : `/result?account=${encodeURIComponent(account)}`;
  const autoContinue = Boolean(done) && !failed && !attFailed && !stayed;
  const noAi = view.rules?.pending === 0;
  const verifiedPrivate = Boolean(done) && done!.attestationVerified && done!.aiResponses > 0 && done!.aiResponsesVerified === done!.aiResponses;
  const busy = Boolean(view.error?.code && BUSY_CODES.has(view.error.code));
  const replay = view.cached;

  // Remember which classification the next pages should use: the replayed committed run, or the live scan.
  useEffect(() => {
    if (!done) return;
    setSource(account, replay ? { source: "fixture", recordedAt: replay.recordedAt } : null);
  }, [done, replay, account]);

  useEffect(() => {
    if (!autoContinue) return;
    const t = setTimeout(() => router.push(nextHref), AUTO_CONTINUE_MS);
    return () => clearTimeout(t);
  }, [autoContinue, nextHref, router]);

  const restart = () => {
    viewRef.current = INITIAL_SCAN_VIEW;
    setView(INITIAL_SCAN_VIEW);
    setStayed(false);
    setRun((n) => n + 1);
  };

  let phase: string;
  if (busy) phase = view.error!.message;
  else if (failed) phase = view.error!.code === "timeout" ? view.error!.message : `Scan stopped: ${view.error!.message}`;
  else if (done && attFailed) phase = `Hardware attestation failed, so nothing was sent to the AI model. ${questions} ${questions === 1 ? "thing needs" : "things need"} you.`;
  else if (done && replay) phase = `Cached demo result, attestation recorded ${utcTime(replay.recordedAt)}. ${questions} ${questions === 1 ? "thing needs" : "things need"} you.`;
  else if (done) phase = questions > 0 ? `Done. ${questions} ${questions === 1 ? "thing needs" : "things need"} you.` : "Done. Nothing needs you.";
  else if (active === 0 && view.live) phase = view.rowsRead !== null ? `Reading from NearBlocks free tier · ${view.rowsRead} rows so far` : "Reading from NearBlocks free tier, this can take a few minutes";
  else phase = PHASE_LABELS[Math.min(active, PHASE_LABELS.length - 1)];

  return (
    <div className="flex flex-col items-center pt-[clamp(20px,4cqi,56px)] text-center">
      {busy ? (
        <Chip tone="draft">Hosted demo busy</Chip>
      ) : failed || (done && attFailed) ? (
        <Chip tone="error">{failed ? "Scan stopped" : "Not verified"}</Chip>
      ) : replay ? (
        <Chip tone="neutral">Cached demo result</Chip>
      ) : done ? (
        verifiedPrivate ? <Chip tone="verified">Verified private</Chip> : <Chip tone="neutral">{noAi ? "Labelled by rules only" : "Done, with checks to review"}</Chip>
      ) : (
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-label font-medium">
          <span aria-hidden="true" className="size-2.5 rounded-full border-[1.5px] border-border-strong border-t-ink [animation:uwii-spin_.8s_linear_infinite]" />
          Scanning privately
        </span>
      )}

      <div
        className="relative z-[1] mt-5 flex items-baseline gap-2.5 font-serif text-[clamp(104px,11cqi,160px)] leading-[0.9] tracking-[-0.05em]"
        aria-label={count !== null && view.total !== null ? `${count} of ${view.total} transactions labelled` : "Waiting for your transactions"}
        role="img"
      >
        <span className="min-w-[1.4em] text-right tabular-nums">{count ?? (view.total !== null ? 0 : "–")}</span>
        <span className="text-[0.34em] tracking-normal text-ink-3">/ {view.total ?? "–"}</span>
      </div>
      <div className="-mt-[22px] w-[min(300px,78cqi)]">
        <Vessel fraction={count !== null && view.total ? count / view.total : 0} />
      </div>

      <ProgressBar value={scanProgress(view)} label="Scan progress" className="mt-[22px] w-[min(320px,84cqi)]" />
      <p aria-live="polite" className={cx("mt-3.5 min-h-[22px] max-w-[580px] text-ui", busy ? "text-amber-ink" : failed || (done && attFailed) ? "text-red-ink" : "text-ink-2")}>
        {phase}
      </p>

      <ol className="mt-9 w-full max-w-[580px] rounded-card border border-border bg-surface px-6 py-1.5 text-left">
        {steps.map((s, i) => (
          <li key={s.key} className={cx("flex items-center gap-3.5 py-[15px]", i > 0 && "border-t border-line")}>
            <span className="grid size-6 flex-none place-items-center">
              <StepIcon state={s.state} />
            </span>
            <span
              className={cx(
                "min-w-0 flex-1 text-ui leading-[1.4]",
                s.state === "pending" || s.state === "skipped" ? "text-ink-3" : s.state === "failed" ? "text-red-ink" : s.state === "warn" ? "text-amber-ink" : "text-ink",
              )}
            >
              {s.text}
              <span className="sr-only"> ({SR_STATE[s.state]})</span>
            </span>
            {s.detail && <span className="flex-none font-mono text-label text-ink-2 tabular-nums">{s.detail}</span>}
          </li>
        ))}
      </ol>

      {(done || failed) && (
        <div className="mt-7 flex flex-col items-center gap-3">
          <div className="flex flex-wrap items-center justify-center gap-3">
            {done && (
              <ButtonLink href={nextHref} arrow>
                {questions > 0 ? `Answer ${questions} ${questions === 1 ? "question" : "questions"}` : "See result"}
              </ButtonLink>
            )}
            {busy && (
              <ButtonLink href={`/scan?account=${DEMO_ACCOUNT}&cached=1`} arrow>
                Load the cached demo report
              </ButtonLink>
            )}
            {(failed || attFailed || stayed) && !replay && (
              <Button variant="secondary" onClick={restart}>
                {busy ? "Try again" : "Scan again"}
              </Button>
            )}
            {replay && (done || failed) && (
              <ButtonLink href={`/scan?account=${encodeURIComponent(account)}`} variant="secondary">
                Run a live scan instead
              </ButtonLink>
            )}
            {autoContinue && (
              <Button variant="secondary" onClick={() => setStayed(true)}>
                Stay on this page
              </Button>
            )}
          </div>
          {replay && (
            <p className="max-w-[580px] text-label leading-normal text-ink-2">
              This is the committed demo run for {account}, replayed without contacting the AI. Every number above is what that run recorded, including its hardware
              attestation at {utcTime(replay.recordedAt)}.
            </p>
          )}
          {autoContinue && (
            <p role="status" className="text-label text-ink-2">
              Continuing to {questions > 0 ? "your questions" : "your result"}…
            </p>
          )}
        </div>
      )}
    </div>
  );
}
