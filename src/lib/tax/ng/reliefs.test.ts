import assert from "node:assert/strict";
import { test } from "node:test";
import { NafemTable } from "../../fx/nafem";
import type { Asset, NormalizedTx } from "../../history/types";
import { dec } from "../../money";
import type { PriceProvider, PriceResult } from "../../prices/provider";
import { canonicalReportJson } from "../../report/fingerprint";
import { toClassified } from "./classify";
import { runEngine, type EngineResult } from "./engine";
import { pit } from "./pit";
import { computeReliefs, type ReliefInputs } from "./reliefs";

const NEAR: Asset = { symbol: "NEAR", contract: null, decimals: 24 };
const TS = "2026-03-02T10:00:00.000Z";

class FakePrices implements PriceProvider {
  async quote(asset: Asset, ts: string): Promise<PriceResult> {
    if (asset.contract === null && ts === TS) return { status: "ok", quote: { usd: "5", granularity: "hourly", pointTime: ts, source: "test", method: "test" } };
    return { status: "no_verifiable_price", attempted: ["test: no price"] };
  }
}
const fx = NafemTable.parse(["# Source: test", "# Retrieved: test", "date,closing_rate", "2026-03-02,1000"].join("\n"));

/** One staking reward of `nearQty` NEAR at $5 and NGN 1,000/$: chargeable VA = nearQty x 5,000. */
function reward(nearQty: string) {
  const tx: NormalizedTx = {
    id: "r1",
    txHash: "h1",
    timestamp: TS,
    direction: "in",
    kind: "staking_reward",
    asset: NEAR,
    amount: nearQty,
    counterparty: "pool.near",
    method: null,
    success: true,
    source: "test",
    raw: null,
    fee: null,
  };
  return toClassified(tx, { label: "income_staking_reward", confidence: 1, method: "rule", reason: "test" });
}

const run = (chargeableNear: string, otherIncomeNgn: string | null, reliefs?: ReliefInputs | null): Promise<EngineResult> =>
  runEngine({ year: 2026, records: [reward(chargeableNear)], prices: new FakePrices(), fx, openingBalances: [], otherIncomeNgn, reliefs });

const eq = (a: string, b: string | number, msg?: string) => assert.ok(dec(a).eq(dec(String(b))), msg ?? `${a} != ${b}`);

test("rent relief is 20% of rent paid, capped at NGN 500,000", () => {
  const below = computeReliefs({ rentPaidNgn: "2400000" });
  assert.deepEqual(below.items, [{ id: "rent_relief", label: "Rent relief", allowedNgn: "480000", capped: false }]);
  const at = computeReliefs({ rentPaidNgn: "2500000" });
  eq(at.items[0].allowedNgn, 500000);
  assert.equal(at.items[0].capped, false);
  const above = computeReliefs({ rentPaidNgn: "3000000" });
  assert.equal(above.items[0].allowedNgn, "500000");
  assert.equal(above.items[0].capped, true);
  // Other reliefs are allowed in full and added up.
  const mix = computeReliefs({ rentPaidNgn: "9000000", pensionNgn: "400000", nhfNgn: "25000.50", nhisNgn: "", lifeInsuranceNgn: null });
  eq(mix.totalNgn, "925000.50");
  assert.deepEqual(
    mix.items.map((i) => i.id),
    ["rent_relief", "pension", "nhf"],
  );
});

