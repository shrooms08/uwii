import assert from "node:assert/strict";
import { test } from "node:test";
import { handleAnchor, handleVerify, type AnchorDeps } from "../api/anchor-handlers";
import { ILLUSTRATIVE_ANSWERS } from "../demo/illustrative-answers";
import { buildReport } from "../tax/ng/report";
import { anchorArgs, anchorConfig, anchorFingerprint, keyPermissionProblem, verifyFingerprint, type AnchorClient, type AnchorConfig, type ContractAnchor } from "./anchor";

const FP = "a4a1c78044e9c3c21602267480350e7b9cce3fdaf8fdcedfc6e03992f1a994df";
const cfg: AnchorConfig = {
  network: "testnet",
  contractId: "uwii-anchor.testnet",
  accountId: "uwii-anchor.testnet",
  privateKey: "ed25519:not-a-real-key",
  rpcUrls: ["https://rpc.invalid"],
  archivalRpcUrls: ["https://archival.invalid"],
  explorerBase: "https://nearvalidate.org",
};
const stored = (fingerprint: string): ContractAnchor => ({
  fingerprint,
  status: "final",
  anchored_at_ns: "1762389000123000000",
  block_height: "220000123",
  anchored_by: "uwii-anchor.testnet",
});

/** In-memory contract + chain: records every call so tests can inspect what would go on-chain. */
function mockChain(opts: { anchored?: string[]; blockOnlyOnArchival?: boolean } = {}) {
  const anchors = new Map<string, ContractAnchor>((opts.anchored ?? []).map((f) => [f, stored(f)]));
  const calls: { method: string; args: Record<string, unknown> }[] = [];
  const rpcCalls: { method: string; archival: boolean }[] = [];
  const client: AnchorClient = {
    async view(method, args) {
      assert.equal(method, "get_anchor");
      return anchors.get(String(args.fingerprint)) ?? null;
    },
    async call(method, args) {
      calls.push({ method, args });
      const fp = String(args.fingerprint);
      if (anchors.has(fp)) throw new Error("Smart contract panicked: fingerprint already anchored");
      anchors.set(fp, stored(fp));
      return { txHash: "NewTxHash111", result: stored(fp) };
    },
    async rpc(method, params, archival = false) {
      rpcCalls.push({ method, archival });
      if (opts.blockOnlyOnArchival && !archival) throw new Error("NEAR RPC block: UNKNOWN_BLOCK");
      if (method === "block") return { chunks: [{ chunk_hash: "c0" }, { chunk_hash: "c1" }] };
      if (method === "chunk") {
        const id = (params as { chunk_id: string }).chunk_id;
        if (id === "c0") return { transactions: [{ hash: "OtherTx", signer_id: "x.testnet", receiver_id: "y.testnet", actions: [] }] };
        const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
        return {
          transactions: [
            { hash: "WrongFp", signer_id: "uwii-anchor.testnet", receiver_id: "uwii-anchor.testnet", actions: [{ FunctionCall: { method_name: "anchor", args: b64({ fingerprint: "0".repeat(64), status: "final" }) } }] },
            { hash: "TheAnchorTx", signer_id: "uwii-anchor.testnet", receiver_id: "uwii-anchor.testnet", actions: [{ FunctionCall: { method_name: "anchor", args: b64({ fingerprint: FP, status: "final" }) } }] },
          ],
        };
      }
      throw new Error(`unexpected rpc ${method}`);
    },
  };
  return { client, calls, rpcCalls, anchors };
}

const post = (body: unknown) => new Request("http://localhost/api/anchor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("/api/anchor refuses a draft report and never touches the chain", async () => {
  const chain = mockChain();
  const deps: AnchorDeps = { build: buildReport, config: () => cfg, client: () => chain.client };
  const res = await handleAnchor(post({ account: "rybergh44.near" }), deps);
  assert.equal(res.status, 409);
  const json = (await res.json()) as { error: string; status: string; draftReasons: string[] };
  assert.equal(json.status, "draft");
  assert.match(json.error, /Only final reports can be anchored/);
  assert.ok(json.draftReasons.includes("unresolved_records"));
  assert.equal(chain.calls.length, 0);
});

