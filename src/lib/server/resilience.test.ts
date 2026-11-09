/**
 * Outside-service failures: fault switch, bounded retries, AI fallback to questions, staking and price gaps,
 * scan limits and the client watchdog. Every network call here is a mocked fetch.
 */
process.env.NEARBLOCKS_MIN_INTERVAL_MS = "1";
process.env.COINGECKO_MIN_INTERVAL_MS = "1";
process.env.UWII_RUN_SECRET ??= "test-secret-0123456789abcdef0123456789abcdef";

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

process.env.UWII_CACHE_DIR = mkdtempSync(path.join(os.tmpdir(), "uwii-resilience-"));

const realFetch = globalThis.fetch;
const realSetTimeout = globalThis.setTimeout;
const resetLimits = () => delete (globalThis as { __uwiiLimits?: unknown }).__uwiiLimits;

afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.setTimeout = realSetTimeout;
  resetLimits();
});

/** Makes every wait instant and records how long the code asked to wait. */
function instantTimers(): number[] {
  const waits: number[] = [];
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    waits.push(ms ?? 0);
    return realSetTimeout(fn, 0);
  }) as typeof setTimeout;
  return waits;
}

/** A fetch that answers from a function and records the URLs it saw. */
function mockFetch(answer: (url: string, init?: RequestInit) => Response): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    return answer(url, init);
  }) as typeof fetch;
  return urls;
}

const jsonRes = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

const scanRequest = (body: unknown, ip = "203.0.113.200") => new Request("http://localhost/api/scan", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });

async function scanEvents(res: Response) {
  const { sseDecode } = await import("../scan/events");
  return sseDecode(await res.text()).events;
}

// ---------- the fault switch ----------

test("fault switch: ignored in production and on every Vercel deployment", async () => {
  const { activeFaults, installFaults } = await import("./faults");
  const on = { UWII_FAULTS: "nearai402,nearblocks429" };
  assert.equal(activeFaults({ ...on, NODE_ENV: "production" }).size, 0, "NODE_ENV=production");
  assert.equal(activeFaults({ ...on, NODE_ENV: "production", UWII_ENABLE_DEV_PAGES: "true" }).size, 0, "only the exact value 1 counts");
  assert.equal(activeFaults({ ...on, NODE_ENV: "production", UWII_ENABLE_DEV_PAGES: "1", VERCEL: "1" }).size, 0, "Vercel wins over the dev flag");
  assert.equal(activeFaults({ ...on, NODE_ENV: "development", VERCEL: "1" }).size, 0, "a Vercel preview");

  const before = globalThis.fetch;
  assert.equal(installFaults({ ...on, NODE_ENV: "production" }), false);
  assert.equal(installFaults({ ...on, NODE_ENV: "production", UWII_ENABLE_DEV_PAGES: "1", VERCEL: "1" }), false);
  assert.equal(globalThis.fetch, before, "fetch is left untouched");
});

test("fault switch: active only for local testing, and unknown names are ignored", async () => {
  const { activeFaults, faultResponse } = await import("./faults");
  assert.deepEqual([...activeFaults({ NODE_ENV: "development", UWII_FAULTS: "nearai402, bogus" })], ["nearai402"]);
  assert.deepEqual([...activeFaults({ NODE_ENV: "production", UWII_ENABLE_DEV_PAGES: "1", UWII_FAULTS: "archival429" })], ["archival429"]);
  assert.equal(activeFaults({ NODE_ENV: "development" }).size, 0);
  assert.equal(faultResponse("https://cloud-api.near.ai/v1/models", undefined, new Set(["nearai402"]))?.status, 402);
  assert.equal(faultResponse("https://api.nearblocks.io/v3/accounts/a.near/receipts", undefined, new Set(["nearblocks429"]))?.status, 429);
  assert.equal(faultResponse("https://archival-rpc.mainnet.near.org", undefined, new Set(["archival429"]))?.headers.get("retry-after"), "500");
  assert.equal(faultResponse("https://example.com/", undefined, new Set(["nearai402"])), null);
});

