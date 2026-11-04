import { chooseModel, type ModelChoice } from "./models";
import { ClassifyError, classifyTest, type ClassifyResult } from "./classify";
import { preflightAttestation, summarizeAttestation, verifyResponse, type AttestationResult } from "./attestation";

export interface Phase1Result {
  model: ModelChoice | null;
  classification: ClassifyResult | null;
  classificationError: string | null;
  attestation: AttestationResult;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Phase 1 end-to-end check, shared by /dev/attest and `npm run check:attestation`:
 * choose model -> preflight attestation -> classify -> verify response signature.
 */
export async function runPhase1(): Promise<Phase1Result> {
  let model: ModelChoice;
  try {
    model = await chooseModel();
  } catch (e) {
    return {
      model: null,
      classification: null,
      classificationError: null,
      attestation: {
        verified: false,
        details: `Failed step: choose model — ${errMsg(e)}`,
        rawAttestationSummary: {},
      },
    };
  }

  // Preflight evidence must be verified and retained before the completion.
  const preflight = await preflightAttestation(model.id);

  let classification: ClassifyResult | null = null;
  let classificationError: string | null = null;
  try {
    classification = await classifyTest(model.id);
  } catch (e) {
    classificationError = e instanceof ClassifyError ? e.message : errMsg(e);
  }

  const response = classification ? await verifyResponse(preflight, classification.evidence) : null;
  const attestation = summarizeAttestation(
    preflight,
    response,
    classificationError ? `no valid completion to verify: ${classificationError}` : undefined,
  );

  return { model, classification, classificationError, attestation };
}
