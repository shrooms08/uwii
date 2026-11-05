import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReportLine, Warning } from "../tax/ng/engine";
import type { ClassifiedRun } from "../tax/ng/types";
import { fmtQtyShort, lineCategory, lineMethod, lineSign, lineTitle, plainExplanation, swapCounterpart } from "./explain";
import { privacyProofFromRun } from "./privacy";
import { dateRange, plainWarnings } from "./warnings";

const line = (p: Partial<ReportLine>): ReportLine => ({
  date: "2026-10-08",
  timestamp: "2026-10-08T17:54:51.000Z",
  recordId: "r1",
  txHash: "tx1",
  label: "disposal_swap",
  kind: "disposal",
  asset: "wNEAR",
  assetKey: "NEAR",
  qty: "20",
  usdPrice: "4.4",
  priceGranularity: "hourly",
  priceSource: "CoinGecko",
  priceMethod: "m",
  priceStatus: "ok",
  usdValue: "88",
  nafemRate: "1333.55",
  rateDate: "2026-10-08",
  rateFallback: false,
  ngnValue: "117352.4",
  circularRef: "9.1.2; 9.3.2; Illustration 3",
  method: "rule",
  includedInTotals: true,
  notes: [],
  ...p,
});

test("swap titles pair legs by tx hash (rule swaps) and by record id (user source leg)", () => {
  const give = line({});
  const get = line({ recordId: "r2", label: "acquisition_swap", kind: "acquisition", asset: "RHEA", qty: "1633.6912" });
  const lines = [give, get];
  assert.equal(lineTitle(give, lines), "Swap: 20 wNEAR for 1,633.69 RHEA on 8 Oct 2026");
  assert.equal(lineTitle(get, lines), "Swap: 20 wNEAR for 1,633.69 RHEA on 8 Oct 2026");
  const legGive = line({ recordId: "intents", txHash: "", method: "user", asset: "NEAR", qty: "13", timestamp: "2026-10-13T15:52:22.647Z" });
  const legGet = line({ recordId: "intents", txHash: "", method: "user", label: "acquisition_swap", kind: "acquisition", asset: "NPRO", qty: "501.6416917", timestamp: "2026-10-13T15:52:22.647Z" });
  assert.equal(swapCounterpart(legGive, [legGive, legGet, give, get]), legGet);
  assert.equal(lineTitle(legGet, [legGive, legGet]), "Swap: 13 NEAR for 501.64 NPRO on 13 Oct 2026");
  assert.equal(lineTitle(line({ label: "acquisition_swap", kind: "acquisition", txHash: "lonely", asset: "NPRO", qty: "5" }), []), "Swap: received 5 NPRO on 8 Oct 2026");
});

test("line categories, methods, signs and short quantities come from the line", () => {
  assert.equal(lineCategory(line({ kind: "gas_fee", label: "gas_fee" })), "Gas");
  assert.equal(lineCategory(line({ kind: "acquisition", label: "acquisition_fiat" })), "Purchase");
  assert.equal(lineCategory(line({ kind: "excluded", label: "unknown" })), "Unresolved");
  assert.equal(lineMethod(line({ kind: "excluded", method: "ai" })), "needs");
  assert.equal(lineMethod(line({ method: "ai" })), "ai");
  assert.equal(lineMethod(line({ method: "opening", kind: "opening" })), "rule");
  assert.equal(lineSign(line({ kind: "gas_fee" })), "−");
  assert.equal(lineSign(line({ kind: "income" })), "+");
  assert.equal(fmtQtyShort("0.0002325606311083"), "0.0002326");
  assert.equal(fmtQtyShort("35.4"), "35.40");
  assert.equal(fmtQtyShort("1633.6912"), "1,633.69");
  assert.match(plainExplanation(line({ kind: "excluded", label: "disposal_payment" })), /left out of the totals/);
});

