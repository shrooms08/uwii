import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { sseDecode, type ScanEvent } from "../scan/events";
import { DailyCap, SlidingWindowLimiter, clientKey, envInt, limitState, BUSY_MESSAGE } from "./limits";
import { health } from "./health";

const HOUR = 3_600_000;

test("per-IP sliding window: 5 per hour, then 429 until the oldest hit ages out", () => {
  const l = new SlidingWindowLimiter(5, HOUR);
  const t0 = Date.UTC(2026, 10, 14, 10);
  for (let i = 0; i < 5; i++) assert.ok(l.hit("ip", t0 + i * 1000).ok);
  const blocked = l.hit("ip", t0 + 10_000);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfterSec, 3590);
  assert.ok(l.hit("other-ip", t0 + 10_000).ok, "limits are per key");
  assert.ok(l.hit("ip", t0 + HOUR + 1).ok, "the window slides");
});

test("daily cap resets at 00:00 UTC and never goes below zero", () => {
  const cap = new DailyCap(150);
  const day = Date.UTC(2026, 10, 14, 23, 59);
  cap.add(149, day);
  assert.equal(cap.remaining(day), 1);
  cap.add(2, day);
  assert.equal(cap.remaining(day), 0);
  cap.add(-500, day);
  assert.equal(cap.remaining(day), 150, "returned reservations cannot go negative");
  cap.add(150, day);
  assert.equal(cap.remaining(Date.UTC(2026, 10, 15, 0, 0, 1)), 150, "new UTC day");
  assert.equal(DailyCap.secondsToReset(Date.UTC(2026, 10, 14, 23, 59)), 60);
});

test("env overrides are non-negative integers; client keys are hashes, never raw IPs", () => {
  assert.equal(envInt("X", 150, { X: "0" }), 0);
  assert.equal(envInt("X", 150, { X: "-3" }), 150);
  assert.equal(envInt("X", 150, { X: "abc" }), 150);
  const req = (h: Record<string, string>) => new Request("http://x/", { headers: h });
  const k = clientKey(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }));
  assert.match(k, /^[0-9a-f]{16}$/);
  assert.ok(!k.includes("203"));
  assert.equal(k, clientKey(req({ "x-forwarded-for": "203.0.113.7" })));
  assert.notEqual(k, clientKey(req({ "x-forwarded-for": "198.51.100.2" })));
});

const scanPost = async (body: unknown, ip = "203.0.113.50") => {
  const { POST } = await import("../../app/api/scan/route");
  return POST(new Request("http://localhost/api/scan", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) }));
};

test("scan: daily AI cap and per-IP limit return 429 with the busy message before any work", async () => {
  delete (globalThis as { __uwiiLimits?: unknown }).__uwiiLimits;
  const state = limitState();
  state.aiCallsDaily.add(state.aiCallsDaily.cap);
  const capped = await scanPost({ account: "rybergh44.near" });
  assert.equal(capped.status, 429);
  const j1 = (await capped.json()) as { error: string; code: string };
  assert.equal(j1.error, BUSY_MESSAGE);
  assert.equal(j1.code, "daily_cap");

  delete (globalThis as { __uwiiLimits?: unknown }).__uwiiLimits;
  const fresh = limitState();
  const key = clientKey(new Request("http://x/", { headers: { "x-forwarded-for": "203.0.113.51" } }));
  for (let i = 0; i < 5; i++) fresh.scanPerIp.hit(key);
  const limited = await scanPost({ account: "rybergh44.near" }, "203.0.113.51");
  assert.equal(limited.status, 429);
  assert.equal(((await limited.json()) as { code: string }).code, "rate_limited");
  assert.ok(limited.headers.get("retry-after"));
  delete (globalThis as { __uwiiLimits?: unknown }).__uwiiLimits;
});

test("scan: the cached demo replays the committed run (recorded attestation time) without limits or AI", async () => {
  delete (globalThis as { __uwiiLimits?: unknown }).__uwiiLimits;
  const state = limitState();
  state.aiCallsDaily.add(state.aiCallsDaily.cap); // even with the AI budget exhausted
  const res = await scanPost({ account: "rybergh44.near", source: "cached" });
  assert.equal(res.status, 200);
  const { events } = sseDecode(await res.text());
  const fixture = (await import("../../../data/fixtures/rybergh44.near-2026.classified.json", { with: { type: "json" } })).default as {
    attestation: { attestedAt: string; checksPassed: number };
  };
  const cached = events.find((e) => e.type === "cached") as Extract<ScanEvent, { type: "cached" }>;
  assert.equal(cached.recordedAt, fixture.attestation.attestedAt);
  const att = events.find((e) => e.type === "attestation") as Extract<ScanEvent, { type: "attestation" }>;
  assert.equal(att.checksPassed, fixture.attestation.checksPassed);
  const done = events.find((e) => e.type === "done") as Extract<ScanEvent, { type: "done" }>;
  assert.equal(done.questions, 4);
  assert.equal(done.total, 125);
  assert.equal(state.aiCallsDaily.remaining(), 0, "nothing reserved or spent");
  delete (globalThis as { __uwiiLimits?: unknown }).__uwiiLimits;
});

