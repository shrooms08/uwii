/** Small privacy-proof summaries used by pages that only lazy-load the full PrivacyPanel. */
import type { PrivacyProof } from "./privacy";

/** Every recorded check passed and every AI decision has a verified response signature. */
export function proofAllVerified(p: PrivacyProof): boolean {
  return (
    p.aiDecisions > 0 &&
    p.gatewayAndModelReportsVerified === true &&
    p.checksPassed !== null &&
    p.checksPassed === p.checksTotal &&
    p.aiResponses > 0 &&
    p.aiResponsesVerified === p.aiResponses &&
    p.aiDecisionsSignatureVerified === p.aiDecisions &&
    (p.checks ?? []).every((c) => c.ok)
  );
}

/** Passed / total over every recorded check (preflight + signatures), or the stored preflight counts. */
export function proofCounts(p: PrivacyProof): { passed: number; total: number } | null {
  if (p.checksRecorded && p.checks.length) return { passed: p.checks.filter((c) => c.ok).length, total: p.checks.length };
  if (p.checksPassed !== null && p.checksTotal !== null) return { passed: p.checksPassed, total: p.checksTotal };
  return null;
}
