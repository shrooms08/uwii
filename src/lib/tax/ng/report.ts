/**
 * Report orchestration: base classification -> user answers (Phase 4) -> opening position (D11) ->
 * prices (CoinGecko / primary pair) + CBN NFEM rates -> engine. Answers and profile come from the
 * caller's request and are never stored or logged.
 */
import path from "node:path";
import { NafemTable } from "../../fx/nafem";
import { getHistory } from "../../history/cache";
import { FIXTURE_DIR, readJsonIfExists, writeJson } from "../../history/paths";
import { FixturePriceProvider, LivePriceProvider, RecordingPriceProvider, loadPriceFixture, writePriceFixture, type PriceProvider } from "../../prices/provider";
import { reportFingerprint } from "../../report/fingerprint";
import { privacyProofFromRun, type PrivacyProof } from "../../report/privacy";
import { reportStatus, type DraftReason, type ReportStatus } from "../../report/status";
import { getClassification } from "./cache";
import { runEngine, type EngineResult } from "./engine";
import { fetchOpeningPosition, OPENING_YEAR, RESET_PRICE_TIME, type OpeningPosition } from "./opening";
import { runQuestionFlow, type Answers, type ApplySummary } from "./questions";
import type { ClassifiedTx } from "./types";

const TECHNICAL = new Set(["wrap_unwrap", "staking_lockup", "round_trip", "dust_no_value", "storage_deposit", "gas_refund", "loan_collateralised"]);

export interface ReportRequest {
  account: string;
  from?: string;
  to?: string;
  ownAccounts?: string[];
  answers?: Answers;
  profile?: { otherIncomeNgn?: string | null };
  originalCostUsd?: Record<string, string>;
  onProgress?: (m: string) => void;
}

export interface ReportData extends EngineResult {
  account: string;
  from: string;
  to: string;
  generatedAt: string;
  origin: { classification: string; prices: string; opening: string };
  questionSummary: ApplySummary;
  opening: Pick<OpeningPosition, "date" | "block" | "accountExisted" | "method" | "balances">;
  dataSources: { name: string; detail: string; retrievedAt: string | null }[];
  /** TEE attestation + response-signature evidence from the stored classification run. */
  privacyProof: PrivacyProof;
  /** SHA-256 of the canonical report JSON, personal fields excluded (src/lib/report/fingerprint.ts). */
  fingerprint: string;
  /** "draft" while anything unresolved could distort the figures; covered by the fingerprint. */
  status: ReportStatus;
  draftReasons: DraftReason[];
  /** Question groups still unanswered. */
  blockingQuestions: number;
}

export const priceFixturePath = (account: string) => path.join(FIXTURE_DIR, `${account}-${OPENING_YEAR}.prices.json`);
export const openingFixturePath = (account: string) => path.join(FIXTURE_DIR, `${account}-${OPENING_YEAR}.opening.json`);

/** Quote every record a computation could need (any answer), every fee, and the D11 reset prices. */
export async function prequote(records: ClassifiedTx[], opening: OpeningPosition, prices: PriceProvider): Promise<void> {
  const near = { symbol: "NEAR", contract: null, decimals: 24 };
  for (const r of records) {
    if (r.fee) await prices.quote(near, r.timestamp);
    if (!r.success || TECHNICAL.has(r.label) || r.amount === "0") continue;
    await prices.quote(r.asset, r.timestamp);
  }
  for (const b of opening.balances) await prices.quote(b.asset, RESET_PRICE_TIME);
}

