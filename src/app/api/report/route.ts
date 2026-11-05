/**
 * Stateless tax report endpoint. Own accounts, answers, profile and optional original costs arrive in
 * the request body (they live only in the user's browser) and are never stored or logged.
 */
import { z } from "zod";
import { isValidAccountId } from "@/lib/history/fetch";
import { NGN_RE } from "@/lib/tax/ng/questions";
import { buildReport } from "@/lib/tax/ng/report";

export const maxDuration = 300;

const accountId = z.string().trim().toLowerCase().refine(isValidAccountId, "invalid NEAR account id");
const ngn = z.string().trim().regex(NGN_RE, "NGN amount must be a decimal with up to 2 places");
const usd = z.string().trim().regex(/^\d{1,15}(\.\d{1,8})?$/, "USD amount must be a decimal");

const Body = z
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
  })
  .strict();

const noStore = { "cache-control": "no-store" };

export async function POST(request: Request) {
  let body: z.infer<typeof Body>;
  try {
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400, headers: noStore });
    body = parsed.data;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400, headers: noStore });
  }
  try {
    const { report } = await buildReport({
      account: body.account,
      ownAccounts: body.ownAccounts,
      answers: body.answers,
      profile: { otherIncomeNgn: body.profile.otherIncomeNgn || null },
      originalCostUsd: body.originalCostUsd,
    });
    return Response.json(report, { headers: noStore });
  } catch (e) {
    return Response.json({ error: `report failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 500, headers: noStore });
  }
}
