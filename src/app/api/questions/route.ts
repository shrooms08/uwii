/**
 * Developer-only question-flow endpoint (the /dev pages and tests): a 404 in production. The app itself
 * computes the question flow in the browser, so answers are never sent here.
 */
import { z } from "zod";
import { isValidAccountId } from "@/lib/near/account-id";
import { devPagesEnabled } from "@/lib/server/dev-pages";
import { questionsView } from "@/lib/tax/ng/questions-view";
import { NotScannedError, getClassification } from "@/lib/tax/ng/cache";
import { AnswersBody, ReliefsBody, RunField, RunSigField, resolveRun } from "@/lib/api/report-body";
import { apiLimit, readJsonBody } from "@/lib/server/limits";
import { serverError } from "@/lib/server/errors";
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
    answers: AnswersBody,
    profile: z.object({ otherIncomeNgn: ngn.optional().or(z.literal("")), reliefs: ReliefsBody.optional() }).default({}),
    /** "fixture": the cached demo result (committed classified fixture, no live AI). */
    classificationSource: z.literal("fixture").optional(),
    run: RunField,
    runSig: RunSigField,
  })
  .strict();

const noStore = { "cache-control": "no-store" };

export async function POST(request: Request) {
  if (!devPagesEnabled()) return new Response("Not found", { status: 404, headers: noStore });
  const limited = apiLimit("questionsPerIp", request);
  if (limited) return limited;
  const raw = await readJsonBody(request);
  if (!raw.ok) return raw.response;
  const parsed = Body.safeParse(raw.value);
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400, headers: noStore });
  const body = parsed.data;

  // The signed run from the browser, or the committed fixture (cached demo); never the shared cache.
  const resolved = await resolveRun(body);
  if (!resolved.ok) return resolved.response;
  try {
    // Base classification without own accounts; own accounts are applied by re-running rules.
    const { run, origin } = resolved.run
      ? { run: resolved.run, origin: "signed scan from the browser" }
      : await getClassification(body.account, body.from, body.to, { ownAccounts: [], fixtureOnly: true });
    const flow = runQuestionFlow(run, { ownAccounts: body.ownAccounts, answers: body.answers });
    const view = questionsView(run, flow);
    return Response.json(
      {
        account: run.accountId,
        origin,
        classifiedAt: run.classifiedAt,
        ...view,
        profile: { otherIncomeNgn: body.profile.otherIncomeNgn || null },
      },
      { headers: noStore },
    );
  } catch (e) {
    if (e instanceof NotScannedError) return Response.json({ error: e.message, code: "not_scanned" }, { status: 409, headers: noStore });
    return serverError("questions", e);
  }
}
