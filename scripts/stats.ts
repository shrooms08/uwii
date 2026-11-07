// Usage: npm run stats
// Writes src/content/stats.json: the numbers the landing page's "Live" row shows, each measured, never
// typed by hand:
//  - tests: runs `npm test` and reads node:test's summary (tests, pass, fail);
//  - illustrations: the passing tests that reproduce the NRS Circular's Illustrations (names start
//    "Circular Illustration");
//  - anchors: reports anchored on NEAR testnet, counted from the anchor contract's own state (every entry
//    of its `anchors` map, read with the view_state RPC at the final block).
// The privacy-check count comes from the committed demo run at build time (src/lib/demo/demo-proof.ts).
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const CONTRACT = "uwii-anchor.testnet";
const RPC = "https://rpc.testnet.fastnear.com";
/** Borsh key prefix of the contract's `anchors` LookupMap (StorageKey::Anchors = enum index 0). */
const ANCHORS_PREFIX = 0;

function runTests() {
  const r = spawnSync("npm", ["test"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout}\n${r.stderr}`;
  const n = (label: string) => Number(new RegExp(`^ℹ ${label} (\\d+)$`, "m").exec(out)?.[1] ?? NaN);
  const tests = n("tests");
  const pass = n("pass");
  const fail = n("fail");
  if (!Number.isFinite(tests) || !Number.isFinite(pass)) throw new Error("Could not read the test summary from npm test");
  const illustrations = out.split("\n").filter((l) => /^✔ Circular Illustration \d/.test(l.trim())).length;
  return { tests, pass, fail, illustrations };
}

async function countAnchors() {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "uwii-stats", method: "query", params: { request_type: "view_state", finality: "final", account_id: CONTRACT, prefix_base64: "" } }),
  });
  const j = (await res.json()) as { result?: { block_height: number; values: { key: string }[] }; error?: unknown };
  if (!j.result) throw new Error(`view_state failed: ${JSON.stringify(j.error).slice(0, 200)}`);
  const anchors = j.result.values.filter((v) => Buffer.from(v.key, "base64")[0] === ANCHORS_PREFIX).length;
  return { anchors, blockHeight: j.result.block_height };
}

async function main() {
  const t = runTests();
  if (t.fail !== 0 || t.pass !== t.tests) throw new Error(`Tests are not all passing (${t.pass}/${t.tests}); fix them before publishing stats`);
  const a = await countAnchors();
  const stats = {
    generatedAt: new Date().toISOString(),
    tests: { passing: t.pass, total: t.tests, source: "npm test (node:test summary)" },
    illustrations: { reproduced: t.illustrations, source: "tests named 'Circular Illustration …' in src/lib/tax/ng/engine.test.ts" },
    anchors: { count: a.anchors, contract: CONTRACT, blockHeight: a.blockHeight, source: `view_state of ${CONTRACT} (entries of its anchors map)` },
  };
  const file = path.join(process.cwd(), "src", "content", "stats.json");
  await writeFile(file, `${JSON.stringify(stats, null, 2)}\n`);
  console.log(`Wrote ${path.relative(process.cwd(), file)}: ${t.pass}/${t.tests} tests, ${t.illustrations} illustrations, ${a.anchors} anchors at block ${a.blockHeight}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
