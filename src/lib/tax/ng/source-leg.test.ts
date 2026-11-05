import assert from "node:assert/strict";
import { test } from "node:test";
import { NafemTable } from "../../fx/nafem";
import type { Asset, NormalizedTx } from "../../history/types";
import { dec, money2 } from "../../money";
import type { PriceProvider, PriceResult } from "../../prices/provider";
import { reportStatus } from "../../report/status";
import { toClassified } from "./classify";
import { runEngine } from "./engine";
import type { LabelId } from "./labels";
import { applyAnswers, groupQuestions, INTENTS_ACCOUNT, type Answers } from "./questions";
import { normalizeSourceLeg, USER_SOURCE_LEG_NOTE } from "./source-leg";
import type { ClassifiedTx } from "./types";

const NEAR: Asset = { symbol: "NEAR", contract: null, decimals: 24 };
const NPRO: Asset = { symbol: "NPRO", contract: "npro.nearmobile.near", decimals: 24 };
const TKN: Asset = { symbol: "TKN", contract: "tkn.test.near", decimals: 18 };

class FakePrices implements PriceProvider {
  constructor(private readonly table: Record<string, string>) {}
  async quote(asset: Asset, ts: string): Promise<PriceResult> {
    const usd = this.table[`${asset.contract ?? "native"}|${ts}`];
    if (usd === undefined) return { status: "no_verifiable_price", attempted: ["test: no price"] };
    return { status: "ok", quote: { usd, granularity: "hourly", pointTime: ts, source: "test", method: "test" } };
  }
}
const fx = NafemTable.parse(["# Source: test", "# Retrieved: test", "date,closing_rate", "2026-02-02,1500", "2026-10-13,1500"].join("\n"));

const BUY_TS = "2026-02-02T10:00:00.000Z";
const LEG_TS = "2026-10-13T07:00:00.000Z";
const RECEIPT_TS = "2026-10-13T08:00:00.000Z";

