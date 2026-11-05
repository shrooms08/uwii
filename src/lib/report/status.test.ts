import assert from "node:assert/strict";
import { test } from "node:test";
import { reportFingerprint } from "./fingerprint";
import { reportStatus, type StatusInput } from "./status";

const resolved = [
  { id: "a", needsQuestion: false, label: "income_staking_reward" },
  { id: "b", needsQuestion: false, label: "disposal_swap" },
];
const base = (p: Partial<StatusInput> = {}): StatusInput => ({ records: resolved, warnings: [], questions: [], ...p });

test("unresolved record -> draft, with blocking question count", () => {
  const r = reportStatus(
    base({
      records: [...resolved, { id: "u1", needsQuestion: true, label: "unknown" }, { id: "u2", needsQuestion: true, label: "unknown" }],
      questions: [
        { groupId: "in:x", txs: [{ id: "u1" }, { id: "u2" }] },
        { groupId: "out:y", txs: [{ id: "a" }] }, // answered group: not blocking
      ],
    }),
  );
  assert.equal(r.status, "draft");
  assert.equal(r.blockingQuestions, 1);
  assert.deepEqual(r.draftReasons.map((d) => d.code), ["unresolved_records"]);
  assert.deepEqual(r.draftReasons[0].relatedIds, ["u1", "u2"]);
  // "I don't know" keeps a user-labelled record unresolved, so it still blocks.
  const dontKnow = reportStatus(base({ records: [{ id: "k", needsQuestion: true, label: "unknown" }], questions: [{ groupId: "g", txs: [{ id: "k" }] }] }));
  assert.equal(dontKnow.status, "draft");
  assert.equal(dontKnow.blockingQuestions, 1);
});

test("missing_acquisition_history warning -> draft", () => {
  const r = reportStatus(base({ warnings: [{ code: "missing_acquisition_history", recordId: "b" }] }));
  assert.equal(r.status, "draft");
  assert.deepEqual(r.draftReasons.map((d) => [d.code, d.relatedIds]), [["missing_acquisition_history", ["b"]]]);
  assert.equal(r.blockingQuestions, 0);
});

test("acquisition_swap with an incomplete source leg -> draft", () => {
  const r = reportStatus(base({ warnings: [{ code: "incomplete_source_leg", recordId: "npro" }] }));
  assert.equal(r.status, "draft");
  assert.equal(r.draftReasons[0].code, "incomplete_source_leg");
  assert.match(r.draftReasons[0].message, /9\.1\.2 Step 1\(b\)/);
});

test("only no_verifiable_price exclusions and rate_fallback -> final (still warnings, not draft)", () => {
  const r = reportStatus(base({ warnings: [{ code: "no_verifiable_price", recordId: "m" }, { code: "rate_fallback" }] }));
  assert.equal(r.status, "final");
  assert.deepEqual(r.draftReasons, []);
  assert.equal(r.blockingQuestions, 0);
});

test("a draft and a final report of the same data have different fingerprints", async () => {
  const data = { account: "alice.near", year: 2026, totals: { netGainsNgn: "100" }, lines: [] };
  const draft = { ...data, ...reportStatus(base({ warnings: [{ code: "missing_acquisition_history", recordId: "b" }] })) };
  const final = { ...data, ...reportStatus(base()) };
  assert.equal(draft.status, "draft");
  assert.equal(final.status, "final");
  assert.notEqual(await reportFingerprint(draft), await reportFingerprint(final));
});
