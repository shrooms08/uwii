/**
 * Live scan: runs the existing pipeline (history -> NRS rules -> TEE-attested AI classification with
 * per-response signature verification) and streams its real progress as Server-Sent Events.
 *
 * Hosted-demo protection: per-IP scan limit, a global daily AI-call cap (checked before any AI call
 * from the rule pre-pass), and a time budget below the platform limit with an honest message.
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
import { FetchProgressTracker, OUT_OF_TIME_MESSAGE, TOO_LARGE_MESSAGE, sseEncode, type ScanEvent } from "@/lib/scan/events";
import { BUSY_MESSAGE, DailyCap, clientKey, envInt, limitState, readJsonBody, tooManyRequests } from "@/lib/server/limits";
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
/** Stop this long before maxDuration so the client gets an honest message instead of a cut stream. */
const SAFETY_MARGIN_MS = 20_000;
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

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
      const write = (text: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          open = false; // client went away; the pipeline still finishes and caches its result
        }
      };
      const close = () => {
        if (!open) return;
        open = false;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      const heartbeat = setInterval(() => write(": keep-alive\n\n"), HEARTBEAT_MS);
      request.signal.addEventListener("abort", () => {
        open = false;
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
    } catch (e) {
      return Response.json({ error: errMsg(e) }, { status: 404, headers: { "cache-control": "no-store" } });
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
  if (limits.aiCallsDaily.remaining() < 1) return tooManyRequests("daily_cap", DailyCap.secondsToReset());
  const perIp = limits.scanPerIp.hit(clientKey(request));
  if (!perIp.ok) return tooManyRequests("rate_limited", perIp.retryAfterSec);

  const budget = timeBudgetMs();
  return sseResponse(async (send, isOpen, close) => {
    let stage: "history" | "classification" = "history";
    let reserved = 0;
    let aiResponses = 0;
    let finished = false;
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
      const history = await getHistory(account, FROM, TO, {
        onProgress: (message) => {
          if (!announcedLive) {
            announcedLive = true;
            send({ type: "history_live" });
          }
          const rows = tracker.push(message);
          if (rows !== null) send({ type: "history_progress", rowsRead: rows });
        },
      });
      if (!isOpen()) return;
      send({ type: "history", count: history.result.records.length, origin: history.origin, fetchedAt: history.result.fetchedAt });
      // Opening position (archival RPC, slow) runs alongside classification; it travels in the signed run.
      const openingInputs = openingInputsFromHistory(history.result);
      const hasOpeningFixture = await readJsonIfExists(openingFixturePath(account)).then((x) => x !== null);
      const openingP: Promise<OpeningPosition | null> = hasOpeningFixture ? Promise.resolve(null) : fetchOpeningPosition(openingInputs).catch(() => null);

      // Daily AI budget: the deterministic rule pre-pass tells how many records (and so AI batches) remain.
      stage = "classification";
      const matched = applyRules(history.result.records, { accountId: history.result.accountId, ownAccounts: [] });
      const pending = history.result.records.length - matched.size;
      const batches = Math.ceil(pending / BATCH_SIZE);
      if (batches > limits.aiCallsDaily.remaining()) {
        send({ type: "error", stage, code: "busy", message: BUSY_MESSAGE });
        return;
      }
      reserved = batches;
      limits.aiCallsDaily.add(reserved);

      // Classification: base run without own accounts (the cache key /api/questions and /api/report use).
      const run = await classifyHistory(history.result, {
        ownAccounts: [],
        onEvent: (e) => {
          if (e.type === "ai_response") aiResponses++;
          send(e);
        },
      });
      const opening = await withinMs(openingP, OPENING_WAIT_MS);
      const signed = slimRun({ ...run, context: { archivalRpc: urlOrigin(history.result.staking.archivalRpc), openingInputs, opening } });
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
        run: signed,
        runSig,
      });
    } catch (e) {
      send({ type: "error", stage, message: errMsg(e) });
    } finally {
      finished = true;
      if (deadline) clearTimeout(deadline);
      // Settle the reservation to the AI requests actually made (retries included).
      if (reserved) limits.aiCallsDaily.add(aiResponses - reserved);
    }
  }, request);
}
