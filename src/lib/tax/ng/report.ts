/**
 * Server-side report orchestration (scripts, tests, the anchor recomputation): resolve the inputs -
 * classification, history facts, opening position (D11), prices and CBN NFEM rates - then compute with the
 * same pure code the browser runs (./compute). Answers and profile come from the caller and are never
 * stored or logged.
 */
import path from "node:path";
import { loadNafemTable } from "../../fx/nafem";
import { getHistory } from "../../history/cache";
import { FIXTURE_DIR, readJsonIfExists, writeJson } from "../../history/paths";
import { FixturePriceProvider, LivePriceProvider, loadPriceFixture, writePriceFixture, type PriceProvider, type RecordingPriceProvider } from "../../prices/provider";
import { inputsFromSignedRun } from "../../report/local";
import { getClassification } from "./cache";
import { computeReport, unavailableOpening, type ReportData } from "./compute";
import { fetchOpeningPosition, OPENING_YEAR, RESET_PRICE_TIME, type OpeningPosition } from "./opening";
import type { Answers } from "./questions";
import type { ClassifiedRun, ClassifiedTx } from "./types";
import type { NormalizedTx } from "../../history/types";
import { urlOrigin } from "../../server/run-signing";
import type { ReliefInputs } from "./reliefs";

export type { ReportData } from "./compute";

const TECHNICAL = new Set(["wrap_unwrap", "staking_lockup", "round_trip", "dust_no_value", "storage_deposit", "gas_refund", "loan_collateralised"]);

export interface ReportRequest {
  account: string;
  from?: string;
  to?: string;
  ownAccounts?: string[];
  answers?: Answers;
  profile?: { otherIncomeNgn?: string | null; reliefs?: ReliefInputs | null };
  /** A classification run already verified by the caller (signed by /api/scan); replaces the shared cache. */
  run?: ClassifiedRun;
  originalCostUsd?: Record<string, string>;
  /** "fixture": use only the committed classified fixture (the cached demo result). */
  classificationSource?: "fixture";
  /** Refuse to classify live (API routes). */
  noLiveClassification?: boolean;
  /** API routes: absolute time (ms) by which outside lookups stop; what is missing leaves the report a draft. */
  deadlineAt?: number;
  onProgress?: (m: string) => void;
}

/** Longest a report waits on the archival RPC for the opening position. */
const OPENING_LOOKUP_LIMIT_MS = 45_000;

export const priceFixturePath = (account: string) => path.join(FIXTURE_DIR, `${account}-${OPENING_YEAR}.prices.json`);
export const openingFixturePath = (account: string) => path.join(FIXTURE_DIR, `${account}-${OPENING_YEAR}.opening.json`);

/**
 * Quote every record a computation could need (any answer), every fee, and the D11 reset prices. Technical
 * records are skipped unless a question is open on them, since an answer can make them taxable.
 */
export async function prequote(records: ClassifiedTx[], opening: OpeningPosition, prices: PriceProvider): Promise<void> {
  for (const r of records) {
    if (r.fee) await prices.quote(NEAR_FEE_ASSET, r.timestamp);
    if (!r.success || r.amount === "0" || (TECHNICAL.has(r.label) && !r.needsQuestion)) continue;
    await prices.quote(r.asset, r.timestamp);
    if (r.userSourceLeg) {
      const leg = r.userSourceLeg;
      await prices.quote({ symbol: leg.asset.symbol, contract: leg.asset.contract, decimals: 0 }, leg.timestamp);
    }
  }
  await quoteResetPrices(opening, prices);
}

const NEAR_FEE_ASSET = { symbol: "NEAR", contract: null, decimals: 24 };

/**
 * The scan's price pass, before classification is known: every successful non-zero record and every fee
 * (a superset of what any answers can need), plus NEAR at every record's time, the commonest source leg a
 * user adds ("I gave up NEAR for this"). CoinGecko is fetched a month per asset at a time, so the extra
 * quotes cost almost no extra calls. Other source legs are priced by /api/price when answered.
 */
export async function quoteHistory(records: NormalizedTx[], prices: PriceProvider): Promise<void> {
  for (const r of records) {
    if (r.fee) await prices.quote(NEAR_FEE_ASSET, r.timestamp);
    if (r.success && r.amount !== "0") {
      await prices.quote(r.asset, r.timestamp);
      if (r.asset.contract !== null) await prices.quote(NEAR_FEE_ASSET, r.timestamp);
    }
  }
}

