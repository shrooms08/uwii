/**
 * The browser computes the report (src/lib/client/local-report.ts) with the same pure code the server uses
 * to recompute it before anchoring. These tests run that client path - static JSON inputs, no file or
 * network access - and require it to equal the server report exactly.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { NafemTable } from "../fx/nafem-table";
import { loadNafemTable } from "../fx/nafem";
import type { Asset, HistoryResult, NormalizedTx } from "../history/types";
import { DEMO_ACCOUNT, ILLUSTRATIVE_ANSWERS } from "../demo/illustrative-answers";
import { money2, dec } from "../money";
import type { PriceProvider, PriceResult } from "../prices/quotes";
import { slimRun } from "../server/run-signing";
import { toClassified } from "../tax/ng/classify-core";
import { computeReport, type ReportData } from "../tax/ng/compute";
import { runEngine } from "../tax/ng/engine";
import { runQuestionFlow } from "../tax/ng/questions";
import { openingInputsFromHistory } from "../tax/ng/opening";
import { buildReport } from "../tax/ng/report";
import type { ClassifiedRun, ClassifiedTx } from "../tax/ng/types";
import { inputsFromBundle, inputsFromSignedRun, type DemoBundle, type UserInputs } from "./local";
import { buildDemoBundle, buildFxJson } from "./static-data";

/** The demo report with the illustrative answers at commit 50eb461 (computed by the server then). */
const DEMO_FINGERPRINT = "41777b4d0d29ebecd00bf07d3c72f62eee6b417f79f9b91c632978ff37710eea";

/** Any price the static inputs do not hold would need the network: fail loudly instead. */
const noNetwork: PriceProvider = {
  quote: async (a, ts) => {
    throw new Error(`network price needed for ${a.symbol} at ${ts}`);
  },
};

const CASES: Record<string, Omit<UserInputs, "account">> = {
  plain: { answers: { groups: ILLUSTRATIVE_ANSWERS.groups }, profile: { otherIncomeNgn: ILLUSTRATIVE_ANSWERS.otherIncomeNgn } },
  withRent: { answers: { groups: ILLUSTRATIVE_ANSWERS.groups }, profile: { otherIncomeNgn: ILLUSTRATIVE_ANSWERS.otherIncomeNgn, reliefs: { rentPaidNgn: "1234567.89" } } },
  unanswered: {},
};

const strip = (r: ReportData) => {
  const { generatedAt, ...rest } = r;
  void generatedAt;
  return rest;
};

/** The static files exactly as the browser receives them (JSON round trip). */
async function staticInputs(): Promise<{ bundle: DemoBundle; fx: NafemTable }> {
  const bundle = JSON.parse(JSON.stringify(await buildDemoBundle(DEMO_ACCOUNT))) as DemoBundle;
  const fx = NafemTable.fromJSON(JSON.parse(JSON.stringify(await buildFxJson())));
  return { bundle, fx };
}

test("parity: the cached demo computed in the browser equals the server report exactly (every line, total and fingerprint)", async () => {
  const { bundle, fx } = await staticInputs();
  for (const [name, user] of Object.entries(CASES)) {
    const client = (await computeReport(inputsFromBundle(bundle, { account: DEMO_ACCOUNT, ...user }, fx, noNetwork))).report;
    const server = (await buildReport({ account: DEMO_ACCOUNT, classificationSource: "fixture", ...user })).report;
    assert.deepEqual(strip(client), strip(server), name);
  }
  const plain = (await computeReport(inputsFromBundle(bundle, { account: DEMO_ACCOUNT, ...CASES.plain }, fx, noNetwork))).report;
  assert.equal(plain.fingerprint, DEMO_FINGERPRINT);
  assert.equal(plain.status, "final");
  assert.equal(money2(dec(plain.tax.taxAttributableToVaNgn)), "41231.99");
});