test("/api/anchor anchors a final report: only the fingerprint and status go on-chain", async () => {
  const chain = mockChain();
  const deps: AnchorDeps = { build: buildReport, config: () => cfg, client: () => chain.client };
  const res = await handleAnchor(
    post({ account: "rybergh44.near", answers: { groups: ILLUSTRATIVE_ANSWERS.groups }, profile: { otherIncomeNgn: ILLUSTRATIVE_ANSWERS.otherIncomeNgn } }),
    deps,
  );
  assert.equal(res.status, 200);
  const json = (await res.json()) as { fingerprint: string; txHash: string; blockHeight: string; anchoredAt: string; explorerUrl: string; alreadyAnchored: boolean };
  assert.match(json.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(json.txHash, "NewTxHash111");
  assert.equal(json.blockHeight, "220000123");
  assert.equal(json.anchoredAt, "2025-11-06T00:30:00.123Z");
  assert.equal(json.explorerUrl, "https://nearvalidate.org/txns/NewTxHash111?network=testnet");
  assert.equal(json.alreadyAnchored, false);
  assert.equal(chain.calls.length, 1);
  assert.equal(chain.calls[0].method, "anchor");
  assert.deepEqual(Object.keys(chain.calls[0].args).sort(), ["fingerprint", "status"]);
  assert.deepEqual(chain.calls[0].args, { fingerprint: json.fingerprint, status: "final" });
  // Nothing from the request (answers, naira amounts, other income) is in the payload.
  const payload = JSON.stringify(chain.calls[0].args);
  for (const secretish of ["180000", "4800000", "p2p_buy", "rybergh44.near"]) assert.ok(!payload.includes(secretish), secretish);
});

test("anchorArgs validates and returns exactly { fingerprint, status }", () => {
  assert.deepEqual(anchorArgs(FP), { fingerprint: FP, status: "final" });
  assert.throws(() => anchorArgs(FP.toUpperCase()));
  assert.throws(() => anchorArgs(FP.slice(1)));
});

test("already anchored: the existing anchor is returned (with its tx) instead of failing", async () => {
  const chain = mockChain({ anchored: [FP] });
  const { anchor, alreadyAnchored } = await anchorFingerprint(chain.client, cfg, FP);
  assert.equal(alreadyAnchored, true);
  assert.equal(chain.calls.length, 0, "no second transaction");
  assert.equal(anchor.txHash, "TheAnchorTx");
});

test("verify: anchored fingerprint returns time, block and the located tx; unknown one is not anchored", async () => {
  const chain = mockChain({ anchored: [FP] });
  const yes = await verifyFingerprint(chain.client, cfg, FP);
  assert.ok(yes.anchored);
  if (yes.anchored) {
    assert.equal(yes.anchor.blockHeight, "220000123");
    assert.equal(yes.anchor.anchoredAt, "2025-11-06T00:30:00.123Z");
    assert.equal(yes.anchor.txHash, "TheAnchorTx", "matched by method and fingerprint, not just by signer");
    assert.equal(yes.anchor.explorerUrl, "https://nearvalidate.org/txns/TheAnchorTx?network=testnet");
    assert.equal(yes.anchor.blockUrl, "https://nearvalidate.org/blocks/220000123?network=testnet");
  }
  const no = await verifyFingerprint(chain.client, cfg, "f".repeat(64));
  assert.deepEqual(no, { anchored: false });
});

test("verify falls back to the archival RPC for old blocks", async () => {
  const chain = mockChain({ anchored: [FP], blockOnlyOnArchival: true });
  const r = await verifyFingerprint(chain.client, cfg, FP);
  assert.ok(r.anchored && r.anchor.txHash === "TheAnchorTx");
  assert.ok(chain.rpcCalls.some((c) => c.archival));
});

test("/api/verify validates input and reports anchored / not anchored", async () => {
  const chain = mockChain({ anchored: [FP] });
  const deps = { config: () => cfg, client: () => chain.client };
  assert.equal((await handleVerify("not-hex", deps)).status, 400);
  const a = (await (await handleVerify(FP.toUpperCase(), deps)).json()) as { anchored: boolean; anchor?: { txHash: string } };
  assert.equal(a.anchored, true);
  assert.equal(a.anchor?.txHash, "TheAnchorTx");
  const b = (await (await handleVerify("0123456789abcdef".repeat(4), deps)).json()) as { anchored: boolean };
  assert.equal(b.anchored, false);
});

test("anchorConfig is testnet-only and reads names, never requiring a key for verify", () => {
  assert.equal(anchorConfig({}), null);
  assert.throws(() => anchorConfig({ NEAR_NETWORK: "mainnet", NEAR_ANCHOR_CONTRACT_ID: "x.near" }), /testnet/);
  const c = anchorConfig({ NEAR_ANCHOR_CONTRACT_ID: "uwii-anchor.testnet" })!;
  assert.equal(c.privateKey, null);
  assert.equal(c.contractId, "uwii-anchor.testnet");
});

test("verify page CSV reading: summary CSV states the fingerprint; lines CSV has none; others are rejected", async () => {
  const { readUwiiCsv } = await import("../report/csv-read");
  const { linesCsv, summaryCsv } = await import("../report/csv");
  const { report } = await buildReport({ account: "rybergh44.near" });
  assert.deepEqual(readUwiiCsv(summaryCsv(report)), { kind: "summary", fingerprint: report.fingerprint });
  assert.deepEqual(readUwiiCsv(linesCsv(report)), { kind: "lines", rows: report.lines.length });
  assert.deepEqual(readUwiiCsv("a,b\n1,2\n"), { kind: "unknown" });
});

test("H2: the server signs only with a function-call key limited to anchor() on the anchor contract", () => {
  const fc = (receiver_id: string, method_names: string[]) => ({ FunctionCall: { allowance: "1000000000000000000000000", receiver_id, method_names } });
  assert.match(keyPermissionProblem("FullAccess", "uwii-anchor.testnet", "anchor")!, /full-access/);
  assert.equal(keyPermissionProblem(fc("uwii-anchor.testnet", ["anchor"]), "uwii-anchor.testnet", "anchor"), null);
  assert.match(keyPermissionProblem(fc("other.testnet", ["anchor"]), "uwii-anchor.testnet", "anchor")!, /not uwii-anchor\.testnet/);
  assert.match(keyPermissionProblem(fc("uwii-anchor.testnet", []), "uwii-anchor.testnet", "anchor")!, /limited to anchor/, "an empty list allows every method");
  assert.match(keyPermissionProblem(fc("uwii-anchor.testnet", ["new"]), "uwii-anchor.testnet", "anchor")!, /limited to anchor/);
});
