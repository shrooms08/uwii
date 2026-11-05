import type { NormalizedTx } from "../../history/types";
import type { AssetCategory, LabelId } from "./labels";

export type ClassificationMethod = "rule" | "ai" | "user";

export interface AiEvidence {
  chatId: string;
  signatureVerified: boolean;
  model: string;
  attempt: number;
  /** Why the signature (or the request) failed, when it did. */
  detail?: string;
}

export type ClassifiedTx = NormalizedTx & {
  label: LabelId;
  assetCategory: AssetCategory;
  confidence: number;
  method: ClassificationMethod;
  reason: string;
  /** Always taken from labels.ts for `label`. */
  circularRef: string;
  needsQuestion: boolean;
  /** Links the legs of one swap (same txHash). */
  pairingId?: string;
  /** For swap legs: the asset given up, or the asset received in exchange. */
  swapRole?: "disposed" | "acquired";
  evidence?: AiEvidence;
};

export interface AiResponseRecord {
  batch: number;
  attempt: number;
  chatId: string | null;
  txCount: number;
  valid: boolean;
  signatureVerified: boolean;
  detail: string;
}

export interface ClassificationMetrics {
  total: number;
  rule: number;
  ai: number;
  user: number;
  pctRule: string;
  pctAi: string;
  needsQuestion: number;
  aiResponses: number;
  aiResponsesVerified: number;
  attestationVerified: boolean;
}

export const CLASSIFIED_SCHEMA_VERSION = 1;

export interface ClassifiedRun {
  schemaVersion: number;
  accountId: string;
  from: string;
  to: string;
  ownAccounts: string[];
  /** fetchedAt of the history this run classified. */
  historyFetchedAt: string;
  classifiedAt: string;
  model: string | null;
  attestation: { verified: boolean; details: string; nonce: string | null };
  aiResponses: AiResponseRecord[];
  metrics: ClassificationMetrics;
  records: ClassifiedTx[];
}
