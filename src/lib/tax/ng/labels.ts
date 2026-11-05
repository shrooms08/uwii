/**
 * Tax labels for Nigeria, derived from NRS Information Circular No. 2026/21
 * ("Guidelines on the Taxation of Virtual Assets", 31 July 2026).
 * Decisions behind these treatments: docs/rules-ng-2026-21.md.
 *
 * `circularRef` is always attached from this table in code, never from model output.
 */
import type { Asset } from "../../history/types";

export type Taxable = "income" | "disposal" | "acquisition" | "non_taxable" | "question";

export interface LabelDef {
  id: string;
  treatment: string;
  taxable: Taxable;
  circularRef: string;
}

export const LABEL_IDS = [
  "income_professional_fees",
  "income_employment",
  "income_business",
  "income_staking_reward",
  "income_defi_yield",
  "income_airdrop",
  "airdrop_no_value",
  "disposal_swap",
  "acquisition_swap",
  "disposal_payment",
  "disposal_sale_fiat",
  "disposal_liquidation",
  "acquisition_fiat",
  "own_wallet_transfer",
  "staking_lockup",
  "wrap_unwrap",
  "defi_receipt",
  "loan_collateralised",
  "loan_received",
  "loan_repayment",
  "gift_given",
  "gift_received",
  "gas_refund",
  "round_trip",
  "dust_no_value",
  "storage_deposit",
  "unknown",
] as const;

export type LabelId = (typeof LABEL_IDS)[number];

export const LABELS: Record<LabelId, LabelDef> = {
  income_professional_fees: {
    id: "income_professional_fees",
    treatment: "Virtual assets received as fees for professional/consultancy services: income at FMV on receipt.",
    taxable: "income",
    circularRef: "6.1.1(2)(c); 7.1 event 7; 9.5(3)",
  },
  income_employment: {
    id: "income_employment",
    treatment: "Salary, wages or benefits paid in virtual assets: employment income at FMV on receipt.",
    taxable: "income",
    circularRef: "6.1.1(5); 7.1 event 6",
  },
  income_business: {
    id: "income_business",
    treatment: "Virtual assets received in the course of a trade or business: business income at FMV on receipt.",
    taxable: "income",
    circularRef: "6.1.1(2)(d)",
  },
  income_staking_reward: {
    id: "income_staking_reward",
    treatment: "Staking rewards: income at FMV when received (recognised daily, D3); FMV becomes cost base.",
    taxable: "income",
    circularRef: "7.1 event 9; 9.5(4)",
  },
  income_defi_yield: {
    id: "income_defi_yield",
    treatment: "DeFi yield, liquidity-mining or lending rewards: income at FMV on receipt.",
    taxable: "income",
    circularRef: "7.1 event 14; 10.4",
  },
  income_airdrop: {
    id: "income_airdrop",
    treatment: "Airdrop with ascertainable market value: income at FMV on receipt.",
    taxable: "income",
    circularRef: "7.1 event 10; 9.6(1)-(2)",
  },
  airdrop_no_value: {
    id: "airdrop_no_value",
    treatment: "Airdrop with no ascertainable value (e.g. spam/unlisted): not income on receipt; nil cost base.",
    taxable: "non_taxable",
    circularRef: "9.6(4)-(6)",
  },
  disposal_swap: {
    id: "disposal_swap",
    treatment: "Crypto-to-crypto swap: disposal of the asset given up; proceeds = FMV of asset given up (D1).",
    taxable: "disposal",
    circularRef: "9.1.2; 9.3.2; Illustration 3",
  },
  acquisition_swap: {
    id: "acquisition_swap",
    treatment: "Asset received in a token/token swap; dollar cost base = dollar FMV of asset given up (D1).",
    taxable: "acquisition",
    circularRef: "9.3.2; Illustration 3",
  },
  disposal_payment: {
    id: "disposal_payment",
    treatment: "Using a virtual asset to pay for goods or services: disposal at FMV.",
    taxable: "disposal",
    circularRef: "7.1 event 5",
  },
  disposal_sale_fiat: {
    id: "disposal_sale_fiat",
    treatment: "Sale of a virtual asset for fiat: disposal; gain = proceeds less cost base.",
    taxable: "disposal",
    circularRef: "7.1 events 3-4; 9.1.2",
  },
  disposal_liquidation: {
    id: "disposal_liquidation",
    treatment: "Forced liquidation of a position (e.g. collateral seized): disposal at FMV.",
    taxable: "disposal",
    circularRef: "7.1 event 16",
  },
  acquisition_fiat: {
    id: "acquisition_fiat",
    treatment: "Purchase of a virtual asset with fiat: acquisition; cost base = amount paid.",
    taxable: "acquisition",
    circularRef: "7.1 event 1; 9.3.1",
  },
  own_wallet_transfer: {
    id: "own_wallet_transfer",
    treatment: "Transfer between wallets owned by the same person: no change in beneficial ownership; not taxable.",
    taxable: "non_taxable",
    circularRef: "7.2.2",
  },
  staking_lockup: {
    id: "staking_lockup",
    treatment: "Delegating, unstaking or withdrawing own NEAR with a staking pool: not a disposal.",
    taxable: "non_taxable",
    circularRef: "7.2.3",
  },
  wrap_unwrap: {
    id: "wrap_unwrap",
    treatment: "Wrapping/unwrapping (NEAR <-> wNEAR): same asset for cost-base purposes; not a disposal.",
    taxable: "non_taxable",
    circularRef: "10.1",
  },
  defi_receipt: {
    id: "defi_receipt",
    treatment: "Deposit into a protocol for a receipt/liquid-staking token: not a disposal; accrual taxed on disposal (D4).",
    taxable: "non_taxable",
    circularRef: "10.2",
  },
  loan_collateralised: {
    id: "loan_collateralised",
    treatment: "Posting or recovering loan collateral, or borrowing against it: not a disposal.",
    taxable: "non_taxable",
    circularRef: "7.2.6",
  },
  loan_received: {
    id: "loan_received",
    treatment: "Receipt of loan funds creates a liability, not income.",
    taxable: "non_taxable",
    circularRef: "7.2.6 (by analogy for uncollateralised loans)",
  },
  loan_repayment: {
    id: "loan_repayment",
    treatment: "Repaying a loan settles a liability; not a taxable event in itself.",
    taxable: "non_taxable",
    circularRef: "7.2.6",
  },
  gift_given: {
    id: "gift_given",
    treatment: "Gift made: circular imposes no tax on the donor (D9; possible NTA conflict noted).",
    taxable: "non_taxable",
    circularRef: "7.1 event 15",
  },
  gift_received: {
    id: "gift_received",
    treatment: "Gift received: cost base = market value at receipt (NTA s.36(1), D9).",
    taxable: "acquisition",
    circularRef: "7.1 event 15; NTA s.36(1) market value",
  },
  gas_refund: {
    id: "gas_refund",
    treatment: "Protocol refund of unused gas or a returned deposit: technical, not income.",
    taxable: "non_taxable",
    circularRef: "not income; technical",
  },
  round_trip: {
    id: "round_trip",
    treatment: "Same asset and amount returned within one transaction; no change in beneficial ownership.",
    taxable: "non_taxable",
    circularRef: "Technical; consistent with 7.2.2 (no change in beneficial ownership)",
  },
  dust_no_value: {
    id: "dust_no_value",
    treatment: "Zero or negligible value (< 1000 yocto-units of the asset).",
    taxable: "non_taxable",
    circularRef: "Technical; 9.6(6) (no realisable value)",
  },
  storage_deposit: {
    id: "storage_deposit",
    treatment: "Refundable NEAR storage deposit or its refund; recoverable, not consideration for a supply.",
    taxable: "non_taxable",
    circularRef: "Technical; NEAR storage staking (refundable)",
  },
  unknown: {
    id: "unknown",
    treatment: "Cannot be classified from on-chain data alone: ask the user.",
    taxable: "question",
    circularRef: "question",
  },
};

