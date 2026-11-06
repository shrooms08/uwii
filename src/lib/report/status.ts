/**
 * Report status: a report built on unresolved items is a DRAFT and must never look final.
 *
 * Draft if any of: an unresolved record remains (label unknown / needsQuestion); a
 * missing_acquisition_history warning (nil cost used, gains may be overstated); an acquisition_swap
 * with an incomplete source leg. A scan whose TEE attestation failed while the AI step was needed
 * is always a draft, even after every question is answered. No-verifiable-price exclusions (9.2(4)) and NFEM rate fallbacks (D8)
 * are documented treatments and do not by themselves make a report a draft.
 */

export type ReportStatus = "final" | "draft";

export interface DraftReason {
  code: "unresolved_records" | "missing_acquisition_history" | "incomplete_source_leg" | "attestation_unverified";
  message: string;
  relatedIds: string[];
}

export interface StatusInput {
  /** Records after rules, AI and user answers. */
  records: { id: string; needsQuestion: boolean; label: string }[];
  warnings: { code: string; recordId?: string }[];
  /** Question groups (Phase 4 grouping) with their record ids. */
  questions: { groupId: string; txs: { id: string }[] }[];
  /** The scan's TEE attestation: when the AI step was needed but not verified, the report can never be final. */
  attestation?: { verified: boolean; aiNeeded: boolean };
}

export interface StatusResult {
  status: ReportStatus;
  draftReasons: DraftReason[];
  /** Question groups that still contain an unresolved record. */
  blockingQuestions: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ids = (warnings: StatusInput["warnings"], code: string) => [...new Set(warnings.filter((w) => w.code === code && w.recordId).map((w) => w.recordId!))];

export function reportStatus(input: StatusInput): StatusResult {
  const unresolved = input.records.filter((r) => r.needsQuestion || r.label === "unknown").map((r) => r.id);
  const unresolvedSet = new Set(unresolved);
  const blockingQuestions = input.questions.filter((q) => q.txs.some((t) => unresolvedSet.has(t.id))).length;
  const draftReasons: DraftReason[] = [];

  if (unresolved.length) {
    draftReasons.push({
      code: "unresolved_records",
      message:
        `${plural(unresolved.length, "transaction")} still ${unresolved.length === 1 ? "needs" : "need"} your answer` +
        `${blockingQuestions ? ` (${plural(blockingQuestions, "question")})` : ""}. Until answered, ${unresolved.length === 1 ? "it is" : "they are"} left out of the totals, ` +
        "and anything bought or sold with those funds may show a gain or loss that is not real.",
      relatedIds: unresolved,
    });
  }
  const missing = ids(input.warnings, "missing_acquisition_history");
  const missingCount = input.warnings.filter((w) => w.code === "missing_acquisition_history").length;
  if (missingCount) {
    draftReasons.push({
      code: "missing_acquisition_history",
      message:
        `${plural(missingCount, "disposal")} used more of an asset than the recorded acquisitions; the shortfall was given a nil cost, ` +
        "which overstates the gain. Answer the open questions or declare your other wallets so the acquisitions are recorded.",
      relatedIds: missing,
    });
  }
  const incomplete = ids(input.warnings, "incomplete_source_leg");
  if (incomplete.length) {
    draftReasons.push({
      code: "incomplete_source_leg",
      message:
        `${plural(incomplete.length, "swap")} via NEAR Intents ${incomplete.length === 1 ? "has" : "have"} no captured source leg; ` +
        "the cost uses the dollar value received (9.1.2 Step 1(b)) until the source transaction is available.",
      relatedIds: incomplete,
    });
  }
  if (input.attestation?.aiNeeded && !input.attestation.verified) {
    draftReasons.push({
      code: "attestation_unverified",
      message: "The private AI's hardware attestation could not be verified for this scan, so its results cannot be used for a final report. Scan the account again.",
      relatedIds: [],
    });
  }
  return { status: draftReasons.length ? "draft" : "final", draftReasons, blockingQuestions };
}
