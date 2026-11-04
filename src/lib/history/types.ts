export type Direction = "in" | "out" | "self";

export type TxKind =
  | "native_transfer"
  | "ft_transfer"
  | "stake"
  | "unstake"
  | "withdraw_stake"
  | "function_call_with_deposit"
  | "other";

export interface Asset {
  symbol: string;
  /** NEP-141 contract account, or null for native NEAR. */
  contract: string | null;
  decimals: number;
}

/**
 * One balance-relevant event for the queried account.
 *
 * Direction is from the queried account's point of view:
 * - "in" / "out": value moved into / out of the account's wallet balance.
 * - "self": no wallet movement to or from a third party. Used for actions on the
 *   account itself and for staking-pool bookkeeping that leaves funds at the pool
 *   (a standalone `stake` of already-deposited funds, and `unstake`).
 *
 * Staking: `stake` (out) is NEAR deposited to a pool, `unstake` (self) moves
 * staked NEAR to the pool's unstaked balance, `withdraw_stake` (in) is NEAR
 * returned from the pool to the wallet.
 */
export interface NormalizedTx {
  id: string;
  txHash: string;
  /** ISO 8601 UTC. */
  timestamp: string;
  direction: Direction;
  kind: TxKind;
  asset: Asset;
  /** Exact, non-negative decimal string in whole units of `asset` (e.g. "1.5" NEAR). Never a float. */
  amount: string;
  counterparty: string | null;
  method: string | null;
  success: boolean;
  source: string;
  raw: unknown;
}

export interface HistoryResult {
  accountId: string;
  /** Inclusive range start as given by the caller. */
  from: string;
  /** Inclusive range end as given by the caller. */
  to: string;
  /** Resolved [startNs, endNs) bounds used against block timestamps. */
  rangeNs: { start: string; endExclusive: string };
  fetchedAt: string;
  source: string;
  records: NormalizedTx[];
}

export const NEAR_ASSET: Asset = { symbol: "NEAR", contract: null, decimals: 24 };
