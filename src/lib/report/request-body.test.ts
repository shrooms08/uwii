/**
 * The browser computes from requestBody() (src/lib/client/request.ts) without zod; the anchor route parses
 * the same body with ReportBody before recomputing. The schema must leave the browser's body unchanged, or
 * the two would compute different reports (and the anchor would be refused for a fingerprint mismatch).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ReportBody } from "../api/report-schema";
import { requestBody } from "../client/request";
import type { Saved } from "../client/storage";
import { DEMO_ACCOUNT, ILLUSTRATIVE_ANSWERS } from "../demo/illustrative-answers";
import { userInputsFromBody } from "./local";

const SAVED: Record<string, Saved> = {
  empty: { ownText: "", groups: {}, otherIncomeNgn: "" },
  demo: { ownText: "", groups: structuredClone(ILLUSTRATIVE_ANSWERS.groups), otherIncomeNgn: ILLUSTRATIVE_ANSWERS.otherIncomeNgn },
  canary: {
    ownText: "  Other.NEAR, second-acct.near\nrybergh44.near ",
    groups: {
      ...structuredClone(ILLUSTRATIVE_ANSWERS.groups),
      "out:5b69665c56276592f91df4c25d5e086ddedae02f891547db61e73c5751f19697": { option: "p2p_sell", ngn: { "nearblocks:receipt:DBnAjMic2r7Hb3vioL15YreAtCFqWqptpeGwCVYnDf6L": " 1,160,000.50 " } },
      "intents:in:intents.near": {
        option: "intents_swap",
        sourceLegs: {
          a: { asset: { symbol: "USDC", contract: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1" }, quantity: "1,250.5", timestamp: "2026-10-13T15:52:22.647Z" },
          incomplete: { asset: { symbol: "", contract: null }, quantity: "" },
        },
      },
    },
    otherIncomeNgn: "4,812,345.67",
    reliefs: { rentPaidNgn: "1,234,567.89", pensionNgn: "", nhfNgn: "12x" },
  },
};

test("the anchor schema leaves the browser's request body unchanged, so both compute from the same inputs", () => {
  for (const [name, saved] of Object.entries(SAVED)) {
    const body = JSON.parse(JSON.stringify(requestBody(DEMO_ACCOUNT, saved)));
    const parsed = ReportBody.safeParse(body);
    assert.ok(parsed.success, `${name}: ${parsed.success ? "" : parsed.error.message}`);
    assert.deepEqual(JSON.parse(JSON.stringify(parsed.data)), body, name);
    assert.deepEqual(userInputsFromBody(parsed.data), userInputsFromBody(body), name);
  }
  const canary = userInputsFromBody(requestBody(DEMO_ACCOUNT, SAVED.canary));
  assert.equal(canary.profile?.otherIncomeNgn, "4812345.67");
  assert.deepEqual(canary.profile?.reliefs, { rentPaidNgn: "1234567.89" }, "an invalid relief is left out, not sent");
  assert.deepEqual(canary.ownAccounts, ["other.near", "second-acct.near"]);
});