// ---------- NearBlocks ----------

test("NearBlocks: a persistent 429 stops within 60 s of waiting with HistoryBusyError", async () => {
  const { fetchAllInRange, HistoryBusyError } = await import("../history/nearblocks");
  const urls = mockFetch(() => jsonRes({ message: "slow down" }, 429));
  const waits = instantTimers();
  const bounds = { maxRetryWaitMs: 60_000, waited: 0 };
  await assert.rejects(
    fetchAllInRange({ path: "/v3/accounts/a.near/receipts", range: { start: BigInt(0), endExclusive: BigInt(10) }, timestampOf: () => BigInt(1), bounds }),
    HistoryBusyError,
  );
  assert.ok(bounds.waited <= 60_000, `charged ${bounds.waited} ms`);
  const total = waits.filter((w) => w > 1000).reduce((a, b) => a + b, 0);
  assert.ok(total <= 60_500, `slept ${total} ms`);
  assert.ok(urls.length >= 3 && urls.length <= 8);
});

test("NearBlocks: a Retry-After longer than the budget (daily cap) stops at once; a short one is honoured and recovers", async () => {
  const { fetchAllInRange, HistoryBusyError } = await import("../history/nearblocks");
  const range = { start: BigInt(0), endExclusive: BigInt(10) };
  const capped = mockFetch(() => jsonRes({ message: "daily limit" }, 429, { "retry-after": "86400" }));
  instantTimers();
  await assert.rejects(fetchAllInRange({ path: "/p", range, timestampOf: () => BigInt(1), bounds: { maxRetryWaitMs: 60_000, waited: 0 } }), HistoryBusyError);
  assert.equal(capped.length, 1, "no retry against a long Retry-After");

  let calls = 0;
  mockFetch(() => (++calls === 1 ? jsonRes({}, 429, { "retry-after": "2" }) : jsonRes({ data: [], meta: { next_page: null } })));
  const bounds = { maxRetryWaitMs: 60_000, waited: 0 };
  assert.deepEqual(await fetchAllInRange({ path: "/p", range, timestampOf: () => BigInt(1), bounds }), []);
  assert.equal(bounds.waited, 0, "a success resets the budget");
});

test("pre-flight count: sums one year only; an unavailable figure does not block; a busy service does", async () => {
  const { countTransactionsInYear, HistoryBusyError } = await import("../history/nearblocks");
  instantTimers();
  const urls = mockFetch(() => jsonRes({ data: [{ date: "2026-03-01", txns: "1000" }, { date: "2026-01-01", txns: "700" }, { date: "2025-12-31", txns: "9999" }] }));
  assert.equal(await countTransactionsInYear("a.near", 2026, { maxRetryWaitMs: 60_000, waited: 0 }), 1700);
  assert.equal(urls.length, 1, "one call");
  mockFetch(() => jsonRes({ message: "This endpoint is currently unavailable." }, 403));
  assert.equal(await countTransactionsInYear("a.near", 2026, { maxRetryWaitMs: 60_000, waited: 0 }), null);
  mockFetch(() => jsonRes({}, 429, { "retry-after": "86400" }));
  await assert.rejects(countTransactionsInYear("a.near", 2026, { maxRetryWaitMs: 60_000, waited: 0 }), HistoryBusyError);
});

test("demo account: history comes from the committed snapshot with no NearBlocks call, even if it is failing", async () => {
  const { getHistory } = await import("../history/cache");
  const urls = mockFetch(() => jsonRes({}, 429));
  let checked = false;
  const h = await getHistory("rybergh44.near", "2026-01-01", "2026-12-31", { beforeLive: async () => void (checked = true) });
  assert.equal(h.origin, "fixture");
  assert.equal(urls.length, 0);
  assert.equal(checked, false, "the size check is only for live reads");
});

// ---------- staking snapshots ----------

