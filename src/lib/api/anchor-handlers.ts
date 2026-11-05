/**
 * Handlers for /api/anchor and /api/verify, with injectable dependencies for tests. The report is
 * recomputed server-side from the request body; only its fingerprint (and "final") is sent on-chain.
 * Nothing here logs.
 */
import { FINGERPRINT_RE, anchorConfig, anchorFingerprint, nearAnchorClient, verifyFingerprint, type AnchorClient, type AnchorConfig, type AnchorInfo } from "@/lib/near/anchor";
import { buildReport, type ReportData, type ReportRequest } from "@/lib/tax/ng/report";
import { noStore, parseReportBody, reportRequest } from "./report-body";

export interface AnchorDeps {
  build: (req: ReportRequest) => Promise<{ report: ReportData }>;
  config: () => AnchorConfig | null;
  client: (cfg: AnchorConfig) => AnchorClient;
}

export const defaultDeps: AnchorDeps = { build: buildReport, config: () => anchorConfig(), client: nearAnchorClient };

export interface AnchorResponse extends AnchorInfo {
  alreadyAnchored: boolean;
}

const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => Response.json({ error, ...extra }, { status, headers: noStore });

export async function handleAnchor(request: Request, deps: AnchorDeps = defaultDeps): Promise<Response> {
  const parsed = await parseReportBody(request);
  if (!parsed.ok) return parsed.response;
  let report: ReportData;
  try {
    report = (await deps.build(reportRequest(parsed.body))).report;
  } catch (e) {
    return fail(500, `report failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (report.status !== "final") {
    return fail(409, "Only final reports can be anchored. Finalise the report first.", { status: report.status, draftReasons: report.draftReasons.map((d) => d.code) });
  }
  let cfg: AnchorConfig | null;
  try {
    cfg = deps.config();
  } catch (e) {
    return fail(503, e instanceof Error ? e.message : String(e));
  }
  if (!cfg || !cfg.accountId || !cfg.privateKey) return fail(503, "Anchoring is not configured on this server.");
  try {
    const { anchor, alreadyAnchored } = await anchorFingerprint(deps.client(cfg), cfg, report.fingerprint);
    const body: AnchorResponse = { ...anchor, alreadyAnchored };
    return Response.json(body, { headers: noStore });
  } catch (e) {
    return fail(502, `anchoring failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function handleVerify(fingerprint: string | null, deps: Pick<AnchorDeps, "config" | "client"> = defaultDeps): Promise<Response> {
  const fp = (fingerprint ?? "").trim().toLowerCase();
  if (!FINGERPRINT_RE.test(fp)) return fail(400, "A fingerprint is 64 hexadecimal characters (0-9, a-f).");
  let cfg: AnchorConfig | null;
  try {
    cfg = deps.config();
  } catch (e) {
    return fail(503, e instanceof Error ? e.message : String(e));
  }
  if (!cfg) return fail(503, "Verification is not configured on this server.");
  try {
    const result = await verifyFingerprint(deps.client(cfg), cfg, fp);
    return Response.json({ fingerprint: fp, network: cfg.network, contractId: cfg.contractId, ...result }, { headers: noStore });
  } catch (e) {
    return fail(502, `lookup failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
