// Usage: npm run classify -- --account <id> [--from 2026-01-01 --to 2026-12-31] [--own a.near,b.near] [--refresh] [--live] [--write-fixture]
//   --refresh        re-run rules + live AI (attested) and rewrite the cache
//   --live           never use fixtures (history or classified)
//   --write-fixture  also write data/fixtures/<account>-<YYYY>.classified.json
import { parseArgs } from "node:util";

async function main() {
  const { values } = parseArgs({
    options: {
      account: { type: "string" },
      from: { type: "string", default: "2026-01-01" },
      to: { type: "string", default: "2026-12-31" },
      own: { type: "string", default: "" },
      refresh: { type: "boolean", default: false },
      live: { type: "boolean", default: false },
      "write-fixture": { type: "boolean", default: false },
    },
    strict: true,
  });
  if (!values.account) {
    console.error("Usage: npm run classify -- --account <id> [--own a.near,b.near] [--refresh] [--live] [--write-fixture]");
    process.exit(2);
  }
  const { getClassification, writeClassifiedFixture } = await import("../src/lib/tax/ng/cache");
  const { isAiEvidence } = await import("../src/lib/tax/ng/types");

  const { run, origin, file } = await getClassification(values.account, values.from, values.to, {
    ownAccounts: values.own.split(","),
    refresh: values.refresh,
    live: values.live,
    onProgress: (m) => console.log(m),
  });
  const m = run.metrics;
  console.log(`\n== ${run.accountId} ${run.from}..${run.to}  (${origin}: ${file})`);
  console.log(`model ${run.model ?? "-"} · own accounts [${run.ownAccounts.join(", ")}] · classified ${run.classifiedAt}`);
  console.log(`attestation reports verified: ${run.attestation.verified ? "yes" : "no"} — ${run.attestation.details}`);
  console.log(`total ${m.total} · rule ${m.rule} (${m.pctRule}) · ai ${m.ai} (${m.pctAi}) · user ${m.user} · needsQuestion ${m.needsQuestion}`);
  console.log(`AI responses verified ${m.aiResponsesVerified}/${m.aiResponses}`);
  for (const r of run.aiResponses) console.log(`  batch ${r.batch} attempt ${r.attempt} chat ${r.chatId ?? "-"} valid=${r.valid} sig=${r.signatureVerified} ${r.detail}`);

  const counts: Record<string, number> = {};
  for (const r of run.records) counts[r.label] = (counts[r.label] ?? 0) + 1;
  console.log("\n== Label counts");
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(26)} ${v}`);

  if (values["write-fixture"]) console.log(`\nWrote classified fixture: ${await writeClassifiedFixture(run)}`);
  const unverified = run.records.filter((r) => r.method === "ai" && isAiEvidence(r.evidence) && !r.evidence.signatureVerified && !r.needsQuestion);
  if (unverified.length) {
    console.error(`${unverified.length} AI-classified records have an unverified signature but are not flagged`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`classify failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