const stakingEvents = (accountId: string) => {
  const ms = Math.floor(Date.now() / 86_400_000) * 86_400_000 - 3 * 86_400_000 + 3_600_000;
  void accountId;
  return [{ pool: "sim.poolv1.near", type: "DEPOSIT", amount: BigInt("1000000000000000000000000000"), timestampNs: BigInt(ms) * BigInt(1_000_000), txHash: "t", receiptId: "r" }];
};

// Order matters: a long Retry-After leaves the process-wide archival backoff in place, as it should.
test("staking: rewards are kept for the days whose snapshots were read; later days are skipped, and it is reported", async () => {
  const { faultFetch } = await import("./faults");
  const { deriveStakingRewards } = await import("../history/staking-rewards");
  const sim = faultFetch(new Set(["sim"]), (async () => {
    throw new Error("no real network in tests");
  }) as typeof fetch);
  let views = 0;
  const archival: string[] = [];
  globalThis.fetch = ((i: RequestInfo | URL, init?: RequestInit) => {
    if (String(i).includes("archival-rpc")) archival.push(String(i));
    if (String(i).includes("archival-rpc") && ++views > 2) return Promise.resolve(jsonRes({}, 429, { "retry-after": "500" }));
    return sim(i, init);
  }) as typeof fetch;
  instantTimers();
  const now = new Date().toISOString().slice(0, 10);
  const { records, info } = await deriveStakingRewards({ accountId: "uwii-t2.near", fromDate: "2026-01-01", toDate: now, events: stakingEvents("uwii-t2.near"), deadlineAt: Date.now() + 120_000 });
  assert.ok(info.incomplete, "reported as incomplete");
  assert.ok(records.length >= 1, "the days that were read still count");
  assert.ok(archival[0].includes("fastnear"), "FastNEAR is tried first");
  assert.ok(archival.at(-1)!.includes("near.org"), "then the public endpoint, once FastNEAR refuses");
  for (const r of records) assert.equal(r.kind, "staking_reward");
});

test("staking: archival 429 with a long Retry-After never waits past the budget; snapshots are skipped and reported", async () => {
  const { faultFetch } = await import("./faults");
  const { deriveStakingRewards } = await import("../history/staking-rewards");
  const urls: string[] = [];
  globalThis.fetch = faultFetch(new Set(["archival429"]), (async () => {
    throw new Error("no real network in tests");
  }) as typeof fetch);
  const wrapped = globalThis.fetch;
  globalThis.fetch = ((i: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(i));
    return wrapped(i, init);
  }) as typeof fetch;
  const waits = instantTimers();
  const now = new Date().toISOString().slice(0, 10);
  const { records, info } = await deriveStakingRewards({
    accountId: "uwii-t1.near",
    fromDate: "2026-01-01",
    toDate: now,
    events: stakingEvents("uwii-t1.near"),
    deadlineAt: Date.now() + 120_000,
  });
  assert.deepEqual(info.incomplete?.pools, ["sim.poolv1.near"]);
  assert.equal(records.length, 0);
  assert.ok(waits.every((w) => w < 120_000), `no wait near the 500 s Retry-After: ${Math.max(...waits)}`);
});

test("staking gaps and failed lookups keep a report a draft with a clear reason", async () => {
  const { reportStatus } = await import("../report/status");
  const base = { records: [], warnings: [], questions: [] };
  assert.equal(reportStatus(base).status, "final");
  const s = reportStatus({ ...base, dataGaps: { stakingIncomplete: true } });
  assert.equal(s.status, "draft");
  assert.equal(s.draftReasons[0].code, "staking_incomplete");
  assert.equal(s.draftReasons[0].message, "Staking rewards could not be read right now; re-run later.");
  assert.equal(reportStatus({ ...base, dataGaps: { openingUnavailable: true } }).draftReasons[0].code, "opening_unavailable");
  const p = reportStatus({ ...base, dataGaps: { pricesUnavailable: 3 } });
  assert.equal(p.draftReasons[0].code, "prices_unavailable");
  assert.match(p.draftReasons[0].message, /3 prices could not be fetched/);
  assert.equal(reportStatus({ ...base, dataGaps: { stakingIncomplete: false, openingUnavailable: false, pricesUnavailable: 0 } }).status, "final");
});