let n = 0;
function rec(p: Partial<NormalizedTx> & { label: LabelId; method?: "user" | "rule"; needsQuestion?: boolean }): ClassifiedTx {
  n++;
  const { label, method, needsQuestion, ...tx } = p;
  const base: NormalizedTx = {
    id: `s${String(n).padStart(4, "0")}`,
    txHash: `h${n}`,
    timestamp: BUY_TS,
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
  return toClassified(base, { label, confidence: needsQuestion ? 0.3 : 1, method: method ?? "user", reason: "test", forceQuestion: needsQuestion });
}

/** 30 NEAR bought for NGN 150,000 at 1,500/$ (cost $100), and an unanswered NEAR Intents receipt of 500 NPRO. */
function fixture() {
  const buy = rec({ label: "acquisition_fiat", amount: "30", timestamp: BUY_TS });
  buy.userFiat = { ngn: "150000" };
  const intents = rec({ label: "unknown", method: "rule", needsQuestion: true, asset: NPRO, kind: "ft_transfer", amount: "500", counterparty: INTENTS_ACCOUNT, timestamp: RECEIPT_TS });
  return { buy, intents, records: [buy, intents] };
}

const PRICES = { [`native|${LEG_TS}`]: "2", [`npro.nearmobile.near|${RECEIPT_TS}`]: "0.12" };
const answer = (sourceLegs?: Answers["groups"][string]["sourceLegs"]): Answers => ({
  groups: { [`intents:in:${INTENTS_ACCOUNT}`]: { option: "intents_swap", ...(sourceLegs ? { sourceLegs } : {}) } },
});

function answered(records: ClassifiedTx[], a: Answers) {
  const questions = groupQuestions(records);
  return { questions, ...applyAnswers(records, questions, a) };
}

test("source leg clears incompleteSourceLeg; invalid or missing legs keep it", () => {
  const { intents, records } = fixture();
  const leg = { asset: { symbol: "NEAR", contract: null }, quantity: "25", timestamp: LEG_TS };
  const ok = answered(records, answer({ [intents.id]: leg })).records.find((r) => r.id === intents.id)!;
  assert.equal(ok.label, "acquisition_swap");
  assert.ok(!ok.incompleteSourceLeg, "cleared");
  assert.deepEqual(ok.userSourceLeg, leg);
  assert.match(ok.reason, /source leg provided by user/);

  const none = answered(records, answer()).records.find((r) => r.id === intents.id)!;
  assert.equal(none.incompleteSourceLeg, true);
  assert.equal(none.userSourceLeg, undefined);

  const bad = answered(records, answer({ [intents.id]: { ...leg, quantity: "0" } }));
  assert.equal(bad.records.find((r) => r.id === intents.id)!.incompleteSourceLeg, true);
  assert.match(bad.summary.invalid[0], /quantity must be a positive decimal/);
});

test("source leg timestamp defaults to the receipt time and may not be after it", () => {
  const d = normalizeSourceLeg({ asset: { symbol: "NEAR", contract: null }, quantity: "25" }, RECEIPT_TS);
  assert.ok(d.ok && d.leg.timestamp === RECEIPT_TS);
  const later = normalizeSourceLeg({ asset: { symbol: "NEAR", contract: null }, quantity: "25", timestamp: "2026-10-13T09:00:00.000Z" }, RECEIPT_TS);
  assert.ok(!later.ok);
  const local = normalizeSourceLeg({ asset: { symbol: "NEAR", contract: null }, quantity: "25", timestamp: "2026-10-13T08:00:00+01:00" }, RECEIPT_TS);
  assert.ok(local.ok && local.leg.timestamp === LEG_TS, "offsets normalised to UTC");
  assert.ok(!normalizeSourceLeg({ asset: { symbol: "X", contract: "Not Valid" }, quantity: "1" }, RECEIPT_TS).ok);
});

test("paired disposal uses FMV of the asset given up; acquisition cost equals that FMV (9.3.2, D1)", async () => {
  const { intents, records } = fixture();
  const flow = answered(records, answer({ [intents.id]: { asset: { symbol: "NEAR", contract: null }, quantity: "25", timestamp: LEG_TS } }));
  const r = await runEngine({ year: 2026, openingBalances: [], records: flow.records, prices: new FakePrices(PRICES), fx });

  const disp = r.lines.find((l) => l.recordId === intents.id && l.kind === "disposal")!;
  assert.equal(disp.label, "disposal_swap");
  assert.equal(disp.method, "user");
  assert.equal(disp.circularRef, "9.1.2; 9.3.2; Illustration 3");
  assert.equal(disp.asset, "NEAR");
  assert.equal(disp.timestamp, LEG_TS);
  assert.equal(disp.qty, "25");
  assert.equal(disp.proceedsUsd, "50", "25 NEAR x $2");
  assert.equal(money2(dec(disp.costUsd!)), "83.33", "FIFO: 25/30 of the $100 lot");
  assert.equal(money2(dec(disp.gainNgn!)), "-50000.00", "(50 - 83.33) x 1,500");
  assert.equal(disp.fmvReceivedUsd, "60", "FMV received stored too (D1)");
  assert.ok(disp.notes.includes(USER_SOURCE_LEG_NOTE));

  const acq = r.lines.find((l) => l.recordId === intents.id && l.kind === "acquisition")!;
  assert.equal(acq.costUsd, "50", "cost = FMV given up, not the $60 received");
  assert.ok(acq.notes.includes(USER_SOURCE_LEG_NOTE));
  assert.equal(r.closingLots.find((l) => l.assetKey === "npro.nearmobile.near")!.costUsd, "50");
  assert.equal(r.closingLots.find((l) => l.assetKey === "NEAR")!.qty, "5");
  assert.ok(!r.warnings.some((w) => w.code === "incomplete_source_leg"));

  const status = reportStatus({ records: flow.records, warnings: r.warnings, questions: flow.questions });
  assert.equal(status.status, "final", JSON.stringify(status.draftReasons));
});

test("no source leg: unchanged draft behaviour (cost = FMV received, incomplete_source_leg)", async () => {
  const { intents, records } = fixture();
  const flow = answered(records, answer());
  const r = await runEngine({ year: 2026, openingBalances: [], records: flow.records, prices: new FakePrices(PRICES), fx });
  assert.ok(!r.lines.some((l) => l.recordId === intents.id && l.kind === "disposal"));
  assert.equal(r.lines.find((l) => l.recordId === intents.id && l.kind === "acquisition")!.costUsd, "60");
  assert.equal(r.closingLots.find((l) => l.assetKey === "NEAR")!.qty, "30");
  const status = reportStatus({ records: flow.records, warnings: r.warnings, questions: flow.questions });
  assert.equal(status.status, "draft");
  assert.deepEqual(status.draftReasons.map((d) => d.code), ["incomplete_source_leg"]);
});

test("unpriceable given-up asset: no_verifiable_price warning, disposal excluded, cost falls back to FMV received", async () => {
  const { intents, records } = fixture();
  const tknBuy = rec({ label: "acquisition_fiat", asset: TKN, kind: "ft_transfer", amount: "100", timestamp: BUY_TS });
  tknBuy.userFiat = { ngn: "15000" };
  const flow = answered([...records, tknBuy], answer({ [intents.id]: { asset: { symbol: "TKN", contract: "tkn.test.near" }, quantity: "40", timestamp: LEG_TS } }));
  const r = await runEngine({ year: 2026, openingBalances: [], records: flow.records, prices: new FakePrices(PRICES), fx });
  const disp = r.lines.find((l) => l.recordId === intents.id && l.kind === "disposal")!;
  assert.equal(disp.priceStatus, "no_verifiable_price");
  assert.equal(disp.includedInTotals, false);
  assert.ok(r.warnings.some((w) => w.code === "no_verifiable_price" && w.recordId === intents.id));
  assert.equal(r.lines.find((l) => l.recordId === intents.id && l.kind === "acquisition")!.costUsd, "60");
  assert.ok(r.warnings.some((w) => w.code === "swap_cost_fallback"));
  assert.equal(r.closingLots.find((l) => l.assetKey === "tkn.test.near")!.qty, "60", "the given-up quantity still leaves the lots");
});

test("given-up asset without lots: missing_acquisition_history keeps the report draft", async () => {
  const { intents } = fixture();
  const flow = answered([intents], answer({ [intents.id]: { asset: { symbol: "NEAR", contract: null }, quantity: "25", timestamp: LEG_TS } }));
  const r = await runEngine({ year: 2026, openingBalances: [], records: flow.records, prices: new FakePrices(PRICES), fx });
  assert.ok(r.warnings.some((w) => w.code === "missing_acquisition_history"));
  const status = reportStatus({ records: flow.records, warnings: r.warnings, questions: flow.questions });
  assert.deepEqual(status.draftReasons.map((d) => d.code), ["missing_acquisition_history"]);
});

test("adding a source leg changes no other line's computed amounts", async () => {
  const { intents, buy, records } = fixture();
  const later = rec({ label: "disposal_payment", direction: "out", amount: "2", timestamp: "2026-10-20T10:00:00.000Z" });
  const p = new FakePrices({ ...PRICES, [`native|2026-10-20T10:00:00.000Z`]: "3" });
  const fx2 = NafemTable.parse(["# Source: test", "# Retrieved: test", "date,closing_rate", "2026-02-02,1500", "2026-10-13,1500", "2026-10-20,1500"].join("\n"));
  const without = await runEngine({ year: 2026, openingBalances: [], records: answered([...records, later], answer()).records, prices: p, fx: fx2 });
  const withLeg = await runEngine({
    year: 2026,
    openingBalances: [],
    records: answered([...records, later], answer({ [intents.id]: { asset: { symbol: "NEAR", contract: null }, quantity: "25", timestamp: LEG_TS } })).records,
    prices: p,
    fx: fx2,
  });
  const pick = (res: typeof without, id: string) => res.lines.find((l) => l.recordId === id)!;
  assert.deepEqual(pick(withLeg, buy.id), pick(without, buy.id));
  // The later payment still has FIFO cost from the same $100 lot at $3.33/NEAR (5 NEAR remain after the leg).
  assert.equal(pick(withLeg, later.id).proceedsUsd, pick(without, later.id).proceedsUsd);
  // Same per-unit cost; only the 100th significant digit can differ (the lot was partly consumed first).
  const [a, b] = [dec(pick(withLeg, later.id).costUsd!), dec(pick(without, later.id).costUsd!)];
  assert.equal(money2(a), money2(b));
  assert.ok(a.minus(b).abs().lt("1e-90"));
});
