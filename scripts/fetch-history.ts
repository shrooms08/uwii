// Usage: npm run fetch:history -- --account <id> --from 2026-01-01 --to 2026-12-31 [--refresh]
import { parseArgs } from "node:util";

async function main() {
  const { values } = parseArgs({
    options: {
      account: { type: "string" },
      from: { type: "string", default: "2026-01-01" },
      to: { type: "string", default: "2026-12-31" },
      refresh: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (!values.account) {
    console.error("Usage: npm run fetch:history -- --account <id> --from YYYY-MM-DD --to YYYY-MM-DD [--refresh]");
    process.exit(2);
  }

  const { getHistory } = await import("../src/lib/history/cache");
  const { countsByKind, summarizeByAsset } = await import("../src/lib/history/summary");

  const started = Date.now();
  const { result, cacheFile, fromCache } = await getHistory(values.account, values.from, values.to, {
    refresh: values.refresh,
    onProgress: (m) => console.log(m),
  });

  console.log(`\n== ${result.accountId}  ${result.from} .. ${result.to}  (source: ${result.source})`);
  console.log(`${fromCache ? "Loaded from cache" : "Fetched and cached"}: ${cacheFile}`);
  console.log(`records: ${result.records.length}  (fetched at ${result.fetchedAt}, ${((Date.now() - started) / 1000).toFixed(1)}s)`);

  console.log("\n== Counts by kind (failed in parentheses)");
  for (const k of countsByKind(result.records)) {
    console.log(`  ${k.kind.padEnd(28)} ${String(k.total).padStart(6)}${k.failed ? `  (${k.failed} failed)` : ""}`);
  }

  console.log("\n== Counts by asset  (in / out sums exclude failed)");
  for (const a of summarizeByAsset(result.records)) {
    console.log(`  ${a.asset.padEnd(40)} ${String(a.total).padStart(6)}${a.failed ? ` (${a.failed} failed)` : ""}   in ${a.in}   out ${a.out}`);
  }
}

main().catch((e) => {
  console.error(`fetch:history failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