// ---------- prices ----------

test("CoinGecko 429: bounded retry, the line stays unpriced as temporary, later quotes do not retry, no crash", async () => {
  const { LivePriceProvider } = await import("../prices/provider");
  const urls = mockFetch(() => jsonRes({ status: "rate limited" }, 429));
  const waits = instantTimers();
  const near = { symbol: "NEAR", contract: null, decimals: 24 };
  const p = new LivePriceProvider();
  const first = await p.quote(near, "2026-03-03T10:00:00.000Z");
  assert.equal(first.status !== "ok" && first.temporary, true, "unpriced for this run only");
  const total = waits.filter((w) => w > 1000).reduce((a, b) => a + b, 0);
  assert.ok(total <= 30_000, `waited ${total} ms`);
  const seen = urls.length;
  const second = await p.quote(near, "2026-04-03T10:00:00.000Z");
  assert.equal(second.status !== "ok" && second.temporary, true);
  assert.equal(urls.length, seen, "no further requests while the service counts as down");
});

test("a price fixture is never written from temporary failures", async () => {
  const { writePriceFixture } = await import("../prices/provider");
  const results = new Map([["x", { status: "no_verifiable_price" as const, attempted: [], temporary: true as const }]]);
  await assert.rejects(writePriceFixture(path.join(process.env.UWII_CACHE_DIR!, "p.json"), results), /temporarily unavailable/);
});

// ---------- the AI step ----------

const tx = (id: string) => ({
  id,
  txHash: `h-${id}`,
  timestamp: "2026-03-03T10:00:00.000Z",
  direction: "in" as const,
  kind: "native_transfer" as const,
  asset: { symbol: "NEAR", contract: null, decimals: 24 },
  amount: "12.5",
  counterparty: "stranger.near",
  method: null,
  success: true,
  source: "test",
  raw: null,
  fee: null,
});
const historyOf = (n: number) =>
  ({ accountId: "a.near", from: "2026-01-01", to: "2026-12-31", fetchedAt: "2026-11-01T00:00:00.000Z", records: Array.from({ length: n }, (_, i) => tx(`t${i}`)) }) as never;
const okPreflight = { model: "m", nonce: "n", gateway: { ok: true, label: "g", signingAddress: "0x", signingAlgo: "ecdsa", checks: [], summary: {} }, models: [{ ok: true, label: "m", signingAddress: "0x", signingAlgo: "ecdsa", checks: [], summary: {} }], checks: [{ step: "a", ok: true, detail: "" }] };

test("NEAR AI refused (402): nothing is claimed, every unlabelled transaction goes to the questions", async () => {
  const { classifyHistory } = await import("../tax/ng/classify");
  const { runQuestionFlow } = await import("../tax/ng/questions");
  const { privacyProofFromRun, privacyProofText } = await import("../report/privacy");
  const { proofAllVerified } = await import("../report/privacy-summary");
  const events: { type: string }[] = [];
  const run = await classifyHistory(historyOf(3), {
    onEvent: (e) => events.push(e),
    ai: { chooseModel: async () => Promise.reject(new Error("402 Payment required")) },
  });
  assert.deepEqual(run.aiSkipped, { count: 3, reason: "unavailable" });
  assert.ok(run.records.every((r) => r.method === "unlabelled" && r.needsQuestion && r.label === "unknown"));
  assert.match(run.records[0].reason, /private AI step was unavailable/);
  assert.equal(run.metrics.ai, 0);
  assert.ok(events.some((e) => e.type === "ai_skipped"));
  assert.ok(!events.some((e) => e.type === "attestation"), "no attestation result is reported");
  assert.equal(runQuestionFlow(run, { ownAccounts: [], answers: { groups: {} } }).questions[0].txs.length, 3);
  const proof = privacyProofFromRun(run);
  assert.equal(proofAllVerified(proof), false);
  assert.match(privacyProofText(proof), /skipped/);
  assert.doesNotMatch(privacyProofText(proof), /ran on NEAR AI Cloud/);
  assert.ok(proof.missing.some((m) => m.includes("skipped")));
  assert.ok(!proof.missing.some((m) => m.includes("every record matched")));
});