test("anchor: per-IP and daily caps return 429 only when a new transaction would be sent", async () => {
  const { handleAnchor } = await import("../api/anchor-handlers");
  const { ILLUSTRATIVE_ANSWERS } = await import("../demo/illustrative-answers");
  const { buildReport } = await import("../tax/ng/report");
  const cfg = {
    network: "testnet" as const,
    contractId: "uwii-anchor.testnet",
    accountId: "uwii-anchor.testnet",
    privateKey: "ed25519:not-a-real-key",
    rpcUrls: ["https://rpc.invalid"],
    archivalRpcUrls: ["https://archival.invalid"],
    explorerBase: "https://nearvalidate.org",
  };
  let anchored: Record<string, unknown> | null = null;
  const sent: unknown[] = [];
  const client = {
    view: async () => anchored,
    call: async (_m: string, args: Record<string, unknown>) => {
      sent.push(args);
      anchored = { fingerprint: args.fingerprint, status: "final", anchored_at_ns: "1762389000123000000", block_height: "1", anchored_by: "uwii-anchor.testnet" };
      return { txHash: "Tx1", result: anchored };
    },
    rpc: async () => ({ chunks: [] }),
  };
  const deps = { build: buildReport, config: () => cfg, client: () => client };
  const post = () =>
    handleAnchor(
      new Request("http://localhost/api/anchor", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.9" },
        body: JSON.stringify({ account: "rybergh44.near", answers: { groups: ILLUSTRATIVE_ANSWERS.groups }, profile: { otherIncomeNgn: "4800000" } }),
      }),
      deps,
    );

  delete (globalThis as { __uwiiLimits?: unknown }).__uwiiLimits;
  const state = limitState();
  state.anchorsDaily.add(state.anchorsDaily.cap);
  const capped = await post();
  assert.equal(capped.status, 429);
  assert.equal(((await capped.json()) as { code: string }).code, "daily_cap");
  assert.equal(sent.length, 0);

  delete (globalThis as { __uwiiLimits?: unknown }).__uwiiLimits;
  const s2 = limitState();
  const key = clientKey(new Request("http://x/", { headers: { "x-forwarded-for": "198.51.100.9" } }));
  for (let i = 0; i < 3; i++) s2.anchorPerIp.hit(key);
  const limited = await post();
  assert.equal(limited.status, 429);
  assert.equal(((await limited.json()) as { code: string }).code, "rate_limited");
  assert.equal(sent.length, 0);

  delete (globalThis as { __uwiiLimits?: unknown }).__uwiiLimits;
  const s3 = limitState();
  assert.equal((await post()).status, 200);
  assert.equal(sent.length, 1);
  assert.equal(s3.anchorsDaily.remaining(), s3.anchorsDaily.cap - 1);
  const again = (await (await post()).json()) as { alreadyAnchored: boolean };
  assert.equal(again.alreadyAnchored, true);
  assert.equal(sent.length, 1, "already anchored: no new transaction, nothing counted");
  assert.equal(s3.anchorsDaily.remaining(), s3.anchorsDaily.cap - 1);
  delete (globalThis as { __uwiiLimits?: unknown }).__uwiiLimits;
});

test("/api/health reports presence only, never values", async () => {
  const empty = await health({});
  assert.deepEqual(empty.configured, { nearAi: false, anchor: false, archivalRpc: false, coingeckoKey: false });
  assert.equal(empty.fixturesPresent, true);
  assert.equal(empty.ok, true);
  assert.equal(empty.network, "testnet");
  const secrets = {
    NEAR_AI_API_KEY: "sk-secret-ai",
    NEAR_ANCHOR_ACCOUNT_ID: "uwii-anchor.testnet",
    NEAR_ANCHOR_CONTRACT_ID: "uwii-anchor.testnet",
    NEAR_ANCHOR_PRIVATE_KEY: "ed25519:secretkeymaterial",
    NEAR_ARCHIVAL_RPC_URL: "https://archival.example/secret-token",
    COINGECKO_DEMO_API_KEY: "cg-secret",
    VERCEL_GIT_COMMIT_SHA: "abcdef1234567",
  };
  const full = await health(secrets);
  assert.deepEqual(full.configured, { nearAi: true, anchor: true, archivalRpc: true, coingeckoKey: true });
  assert.equal(full.version, "abcdef1");
  const json = JSON.stringify(full);
  for (const v of ["sk-secret-ai", "ed25519:secretkeymaterial", "secret-token", "cg-secret"]) assert.ok(!json.includes(v), v);
  assert.equal((await health({ NEAR_NETWORK: "mainnet" })).ok, false);
});

test("with VERCEL=1 no runtime write lands outside os.tmpdir(); fixtures and data/fx are refused", () => {
  const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "uwii-vercel-")));
  const out = execFileSync(process.execPath, ["--import", "tsx", path.join(__dirname, "vercel-writes.child.ts")], {
    cwd: process.cwd(),
    env: { ...process.env, VERCEL: "1", TMPDIR: tmp, UWII_CACHE_DIR: "" },
    encoding: "utf8",
  });
  const r = JSON.parse(out.trim().split("\n").pop()!) as { onVercel: boolean; cacheDir: string; status: string; writes: string[]; refused: string[]; error?: string };
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.onVercel, true);
  assert.ok(realpathSync(path.dirname(r.cacheDir)) === tmp || r.cacheDir.startsWith(tmp), `cache dir ${r.cacheDir} not under ${tmp}`);
  assert.equal(r.status, "final");
  assert.ok(r.writes.length > 0, "the scan's cache write is recorded");
  for (const w of r.writes) {
    const abs = path.resolve(w);
    assert.ok(abs === tmp || abs.startsWith(tmp + path.sep), `write outside the child's os.tmpdir(): ${w}`);
  }
  assert.equal(r.refused.length, 2);
  for (const m of r.refused) assert.match(m, /only .* is writable on Vercel/);
});
