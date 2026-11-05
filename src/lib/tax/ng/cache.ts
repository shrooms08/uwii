import path from "node:path";
import { cachePath, fixturePath, getHistory } from "../../history/cache";
import { CACHE_DIR, readJsonIfExists, writeJson } from "../../history/paths";
import { classifyHistory, type ClassifyOptions } from "./classify";
import { CLASSIFIED_SCHEMA_VERSION, type ClassifiedRun } from "./types";

/** data/cache/classified-<account>-<from>-<to>.json (inputs validated by the history cachePath). */
export function classifiedCachePath(accountId: string, from: string, to: string): string {
  return path.join(CACHE_DIR, `classified-${path.basename(cachePath(accountId, from, to))}`);
}

/** data/fixtures/<account>-<YYYY>.classified.json, next to the history fixture. */
export function classifiedFixturePath(accountId: string, from: string, to: string): string | null {
  const fx = fixturePath(accountId, from, to);
  return fx ? fx.replace(/\.json$/, ".classified.json") : null;
}

export interface GetClassificationOptions extends ClassifyOptions {
  /** Re-run classification (rules + live AI) and rewrite the cache. */
  refresh?: boolean;
  /** Never use fixtures (history or classified). */
  live?: boolean;
}

export type ClassificationOrigin = "cache" | "fixture" | "live";

const normOwn = (own: string[] | undefined) => [...new Set((own ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean))].sort();
const sameOwn = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

async function readRun(file: string, own: string[]): Promise<ClassifiedRun | null> {
  const r = await readJsonIfExists<ClassifiedRun>(file);
  return r && r.schemaVersion === CLASSIFIED_SCHEMA_VERSION && sameOwn(r.ownAccounts, own) ? r : null;
}

/**
 * Cache (same ownAccounts) -> committed classified fixture (unless live) -> classify now.
 * Classifying now uses getHistory (cache -> history fixture -> live fetch) and live AI.
 */
export async function getClassification(
  accountId: string,
  from: string,
  to: string,
  options: GetClassificationOptions = {},
): Promise<{ run: ClassifiedRun; origin: ClassificationOrigin; file: string }> {
  const own = normOwn(options.ownAccounts);
  const file = classifiedCachePath(accountId, from, to);
  if (!options.refresh) {
    const cached = await readRun(file, own);
    if (cached) return { run: cached, origin: "cache", file };
    const fx = options.live ? null : classifiedFixturePath(accountId, from, to);
    if (fx) {
      const fixture = await readRun(fx, own);
      if (fixture) return { run: fixture, origin: "fixture", file: fx };
    }
  }
  const { result: history } = await getHistory(accountId, from, to, { live: options.live, onProgress: options.onProgress });
  const run = await classifyHistory(history, { ...options, ownAccounts: own });
  await writeJson(file, run);
  return { run, origin: "live", file };
}

export async function writeClassifiedFixture(run: ClassifiedRun): Promise<string> {
  const fx = classifiedFixturePath(run.accountId, run.from, run.to);
  if (!fx) throw new Error(`Fixtures must cover a full calendar year, got ${run.from}..${run.to}`);
  await writeJson(fx, run);
  return fx;
}
