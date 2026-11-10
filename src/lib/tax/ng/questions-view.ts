/**
 * What the Questions page shows for a question-flow result: the questions, a light view of every record
 * and the assets the account holds (choices for a source-leg answer). Pure (shared by the browser and the
 * developer-only /api/questions route).
 */
import { sanitizeSymbol } from "../../history/sanitize";
import type { QuestionFlowResult } from "./questions";
import type { ClassifiedRun } from "./types";

export interface AssetChoice {
  symbol: string;
  contract: string | null;
}

export function questionsView(run: ClassifiedRun, flow: QuestionFlowResult) {
  const records = flow.records.map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    kind: r.kind,
    direction: r.direction,
    asset: r.asset.symbol,
    amount: r.amount,
    counterparty: r.counterparty,
    label: r.label,
    method: r.method,
    confidence: r.confidence,
    needsQuestion: r.needsQuestion,
    circularRef: r.circularRef,
    reason: r.reason,
    userFiat: r.userFiat ?? null,
    incompleteSourceLeg: r.incompleteSourceLeg ?? false,
    previousLabel: r.evidence && "previous" in r.evidence ? r.evidence.previous.label : null,
  }));
  // Assets seen in this account (for the "what did you give up" source-leg answer).
  const assetMap = new Map<string, AssetChoice>();
  for (const r of run.records) assetMap.set(r.asset.contract ?? "native", { symbol: sanitizeSymbol(r.asset.symbol), contract: r.asset.contract });
  return { questions: flow.questions, summary: flow.summary, metrics: flow.metrics, records, assets: [...assetMap.values()] };
}

export type QuestionsView = ReturnType<typeof questionsView>;
