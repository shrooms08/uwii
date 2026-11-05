import assert from "node:assert/strict";
import { test } from "node:test";
import { NEAR_ASSET, type NormalizedTx } from "../../history/types";
import { CONTRACTS } from "./labels";
import {
  applyRules,
  ruleGasRefund,
  ruleLiquidStaking,
  ruleOwnWallet,
  ruleStakingLockup,
  ruleStakingReward,
  ruleSwapPairing,
  ruleWrapUnwrap,
} from "./rules";

const ACCOUNT = "alice.near";
const WNEAR = { symbol: "wNEAR", contract: CONTRACTS.wNEAR, decimals: 24 };
const USDC = { symbol: "USDC", contract: CONTRACTS.USDC, decimals: 6 };
const STNEAR = { symbol: "STNEAR", contract: CONTRACTS.stNEAR, decimals: 24 };

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

test("rule: staking_reward -> income_staking_reward", () => {
  const m = ruleStakingReward(tx({ kind: "staking_reward", direction: "in", counterparty: "astro-stakers.poolv1.near" }));
  assert.equal(m?.label, "income_staking_reward");
  assert.equal(m?.confidence, 1);
  assert.equal(m?.method, "rule");
  assert.equal(ruleStakingReward(tx({ kind: "native_transfer" })), null);
});

test("rule: stake/unstake/withdraw with a staking pool -> staking_lockup", () => {
  for (const kind of ["stake", "unstake", "withdraw_stake"] as const) {
    assert.equal(ruleStakingLockup(tx({ kind, counterparty: "astro-stakers.poolv1.near", method: "deposit_and_stake" }))?.label, "staking_lockup");
  }
  assert.equal(ruleStakingLockup(tx({ kind: "stake", counterparty: "meta-pool.near" })), null, "liquid staking is not a validator pool");
});

test("rule: system refunds -> gas_refund", () => {
  assert.equal(ruleGasRefund(tx({ kind: "other", direction: "in", counterparty: "system", amount: "0.0002" }))?.label, "gas_refund");
  assert.equal(ruleGasRefund(tx({ kind: "native_transfer", direction: "in", counterparty: "bob.near" })), null);
});

test("rule: wrap.near near_deposit / near_withdraw legs -> wrap_unwrap", () => {
  const nativeOut = tx({ txHash: "wrap1", kind: "function_call_with_deposit", counterparty: CONTRACTS.wNEAR, method: "near_deposit", amount: "20" });
  const mint = tx({ txHash: "wrap1", kind: "ft_transfer", direction: "in", asset: WNEAR, counterparty: null, method: "near_deposit", amount: "20" });
  const burn = tx({ txHash: "unwrap1", kind: "ft_transfer", direction: "out", asset: WNEAR, counterparty: null, method: "near_withdraw", amount: "5" });
  const payout = tx({ txHash: "unwrap1", kind: "native_transfer", direction: "in", counterparty: CONTRACTS.wNEAR, method: null, amount: "5.000000000000000000000001" });
  const storage = tx({ txHash: "st1", kind: "function_call_with_deposit", counterparty: CONTRACTS.wNEAR, method: "storage_deposit", amount: "0.00125" });
  const m = ruleWrapUnwrap([nativeOut, mint, burn, payout, storage]);
  for (const t of [nativeOut, mint, burn, payout]) assert.equal(m.get(t.id)?.label, "wrap_unwrap", t.id);
  assert.equal(m.has(storage.id), false, "storage_deposit is not a wrap");
});

test("rule: liquid staking deposits/redemptions -> defi_receipt", () => {
  const deposit = tx({ kind: "function_call_with_deposit", counterparty: CONTRACTS.stNEAR, method: "deposit_and_stake", amount: "10" });
  const mint = tx({ kind: "ft_transfer", direction: "in", asset: STNEAR, counterparty: null, amount: "8.1" });
  const redemption = tx({ kind: "native_transfer", direction: "in", counterparty: CONTRACTS.LiNEAR, amount: "3" });
  for (const t of [deposit, mint, redemption]) assert.equal(ruleLiquidStaking(t)?.label, "defi_receipt");
  assert.equal(ruleLiquidStaking(tx({ kind: "ft_transfer", asset: STNEAR, counterparty: "v2.ref-finance.near" })), null, "stNEAR sold on a DEX is not a receipt");
});

