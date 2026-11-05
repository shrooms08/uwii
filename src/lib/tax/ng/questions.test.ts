import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { NEAR_ASSET, type NormalizedTx } from "../../history/types";
import { toClassified } from "./classify";
import { LABELS } from "./labels";
import {
  INCOMING_OPTIONS,
  INTENTS_OPTIONS,
  INTENTS_SWAP_NOTE,
  OUTGOING_OPTIONS,
  applyAnswers,
  groupQuestions,
  runQuestionFlow,
  type Answers,
} from "./questions";
import { applyRules, ruleDefiHarvest, ruleSwapPairing } from "./rules";
import type { ClassifiedRun, ClassifiedTx } from "./types";

const MOON = { symbol: "MOON", contract: "aa-harvest-moon.near", decimals: 8 };
const WNEAR = { symbol: "wNEAR", contract: "wrap.near", decimals: 24 };
const RHEA = { symbol: "RHEA", contract: "token.rhealab.near", decimals: 18 };
const NPRO = { symbol: "NPRO", contract: "npro.nearmobile.near", decimals: 24 };

let n = 0;
function tx(p: Partial<NormalizedTx>): NormalizedTx {
  n++;
  return {
    id: `id-${n}`,
    txHash: `tx-${n}`,
    timestamp: `2026-03-${String((n % 27) + 1).padStart(2, "0")}T12:00:00.000Z`,
    direction: "in",
    kind: "native_transfer",
    asset: NEAR_ASSET,
    amount: "1",
    counterparty: "bob.near",
    method: null,
    success: true,
    source: "test",
    raw: null,
    fee: null,
    ...p,
  };
}
const q = (t: NormalizedTx): ClassifiedTx => toClassified(t, { label: "unknown", confidence: 0.3, method: "ai", reason: "ai unsure" });

// ---------- Part A ----------

test("rule: MOON harvest from aa-harvest-moon.near -> income_defi_yield", () => {
  const call = tx({ txHash: "h1", direction: "out", kind: "other", asset: NEAR_ASSET, amount: "0", counterparty: "aa-harvest-moon.near", method: "harvest" });
  const moon = tx({ txHash: "h1", direction: "in", kind: "ft_transfer", asset: MOON, amount: "0.002", counterparty: null, method: "harvest" });
  const m = ruleDefiHarvest([call, moon], new Set());
  assert.equal(m.get(moon.id)?.label, "income_defi_yield");
  assert.equal(m.get(moon.id)?.confidence, 1);
  // Through applyRules: the zero-value call is dust, the token leg is yield.
  const all = applyRules([call, moon], { accountId: "alice.near", ownAccounts: [] });
  assert.equal(all.get(moon.id)?.label, "income_defi_yield");
  // A token received with no harvest/claim call in the tx is not yield.
  const plain = tx({ txHash: "h2", direction: "in", kind: "ft_transfer", asset: MOON, amount: "5", counterparty: "carol.near" });
  assert.equal(ruleDefiHarvest([plain], new Set()).size, 0);
  // claim_reward / withdraw_reward also count.
  const claim = tx({ txHash: "h3", direction: "out", kind: "function_call_with_deposit", amount: "0.000000000000000000000001", counterparty: "farm.near", method: "claim_reward" });
  const reward = tx({ txHash: "h3", direction: "in", kind: "ft_transfer", asset: MOON, amount: "1", counterparty: "farm.near" });
  assert.equal(ruleDefiHarvest([claim, reward], new Set()).get(reward.id)?.label, "income_defi_yield");
});

test("swap pairing: outgoing leg disposal_swap, incoming leg acquisition_swap, same pairingId", () => {
  const give = tx({ txHash: "s1", direction: "out", kind: "ft_transfer", asset: WNEAR, amount: "20", counterparty: "aggregatedex.near", method: "ft_transfer_call" });
  const get = tx({ txHash: "s1", direction: "in", kind: "ft_transfer", asset: RHEA, amount: "1633.685702608906460383", counterparty: "aggregatedex.near" });
  const m = ruleSwapPairing([give, get], new Set());
  assert.equal(m.get(give.id)?.label, "disposal_swap");
  assert.equal(m.get(get.id)?.label, "acquisition_swap");
  assert.equal(m.get(get.id)?.pairingId, m.get(give.id)?.pairingId);
  assert.equal(LABELS.acquisition_swap.taxable, "acquisition");
});

