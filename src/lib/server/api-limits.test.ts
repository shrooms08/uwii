import assert from "node:assert/strict";
import { test } from "node:test";
import { handleAnchor, type AnchorDeps } from "../api/anchor-handlers";
import { AnswersBody, MAX_ANSWER_ENTRIES, MAX_ANSWER_GROUPS } from "../api/report-body";
import { LIMITS, MAX_BODY_BYTES, clientKey, limitState } from "./limits";

const resetLimits = () => delete (globalThis as { __uwiiLimits?: unknown }).__uwiiLimits;
const post = (url: string, body: string, ip: string, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip, ...headers }, body });

test("answers: at most 200 groups and 500 overrides / naira amounts / source legs per group", () => {
  const groups = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`g${i}`, { option: "x" }]));
  assert.equal(AnswersBody.safeParse({ groups: groups(MAX_ANSWER_GROUPS) }).success, true);
  assert.equal(AnswersBody.safeParse({ groups: groups(MAX_ANSWER_GROUPS + 1) }).success, false);
  const many = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`t${i}`, "1"]));
  assert.equal(AnswersBody.safeParse({ groups: { g: { option: "x", overrides: many(MAX_ANSWER_ENTRIES) } } }).success, true);
  assert.equal(AnswersBody.safeParse({ groups: { g: { option: "x", overrides: many(MAX_ANSWER_ENTRIES + 1) } } }).success, false);
  assert.equal(AnswersBody.safeParse({ groups: { g: { option: "x", ngn: many(MAX_ANSWER_ENTRIES + 1) } } }).success, false);
});

test("/api/report: 413 over the body limit; 429 after 60 requests a minute from one IP", async () => {
  resetLimits();
  const { POST } = await import("../../app/api/report/route");
  const big = JSON.stringify({ account: "rybergh44.near", pad: "x".repeat(MAX_BODY_BYTES) });
  const tooBig = await POST(post("http://localhost/api/report", big, "203.0.113.70"));
  assert.equal(tooBig.status, 413);
  assert.equal(((await tooBig.json()) as { code: string }).code, "too_large");
  // A declared Content-Length over the limit is refused before reading the body.
  const declared = await POST(post("http://localhost/api/report", "{}", "203.0.113.71", { "content-length": String(MAX_BODY_BYTES + 1) }));
  assert.equal(declared.status, 413);

  resetLimits();
  const ip = "203.0.113.72";
  const s = limitState();
  for (let i = 0; i < LIMITS.apiPerIpPerMinute; i++) assert.equal(s.reportPerIp.hit(clientKey(post("http://x/", "{}", ip))).ok, true);
  const limited = await POST(post("http://localhost/api/report", JSON.stringify({ account: "rybergh44.near" }), ip));
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get("retry-after"));
  // Another IP is unaffected (it gets a real answer, here the demo account's report).
  const other = await POST(post("http://localhost/api/report", JSON.stringify({ account: "rybergh44.near", classificationSource: "fixture" }), "203.0.113.73"));
  assert.equal(other.status, 200);
  resetLimits();
});

test("/api/anchor: the per-IP limit applies before the report is rebuilt", async () => {
  resetLimits();
  let builds = 0;
  const deps: AnchorDeps = {
    build: async () => {
      builds++;
      throw new Error("should not be reached");
    },
    config: () => null,
    client: () => {
      throw new Error("unused");
    },
  };
  const ip = "203.0.113.80";
  const s = limitState();
  for (let i = 0; i < LIMITS.anchorsPerIpPerHour; i++) s.anchorPerIp.hit(clientKey(post("http://x/", "{}", ip)));
  const res = await handleAnchor(post("http://localhost/api/anchor", JSON.stringify({ account: "rybergh44.near" }), ip), deps);
  assert.equal(res.status, 429);
  assert.equal(builds, 0, "no report was built");
  resetLimits();
});

test("/api/report and /api/questions are developer-only: 404 in production (the app computes in the browser)", async () => {
  const env = process.env as Record<string, string | undefined>;
  const before = { NODE_ENV: env.NODE_ENV, VERCEL: env.VERCEL, UWII_ENABLE_DEV_PAGES: env.UWII_ENABLE_DEV_PAGES };
  env.NODE_ENV = "production";
  delete env.UWII_ENABLE_DEV_PAGES;
  try {
    const report = await import("../../app/api/report/route");
    const questions = await import("../../app/api/questions/route");
    const body = JSON.stringify({ account: "rybergh44.near", classificationSource: "fixture" });
    assert.equal((await report.POST(post("http://localhost/api/report", body, "203.0.113.90"))).status, 404);
    assert.equal((await questions.POST(post("http://localhost/api/questions", body, "203.0.113.90"))).status, 404);
  } finally {
    for (const [k, v] of Object.entries(before)) if (v === undefined) delete env[k];
    else env[k] = v;
  }
});

test("/api/price: an asset and a time only; strict validation; per-IP limit", async () => {
  const { handlePrice } = await import("../api/price-handler");
  const asked: unknown[] = [];
  const prices = {
    quote: async (asset: unknown, ts: string) => {
      asked.push({ asset, ts });
      return { status: "ok" as const, quote: { usd: "2.5", granularity: "hourly" as const, pointTime: ts, source: "test", method: "test" } };
    },
  };
  const q = (p: Record<string, string>) => new URLSearchParams(p);
  const ok = await handlePrice(q({ asset: "NEAR", contract: "", ts: "2025-06-01T10:00:00.000Z" }), prices);
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { quote: { usd: string } }).quote.usd, "2.5");
  assert.deepEqual(asked, [{ asset: { symbol: "NEAR", contract: null, decimals: 0 }, ts: "2025-06-01T10:00:00.000Z" }]);
  const token = await handlePrice(q({ asset: "USDC", contract: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", ts: "2026-02-01T00:00:00Z" }), prices);
  assert.equal(token.status, 200);
  // Anything else in the query (an account, an amount) is refused, as are bad contracts and times.
  const bads: Record<string, string>[] = [
    { asset: "NEAR", ts: "2026-02-01T00:00:00Z", account: "someone.near" },
    { asset: "NEAR", ts: "2026-02-01T00:00:00Z", amount: "12" },
    { asset: "NEAR", contract: "not a contract!", ts: "2026-02-01T00:00:00Z" },
    { asset: "NEAR", ts: "2026-02-01" },
    { asset: "NEAR", ts: "2999-01-01T00:00:00Z" },
    { ts: "2026-02-01T00:00:00Z" },
  ];
  for (const bad of bads) {
    assert.equal((await handlePrice(q(bad), prices)).status, 400, JSON.stringify(bad));
  }
  assert.equal(asked.length, 2);

  resetLimits();
  const { NextRequest } = await import("next/server");
  const { GET } = await import("../../app/api/price/route");
  const ip = "203.0.113.95";
  const s = limitState();
  for (let i = 0; i < LIMITS.pricesPerIpPerMinute; i++) s.pricePerIp.hit(clientKey(post("http://x/", "{}", ip)));
  const limited = await GET(new NextRequest("http://localhost/api/price?asset=NEAR&ts=2026-02-01T00:00:00Z", { headers: { "x-forwarded-for": ip } }));
  assert.equal(limited.status, 429);
  resetLimits();
});