test("rule: own-wallet transfers only for declared own accounts", () => {
  const ctx = { accountId: ACCOUNT, ownAccounts: ["alice-savings.near"] };
  assert.equal(ruleOwnWallet(tx({ counterparty: "alice-savings.near" }), ctx)?.label, "own_wallet_transfer");
  assert.equal(ruleOwnWallet(tx({ direction: "in", kind: "ft_transfer", asset: USDC, counterparty: "alice-savings.near" }), ctx)?.label, "own_wallet_transfer");
  assert.equal(ruleOwnWallet(tx({ counterparty: "bob.near" }), ctx), null, "undeclared account");
  assert.equal(ruleOwnWallet(tx({ counterparty: "alice-savings.near" }), { accountId: ACCOUNT, ownAccounts: [] }), null, "nothing declared");
  // Own-wallet wins over swap pairing in applyRules.
  const out = tx({ txHash: "ow", kind: "ft_transfer", asset: USDC, counterparty: "alice-savings.near" });
  const inn = tx({ txHash: "ow", direction: "in", counterparty: "alice-savings.near" });
  const all = applyRules([out, inn], ctx);
  assert.equal(all.get(out.id)?.label, "own_wallet_transfer");
  assert.equal(all.get(inn.id)?.label, "own_wallet_transfer");
});

test("swap pairing: different-asset legs in one tx are paired; same-asset refunds and dust are not", () => {
  const give = tx({ txHash: "s1", kind: "ft_transfer", asset: WNEAR, counterparty: "aggregatedex.near", method: "ft_transfer_call", amount: "20" });
  const dust = tx({ txHash: "s1", kind: "function_call_with_deposit", counterparty: CONTRACTS.wNEAR, method: "ft_transfer_call", amount: "0.000000000000000000000001" });
  const get = tx({ txHash: "s1", kind: "ft_transfer", direction: "in", asset: USDC, counterparty: "aggregatedex.near", amount: "4.911523" });
  const m = ruleSwapPairing([give, dust, get], new Set());
  assert.equal(m.get(give.id)?.label, "disposal_swap");
  assert.equal(m.get(give.id)?.swapRole, "disposed");
  assert.equal(m.get(get.id)?.swapRole, "acquired");
  assert.equal(m.get(give.id)?.pairingId, "swap:s1");
  assert.equal(m.get(get.id)?.pairingId, m.get(give.id)?.pairingId);
  assert.equal(m.has(dust.id), false, "1 yocto security deposit is not a swap leg");

  // A failed swap that refunds the same asset is not a swap.
  const out2 = tx({ txHash: "s2", kind: "ft_transfer", asset: WNEAR, counterparty: "aggregatedex.near", amount: "20" });
  const back2 = tx({ txHash: "s2", kind: "ft_transfer", direction: "in", asset: WNEAR, counterparty: "aggregatedex.near", amount: "20" });
  assert.equal(ruleSwapPairing([out2, back2], new Set()).size, 0);

  // wNEAR and NEAR are the same asset for pairing.
  const out3 = tx({ txHash: "s3", kind: "ft_transfer", asset: WNEAR, counterparty: "x.near", amount: "1" });
  const in3 = tx({ txHash: "s3", kind: "native_transfer", direction: "in", counterparty: "x.near", amount: "1" });
  assert.equal(ruleSwapPairing([out3, in3], new Set()).size, 0);

  // Legs already labelled by an earlier rule are excluded.
  assert.equal(ruleSwapPairing([give, get], new Set([give.id])).size, 0);
});