// ---------- grouping ----------

test("grouping by (counterparty, direction); intents.near inflows form their own group", () => {
  const hex = "52435fe912307fb3a088b8b8f3882781762fc1f0a404e8579c7fb1a964362c8d";
  const recs = [
    q(tx({ counterparty: hex, amount: "0.1" })),
    q(tx({ counterparty: hex, amount: "40.124648" })),
    q(tx({ counterparty: hex, direction: "out", amount: "3" })),
    q(tx({ counterparty: "intents.near", kind: "ft_transfer", asset: NPRO, amount: "501.64" })),
    toClassified(tx({ counterparty: hex }), { label: "own_wallet_transfer", confidence: 1, method: "rule", reason: "r" }), // not a question
  ];
  const qs = groupQuestions(recs);
  assert.equal(qs.length, 3);
  const inHex = qs.find((x) => x.groupId === `in:${hex}`)!;
  assert.equal(inHex.txs.length, 2);
  assert.equal(inHex.type, "incoming");
  assert.equal(inHex.text, "You received NEAR from 52435fe9… 2 times (total 40.22 NEAR). Who is this?");
  assert.equal(inHex.totals[0].total, "40.224648", "exact total kept alongside the rounded text");
  assert.equal(qs.find((x) => x.groupId === `out:${hex}`)!.type, "outgoing");
  const intents = qs.find((x) => x.type === "intents")!;
  assert.equal(intents.options[0].id, "intents_swap");
  assert.ok(intents.options.some((o) => o.id === "own_wallet"), "standard incoming options included");
});

test("fixture: exactly the 4 expected question groups", () => {
  const run = JSON.parse(readFileSync(path.join(process.cwd(), "data/fixtures/rybergh44.near-2026.classified.json"), "utf8")) as ClassifiedRun;
  const qs = runQuestionFlow(run, { ownAccounts: [], answers: { groups: {} } }).questions;
  assert.deepEqual(
    qs.map((x) => x.groupId).sort(),
    [
      "in:52435fe912307fb3a088b8b8f3882781762fc1f0a404e8579c7fb1a964362c8d",
      "intents:in:intents.near",
      "out:5b69665c56276592f91df4c25d5e086ddedae02f891547db61e73c5751f19697",
      "out:premium.nearmobile.near",
    ],
  );
  // Declaring the recurring sender as an own account removes its question.
  const withOwn = runQuestionFlow(run, { ownAccounts: ["52435fe912307fb3a088b8b8f3882781762fc1f0a404e8579c7fb1a964362c8d"], answers: { groups: {} } });
  assert.equal(withOwn.questions.length, 3);
  assert.equal(withOwn.records.filter((r) => r.label === "own_wallet_transfer").length, 5);
});

// ---------- answers ----------

function single(direction: "in" | "out", counterparty = "bob.near") {
  const recs = [q(tx({ direction, counterparty, amount: "10" }))];
  return { recs, qs: groupQuestions(recs) };
}

