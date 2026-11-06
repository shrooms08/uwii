import assert from "node:assert/strict";
import { test } from "node:test";
import { ILLUSTRATIVE_ANSWERS } from "../demo/illustrative-answers";
import { buildReport } from "../tax/ng/report";
import type { Answers } from "../tax/ng/questions";
import { LINE_COLUMNS, linesCsv, summaryCsv } from "./csv";
import { SECTION_ORDER, lineSections, reconcileSections, rowLines, splitRef } from "./sections";

/** A different answer set: income from a client, a gift given, an airdrop via Intents, a transfer to an own wallet. */
const OTHER_ANSWERS: Answers = {
  groups: {
    "in:52435fe912307fb3a088b8b8f3882781762fc1f0a404e8579c7fb1a964362c8d": { option: "client" },
    "out:5b69665c56276592f91df4c25d5e086ddedae02f891547db61e73c5751f19697": { option: "gift_given" },
    "intents:in:intents.near": { option: "airdrop" },
    "out:premium.nearmobile.near": { option: "own_wallet" },
  },
};

const cases: [string, { answers?: Answers; profile?: { otherIncomeNgn: string } }][] = [
  ["preset answers", { answers: { groups: ILLUSTRATIVE_ANSWERS.groups }, profile: { otherIncomeNgn: ILLUSTRATIVE_ANSWERS.otherIncomeNgn } }],
  ["a different answer set", { answers: OTHER_ANSWERS }],
  ["no answers (draft)", {}],
];

for (const [name, req] of cases) {
  test(`section subtotals reconcile exactly with the report totals: ${name}`, async () => {
    const { report } = await buildReport({ account: "rybergh44.near", classificationSource: "fixture", ...req });
    const sections = lineSections(report);
    assert.deepEqual(
      sections.map((s) => s.id),
      SECTION_ORDER,
    );
    assert.deepEqual(reconcileSections(sections, report.totals), { income: true, netGains: true, gas: true });
    // Every report line appears exactly once.
    const all = sections.flatMap((s) => s.rows.flatMap(rowLines));
    assert.equal(all.length, report.lines.length);
    assert.equal(new Set(all).size, report.lines.length);
    // Swaps are single rows with both legs; nothing taxable hides in "not taxable".
    for (const r of sections.find((s) => s.id === "disposals")!.rows) if (r.type === "swap") assert.ok(r.gives.length >= 1 && r.gets.length >= 1);
    for (const l of sections.find((s) => s.id === "not_taxable")!.rows.flatMap(rowLines)) assert.ok(!["income", "disposal", "gas_fee"].includes(l.kind), l.label);
    for (const r of sections.find((s) => s.id === "excluded")!.rows) assert.ok(r.reason, "excluded rows carry a reason");
  });
}

test("the different answer set puts the client payments in income and the own-wallet transfer in not taxable", async () => {
  const { report } = await buildReport({ account: "rybergh44.near", classificationSource: "fixture", answers: OTHER_ANSWERS });
  const s = lineSections(report);
  const income = s.find((x) => x.id === "income")!.rows.flatMap(rowLines);
  assert.ok(income.some((l) => l.label === "income_professional_fees"));
  const notTaxable = s.find((x) => x.id === "not_taxable")!.rows.flatMap(rowLines);
  assert.ok(notTaxable.some((l) => l.label === "own_wallet_transfer"));
  assert.ok(notTaxable.some((l) => l.label === "gift_given"));
});

test("CSV: lines gain section and pairingId columns (existing columns kept); summary adds per-section subtotals", async () => {
  const { report } = await buildReport({ account: "rybergh44.near", classificationSource: "fixture", answers: { groups: ILLUSTRATIVE_ANSWERS.groups } });
  assert.deepEqual(LINE_COLUMNS.slice(-2), ["section", "pairingId"]);
  assert.ok(["date", "label", "circularRef", "ngnValue", "txHash"].every((c) => (LINE_COLUMNS as readonly string[]).includes(c)));
  const csv = linesCsv(report);
  const swapRows = csv.split("\r\n").filter((r) => r.includes(",disposals,swap:"));
  assert.equal(swapRows.length, 6, "3 swaps x 2 legs share a pairingId");
  const summary = summaryCsv(report);
  for (const k of ["section.income.subtotalNgn", "section.disposals.netGainNgn", "section.gas.subtotalNgn", "section.gas.netGainNgn", "section.not_taxable.lines", "section.excluded.lines"]) {
    assert.ok(summary.includes(`${k},`), k);
  }
});

test("splitRef keeps the short circular ref and moves the decision note to a chip", () => {
  assert.deepEqual(splitRef("7.1 event 5 (D2: gas fee is a NEAR disposal; not deductible)"), { ref: "7.1 event 5", decision: "D2", note: "gas fee is a NEAR disposal; not deductible" });
  assert.deepEqual(splitRef("D11 (pre-2026 cost-base reset)"), { ref: "D11", decision: "D11", note: "pre-2026 cost-base reset" });
  assert.deepEqual(splitRef("9.1.2; 9.3.2; Illustration 3"), { ref: "9.1.2; 9.3.2; Illustration 3", decision: null, note: null });
  assert.deepEqual(splitRef("7.2.6 (by analogy for uncollateralised loans)"), { ref: "7.2.6", decision: null, note: "by analogy for uncollateralised loans" });
});
