
async function main() {
  const { runPhase1 } = await import("../src/lib/near/phase1");
  const result = await runPhase1();

  console.log("== Model");
  console.log(result.model ? `${result.model.id}\n  why: ${result.model.reason}` : "(none chosen)");

  console.log("\n== Validated classification");
  if (result.classification) {
    console.log(JSON.stringify(result.classification.classification, null, 2));
    console.log(`  attempts: ${result.classification.attempts.length}, chat id: ${result.classification.evidence.chatId}`);
  } else {
    console.log(`ERROR: ${result.classificationError ?? "not run"}`);
  }

  console.log("\n== Attestation");
  const checks = (result.attestation.rawAttestationSummary.checks ?? []) as { step: string; ok: boolean; detail: string }[];
  for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.step} — ${c.detail}`);
  console.log(`\nverified: ${result.attestation.verified}`);
  console.log(`details: ${result.attestation.details}`);

  const ok = result.classification !== null && result.attestation.verified;
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(`check:attestation crashed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
