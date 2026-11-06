/**
 * Handlers for /api/anchor and /api/verify, with injectable dependencies for tests. The report is
 * recomputed server-side from the request body; only its fingerprint (and "final") is sent on-chain.
 * Nothing here logs.
 */
import { FINGERPRINT_RE, anchorConfig, anchorFingerprint, nearAnchorClient, verifyFingerprint, type AnchorClient, type AnchorConfig, type AnchorInfo } from "@/lib/near/anchor";
import { DailyCap, clientKey, limitState, tooManyRequests } from "@/lib/server/limits";
import { serverError } from "@/lib/server/errors";
import { NotScannedError } from "@/lib/tax/ng/cache";
import { buildReport, type ReportData, type ReportRequest } from "@/lib/tax/ng/report";
import { noStore, parseReportBody, resolveReportRequest } from "./report-body";

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

/** A hosted-demo limit stopped a new anchor transaction. */
class LimitHit extends Error {
  constructor(
    readonly code: "rate_limited" | "daily_cap",
    readonly retryAfterSec: number,
  ) {
    super(code);
  }
}

const ANCHOR_BUSY = "The hosted demo has reached its anchoring limit. Try again later; your report and fingerprint are unaffected.";

export async function handleAnchor(request: Request, deps: AnchorDeps = defaultDeps): Promise<Response> {
  // Per-IP limit first: every anchor request rebuilds a report, so it is limited before any work (N3).
  const perIp = limitState().anchorPerIp.hit(clientKey(request));
  if (!perIp.ok) return tooManyRequests("rate_limited", perIp.retryAfterSec, ANCHOR_BUSY);
  const parsed = await parseReportBody(request);
  if (!parsed.ok) return parsed.response;
  const resolved = await resolveReportRequest(parsed.body);
  if (!resolved.ok) return resolved.response;
  let report: ReportData;
  try {
    report = (await deps.build(resolved.req)).report;
  } catch (e) {
    if (e instanceof NotScannedError) return fail(409, e.message, { code: "not_scanned" });
    return serverError("anchor: report", e);
  }
  if (report.status !== "final") {
    return fail(409, "Only final reports can be anchored. Finalise the report first.", { status: report.status, draftReasons: report.draftReasons.map((d) => d.code) });
  }
  let cfg: AnchorConfig | null;
  try {
    cfg = deps.config();
  } catch (e) {
    return serverError("anchor: config", e, 503);
  }
  if (!cfg || !cfg.accountId || !cfg.privateKey) return fail(503, "Anchoring is not configured on this server.");
  try {
    const limits = limitState();
    const { anchor, alreadyAnchored } = await anchorFingerprint(deps.client(cfg), cfg, report.fingerprint, () => {
      // The global daily cap counts only new anchor transactions.
      if (limits.anchorsDaily.remaining() < 1) throw new LimitHit("daily_cap", DailyCap.secondsToReset());
      limits.anchorsDaily.add(1);
    });
    const body: AnchorResponse = { ...anchor, alreadyAnchored };
    return Response.json(body, { headers: noStore });
  } catch (e) {
    if (e instanceof LimitHit) return tooManyRequests(e.code, e.retryAfterSec, ANCHOR_BUSY);
    return serverError("anchor: transaction", e, 502);
  }
}

export async function handleVerify(fingerprint: string | null, deps: Pick<AnchorDeps, "config" | "client"> = defaultDeps): Promise<Response> {
  const fp = (fingerprint ?? "").trim().toLowerCase();
  if (!FINGERPRINT_RE.test(fp)) return fail(400, "A fingerprint is 64 hexadecimal characters (0-9, a-f).");
  let cfg: AnchorConfig | null;
  try {
    cfg = deps.config();
  } catch (e) {
    return serverError("verify: config", e, 503);
  }
  if (!cfg) return fail(503, "Verification is not configured on this server.");
  try {
    const result = await verifyFingerprint(deps.client(cfg), cfg, fp);
    return Response.json({ fingerprint: fp, network: cfg.network, contractId: cfg.contractId, ...result }, { headers: noStore });
  } catch (e) {
    return serverError("verify: lookup", e, 502);
  }
}
