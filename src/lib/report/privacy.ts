/** Privacy evidence (TEE attestation + response signatures) for the report; shared by server and browser. */
import type { ClassifiedRun } from "../tax/ng/types";

/** One verification step that actually ran, grouped for display. */
export interface ProofCheck {
  group: "report" | "gateway" | "model" | "signature";
  /** Report label within the group ("gateway", "model #1") or the response chat id for signatures. */
  subject: string;
  step: string;
  ok: boolean;
  detail: string;
}

/** AI evidence for one record from the stored classification run (before any user answer). */
export interface AiRecordEvidence {
  recordId: string;
  chatId: string;
  signatureVerified: boolean;
  detail: string | null;
}

export interface PrivacyProof {
  available: boolean;
  model: string | null;
  gatewayAndModelReportsVerified: boolean | null;
  checksPassed: number | null;
  checksTotal: number | null;
  /** Records the AI classified in the stored classification run. */
  aiDecisions: number;
  aiDecisionsSignatureVerified: number;
  aiResponses: number;
  aiResponsesVerified: number;
  signerAddresses: string[];
  attestedAt: string | null;
  /** Fresh nonce bound into the attestation reports. */
  nonce: string | null;
  /** Signing identities of the attested gateway and model reports. */
  reportSigners: { label: string; address: string; verified: boolean }[];
  /** Every check that ran (attestation preflight + response signatures); empty if the run predates recording them. */
  checks: ProofCheck[];
  checksRecorded: boolean;
  /** Per-record AI evidence (records the AI classified, including ones a user answer later replaced). */
  aiEvidence: AiRecordEvidence[];
  /** Why parts are not available, if any. */
  missing: string[];
}

function groupPreflight(step: string): Pick<ProofCheck, "group" | "subject" | "step"> {
  const m = /^(gateway|model[^:]*): (.*)$/.exec(step);
  if (!m) return { group: "report", subject: "attestation report", step };
  return { group: m[1] === "gateway" ? "gateway" : "model", subject: m[1], step: m[2] };
}

export function privacyProofFromRun(run: ClassifiedRun): PrivacyProof {
  const ai = run.records.filter((r) => r.method === "ai");
  const verifiedDecisions = ai.filter((r) => r.evidence && "signatureVerified" in r.evidence && r.evidence.signatureVerified === true).length;
  const responses = run.aiResponses.filter((r) => r.chatId);
  const signers = [...new Set(responses.filter((r) => r.signatureVerified && r.signingAddress).map((r) => r.signingAddress!.toLowerCase()))];
  const a = run.attestation;
  const missing: string[] = [];
  if (ai.length === 0) missing.push("no AI decisions in this run (every record matched a deterministic rule); attestation was not needed");
  if (a.checksPassed === undefined) missing.push("attestation check count not recorded for this classification run");
  if (!a.attestedAt) missing.push("attestation time not recorded for this classification run");
  if (ai.length > 0 && signers.length === 0) missing.push("response signer addresses not recorded for this classification run");
  const checksRecorded = Array.isArray(a.checks) && responses.every((r) => Array.isArray(r.signatureChecks));
  if (ai.length > 0 && !checksRecorded) missing.push("individual check results not recorded for this classification run (a new scan records them)");
  const checks: ProofCheck[] = [
    ...(a.checks ?? []).map((c) => ({ ...groupPreflight(c.step), ok: c.ok, detail: c.detail })),
    ...responses.flatMap((r) => (r.signatureChecks ?? []).map((c) => ({ group: "signature" as const, subject: r.chatId!, step: c.step, ok: c.ok, detail: c.detail }))),
  ];
  const aiEvidence: AiRecordEvidence[] = [];
  for (const r of run.records) {
    const e = r.evidence;
    if (e && "chatId" in e) aiEvidence.push({ recordId: r.id, chatId: e.chatId, signatureVerified: e.signatureVerified, detail: e.detail ?? null });
  }
  return {
    available: ai.length > 0 && a.checksPassed !== undefined && !!a.attestedAt && signers.length > 0,
    model: run.model,
    gatewayAndModelReportsVerified: ai.length > 0 ? a.verified : null,
    checksPassed: a.checksPassed ?? null,
    checksTotal: a.checksTotal ?? null,
    aiDecisions: ai.length,
    aiDecisionsSignatureVerified: verifiedDecisions,
    aiResponses: responses.length,
    aiResponsesVerified: responses.filter((r) => r.signatureVerified).length,
    signerAddresses: signers,
    attestedAt: a.attestedAt ?? null,
    nonce: a.nonce,
    reportSigners: a.reportSigners ?? [],
    checks,
    checksRecorded,
    aiEvidence,
    missing,
  };
}

const na = "not available";

/** Plain-English summary used on the page and in the PDF. */
export function privacyProofText(p: PrivacyProof): string {
  const checks = p.checksPassed === null ? na : `${p.checksPassed}${p.checksTotal !== null && p.checksTotal !== p.checksPassed ? ` of ${p.checksTotal}` : ""} checks`;
  const attest =
    p.gatewayAndModelReportsVerified === null
      ? "gateway and model attestation: not needed (no AI decisions)"
      : `gateway and model attestation ${p.gatewayAndModelReportsVerified ? "verified" : "NOT verified"} (${checks})`;
  return (
    `Transaction classification ran on NEAR AI Cloud in a TEE${p.model ? ` (model ${p.model})` : ""}. ` +
    `${p.aiDecisionsSignatureVerified}/${p.aiDecisions} AI decisions had verified response signatures; ${attest}. ` +
    `Signer(s): ${p.signerAddresses.length ? p.signerAddresses.join(", ") : na}. ` +
    `Attested at: ${p.attestedAt ?? na}.`
  );
}
