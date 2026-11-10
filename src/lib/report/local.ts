/**
 * Report inputs from what the browser holds, with no network or file access (shared by server and browser):
 *  - the cached demo: a bundle of the committed fixtures (classified run, prices, opening, history facts);
 *  - a live scan: the signed run, which carries its own prices and opening position (RunContext).
 * The server builds the same inputs to recompute a report before anchoring, so both sides agree exactly.
 * The only network fallback is the price provider passed in, used for prices the user's answers add
 * (a source leg's asset and date).
 */
import type { NafemTable } from "../fx/nafem-table";
import { FixturePriceProvider, type PriceFixture, type PriceProvider } from "../prices/quotes";
import { computeReport, unavailableOpening, type ReportInputs } from "../tax/ng/compute";
import type { OpeningPosition } from "../tax/ng/opening-core";
import type { Answers } from "../tax/ng/questions";
import type { ReliefInputs } from "../tax/ng/reliefs";
import type { ClassifiedRun } from "../tax/ng/types";

/** Everything the cached demo needs, built from data/fixtures at build time (public/static-data/demo/). */
export interface DemoBundle {
  run: ClassifiedRun;
  prices: PriceFixture | null;
  opening: OpeningPosition;
  history: { fetchedAt: string; archivalRpc: string; stakingIncomplete: boolean };
}

/** Entered relief amounts only (empty strings dropped), or null when none. */
export function reliefInputs(r: Partial<Record<keyof ReliefInputs, string | null | undefined>> | undefined): ReliefInputs | null {
  if (!r) return null;
  const out: ReliefInputs = {};
  for (const [k, v] of Object.entries(r)) if (v) out[k as keyof ReliefInputs] = v;
  return Object.keys(out).length ? out : null;
}

/** A request body (the browser's own, or one the anchor route parsed) as the computation's user inputs. */
export function userInputsFromBody(body: {
  account: string;
  ownAccounts?: string[];
  answers?: Answers;
  profile?: { otherIncomeNgn?: string | null; reliefs?: Partial<Record<keyof ReliefInputs, string | null | undefined>> };
  originalCostUsd?: Record<string, string>;
}): UserInputs {
  return {
    account: body.account,
    ownAccounts: body.ownAccounts ?? [],
    answers: body.answers ?? { groups: {} },
    profile: { otherIncomeNgn: body.profile?.otherIncomeNgn || null, reliefs: reliefInputs(body.profile?.reliefs) },
    originalCostUsd: body.originalCostUsd,
  };
}

/** What the user adds, kept in their browser. */
export interface UserInputs {
  account: string;
  ownAccounts?: string[];
  answers?: Answers;
  profile?: { otherIncomeNgn?: string | null; reliefs?: ReliefInputs | null };
  originalCostUsd?: Record<string, string>;
}

const YEAR = { from: "2026-01-01", to: "2026-12-31" };

export function inputsFromBundle(b: DemoBundle, user: UserInputs, fx: NafemTable, fallback: PriceProvider): ReportInputs {
  return {
    ...YEAR,
    ...user,
    run: b.run,
    prices: b.prices ? new FixturePriceProvider(b.prices, fallback) : fallback,
    pricesRetrievedAt: b.prices?.generatedAt ?? null,
    fx,
    opening: b.opening,
    origin: { classification: "fixture", prices: b.prices ? `committed fixture (${b.prices.generatedAt}) with live fallback` : "live", opening: "fixture" },
    historyFetchedAt: b.history.fetchedAt,
    archivalRpc: b.history.archivalRpc,
    dataGaps: { stakingIncomplete: b.history.stakingIncomplete, openingUnavailable: false },
  };
}

/** Inputs from a signed run that carries its own prices; null for runs saved before they did (scan again). */
export function inputsFromSignedRun(run: ClassifiedRun, user: UserInputs, fx: NafemTable, fallback: PriceProvider): ReportInputs | null {
  const ctx = run.context;
  if (!ctx?.prices) return null;
  const opening = ctx.opening && ctx.opening.accountId === user.account ? ctx.opening : null;
  return {
    ...YEAR,
    ...user,
    run,
    prices: new FixturePriceProvider(ctx.prices, fallback),
    pricesRetrievedAt: ctx.prices.generatedAt,
    fx,
    opening: opening ?? unavailableOpening(user.account),
    origin: {
      classification: "signed scan from the browser",
      prices: `recorded during the scan (${ctx.prices.generatedAt})`,
      opening: opening ? "computed during the scan" : "unavailable",
      ...(ctx.historyOrigin === "fixture" ? { history: "committed snapshot" } : {}),
    },
    historyFetchedAt: run.historyFetchedAt,
    archivalRpc: ctx.archivalRpc,
    dataGaps: { stakingIncomplete: ctx.stakingIncomplete === true, openingUnavailable: !opening },
  };
}

export const localReport = computeReport;
