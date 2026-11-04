import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchHistory, isValidAccountId, type FetchHistoryOptions } from "./fetch";
import type { HistoryResult } from "./types";

export const CACHE_DIR = path.join(process.cwd(), "data", "cache");

const SAFE_BOUND = /^[0-9TZ:.+-]+$/;

export function cachePath(accountId: string, from: string, to: string): string {
  if (!isValidAccountId(accountId)) throw new Error(`Invalid NEAR account id: "${accountId}"`);
  if (!SAFE_BOUND.test(from) || !SAFE_BOUND.test(to)) throw new Error(`Invalid date bound: ${from} / ${to}`);
  const clean = (s: string) => s.replace(/:/g, "");
  return path.join(CACHE_DIR, `${accountId}-${clean(from)}-${clean(to)}.json`);
}

export interface GetHistoryOptions extends FetchHistoryOptions {
  refresh?: boolean;
}

export interface CachedHistory {
  result: HistoryResult;
  cacheFile: string;
  fromCache: boolean;
}

/** Return cached history if present (unless refresh), otherwise fetch and write the cache. */
export async function getHistory(
  accountId: string,
  from: string,
  to: string,
  options: GetHistoryOptions = {},
): Promise<CachedHistory> {
  const file = cachePath(accountId, from, to);
  if (!options.refresh) {
    try {
      const result = JSON.parse(await readFile(file, "utf8")) as HistoryResult;
      return { result, cacheFile: file, fromCache: true };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  const result = await fetchHistory(accountId, from, to, options);
  await mkdir(CACHE_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(result, null, 2));
  await rename(tmp, file);
  return { result, cacheFile: file, fromCache: false };
}