test("warnings: grouped plain sentences filled with real values; technical text stays out", () => {
  const moon = (id: string, ts: string) =>
    line({ recordId: id, kind: "income", label: "income_defi_yield", asset: "MOON", qty: "0.002", timestamp: ts, date: ts.slice(0, 10), priceStatus: "no_verifiable_price", priceMethod: "CoinGecko: no listing | Rhea/Ref v2: no pool", usdValue: null, includedInTotals: false });
  const lines = [
    moon("m1", "2026-10-04T01:00:00.000Z"),
    moon("m2", "2026-10-05T01:00:00.000Z"),
    line({ recordId: "g1", kind: "gas_fee", label: "gas_fee", asset: "NEAR", qty: "0.0001", notes: ["missing acquisition history for 0.0001 NEAR: nil cost used"] }),
    line({ recordId: "s1", rateFallback: true, date: "2026-10-04", rateDate: "2026-10-02" }),
  ];
  const warnings: Warning[] = [
    { code: "no_verifiable_price", message: "MOON 0.002 on 2026-10-04: no verifiable price (9.2(4)); excluded…", recordId: "m1" },
    { code: "no_verifiable_price", message: "MOON 0.002 on 2026-10-05: …", recordId: "m2" },
    { code: "missing_acquisition_history", message: "NEAR: disposed 0.0001 … nil cost used for 0.0001", recordId: "g1" },
    { code: "rate_fallback", message: "1 line(s) used the most recent prior published NFEM rate" },
  ];
  const out = plainWarnings({ warnings, lines, tax: { basis: "standalone", otherIncomeNgn: null }, totals: { gasFeesNgn: "127.977" }, carryForwardLossNgn: "0" });
  const text = out.map((w) => w.text);
  assert.ok(text.includes("1 NEAR disposal (8 Oct 2026) used more NEAR than Uwii saw you acquire. The missing 0.0001 NEAR was given a nil cost, which overstates the gain. Answer the open questions or add your other wallets."), text.join("\n"));
  assert.ok(text.includes("2 MOON DeFi rewards (4–5 Oct 2026) have no verifiable price, so they are left out of the totals (Circular 9.2(4)). Checked: CoinGecko, Rhea/Ref v2."), text.join("\n"));
  assert.ok(text.some((t) => t.includes("1 line use the most recent earlier rate (decision D8): 4 Oct used 2 Oct 2026.")), text.join("\n"));
  assert.ok(text.some((t) => t.startsWith("Gas fees of ₦127.98 across 1 transaction")));
  assert.ok(text.some((t) => t.startsWith("Tax is worked out as if crypto were your only income")));
  assert.ok(!text.some((t) => /disposed|excluded…|9\.2\(4\)\); excluded/.test(t)), "engine messages are not repeated");
  assert.deepEqual(out.find((w) => w.code === "no_verifiable_price")!.recordIds, ["m1", "m2"]);
});

test("dateRange formats one day, a range in a month, and across months", () => {
  assert.equal(dateRange(["2026-10-04T01:00:00Z"]), "4 Oct 2026");
  assert.equal(dateRange(["2026-10-05", "2026-10-04"]), "4–5 Oct 2026");
  assert.equal(dateRange(["2026-10-08", "2026-11-04"]), "8 Oct – 4 Nov 2026");
});

test("privacy proof lists only recorded checks, grouped by gateway / model / signature", () => {
  const run = {
    model: "z-ai/glm-5.3-flash",
    attestation: {
      verified: true,
      details: "ok",
      nonce: "n1",
      checksPassed: 3,
      checksTotal: 3,
      attestedAt: "2026-11-05T21:18:22.154Z",
      reportSigners: [{ label: "gateway", address: "0xg", verified: true }],
      checks: [
        { step: "fetch attestation report", ok: true, detail: "fresh nonce n1" },
        { step: "gateway: TDX debug mode", ok: true, detail: "disabled" },
        { step: "model #1: RTMR3 event-log replay", ok: true, detail: "matches quote RTMR3" },
      ],
    },
    aiResponses: [{ batch: 1, attempt: 1, chatId: "c1", txCount: 1, valid: true, signatureVerified: true, detail: "ok", signingAddress: "0xS", signatureChecks: [{ step: "ECDSA (EIP-191) signature valid", ok: true, detail: "recovered signer 0xS" }] }],
    records: [{ id: "a1", method: "ai", evidence: { chatId: "c1", signatureVerified: true, model: "m", attempt: 1 } }],
  } as unknown as ClassifiedRun;
  const p = privacyProofFromRun(run);
  assert.equal(p.checksRecorded, true);
  assert.deepEqual(
    p.checks.map((c) => [c.group, c.subject, c.step]),
    [
      ["report", "attestation report", "fetch attestation report"],
      ["gateway", "gateway", "TDX debug mode"],
      ["model", "model #1", "RTMR3 event-log replay"],
      ["signature", "c1", "ECDSA (EIP-191) signature valid"],
    ],
  );
  assert.deepEqual(p.aiEvidence, [{ recordId: "a1", chatId: "c1", signatureVerified: true, detail: null }]);
  assert.deepEqual(p.missing, []);
  const old = privacyProofFromRun({ ...run, attestation: { ...run.attestation, checks: undefined } } as unknown as ClassifiedRun);
  assert.equal(old.checksRecorded, false);
  assert.match(old.missing.join(";"), /individual check results not recorded/);
});
