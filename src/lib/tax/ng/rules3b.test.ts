import assert from "node:assert/strict";
import { test } from "node:test";
import { NEAR_ASSET, type NormalizedTx } from "../../history/types";
import { consistencyGuards, toClassified } from "./classify";
import { CONTRACTS, type LabelId } from "./labels";
import { applyRules, ruleDust, ruleRoundTrip, ruleStorageDeposit } from "./rules";

const WNEAR = { symbol: "wNEAR", contract: CONTRACTS.wNEAR, decimals: 24 };
const USDC = { symbol: "USDC", contract: CONTRACTS.USDC, decimals: 6 };
const ctx = { accountId: "alice.near", ownAccounts: [] };

let n = 0;
function tx(p: Partial<NormalizedTx>): NormalizedTx {
  n++;
  return {
    id: `id-${n}`,
    txHash: `tx-${n}`,
    timestamp: "2026-03-01T12:00:00.000Z",
    direction: "out",
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

// ---------- round_trip ----------

test("rule: round_trip — same asset and exact amount out and back in one tx", () => {
  const out = tx({ txHash: "rt", kind: "ft_transfer", asset: WNEAR, counterparty: "aggregatedex.near", amount: "20" });
  const back = tx({ txHash: "rt", kind: "ft_transfer", direction: "in", asset: WNEAR, counterparty: "aggregatedex.near", amount: "20" });
  const m = ruleRoundTrip([out, back], new Set());
  assert.equal(m.get(out.id)?.label, "round_trip");
  assert.equal(m.get(back.id)?.label, "round_trip");
  // Different amount, different asset (wNEAR vs native NEAR), or different tx: not a round trip.
  assert.equal(ruleRoundTrip([out, { ...back, id: "x1", amount: "19.99" }], new Set()).size, 0);
  assert.equal(ruleRoundTrip([out, { ...back, id: "x2", asset: NEAR_ASSET, kind: "native_transfer" }], new Set()).size, 0);
  assert.equal(ruleRoundTrip([out, { ...back, id: "x3", txHash: "other" }], new Set()).size, 0);
});

test("rule: round_trip beats swap pairing", () => {
  const out = tx({ txHash: "rt2", kind: "ft_transfer", asset: WNEAR, counterparty: "aggregatedex.near", amount: "20" });
  const back = tx({ txHash: "rt2", kind: "ft_transfer", direction: "in", asset: WNEAR, counterparty: "aggregatedex.near", amount: "20" });
  // An extra different-asset leg would otherwise make the outgoing wNEAR a swap disposal.
  const usdcIn = tx({ txHash: "rt2", kind: "ft_transfer", direction: "in", asset: USDC, counterparty: "aggregatedex.near", amount: "4.9" });
  const m = applyRules([out, back, usdcIn], ctx);
  assert.equal(m.get(out.id)?.label, "round_trip");
  assert.equal(m.get(back.id)?.label, "round_trip");
  assert.notEqual(m.get(out.id)?.label, "disposal_swap");
});

// ---------- dust_no_value ----------

test("rule: dust_no_value — zero and < 1000 smallest units; >= 1000 is not dust", () => {
  assert.equal(ruleDust(tx({ kind: "other", amount: "0" }))?.label, "dust_no_value");
  assert.equal(ruleDust(tx({ kind: "function_call_with_deposit", amount: "0.000000000000000000000001", method: "ft_transfer_call" }))?.label, "dust_no_value");
  assert.equal(ruleDust(tx({ amount: "0.000000000000000000000999" }))?.label, "dust_no_value", "999 yocto");
  assert.equal(ruleDust(tx({ amount: "0.000000000000000000001" })), null, "1000 yocto");
  assert.equal(ruleDust(tx({ kind: "ft_transfer", asset: USDC, amount: "0.000999" }))?.label, "dust_no_value", "999 USDC units");
  assert.equal(ruleDust(tx({ kind: "ft_transfer", asset: USDC, amount: "0.001" })), null, "1000 USDC units");
});

test("rule: dust_no_value never applies to staking_reward", () => {
  const tiny = tx({ kind: "staking_reward", direction: "in", counterparty: "astro-stakers.poolv1.near", amount: "0.000000000000000000000005" });
  assert.equal(ruleDust(tiny), null);
  assert.equal(applyRules([tiny], ctx).get(tiny.id)?.label, "income_staking_reward");
});

// ---------- storage_deposit ----------

test("rule: storage_deposit — outgoing deposit and the refund from the same contract in the same tx", () => {
  const dep = tx({ txHash: "sd", kind: "function_call_with_deposit", counterparty: CONTRACTS.wNEAR, method: "storage_deposit", amount: "0.002" });
  const refund = tx({ txHash: "sd", direction: "in", counterparty: CONTRACTS.wNEAR, amount: "0.00075" });
  const elsewhere = tx({ txHash: "sd", direction: "in", counterparty: "carol.near", amount: "0.00075" });
  const m = ruleStorageDeposit([dep, refund, elsewhere], new Set());
  assert.equal(m.get(dep.id)?.label, "storage_deposit");
  assert.equal(m.get(refund.id)?.label, "storage_deposit");
  assert.equal(m.has(elsewhere.id), false, "refund must come from the contract that was called");
  // A same-contract NEAR inflow in a tx without a storage method is not a storage refund.
  const plain = tx({ txHash: "np", direction: "in", counterparty: CONTRACTS.wNEAR, amount: "1" });
  assert.equal(ruleStorageDeposit([plain], new Set()).size, 0);
});

test("rule: storage_deposit — tokens_storage_deposit and storage_withdraw/unregister refunds", () => {
  const tsd = tx({ txHash: "t1", kind: "function_call_with_deposit", counterparty: "aggregatedex.near", method: "tokens_storage_deposit", amount: "0.01" });
  assert.equal(ruleStorageDeposit([tsd], new Set()).get(tsd.id)?.label, "storage_deposit");
  const call = tx({ txHash: "w1", kind: "function_call_with_deposit", counterparty: CONTRACTS.USDC, method: "storage_unregister", amount: "0.000000000000000000000001" });
  const back = tx({ txHash: "w1", direction: "in", counterparty: CONTRACTS.USDC, amount: "0.00125" });
  const all = applyRules([call, back], ctx);
  assert.equal(all.get(back.id)?.label, "storage_deposit");
  assert.equal(all.get(call.id)?.label, "dust_no_value", "the 1 yocto call itself is dust");
});

// ---------- post-AI guards ----------

const classifiedNeedsQuestion = (t: NormalizedTx, label: LabelId, all: NormalizedTx[]) => {
  const g = consistencyGuards(t, label, undefined, all);
  return { guards: g, c: toClassified(t, { label, confidence: 0.95, method: "ai", reason: "r", forceQuestion: g.length > 0 }) };
};

test("guard: disposal_swap without pairingId is flagged", () => {
  const t = tx({ kind: "ft_transfer", asset: WNEAR, counterparty: "aggregatedex.near", amount: "20" });
  assert.deepEqual(consistencyGuards(t, "disposal_swap", undefined, [t]), ["unpaired swap leg"]);
  assert.deepEqual(consistencyGuards(t, "disposal_swap", "swap:abc", [t]), []);
  const { c } = classifiedNeedsQuestion(t, "disposal_swap", [t]);
  assert.equal(c.needsQuestion, true);
  assert.equal(c.label, "disposal_swap", "guards never change the label");
});

test("guard: income_*/gift_received/acquisition_fiat on an outgoing leg is flagged", () => {
  const t = tx({ direction: "out", amount: "5" });
  for (const label of ["income_professional_fees", "income_airdrop", "gift_received", "acquisition_fiat"] as const) {
    assert.ok(consistencyGuards(t, label, undefined, [t]).includes("label contradicts direction"), label);
  }
  assert.deepEqual(consistencyGuards({ ...t, direction: "in" }, "income_airdrop", undefined, [t]), []);
});

test("guard: disposal_*/gift_given on an incoming leg is flagged", () => {
  const t = tx({ direction: "in", amount: "5" });
  for (const label of ["disposal_payment", "disposal_sale_fiat", "gift_given"] as const) {
    assert.ok(consistencyGuards(t, label, undefined, [t]).includes("label contradicts direction"), label);
  }
  assert.deepEqual(consistencyGuards({ ...t, direction: "out" }, "disposal_payment", undefined, [t]), []);
});

test("guard: gas_refund only from 'system' or a contract the account called in the same tx", () => {
  const fromSystem = tx({ direction: "in", counterparty: "system", amount: "0.01" });
  assert.deepEqual(consistencyGuards(fromSystem, "gas_refund", undefined, [fromSystem]), []);
  const call = tx({ txHash: "g1", kind: "function_call_with_deposit", counterparty: "dex.near", method: "swap", amount: "1" });
  const fromCalled = tx({ txHash: "g1", direction: "in", counterparty: "dex.near", amount: "0.1" });
  assert.deepEqual(consistencyGuards(fromCalled, "gas_refund", undefined, [call, fromCalled]), []);
  const fromRelayer = tx({ txHash: "g2", direction: "in", kind: "other", counterparty: "meteor-relayer.near", amount: "0" });
  const { guards, c } = classifiedNeedsQuestion(fromRelayer, "gas_refund", [fromRelayer]);
  assert.equal(guards.length, 1);
  assert.equal(c.needsQuestion, true);
  assert.equal(c.label, "gas_refund");
});
