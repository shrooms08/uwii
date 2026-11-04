/**
 * Staking rewards from daily pool balance snapshots.
 *
 * Rewards accrue inside a staking pool with no transaction, so for every pool the account has ever used
 * (all-time staking events, so balances carried in from earlier years count) we read
 * get_account_total_balance at the block closest to each UTC midnight and derive, per pool and day:
 *
 *   reward(D) = total(D+1 00:00) - total(D 00:00) - deposits(D) + withdrawals(D)
 *
 * where deposits/withdrawals are DEPOSIT / WITHDRAW staking events executed after the day's start snapshot
 * block and at or before its end snapshot block. A boundary is not queried when its balance is provably 0:
 * before the first ever event with the pool, or after a 0 snapshot with no events since.
 */
import path from "node:path";
import { NS_PER_MS, ZERO, formatUnits, parseUnits } from "./amount";
import { ARCHIVAL_RPC_URL, NEARDATA_URL, closestBlock, finalBlock, viewAtBlock, type BlockRef } from "./chain";
import type { ProgressFn } from "./nearblocks";
import { CACHE_DIR, readJsonIfExists, writeJson } from "./paths";
import { NEAR_ASSET, type NormalizedTx, type PoolSnapshot, type StakingRewardsInfo } from "./types";

export interface StakingEvent {
  pool: string;
  type: string; // DEPOSIT | STAKE | UNSTAKE | WITHDRAW
  amount: bigint;
  timestampNs: bigint;
  txHash: string;
  receiptId: string;
}

const DAY_MS = 86_400_000;
/** Safety margin around a midnight when deciding whether a boundary can be skipped as known-zero. */
const SKIP_MARGIN_NS = BigInt(10_000_000_000);

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const midnightNs = (date: string) => BigInt(Date.parse(`${date}T00:00:00Z`)) * NS_PER_MS;

const MIDNIGHT_CACHE = path.join(CACHE_DIR, "midnight-blocks.json");
type MidnightCache = Record<string, { height: number; hash: string; timestampNs: string }>;
const snapshotCacheFile = (accountId: string) => path.join(CACHE_DIR, `pool-snapshots-${accountId}.json`);
type SnapshotCache = Record<string, string>; // "<pool>@<height>" -> yocto

function dayList(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  for (let d = fromDate; d <= toDate; d = addDays(d, 1)) out.push(d);
  return out;
}

