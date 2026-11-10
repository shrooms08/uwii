/** Opening-position constants and types (D11), with no Node imports (shared by server and browser). */
import type { Asset } from "../../history/types";

export const OPENING_YEAR = 2026;
export const RESET_PRICE_TIME = "2025-12-31T23:59:59.000Z";

export interface OpeningBalance {
  asset: Asset;
  /** Exact decimal quantity. */
  qty: string;
  source: string;
}

export interface OpeningPosition {
  schemaVersion: 1;
  accountId: string;
  date: string;
  block: { height: number; hash: string; timestampNs: string };
  accountExisted: boolean;
  balances: OpeningBalance[];
  fetchedAt: string;
  method: string;
}

/** What the opening position needs from the history (small enough to travel inside a signed run). */
export interface OpeningInputs {
  accountId: string;
  /** Token assets seen in the history (contract, symbol, decimals). */
  tokens: Asset[];
  /** Staking pools with their balance at the first snapshot of the year. */
  stakingStarts: { pool: string; date: string; totalBalance: string; blockHeight: number | null }[];
}
