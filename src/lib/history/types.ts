export type Direction = "in" | "out" | "self";

export type TxKind =
  | "native_transfer"
  | "ft_transfer"
  | "stake"
  | "unstake"
  | "withdraw_stake"
  | "function_call_with_deposit"
  | "staking_reward"
  | "other";

export interface Fee {
  asset: "NEAR";
  /** Exact decimal NEAR string. */
  amount: string;
}

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
 * returned from the pool to the wallet. `staking_reward` (in) is NEAR earned
 * inside a pool, derived from daily balance snapshots (no on-chain transaction).
 *
 * Fees: `fee` is the NEAR burnt by a transaction SIGNED by the account
 * (gas, from the indexer's per-transaction fee). It is set on exactly one record
 * per signed transaction (the record for the signer's own first receipt) so fees
 * can be summed without double counting; it is null on every other record,
 * including all records of transactions signed by others or by relayers.
 * Fees are paid even when a transaction fails.
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
  fee: Fee | null;
}

/** A pool balance observation at a UTC-midnight boundary. */
export interface PoolSnapshot {
  /** The UTC date whose 00:00 this boundary represents (YYYY-MM-DD). */
  date: string;
  /** Block used for the view call; null when the balance is known to be 0 without querying. */
  block: { height: number; hash: string; timestampNs: string } | null;
  /** get_account_total_balance in yoctoNEAR. */
  totalBalance: string;
  method: "rpc_view" | "known_zero";
}

export interface PoolStakingSummary {
  pool: string;
  /** First staking event with this pool, all-time (ISO). */
  firstInteraction: string;
  start: PoolSnapshot;
  end: PoolSnapshot;
  /** Sums over (start, end] in exact decimal NEAR. */
  deposits: string;
  withdrawals: string;
  rewards: string;
  rewardDays: number;
  /** Days where the derived reward was negative (not emitted). */
  negativeDays: { date: string; amount: string }[];
  /** Boundaries actually queried via archival RPC. */
  queriedSnapshots: number;
}

export interface StakingRewardsInfo {
  pools: PoolStakingSummary[];
  negativeRewardDays: number;
  /** Last UTC midnight with a snapshot; days after it are not yet complete. */
  lastCompleteBoundary: string | null;
  archivalRpc: string;
  blockLookup: string;
}

export const HISTORY_SCHEMA_VERSION = 2;

export interface HistoryResult {
  schemaVersion: number;
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
  staking: StakingRewardsInfo;
}

export const NEAR_ASSET: Asset = { symbol: "NEAR", contract: null, decimals: 24 };
