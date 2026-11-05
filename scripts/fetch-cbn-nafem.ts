// Download the official CBN NFEM (formerly NAFEM) closing USD/NGN rates and write data/fx/cbn-nafem-usdngn.csv.
// Usage: npm run fetch:fx [-- --from 2025-12-31]
import { parseArgs } from "node:util";

async function main() {
  const { values } = parseArgs({ options: { from: { type: "string", default: "2025-12-31" } }, strict: true });
  const { CBN_NFEM_API_URL, CBN_NFEM_PAGE_URL, downloadNafemRates, writeNafemCsv } = await import("../src/lib/fx/nafem");
  const rows = await downloadNafemRates();
  const kept = rows.filter((r) => r.date >= values.from);
  const file = await writeNafemCsv(kept, { sourceUrl: CBN_NFEM_API_URL, pageUrl: CBN_NFEM_PAGE_URL, retrievedAt: new Date().toISOString() });
  console.log(`CBN NFEM rows: ${rows.length} total, ${kept.length} from ${values.from} (${kept[0]?.date} .. ${kept[kept.length - 1]?.date})`);
  console.log(`Wrote ${file}`);
}

main().catch((e) => {
  console.error(`fetch:fx failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
