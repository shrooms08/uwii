/**
 * Stateless question-flow endpoint. Own accounts, answers and profile arrive in the request body
 * (they live only in the user's browser) and are never stored or logged server-side.
 */
import { z } from "zod";
import { isValidAccountId } from "@/lib/history/fetch";
import { NotScannedError, getClassification } from "@/lib/tax/ng/cache";
import { ReliefsBody } from "@/lib/api/report-body";
import { NGN_RE, runQuestionFlow } from "@/lib/tax/ng/questions";

/** Vercel Hobby (Fluid compute): 300 s default and maximum per invocation. */
export const maxDuration = 300;

const accountId = z.string().trim().toLowerCase().refine(isValidAccountId, "invalid NEAR account id");
const ngn = z.string().trim().regex(NGN_RE, "NGN amount must be a decimal with up to 2 places");
const datePart = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const Body = z
  .object({
    account: accountId,
    from: datePart.default("2026-01-01"),
    to: datePart.default("2026-12-31"),
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
    profile: z.object({ otherIncomeNgn: ngn.optional().or(z.literal("")), reliefs: ReliefsBody.optional() }).default({}),
    /** "fixture": the cached demo result (committed classified fixture, no live AI). */
    classificationSource: z.literal("fixture").optional(),
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
    // Base classification without own accounts (cache -> committed fixture); own accounts are applied by re-running rules.
    const { run, origin } = await getClassification(body.account, body.from, body.to, { ownAccounts: [], fixtureOnly: body.classificationSource === "fixture", noLive: true });
    const flow = runQuestionFlow(run, { ownAccounts: body.ownAccounts, answers: body.answers });
    const records = flow.records.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      kind: r.kind,
      direction: r.direction,
      asset: r.asset.symbol,
      amount: r.amount,
      counterparty: r.counterparty,
      label: r.label,
      method: r.method,
      confidence: r.confidence,
      needsQuestion: r.needsQuestion,
      circularRef: r.circularRef,
      reason: r.reason,
      userFiat: r.userFiat ?? null,
      incompleteSourceLeg: r.incompleteSourceLeg ?? false,
      previousLabel: r.evidence && "previous" in r.evidence ? r.evidence.previous.label : null,
    }));
    // Assets seen in this account (for the "what did you give up" source-leg answer).
    const assetMap = new Map<string, { symbol: string; contract: string | null }>();
    for (const r of run.records) assetMap.set(r.asset.contract ?? "native", { symbol: r.asset.symbol, contract: r.asset.contract });
    const assets = [...assetMap.values()];
    return Response.json(
      {
        account: run.accountId,
        origin,
        classifiedAt: run.classifiedAt,
        questions: flow.questions,
        summary: flow.summary,
        metrics: flow.metrics,
        profile: { otherIncomeNgn: body.profile.otherIncomeNgn || null },
        records,
        assets,
      },
      { headers: noStore },
    );
  } catch (e) {
    if (e instanceof NotScannedError) return Response.json({ error: e.message, code: "not_scanned" }, { status: 409, headers: noStore });
    return Response.json({ error: `question flow failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 500, headers: noStore });
  }
}
