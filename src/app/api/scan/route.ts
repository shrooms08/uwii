/**
 * Live scan: runs the existing pipeline (history -> NRS rules -> TEE-attested AI classification with
 * per-response signature verification) and streams its real progress as Server-Sent Events.
 *
 * Hosted-demo protection: per-IP scan limit, a global daily AI-call cap (checked before any AI call
 * from the rule pre-pass), a size check before reading a large history, and a time budget below the platform
 * limit. Every failure of an outside service ends in a clear state: AI problems send the transactions to the
 * questions, staking gaps leave a draft, and a busy history service or the time limit end with a message.
 * { source: "cached" } replays the committed classified fixture instead (no live calls, no limits).
 *
 * The classified run is NOT written to any shared cache: it is returned to the browser in the final event
 * with runSig = HMAC-SHA256(UWII_RUN_SECRET, canonical run), and the browser sends it back with each
 * questions/report/anchor request (src/lib/server/run-signing.ts). Without UWII_RUN_SECRET live scans
 * are refused (503). Own accounts arrive in the request body, are used only to count the questions left,
 * and are never stored or logged. Nothing in this route logs.
 */
import { z } from "zod";
import { getHistory } from "@/lib/history/cache";
import { ON_VERCEL } from "@/lib/history/paths";
import { isValidAccountId } from "@/lib/near/account-id";
import { cachedScanEvents } from "@/lib/scan/cached";
import { FetchProgressTracker, HISTORY_BUSY_MESSAGE, OUT_OF_TIME_MESSAGE, TOO_LARGE_MESSAGE, sseEncode, tooManyTransactionsMessage, type ScanEvent } from "@/lib/scan/events";
import { HOSTED_RETRY_WAIT_MS, HistoryBusyError, HistoryDeadlineError, countTransactionsInYear, type Bounds } from "@/lib/history/nearblocks";
import { DailyCap, clientKey, envInt, limitState, readJsonBody, scanLimitMessage, tooManyRequests } from "@/lib/server/limits";
import { publicError } from "@/lib/server/errors";
import { getClassification } from "@/lib/tax/ng/cache";
import { readJsonIfExists } from "@/lib/history/paths";
import { fetchOpeningPosition, openingInputsFromHistory, type OpeningPosition } from "@/lib/tax/ng/opening";
import { openingFixturePath } from "@/lib/tax/ng/report";
import { runSecret, signRun, slimRun, urlOrigin } from "@/lib/server/run-signing";
import { BATCH_SIZE, classifyHistory } from "@/lib/tax/ng/classify";
import { runQuestionFlow } from "@/lib/tax/ng/questions";
import { applyRules } from "@/lib/tax/ng/rules";

/** Vercel Hobby (Fluid compute): 300 s default and maximum per invocation, streamed responses included. */
export const maxDuration = 300;

const FROM = "2026-01-01";
const TO = "2026-12-31";
const HEARTBEAT_MS = 15_000;
/** Stop this long before maxDuration so the client gets an honest message instead of a cut stream (about 250 s). */
const SAFETY_MARGIN_MS = 50_000;
/** Share of the time budget the staking snapshots may use, leaving the rest for the AI step. */
const STAKING_BUDGET_SHARE = 0.6;
/** Margin between the AI step's cut-off and the end of the time budget. */
const AI_DEADLINE_MARGIN_MS = 10_000;
/** Above this many 2026 transactions an account is not fetched: it could not finish and would burn shared quota. */
const DEFAULT_MAX_TXNS = 1500;

class TooManyTransactionsError extends Error {
  constructor(readonly count: number) {
    super("too many transactions for the hosted demo");
  }
}
/** Longest wait for the opening position after classification; otherwise the report computes it. */
const OPENING_WAIT_MS = 25_000;


const accountId = z.string().trim().toLowerCase().refine(isValidAccountId, "invalid NEAR account id");
const Body = z
  .object({
    account: accountId,
    ownAccounts: z.array(accountId).max(50).default([]),
    source: z.enum(["live", "cached"]).default("live"),
  })
  .strict();

