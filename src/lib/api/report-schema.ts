/**
 * The report request schema the anchor route (and the developer-only /api/report) parses. The browser
 * builds the same body (src/lib/client/request.ts) without zod; a test checks this schema leaves it
 * unchanged, so the browser and the anchor recomputation see identical inputs.
 */
import { z } from "zod";
import { isValidAccountId } from "@/lib/near/account-id";
import { NGN_RE } from "@/lib/tax/ng/questions";

const accountId = z.string().trim().toLowerCase().refine(isValidAccountId, "invalid NEAR account id");
const ngn = z.string().trim().regex(NGN_RE, "NGN amount must be a decimal with up to 2 places");
/** Reliefs and deductions (NTA 2025 s.30), NGN amounts; empty strings mean "not entered". */
const ngnOpt = ngn.optional().or(z.literal(""));
export const ReliefsBody = z
  .object({ rentPaidNgn: ngnOpt, pensionNgn: ngnOpt, nhfNgn: ngnOpt, nhisNgn: ngnOpt, lifeInsuranceNgn: ngnOpt, mortgageInterestNgn: ngnOpt })
  .strict();

const usd = z.string().trim().regex(/^\d{1,15}(\.\d{1,8})?$/, "USD amount must be a decimal");

/** Entry caps on answers (M4): far above any real account, small enough to bound the work per request. */
export const MAX_ANSWER_GROUPS = 200;
export const MAX_ANSWER_ENTRIES = 500;
const entries = <T extends z.ZodTypeAny>(value: T) =>
  z.record(z.string().max(300), value).refine((r) => Object.keys(r).length <= MAX_ANSWER_ENTRIES, `at most ${MAX_ANSWER_ENTRIES} entries`);

/** User answers per question group (shared by /api/report, /api/anchor and /api/questions). */
export const AnswersBody = z
  .object({
    groups: z
      .record(
        z.string().max(200),
        z.object({
          option: z.string().max(40),
          overrides: entries(z.string().max(40)).optional(),
          ngn: entries(z.string().max(30)).optional(),
          sourceLegs: entries(
            z.object({
              asset: z.object({ symbol: z.string().max(64), contract: z.string().max(64).nullable() }),
              quantity: z.string().max(80),
              timestamp: z.string().max(40).optional(),
            }),
          ).optional(),
        }),
      )
      .refine((r) => Object.keys(r).length <= MAX_ANSWER_GROUPS, `at most ${MAX_ANSWER_GROUPS} answer groups`)
      .default({}),
  })
  .default({ groups: {} });

/** Signed run fields (shared with /api/questions); the HMAC is checked in resolveRun. */
export const RunField = z.record(z.string(), z.unknown()).optional();
export const RunSigField = z.string().max(64).optional();

export const ReportBody = z
  .object({
    account: accountId,
    ownAccounts: z.array(accountId).max(50).default([]),
    answers: AnswersBody,
    profile: z.object({ otherIncomeNgn: ngn.optional().or(z.literal("")), reliefs: ReliefsBody.optional() }).default({}),
    originalCostUsd: z.record(z.string().max(100), usd).optional(),
    /** "fixture": the cached demo result (committed classified fixture, no live AI). */
    classificationSource: z.literal("fixture").optional(),
    /** The signed classification run from /api/scan, kept in the browser (verified server-side). */
    run: RunField,
    runSig: RunSigField,
    /** The fingerprint the browser computed (anchoring: the server's recomputation must match it). */
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/, "fingerprint must be 64 hexadecimal characters").optional(),
  })
  .strict();

export type ReportBodyInput = z.infer<typeof ReportBody>;

export { reliefInputs, userInputsFromBody } from "@/lib/report/local";
