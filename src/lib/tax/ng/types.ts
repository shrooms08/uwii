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

/** The rule/AI classification a user answer replaced. */
export interface PreviousClassification {
  label: LabelId;
  method: ClassificationMethod;
  confidence: number;
  reason: string;
  ai?: AiEvidence;
}

/** Evidence on a user-labelled record. */
export interface UserEvidence {
  previous: PreviousClassification;
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
  evidence?: AiEvidence | UserEvidence;
  /** Naira amount paid/received for P2P answers (exact decimal string). */
  userFiat?: { ngn: string };
  /** The swap source leg is not in the captured data (e.g. inside NEAR Intents). */
  incompleteSourceLeg?: boolean;
};

export const isAiEvidence = (e: ClassifiedTx["evidence"]): e is AiEvidence => !!e && "chatId" in e;

export interface AiResponseRecord {
  batch: number;
  attempt: number;
  chatId: string | null;
  txCount: number;
  valid: boolean;
  signatureVerified: boolean;
  detail: string;
  /** Address that signed this response (when the signature was fetched). */
  signingAddress?: string;
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
  attestation: {
    verified: boolean;
    details: string;
    nonce: string | null;
    /** Preflight checks passed / run (absent on runs recorded before this field existed). */
    checksPassed?: number;
    checksTotal?: number;
    /** Signing identities of the verified gateway and model reports. */
    reportSigners?: { label: string; address: string; verified: boolean }[];
    /** When the attestation reports were verified. */
    attestedAt?: string;
  };
  aiResponses: AiResponseRecord[];
  metrics: ClassificationMetrics;
  records: ClassifiedTx[];
}
