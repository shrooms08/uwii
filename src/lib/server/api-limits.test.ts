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
