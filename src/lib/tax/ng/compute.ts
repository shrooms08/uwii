/**
 * The report computation itself, with every input already in hand: question flow -> engine -> privacy
 * proof -> status -> fingerprint. No network or file access, so it runs unchanged on the server (anchoring,
 * scripts, tests) and in the browser (the Questions, Result and Export pages): the same code, so the same
 * numbers and the same fingerprint.
 */
import type { NafemTable } from "../../fx/nafem-table";
import { RecordingPriceProvider, type PriceProvider } from "../../prices/quotes";
import { reportFingerprint } from "../../report/fingerprint";
import { privacyProofFromRun, type PrivacyProof } from "../../report/privacy";
import { reportStatus, type DraftReason, type ReportStatus } from "../../report/status";
import { runEngine, type EngineResult } from "./engine";
import { OPENING_YEAR, type OpeningPosition } from "./opening-core";
import { runQuestionFlow, type Answers, type ApplySummary, type QuestionFlowResult } from "./questions";
import type { ReliefInputs } from "./reliefs";
import type { ClassifiedRun } from "./types";

export interface ReportData extends EngineResult {
  account: string;
  from: string;
  to: string;
  generatedAt: string;
  origin: { classification: string; prices: string; opening: string; history?: string };
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

/** Everything a report needs, already resolved (where each piece comes from is the caller's business). */
export interface ReportInputs {
  account: string;
  from: string;
  to: string;
  run: ClassifiedRun;
  ownAccounts?: string[];
  answers?: Answers;
  profile?: { otherIncomeNgn?: string | null; reliefs?: ReliefInputs | null };
  originalCostUsd?: Record<string, string>;
  prices: PriceProvider;
  /** When the committed or embedded price table was produced (shown as the price sources' retrieval time). */
  pricesRetrievedAt: string | null;
  fx: NafemTable;
  opening: OpeningPosition;
  origin: ReportData["origin"];
  historyFetchedAt: string;
  /** Origin (scheme and host) of the archival RPC used for snapshots and the opening position. */
  archivalRpc: string;
  dataGaps: { stakingIncomplete: boolean; openingUnavailable: boolean };
}

export async function computeReport(inp: ReportInputs): Promise<{ report: ReportData; recorder: RecordingPriceProvider; flow: QuestionFlowResult }> {
  const { run, opening, fx } = inp;
  const flow = runQuestionFlow(run, { ownAccounts: inp.ownAccounts ?? [], answers: inp.answers ?? { groups: {} } });
  const recorder = new RecordingPriceProvider(inp.prices);

  const engine = await runEngine({
    year: OPENING_YEAR,
    records: flow.records,
    prices: recorder,
    fx,
    openingBalances: opening.balances,
    originalCostUsd: inp.originalCostUsd,
    otherIncomeNgn: inp.profile?.otherIncomeNgn || null,
    reliefs: inp.profile?.reliefs ?? null,
  });

  const privacyProof = privacyProofFromRun(run);
  const warnings = [...engine.warnings];
  for (const m of privacyProof.missing) warnings.push({ code: "privacy_proof_unavailable", message: `Privacy proof: ${m}` });
  if (privacyProof.aiDecisions > 0 && privacyProof.aiDecisionsSignatureVerified < privacyProof.aiDecisions) {
    warnings.push({ code: "ai_signature_unverified", message: `${privacyProof.aiDecisions - privacyProof.aiDecisionsSignatureVerified} AI decision(s) without a verified response signature` });
  }

  const status = reportStatus({
    records: flow.records,
    warnings,
    questions: flow.questions,
    // The base run (before answers): records the rules could not label went to the AI step.
    attestation: { verified: run.attestation.verified, aiNeeded: run.records.some((r) => r.method === "ai") },
    dataGaps: {
      stakingIncomplete: inp.dataGaps.stakingIncomplete,
      openingUnavailable: inp.dataGaps.openingUnavailable,
      pricesUnavailable: [...recorder.results.values()].filter((p) => p.status !== "ok" && p.temporary).length,
    },
  });

  const retrieved = inp.pricesRetrievedAt;
  const report: ReportData = {
    ...engine,
    warnings,
    privacyProof,
    fingerprint: "",
    status: status.status,
    draftReasons: status.draftReasons,
    blockingQuestions: status.blockingQuestions,
    account: inp.account,
    from: inp.from,
    to: inp.to,
    generatedAt: new Date().toISOString(),
    origin: inp.origin,
    questionSummary: flow.summary,
    opening: { date: opening.date, block: opening.block, accountExisted: opening.accountExisted, method: opening.method, balances: opening.balances },
    dataSources: [
      {
        name: "CoinGecko",
        detail: "keyless public API /coins/{id}/market_chart/range, hourly points (monthly windows); exact source-text prices",
        retrievedAt: retrieved,
      },
      {
        name: "CBN NFEM (formerly NAFEM) closing rate",
        detail: `data/fx/cbn-nafem-usdngn.csv from ${fx.meta.sourceUrl}, ${fx.range.first}..${fx.range.last}`,
        retrievedAt: fx.meta.retrievedAt || null,
      },
      { name: "NearBlocks", detail: "v3 API (Powered by NearBlocks.io APIs): receipts, FT transfers, staking and signed transactions", retrievedAt: inp.historyFetchedAt },
      {
        name: "NEAR archival RPC",
        detail: `${inp.archivalRpc}: pool snapshots (staking rewards) and opening position at block ${opening.block.height}`,
        retrievedAt: opening.fetchedAt,
      },
      { name: "neardata (FastNEAR)", detail: "block headers for timestamp -> block lookup", retrievedAt: inp.historyFetchedAt },
      { name: "Rhea / Ref Finance pools", detail: "primary trading pair for tokens without a CoinGecko listing (9.2(1))", retrievedAt: retrieved },
    ],
  };
  report.fingerprint = await reportFingerprint(report);
  return { report, recorder, flow };
}

/** Used when the opening position cannot be read: no earlier holdings, and the report says so as a draft. */
export function unavailableOpening(accountId: string): OpeningPosition {
  return {
    schemaVersion: 1,
    accountId,
    date: `${OPENING_YEAR}-01-01`,
    block: { height: 0, hash: "", timestampNs: "0" },
    accountExisted: true,
    balances: [],
    fetchedAt: new Date().toISOString(),
    method: "not available: the archival RPC could not be read when this report was built",
  };
}
