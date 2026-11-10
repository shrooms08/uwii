/**
 * Build-time static data for the browser-side report (written to public/static-data/ by
 * scripts/static-data.ts before `next dev` and `next build`, never committed):
 *  - fx-nafem.json: the CBN NFEM USD/NGN table from data/fx;
 *  - demo/<account>.json: the cached demo inputs from data/fixtures (classified run, prices, opening position
 *    and the history facts the report cites).
 * Node only (reads files); the browser reads the JSON it produces.
 */
import { readdir } from "node:fs/promises";
import { loadNafemTable, type NafemJson } from "../fx/nafem";
import { fixturePath } from "../history/cache";
import { FIXTURE_DIR, readJsonIfExists } from "../history/paths";
import type { HistoryResult } from "../history/types";
import { loadPriceFixture } from "../prices/provider";
import { slimRun, urlOrigin } from "../server/run-signing";
import { getClassification } from "../tax/ng/cache";
import type { OpeningPosition } from "../tax/ng/opening-core";
import { OPENING_YEAR } from "../tax/ng/opening-core";
import { openingFixturePath, priceFixturePath } from "../tax/ng/report";
import type { DemoBundle } from "./local";

const FROM = `${OPENING_YEAR}-01-01`;
const TO = `${OPENING_YEAR}-12-31`;

export async function buildFxJson(): Promise<NafemJson> {
  return (await loadNafemTable()).toJSON();
}

/** Accounts with a committed classified fixture (the cached demo results). */
export async function demoAccounts(): Promise<string[]> {
  const suffix = `-${OPENING_YEAR}.classified.json`;
  return (await readdir(FIXTURE_DIR)).filter((f) => f.endsWith(suffix)).map((f) => f.slice(0, -suffix.length)).sort();
}

export async function buildDemoBundle(account: string): Promise<DemoBundle> {
  const { run } = await getClassification(account, FROM, TO, { ownAccounts: [], fixtureOnly: true });
  const historyFile = fixturePath(account, FROM, TO);
  const history = historyFile ? await readJsonIfExists<HistoryResult>(historyFile) : null;
  if (!history) throw new Error(`No committed history fixture for ${account}`);
  const opening = await readJsonIfExists<OpeningPosition>(openingFixturePath(account));
  if (!opening) throw new Error(`No committed opening position for ${account}`);
  return {
    run: slimRun(run),
    prices: await loadPriceFixture(priceFixturePath(account)),
    opening,
    history: { fetchedAt: history.fetchedAt, archivalRpc: urlOrigin(history.staking.archivalRpc), stakingIncomplete: Boolean(history.staking.incomplete) },
  };
}
