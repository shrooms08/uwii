/**
 * Chain access for pool snapshots.
 *
 * - Balance views: NEAR archival JSON-RPC (default https://archival-rpc.mainnet.near.org, the free public
 *   archival endpoint listed at docs.near.org/api/rpc/providers). It is severely rate limited (observed:
 *   a few calls, then 429 with Retry-After ≈ 500s; legacy published limit 4 req/min and 10 req/10 min),
 *   so calls are serialized ~61s apart and Retry-After is honoured. Override with NEAR_ARCHIVAL_RPC_URL /
 *   NEAR_ARCHIVAL_RPC_MIN_INTERVAL_MS (e.g. a keyed provider in .env.local).
 * - Block lookup by time: block headers from FastNEAR's public neardata API (mainnet.neardata.xyz, no key),
 *   so the scarce archival budget is spent only on balance views.
 */
import { parseUnits } from "./amount";
import type { ProgressFn } from "./nearblocks";

export const ARCHIVAL_RPC_URL = process.env.NEAR_ARCHIVAL_RPC_URL || "https://archival-rpc.mainnet.near.org";
const ARCHIVAL_MIN_INTERVAL_MS = Number(process.env.NEAR_ARCHIVAL_RPC_MIN_INTERVAL_MS) || 61_000;
const ARCHIVAL_MAX_ATTEMPTS = 6;
export const NEARDATA_URL = "https://mainnet.neardata.xyz";
const FINAL_RPC_URL = "https://free.rpc.fastnear.com";
const TIMEOUT_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface BlockRef {
  height: number;
  hash: string;
  timestampNs: bigint;
}

// ---------- neardata block headers ----------

const headerCache = new Map<number, BlockRef | null>();
// neardata rate-limits bursts (observed 429 after ~15 rapid calls; 1 call / 2s sustained is fine).
const NEARDATA_MIN_INTERVAL_MS = 2_100;
let nextNeardataAt = 0;
async function neardataSlot() {
  const now = Date.now();
  const at = Math.max(now, nextNeardataAt);
  nextNeardataAt = at + NEARDATA_MIN_INTERVAL_MS;
  if (at > now) await sleep(at - now);
}

