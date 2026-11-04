import { PREFERRED_MODEL_ID } from "./config";
import { createNearClient } from "./client";

export interface ModelChoice {
  id: string;
  reason: string;
}

// Extra fields NEAR AI Cloud adds to the OpenAI model object.
interface NearModel {
  id: string;
  owned_by?: string;
  is_ready?: boolean;
  supported_features?: string[];
  description?: string;
}

/**
 * List models via the OpenAI SDK and confirm the preferred model is a NEAR
 * "Confidential TEE" model (NEAR's own GPU fleet: owned_by "nearai", as
 * opposed to "attested 3p" or third-party Incognito providers) that is ready
 * and supports structured output. Model attestation later proves the TEE claim
 * cryptographically; this check only gates the choice.
 */
export async function chooseModel(): Promise<ModelChoice> {
  const client = createNearClient();
  const models: NearModel[] = [];
  for await (const model of client.models.list()) {
    models.push(model as unknown as NearModel);
  }

  const model = models.find((m) => m.id === PREFERRED_MODEL_ID);
  if (!model) {
    throw new Error(`Model ${PREFERRED_MODEL_ID} is not listed by /v1/models (${models.length} models listed)`);
  }
  const features = model.supported_features ?? [];
  const problems: string[] = [];
  if (model.owned_by !== "nearai") problems.push(`owned_by is "${model.owned_by}", not "nearai"`);
  if (model.is_ready === false) problems.push("is_ready is false");
  if (!features.includes("structured_outputs") && !features.includes("json_mode")) {
    problems.push(`supported_features lacks structured_outputs/json_mode (${features.join(",")})`);
  }
  if (problems.length > 0) {
    throw new Error(`Model ${PREFERRED_MODEL_ID} rejected: ${problems.join("; ")}`);
  }

  return {
    id: model.id,
    reason:
      `owned_by="nearai" (NEAR AI's own TEE GPU fleet, the "Confidential TEE" tier in the docs; ` +
      `the docs' own attestation example uses this model), is_ready=${model.is_ready ?? "unset"}, ` +
      `supported_features=[${features.join(", ")}]`,
  };
}