test("each option maps to the right label (method user, confidence 1, circularRef from labels.ts)", () => {
  const cases: [AnswerOption[], "in" | "out", string][] = [
    [INCOMING_OPTIONS, "in", "bob.near"],
    [OUTGOING_OPTIONS, "out", "bob.near"],
    [INTENTS_OPTIONS, "in", "intents.near"],
  ];
  for (const [options, direction, cp] of cases) {
    for (const o of options) {
      const { recs, qs } = single(direction, cp);
      const answers: Answers = { groups: { [qs[0].groupId]: { option: o.id, ngn: { [recs[0].id]: "150000.50" } } } };
      const { records } = applyAnswers(recs, qs, answers);
      const r = records[0];
      assert.equal(r.label, o.label, `${direction}/${o.id}`);
      assert.equal(r.method, "user");
      assert.equal(r.confidence, 1);
      assert.equal(r.circularRef, LABELS[o.label].circularRef);
      assert.equal(r.reason.startsWith(`User answer: ${o.text}`), true);
      assert.equal(r.evidence && "previous" in r.evidence ? r.evidence.previous.label : null, "unknown", "previous label kept");
      if (o.id === "intents_swap") {
        assert.equal(r.incompleteSourceLeg, true);
        assert.ok(r.reason.includes(INTENTS_SWAP_NOTE));
      }
    }
  }
  const map = Object.fromEntries(INCOMING_OPTIONS.map((o) => [o.text, o.label]));
  assert.deepEqual(map, {
    "My own wallet": "own_wallet_transfer",
    "A client paid me for work": "income_professional_fees",
    "My employer (salary)": "income_employment",
    "Sales from my business": "income_business",
    "A gift from friend or family": "gift_received",
    "A loan I must repay": "loan_received",
    "An airdrop or reward": "income_airdrop",
    "I bought it with naira (P2P)": "acquisition_fiat",
    "I don't know": "unknown",
  });
  assert.deepEqual(Object.fromEntries(OUTGOING_OPTIONS.map((o) => [o.text, o.label])), {
    "My own wallet": "own_wallet_transfer",
    "I paid for goods or services": "disposal_payment",
    "A gift to someone": "gift_given",
    "I sold it for naira (P2P)": "disposal_sale_fiat",
    "Repaying a loan": "loan_repayment",
    "I don't know": "unknown",
  });
});

test("P2P options require a valid naira amount per transaction", () => {
  for (const [direction, option, label] of [["in", "p2p_buy", "acquisition_fiat"], ["out", "p2p_sell", "disposal_sale_fiat"]] as const) {
    const { recs, qs } = single(direction);
    const g = qs[0].groupId;
    const missing = applyAnswers(recs, qs, { groups: { [g]: { option } } });
    assert.equal(missing.records[0].label, "unknown", "not applied without amount");
    assert.equal(missing.records[0].needsQuestion, true);
    assert.equal(missing.summary.missingFollowUps.length, 1);
    const bad = applyAnswers(recs, qs, { groups: { [g]: { option, ngn: { [recs[0].id]: "1.234" } } } });
    assert.equal(bad.summary.missingFollowUps.length, 1, "more than 2 decimals rejected");
    const ok = applyAnswers(recs, qs, { groups: { [g]: { option, ngn: { [recs[0].id]: "250000" } } } });
    assert.equal(ok.records[0].label, label);
    assert.deepEqual(ok.records[0].userFiat, { ngn: "250000" });
    assert.equal(ok.records[0].needsQuestion, false);
  }
});

test("\"I don't know\" stays unresolved", () => {
  const { recs, qs } = single("in");
  const { records, summary } = applyAnswers(recs, qs, { groups: { [qs[0].groupId]: { option: "dont_know" } } });
  assert.equal(records[0].label, "unknown");
  assert.equal(records[0].method, "user");
  assert.equal(records[0].needsQuestion, true);
  assert.equal(summary.unresolved, 1);
  assert.equal(summary.resolvedByUser, 0);
  assert.equal(summary.answeredDontKnow, 1);
});

test("group answer applies to all; a single transaction can be overridden", () => {
  const recs = [1, 2, 3].map((i) => q(tx({ counterparty: "carol.near", amount: String(i) })));
  const qs = groupQuestions(recs);
  assert.equal(qs.length, 1);
  const { records, summary } = applyAnswers(recs, qs, {
    groups: { [qs[0].groupId]: { option: "own_wallet", overrides: { [recs[1].id]: "gift_received" } } },
  });
  assert.deepEqual(records.map((r) => r.label), ["own_wallet_transfer", "gift_received", "own_wallet_transfer"]);
  assert.equal(summary.resolvedByUser, 3);
  assert.ok(records.every((r) => r.method === "user" && r.circularRef === LABELS[r.label].circularRef));
});

type AnswerOption = (typeof INCOMING_OPTIONS)[number];
