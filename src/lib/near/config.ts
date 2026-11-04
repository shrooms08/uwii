// Server-side configuration for NEAR AI Cloud. Never import from client components.

export const NEAR_AI_API_ORIGIN = "https://cloud-api.near.ai";
export const NEAR_AI_BASE_URL = `${NEAR_AI_API_ORIGIN}/v1`;
export const NVIDIA_NRAS_URL = "https://nras.attestation.nvidia.com/v3/attest/gpu";

// Signing algorithm used for both the attestation report and the response
// signature. The docs require the same explicit value on both requests.
export const SIGNING_ALGO = "ecdsa" as const;

// Preferred model. It must also pass the runtime checks in chooseModel():
// listed by /v1/models, owned by NEAR AI's own fleet (Confidential TEE tier),
// ready, and supporting structured output.
export const PREFERRED_MODEL_ID = "z-ai/glm-5.3-flash";

// Intel TDX TCB statuses accepted by our verification policy. The NEAR docs'
// reference helper accepts only "UpToDate".
export const ACCEPTED_TCB_STATUSES = ["UpToDate"];

export const HTTP_TIMEOUT_MS = 90_000;

export function getApiKey(): string {
  const key = process.env.NEAR_AI_API_KEY;
  if (!key || key === "PASTE_KEY_HERE") {
    throw new Error("NEAR_AI_API_KEY is not set in .env.local");
  }
  return key;
}