test("attestation failure and an exhausted time budget also go to the questions", async () => {
  const { classifyHistory } = await import("../tax/ng/classify");
  const bad = await classifyHistory(historyOf(2), {
    ai: { chooseModel: async () => ({ id: "m", reason: "" }), preflight: async () => ({ ...okPreflight, checks: [{ step: "tdx", ok: false, detail: "bad" }] }) as never },
  });
  assert.equal(bad.aiSkipped?.reason, "attestation");
  const late = await classifyHistory(historyOf(2), { deadlineAt: Date.now() - 1, ai: { chooseModel: async () => new Promise(() => {}) } });
  assert.equal(late.aiSkipped?.count, 2);
});

test("NEAR AI failing mid-run: stops calling at the first failure, the rest go to the questions, no second call", async () => {
  const { classifyHistory, BATCH_SIZE } = await import("../tax/ng/classify");
  let calls = 0;
  const run = await classifyHistory(historyOf(BATCH_SIZE * 3), {
    ai: {
      chooseModel: async () => ({ id: "m", reason: "" }),
      preflight: async () => okPreflight as never,
      complete: async () => {
        calls++;
        throw new Error("503");
      },
    },
  });
  assert.equal(calls, 1, "the circuit opens after the first failure");
  assert.deepEqual(run.aiSkipped, { count: BATCH_SIZE * 3, reason: "unavailable" });
});

test("a hung NEAR AI is given up on instead of waiting for the platform limit", async () => {
  const { classifyHistory } = await import("../tax/ng/classify");
  // Only the limit timer is fast-forwarded: chooseModel itself never settles.
  instantTimers();
  const run = await classifyHistory(historyOf(1), { ai: { chooseModel: () => new Promise(() => {}) } });
  assert.equal(run.aiSkipped?.reason, "unavailable");
});

test("with NEAR AI skipped, the demo account reaches Final with the same tax as the AI path once answered", async () => {
  const { buildReport } = await import("../tax/ng/report");
  const { getClassification } = await import("../tax/ng/cache");
  const { ILLUSTRATIVE_ANSWERS, DEMO_ACCOUNT } = await import("../demo/illustrative-answers");
  const { AI_SKIPPED_REASONS } = await import("../tax/ng/classify");
  const { run } = await getClassification(DEMO_ACCOUNT, "2026-01-01", "2026-12-31", { fixtureOnly: true });
  const answers = { groups: ILLUSTRATIVE_ANSWERS.groups };
  const profile = { otherIncomeNgn: ILLUSTRATIVE_ANSWERS.otherIncomeNgn };
  const ai = await buildReport({ account: DEMO_ACCOUNT, classificationSource: "fixture", answers, profile });

  const skippedRecords = run.records.map((r) => (r.method === "ai" ? { ...r, method: "unlabelled" as const, label: "unknown" as const, confidence: 0, needsQuestion: true, reason: AI_SKIPPED_REASONS.unavailable, evidence: undefined } : r));
  const count = skippedRecords.filter((r) => r.method === "unlabelled").length;
  const skippedRun = {
    ...run,
    records: skippedRecords,
    aiResponses: [],
    model: null,
    attestation: { verified: false, details: "not run", nonce: null },
    aiSkipped: { count, reason: "unavailable" as const },
    context: { archivalRpc: "https://x", openingInputs: { accountId: DEMO_ACCOUNT, tokens: [], stakingStarts: [] }, opening: null, historyOrigin: "fixture" as const },
  };
  const skipped = await buildReport({ account: DEMO_ACCOUNT, run: skippedRun, answers, profile });

  assert.equal(count, 8);
  assert.equal(skipped.report.status, "final", JSON.stringify(skipped.report.draftReasons));
  assert.equal(skipped.report.tax.taxAttributableToVaNgn, ai.report.tax.taxAttributableToVaNgn);
  assert.deepEqual(skipped.report.totals, ai.report.totals);
  assert.equal(skipped.report.origin.history, "committed snapshot");
  assert.equal(skipped.report.privacyProof.aiDecisions, 0);
  assert.ok(skipped.report.privacyProof.aiSkipped);
});