test("reliefs reduce attributable tax with other income (marginal across a band edge)", async () => {
  // other 2,500,000; chargeable VA 1,000,000; reliefs 500,000 rent cap + 500,000 pension = 1,000,000
  const before = await run("200", "2500000");
  const after = await run("200", "2500000", { rentPaidNgn: "3000000", pensionNgn: "500000" });
  eq(before.totals.chargeableVaNgn, 1000000);
  // PIT(3.5m) - PIT(2.5m) = 420,000 - 255,000
  eq(before.tax.taxAttributableToVaNgn, 165000);
  assert.equal(before.tax.reliefs, undefined, "no reliefs entered: no reliefs block");
  // PIT(2.5m) - PIT(1.5m) = 255,000 - 105,000
  eq(after.tax.pitWithVaNgn, pit("2500000").tax.toFixed());
  eq(after.tax.pitWithoutVaNgn, pit("1500000").tax.toFixed());
  eq(after.tax.taxAttributableToVaNgn, 150000);
  const r = after.tax.reliefs!;
  eq(r.totalNgn, 1000000);
  eq(r.taxAttributableWithoutReliefsNgn, 165000);
  eq(r.reliefSavingNgn, 15000);
  eq(r.totalPitSavingNgn, 165000, "PIT(3.5m) - PIT(2.5m)");
  assert.ok(after.decisionsApplied.some((d) => d.id === "D15"));
  assert.ok(!before.decisionsApplied.some((d) => d.id === "D15"));
});

test("reliefs reduce attributable tax without other income", async () => {
  // chargeable 1,000,000; rent relief 500,000: PIT(1m) = 30,000 before, PIT(500k) = 0 after.
  const before = await run("200", null);
  const after = await run("200", null, { rentPaidNgn: "2500000" });
  eq(before.tax.taxAttributableToVaNgn, 30000);
  eq(after.tax.taxAttributableToVaNgn, 0);
  assert.equal(after.tax.basis, "standalone");
  eq(after.tax.reliefs!.reliefSavingNgn, 30000);
});

test("reliefs larger than other income floor the base at zero", async () => {
  // other 300,000; reliefs 1,000,000; chargeable 5,000,000.
  const after = await run("1000", "300000", { rentPaidNgn: "3000000", pensionNgn: "500000" });
  eq(after.tax.pitWithoutVaNgn, 0, "PIT(max(0, 300k - 1m)) = 0");
  eq(after.tax.pitWithVaNgn, pit("4300000").tax.toFixed(), "PIT(max(0, 300k + 5m - 1m))");
  eq(after.tax.taxAttributableToVaNgn, 564000);
  const before = await run("1000", "300000");
  eq(before.tax.taxAttributableToVaNgn, 744000, "PIT(5.3m) - PIT(300k)");
  eq(after.tax.reliefs!.reliefSavingNgn, 180000);
  // Everything below the reliefs: nil tax, never negative.
  const small = await run("20", "300000", { rentPaidNgn: "3000000", pensionNgn: "500000" });
  eq(small.tax.taxAttributableToVaNgn, 0);
  eq(small.tax.reliefs!.reliefSavingNgn, 0, "PIT(400k) - PIT(300k) = 0 before reliefs too");
});

test("reliefSavingNgn is 0 when both bases stay in the same band; total PIT still falls", async () => {
  // other 4,800,000; chargeable 1,000,000; reliefs 880,000: everything stays in the 18% band.
  const after = await run("200", "4800000", { rentPaidNgn: "2400000", pensionNgn: "400000" });
  eq(after.tax.taxAttributableToVaNgn, 180000);
  eq(after.tax.reliefs!.reliefSavingNgn, 0);
  eq(after.tax.reliefs!.totalPitSavingNgn, 158400, "880,000 x 18%");
});

test("raw relief inputs are excluded from the fingerprint; allowed amounts are covered", async () => {
  const a = await run("200", "2500000", { rentPaidNgn: "3000000" });
  const b = await run("200", "2500000", { rentPaidNgn: "4000000" });
  assert.notDeepEqual(a.tax.reliefs!.inputs, b.tax.reliefs!.inputs);
  assert.equal(canonicalReportJson(a), canonicalReportJson(b), "both capped at 500,000: same canonical report");
  const c = await run("200", "2500000", { rentPaidNgn: "2000000" });
  assert.notEqual(canonicalReportJson(a), canonicalReportJson(c), "a different allowed amount changes the fingerprint");
  assert.ok(!canonicalReportJson(a).includes("rentPaidNgn"));
});
