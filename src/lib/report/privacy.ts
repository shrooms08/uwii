/** Privacy evidence (TEE attestation + response signatures) for the report; shared by server and browser. */
import type { ClassifiedRun } from "../tax/ng/types";

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
  /** Why parts are not available, if any. */
  missing: string[];
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
