/**
 * Request body handling for /api/anchor (and the developer-only /api/report): everything arrives from the
 * user's browser in the body and is never stored or logged server-side. The schema itself is in
 * ./report-schema (the browser uses it too).
 */
export { AnswersBody, MAX_ANSWER_ENTRIES, MAX_ANSWER_GROUPS, ReliefsBody, ReportBody, RunField, RunSigField, reliefInputs, userInputsFromBody, type ReportBodyInput } from "./report-schema";
import { z } from "zod";
import type { ReportRequest } from "@/lib/tax/ng/report";
import { ReportBody, userInputsFromBody, type ReportBodyInput } from "./report-schema";
import { access } from "node:fs/promises";
import { checkSignedRun, runSecret } from "@/lib/server/run-signing";
import { readJsonBody } from "@/lib/server/limits";
import { classifiedFixturePath } from "@/lib/tax/ng/cache";
import type { ClassifiedRun } from "@/lib/tax/ng/types";

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
    ...userInputsFromBody(body),
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
