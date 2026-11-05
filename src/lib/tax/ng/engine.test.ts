import assert from "node:assert/strict";
import { test } from "node:test";
import { NafemTable } from "../../fx/nafem";
import type { Asset, NormalizedTx } from "../../history/types";
import { Dec, dec, money2 } from "../../money";
import type { PriceProvider, PriceResult } from "../../prices/provider";
import { toClassified } from "./classify";
import { runEngine, type EngineInput } from "./engine";
import type { LabelId } from "./labels";
import { RESET_PRICE_TIME } from "./opening";
import { pit } from "./pit";
import type { ClassifiedTx } from "./types";

const NEAR: Asset = { symbol: "NEAR", contract: null, decimals: 24 };
const WNEAR: Asset = { symbol: "wNEAR", contract: "wrap.near", decimals: 24 };
const ETH: Asset = { symbol: "ETH", contract: "eth.test.near", decimals: 18 };
const BTC: Asset = { symbol: "BTC", contract: "btc.test.near", decimals: 8 };
const TOKEN: Asset = { symbol: "TKN", contract: "tkn.test.near", decimals: 18 };

/** Fake prices keyed by "<contract|native>|<timestamp>"; anything else has no verifiable price. */
class FakePrices implements PriceProvider {
  constructor(private readonly table: Record<string, string>) {}
  async quote(asset: Asset, ts: string): Promise<PriceResult> {
    const usd = this.table[`${asset.contract ?? "native"}|${ts}`];
    if (usd === undefined) return { status: "no_verifiable_price", attempted: ["test: no price"] };
    return { status: "ok", quote: { usd, granularity: "hourly", pointTime: ts, source: "test", method: "test" } };
  }
}

const fx = (rows: Record<string, string>) =>
  NafemTable.parse(["# Source: test", "# Retrieved: test", "date,closing_rate", ...Object.entries(rows).map(([d, r]) => `${d},${r}`)].join("\n"));

let n = 0;
function rec(p: Partial<NormalizedTx> & { label: LabelId; userFiat?: { ngn: string }; pairingId?: string; incompleteSourceLeg?: boolean }): ClassifiedTx {
  n++;
  const { label, userFiat, pairingId, incompleteSourceLeg, ...tx } = p;
  const base: NormalizedTx = {
    id: `r${String(n).padStart(4, "0")}`,
    txHash: `h${n}`,
    timestamp: "2026-03-02T10:00:00.000Z",
    direction: "in",
    kind: "native_transfer",
    asset: NEAR,
    amount: "1",
    counterparty: "x.near",
    method: null,
    success: true,
    source: "test",
    raw: null,
    fee: null,
    ...tx,
  };
  const c = toClassified(base, { label, confidence: 1, method: "user", reason: "test", pairingId });
  if (userFiat) c.userFiat = userFiat;
  if (incompleteSourceLeg) c.incompleteSourceLeg = true;
  return c;
}

const engine = (p: Partial<EngineInput> & Pick<EngineInput, "records" | "prices" | "fx">) =>
  runEngine({ year: 2026, openingBalances: [], ...p });

// ---------- circular illustrations ----------

test("Circular Illustration 2: NGN 1,000,000 at 1,000/$ then sold for NGN 1,970,000 at 1,500/$ -> gain NGN 470,000", async () => {
  const buy = rec({ label: "acquisition_fiat", asset: BTC, amount: "1", timestamp: "2026-02-02T10:00:00.000Z", userFiat: { ngn: "1000000" } });
  const sell = rec({ label: "disposal_sale_fiat", asset: BTC, amount: "1", direction: "out", timestamp: "2026-06-01T10:00:00.000Z", userFiat: { ngn: "1970000" } });
  const r = await engine({ records: [buy, sell], prices: new FakePrices({}), fx: fx({ "2026-02-02": "1000", "2026-06-01": "1500" }) });
  const acq = r.lines.find((l) => l.recordId === buy.id)!;
  const disp = r.lines.find((l) => l.recordId === sell.id)!;
  assert.equal(acq.costUsd, "1000");
  assert.ok(disp.proceedsUsd!.startsWith("1313.33333333333333333333"), disp.proceedsUsd);
  assert.equal(money2(dec(disp.proceedsUsd!)), "1313.33");
  assert.equal(money2(dec(disp.gainNgn!)), "470000.00");
  assert.ok(dec(disp.gainNgn!).minus(470000).abs().lt(new Dec("1e-90")), "full precision within 1e-90 of 470,000");
  assert.equal(money2(dec(r.totals.netGainsNgn)), "470000.00");
});

