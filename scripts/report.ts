// Usage: npm run report -- --account <id> [--answers answers.json] [--own a.near,b.near] [--other-income 4800000] [--write-fixture]
//   answers.json: { "ownAccounts": [...], "answers": { "groups": {...} }, "profile": { "otherIncomeNgn": "..." } }
//   (same shape the browser sends; keep it outside git — it is personal data)
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

async function main() {
  const { values } = parseArgs({
    options: {
      account: { type: "string" },
      answers: { type: "string" },
      own: { type: "string", default: "" },
      "other-income": { type: "string" },
      "write-fixture": { type: "boolean", default: false },
    },
    strict: true,
  });
  if (!values.account) {
    console.error("Usage: npm run report -- --account <id> [--answers file.json] [--own a,b] [--other-income NGN] [--write-fixture]");
    process.exit(2);
  }
  const { buildReport, prequote, writeReportFixtures } = await import("../src/lib/tax/ng/report");
  const { money2, dec } = await import("../src/lib/money");

  const file = values.answers ? (JSON.parse(await readFile(values.answers, "utf8")) as { ownAccounts?: string[]; answers?: { groups: Record<string, never> }; profile?: { otherIncomeNgn?: string } }) : {};
  const ownAccounts = [...(file.ownAccounts ?? []), ...values.own.split(",").filter(Boolean)];
  const otherIncomeNgn = values["other-income"] ?? file.profile?.otherIncomeNgn ?? null;

  const { report, recorder, opening, records } = await buildReport({
    account: values.account,
    ownAccounts,
    answers: file.answers ?? { groups: {} },
    profile: { otherIncomeNgn },
    onProgress: (m) => console.log(m),
  });
  if (values["write-fixture"]) {
    console.log("Pre-quoting every record and fee so the fixture covers any answers…");
    await prequote(records, opening, recorder);
    console.log(`Wrote: ${(await writeReportFixtures(values.account, recorder, opening)).join(", ")}`);
  }

  const n = (s: string) => `NGN ${money2(dec(s))}`;
  const t = report.totals;
  console.log(`\n== ${report.account} tax year ${report.year} (classification: ${report.origin.classification}; prices: ${report.origin.prices}; opening: ${report.origin.opening})`);
  console.log(`questions: resolved by user ${report.questionSummary.resolvedByUser}, unresolved ${report.questionSummary.unresolved}`);
  console.log(`opening: ${report.opening.method} (block ${report.opening.block.height}); lots ${report.openingLots.length}`);
  console.log(`total VA income      ${n(t.totalVaIncomeNgn)}  (USD ${money2(dec(t.totalVaIncomeUsd))})`);
  console.log(`disposal gains       ${n(t.disposalGainsNgn)}   losses ${n(t.disposalLossesNgn)}`);
  console.log(`net gains            ${n(t.netGainsNgn)}   carry-forward loss ${n(report.carryForwardLossNgn)}`);
  console.log(`gas fees (D2)        ${n(t.gasFeesNgn)}  (USD ${money2(dec(t.gasFeesUsd))}; not deductible)`);
  console.log(`chargeable VA        ${n(t.chargeableVaNgn)}`);
  console.log(`other income         ${report.tax.otherIncomeNgn ? n(report.tax.otherIncomeNgn) : "(not provided)"}`);
  console.log(`PIT with VA ${n(report.tax.pitWithVaNgn)} - without ${n(report.tax.pitWithoutVaNgn)} = tax attributable to VA ${n(report.tax.taxAttributableToVaNgn)}`);
  for (const x of report.tax.notes) console.log(`  note: ${x}`);

  const byKind: Record<string, number> = {};
  for (const l of report.lines) byKind[l.kind] = (byKind[l.kind] ?? 0) + 1;
  console.log(`\nlines ${report.lines.length} (${t.linesIncluded} in totals): ${JSON.stringify(byKind)}; technical skipped ${JSON.stringify(report.skippedTechnical)}`);
  const gran: Record<string, number> = {};
  for (const l of report.lines) if (l.priceGranularity) gran[l.priceGranularity] = (gran[l.priceGranularity] ?? 0) + 1;
  console.log(`price granularity: ${JSON.stringify(gran)}; rate_fallback lines: ${report.lines.filter((l) => l.rateFallback).length}`);

  console.log(`\n== Warnings (${report.warnings.length})`);
  for (const w of report.warnings) console.log(`  [${w.code}] ${w.message}`);
  console.log(`\n== Decisions applied: ${report.decisionsApplied.map((d) => d.id).join(", ")}`);
  console.log(`== Data sources:`);
  for (const s of report.dataSources) console.log(`  ${s.name}: ${s.detail}`);
}

main().catch((e) => {
  console.error(`report failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
