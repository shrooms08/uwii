import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReportLine, TaxReliefs } from "../tax/ng/engine";
import { dec } from "../money";
import { reviewContactUrl } from "./review";
import { taxTips, type TipId, type TipsInput } from "./tips";

function line(p: Partial<ReportLine>): ReportLine {
  return {
    recordId: "r1",
    txHash: "h1",
    timestamp: "2026-03-02T10:00:00.000Z",
    date: "2026-03-02",
    label: "disposal_sale_fiat",
    kind: "disposal",
    asset: "NEAR",
    assetKey: "NEAR",
    qty: "1",
    usdPrice: "10",
    priceGranularity: "hourly",
    priceSource: "test",
    priceMethod: "test",
    priceStatus: "ok",
    usdValue: "10",
    nafemRate: "1500",
    rateDate: "2026-03-02",
    rateFallback: false,
    ngnValue: "15000",
    circularRef: "test",
    method: "rule",
    includedInTotals: true,
    notes: [],
    ...p,
  } as ReportLine;
}

const reliefs = (inputs: TaxReliefs["inputs"]): TaxReliefs => ({
  inputs,
  items: [],
  totalNgn: "0",
  taxAttributableWithoutReliefsNgn: "0",
  reliefSavingNgn: "0",
  totalPitSavingNgn: "0",
});

/** A report with nothing that triggers a tip, except "add your other income and reliefs" (no profile). */
const base = (): TipsInput => ({ lines: [line({})], totals: { gasFeesNgn: "0" }, carryForwardLossNgn: "0", tax: { otherIncomeNgn: null } });
const ids = (r: TipsInput): TipId[] => taxTips(r).map((t) => t.id);

test("missing cost: only when an included disposal used units with no acquisition history; amount = gain on that part", () => {
  assert.ok(!ids(base()).includes("missing_cost"));
  const r = base();
  r.lines = [line({ qty: "2", proceedsUsd: "20", gainUsd: "15", notes: ["missing acquisition history for 0.5 NEAR: nil cost used"] })];
  const tip = taxTips(r).find((t) => t.id === "missing_cost")!;
  // 0.5 of 2 units -> a quarter of $20 proceeds = $5, at NGN 1,500/$ = NGN 7,500.
  assert.ok(dec(tip.amountNgn!).eq(7500), tip.amountNgn!);
  assert.match(tip.text, /may lower your gain by up to ₦7,500\.00/);
  // An excluded disposal does not count.
  r.lines = [line({ qty: "2", proceedsUsd: "20", includedInTotals: false, notes: ["missing acquisition history for 0.5 NEAR: nil cost used"] })];
  assert.ok(!ids(r).includes("missing_cost"));
});

test("loss carried forward: only when there is a net loss", () => {
  assert.ok(!ids(base()).includes("loss_carry_forward"));
  const r = base();
  r.carryForwardLossNgn = "12345.67";
  const tip = taxTips(r).find((t) => t.id === "loss_carry_forward")!;
  assert.match(tip.text, /net loss of ₦12,345\.67 carries forward to future crypto gains \(9\.4\)/);
});

test("rent relief: only when other income is entered and rent is not", () => {
  assert.ok(!ids(base()).includes("rent_relief"), "no other income");
  const r = base();
  r.tax = { otherIncomeNgn: "4800000" };
  assert.ok(ids(r).includes("rent_relief"));
  r.tax = { otherIncomeNgn: "4800000", reliefs: reliefs({ pensionNgn: "100000" }) };
  assert.ok(ids(r).includes("rent_relief"), "other reliefs but no rent");
  r.tax = { otherIncomeNgn: "4800000", reliefs: reliefs({ rentPaidNgn: "1200000" }) };
  assert.ok(!ids(r).includes("rent_relief"), "rent entered");
});

test("add your other income and reliefs: only when neither is entered", () => {
  assert.ok(ids(base()).includes("add_income_and_reliefs"));
  const r = base();
  r.tax = { otherIncomeNgn: "100000" };
  assert.ok(!ids(r).includes("add_income_and_reliefs"));
  r.tax = { otherIncomeNgn: null, reliefs: reliefs({ nhfNgn: "1000" }) };
  assert.ok(!ids(r).includes("add_income_and_reliefs"));
});

test("no verifiable price: only when a line is left out for that reason", () => {
  assert.ok(!ids(base()).includes("no_verifiable_price"));
  const r = base();
  r.lines = [line({ asset: "MOON", kind: "income", label: "income_defi_yield", priceStatus: "no_verifiable_price", includedInTotals: false })];
  const tip = taxTips(r).find((t) => t.id === "no_verifiable_price")!;
  assert.match(tip.text, /1 line in MOON has no verifiable price/);
  assert.equal(tip.citation, "Circular 9.2(4)");
});

test("gas fees: shown (as not deductible) only when included gas fees exist", () => {
  assert.ok(!ids(base()).includes("gas_not_deductible"));
  const r = base();
  r.lines = [line({ kind: "gas_fee", label: "gas_fee" })];
  r.totals = { gasFeesNgn: "127.98" };
  const tip = taxTips(r).find((t) => t.id === "gas_not_deductible")!;
  assert.match(tip.text, /not deductible \(D2\)/);
});

test("a report with a profile and nothing else to act on shows no tips", () => {
  const r = base();
  r.tax = { otherIncomeNgn: "100000", reliefs: reliefs({ rentPaidNgn: "1" }) };
  assert.deepEqual(ids(r), []);
});

test("review card is hidden when NEXT_PUBLIC_REVIEW_CONTACT_URL is unset or not a usable URL", async () => {
  assert.equal(reviewContactUrl(undefined), null);
  assert.equal(reviewContactUrl(""), null);
  assert.equal(reviewContactUrl("   "), null);
  assert.equal(reviewContactUrl("javascript:alert(1)"), null);
  assert.equal(reviewContactUrl("not a url"), null);
  assert.equal(reviewContactUrl("https://example.com/review"), "https://example.com/review");
  assert.equal(reviewContactUrl("mailto:review@example.com"), "mailto:review@example.com");
  // The component itself renders nothing without the env var.
  const saved = process.env.NEXT_PUBLIC_REVIEW_CONTACT_URL;
  delete process.env.NEXT_PUBLIC_REVIEW_CONTACT_URL;
  try {
    const { ReviewCard } = await import("../../components/report/TaxHelp");
    assert.equal(ReviewCard({}), null);
    assert.notEqual(ReviewCard({ url: "https://example.com/review" }), null);
  } finally {
    if (saved !== undefined) process.env.NEXT_PUBLIC_REVIEW_CONTACT_URL = saved;
  }
});
