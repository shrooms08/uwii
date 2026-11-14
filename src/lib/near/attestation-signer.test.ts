/**
 * Response-signer matching (provider_tee): NEAR AI Cloud can serve one model from several attested
 * machines that share a signing key. The signer is accepted only if at least one model report names it
 * and every report naming it passed all its checks.
 */
process.env.NEAR_AI_API_KEY ??= "test-key-not-real";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, test } from "node:test";
import { Wallet } from "ethers";
import { matchProviderSigner, verifyResponse, type Preflight, type ReportVerification } from "./attestation";

const ALGO = "ecdsa";
const wallet = Wallet.createRandom();
const other = Wallet.createRandom();
const addr = (w: { address: string }) => Buffer.from(w.address.slice(2), "hex");
const report = (label: string, signer: string, ok = true, signingAlgo = ALGO): ReportVerification => ({ label, ok, signingAddress: signer, signingAlgo, checks: [], summary: {} });

test("signer shared by 3 verified model reports: accepted, and every report is listed", () => {
  const r = matchProviderSigner([report("model #1", wallet.address), report("model #2", wallet.address), report("model #3", wallet.address)], ALGO, addr(wallet));
  assert.equal(r.ok, true);
  assert.equal(r.detail, "provider_tee signer bound to 3 verified model reports (model #1, model #2, model #3)");
});

test("signer shared by 3 reports, one of which failed a check: rejected", () => {
  const r = matchProviderSigner([report("model #1", wallet.address), report("model #2", wallet.address, false), report("model #3", wallet.address)], ALGO, addr(wallet));
  assert.equal(r.ok, false);
  assert.match(r.detail, /named by 1 model report\(s\) that did not pass every check \(model #2\)/);
  // A report naming the signer under another algorithm also counts against it.
  assert.equal(matchProviderSigner([report("model #1", wallet.address), report("model #2", wallet.address, true, "ed25519")], ALGO, addr(wallet)).ok, false);
});

test("signer named by no model report: rejected", () => {
  const r = matchProviderSigner([report("model #1", other.address), report("model #2", other.address)], ALGO, addr(wallet));
  assert.deepEqual(r, { ok: false, detail: "signer matches no verified model report" });
  assert.equal(matchProviderSigner([], ALGO, addr(wallet)).ok, false);
});

test("single-report cases are unchanged: one verified report is accepted, a failed one is not", () => {
  assert.deepEqual(matchProviderSigner([report("model #1", wallet.address), report("model #2", other.address)], ALGO, addr(wallet)), { ok: true, detail: "provider_tee signer = verified model #1" });
  assert.equal(matchProviderSigner([report("model #1", wallet.address, false)], ALGO, addr(wallet)).ok, false);
});

// ---------- end to end through verifyResponse, with a real EIP-191 signature ----------

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

async function verifyWith(models: ReportVerification[], signer: { address: string; signMessage(m: string): Promise<string> }) {
  const model = "z-ai/glm-5.3-flash";
  const exchange = { url: "https://cloud-api.near.ai/v1/chat/completions", requestBody: '{"q":1}', responseBody: '{"a":2}', status: 200 };
  const hash = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
  const text = `${model}:${hash(exchange.requestBody)}:${hash(exchange.responseBody)}`;
  const signature = await signer.signMessage(text);
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ text, signature, signing_address: signer.address, signing_algo: ALGO, signature_kind: "provider_tee" }), { status: 200 })) as typeof fetch;
  const preflight: Preflight = { model, nonce: "00".repeat(32), gateway: null, models, checks: [] };
  return verifyResponse(preflight, { chatId: "chat-1", ...exchange });
}

test("verifyResponse: a response signed by a key shared by 3 verified reports verifies; one failed report or an unknown signer does not", async () => {
  const ok = await verifyWith([report("model #1", wallet.address), report("model #2", wallet.address), report("model #3", wallet.address)], wallet);
  assert.ok(ok.checks.every((c) => c.ok), JSON.stringify(ok.checks.filter((c) => !c.ok)));
  assert.equal(ok.checks.at(-1)?.detail, "provider_tee signer bound to 3 verified model reports (model #1, model #2, model #3)");

  const oneFailed = await verifyWith([report("model #1", wallet.address), report("model #2", wallet.address, false), report("model #3", wallet.address)], wallet);
  assert.equal(oneFailed.checks.at(-1)?.ok, false);
  assert.equal(oneFailed.checks.at(-1)?.step, "response signature");

  const unknown = await verifyWith([report("model #1", other.address)], wallet);
  assert.equal(unknown.checks.at(-1)?.ok, false);
  assert.match(unknown.checks.at(-1)!.detail, /no verified model report/);
});