export async function deriveStakingRewards(opts: {
  accountId: string;
  /** Inclusive UTC dates. */
  fromDate: string;
  toDate: string;
  /** All-time staking events for the account. */
  events: StakingEvent[];
  onProgress?: ProgressFn;
}): Promise<{ records: NormalizedTx[]; info: StakingRewardsInfo }> {
  const { accountId, fromDate, toDate, events, onProgress } = opts;
  const pools = [...new Set(events.map((e) => e.pool))].sort();
  const info: StakingRewardsInfo = {
    pools: [],
    negativeRewardDays: 0,
    lastCompleteBoundary: null,
    archivalRpc: ARCHIVAL_RPC_URL,
    blockLookup: `${NEARDATA_URL} block headers, interpolation search`,
  };
  if (pools.length === 0) return { records: [], info };

  const final = await finalBlock();
  // Boundaries are the midnights starting each day in range, plus the one after the last day, up to now.
  const boundaries = dayList(fromDate, addDays(toDate, 1)).filter((d) => midnightNs(d) <= final.timestampNs);
  if (boundaries.length < 2) return { records: [], info };
  info.lastCompleteBoundary = boundaries[boundaries.length - 1];

  const midnightCache = (await readJsonIfExists<MidnightCache>(MIDNIGHT_CACHE)) ?? {};
  const snapCache = (await readJsonIfExists<SnapshotCache>(snapshotCacheFile(accountId))) ?? {};
  let anchor: BlockRef = final;
  let prevAnchor: BlockRef | null = null;

  async function blockFor(date: string): Promise<BlockRef> {
    const c = midnightCache[date];
    if (c) {
      const b = { height: c.height, hash: c.hash, timestampNs: BigInt(c.timestampNs) };
      if (b.height !== anchor.height) [prevAnchor, anchor] = [anchor, b];
      return b;
    }
    // Block rate observed between the last two known blocks seeds the search.
    const hint =
      prevAnchor && prevAnchor.height !== anchor.height
        ? Number((anchor.timestampNs - prevAnchor.timestampNs) / BigInt(anchor.height - prevAnchor.height))
        : undefined;
    const b = await closestBlock(midnightNs(date), anchor, hint);
    [prevAnchor, anchor] = [anchor, b];
    midnightCache[date] = { height: b.height, hash: b.hash, timestampNs: b.timestampNs.toString() };
    await writeJson(MIDNIGHT_CACHE, midnightCache);
    return b;
  }

  const records: NormalizedTx[] = [];
  for (const pool of pools) {
    const poolEvents = events.filter((e) => e.pool === pool).sort((a, b) => (a.timestampNs < b.timestampNs ? -1 : 1));
    const firstTs = poolEvents[0].timestampNs;
    onProgress?.(`Pool ${pool}: first interaction ${new Date(Number(firstTs / NS_PER_MS)).toISOString()}`);

    const snaps: PoolSnapshot[] = [];
    let queried = 0;
    for (let k = 0; k < boundaries.length; k++) {
      const date = boundaries[k];
      const t = midnightNs(date);
      const prev = snaps[k - 1];
      const prevT = k > 0 ? midnightNs(boundaries[k - 1]) : null;
      const neverBefore = !poolEvents.some((e) => e.timestampNs <= t + SKIP_MARGIN_NS);
      const zeroCarried =
        prev !== undefined &&
        prev.totalBalance === "0" &&
        !poolEvents.some((e) => e.timestampNs > prevT! - SKIP_MARGIN_NS && e.timestampNs <= t + SKIP_MARGIN_NS);
      if (neverBefore || zeroCarried) {
        snaps.push({ date, block: null, totalBalance: "0", method: "known_zero" });
        continue;
      }
      const block = await blockFor(date);
      const key = `${pool}@${block.height}`;
      let total = snapCache[key];
      if (total === undefined) {
        onProgress?.(`  ${pool} @ ${date} 00:00 (block ${block.height}): querying archival RPC…`);
        const v = await viewAtBlock(pool, "get_account_total_balance", { account_id: accountId }, block.height, onProgress);
        total = parseUnits(v, "get_account_total_balance").toString();
        snapCache[key] = total;
        await writeJson(snapshotCacheFile(accountId), snapCache);
        queried++;
      }
      snaps.push({
        date,
        block: { height: block.height, hash: block.hash, timestampNs: block.timestampNs.toString() },
        totalBalance: total,
        method: "rpc_view",
      });
    }

    const boundaryTs = (s: PoolSnapshot) => (s.block ? BigInt(s.block.timestampNs) : midnightNs(s.date));
    let depTotal = ZERO;
    let wdTotal = ZERO;
    let rewardTotal = ZERO;
    let rewardDays = 0;
    const negativeDays: { date: string; amount: string }[] = [];

    for (let i = 0; i + 1 < snaps.length; i++) {
      const start = snaps[i];
      const end = snaps[i + 1];
      const lo = boundaryTs(start);
      const hi = boundaryTs(end);
      const inDay = poolEvents.filter((e) => e.timestampNs > lo && e.timestampNs <= hi);
      const deposits = inDay.filter((e) => e.type === "DEPOSIT");
      const withdrawals = inDay.filter((e) => e.type === "WITHDRAW");
      const dep = deposits.reduce((s, e) => s + e.amount, ZERO);
      const wd = withdrawals.reduce((s, e) => s + e.amount, ZERO);
      depTotal += dep;
      wdTotal += wd;
      const reward = BigInt(end.totalBalance) - BigInt(start.totalBalance) - dep + wd;
      if (reward < ZERO) {
        const amount = formatUnits(reward, NEAR_ASSET.decimals);
        negativeDays.push({ date: start.date, amount });
        onProgress?.(`  WARNING ${pool} ${start.date}: negative derived reward ${amount} NEAR (not emitted)`);
        continue;
      }
      if (reward === ZERO) continue;
      rewardTotal += reward;
      rewardDays++;
      const adj = (e: StakingEvent) => ({
        type: e.type,
        amount: e.amount.toString(),
        timestamp: new Date(Number(e.timestampNs / NS_PER_MS)).toISOString(),
        txHash: e.txHash,
        receiptId: e.receiptId,
      });
      records.push({
        id: `pool_snapshot:${pool}:${start.date}`,
        txHash: "",
        // Dated inside the day it was earned, so the last day of a tax year stays in that year.
        timestamp: `${start.date}T23:59:59.999Z`,
        direction: "in",
        kind: "staking_reward",
        asset: NEAR_ASSET,
        amount: formatUnits(reward, NEAR_ASSET.decimals),
        counterparty: pool,
        method: null,
        success: true,
        source: "pool_snapshot",
        raw: {
          day: start.date,
          formula: "end.totalBalance - start.totalBalance - deposits + withdrawals",
          start,
          end,
          deposits: deposits.map(adj),
          withdrawals: withdrawals.map(adj),
          rewardYocto: reward.toString(),
        },
        fee: null,
      });
    }

    info.negativeRewardDays += negativeDays.length;
    info.pools.push({
      pool,
      firstInteraction: new Date(Number(firstTs / NS_PER_MS)).toISOString(),
      start: snaps[0],
      end: snaps[snaps.length - 1],
      deposits: formatUnits(depTotal, NEAR_ASSET.decimals),
      withdrawals: formatUnits(wdTotal, NEAR_ASSET.decimals),
      rewards: formatUnits(rewardTotal, NEAR_ASSET.decimals),
      rewardDays,
      negativeDays,
      queriedSnapshots: snaps.filter((s) => s.method === "rpc_view").length,
    });
    onProgress?.(`  ${pool}: ${queried} new archival queries, ${rewardDays} reward days, ${negativeDays.length} negative days`);
  }
  return { records, info };
}