test("parity: a signed run that carries its prices and opening position gives the same report in the browser and on the server", async () => {
  const { bundle, fx } = await staticInputs();
  const history = JSON.parse(await readFile(path.join(process.cwd(), "data", "fixtures", `${DEMO_ACCOUNT}-2026.json`), "utf8")) as HistoryResult;
  const run: ClassifiedRun = {
    ...bundle.run,
    context: { archivalRpc: bundle.history.archivalRpc, openingInputs: openingInputsFromHistory(history), opening: bundle.opening, prices: bundle.prices! },
  };
  const user = { account: DEMO_ACCOUNT, ...CASES.plain };
  const client = (await computeReport(inputsFromSignedRun(run, user, fx, noNetwork)!)).report;
  const server = (await buildReport({ ...user, run })).report;
  assert.deepEqual(strip(client), strip(server));
  // Same figures and fingerprint as the cached demo: only where the inputs came from differs.
  assert.equal(client.fingerprint, DEMO_FINGERPRINT);
  // A run saved before runs carried prices cannot be computed in the browser (the page asks for a new scan).
  assert.equal(inputsFromSignedRun({ ...run, context: { ...run.context!, prices: undefined } }, user, fx, noNetwork), null);
});

test("parity: the static NFEM table gives the same rate as the CSV for every day of the year", async () => {
  const csv = await loadNafemTable();
  const json = NafemTable.fromJSON(JSON.parse(JSON.stringify(await buildFxJson())));
  assert.deepEqual(json.meta, csv.meta);
  assert.deepEqual(json.range, csv.range);
  for (let t = Date.parse("2025-12-25T00:00:00Z"); t <= Date.parse("2027-01-05T00:00:00Z"); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    const a = (() => {
      try {
        return csv.quote(d);
      } catch (e) {
        return String(e);
      }
    })();
    const b = (() => {
      try {
        return json.quote(d);
      } catch (e) {
        return String(e);
      }
    })();
    assert.deepEqual(b, a, d);
  }
});

// ---------- the circular's illustrations, through the client path ----------

const BTC: Asset = { symbol: "BTC", contract: "btc.test.near", decimals: 8 };
const ETH: Asset = { symbol: "ETH", contract: "eth.test.near", decimals: 18 };
class FakePrices implements PriceProvider {
  constructor(private readonly table: Record<string, string>) {}
  async quote(asset: Asset, ts: string): Promise<PriceResult> {
    const usd = this.table[`${asset.contract ?? "native"}|${ts}`];
    if (usd === undefined) return { status: "no_verifiable_price", attempted: ["test: no price"] };
    return { status: "ok", quote: { usd, granularity: "hourly", pointTime: ts, source: "test", method: "test" } };
  }
}
const fxRows = (rows: Record<string, string>) =>
  NafemTable.fromJSON(NafemTable.parse(["# Source: test", "# Retrieved: test", "date,closing_rate", ...Object.entries(rows).map(([d, r]) => `${d},${r}`)].join("\n")).toJSON());

let n = 0;
function rec(p: Partial<NormalizedTx> & { label: Parameters<typeof toClassified>[1]["label"]; userFiat?: { ngn: string }; pairingId?: string }): ClassifiedTx {
  n++;
  const { label, userFiat, pairingId, ...tx } = p;
  const base: NormalizedTx = {
    id: `ill${n}`,
    txHash: `ill-h${n}`,
    timestamp: "2026-03-02T10:00:00.000Z",
    direction: "in",
    kind: "ft_transfer",
    asset: BTC,
    amount: "1",
    counterparty: "exchange.test.near",
    method: null,
    success: true,
    source: "test",
    raw: null,
    fee: null,
    ...tx,
  };
  const c = toClassified(base, { label, confidence: 1, method: "user", reason: "illustration", pairingId });
  if (userFiat) c.userFiat = userFiat;
  return c;
}

async function viaClient(records: ClassifiedTx[], prices: PriceProvider, fx: NafemTable) {
  const { bundle } = await staticInputs();
  const run: ClassifiedRun = { ...slimRun(bundle.run), accountId: "illustration.test.near", records };
  const inputs = inputsFromBundle({ ...bundle, run, prices: null, opening: { ...bundle.opening, accountId: run.accountId, balances: [] } }, { account: run.accountId }, fx, prices);
  const { report, flow } = await computeReport(inputs);
  // The previous server path: the question flow's records straight into the engine.
  const direct = await runEngine({ year: 2026, records: runQuestionFlow(run, { ownAccounts: [], answers: { groups: {} } }).records, prices, fx, openingBalances: [] });
  assert.deepEqual(flow.records, runQuestionFlow(run, { ownAccounts: [], answers: { groups: {} } }).records);
  assert.deepEqual(report.lines, direct.lines, "same lines as the engine alone");
  assert.deepEqual(report.totals, direct.totals, "same totals as the engine alone");
  return report;
}

