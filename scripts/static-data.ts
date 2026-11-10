/**
 * Writes public/static-data/ (gitignored) from data/: the CBN NFEM table and the cached demo inputs, so the
 * browser can compute reports without sending anything to the server. Runs before `next dev` and `next build`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

async function main() {
  const { buildDemoBundle, buildFxJson, demoAccounts } = await import("../src/lib/report/static-data");
  const out = path.join(process.cwd(), "public", "static-data");
  await mkdir(path.join(out, "demo"), { recursive: true });
  await writeFile(path.join(out, "fx-nafem.json"), JSON.stringify(await buildFxJson()));
  const accounts = await demoAccounts();
  for (const a of accounts) await writeFile(path.join(out, "demo", `${a}.json`), JSON.stringify(await buildDemoBundle(a)));
  console.log(`static-data: fx-nafem.json and ${accounts.length} demo bundle(s) in public/static-data/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