export const isLabelId = (v: unknown): v is LabelId => typeof v === "string" && (LABEL_IDS as readonly string[]).includes(v);

// ---------- asset categories (circular para 5.0) ----------

export const ASSET_CATEGORY_IDS = ["1", "2", "4", "5", "unknown"] as const;
export type AssetCategory = (typeof ASSET_CATEGORY_IDS)[number];

export const ASSET_CATEGORIES: Record<AssetCategory, string> = {
  "1": "Cryptocurrencies / exchange tokens (e.g. NEAR, BTC, ETH)",
  "2": "Stablecoins (e.g. USDC, USDT, DAI)",
  "4": "Utility / governance / receipt tokens",
  "5": "Non-fungible tokens (NFTs)",
  unknown: "Unknown",
};

/** Contract ids verified on NEAR mainnet (view_account + ft_metadata), 2026-11-05. */
export const CONTRACTS = {
  wNEAR: "wrap.near", // ft_metadata: wNEAR, 24 decimals
  USDC: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", // USDC, 6 decimals
  USDT: "usdt.tether-token.near", // USDt, 6 decimals
  stNEAR: "meta-pool.near", // Meta Pool liquid staking; ft_metadata STNEAR, 24 decimals
  LiNEAR: "linear-protocol.near", // LiNEAR liquid staking; ft_metadata LINEAR, 24 decimals
} as const;

export const LIQUID_STAKING_CONTRACTS = new Set<string>([CONTRACTS.stNEAR, CONTRACTS.LiNEAR]);

/** DEX / swap-router contracts verified on mainnet. */
export const DEX_CONTRACTS = new Map<string, string>([
  ["v2.ref-finance.near", "Rhea (Ref Finance) v2 exchange"], // metadata(): v1.9.21, owner ref-finance.sputnik-dao.near
  ["dclv2.ref-labs.near", "Rhea (Ref Finance) DCL v2"], // get_metadata(): v2.4.1, wnear_id wrap.near
  ["aggregatedex.near", "DeltaTrade DEX aggregator"], // get_owner(): deltatrade.near
]);

const KNOWN_CATEGORY = new Map<string, AssetCategory>([
  [CONTRACTS.wNEAR, "1"],
  [CONTRACTS.USDC, "2"],
  [CONTRACTS.USDT, "2"],
]);

/** Category from the known-contract map: native NEAR and wNEAR -> 1, USDC/USDT -> 2, everything else -> 4. */
export function knownAssetCategory(asset: Asset): AssetCategory {
  if (asset.contract === null) return asset.symbol === "NEAR" ? "1" : "unknown";
  return KNOWN_CATEGORY.get(asset.contract) ?? "4";
}

/** Whether the category is fixed by the map (the AI may only override the default "4"). */
export function isKnownAsset(asset: Asset): boolean {
  return asset.contract === null ? asset.symbol === "NEAR" : KNOWN_CATEGORY.has(asset.contract);
}

/** Cost-base identity: wNEAR is the same asset as NEAR. */
export function costBasisAsset(asset: Asset): string {
  if (asset.contract === null || asset.contract === CONTRACTS.wNEAR) return "NEAR";
  return asset.contract;
}