export async function buildReport(req: ReportRequest): Promise<{ report: ReportData; recorder: RecordingPriceProvider; opening: OpeningPosition; records: ClassifiedTx[] }> {
  const from = req.from ?? "2026-01-01";
  const to = req.to ?? "2026-12-31";
  if (from !== `${OPENING_YEAR}-01-01` || to !== `${OPENING_YEAR}-12-31`) {
    throw new Error(`The engine computes the ${OPENING_YEAR} tax year only (from ${OPENING_YEAR}-01-01 to ${OPENING_YEAR}-12-31)`);
  }
  const log = req.onProgress ?? (() => {});

  const { run, origin: classificationOrigin } = await getClassification(req.account, from, to, { ownAccounts: [] });
  const flow = runQuestionFlow(run, { ownAccounts: req.ownAccounts ?? [], answers: req.answers ?? { groups: {} } });
  const { result: history } = await getHistory(req.account, from, to);

  let opening = await readJsonIfExists<OpeningPosition>(openingFixturePath(req.account));
  let openingOrigin = "fixture";
  if (!opening) {
    opening = await fetchOpeningPosition(history, log);
    openingOrigin = "archival RPC (cached)";
  }

  const fixture = await loadPriceFixture(priceFixturePath(req.account));
  const recorder = new RecordingPriceProvider(fixture ? new FixturePriceProvider(fixture, new LivePriceProvider()) : new LivePriceProvider());
  const fx = await NafemTable.load();

  const engine = await runEngine({
    year: OPENING_YEAR,
    records: flow.records,
    prices: recorder,
    fx,
    openingBalances: opening.balances,
    originalCostUsd: req.originalCostUsd,
    otherIncomeNgn: req.profile?.otherIncomeNgn || null,
  });

  const privacyProof = privacyProofFromRun(run);
  const warnings = [...engine.warnings];
  for (const m of privacyProof.missing) warnings.push({ code: "privacy_proof_unavailable", message: `Privacy proof: ${m}` });
  if (privacyProof.aiDecisions > 0 && privacyProof.aiDecisionsSignatureVerified < privacyProof.aiDecisions) {
    warnings.push({ code: "ai_signature_unverified", message: `${privacyProof.aiDecisions - privacyProof.aiDecisionsSignatureVerified} AI decision(s) without a verified response signature` });
  }

  const status = reportStatus({ records: flow.records, warnings, questions: flow.questions });

  const report: ReportData = {
    ...engine,
    warnings,
    privacyProof,
    fingerprint: "",
    status: status.status,
    draftReasons: status.draftReasons,
    blockingQuestions: status.blockingQuestions,
    account: req.account,
    from,
    to,
    generatedAt: new Date().toISOString(),
    origin: {
      classification: classificationOrigin,
      prices: fixture ? `committed fixture (${fixture.generatedAt}) with live fallback` : "live",
      opening: openingOrigin,
    },
    questionSummary: flow.summary,
    opening: { date: opening.date, block: opening.block, accountExisted: opening.accountExisted, method: opening.method, balances: opening.balances },
    dataSources: [
      {
        name: "CoinGecko",
        detail: "keyless public API /coins/{id}/market_chart/range, hourly points (monthly windows); exact source-text prices",
        retrievedAt: fixture?.generatedAt ?? null,
      },
      {
        name: "CBN NFEM (formerly NAFEM) closing rate",
        detail: `data/fx/cbn-nafem-usdngn.csv from ${fx.meta.sourceUrl}, ${fx.range.first}..${fx.range.last}`,
        retrievedAt: fx.meta.retrievedAt || null,
      },
      { name: "NearBlocks", detail: "v3 API (Powered by NearBlocks.io APIs): receipts, FT transfers, staking and signed transactions", retrievedAt: history.fetchedAt },
      {
        name: "NEAR archival RPC",
        detail: `${history.staking.archivalRpc}: pool snapshots (staking rewards) and opening position at block ${opening.block.height}`,
        retrievedAt: opening.fetchedAt,
      },
      { name: "neardata (FastNEAR)", detail: "block headers for timestamp -> block lookup", retrievedAt: history.fetchedAt },
      { name: "Rhea / Ref Finance pools", detail: "primary trading pair for tokens without a CoinGecko listing (9.2(1))", retrievedAt: fixture?.generatedAt ?? null },
    ],
  };
  report.fingerprint = await reportFingerprint(report);
  return { report, recorder, opening, records: flow.records };
}

export async function writeReportFixtures(account: string, recorder: RecordingPriceProvider, opening: OpeningPosition): Promise<string[]> {
  await writePriceFixture(priceFixturePath(account), recorder.results);
  await writeJson(openingFixturePath(account), opening);
  return [priceFixturePath(account), openingFixturePath(account)];
}
