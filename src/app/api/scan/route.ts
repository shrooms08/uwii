/**
 * Live scan: runs the existing pipeline (history -> NRS rules -> TEE-attested AI classification with
 * per-response signature verification) and streams its real progress as Server-Sent Events.
 *
 * The classified run is written to the same cache /api/questions and /api/report read. Own accounts
 * arrive in the request body (they live only in the browser), are used only to count the questions
 * left, and are never stored or logged. Nothing in this route logs.
 */
import { z } from "zod";
import { getHistory } from "@/lib/history/cache";
import { writeJson } from "@/lib/history/paths";
import { isValidAccountId } from "@/lib/near/account-id";
import { FetchProgressTracker, sseEncode, type ScanEvent } from "@/lib/scan/events";
import { classifiedCachePath } from "@/lib/tax/ng/cache";
import { classifyHistory } from "@/lib/tax/ng/classify";
import { runQuestionFlow } from "@/lib/tax/ng/questions";

export const maxDuration = 300;

const FROM = "2026-01-01";
const TO = "2026-12-31";
const HEARTBEAT_MS = 15_000;

const accountId = z.string().trim().toLowerCase().refine(isValidAccountId, "invalid NEAR account id");
const Body = z.object({ account: accountId, ownAccounts: z.array(accountId).max(50).default([]) }).strict();

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function POST(request: Request) {
  let body: z.infer<typeof Body>;
  try {
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400, headers: { "cache-control": "no-store" } });
    body = parsed.data;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const { account, ownAccounts } = body;
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
      const send = (e: ScanEvent) => write(sseEncode(e));
      const heartbeat = setInterval(() => write(": keep-alive\n\n"), HEARTBEAT_MS);
      request.signal.addEventListener("abort", () => {
        open = false;
      });

      let stage: "history" | "classification" = "history";
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
        send({ type: "history", count: history.result.records.length, origin: history.origin, fetchedAt: history.result.fetchedAt });

        // Classification: base run without own accounts (the cache key /api/questions and /api/report use).
        stage = "classification";
        const run = await classifyHistory(history.result, { ownAccounts: [], onEvent: send });
        await writeJson(classifiedCachePath(account, FROM, TO), run);

        const flow = runQuestionFlow(run, { ownAccounts, answers: { groups: {} } });
        send({
          type: "done",
          questions: flow.questions.length,
          needsYou: flow.questions.reduce((n, q) => n + q.txs.length, 0),
          total: run.records.length,
          attestationVerified: run.attestation.verified,
          aiResponses: run.metrics.aiResponses,
          aiResponsesVerified: run.metrics.aiResponsesVerified,
        });
      } catch (e) {
        send({ type: "error", stage, message: errMsg(e) });
      } finally {
        clearInterval(heartbeat);
        if (open) {
          open = false;
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
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
