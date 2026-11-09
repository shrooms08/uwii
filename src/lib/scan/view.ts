/**
 * Pure view model for the /scan page: folds server events into what the page shows. Every number
 * comes from an event; before the server reports a value it is null and the page shows no number.
 */
import { percent, type ScanEvent } from "./events";

/** The scan stopped before doing the work, for a reason outside the user's account: no step is marked failed. */
export const LIMIT_CODES = new Set(["rate_limited", "daily_cap", "busy", "history_busy", "too_large"]);

export type StepState = "pending" | "active" | "done" | "warn" | "failed" | "skipped";

export interface ScanView {
  /** Set when this is the replay of a committed run (the cached demo result). */
  cached: { recordedAt: string; classifiedAt: string } | null;
  started: boolean;
  live: boolean;
  rowsRead: number | null;
  total: number | null;
  rules: { matched: number; pending: number } | null;
  attestation: { state: "pending" | "active" | "done" | "failed"; passed: number | null; checks: number | null; detail: string | null };
  ai: { processed: number; accepted: number } | null;
  signatures: { received: number; verified: number };
  /** The private AI step did not run for these records. */
  aiSkipped: { count: number; reason: "unavailable" | "attestation" | "out_of_time" } | null;
  /** A live scan that used the committed history of the demo account instead of reading NearBlocks. */
  historySnapshot: boolean;
  done: Extract<ScanEvent, { type: "done" }> | null;
  error: { stage: string; message: string; code?: string } | null;
}

export const INITIAL_SCAN_VIEW: ScanView = {
  cached: null,
  started: false,
  live: false,
  rowsRead: null,
  total: null,
  rules: null,
  attestation: { state: "pending", passed: null, checks: null, detail: null },
  ai: null,
  signatures: { received: 0, verified: 0 },
  aiSkipped: null,
  historySnapshot: false,
  done: null,
  error: null,
};

export function applyScanEvent(v: ScanView, e: ScanEvent): ScanView {
  switch (e.type) {
    case "cached":
      return { ...v, cached: { recordedAt: e.recordedAt, classifiedAt: e.classifiedAt } };
    case "start":
      return { ...v, started: true };
    case "history_live":
      return { ...v, live: true };
    case "history_progress":
      return { ...v, rowsRead: e.rowsRead };
    case "history":
      return { ...v, total: e.count, historySnapshot: e.origin === "fixture" && !v.cached };
    case "rules":
      return { ...v, total: e.total, rules: { matched: e.matched, pending: e.pending } };
    case "attestation_started":
      return { ...v, attestation: { ...v.attestation, state: "active" } };
    case "attestation":
      return { ...v, attestation: { state: e.verified ? "done" : "failed", passed: e.checksPassed, checks: e.checksTotal, detail: e.detail } };
    case "ai_response":
      return {
        ...v,
        ai: v.ai ?? { processed: 0, accepted: 0 },
        signatures: {
          received: v.signatures.received + (e.received ? 1 : 0),
          verified: v.signatures.verified + (e.received && e.signatureVerified ? 1 : 0),
        },
      };
    case "ai_batch":
      return { ...v, ai: { processed: e.processed, accepted: e.accepted } };
    case "ai_skipped":
      return { ...v, aiSkipped: { count: e.count, reason: e.reason } };
    case "done":
      return { ...v, done: e };
    case "error":
      return { ...v, error: { stage: e.stage, message: e.message, code: e.code } };
  }
}

/** Records labelled so far (rules + accepted AI answers), or null before the rules have run. */
export function labelledCount(v: ScanView): number | null {
  if (!v.rules) return null;
  return v.rules.matched + (v.ai?.accepted ?? 0);
}