test("Circular Illustration 3: 2 ETH (cost $3,000) swapped for 0.1 BTC at ETH $2,000 / BTC $40,000, NGN 1,600/$", async () => {
  const buy = rec({ label: "acquisition_fiat", asset: ETH, amount: "2", timestamp: "2026-02-02T10:00:00.000Z", userFiat: { ngn: "4800000" } });
  const ts = "2026-04-01T12:00:00.000Z";
  const give = rec({ label: "disposal_swap", asset: ETH, amount: "2", direction: "out", kind: "ft_transfer", timestamp: ts, txHash: "swap", pairingId: "swap:swap" });
  const get = rec({ label: "acquisition_swap", asset: BTC, amount: "0.1", direction: "in", kind: "ft_transfer", timestamp: ts, txHash: "swap", pairingId: "swap:swap" });
  const r = await engine({
    records: [buy, give, get],
    prices: new FakePrices({ [`eth.test.near|${ts}`]: "2000", [`btc.test.near|${ts}`]: "40000" }),
    fx: fx({ "2026-02-02": "1600", "2026-04-01": "1600" }),
  });
  const d = r.lines.find((l) => l.recordId === give.id)!;
  assert.equal(d.costUsd, "3000");
  assert.equal(d.proceedsUsd, "4000");
  assert.equal(d.fmvReceivedUsd, "4000", "D1: FMV of asset received stored too");
  assert.equal(d.gainUsd, "1000");
  assert.equal(d.gainNgn, "1600000");
  const btcLot = r.closingLots.find((l) => l.assetKey === "btc.test.near")!;
  assert.equal(btcLot.costUsd, "4000");
  assert.equal(btcLot.qty, "0.1");
});

// ---------- PIT ----------

test("PIT bands: 6,000,000 -> 870,000; 800,000 -> 0; 3,000,000 -> 330,000", () => {
  assert.equal(pit("6000000").tax.toFixed(), "870000");
  assert.equal(pit("800000").tax.toFixed(), "0");
  assert.equal(pit("3000000").tax.toFixed(), "330000");
  assert.equal(pit("60000000").tax.toFixed(), "12930000", "all six bands: 330k + 1.62m + 2.73m + 5.75m + 2.5m");
});

// ---------- engine behaviour ----------

test("FIFO across multiple lots", async () => {
  const a = rec({ label: "acquisition_fiat", asset: BTC, amount: "1", timestamp: "2026-02-02T10:00:00.000Z", userFiat: { ngn: "100" } });
  const b = rec({ label: "acquisition_fiat", asset: BTC, amount: "1", timestamp: "2026-02-03T10:00:00.000Z", userFiat: { ngn: "200" } });
  const ts = "2026-02-04T10:00:00.000Z";
  const s = rec({ label: "disposal_payment", asset: BTC, amount: "1.5", direction: "out", timestamp: ts });
  const r = await engine({ records: [a, b, s], prices: new FakePrices({ [`btc.test.near|${ts}`]: "300" }), fx: fx({ "2026-02-02": "1", "2026-02-03": "1", "2026-02-04": "1" }) });
  const d = r.lines.find((l) => l.recordId === s.id)!;
  assert.equal(d.costUsd, "200", "first lot (100) + half of the second (100)");
  assert.equal(d.proceedsUsd, "450");
  assert.equal(d.gainUsd, "250");
  assert.deepEqual(r.closingLots.map((l) => [l.qty, l.costUsd]), [["0.5", "100"]]);
});

