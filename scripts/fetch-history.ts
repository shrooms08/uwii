// Usage: npm run fetch:history -- --account <id> --from 2026-01-01 --to 2026-12-31 [--refresh] [--live] [--write-fixture]
//   --refresh        ignore cache and fixture, fetch live, rewrite the cache
//   --live           never use the committed demo fixture (cache still used)
//   --write-fixture  also write the result to data/fixtures/<account>-<YYYY>.json (full calendar year only)
import { parseArgs } from "node:util";

async function main() {
  const { values } = parseArgs({
    options: {
      account: { type: "string" },
      from: { type: "string", default: "2026-01-01" },
      to: { type: "string", default: "2026-12-31" },
      refresh: { type: "boolean", default: false },
      live: { type: "boolean", default: false },
      "write-fixture": { type: "boolean", default: false },
    },
    strict: true,
  });
  if (!values.account) {
    console.error("Usage: npm run fetch:history -- --account <id> --from YYYY-MM-DD --to YYYY-MM-DD [--refresh] [--live] [--write-fixture]");
    process.exit(2);
  }

  const { getHistory, writeFixture } = await import("../src/lib/history/cache");
  const { countsByKind, summarizeByAsset, stakingRewardsByPool, totalFees, toUnits } = await import("../src/lib/history/summary");
  const { formatUnits } = await import("../src/lib/history/amount");

  const started = Date.now();
  const { result, origin, file } = await getHistory(values.account, values.from, values.to, {
    refresh: values.refresh,
    live: values.live,
    onProgress: (m) => console.log(m),
  });

  console.log(`\n== ${result.accountId}  ${result.from} .. ${result.to}  (source: ${result.source})`);
  console.log(`${{ cache: "Loaded from cache", fixture: "Loaded from demo fixture", live: "Fetched and cached" }[origin]}: ${file}`);
  console.log(`records: ${result.records.length}  (fetched at ${result.fetchedAt}, ${((Date.now() - started) / 1000).toFixed(1)}s)`);

  console.log("\n== Counts by kind (failed in parentheses)");
  for (const k of countsByKind(result.records)) {
    console.log(`  ${k.kind.padEnd(28)} ${String(k.total).padStart(6)}${k.failed ? `  (${k.failed} failed)` : ""}`);
  }

  console.log("\n== Counts by asset  (in / out sums exclude failed)");
  for (const a of summarizeByAsset(result.records)) {
    console.log(`  ${a.asset.padEnd(40)} ${String(a.total).padStart(6)}${a.failed ? ` (${a.failed} failed)` : ""}   in ${a.in}   out ${a.out}`);
  }

  const fees = totalFees(result.records);
  console.log(`\n== Fees (transactions signed by ${result.accountId})\n  ${fees.count} signed txns, total ${fees.total} NEAR`);

  const rewards = stakingRewardsByPool(result.records);
  const st = result.staking;
  console.log(`\n== Staking rewards (pool snapshots; last complete UTC midnight: ${st.lastCompleteBoundary ?? "n/a"})`);
  console.log(`  archival RPC: ${st.archivalRpc}\n  block lookup: ${st.blockLookup}`);
  console.log(`  pools ever used: ${st.pools.map((p) => p.pool).join(", ") || "(none)"}`);
  console.log(`  total rewards: ${rewards.total} NEAR   negative reward days (not emitted): ${st.negativeRewardDays}`);

  console.log("\n== Reconciliation per pool: sum(emitted rewards) == end - start - deposits + withdrawals");
  let allOk = true;
  for (const p of st.pools) {
    const y = (s: string) => toUnits(s, 24);
    const expected = BigInt(p.end.totalBalance) - BigInt(p.start.totalBalance) - y(p.deposits) + y(p.withdrawals);
    const emitted = result.records
      .filter((r) => r.kind === "staking_reward" && r.counterparty === p.pool)
      .reduce((s, r) => s + y(r.amount), BigInt(0));
    const ok = emitted === expected;
    allOk &&= ok;
    console.log(`  ${p.pool}  (first interaction ${p.firstInteraction})`);
    console.log(`    start ${p.start.date} 00:00  balance ${formatUnits(BigInt(p.start.totalBalance), 24)}  [${p.start.method}${p.start.block ? ` @${p.start.block.height}` : ""}]`);
    console.log(`    end   ${p.end.date} 00:00  balance ${formatUnits(BigInt(p.end.totalBalance), 24)}  [${p.end.method}${p.end.block ? ` @${p.end.block.height}` : ""}]`);
    console.log(`    deposits ${p.deposits}   withdrawals ${p.withdrawals}   queried snapshots ${p.queriedSnapshots}`);
    console.log(`    expected ${expected} yocto   emitted ${emitted} yocto (${p.rewardDays} days)   ${ok ? "OK exact" : `MISMATCH by ${emitted - expected} yocto`}`);
    for (const n of p.negativeDays) console.log(`    negative day ${n.date}: ${n.amount} NEAR`);
  }

  if (values["write-fixture"]) {
    const fx = await writeFixture(result);
    console.log(`\nWrote demo fixture: ${fx}`);
  }
  if (!allOk) process.exit(1);
}

main().catch((e) => {
  console.error(`fetch:history failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
