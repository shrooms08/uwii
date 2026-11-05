# Uwii decision log — Nigeria, NRS Information Circular No. 2026/21

Source: NRS Information Circular No. 2026/21, "Guidelines on the Taxation of Virtual Assets" (31 July 2026).
Scope: individuals only. Label table: `src/lib/tax/ng/labels.ts` (each label carries its circular reference).

Status key: **Accepted** = implemented or binding on later phases; **Open** = pending confirmation.

## D1 — Swap proceeds valued at FMV of the asset given up (Accepted)
- A crypto-to-crypto swap is a disposal of the asset given up. Proceeds = fair market value of the asset **given up**
  at the time of the swap (para 9.3.2; Illustration 3). The FMV becomes the cost base of the asset received.
- Inconsistency flagged: para 9.1.2 Step 2(b) words proceeds as the value of the asset **received**. In an
  arm's-length swap the two are close but not equal (fees, slippage).
- Implementation: store **both** values (FMV given up and FMV received) for every swap so the report can show the
  difference. Swap legs are paired by `pairingId` (`swap:<txHash>`) with `swapRole` disposed/acquired.

## D2 — Gas fees (Accepted)
- Each gas payment in NEAR is a disposal of NEAR (para 7.1 event 5: using a virtual asset to pay for a service).
- Gas is not deductible against gains. Fees are shown separately in the report.
- Data: `fee` on exactly one record per transaction signed by the account (Phase 2b). Protocol refunds from
  `system` are `gas_refund` (not income).

## D3 — Native staking rewards recognised daily on receipt (Accepted)
- Staking rewards are income when received (para 7.1 event 9; 9.5(4)). Rewards accrue in the pool without a
  transaction, so they are recognised per UTC day from pool balance snapshots (`staking_reward` records, Phase 2b).
- FMV at recognition is the cost base of the rewarded NEAR.

## D4 — Liquid staking tokens (Accepted)
- Depositing NEAR for a liquid-staking token (stNEAR from `meta-pool.near`, LiNEAR from `linear-protocol.near`) is a
  deposit for a receipt token (para 10.2): `defi_receipt`, not a disposal.
- The token's value accrual is not income as it accrues; it is taxed as gain on disposal/redemption.

## D5 — Cost method: FIFO (Accepted)
- First-in, first-out per asset (para 9.3.3(3)). wNEAR is the same asset as NEAR for cost-base purposes.

## D6 — Personal income tax bands (Accepted)
Annual chargeable income (NGN):

| Band | Rate |
| --- | --- |
| First 800,000 | 0% |
| Next 2,200,000 | 15% |
| Next 9,000,000 | 18% |
| Next 13,000,000 | 21% |
| Next 25,000,000 | 23% |
| Above 50,000,000 | 25% |

- Optional user input "other income" (non-crypto) so the report can apply the correct marginal rate.

## D7 — Prices (Accepted)
- CoinGecko historical prices until NRS publishes its approved aggregator list (para 9.2(2)).

## D8 — FX (Accepted)
- USD to NGN at the CBN / NAFEM closing rate on the transaction date.

## D9 — Gifts (Accepted)
- Gift received: cost base = market value at receipt (NTA s.36(1)).
- Gift given: the circular imposes no tax on the donor (para 7.1 event 15).
- Possible conflict: commentary on the Nigeria Tax Act treats a gift as a disposal by the donor at market value.
  Flagged; `gift_given` is labelled non-taxable per the circular and called out in the report.

## D10 — VAT on professional fees (Accepted, out of scope)
- VAT on professional fees received in virtual assets is out of MVP scope. The report will note it.

## D11 — Pre-2026 holdings cost-base reset (Decided)
- For any unit acquired before 1 January 2026, the dollar cost base used in 2026+ disposals = the **HIGHER** of
  (a) the original dollar cost base, or (b) the dollar FMV at 31 December 2025 23:59:59 UTC.
- Basis: the Nigeria Tax Act 2025 is silent on a formal reset; the Presidential Fiscal Policy and Tax Reforms
  Committee (Taiwo Oyedele) publicly clarified that gains accrued up to 31 December 2025 are grandfathered on this
  basis. Pending a citable paragraph in the General Transition Guidelines for the Tax Acts 2025.
- The report must show **BOTH** the reset gain and the no-reset gain for affected disposals, with this note.
- Computation is implemented in Phase 5; this entry records the decision only.

## D12 — Technical non-taxable labels and post-AI consistency guards (Accepted)
Three deterministic labels for movements that are mechanics of the NEAR protocol, not economic events. They run
before the AI and before swap pairing (order: dust, round trip, storage deposit), so the model never sees them.
- `round_trip` — within one transaction an outgoing and an incoming leg of the **same asset** (same contract, or
  both native NEAR) with the **same exact amount**, matched one-to-one (e.g. a failed swap that refunds its input).
  Beneficial ownership never changes, so there is no disposal (consistent with 7.2.2). Takes precedence over swap
  pairing so a refunded input cannot become a false `disposal_swap`.
- `dust_no_value` — amount is zero or below 1,000 smallest units of the asset (1,000 yoctoNEAR; 0.001 USDC). Covers
  the 1-yoctoNEAR security deposit required by `ft_transfer`/`ft_transfer_call` and zero-value relayer or harvest
  call legs. No realisable value (9.6(6)). Never applied to `staking_reward` (D3: every reward is income).
- `storage_deposit` — NEAR attached to `storage_deposit` (and `*_storage_deposit` variants such as
  `tokens_storage_deposit`) and the NEAR refunded by the same contract in the same transaction, or refunded by a
  contract called with `storage_deposit` / `storage_withdraw` / `storage_unregister`. NEAR storage staking is
  refundable and recoverable; it is not consideration for a supply, so neither a disposal nor income. Previously the
  refund was mislabelled `gas_refund`.

Post-AI guards (applied to AI decisions after schema validation; they only set `needsQuestion` and append the reason,
never change the label; rule outputs are not guarded because they are deterministic):
- `disposal_swap` without a `pairingId` → "unpaired swap leg" (only the swap rule pairs legs).
- `income_*`, `gift_received`, `acquisition_fiat` on an outgoing leg, or `disposal_*`, `gift_given` on an incoming
  leg → "label contradicts direction".
- `gas_refund` from any counterparty other than `system` or a contract the account called in the same transaction.

Rationale: Phase 3 showed the model mislabelling a refunded swap input as a disposal at 0.85 confidence (above the
question threshold), dust deposits as unpaired swap disposals, and zero-value or storage refunds as gas refunds.
Deterministic rules remove those cases; the guards catch the same shape of error if the model makes it elsewhere.
