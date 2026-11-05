import assert from "node:assert/strict";
import { test } from "node:test";
import { FetchProgressTracker, percent, sseDecode, sseEncode, type ScanEvent } from "./events";
import { INITIAL_SCAN_VIEW, activeStepIndex, applyScanEvent, labelledCount, scanProgress, scanSteps, type ScanView } from "./view";

const fold = (events: ScanEvent[]): ScanView => events.reduce(applyScanEvent, INITIAL_SCAN_VIEW);

test("SSE encode/decode round-trips and keeps partial frames for the next chunk", () => {
  const a: ScanEvent = { type: "rules", total: 125, matched: 117, pending: 8 };
  const b: ScanEvent = { type: "attestation", verified: true, checksPassed: 14, checksTotal: 14, detail: "ok" };
  const wire = sseEncode(a) + ": keep-alive\n\n" + sseEncode(b);
  const cut = wire.length - 10;
  const first = sseDecode(wire.slice(0, cut));
  assert.deepEqual(first.events, [a]);
  const second = sseDecode(first.rest + wire.slice(cut));
  assert.deepEqual(second.events, [b]);
  assert.equal(second.rest, "");
});

test("fetch progress tracker sums rows in range across endpoints, ignores other messages", () => {
  const t = new FetchProgressTracker();
  assert.equal(t.push("Fetching receipts for alice.near…"), null);
  assert.equal(t.push("  /v3/accounts/alice.near/receipts page 1: 25 rows (25 in range so far)"), 25);
  assert.equal(t.push("  /v3/accounts/alice.near/receipts page 2: 25 rows (41 in range so far)"), 41);
  assert.equal(t.push("  /v3/accounts/alice.near/ft-txns page 1: 3 rows (3 in range so far)"), 44);
  assert.equal(t.push("  /v3/accounts/alice.near/receipts: rate limited (429); retry 1/5 in 30s"), null);
});

test("percent uses integer half-up rounding", () => {
  assert.equal(percent(117, 125), "93.6%");
  assert.equal(percent(1, 3), "33.3%");
  assert.equal(percent(2, 3), "66.7%");
  assert.equal(percent(0, 0), "0%");
});

test("no number is shown before the server reports it", () => {
  const v0 = fold([{ type: "start", account: "a.near", from: "2026-01-01", to: "2026-12-31" }]);
  assert.equal(labelledCount(v0), null);
  assert.equal(v0.total, null);
  const steps = scanSteps(v0);
  assert.ok(steps.every((s) => s.detail === null), "no detail numbers yet");
  assert.ok(steps.every((s) => !/\d/.test(s.text.replace("2026", ""))), "no counts in step text yet");
  assert.equal(steps[0].state, "active");
});

test("happy path: rules, attestation, AI, signatures drive the checklist and the counter", () => {
  const v = fold([
    { type: "start", account: "a.near", from: "2026-01-01", to: "2026-12-31" },
    { type: "history", count: 125, origin: "fixture", fetchedAt: "2026-11-05T00:00:00Z" },
    { type: "rules", total: 125, matched: 117, pending: 8 },
    { type: "attestation_started", model: "m" },
  ]);
  assert.equal(labelledCount(v), 117);
  assert.equal(scanSteps(v)[1].text, "Labelled 117 with NRS rules (93.6%)");
  assert.equal(activeStepIndex(v), 2);
  const v2 = fold([
    ...[
      { type: "start", account: "a.near", from: "2026-01-01", to: "2026-12-31" },
      { type: "history", count: 125, origin: "fixture", fetchedAt: "x" },
      { type: "rules", total: 125, matched: 117, pending: 8 },
      { type: "attestation", verified: true, checksPassed: 14, checksTotal: 14, detail: "ok" },
      { type: "ai_response", batch: 1, attempt: 1, txCount: 8, received: true, valid: true, signatureVerified: true },
      { type: "ai_batch", processed: 8, accepted: 8, total: 8 },
    ] as ScanEvent[],
  ]);
  const s = scanSteps(v2);
  assert.deepEqual(
    s.map((x) => x.state),
    ["done", "done", "done", "done", "done"],
  );
  assert.equal(s[2].text, "Verified hardware attestation (14 checks)");
  assert.equal(s[4].text, "Verified 1/1 AI response signature");
  assert.equal(labelledCount(v2), 125);
  assert.equal(scanProgress(v2), 99, "100 only once the server says done");
  assert.equal(scanProgress(applyScanEvent(v2, { type: "done", questions: 4, needsYou: 8, total: 125, attestationVerified: true, aiResponses: 1, aiResponsesVerified: 1 })), 100);
});

test("failed attestation is shown in red and the AI step is marked as not sent", () => {
  const v = fold([
    { type: "start", account: "a.near", from: "2026-01-01", to: "2026-12-31" },
    { type: "history", count: 10, origin: "cache", fetchedAt: "x" },
    { type: "rules", total: 10, matched: 7, pending: 3 },
    { type: "attestation", verified: false, checksPassed: 0, checksTotal: 0, detail: "attestation preflight failed: fetch failed" },
  ]);
  const s = scanSteps(v);
  assert.equal(s[2].state, "failed");
  assert.match(s[2].text, /Hardware attestation failed: attestation preflight failed/);
  assert.equal(s[3].state, "failed");
  assert.match(s[3].text, /Not sent to the AI model/);
  assert.equal(labelledCount(v), 7);
});

test("unverified signature is a warning, and no-AI accounts skip the TEE steps", () => {
  const warn = fold([
    { type: "history", count: 10, origin: "cache", fetchedAt: "x" },
    { type: "rules", total: 10, matched: 7, pending: 3 },
    { type: "attestation", verified: true, checksPassed: 14, checksTotal: 14, detail: "ok" },
    { type: "ai_response", batch: 1, attempt: 1, txCount: 3, received: true, valid: true, signatureVerified: false },
    { type: "ai_batch", processed: 3, accepted: 3, total: 3 },
  ]);
  assert.equal(scanSteps(warn)[4].state, "warn");
  const none = fold([
    { type: "history", count: 4, origin: "cache", fetchedAt: "x" },
    { type: "rules", total: 4, matched: 4, pending: 0 },
  ]);
  assert.deepEqual(
    scanSteps(none).map((x) => x.state),
    ["done", "done", "skipped", "skipped", "skipped"],
  );
});

test("a pipeline error marks the step in progress as failed", () => {
  const v = fold([
    { type: "start", account: "a.near", from: "2026-01-01", to: "2026-12-31" },
    { type: "history_live" },
    { type: "history_progress", rowsRead: 40 },
    { type: "error", stage: "history", message: "NearBlocks 500" },
  ]);
  const s = scanSteps(v);
  assert.equal(s[0].state, "failed");
  assert.equal(s[0].detail, "40 rows");
  assert.match(s[0].text, /NearBlocks free tier/);
});
