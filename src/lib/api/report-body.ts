/**
 * Request body shared by /api/report and /api/anchor: everything arrives from the user's browser in
 * the body and is never stored or logged server-side.
 */
import { z } from "zod";
import { isValidAccountId } from "@/lib/near/account-id";
import { NGN_RE } from "@/lib/tax/ng/questions";
import type { ReportRequest } from "@/lib/tax/ng/report";
import type { ReliefInputs } from "@/lib/tax/ng/reliefs";
import { access } from "node:fs/promises";
import { checkSignedRun, runSecret } from "@/lib/server/run-signing";
import { readJsonBody } from "@/lib/server/limits";
import { classifiedFixturePath } from "@/lib/tax/ng/cache";
import type { ClassifiedRun } from "@/lib/tax/ng/types";

const accountId = z.string().trim().toLowerCase().refine(isValidAccountId, "invalid NEAR account id");
const ngn = z.string().trim().regex(NGN_RE, "NGN amount must be a decimal with up to 2 places");
/** Reliefs and deductions (NTA 2025 s.30), NGN amounts; empty strings mean "not entered". */
const ngnOpt = ngn.optional().or(z.literal(""));
export const ReliefsBody = z
  .object({ rentPaidNgn: ngnOpt, pensionNgn: ngnOpt, nhfNgn: ngnOpt, nhisNgn: ngnOpt, lifeInsuranceNgn: ngnOpt, mortgageInterestNgn: ngnOpt })
  .strict();

/** Entered relief amounts only (empty strings dropped), or null when none. */
export function reliefInputs(r: z.infer<typeof ReliefsBody> | undefined): ReliefInputs | null {
  if (!r) return null;
  const out: ReliefInputs = {};
  for (const [k, v] of Object.entries(r)) if (v) out[k as keyof ReliefInputs] = v;
  return Object.keys(out).length ? out : null;
}

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
  })
  .strict();

export type ReportBodyInput = z.infer<typeof ReportBody>;

export const noStore = { "cache-control": "no-store" };

/** Parse a JSON request into the report body, or a 400 response. */
export async function parseReportBody(request: Request): Promise<{ ok: true; body: ReportBodyInput } | { ok: false; response: Response }> {
  const raw = await readJsonBody(request);
  if (!raw.ok) return raw;
  const parsed = ReportBody.safeParse(raw.value);
  if (!parsed.success) return { ok: false, response: Response.json({ error: z.prettifyError(parsed.error) }, { status: 400, headers: noStore }) };
  return { ok: true, body: parsed.data };
}

export function reportRequest(body: ReportBodyInput): ReportRequest {
  return {
    account: body.account,
    ownAccounts: body.ownAccounts,
    answers: body.answers,
    profile: { otherIncomeNgn: body.profile.otherIncomeNgn || null, reliefs: reliefInputs(body.profile.reliefs) },
    originalCostUsd: body.originalCostUsd,
    classificationSource: body.classificationSource,
    // Live AI classification only runs through the rate-limited /api/scan.
    noLiveClassification: true,
  };
}

export type RunResolution = { ok: true; run: ClassifiedRun | null; fixture: boolean } | { ok: false; response: Response };

async function hasClassifiedFixture(account: string): Promise<boolean> {
  const file = classifiedFixturePath(account, "2026-01-01", "2026-12-31");
  if (!file) return false;
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Which classification a request uses: the cached demo (committed fixture) when asked for; else the
 * signed run sent by the browser (HMAC verified, same account); else the committed fixture when one
 * exists (the demo account); else 409 "not scanned". The shared server cache is never read here.
 */
export async function resolveRun(body: { account: string; run?: Record<string, unknown>; runSig?: string; classificationSource?: "fixture" }): Promise<RunResolution> {
  if (body.classificationSource === "fixture") return { ok: true, run: null, fixture: true };
  if (body.run !== undefined || body.runSig !== undefined) {
    const c = checkSignedRun(body.account, body.run, body.runSig, runSecret());
    if (!c.ok) return { ok: false, response: Response.json({ error: c.error, code: c.code }, { status: c.status, headers: noStore }) };
    return { ok: true, run: c.run, fixture: false };
  }
  if (await hasClassifiedFixture(body.account)) return { ok: true, run: null, fixture: true };
  return { ok: false, response: Response.json({ error: `${body.account} has not been scanned yet. Start a scan first.`, code: "not_scanned" }, { status: 409, headers: noStore }) };
}

/** The ReportRequest for a parsed body, with its classification resolved (see resolveRun). */
export async function resolveReportRequest(body: ReportBodyInput): Promise<{ ok: true; req: ReportRequest } | { ok: false; response: Response }> {
  const r = await resolveRun(body);
  if (!r.ok) return r;
  const req = reportRequest(body);
  return { ok: true, req: r.run ? { ...req, run: r.run, classificationSource: undefined } : { ...req, classificationSource: "fixture" } };
}