export interface ScanStep {
  key: "read" | "rules" | "attestation" | "ai" | "signatures";
  state: StepState;
  text: string;
  /** Mono detail on the right (only once the server reported it). */
  detail: string | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function scanSteps(v: ScanView): ScanStep[] {
  const pending = v.rules?.pending ?? null;
  const noAi = pending === 0;
  const attFailed = v.attestation.state === "failed";
  const aiDone = pending !== null && pending > 0 && (v.ai?.processed ?? 0) >= pending;

  const read: ScanStep =
    v.total !== null
      ? { key: "read", state: "done", text: v.historySnapshot ? `Read ${plural(v.total, "transaction")}: history from committed snapshot` : `Read ${plural(v.total, "transaction")} from NEAR`, detail: `${v.total} tx` }
      : {
          key: "read",
          state: v.started ? "active" : "pending",
          text: v.live ? "Reading from NearBlocks free tier, this can take a few minutes" : "Read your 2026 transactions from NEAR",
          detail: v.rowsRead !== null ? `${v.rowsRead} rows` : null,
        };

  const rules: ScanStep = v.rules
    ? { key: "rules", state: "done", text: `Labelled ${v.rules.matched} with NRS rules (${percent(v.rules.matched, v.total ?? 0)})`, detail: percent(v.rules.matched, v.total ?? 0) }
    : { key: "rules", state: v.total !== null ? "active" : "pending", text: "Label with NRS circular rules", detail: null };

  let attestation: ScanStep;
  const skipped = v.aiSkipped;
  if (noAi) attestation = { key: "attestation", state: "skipped", text: "Hardware attestation not needed: no transaction left for AI", detail: null };
  else if (skipped && v.attestation.state !== "done") attestation = { key: "attestation", state: "skipped", text: skipped.reason === "attestation" ? "Hardware attestation could not be verified" : "Hardware attestation not completed: the private AI step did not run", detail: null };
  else if (v.attestation.state === "done")
    attestation = { key: "attestation", state: "done", text: `Verified hardware attestation (${plural(v.attestation.passed ?? 0, "check")})`, detail: `${v.attestation.passed} / ${v.attestation.checks}` };
  else if (attFailed)
    attestation = {
      key: "attestation",
      state: "failed",
      text: `Hardware attestation failed: ${v.attestation.detail ?? "not verified"}`,
      detail: v.attestation.checks ? `${v.attestation.passed} / ${v.attestation.checks}` : null,
    };
  else attestation = { key: "attestation", state: v.rules ? "active" : "pending", text: "Verify NEAR AI Cloud hardware attestation (fresh nonce)", detail: null };

  let ai: ScanStep;
  if (noAi) ai = { key: "ai", state: "skipped", text: "AI not needed: every transaction matched a rule", detail: null };
  else if (skipped) {
    const accepted = v.ai?.accepted ?? 0;
    ai = {
      key: "ai",
      state: "warn",
      text: accepted > 0 ? `AI classified ${accepted}; the other ${skipped.count} go to your questions` : `Private AI step unavailable: ${plural(skipped.count, "transaction")} go to your questions`,
      detail: accepted > 0 ? `${accepted} / ${pending}` : null,
    };
  } else if (attFailed) ai = { key: "ai", state: "failed", text: "Not sent to the AI model, because attestation was not verified", detail: null };
  else if (aiDone) {
    const accepted = v.ai?.accepted ?? 0;
    ai =
      accepted === pending
        ? { key: "ai", state: "done", text: `Classified ${pending} privately in NEAR AI Cloud TEE`, detail: `${accepted} / ${pending}` }
        : { key: "ai", state: "warn", text: `AI classified ${accepted} of ${pending}; the rest are added to your questions`, detail: `${accepted} / ${pending}` };
  } else
    ai = {
      key: "ai",
      state: v.attestation.state === "done" ? "active" : "pending",
      text: pending !== null ? `Classify ${pending} privately in NEAR AI Cloud TEE` : "Classify the rest privately in NEAR AI Cloud TEE",
      detail: v.ai ? `${v.ai.processed} / ${pending}` : null,
    };

  let signatures: ScanStep;
  const { received, verified } = v.signatures;
  if (noAi || (skipped && received === 0)) signatures = { key: "signatures", state: "skipped", text: "No AI responses to verify", detail: null };
  else if (skipped) signatures = { key: "signatures", state: "warn", text: `Verified ${verified} of ${received} AI response ${received === 1 ? "signature" : "signatures"} before the step stopped`, detail: `${verified} / ${received}` };
  else if (attFailed) signatures = { key: "signatures", state: "failed", text: "No AI responses: nothing was sent", detail: null };
  else if (aiDone)
    signatures =
      received > 0 && verified === received
        ? { key: "signatures", state: "done", text: `Verified ${verified}/${received} AI response ${received === 1 ? "signature" : "signatures"}`, detail: `${verified} / ${received}` }
        : {
            key: "signatures",
            state: "warn",
            text: received === 0 ? "No AI response was received to verify" : `Only ${verified} of ${received} AI response signatures verified; those answers become questions`,
            detail: `${verified} / ${received}`,
          };
  else
    signatures = {
      key: "signatures",
      state: v.attestation.state === "done" ? "active" : "pending",
      text: "Verify every AI response signature",
      detail: received > 0 ? `${verified} / ${received}` : null,
    };

  const steps = [read, rules, attestation, ai, signatures];
  // A hosted-demo limit stopped the scan before work started: nothing failed, so no step is marked failed.
  if (v.error && !LIMIT_CODES.has(v.error.code ?? "")) {
    const i = steps.findIndex((s) => s.state === "active" || s.state === "pending");
    if (i >= 0) steps[i] = { ...steps[i], state: "failed" };
  }
  // A stopped scan never ends on a spinner.
  if (v.error) {
    return steps.map((s) => {
      const stoppedRead = s.key === "read" && s.state !== "done";
      const text = stoppedRead ? (v.live ? "Could not finish reading from the NearBlocks free tier" : "Read your 2026 transactions from NEAR") : s.text;
      return { ...s, text, state: s.state === "active" ? ("pending" as const) : s.state };
    });
  }
  return steps;
}

/** Index of the first step still in progress (steps.length when all are settled). */
export function activeStepIndex(v: ScanView): number {
  const steps = scanSteps(v);
  const i = steps.findIndex((s) => s.state === "active" || s.state === "pending");
  return i < 0 ? steps.length : i;
}

/** 0-100 from settled steps plus the AI step's real processed fraction. */
export function scanProgress(v: ScanView): number {
  if (v.done) return 100;
  const steps = scanSteps(v);
  let p = steps.filter((s) => s.state !== "active" && s.state !== "pending").length * 20;
  const pending = v.rules?.pending ?? 0;
  if (v.ai && pending > 0 && steps[3].state === "active") p += Math.floor((20 * v.ai.processed) / pending);
  return Math.min(p, 99);
}
