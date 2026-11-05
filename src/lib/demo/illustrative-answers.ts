/**
 * Illustrative answers for the public demo account only: the answers the Phase 4/5 tests used, plus an
 * illustrative NEAR Intents source leg (13 NEAR).
 * They are invented for illustration (the account holder never gave them), so whenever they are
 * loaded the UI shows "Demo account · questions answered for illustration". Never offered for any
 * other account.
 */
import type { GroupAnswer } from "@/lib/tax/ng/questions";

export const DEMO_ACCOUNT = "rybergh44.near";
export const DEMO_LABEL = "Demo account · questions answered for illustration";

export const ILLUSTRATIVE_ANSWERS: { groups: Record<string, GroupAnswer>; otherIncomeNgn: string } = {
  groups: {
    "in:52435fe912307fb3a088b8b8f3882781762fc1f0a404e8579c7fb1a964362c8d": {
      option: "p2p_buy",
      ngn: {
        "nearblocks:receipt:2t4ewSBkJBLbqC73ooiTKh6a9v9SHWDohw2D5u1mZdyf": "180000",
        "nearblocks:receipt:D1Befftuh4i9UFpFwmiKKfkS2wcbnuvFoFqwnmdWeS3": "130000",
        "nearblocks:receipt:DYU1ecyt9s4mmEv4zsgXovsumQYJVUERDhKLQT9NWLSk": "310000",
        "nearblocks:receipt:9QrPW5jVGFeHNkVcQjAEo47gmoZs3pZJ9WjNHJ64xWZY": "325000",
      },
      overrides: { "nearblocks:receipt:GnJTRrXqM4fSu3hb2C9p9yQW3QMSzNuRng7JQ5rSxgnf": "gift_received" },
    },
    "out:5b69665c56276592f91df4c25d5e086ddedae02f891547db61e73c5751f19697": {
      option: "p2p_sell",
      ngn: { "nearblocks:receipt:DBnAjMic2r7Hb3vioL15YreAtCFqWqptpeGwCVYnDf6L": "160000" },
    },
    // "A swap I made on NEAR Intents", with an illustrative source leg: 13 NEAR given up at the receipt time.
    "intents:in:intents.near": {
      option: "intents_swap",
      sourceLegs: {
        "nearblocks:ft:BKPUYJD3CGoN4TPgkEXPMWVum1YgBFiFPooKTXxEAzw1:npro.nearmobile.near:21": {
          asset: { symbol: "NEAR", contract: null },
          quantity: "13",
          timestamp: "2026-10-13T15:52:22.647Z",
        },
      },
    },
    "out:premium.nearmobile.near": { option: "paid_goods" },
  },
  otherIncomeNgn: "4800000",
};
