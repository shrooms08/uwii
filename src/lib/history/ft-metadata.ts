/**
 * Authoritative NEP-148 `ft_metadata` lookup via public NEAR mainnet RPC (no key).
 * Used to confirm token decimals/symbol rather than trusting the indexer alone.
 */
import type { ProgressFn } from "./nearblocks";
import { sanitizeSymbol } from "./sanitize";

const RPC_URLS = ["https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org"];
const RPC_TIMEOUT_MS = 15_000;

export interface FtMeta {
  symbol: string;
  decimals: number;
  /** Where the metadata came from. */
  origin: "rpc" | "indexer";
}

async function rpcFtMetadata(contract: string): Promise<{ symbol: string; decimals: number } | null> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: "uwii",
    method: "query",
    params: {
      request_type: "call_function",
      finality: "final",
      account_id: contract,
      method_name: "ft_metadata",
      args_base64: Buffer.from("{}").toString("base64"),
    },
  });
  for (const url of RPC_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
        cache: "no-store",
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { result?: { result?: number[] }; error?: unknown };
      // A contract-level error (no such method / deleted account) won't change on another RPC node.
      if (json.error || !json.result?.result) return null;
      const meta = JSON.parse(Buffer.from(json.result.result).toString("utf8")) as { symbol?: unknown; decimals?: unknown };
      if (typeof meta.decimals !== "number" || !Number.isInteger(meta.decimals) || meta.decimals < 0) return null;
      return { symbol: sanitizeSymbol(meta.symbol), decimals: meta.decimals };
    } catch {
      // try next RPC
    }
  }
  return null;
}

/**
 * Resolve metadata for each contract: on-chain first, indexer metadata as fallback.
 * Throws if neither source gives valid decimals, since amounts can't be formatted exactly without them.
 */
export async function resolveFtMetadata(
  indexerMeta: Map<string, { symbol?: unknown; decimals?: unknown }>,
  onProgress?: ProgressFn,
): Promise<Map<string, FtMeta>> {
  const out = new Map<string, FtMeta>();
  for (const [contract, fallback] of indexerMeta) {
    const onChain = await rpcFtMetadata(contract);
    if (onChain) {
      if (typeof fallback.decimals === "number" && fallback.decimals !== onChain.decimals) {
        onProgress?.(`  ${contract}: indexer decimals ${fallback.decimals} != on-chain ${onChain.decimals}; using on-chain`);
      }
      out.set(contract, { ...onChain, origin: "rpc" });
      continue;
    }
    if (typeof fallback.decimals === "number" && Number.isInteger(fallback.decimals) && fallback.decimals >= 0) {
      out.set(contract, {
        symbol: sanitizeSymbol(fallback.symbol),
        decimals: fallback.decimals,
        origin: "indexer",
      });
      continue;
    }
    throw new Error(`No usable ft_metadata decimals for ${contract} from RPC or indexer`);
  }
  return out;
}
