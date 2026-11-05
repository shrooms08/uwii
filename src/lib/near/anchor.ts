/**
 * Report fingerprint anchoring on NEAR testnet (contracts/anchor). Server-side only: signing uses
 * NEAR_ANCHOR_PRIVATE_KEY from .env.local. Only the fingerprint and the status "final" go on-chain.
 *
 * The client is injectable so tests can mock the RPC. Nothing here logs.
 */
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPairSigner, getTransactionLastResult, teraToGas, type KeyPairString } from "near-api-js";

export const FINGERPRINT_RE = /^[0-9a-f]{64}$/;

/** As stored by the contract (U64 values arrive as decimal strings). */
export interface ContractAnchor {
  fingerprint: string;
  status: string;
  anchored_at_ns: string;
  block_height: string;
  anchored_by: string;
}

export interface AnchorInfo {
  fingerprint: string;
  status: string;
  network: string;
  contractId: string;
  anchoredBy: string;
  blockHeight: string;
  /** ISO time of the block that recorded the anchor. */
  anchoredAt: string;
  /** null if the transaction could not be located (the anchor itself is still proven by get_anchor). */
  txHash: string | null;
  explorerUrl: string | null;
  blockUrl: string;
}

export interface AnchorConfig {
  network: "testnet";
  contractId: string;
  accountId: string | null;
  privateKey: string | null;
  /** Primary first, fallbacks after. */
  rpcUrls: string[];
  archivalRpcUrls: string[];
  explorerBase: string;
}

/** The chain operations the app needs; the real implementation wraps near-api-js and JSON-RPC. */
export interface AnchorClient {
  view(method: string, args: Record<string, unknown>): Promise<unknown>;
  call(method: string, args: Record<string, unknown>): Promise<{ txHash: string; result: unknown }>;
  /** JSON-RPC passthrough (block / chunk lookups), archival when asked. */
  rpc(method: string, params: unknown, archival?: boolean): Promise<unknown>;
}

/**
 * FastNEAR first: rpc.testnet.near.org is deprecated and answers 429 "STOP USING IT" (Nov 2026); it is
 * kept only as a fallback. See https://docs.near.org/api/rpc/providers.
 */
const DEFAULT_RPCS = ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"];
const DEFAULT_ARCHIVAL_RPCS = ["https://archival-rpc.testnet.fastnear.com", "https://archival-rpc.testnet.near.org"];
/**
 * Testnet explorer for links. Near Validate (by NearBlocks) reads the chain directly; the
 * testnet.nearblocks.io indexer was ~6M blocks behind the chain head when this was written (Nov 2026).
 */
const EXPLORER = "https://nearvalidate.org";
export const explorerTxUrl = (base: string, hash: string) => `${base}/txns/${hash}?network=testnet`;
export const explorerBlockUrl = (base: string, height: string) => `${base}/blocks/${height}?network=testnet`;

/** Reads configuration from the environment. Testnet only; anything else is refused. */
export function anchorConfig(env: Record<string, string | undefined> = process.env): AnchorConfig | null {
  const network = env.NEAR_NETWORK ?? "testnet";
  if (network !== "testnet") throw new Error(`NEAR_NETWORK must be "testnet" (got "${network}")`);
  const contractId = env.NEAR_ANCHOR_CONTRACT_ID?.trim();
  if (!contractId) return null;
  return {
    network: "testnet",
    contractId,
    accountId: env.NEAR_ANCHOR_ACCOUNT_ID?.trim() || null,
    privateKey: env.NEAR_ANCHOR_PRIVATE_KEY?.trim() || null,
    rpcUrls: env.NEAR_TESTNET_RPC_URL?.trim() ? [env.NEAR_TESTNET_RPC_URL.trim()] : DEFAULT_RPCS,
    archivalRpcUrls: env.NEAR_TESTNET_ARCHIVAL_RPC_URL?.trim() ? [env.NEAR_TESTNET_ARCHIVAL_RPC_URL.trim()] : DEFAULT_ARCHIVAL_RPCS,
    explorerBase: EXPLORER,
  };
}

/** Transport or rate-limit failures move on to the next endpoint; RPC answers (e.g. UNKNOWN_BLOCK) do not. */
class TransportError extends Error {}

