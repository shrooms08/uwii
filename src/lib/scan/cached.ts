/**
 * The cached demo result: replays a committed classified run as scan events. Every value is what that
 * run recorded (counts, attestation result and time, response signatures); nothing is called live.
 */
import type { ClassifiedRun } from "../tax/ng/types";
import type { ScanEvent } from "./events";

export function cachedScanEvents(run: ClassifiedRun, questions: { questions: number; needsYou: number }): ScanEvent[] {
  const ai = run.records.filter((r) => r.method === "ai");
  const rule = run.records.length - ai.length;
  const accepted = ai.filter((r) => r.evidence && "chatId" in r.evidence).length;
  const events: ScanEvent[] = [
    { type: "cached", recordedAt: run.attestation.attestedAt ?? run.classifiedAt, classifiedAt: run.classifiedAt },
    { type: "start", account: run.accountId, from: run.from, to: run.to },
    { type: "history", count: run.records.length, origin: "fixture", fetchedAt: run.historyFetchedAt },
    { type: "rules", total: run.records.length, matched: rule, pending: ai.length },
  ];
  if (ai.length > 0) {
    if (run.model) events.push({ type: "attestation_started", model: run.model });
    events.push({
      type: "attestation",
      verified: run.attestation.verified,
      checksPassed: run.attestation.checksPassed ?? 0,
      checksTotal: run.attestation.checksTotal ?? 0,
      detail: run.attestation.details,
    });
    for (const r of run.aiResponses) {
      events.push({ type: "ai_response", batch: r.batch, attempt: r.attempt, txCount: r.txCount, received: Boolean(r.chatId), valid: r.valid, signatureVerified: r.signatureVerified });
    }
    if (run.attestation.verified) events.push({ type: "ai_batch", processed: ai.length, accepted, total: ai.length });
  }
  events.push({
    type: "done",
    questions: questions.questions,
    needsYou: questions.needsYou,
    total: run.records.length,
    attestationVerified: run.attestation.verified,
    aiResponses: run.metrics.aiResponses,
    aiResponsesVerified: run.metrics.aiResponsesVerified,
  });
  return events;
}