test("NEAR and wNEAR share one lot pool", async () => {
  const buy = rec({ label: "acquisition_fiat", asset: NEAR, amount: "10", timestamp: "2026-02-02T10:00:00.000Z", userFiat: { ngn: "30" } });
  const ts = "2026-02-05T10:00:00.000Z";
  const give = rec({ label: "disposal_payment", asset: WNEAR, amount: "4", direction: "out", kind: "ft_transfer", timestamp: ts });
  const r = await engine({ records: [buy, give], prices: new FakePrices({ [`wrap.near|${ts}`]: "5" }), fx: fx({ "2026-02-02": "1", "2026-02-05": "1" }) });
  const d = r.lines.find((l) => l.recordId === give.id)!;
  assert.equal(d.costUsd, "12", "4 of 10 NEAR lot costing $30");
  assert.equal(r.warnings.filter((w) => w.code === "missing_acquisition_history").length, 0);
  assert.deepEqual(r.closingLots.map((l) => [l.assetKey, l.qty]), [["NEAR", "6"]]);
});

test("staking reward step-up: income at FMV becomes the cost base", async () => {
  const t1 = "2026-03-01T23:59:59.999Z";
  const t2 = "2026-05-01T10:00:00.000Z";
  const reward = rec({ label: "income_staking_reward", kind: "staking_reward", amount: "1", counterparty: "pool.poolv1.near", timestamp: t1 });
  const spend = rec({ label: "disposal_payment", amount: "1", direction: "out", timestamp: t2 });
  const r = await engine({ records: [reward, spend], prices: new FakePrices({ [`native|${t1}`]: "3", [`native|${t2}`]: "5" }), fx: fx({ "2026-03-01": "1500", "2026-05-01": "1500" }) });
  const inc = r.lines.find((l) => l.recordId === reward.id)!;
  assert.equal(inc.incomeUsd, "3");
  assert.equal(inc.incomeNgn, "4500");
  const d = r.lines.find((l) => l.recordId === spend.id)!;
  assert.equal(d.costUsd, "3");
  assert.equal(d.gainUsd, "2");
  assert.equal(r.totals.totalVaIncomeNgn, "4500");
  assert.ok(r.decisionsApplied.some((x) => x.id === "D3"));
});

test("D11 reset: cost base = max(original, reset); both values recorded; no-reset gain shown", async () => {
  const ts = "2026-03-01T10:00:00.000Z";
  const prices = new FakePrices({ [`native|${RESET_PRICE_TIME}`]: "2", [`native|${ts}`]: "4" });
  const fxT = fx({ "2025-12-31": "1500", "2026-03-01": "1500" });
  const sell = () => rec({ label: "disposal_payment", amount: "10", direction: "out", timestamp: ts });
  const opening = [{ asset: NEAR, qty: "10", source: "test" }];

  const higherOriginal = await engine({ records: [sell()], prices, fx: fxT, openingBalances: opening, originalCostUsd: { NEAR: "30" } });
  assert.equal(higherOriginal.openingLots[0].costUsd, "30");
  assert.equal(higherOriginal.openingLots[0].resetCostUsd, "20");
  assert.equal(higherOriginal.openingLots[0].originalCostUsd, "30");
  const d1 = higherOriginal.lines.find((l) => l.kind === "disposal")!;
  assert.equal(d1.gainUsd, "10");
  assert.equal(d1.noResetGainUsd, "10");

  const lowerOriginal = await engine({ records: [sell()], prices, fx: fxT, openingBalances: opening, originalCostUsd: { NEAR: "10" } });
  assert.equal(lowerOriginal.openingLots[0].costUsd, "20", "reset value wins when higher");
  const d2 = lowerOriginal.lines.find((l) => l.kind === "disposal")!;
  assert.equal(d2.gainUsd, "20", "reset gain");
  assert.equal(d2.noResetCostUsd, "10");
  assert.equal(d2.noResetGainUsd, "30", "no-reset gain shown alongside");

  const noOriginal = await engine({ records: [sell()], prices, fx: fxT, openingBalances: opening });
  assert.equal(noOriginal.openingLots[0].costUsd, "20");
  assert.equal(noOriginal.lines.find((l) => l.kind === "disposal")!.noResetGainUsd, undefined);
});

