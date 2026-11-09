/**
 * Stateless tax report endpoint. Own accounts, answers, profile and optional original costs arrive in
 * the request body (they live only in the user's browser) and are never stored or logged.
 */
import { noStore, parseReportBody, resolveReportRequest } from "@/lib/api/report-body";
import { NotScannedError } from "@/lib/tax/ng/cache";
import { apiLimit } from "@/lib/server/limits";
import { serverError } from "@/lib/server/errors";
import { buildReport } from "@/lib/tax/ng/report";

/** Vercel Hobby (Fluid compute): 300 s default and maximum per invocation. */
export const maxDuration = 300;
/** Outside lookups stop after this; what is missing leaves the report a draft instead of failing it. */
const REPORT_TIME_BUDGET_MS = 200_000;

export async function POST(request: Request) {
  const limited = apiLimit("reportPerIp", request);
  if (limited) return limited;
  const parsed = await parseReportBody(request);
  if (!parsed.ok) return parsed.response;
  const resolved = await resolveReportRequest(parsed.body);
  if (!resolved.ok) return resolved.response;
  try {
    const { report } = await buildReport({ ...resolved.req, deadlineAt: Date.now() + REPORT_TIME_BUDGET_MS });
    return Response.json(report, { headers: noStore });
  } catch (e) {
    if (e instanceof NotScannedError) return Response.json({ error: e.message, code: "not_scanned" }, { status: 409, headers: noStore });
    return serverError("report", e);
  }
}