async function jsonRpcOnce(url: string, method: string, params: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "uwii", method, params }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new TransportError(`NEAR RPC ${method}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new TransportError(`NEAR RPC ${method}: HTTP ${res.status}`);
  const j = (await res.json()) as { result?: unknown; error?: { code?: number; message?: string; data?: unknown; cause?: { name?: string } } };
  if (j.error?.code === -429) throw new TransportError(`NEAR RPC ${method}: rate limited`);
  if (j.error) throw new Error(`NEAR RPC ${method}: ${j.error.cause?.name ?? j.error.message ?? "error"}${typeof j.error.data === "string" ? ` (${j.error.data})` : ""}`);
  return j.result;
}

export async function jsonRpc(urls: string[], method: string, params: unknown): Promise<unknown> {
  let last: unknown = new Error(`NEAR RPC ${method}: no endpoint configured`);
  for (const url of urls) {
    try {
      return await jsonRpcOnce(url, method, params);
    } catch (e) {
      if (!(e instanceof TransportError)) throw e;
      last = e;
    }
  }
  throw last;
}

/** near-api-js provider over the configured endpoints (failover in order). */
export function nearProvider(cfg: AnchorConfig): FailoverRpcProvider {
  return new FailoverRpcProvider(cfg.rpcUrls.map((url) => new JsonRpcProvider({ url })));
}

/** near-api-js backed client. Signing is only possible when the account id and key are configured. */
export function nearAnchorClient(cfg: AnchorConfig): AnchorClient {
  const provider = nearProvider(cfg);
  return {
    view: (method, args) => provider.callFunction({ contractId: cfg.contractId, method, args }),
    async call(method, args) {
      if (!cfg.accountId || !cfg.privateKey) throw new Error("anchoring account is not configured on this server");
      const account = new Account(cfg.accountId, provider, KeyPairSigner.fromSecretKey(cfg.privateKey as KeyPairString));
      const outcome = await account.callFunctionRaw({ contractId: cfg.contractId, methodName: method, args, gas: teraToGas("30"), waitUntil: "FINAL" });
      return { txHash: outcome.transaction_outcome.id, result: getTransactionLastResult(outcome) };
    },
    rpc: (method, params, archival) => jsonRpc(archival ? cfg.archivalRpcUrls : cfg.rpcUrls, method, params),
  };
}

/** The exact arguments sent to anchor(): the fingerprint and the status, nothing else. */
export function anchorArgs(fingerprint: string): { fingerprint: string; status: "final" } {
  if (!FINGERPRINT_RE.test(fingerprint)) throw new Error("fingerprint must be 64 lowercase hex characters");
  return { fingerprint, status: "final" };
}

const nsToIso = (ns: string) => new Date(Number(BigInt(ns) / BigInt(1_000_000))).toISOString();

function toInfo(cfg: AnchorConfig, a: ContractAnchor, txHash: string | null): AnchorInfo {
  return {
    fingerprint: a.fingerprint,
    status: a.status,
    network: cfg.network,
    contractId: cfg.contractId,
    anchoredBy: a.anchored_by,
    blockHeight: a.block_height,
    anchoredAt: nsToIso(a.anchored_at_ns),
    txHash,
    explorerUrl: txHash ? explorerTxUrl(cfg.explorerBase, txHash) : null,
    blockUrl: explorerBlockUrl(cfg.explorerBase, a.block_height),
  };
}

interface RpcBlock {
  chunks: { chunk_hash: string }[];
}
interface RpcChunk {
  transactions: { hash: string; signer_id: string; receiver_id: string; actions: unknown[] }[];
}

/**
 * The anchor transaction for a stored anchor. anchor() is a call from the contract account to itself,
 * so its receipt executes in the block that includes the transaction: that block's chunks hold it.
 */
export async function findAnchorTx(client: AnchorClient, cfg: AnchorConfig, a: ContractAnchor): Promise<string | null> {
  const height = Number(a.block_height);
  for (const archival of [false, true]) {
    try {
      const block = (await client.rpc("block", { block_id: height }, archival)) as RpcBlock;
      for (const c of block.chunks) {
        const chunk = (await client.rpc("chunk", { chunk_id: c.chunk_hash }, archival)) as RpcChunk;
        for (const tx of chunk.transactions) {
          if (tx.receiver_id !== cfg.contractId || tx.signer_id !== a.anchored_by) continue;
          for (const act of tx.actions) {
            const fc = (act as { FunctionCall?: { method_name: string; args: string } }).FunctionCall;
            if (fc?.method_name !== "anchor") continue;
            try {
              const args = JSON.parse(Buffer.from(fc.args, "base64").toString("utf8")) as { fingerprint?: string };
              if (args.fingerprint === a.fingerprint) return tx.hash;
            } catch {
              // not JSON: not ours
            }
          }
        }
      }
      return null;
    } catch {
      // block no longer on the regular RPC: try the archival node
    }
  }
  return null;
}

/** Read-only check: the anchor for a fingerprint, with its transaction when it can be located. */
export async function verifyFingerprint(client: AnchorClient, cfg: AnchorConfig, fingerprint: string): Promise<{ anchored: false } | { anchored: true; anchor: AnchorInfo }> {
  if (!FINGERPRINT_RE.test(fingerprint)) throw new Error("fingerprint must be 64 lowercase hex characters");
  const a = (await client.view("get_anchor", { fingerprint })) as ContractAnchor | null;
  if (!a) return { anchored: false };
  return { anchored: true, anchor: toInfo(cfg, a, await findAnchorTx(client, cfg, a)) };
}

/**
 * Anchor a final report's fingerprint. Returns the existing anchor when the fingerprint is already
 * on-chain (including when a concurrent request anchored it first).
 */
export async function anchorFingerprint(client: AnchorClient, cfg: AnchorConfig, fingerprint: string): Promise<{ anchor: AnchorInfo; alreadyAnchored: boolean }> {
  const args = anchorArgs(fingerprint);
  const existing = await verifyFingerprint(client, cfg, fingerprint);
  if (existing.anchored) return { anchor: existing.anchor, alreadyAnchored: true };
  try {
    const { txHash, result } = await client.call("anchor", args);
    return { anchor: toInfo(cfg, result as ContractAnchor, txHash), alreadyAnchored: false };
  } catch (e) {
    if (e instanceof Error && /already anchored/.test(e.message)) {
      const again = await verifyFingerprint(client, cfg, fingerprint);
      if (again.anchored) return { anchor: again.anchor, alreadyAnchored: true };
    }
    throw e;
  }
}
