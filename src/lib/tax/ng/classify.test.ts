import assert from "node:assert/strict";
import { test } from "node:test";
import { NEAR_ASSET, type NormalizedTx } from "../../history/types";
import { buildPayload, parseModelOutput, toClassified } from "./classify";
import { LABELS, LABEL_IDS } from "./labels";

const base: NormalizedTx = {
  id: "nearblocks:receipt:ABC",
  txHash: "HASH1",
  timestamp: "2026-03-03T10:00:00.000Z",
  direction: "in",
  kind: "native_transfer",
  asset: NEAR_ASSET,
  amount: "12.5",
  counterparty: "acme.near",
  method: null,
  success: true,
  source: "test",
  raw: { secret: "full indexer blob" },
  fee: null,
};

const item = (o: Record<string, unknown> = {}) => ({ id: "t1", label: "income_professional_fees", assetCategory: "1", confidence: 0.9, reason: "invoice", ...o });

test("label validation rejects labels not in LABELS", () => {
  const bad = parseModelOutput(JSON.stringify({ results: [item({ label: "income_salary" })] }), ["t1"]);
  assert.equal(bad.ok, false);
  const good = parseModelOutput(JSON.stringify({ results: [item()] }), ["t1"]);
  assert.equal(good.ok, true);
});

test("model output must be strict JSON with exactly the requested ids", () => {
  assert.equal(parseModelOutput("```json\n{}\n```", ["t1"]).ok, false, "markdown fences");
  assert.equal(parseModelOutput(JSON.stringify({ results: [] }), ["t1"]).ok, false, "missing id");
  assert.equal(parseModelOutput(JSON.stringify({ results: [item(), item({ id: "t9" })] }), ["t1"]).ok, false, "extra id");
  assert.equal(parseModelOutput(JSON.stringify({ results: [item(), item()] }), ["t1"]).ok, false, "duplicate id");
  assert.equal(parseModelOutput(JSON.stringify({ results: [item({ confidence: 1.5 })] }), ["t1"]).ok, false, "confidence out of range");
  assert.equal(parseModelOutput(JSON.stringify({ results: [item({ assetCategory: "3" })] }), ["t1"]).ok, false, "unknown asset category");
});

test("circularRef always comes from labels.ts, never from the model", () => {
  // A model trying to supply its own circularRef is rejected by the strict schema.
  const injected = parseModelOutput(JSON.stringify({ results: [item({ circularRef: "made up 99.9" })] }), ["t1"]);
  assert.equal(injected.ok, false);
  // Every label maps to its labels.ts circularRef regardless of method.
  for (const label of LABEL_IDS) {
    for (const method of ["rule", "ai", "user"] as const) {
      const c = toClassified(base, { label, confidence: 0.95, method, reason: "r" });
      assert.equal(c.circularRef, LABELS[label].circularRef, `${label}/${method}`);
    }
  }
});

test("needsQuestion: low confidence, unknown label, or forced (unverified signature)", () => {
  assert.equal(toClassified(base, { label: "income_airdrop", confidence: 0.79, method: "ai", reason: "r" }).needsQuestion, true);
  assert.equal(toClassified(base, { label: "income_airdrop", confidence: 0.8, method: "ai", reason: "r" }).needsQuestion, false);
  assert.equal(toClassified(base, { label: "unknown", confidence: 1, method: "ai", reason: "r" }).needsQuestion, true);
  assert.equal(toClassified(base, { label: "income_airdrop", confidence: 0.99, method: "ai", reason: "r", forceQuestion: true }).needsQuestion, true);
});

test("asset category: known contracts are fixed, others default to 4 unless the AI says otherwise", () => {
  assert.equal(toClassified(base, { label: "gas_refund", assetCategory: "4", confidence: 1, method: "ai", reason: "r" }).assetCategory, "1", "native NEAR stays 1");
  const usdc = { ...base, asset: { symbol: "USDC", contract: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", decimals: 6 } };
  assert.equal(toClassified(usdc, { label: "income_business", confidence: 1, method: "rule", reason: "r" }).assetCategory, "2");
  const wnear = { ...base, asset: { symbol: "wNEAR", contract: "wrap.near", decimals: 24 } };
  assert.equal(toClassified(wnear, { label: "wrap_unwrap", confidence: 1, method: "rule", reason: "r" }).assetCategory, "1");
  const moon = { ...base, asset: { symbol: "MOON", contract: "aa-harvest-moon.near", decimals: 8 } };
  assert.equal(toClassified(moon, { label: "income_airdrop", confidence: 1, method: "rule", reason: "r" }).assetCategory, "4");
  assert.equal(toClassified(moon, { label: "income_airdrop", assetCategory: "5", confidence: 1, method: "ai", reason: "r" }).assetCategory, "5");
});

test("payload sends only minimal fields, never the raw blob or internal ids", () => {
  const leg = { ...base, id: "nearblocks:receipt:DEF", direction: "out" as const, amount: "1" };
  const { items, idMap } = buildPayload([base], [base, leg], new Map());
  const json = JSON.stringify(items);
  assert.equal(json.includes("full indexer blob"), false);
  assert.equal(json.includes("nearblocks:receipt"), false);
  assert.equal(json.includes("HASH1"), false);
  assert.deepEqual(Object.keys(items[0]).sort(), ["amount", "asset", "counterparty", "date", "direction", "id", "kind", "method", "sameTxLegs"]);
  assert.equal(idMap.get("t1"), base.id);
});