/** D11: the 31 Dec 2025 price of every opening holding. */
export async function quoteResetPrices(opening: OpeningPosition, prices: PriceProvider): Promise<void> {
  for (const b of opening.balances) await prices.quote(b.asset, RESET_PRICE_TIME);
}

export async function buildReport(req: ReportRequest): Promise<{ report: ReportData; recorder: RecordingPriceProvider; opening: OpeningPosition; records: ClassifiedTx[] }> {
  const from = req.from ?? "2026-01-01";
  const to = req.to ?? "2026-12-31";
  if (from !== `${OPENING_YEAR}-01-01` || to !== `${OPENING_YEAR}-12-31`) {
    throw new Error(`The engine computes the ${OPENING_YEAR} tax year only (from ${OPENING_YEAR}-01-01 to ${OPENING_YEAR}-12-31)`);
  }
  const log = req.onProgress ?? (() => {});
  const fx = await loadNafemTable();
  const user = { account: req.account, ownAccounts: req.ownAccounts, answers: req.answers, profile: req.profile, originalCostUsd: req.originalCostUsd };

  // A signed run that carries its own prices and opening position: exactly the inputs the browser uses.
  if (req.run?.context?.prices) {
    if (req.run.accountId !== req.account) throw new Error("The classification run belongs to a different account");
    const inputs = inputsFromSignedRun(req.run, user, fx, new LivePriceProvider(req.deadlineAt))!;
    const { report, recorder, flow } = await computeReport(inputs);
    return { report, recorder, opening: inputs.opening, records: flow.records };
  }

  // A signed run from before runs carried prices, or the shared classification cache / committed fixture.
  let run: ClassifiedRun;
  let classificationOrigin: string;
  if (req.run) {
    if (req.run.accountId !== req.account) throw new Error("The classification run belongs to a different account");
    run = req.run;
    classificationOrigin = "signed scan from the browser";
  } else {
    ({ run, origin: classificationOrigin } = await getClassification(req.account, from, to, { ownAccounts: [], fixtureOnly: req.classificationSource === "fixture", noLive: req.noLiveClassification }));
  }
  const ctx = req.run?.context;
  const history = ctx ? null : (await getHistory(req.account, from, to)).result;
  const historyFetchedAt = history ? history.fetchedAt : run.historyFetchedAt;
  const archivalRpc = ctx ? ctx.archivalRpc : urlOrigin(history!.staking.archivalRpc);

  let opening = await readJsonIfExists<OpeningPosition>(openingFixturePath(req.account));
  let openingOrigin = "fixture";
  if (!opening && ctx?.opening && ctx.opening.accountId === req.account) {
    opening = ctx.opening;
    openingOrigin = "computed during the scan";
  }
  let openingUnavailable = false;
  if (!opening) {
    try {
      const limits = req.deadlineAt ? { deadlineAt: Math.min(req.deadlineAt, Date.now() + OPENING_LOOKUP_LIMIT_MS) } : undefined;
      opening = await fetchOpeningPosition(ctx ? ctx.openingInputs : history!, log, limits);
      openingOrigin = "archival RPC (cached)";
    } catch (e) {
      if (!req.deadlineAt) throw e;
      opening = unavailableOpening(req.account);
      openingOrigin = "unavailable";
      openingUnavailable = true;
    }
  }

  const fixture = await loadPriceFixture(priceFixturePath(req.account));
  const live = new LivePriceProvider(req.deadlineAt);
  const { report, recorder, flow } = await computeReport({
    ...user,
    from,
    to,
    run,
    prices: fixture ? new FixturePriceProvider(fixture, live) : live,
    pricesRetrievedAt: fixture?.generatedAt ?? null,
    fx,
    opening,
    origin: {
      classification: classificationOrigin,
      prices: fixture ? `committed fixture (${fixture.generatedAt}) with live fallback` : "live",
      opening: openingOrigin,
      ...(ctx?.historyOrigin === "fixture" ? { history: "committed snapshot" } : {}),
    },
    historyFetchedAt,
    archivalRpc,
    dataGaps: { stakingIncomplete: ctx ? ctx.stakingIncomplete === true : Boolean(history?.staking.incomplete), openingUnavailable },
  });
  return { report, recorder, opening, records: flow.records };
}

export async function writeReportFixtures(account: string, recorder: RecordingPriceProvider, opening: OpeningPosition): Promise<string[]> {
  await writePriceFixture(priceFixturePath(account), recorder.results);
  await writeJson(openingFixturePath(account), opening);
  return [priceFixturePath(account), openingFixturePath(account)];
}
