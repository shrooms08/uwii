/**
 * Stateless tax report endpoint. Own accounts, answers, profile and optional original costs arrive in
 * the request body (they live only in the user's browser) and are never stored or logged.
 */
import { noStore, parseReportBody, reportRequest } from "@/lib/api/report-body";
import { buildReport } from "@/lib/tax/ng/report";

export const maxDuration = 300;

export async function POST(request: Request) {
  const parsed = await parseReportBody(request);
  if (!parsed.ok) return parsed.response;
  try {
    const { report } = await buildReport(reportRequest(parsed.body));
    return Response.json(report, { headers: noStore });
  } catch (e) {
    return Response.json({ error: `report failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 500, headers: noStore });
  }
}