test("the demo report's fingerprint input is unchanged by the resilience fields", async () => {
  const { buildReport } = await import("../tax/ng/report");
  const { ILLUSTRATIVE_ANSWERS, DEMO_ACCOUNT } = await import("../demo/illustrative-answers");
  const { report } = await buildReport({ account: DEMO_ACCOUNT, classificationSource: "fixture", answers: { groups: ILLUSTRATIVE_ANSWERS.groups }, profile: { otherIncomeNgn: ILLUSTRATIVE_ANSWERS.otherIncomeNgn } });
  assert.equal(report.fingerprint, "41777b4d0d29ebecd00bf07d3c72f62eee6b417f79f9b91c632978ff37710eea");
  assert.equal("aiSkipped" in report.privacyProof, false);
});

// ---------- what the scan page shows ----------

test("scan page: a skipped AI step is a warning with no attestation or signature claim", async () => {
  const { INITIAL_SCAN_VIEW, applyScanEvent, scanSteps, activeStepIndex } = await import("../scan/view");
  type E = Parameters<typeof applyScanEvent>[1];
  const events: E[] = [
    { type: "start", account: "a.near", from: "x", to: "y" },
    { type: "history", count: 10, origin: "fixture", fetchedAt: "t" },
    { type: "rules", total: 10, matched: 8, pending: 2 },
    { type: "ai_skipped", count: 2, reason: "unavailable" },
  ];
  const v = events.reduce(applyScanEvent, INITIAL_SCAN_VIEW);
  const steps = scanSteps(v);
  assert.match(steps[0].text, /history from committed snapshot/);
  assert.equal(steps[2].state, "skipped");
  assert.equal(steps[3].state, "warn");
  assert.match(steps[3].text, /Private AI step unavailable: 2 transactions go to your questions/);
  assert.equal(steps[4].text, "No AI responses to verify");
  assert.equal(activeStepIndex(v), steps.length, "nothing is left spinning");
  assert.ok(!steps.some((s) => s.state === "failed"));
});

test("scan page: history busy and too-large stop without marking a step failed", async () => {
  const { INITIAL_SCAN_VIEW, applyScanEvent, scanSteps } = await import("../scan/view");
  for (const code of ["history_busy", "too_large", "daily_cap", "rate_limited"] as const) {
    const v = applyScanEvent(applyScanEvent(INITIAL_SCAN_VIEW, { type: "start", account: "a.near", from: "x", to: "y" }), { type: "error", stage: "history", code, message: "m" });
    assert.ok(!scanSteps(v).some((s) => s.state === "failed"), code);
  }
});

test("scan page: a stopped scan never ends on a spinner", async () => {
  const { INITIAL_SCAN_VIEW, applyScanEvent, scanSteps } = await import("../scan/view");
  type E = Parameters<typeof applyScanEvent>[1];
  for (const code of ["history_busy", "too_large", "timeout", "connection"] as const) {
    const events: E[] = [{ type: "start", account: "a.near", from: "x", to: "y" }, { type: "history_live" }, { type: "error", stage: "history", code, message: "m" }];
    const steps = scanSteps(events.reduce(applyScanEvent, INITIAL_SCAN_VIEW));
    assert.ok(!steps.some((s) => s.state === "active"), code);
    assert.ok(!steps[0].text.includes("this can take a few minutes"), code);
  }
});