/** Header at exactly `height`, or null if no block was produced at that height. */
async function headerAt(height: number): Promise<BlockRef | null> {
  if (headerCache.has(height)) return headerCache.get(height)!;
  let lastErr = "";
  for (let attempt = 1; attempt <= 8; attempt++) {
    await neardataSlot();
    try {
      const res = await fetch(`${NEARDATA_URL}/v0/block/${height}/headers`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      if (res.ok) {
        const text = await res.text();
        if (text.trim() === "null") {
          headerCache.set(height, null);
          return null;
        }
        const j = JSON.parse(text) as { header: { height: number; hash: string; timestamp_nanosec: string } };
        const ref = { height: j.header.height, hash: j.header.hash, timestampNs: parseUnits(j.header.timestamp_nanosec, "timestamp") };
        headerCache.set(height, ref);
        return ref;
      }
      lastErr = `HTTP ${res.status}`;
      if (res.status !== 429 && res.status < 500) break;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    nextNeardataAt = Math.max(nextNeardataAt, Date.now() + Math.min(120_000, 5_000 * 2 ** (attempt - 1)));
  }
  throw new Error(`neardata header ${height} failed: ${lastErr}`);
}

/** First produced block with height in [from, toExclusive), or null if none. */
async function firstBlockIn(from: number, toExclusive: number): Promise<BlockRef | null> {
  for (let h = from; h < toExclusive; h++) {
    const b = await headerAt(h);
    if (b) return b;
  }
  return null;
}

/** Latest final block, from public (non-archival) RPC. */
export async function finalBlock(): Promise<BlockRef> {
  const res = await fetch(FINAL_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "uwii", method: "block", params: { finality: "final" } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  const j = (await res.json()) as { result?: { header: { height: number; hash: string; timestamp_nanosec: string } }; error?: unknown };
  if (!j.result) throw new Error(`final block lookup failed: ${JSON.stringify(j.error)}`);
  const h = j.result.header;
  return { height: h.height, hash: h.hash, timestampNs: parseUnits(h.timestamp_nanosec, "timestamp") };
}

/**
 * Block whose timestamp is closest to `targetNs`.
 *
 * Method: interpolation search on height. Starting from `anchor`, estimate the height from the observed
 * block rate, then keep a bracket lo (ts < target) / hi (ts >= target), interpolating inside it (falling
 * back to bisection when interpolation stalls). Heights with no block are skipped; the search ends when no
 * produced block lies strictly between lo and hi. The closer of lo/hi wins (ties go to lo, the block
 * before midnight).
 */
export async function closestBlock(targetNs: bigint, anchor: BlockRef, nsPerBlockHint?: number): Promise<BlockRef> {
  // ~0.6s blocks on mainnet in 2026, unless the caller observed the actual rate between earlier blocks.
  const NS_PER_BLOCK_GUESS = nsPerBlockHint && nsPerBlockHint > 0 ? Math.round(nsPerBlockHint) : 600_000_000;
  let lo: BlockRef | null = anchor.timestampNs < targetNs ? anchor : null;
  let hi: BlockRef | null = anchor.timestampNs >= targetNs ? anchor : null;
  let probe = anchor;

  // Phase 1: find a bracket.
  for (let i = 0; !(lo && hi); i++) {
    if (i > 60) throw new Error(`closestBlock: could not bracket target ${targetNs}`);
    const deltaBlocks = Number((targetNs - probe.timestampNs) / BigInt(NS_PER_BLOCK_GUESS));
    const sign = targetNs > probe.timestampNs ? 1 : -1;
    // Aim slightly past the estimate so we cross the target and get a bracket quickly.
    const step = deltaBlocks + sign * Math.max(3, Math.ceil(Math.abs(deltaBlocks) * 0.002));
    const guess = Math.max(9_820_210, probe.height + step); // never before mainnet genesis
    const b = (await firstBlockIn(guess, guess + 100)) ?? (await headerAt(guess));
    if (!b) throw new Error(`closestBlock: no block near height ${guess}`);
    probe = b;
    if (b.timestampNs < targetNs) lo = !lo || b.height > lo.height ? b : lo;
    else hi = !hi || b.height < hi.height ? b : hi;
  }

  // Phase 2: shrink the bracket. `hiBound` = lowest height known to start an empty run up to hi.
  // Interpolate, then bias the probe toward the side we did not just land on (doubling on repeats), so the
  // far end of the bracket also moves in instead of crawling as in plain interpolation search.
  let hiBound = hi.height;
  let bias = 0;
  for (let i = 0; hiBound - lo.height > 1; i++) {
    if (i > 80) throw new Error(`closestBlock: did not converge for target ${targetNs}`);
    const frac = Number(((targetNs - lo.timestampNs) * BigInt(1_000_000)) / (hi.timestampNs - lo.timestampNs)) / 1_000_000;
    const estimate = lo.height + Math.round(frac * (hi.height - lo.height));
    const guess = Math.min(Math.max(estimate + bias, lo.height + 1), hiBound - 1);
    const b = await firstBlockIn(guess, hiBound);
    if (!b) {
      hiBound = guess; // [guess, hi) has no blocks
      bias = bias < 0 ? bias * 2 : -1;
      continue;
    }
    if (b.timestampNs < targetNs) {
      lo = b;
      bias = bias > 0 ? bias * 2 : 1;
    } else {
      hi = b;
      hiBound = b.height;
      bias = bias < 0 ? bias * 2 : -1;
    }
  }
  const dLo = targetNs - lo.timestampNs;
  const dHi = hi.timestampNs - targetNs;
  return dHi < dLo ? hi : lo;
}

// ---------- archival view calls ----------

let nextArchivalAt = 0;
async function archivalSlot() {
  const now = Date.now();
  const at = Math.max(now, nextArchivalAt);
  nextArchivalAt = at + ARCHIVAL_MIN_INTERVAL_MS;
  if (at > now) await sleep(at - now);
}

/** Call a JSON view method at a block height via archival RPC; returns the parsed JSON result. */
export async function viewAtBlock(
  contract: string,
  method: string,
  args: object,
  height: number,
  onProgress?: ProgressFn,
): Promise<unknown> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: "uwii",
    method: "query",
    params: {
      request_type: "call_function",
      block_id: height,
      account_id: contract,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    },
  });
  let lastErr = "";
  for (let attempt = 1; attempt <= ARCHIVAL_MAX_ATTEMPTS; attempt++) {
    await archivalSlot();
    try {
      const res = await fetch(ARCHIVAL_RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 + 1000 : Math.min(600_000, 60_000 * attempt);
        lastErr = `HTTP ${res.status}`;
        onProgress?.(`  archival RPC ${lastErr}; waiting ${Math.round(wait / 1000)}s (attempt ${attempt}/${ARCHIVAL_MAX_ATTEMPTS})`);
        nextArchivalAt = Math.max(nextArchivalAt, Date.now() + wait);
        continue;
      }
      const j = (await res.json()) as { result?: { result?: number[]; error?: string }; error?: { cause?: { name?: string } } };
      if (j.result?.result) return JSON.parse(Buffer.from(j.result.result).toString("utf8"));
      throw new Error(`view ${contract}.${method}@${height} failed: ${JSON.stringify(j.error ?? j.result)}`);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("view ")) throw e;
      lastErr = e instanceof Error ? e.message : String(e);
      onProgress?.(`  archival RPC error: ${lastErr} (attempt ${attempt}/${ARCHIVAL_MAX_ATTEMPTS})`);
    }
  }
  throw new Error(`view ${contract}.${method}@${height} failed after ${ARCHIVAL_MAX_ATTEMPTS} attempts: ${lastErr}`);
}
