import OpenAI from "openai";
import { z } from "zod";
import { createNearClient, type CapturedExchange } from "./client";

export const SAMPLE_TRANSACTION = {
  account: "alice.near",
  direction: "in",
  asset: "USDC",
  amount: 1200,
  counterparty: "acme-studio.near",
  date: "2026-03-03",
  memo: "invoice 0042",
} as const;

export const CATEGORIES = [
  "income_payment",
  "own_wallet_transfer",
  "swap",
  "staking_reward",
  "disposal",
  "unknown",
] as const;

export const ClassificationSchema = z
  .object({
    category: z.enum(CATEGORIES),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1),
  })
  .strict();

export type Classification = z.infer<typeof ClassificationSchema>;

const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string", enum: [...CATEGORIES] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string" },
  },
  required: ["category", "confidence", "reason"],
  additionalProperties: false,
};

const SYSTEM_PROMPT =
  "You classify a single crypto transaction for an individual's tax records. " +
  "Respond with ONLY a JSON object of the form " +
  '{"category": one of ' +
  JSON.stringify(CATEGORIES) +
  ', "confidence": number between 0 and 1, "reason": short string}. ' +
  "No prose, no markdown, no code fences.";

export interface ClassifyAttempt {
  attempt: number;
  ok: boolean;
  error?: string;
  rawContent?: string;
}

export interface ClassifyResult {
  model: string;
  classification: Classification;
  attempts: ClassifyAttempt[];
  /** Chat completion id plus exact bytes of the accepted attempt (for signature verification). */
  evidence: { chatId: string } & CapturedExchange;
}

export class ClassifyError extends Error {
  constructor(
    message: string,
    public readonly attempts: ClassifyAttempt[],
  ) {
    super(message);
    this.name = "ClassifyError";
  }
}

function parseContent(content: string): unknown {
  // Strict: the model must return only JSON. Tolerate surrounding whitespace only.
  return JSON.parse(content.trim());
}

/**
 * Send the sample transaction to the TEE-hosted model and validate the answer
 * with zod. Retries once on an invalid answer, then throws ClassifyError.
 */
export async function classifyTest(model: string): Promise<ClassifyResult> {
  const attempts: ClassifyAttempt[] = [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    let exchange: CapturedExchange | undefined;
    const client = createNearClient((e) => {
      if (e.url.endsWith("/chat/completions")) exchange = e;
    });

    let rawContent: string | undefined;
    try {
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(SAMPLE_TRANSACTION) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "transaction_classification", strict: true, schema: RESPONSE_JSON_SCHEMA },
        },
        // GLM-5.3 Flash reasons by default; "low" keeps reasoning minimal so the
        // answer arrives quickly in `content` (per NEAR reasoning-models docs).
        reasoning_effort: "low",
        temperature: 0,
        stream: false,
      });

      rawContent = completion.choices[0]?.message?.content ?? "";
      const parsed = ClassificationSchema.safeParse(parseContent(rawContent));
      if (!parsed.success) {
        throw new Error(`schema validation failed: ${z.prettifyError(parsed.error)}`);
      }
      if (!exchange) {
        throw new Error("could not capture exact request/response bytes for signature verification");
      }

      attempts.push({ attempt, ok: true, rawContent });
      return {
        model,
        classification: parsed.data,
        attempts,
        evidence: { chatId: completion.id, ...exchange },
      };
    } catch (error) {
      // Non-retryable API errors (auth, billing, bad request) are not "invalid
      // answers": surface them immediately instead of retrying.
      if (error instanceof OpenAI.APIError && error.status && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) {
        attempts.push({ attempt, ok: false, error: `NEAR AI API error ${error.status}: ${error.message}` });
        throw new ClassifyError(`NEAR AI API rejected the completion (HTTP ${error.status}): ${error.message}`, attempts);
      }
      attempts.push({
        attempt,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        rawContent,
      });
    }
  }

  throw new ClassifyError(
    `Model did not return valid classification JSON after ${attempts.length} attempts: ` +
      attempts.map((a) => `#${a.attempt}: ${a.error}`).join(" | "),
    attempts,
  );
}