test("net disposal loss is carried forward and does not reduce income", async () => {
  const t1 = "2026-03-01T23:59:59.999Z";
  const t2 = "2026-04-01T10:00:00.000Z";
  const reward = rec({ label: "income_staking_reward", kind: "staking_reward", amount: "1", timestamp: t1 });
  const buy = rec({ label: "acquisition_fiat", asset: BTC, amount: "1", timestamp: "2026-03-10T10:00:00.000Z", userFiat: { ngn: "100" } });
  const sell = rec({ label: "disposal_payment", asset: BTC, amount: "1", direction: "out", timestamp: t2 });
  const r = await engine({
    records: [reward, buy, sell],
    prices: new FakePrices({ [`native|${t1}`]: "10", [`btc.test.near|${t2}`]: "40" }),
    fx: fx({ "2026-03-01": "1", "2026-03-10": "1", "2026-04-01": "1" }),
  });
  assert.equal(r.totals.netGainsNgn, "-60");
  assert.equal(r.carryForwardLossNgn, "60");
  assert.equal(r.totals.totalVaIncomeNgn, "10");
  assert.equal(r.totals.chargeableVaNgn, "10", "income is not reduced by the loss");
  assert.ok(r.tax.notes.some((x) => /carried forward/.test(x)));
});

test("rate_fallback: a weekend date uses the prior published NFEM rate, flagged; never interpolated", async () => {
  const sat = "2026-01-03T12:00:00.000Z";
  const reward = rec({ label: "income_airdrop", amount: "1", timestamp: sat });
  const r = await engine({ records: [reward], prices: new FakePrices({ [`native|${sat}`]: "2" }), fx: fx({ "2026-01-02": "1431", "2026-01-05": "1428" }) });
  const l = r.lines.find((x) => x.recordId === reward.id)!;
  assert.equal(l.rateFallback, true);
  assert.equal(l.rateDate, "2026-01-02");
  assert.equal(l.nafemRate, "1431", "prior date's rate, not an average of 1431 and 1428");
  assert.equal(l.incomeNgn, "2862");
  assert.ok(r.warnings.some((w) => w.code === "rate_fallback"));
  assert.throws(() => fx({ "2026-01-02": "1431" }).quote("2026-01-01"), /No CBN NFEM rate/);
});

test("missing price: excluded from totals with a warning, never fabricated", async () => {
  const ts = "2026-03-01T10:00:00.000Z";
  const drop = rec({ label: "income_airdrop", asset: TOKEN, kind: "ft_transfer", amount: "100", timestamp: ts });
  const r = await engine({ records: [drop], prices: new FakePrices({}), fx: fx({ "2026-03-01": "1500" }) });
  const l = r.lines.find((x) => x.recordId === drop.id)!;
  assert.equal(l.priceStatus, "no_verifiable_price");
  assert.equal(l.includedInTotals, false);
  assert.equal(l.usdPrice, null);
  assert.equal(r.totals.totalVaIncomeNgn, "0");
  assert.ok(r.warnings.some((w) => w.code === "no_verifiable_price" && w.recordId === drop.id));
});

test("gas fee on a signed tx is a separate NEAR disposal line (D2)", async () => {
  const t0 = "2026-02-02T10:00:00.000Z";
  const t1 = "2026-02-03T10:00:00.000Z";
  const buy = rec({ label: "acquisition_fiat", amount: "10", timestamp: t0, userFiat: { ngn: "20" } });
  const swapOut = rec({ label: "own_wallet_transfer", direction: "out", amount: "1", timestamp: t1, fee: { asset: "NEAR", amount: "0.01" } });
  const r = await engine({ records: [buy, swapOut], prices: new FakePrices({ [`native|${t1}`]: "3" }), fx: fx({ "2026-02-02": "1", "2026-02-03": "1" }) });
  const fee = r.lines.find((l) => l.kind === "gas_fee")!;
  assert.equal(fee.qty, "0.01");
  assert.equal(fee.proceedsUsd, "0.03");
  assert.equal(fee.costUsd, "0.02");
  assert.equal(fee.gainUsd, "0.01");
  assert.equal(r.totals.gasFeesUsd, "0.03");
  assert.match(fee.circularRef, /7\.1 event 5/);
});