test("parity: Circular Illustration 2 through the browser path: gain NGN 470,000", async () => {
  const buy = rec({ label: "acquisition_fiat", amount: "1", timestamp: "2026-02-02T10:00:00.000Z", userFiat: { ngn: "1000000" } });
  const sell = rec({ label: "disposal_sale_fiat", amount: "1", direction: "out", timestamp: "2026-06-01T10:00:00.000Z", userFiat: { ngn: "1970000" } });
  const r = await viaClient([buy, sell], new FakePrices({}), fxRows({ "2026-02-02": "1000", "2026-06-01": "1500" }));
  assert.equal(money2(dec(r.lines.find((l) => l.recordId === sell.id)!.gainNgn!)), "470000.00");
  assert.equal(money2(dec(r.totals.netGainsNgn)), "470000.00");
});

test("parity: Circular Illustration 3 through the browser path: swap gain $1,000 = NGN 1,600,000", async () => {
  const ts = "2026-04-01T12:00:00.000Z";
  const buy = rec({ label: "acquisition_fiat", asset: ETH, amount: "2", timestamp: "2026-02-02T10:00:00.000Z", userFiat: { ngn: "4800000" } });
  const give = rec({ label: "disposal_swap", asset: ETH, amount: "2", direction: "out", timestamp: ts, txHash: "swap", pairingId: "swap:swap" });
  const get = rec({ label: "acquisition_swap", asset: BTC, amount: "0.1", timestamp: ts, txHash: "swap", pairingId: "swap:swap" });
  const r = await viaClient([buy, give, get], new FakePrices({ [`eth.test.near|${ts}`]: "2000", [`btc.test.near|${ts}`]: "40000" }), fxRows({ "2026-02-02": "1600", "2026-04-01": "1600" }));
  const d = r.lines.find((l) => l.recordId === give.id)!;
  assert.equal(d.costUsd, "3000");
  assert.equal(d.proceedsUsd, "4000");
  assert.equal(d.gainNgn, "1600000");
});

// ---------- nothing Node-only reaches the browser bundle ----------

const NODE_ONLY = [/^node:/, /^(fs|path|os|crypto)$/, /history\/(paths|cache|fetch|chain|nearblocks|staking-rewards)$/, /prices\/(provider|coingecko|refpool)$/, /tax\/ng\/(classify|opening|report|cache)$/, /server\//, /fx\/nafem$/];

test("the browser report path imports no Node-only module", async () => {
  const root = path.join(process.cwd(), "src");
  const seen = new Set<string>();
  const bad: string[] = [];
  async function walk(file: string, from: string) {
    if (seen.has(file)) return;
    seen.add(file);
    const text = await readFile(file, "utf8");
    for (const m of text.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"([^"]+)"/gm)) {
      const spec = m[1];
      if (/^import\s+type\s/m.test(m[0]) || /^export\s+type\s/m.test(m[0])) continue; // erased at build time
      if (NODE_ONLY.some((re) => re.test(spec))) bad.push(`${path.relative(root, file)} -> ${spec} (via ${from})`);
      const target = spec.startsWith("@/") ? path.join(root, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(file), spec) : null;
      if (!target) continue;
      for (const ext of [".ts", ".tsx", "/index.ts"]) {
        try {
          await readFile(target + ext);
          await walk(target + ext, path.relative(root, file));
          break;
        } catch {
          // try the next extension
        }
      }
    }
  }
  for (const entry of ["lib/client/local-report.ts", "lib/client/useReport.ts", "app/questions/QuestionsClient.tsx", "app/result/ResultClient.tsx", "app/export/ExportClient.tsx", "components/report/AnchorCard.tsx", "app/scan/ScanClient.tsx"]) {
    await walk(path.join(root, entry), "entry");
  }
  assert.deepEqual(bad, []);
  assert.ok(seen.has(path.join(root, "lib/tax/ng/engine.ts")), "the walk reached the engine");
});