/** The promise's value if it settles within ms, else null (the timer is always cleared). */
async function withinMs<T>(p: Promise<T | null>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Time budget for one scan: SCAN_TIME_BUDGET_MS, else maxDuration minus a margin on Vercel, else none. */
function timeBudgetMs(): number | null {
  const fromEnv = envInt("SCAN_TIME_BUDGET_MS", 0);
  if (fromEnv > 0) return fromEnv;
  return ON_VERCEL ? maxDuration * 1000 - SAFETY_MARGIN_MS : null;
}

function sseResponse(run: (send: (e: ScanEvent) => void, isOpen: () => boolean, close: () => void) => Promise<void>, request: Request): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const heartbeat = setInterval(() => write(": keep-alive\n\n"), HEARTBEAT_MS);
      const write = (text: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          open = false; // client went away; the pipeline still finishes and caches its result
        }
      };
      const close = () => {
        clearInterval(heartbeat); // also when the time budget ends a pipeline that is still stuck
        if (!open) return;
        open = false;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      request.signal.addEventListener("abort", () => {
        open = false;
        clearInterval(heartbeat);
      });
      try {
        await run((e) => write(sseEncode(e)), () => open, close);
      } finally {
        clearInterval(heartbeat);
        close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

export async function POST(request: Request) {
  const raw = await readJsonBody(request, 64_000);
  if (!raw.ok) return raw.response;
  const parsed = Body.safeParse(raw.value);
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400, headers: { "cache-control": "no-store" } });
  const body = parsed.data;
  const { account, ownAccounts } = body;

  // ---- cached demo result: the committed classified fixture, replayed (no AI, no network) ----
  if (body.source === "cached") {
    let events: ScanEvent[];
    try {
      const { run } = await getClassification(account, FROM, TO, { ownAccounts: [], fixtureOnly: true });
      const flow = runQuestionFlow(run, { ownAccounts, answers: { groups: {} } });
      events = cachedScanEvents(run, { questions: flow.questions.length, needsYou: flow.questions.reduce((n, q) => n + q.txs.length, 0) });
    } catch {
      return Response.json({ error: "There is no cached demo result for this account.", code: "no_cached_demo" }, { status: 404, headers: { "cache-control": "no-store" } });
    }
    return sseResponse(async (send) => {
      for (const e of events) send(e);
    }, request);
  }

  // ---- live scans need the run-signing secret (the browser keeps the signed run) ----
  const secret = runSecret();
  if (!secret) {
    return Response.json(
      { error: "Live scans are not configured on this server. Load the cached demo instead.", code: "scans_not_configured" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  // ---- limits (best-effort, in memory) ----
  const limits = limitState();
  if (limits.aiCallsDaily.remaining() < 1) {
    const wait = DailyCap.secondsToReset();
    return tooManyRequests("daily_cap", wait, scanLimitMessage("daily_cap", wait));
  }
  const perIp = limits.scanPerIp.hit(clientKey(request));
  if (!perIp.ok) return tooManyRequests("rate_limited", perIp.retryAfterSec, scanLimitMessage("rate_limited", perIp.retryAfterSec));

  const budget = timeBudgetMs();
  return sseResponse(async (send, isOpen, close) => {
    let stage: "history" | "classification" = "history";
    let reserved = 0;
    let aiResponses = 0;
    let finished = false;
    const startedAt = Date.now();
    const deadlineAt = budget ? startedAt + budget : undefined;
    const bounds: Bounds = { maxRetryWaitMs: HOSTED_RETRY_WAIT_MS, deadlineAt, waited: 0 };
    const deadline = budget
      ? setTimeout(() => {
          if (finished) return;
          send({ type: "error", stage, code: "timeout", message: stage === "history" ? TOO_LARGE_MESSAGE : OUT_OF_TIME_MESSAGE });
          close();
        }, budget)
      : null;
    try {
      send({ type: "start", account, from: FROM, to: TO });

      // History: cache -> committed fixture -> live NearBlocks fetch (progress only fires when live).
      const tracker = new FetchProgressTracker();
      let announcedLive = false;
      const onProgress = (message: string) => {
        if (!announcedLive) {
          announcedLive = true;
          send({ type: "history_live" });
        }
        const rows = tracker.push(message);
        if (rows !== null) send({ type: "history_progress", rowsRead: rows });
      };
      const history = await getHistory(account, FROM, TO, {
        onProgress,
        bounds,
        // Always set, so unreadable snapshots are skipped; on the hosted demo it also keeps time for the AI step.
        stakingDeadlineAt: budget ? startedAt + budget * STAKING_BUDGET_SHARE : Number.MAX_SAFE_INTEGER,
        // Only when the history is about to be read live: one call instead of a quota-burning partial fetch.
        beforeLive: async () => {
          const count = await countTransactionsInYear(account, 2026, bounds, onProgress);
          if (count !== null && count > envInt("SCAN_MAX_TXNS", DEFAULT_MAX_TXNS)) throw new TooManyTransactionsError(count);
        },
      });
      if (!isOpen()) return;
      send({ type: "history", count: history.result.records.length, origin: history.origin, fetchedAt: history.result.fetchedAt });
      // Opening position (archival RPC, slow) runs alongside classification; it travels in the signed run.
      const openingInputs = openingInputsFromHistory(history.result);
      const hasOpeningFixture = await readJsonIfExists(openingFixturePath(account)).then((x) => x !== null);
      const openingP: Promise<OpeningPosition | null> = hasOpeningFixture ? Promise.resolve(null) : fetchOpeningPosition(openingInputs, undefined, { deadlineAt }).catch(() => null);

      // Daily AI budget: the deterministic rule pre-pass tells how many records (and so AI batches) remain.
      stage = "classification";
      const matched = applyRules(history.result.records, { accountId: history.result.accountId, ownAccounts: [] });
      const pending = history.result.records.length - matched.size;
      const batches = Math.ceil(pending / BATCH_SIZE);
      if (batches > limits.aiCallsDaily.remaining()) {
        send({ type: "error", stage, code: "daily_cap", message: scanLimitMessage("daily_cap", DailyCap.secondsToReset()) });
        return;
      }
      reserved = batches;
      limits.aiCallsDaily.add(reserved);

      // Classification: base run without own accounts (the cache key /api/questions and /api/report use).
      const run = await classifyHistory(history.result, {
        ownAccounts: [],
        deadlineAt: deadlineAt ? deadlineAt - AI_DEADLINE_MARGIN_MS : undefined,
        onEvent: (e) => {
          if (e.type === "ai_response") aiResponses++;
          send(e);
        },
      });
      const opening = await withinMs(openingP, deadlineAt ? Math.min(OPENING_WAIT_MS, Math.max(0, deadlineAt - Date.now() - 2_000)) : OPENING_WAIT_MS);
      const signed = slimRun({
        ...run,
        context: {
          archivalRpc: urlOrigin(history.result.staking.archivalRpc),
          openingInputs,
          opening,
          ...(history.origin === "live" ? {} : { historyOrigin: history.origin }),
          ...(history.result.staking.incomplete ? { stakingIncomplete: true } : {}),
        },
      });
      const runSig = signRun(signed, secret);

      const flow = runQuestionFlow(run, { ownAccounts, answers: { groups: {} } });
      send({
        type: "done",
        questions: flow.questions.length,
        needsYou: flow.questions.reduce((n, q) => n + q.txs.length, 0),
        total: run.records.length,
        attestationVerified: run.attestation.verified,
        aiResponses: run.metrics.aiResponses,
        aiResponsesVerified: run.metrics.aiResponsesVerified,
        ...(run.aiSkipped ? { aiSkipped: run.aiSkipped } : {}),
        run: signed,
        runSig,
      });
    } catch (e) {
      if (e instanceof HistoryBusyError) send({ type: "error", stage, code: "history_busy", message: HISTORY_BUSY_MESSAGE });
      else if (e instanceof TooManyTransactionsError) send({ type: "error", stage, code: "too_large", message: tooManyTransactionsMessage(e.count) });
      else if (e instanceof HistoryDeadlineError) send({ type: "error", stage, code: "timeout", message: TOO_LARGE_MESSAGE });
      else send({ type: "error", stage, message: publicError(`scan (${stage})`, e).message });
    } finally {
      finished = true;
      if (deadline) clearTimeout(deadline);
      // Settle the reservation to the AI requests actually made (retries included).
      if (reserved) limits.aiCallsDaily.add(aiResponses - reserved);
    }
  }, request);
}
