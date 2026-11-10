/**
 * Developer-only report endpoint (the /dev pages, scripts and tests): a 404 in production. The app computes
 * reports in the browser (src/lib/client/local-report.ts), so answers are never sent here.
 */
import { noStore, parseReportBody, resolveReportRequest } from "@/lib/api/report-body";
import { NotScannedError } from "@/lib/tax/ng/cache";
import { apiLimit } from "@/lib/server/limits";
import { serverError } from "@/lib/server/errors";
import { buildReport } from "@/lib/tax/ng/report";
import { devPagesEnabled } from "@/lib/server/dev-pages";

/** Vercel Hobby (Fluid compute): 300 s default and maximum per invocation. */
export const maxDuration = 300;
/** Outside lookups stop after this; what is missing leaves the report a draft instead of failing it. */
const REPORT_TIME_BUDGET_MS = 200_000;

export async function POST(request: Request) {
  if (!devPagesEnabled()) return new Response("Not found", { status: 404, headers: noStore });
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
