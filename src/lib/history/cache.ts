import path from "node:path";
import { fetchHistory, isValidAccountId, type FetchHistoryOptions } from "./fetch";
import { CACHE_DIR, FIXTURE_DIR, readJsonIfExists, writeJson } from "./paths";
import { HISTORY_SCHEMA_VERSION, type HistoryResult } from "./types";

export { CACHE_DIR, FIXTURE_DIR };

const SAFE_BOUND = /^[0-9TZ:.+-]+$/;

function checkKey(accountId: string, from: string, to: string) {
  if (!isValidAccountId(accountId)) throw new Error(`Invalid NEAR account id: "${accountId}"`);
  if (!SAFE_BOUND.test(from) || !SAFE_BOUND.test(to)) throw new Error(`Invalid date bound: ${from} / ${to}`);
}

export function cachePath(accountId: string, from: string, to: string): string {
  checkKey(accountId, from, to);
  const clean = (s: string) => s.replace(/:/g, "");
  return path.join(CACHE_DIR, `${accountId}-${clean(from)}-${clean(to)}.json`);
}

/** Fixtures cover one calendar year: data/fixtures/<account>-<YYYY>.json for YYYY-01-01..YYYY-12-31. */
export function fixturePath(accountId: string, from: string, to: string): string | null {
  checkKey(accountId, from, to);
  const m = /^(\d{4})-01-01$/.exec(from);
  if (!m || to !== `${m[1]}-12-31`) return null;
  return path.join(FIXTURE_DIR, `${accountId}-${m[1]}.json`);
}

export interface GetHistoryOptions extends FetchHistoryOptions {
  /** Ignore cache and fixture; fetch live and rewrite the cache. */
  refresh?: boolean;
  /** Never use the fixture (cache is still used unless refresh). */
  live?: boolean;
  /** Runs just before a live fetch (not for cache or fixture hits): the hosted scan's size check. */
  beforeLive?: () => Promise<void>;
}

export type HistoryOrigin = "cache" | "fixture" | "live";

export interface CachedHistory {
  result: HistoryResult;
  origin: HistoryOrigin;
  /** File the result was read from or written to. */
  file: string;
}

async function readResult(file: string): Promise<HistoryResult | null> {
  const r = await readJsonIfExists<HistoryResult>(file);
  return r && r.schemaVersion === HISTORY_SCHEMA_VERSION ? r : null;
}

/**
 * Cache first, then the committed demo fixture (unless `live`), then a live fetch that writes the cache.
 * `refresh` skips straight to the live fetch.
 */
export async function getHistory(
  accountId: string,
  from: string,
  to: string,
  options: GetHistoryOptions = {},
): Promise<CachedHistory> {
  const file = cachePath(accountId, from, to);
  if (!options.refresh) {
    const cached = await readResult(file);
    if (cached) return { result: cached, origin: "cache", file };
    const fx = options.live ? null : fixturePath(accountId, from, to);
    if (fx) {
      const fixture = await readResult(fx);
      if (fixture) return { result: fixture, origin: "fixture", file: fx };
    }
  }
  await options.beforeLive?.();
  const result = await fetchHistory(accountId, from, to, options);
  // A result with skipped staking snapshots must not be reused: the next scan should try again.
  if (!result.staking.incomplete) await writeJson(file, result);
  return { result, origin: "live", file };
}

/** Write a result as the committed demo fixture for its calendar year. */
export async function writeFixture(result: HistoryResult): Promise<string> {
  const fx = fixturePath(result.accountId, result.from, result.to);
  if (!fx) throw new Error(`Fixtures must cover a full calendar year (YYYY-01-01..YYYY-12-31), got ${result.from}..${result.to}`);
  await writeJson(fx, result);
  return fx;
}
