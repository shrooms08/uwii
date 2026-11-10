/** Building classified records and their metrics, with no AI or Node imports (shared by server and browser). */
import type { NormalizedTx } from "../../history/types";
import { LABELS, isKnownAsset, knownAssetCategory, type AssetCategory, type LabelId } from "./labels";
import type { AiEvidence, AiResponseRecord, ClassificationMetrics, ClassifiedTx } from "./types";

export const CONFIDENCE_THRESHOLD = 0.8;

// ---------- building classified records (circularRef always from labels.ts) ----------

export interface Decision {
  label: LabelId;
  assetCategory?: AssetCategory;
  confidence: number;
  method: "rule" | "ai" | "user" | "unlabelled";
  reason: string;
  pairingId?: string;
  swapRole?: "disposed" | "acquired";
  evidence?: AiEvidence;
  /** Force a user question regardless of confidence (e.g. signature not verified). */
  forceQuestion?: boolean;
}

export function toClassified(tx: NormalizedTx, d: Decision): ClassifiedTx {
  const category: AssetCategory = isKnownAsset(tx.asset) ? knownAssetCategory(tx.asset) : (d.assetCategory ?? knownAssetCategory(tx.asset));
  const out: ClassifiedTx = {
    ...tx,
    label: d.label,
    assetCategory: category,
    confidence: d.confidence,
    method: d.method,
    reason: d.reason,
    circularRef: LABELS[d.label].circularRef,
    needsQuestion: d.forceQuestion === true || d.label === "unknown" || d.confidence < CONFIDENCE_THRESHOLD,
  };
  if (d.pairingId) out.pairingId = d.pairingId;
  if (d.swapRole) out.swapRole = d.swapRole;
  if (d.evidence) out.evidence = d.evidence;
  return out;
}

export function computeMetrics(records: ClassifiedTx[], aiResponses: AiResponseRecord[], attestationVerified: boolean, aiSkipped?: number): ClassificationMetrics {
  const total = records.length;
  const count = (m: string) => records.filter((r) => r.method === m).length;
  const pct = (n: number) => (total ? `${((n * 100) / total).toFixed(1)}%` : "0%");
  const rule = count("rule");
  const ai = count("ai");
  return {
    total,
    rule,
    ai,
    user: count("user"),
    pctRule: pct(rule),
    pctAi: pct(ai),
    needsQuestion: records.filter((r) => r.needsQuestion).length,
    aiResponses: aiResponses.filter((r) => r.chatId).length,
    aiResponsesVerified: aiResponses.filter((r) => r.signatureVerified).length,
    attestationVerified,
    ...(aiSkipped ? { aiSkipped } : {}),
  };
}