test("a draft that only outside data can finish points to another scan, not to questions", async () => {
  const { needsRescan } = await import("../report/status");
  const gap = { code: "staking_incomplete" as const, message: "m", relatedIds: [] };
  const other = { code: "missing_acquisition_history" as const, message: "m", relatedIds: [] };
  assert.equal(needsRescan({ status: "draft", blockingQuestions: 0, draftReasons: [gap] }), true);
  assert.equal(needsRescan({ status: "draft", blockingQuestions: 2, draftReasons: [gap] }), false, "questions come first");
  assert.equal(needsRescan({ status: "draft", blockingQuestions: 0, draftReasons: [other] }), false);
  assert.equal(needsRescan({ status: "final", blockingQuestions: 0, draftReasons: [] }), false);
});

test("client watchdog: a silent stream is abandoned; data in time passes through", async () => {
  const { withinSilence, StreamSilentError } = await import("../scan/stream");
  await assert.rejects(withinSilence(new Promise(() => {}), 20), StreamSilentError);
  assert.equal(await withinSilence(Promise.resolve("ok"), 1000), "ok");
});

// ---------- the scan route ----------

test("/api/scan: daily cap and per-IP limit say when to retry and point to the cached demo", async () => {
  const { POST } = await import("../../app/api/scan/route");
  const { limitState, clientKey } = await import("./limits");
  const s = limitState();
  s.aiCallsDaily.add(s.aiCallsDaily.cap);
  const capped = await POST(scanRequest({ account: "rybergh44.near" }));
  assert.equal(capped.status, 429);
  const j = (await capped.json()) as { error: string; code: string; retryAfterSec: number };
  assert.equal(j.code, "daily_cap");
  assert.match(j.error, /Try again in .*00:00 UTC.*cached demo report/);
  assert.ok(j.retryAfterSec > 0);

  resetLimits();
  const f = limitState();
  const ip = "203.0.113.201";
  const key = clientKey(new Request("http://x/", { headers: { "x-forwarded-for": ip } }));
  for (let i = 0; i < 5; i++) f.scanPerIp.hit(key);
  const limited = await POST(scanRequest({ account: "rybergh44.near" }, ip));
  assert.equal(limited.status, 429);
  assert.match(((await limited.json()) as { error: string }).error, /5 live scans an hour\. Try again in .*cached demo report/);
});

test("/api/scan: NearBlocks busy ends with the busy message; an oversized account is refused after one call", async () => {
  const { POST } = await import("../../app/api/scan/route");
  mockFetch(() => jsonRes({}, 429, { "retry-after": "86400" }));
  const busy = await scanEvents(await POST(scanRequest({ account: "busy-account.near" }, "203.0.113.202")));
  const e = busy.find((x) => x.type === "error");
  assert.deepEqual(e && { code: (e as { code?: string }).code, message: (e as { message: string }).message }, { code: "history_busy", message: "NEAR history service is busy, try again in a few minutes." });

  const urls = mockFetch(() => jsonRes({ data: [{ date: "2026-02-02", txns: "5000" }] }));
  const big = await scanEvents(await POST(scanRequest({ account: "huge-account.near" }, "203.0.113.203")));
  const t = big.find((x) => x.type === "error") as { code?: string; message: string };
  assert.equal(t.code, "too_large");
  assert.match(t.message, /5,000 transactions in 2026.*too large for the hosted demo/);
  assert.equal(urls.filter((u) => u.includes("nearblocks")).length, 1, "only the count call was spent");
});

test("/api/scan: the time budget ends a stuck scan with a clear message, not a cut stream", async () => {
  const { POST } = await import("../../app/api/scan/route");
  process.env.SCAN_TIME_BUDGET_MS = "150";
  try {
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
    const events = await scanEvents(await POST(scanRequest({ account: "stuck-account.near" }, "203.0.113.204")));
    const e = events.find((x) => x.type === "error") as { code?: string; message: string };
    assert.equal(e.code, "timeout");
    assert.match(e.message, /cached demo report/);
  } finally {
    delete process.env.SCAN_TIME_BUDGET_MS;
  }
});
