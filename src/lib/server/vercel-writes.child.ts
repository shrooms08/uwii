// Child process for server.test.ts: run with VERCEL=1 and a private TMPDIR. Records every filesystem
// write the app makes while building the demo report and caching a classification, then tries the
// writes that must be refused. Prints one JSON line with the results.
import fs from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";

const writes: string[] = [];
const record = (p: unknown) => writes.push(typeof p === "string" ? p : String(p));

for (const name of ["writeFile", "appendFile", "mkdir", "rename", "copyFile", "rm", "unlink", "open"] as const) {
  const orig = (fsp as unknown as Record<string, (...a: unknown[]) => unknown>)[name];
  (fsp as unknown as Record<string, unknown>)[name] = (...a: unknown[]) => {
    record(name === "rename" || name === "copyFile" ? a[1] : a[0]);
    if (name === "open" && !String(a[1] ?? "r").match(/[wa+]/)) writes.pop();
    return orig.apply(fsp, a);
  };
}
for (const name of ["writeFileSync", "appendFileSync", "mkdirSync", "renameSync", "copyFileSync", "rmSync", "unlinkSync", "createWriteStream"] as const) {
  const orig = (fs as unknown as Record<string, (...a: unknown[]) => unknown>)[name];
  (fs as unknown as Record<string, unknown>)[name] = (...a: unknown[]) => {
    record(name === "renameSync" || name === "copyFileSync" ? a[1] : a[0]);
    return orig.apply(fs, a);
  };
}
syncBuiltinESMExports();

async function main() {
  const { CACHE_DIR, ON_VERCEL, writeJson } = await import("../history/paths");
  const { buildReport } = await import("../tax/ng/report");
  const { classifiedCachePath, getClassification } = await import("../tax/ng/cache");
  const { writeNafemCsv } = await import("../fx/nafem");
  const { ILLUSTRATIVE_ANSWERS } = await import("../demo/illustrative-answers");

  // What the app does at runtime for the demo account: report (fixtures) and a scan's cache write.
  const { report } = await buildReport({ account: "rybergh44.near", answers: { groups: ILLUSTRATIVE_ANSWERS.groups }, profile: { otherIncomeNgn: "4800000" }, noLiveClassification: true });
  const { run } = await getClassification("rybergh44.near", "2026-01-01", "2026-12-31", { ownAccounts: [], fixtureOnly: true });
  await writeJson(classifiedCachePath("rybergh44.near", "2026-01-01", "2026-12-31"), run);

  const refused: string[] = [];
  try {
    await writeJson(`${process.cwd()}/data/fixtures/should-not-exist.json`, {});
  } catch (e) {
    refused.push(String((e as Error).message));
  }
  try {
    await writeNafemCsv([], { sourceUrl: "x", pageUrl: "x", retrievedAt: "x" });
  } catch (e) {
    refused.push(String((e as Error).message));
  }
  console.log(JSON.stringify({ onVercel: ON_VERCEL, cacheDir: CACHE_DIR, status: report.status, writes, refused }));
}

main().catch((e) => {
  console.log(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
