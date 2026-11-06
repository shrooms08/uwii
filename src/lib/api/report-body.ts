/**
 * Request body shared by /api/report and /api/anchor: everything arrives from the user's browser in
 * the body and is never stored or logged server-side.
 */
import { z } from "zod";
import { isValidAccountId } from "@/lib/near/account-id";
import { NGN_RE } from "@/lib/tax/ng/questions";
import type { ReportRequest } from "@/lib/tax/ng/report";

const accountId = z.string().trim().toLowerCase().refine(isValidAccountId, "invalid NEAR account id");
const ngn = z.string().trim().regex(NGN_RE, "NGN amount must be a decimal with up to 2 places");
const usd = z.string().trim().regex(/^\d{1,15}(\.\d{1,8})?$/, "USD amount must be a decimal");

export const ReportBody = z
  .object({
    account: accountId,
    ownAccounts: z.array(accountId).max(50).default([]),
    answers: z
      .object({
        groups: z
          .record(
            z.string().max(200),
            z.object({
              option: z.string().max(40),
              overrides: z.record(z.string().max(300), z.string().max(40)).optional(),
              ngn: z.record(z.string().max(300), z.string().max(30)).optional(),
              sourceLegs: z
                .record(
                  z.string().max(300),
                  z.object({
                    asset: z.object({ symbol: z.string().max(64), contract: z.string().max(64).nullable() }),
                    quantity: z.string().max(80),
                    timestamp: z.string().max(40).optional(),
                  }),
                )
                .optional(),
            }),
          )
          .default({}),
      })
      .default({ groups: {} }),
    profile: z.object({ otherIncomeNgn: ngn.optional().or(z.literal("")) }).default({}),
    originalCostUsd: z.record(z.string().max(100), usd).optional(),
    /** "fixture": the cached demo result (committed classified fixture, no live AI). */
    classificationSource: z.literal("fixture").optional(),
  })
  .strict();

export type ReportBodyInput = z.infer<typeof ReportBody>;

export const noStore = { "cache-control": "no-store" };

/** Parse a JSON request into the report body, or a 400 response. */
export async function parseReportBody(request: Request): Promise<{ ok: true; body: ReportBodyInput } | { ok: false; response: Response }> {
  try {
    const parsed = ReportBody.safeParse(await request.json());
    if (!parsed.success) return { ok: false, response: Response.json({ error: z.prettifyError(parsed.error) }, { status: 400, headers: noStore }) };
    return { ok: true, body: parsed.data };
  } catch {
    return { ok: false, response: Response.json({ error: "body must be JSON" }, { status: 400, headers: noStore }) };
  }
}

export function reportRequest(body: ReportBodyInput): ReportRequest {
  return {
    account: body.account,
    ownAccounts: body.ownAccounts,
    answers: body.answers,
    profile: { otherIncomeNgn: body.profile.otherIncomeNgn || null },
    originalCostUsd: body.originalCostUsd,
    classificationSource: body.classificationSource,
    // Live AI classification only runs through the rate-limited /api/scan.
    noLiveClassification: true,
  };
}
