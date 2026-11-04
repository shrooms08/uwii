import OpenAI from "openai";
import { HTTP_TIMEOUT_MS, NEAR_AI_BASE_URL, getApiKey } from "./config";

/** Exact bytes of one HTTP exchange, needed to verify a response signature. */
export interface CapturedExchange {
  url: string;
  requestBody: string;
  responseBody: string;
  status: number;
}

/**
 * OpenAI SDK client pointed at NEAR AI Cloud.
 *
 * Response signatures cover SHA-256 of the exact request and response bytes,
 * so we wrap fetch to capture what the SDK actually sent and received instead
 * of re-serializing JSON afterwards.
 */
export function createNearClient(onExchange?: (exchange: CapturedExchange) => void) {
  const capturingFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (onExchange && typeof init?.body === "string") {
      const responseBody = await response.clone().text();
      onExchange({
        url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        requestBody: init.body,
        responseBody,
        status: response.status,
      });
    }
    return response;
  };

  return new OpenAI({
    baseURL: NEAR_AI_BASE_URL,
    apiKey: getApiKey(),
    timeout: HTTP_TIMEOUT_MS,
    maxRetries: 1,
    // Fail instead of silently rewriting the model ID: the canonical model ID
    // is part of the provider_tee signed text.
    defaultHeaders: { "x-no-aliasing": "true" },
    fetch: capturingFetch,
  });
}
