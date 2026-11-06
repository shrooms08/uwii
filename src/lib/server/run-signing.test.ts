import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { ClassifiedRun } from "../tax/ng/types";

// Isolated, empty server cache for every report built here; a test-only signing secret.
const cacheDir = mkdtempSync(path.join(os.tmpdir(), "uwii-runsig-"));
process.env.UWII_CACHE_DIR = cacheDir;
process.env.UWII_RUN_SECRET = "test-secret-0123456789abcdef0123456789abcdef";
after(() => rmSync(cacheDir, { recursive: true, force: true }));

const ACCOUNT = "rybergh44.near";
const fixtureRun = (): ClassifiedRun => JSON.parse(readFileSync(path.join(process.cwd(), "data", "fixtures", `${ACCOUNT}-2026.classified.json`), "utf8")) as ClassifiedRun;

async function signed(mutate?: (r: ClassifiedRun) => void) {
  const { signRun, slimRun, runSecret } = await import("./run-signing");
  const { openingInputsFromHistory } = await import("../tax/ng/opening");
  const history = JSON.parse(readFileSync(path.join(process.cwd(), "data", "fixtures", `${ACCOUNT}-2026.json`), "utf8"));
  const run = slimRun({ ...fixtureRun(), context: { archivalRpc: "https://archival-rpc.mainnet.near.org", openingInputs: openingInputsFromHistory(history), opening: null } });
  mutate?.(run);
  // Round-trip through JSON, as the browser stores and sends it.
  const wire = JSON.parse(JSON.stringify(run)) as ClassifiedRun;
  return { run: wire, runSig: signRun(wire, runSecret()!) };
}

test("a signed run verifies; a tampered run is rejected", async () => {
  const { checkSignedRun, runSecret } = await import("./run-signing");
  const { run, runSig } = await signed();
  assert.equal(checkSignedRun(ACCOUNT, run, runSig, runSecret()).ok, true);
  const tampered = structuredClone(run);
  tampered.records[0].label = "income_professional_fees";
  const r = checkSignedRun(ACCOUNT, tampered, runSig, runSecret());
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.code, "bad_run_signature");
  assert.equal(!r.ok && r.status, 400);
  // A signature made with another secret is rejected too.
  const other = checkSignedRun(ACCOUNT, run, runSig, "another-secret-0123456789abcdef0123456789");
  assert.equal(!other.ok && other.code, "bad_run_signature");
  // Malformed signatures never reach the comparison.
  assert.equal(checkSignedRun(ACCOUNT, run, "zz", runSecret()).ok, false);
});

test("a run for another account is rejected (400), and live scans need the secret (503)", async () => {
  const { resolveRun } = await import("../api/report-body");
  const { run, runSig } = await signed();
  const r = await resolveRun({ account: "someone-else.near", run: run as unknown as Record<string, unknown>, runSig });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.response.status, 400);
  assert.equal(!r.ok && ((await r.response.json()) as { code: string }).code, "run_account_mismatch");
  const { checkSignedRun } = await import("./run-signing");
  const noSecret = checkSignedRun(ACCOUNT, run, runSig, null);
  assert.equal(!noSecret.ok && noSecret.status, 503);
});

test("no run and no committed fixture: 409 start a scan first; the demo account falls back to its fixture", async () => {
  const { resolveRun } = await import("../api/report-body");
  const r = await resolveRun({ account: "never-scanned.near" });
  assert.equal(!r.ok && r.response.status, 409);
  const demo = await resolveRun({ account: ACCOUNT });
  assert.equal(demo.ok && demo.fixture, true);
});

test("report builds from the signed run with no server cache present", async () => {
  const { buildReport } = await import("../tax/ng/report");
  const { ILLUSTRATIVE_ANSWERS } = await import("../demo/illustrative-answers");
  const { run } = await signed();
  const answers = { groups: ILLUSTRATIVE_ANSWERS.groups };
  const profile = { otherIncomeNgn: ILLUSTRATIVE_ANSWERS.otherIncomeNgn };
  const fromRun = (await buildReport({ account: ACCOUNT, run, answers, profile })).report;
  const fromFixture = (await buildReport({ account: ACCOUNT, classificationSource: "fixture", answers, profile })).report;
  assert.equal(fromRun.status, "final");
  assert.equal(fromRun.tax.taxAttributableToVaNgn, fromFixture.tax.taxAttributableToVaNgn);
  assert.equal(fromRun.fingerprint, fromFixture.fingerprint, "same classification, same fingerprint");
  assert.equal(fromRun.origin.classification, "signed scan from the browser");
  // Nothing was read from or written to a classification cache.
  assert.ok(!readdirSync(cacheDir).some((f) => f.startsWith("classified-")));
});

test("two users' runs of the same account are isolated", async () => {
  const { buildReport } = await import("../tax/ng/report");
  const a = await signed();
  // User B's run differs (one open question already resolved as a gift received); signed like A's.
  let changedId = "";
  const b = await signed((r) => {
    const rec = r.records.find((x) => x.needsQuestion)!;
    changedId = rec.id;
    Object.assign(rec, { label: "gift_received", needsQuestion: false, confidence: 0.95 });
  });
  const first = (await buildReport({ account: ACCOUNT, run: a.run })).report;
  const other = (await buildReport({ account: ACCOUNT, run: b.run })).report;
  const again = (await buildReport({ account: ACCOUNT, run: a.run })).report;
  assert.notEqual(first.fingerprint, other.fingerprint, "B's run gives B's report");
  assert.equal(again.fingerprint, first.fingerprint, "A's report is unchanged after B's request");
  assert.ok(other.lines.some((l) => l.recordId === changedId && l.label === "gift_received"));
  assert.ok(!again.lines.some((l) => l.recordId === changedId && l.label === "gift_received"));
});

test("a scan whose attestation failed never gives a final report", async () => {
  const { reportStatus } = await import("../report/status");
  const base = { records: [], warnings: [], questions: [] };
  assert.equal(reportStatus({ ...base, attestation: { verified: false, aiNeeded: true } }).status, "draft");
  assert.equal(reportStatus({ ...base, attestation: { verified: false, aiNeeded: true } }).draftReasons[0].code, "attestation_unverified");
  assert.equal(reportStatus({ ...base, attestation: { verified: false, aiNeeded: false } }).status, "final", "no AI needed: nothing to attest");
  assert.equal(reportStatus({ ...base, attestation: { verified: true, aiNeeded: true } }).status, "final");
});
