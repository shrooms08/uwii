/**
 * Minimal NearBlocks v3 client (https://api.nearblocks.io/api-docs).
 *
 * Free public tier, no API key: 6 calls/minute, 333 calls/day, 10,000 calls/month.
 * Each 25 rows of `limit` costs one call credit, so we page 25 rows at a time and
 * space requests ~10.5s apart. 429s and 5xx/network errors are retried with
 * exponential backoff (honouring Retry-After when present).
 */

export const NEARBLOCKS_BASE_URL = "https://api.nearblocks.io";
export const NEARBLOCKS_SOURCE = "nearblocks-v3";

const PAGE_LIMIT = 25; // 1 credit per request
const FREE_TIER_CALLS_PER_MINUTE = 6;
const MIN_INTERVAL_MS = Math.ceil(60_000 / FREE_TIER_CALLS_PER_MINUTE) + 500;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 8;
const MAX_PAGES = 2_000; // hard stop against a misbehaving cursor (50k rows per endpoint)

export type ProgressFn = (message: string) => void;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Process-wide pacing shared by every caller, so concurrent fetches can't burst past the limit.
let nextSlotAt = 0;
async function acquireSlot(): Promise<void> {
  const now = Date.now();
  const startAt = Math.max(now, nextSlotAt);
  nextSlotAt = startAt + MIN_INTERVAL_MS;
  if (startAt > now) await sleep(startAt - now);
}
function pushBackSlots(ms: number) {
  nextSlotAt = Math.max(nextSlotAt, Date.now() + ms);
}

function retryAfterMs(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

export class NearBlocksError extends Error {}

async function getJson(path: string, params: Record<string, string>, onProgress?: ProgressFn): Promise<unknown> {
  const url = new URL(path, NEARBLOCKS_BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await acquireSlot();
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (e) {
      lastError = `network error: ${e instanceof Error ? e.message : String(e)}`;
      const wait = Math.min(60_000, 2_000 * 2 ** (attempt - 1));
      onProgress?.(`  ${url.pathname}: ${lastError}; retry ${attempt}/${MAX_ATTEMPTS - 1} in ${wait / 1000}s`);
      pushBackSlots(wait);
      continue;
    }

    if (res.ok) return res.json();

    const body = (await res.text()).slice(0, 300);
    lastError = `HTTP ${res.status}: ${body}`;
    if (res.status === 429) {
      const wait = retryAfterMs(res) ?? Math.min(120_000, 20_000 * 2 ** (attempt - 1));
      onProgress?.(`  ${url.pathname}: rate limited (429); retry ${attempt}/${MAX_ATTEMPTS - 1} in ${Math.round(wait / 1000)}s`);
      pushBackSlots(wait);
      continue;
    }
    if (res.status >= 500) {
      const wait = Math.min(60_000, 2_000 * 2 ** (attempt - 1));
      onProgress?.(`  ${url.pathname}: ${lastError}; retry ${attempt}/${MAX_ATTEMPTS - 1} in ${wait / 1000}s`);
      pushBackSlots(wait);
      continue;
    }
    throw new NearBlocksError(`${url.pathname}${url.search} failed: ${lastError}`);
  }
  throw new NearBlocksError(`${url.pathname}${url.search} failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
}

export interface RangeNs {
  start: bigint;
  endExclusive: bigint;
}

interface Page {
  data?: unknown[];
  meta?: { next_page?: string | null };
}

/**
 * Walk a newest-first NearBlocks list endpoint, starting just before `range.endExclusive`
 * and following `next` cursors until rows fall before `range.start`.
 * Returns only rows inside [start, endExclusive).
 */
export async function fetchAllInRange<T>(opts: {
  path: string;
  params?: Record<string, string>;
  range: RangeNs;
  timestampOf: (row: T) => bigint;
  onProgress?: ProgressFn;
}): Promise<T[]> {
  const { path, range, timestampOf, onProgress } = opts;
  const base = { ...(opts.params ?? {}), limit: String(PAGE_LIMIT) };
  const rows: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const params: Record<string, string> = cursor
      ? { ...base, next: cursor }
      : { ...base, before_ts: range.endExclusive.toString().padStart(19, "0") };
    const json = (await getJson(path, params, onProgress)) as Page;
    const data = (json.data ?? []) as T[];

    let reachedStart = false;
    for (const row of data) {
      const ts = timestampOf(row);
      if (ts >= range.endExclusive) continue;
      if (ts < range.start) {
        reachedStart = true;
        continue;
      }
      rows.push(row);
    }
    onProgress?.(`  ${path} page ${page}: ${data.length} rows (${rows.length} in range so far)`);

    const next = json.meta?.next_page ?? null;
    if (reachedStart || data.length === 0 || !next) return rows;
    if (seenCursors.has(next)) throw new NearBlocksError(`${path}: pagination cursor repeated; aborting`);
    seenCursors.add(next);
    cursor = next;
  }
  throw new NearBlocksError(`${path}: exceeded ${MAX_PAGES} pages; refusing to continue`);
}
