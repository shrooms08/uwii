/**
 * Phase 4 question flow: re-run rules with the user's own accounts, group the remaining
 * needsQuestion records into one plain-English question per (counterparty, direction), and apply
 * answers as method "user" labels. Pure functions: answers are never stored or logged here.
 */
import { formatUnits } from "../../history/amount";
import { sanitizeSymbol } from "../../history/sanitize";
import { toUnits } from "../../history/summary";
import type { NormalizedTx } from "../../history/types";
import { computeMetrics, toClassified } from "./classify";
import type { LabelId } from "./labels";
import { applyRules } from "./rules";
import { USER_SOURCE_LEG_NOTE, normalizeSourceLeg, type SourceLegInput } from "./source-leg";
import type { ClassificationMetrics, ClassifiedRun, ClassifiedTx, UserSourceLeg } from "./types";

// ---------- options ----------

export interface AnswerOption {
  id: string;
  text: string;
  label: LabelId;
  /** Naira amount required per transaction. */
  followUp?: "ngn_paid" | "ngn_received";
  /** Answer leaves the record unresolved. */
  unresolved?: true;
  incompleteSourceLeg?: true;
  note?: string;
}

export const INCOMING_OPTIONS: AnswerOption[] = [
  { id: "own_wallet", text: "My own wallet", label: "own_wallet_transfer" },
  { id: "client", text: "A client paid me for work", label: "income_professional_fees" },
  { id: "employer", text: "My employer (salary)", label: "income_employment" },
  { id: "business_sales", text: "Sales from my business", label: "income_business" },
  { id: "gift_received", text: "A gift from friend or family", label: "gift_received" },
  { id: "loan_received", text: "A loan I must repay", label: "loan_received" },
  { id: "airdrop", text: "An airdrop or reward", label: "income_airdrop" },
  { id: "p2p_buy", text: "I bought it with naira (P2P)", label: "acquisition_fiat", followUp: "ngn_paid" },
  { id: "dont_know", text: "I don't know", label: "unknown", unresolved: true },
];

export const OUTGOING_OPTIONS: AnswerOption[] = [
  { id: "own_wallet", text: "My own wallet", label: "own_wallet_transfer" },
  { id: "paid_goods", text: "I paid for goods or services", label: "disposal_payment" },
  { id: "gift_given", text: "A gift to someone", label: "gift_given" },
  { id: "p2p_sell", text: "I sold it for naira (P2P)", label: "disposal_sale_fiat", followUp: "ngn_received" },
  { id: "loan_repayment", text: "Repaying a loan", label: "loan_repayment" },
  { id: "dont_know", text: "I don't know", label: "unknown", unresolved: true },
];

export const INTENTS_SWAP_NOTE =
  "source leg inside NEAR Intents not captured; cost base uses dollar FMV of asset received (9.1.2 Step 1(b)) pending source data";

export const INTENTS_OPTIONS: AnswerOption[] = [
  { id: "intents_swap", text: "A swap I made on NEAR Intents", label: "acquisition_swap", incompleteSourceLeg: true, note: INTENTS_SWAP_NOTE },
  ...INCOMING_OPTIONS,
];

// ---------- grouping ----------

export type GroupType = "incoming" | "outgoing" | "intents";

export interface QuestionTx {
  id: string;
  timestamp: string;
  asset: string;
  amount: string;
  txHash: string;
  currentLabel: LabelId;
  reason: string;
}

export interface Question {
  groupId: string;
  type: GroupType;
  direction: NormalizedTx["direction"];
  counterparty: string | null;
  text: string;
  totals: { asset: string; total: string }[];
  options: AnswerOption[];
  txs: QuestionTx[];
}

export const INTENTS_ACCOUNT = "intents.near";
const IMPLICIT_RE = /^[0-9a-f]{64}$/;

export const shortAccount = (a: string | null) => (a === null ? "an unknown account" : IMPLICIT_RE.test(a) ? `${a.slice(0, 8)}…` : a);

/** Display rounding to 2 dp (half-up, BigInt); amounts below 0.01 are shown exactly. */
export function displayAmount(amount: string, decimals: number): string {
  const units = toUnits(amount, decimals);
  if (decimals <= 2) return formatUnits(units, decimals);
  const step = BigInt(10) ** BigInt(decimals - 2);
  if (units < step) return amount;
  const rounded = ((units + step / BigInt(2)) / step) * step;
  return formatUnits(rounded, decimals);
}

export const groupIdOf = (tx: NormalizedTx) =>
  tx.counterparty === INTENTS_ACCOUNT && tx.direction === "in" ? `intents:in:${INTENTS_ACCOUNT}` : `${tx.direction}:${tx.counterparty ?? "-"}`;

/** One question per (counterparty, direction) over records that still need a question; intents.near inflows are their own type. */
export function groupQuestions(records: ClassifiedTx[]): Question[] {
  const groups = new Map<string, ClassifiedTx[]>();
  for (const r of records) {
    if (!r.needsQuestion) continue;
    const id = groupIdOf(r);
    const list = groups.get(id) ?? [];
    list.push(r);
    groups.set(id, list);
  }
  const questions: Question[] = [];
  for (const [groupId, txs] of groups) {
    const first = txs[0];
    const type: GroupType = groupId.startsWith("intents:") ? "intents" : first.direction === "in" ? "incoming" : "outgoing";
    const sums = new Map<string, { decimals: number; sum: bigint }>();
    for (const t of txs) {
      const s = sums.get(t.asset.symbol) ?? { decimals: t.asset.decimals, sum: BigInt(0) };
      s.sum += toUnits(t.amount, t.asset.decimals);
      sums.set(t.asset.symbol, s);
    }
    const totals = [...sums.entries()].map(([asset, s]) => ({ asset, total: formatUnits(s.sum, s.decimals) }));
    const totalText = [...sums.entries()].map(([asset, s]) => `${displayAmount(formatUnits(s.sum, s.decimals), s.decimals)} ${asset}`).join(" + ");
    const assets = [...sums.keys()].join(" and ");
    const times = txs.length === 1 ? "once" : `${txs.length} times`;
    const who = shortAccount(first.counterparty);
    const text =
      type === "intents"
        ? `You received ${assets} from NEAR Intents (${INTENTS_ACCOUNT}) ${times} (total ${totalText}). What was this?`
        : type === "incoming"
          ? `You received ${assets} from ${who} ${times} (total ${totalText}). Who is this?`
          : `You sent ${assets} to ${who} ${times} (total ${totalText}). Who is this, and what was it for?`;
    questions.push({
      groupId,
      type,
      direction: first.direction,
      counterparty: first.counterparty,
      text,
      totals,
      options: type === "intents" ? INTENTS_OPTIONS : type === "incoming" ? INCOMING_OPTIONS : OUTGOING_OPTIONS,
      txs: txs
        .slice()
        .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))
        .map((t) => ({ id: t.id, timestamp: t.timestamp, asset: t.asset.symbol, amount: t.amount, txHash: t.txHash, currentLabel: t.label, reason: t.reason })),
    });
  }
  return questions.sort((a, b) => (a.txs[0].timestamp < b.txs[0].timestamp ? -1 : 1));
}

// ---------- answers ----------

export interface GroupAnswer {
  /** Option id applied to every transaction in the group. */
  option: string;
  /** Per-transaction option override, keyed by record id. */
  overrides?: Record<string, string>;
  /** Naira amounts for P2P options, keyed by record id (decimal string, up to 2 dp). */
  ngn?: Record<string, string>;
  /** NEAR Intents swaps: what was given up, keyed by record id (timestamp defaults to the receipt time). */
  sourceLegs?: Record<string, SourceLegInput>;
}

export interface Answers {
  groups: Record<string, GroupAnswer>;
}

export interface Profile {
  /** Other taxable income in 2026 (NGN), decimal string. For Phase 5 (D6). */
  otherIncomeNgn?: string;
}

export const NGN_RE = /^\d{1,15}(\.\d{1,2})?$/;

export interface ApplySummary {
  resolvedByUser: number;
  answeredDontKnow: number;
  unresolved: number;
  missingFollowUps: { groupId: string; txId: string; option: string }[];
  invalid: string[];
}

const NORMALIZED_KEYS = ["id", "txHash", "timestamp", "direction", "kind", "asset", "amount", "counterparty", "method", "success", "source", "raw", "fee"] as const;

/** The NormalizedTx underneath a classified record (drops every classification field). */
export function baseTx(c: ClassifiedTx): NormalizedTx {
  const out: Record<string, unknown> = {};
  for (const k of NORMALIZED_KEYS) out[k] = c[k];
  return out as unknown as NormalizedTx;
}

function applyOption(c: ClassifiedTx, option: AnswerOption, ngn: string | undefined, sourceLeg?: UserSourceLeg): ClassifiedTx {
  const note = option.incompleteSourceLeg && sourceLeg ? USER_SOURCE_LEG_NOTE : option.note;
  const reason = `User answer: ${option.text}${note ? ` — ${note}` : ""}`;
  const next = toClassified(baseTx(c), {
    label: option.label,
    assetCategory: c.assetCategory,
    confidence: 1,
    method: "user",
    reason,
    forceQuestion: option.unresolved === true,
  });
  next.evidence = {
    previous: {
      label: c.label,
      method: c.method,
      confidence: c.confidence,
      reason: c.reason,
      ...(c.evidence && "chatId" in c.evidence ? { ai: c.evidence } : {}),
    },
  };
  if (ngn !== undefined) next.userFiat = { ngn };
  if (option.incompleteSourceLeg) {
    if (sourceLeg) next.userSourceLeg = sourceLeg;
    else next.incompleteSourceLeg = true;
  }
  return next;
}

/** Apply group answers (with per-transaction overrides). Records needing a naira amount stay unchanged until it is given. */
export function applyAnswers(records: ClassifiedTx[], questions: Question[], answers: Answers): { records: ClassifiedTx[]; summary: ApplySummary } {
  const byId = new Map(records.map((r) => [r.id, r]));
  const summary: ApplySummary = { resolvedByUser: 0, answeredDontKnow: 0, unresolved: 0, missingFollowUps: [], invalid: [] };
  for (const q of questions) {
    const ga = answers.groups[q.groupId];
    if (!ga) continue;
    for (const qt of q.txs) {
      const optionId = ga.overrides?.[qt.id] ?? ga.option;
      const option = q.options.find((o) => o.id === optionId);
      if (!option) {
        summary.invalid.push(`${q.groupId}/${qt.id}: unknown option "${optionId}"`);
        continue;
      }
      const current = byId.get(qt.id);
      if (!current) continue;
      let ngn: string | undefined;
      if (option.followUp) {
        ngn = ga.ngn?.[qt.id]?.trim();
        if (!ngn || !NGN_RE.test(ngn)) {
          summary.missingFollowUps.push({ groupId: q.groupId, txId: qt.id, option: option.id });
          continue;
        }
      }
      let sourceLeg: UserSourceLeg | undefined;
      const legInput = option.incompleteSourceLeg ? ga.sourceLegs?.[qt.id] : undefined;
      if (legInput) {
        const v = normalizeSourceLeg(legInput, current.timestamp);
        if (v.ok) sourceLeg = v.leg;
        else summary.invalid.push(`${q.groupId}/${qt.id}: source leg ${v.error}`);
      }
      byId.set(qt.id, applyOption(current, option, ngn, sourceLeg));
    }
  }
  const out = records.map((r) => byId.get(r.id)!);
  summary.resolvedByUser = out.filter((r) => r.method === "user" && !r.needsQuestion).length;
  summary.answeredDontKnow = out.filter((r) => r.method === "user" && r.needsQuestion).length;
  summary.unresolved = out.filter((r) => r.needsQuestion).length;
  return { records: out, summary };
}

// ---------- own accounts + full flow ----------

/** Re-run deterministic rules with declared own accounts; rule matches replace earlier rule/AI results, others are kept. */
export function reapplyRules(run: ClassifiedRun, ownAccounts: string[]): ClassifiedTx[] {
  const own = [...new Set(ownAccounts.map((a) => a.trim().toLowerCase()).filter((a) => a && a !== run.accountId))];
  const bases = run.records.map(baseTx);
  const matches = applyRules(bases, { accountId: run.accountId, ownAccounts: own });
  return run.records.map((r, i) => {
    const m = matches.get(r.id);
    if (!m || (r.method === "rule" && r.label === m.label)) return r;
    return toClassified(bases[i], {
      label: m.label,
      assetCategory: r.assetCategory,
      confidence: m.confidence,
      method: "rule",
      reason: m.reason,
      pairingId: m.pairingId,
      swapRole: m.swapRole,
    });
  });
}

export interface QuestionFlowResult {
  questions: Question[];
  records: ClassifiedTx[];
  summary: ApplySummary;
  metrics: ClassificationMetrics;
}

export function runQuestionFlow(input0: ClassifiedRun, input: { ownAccounts: string[]; answers: Answers }): QuestionFlowResult {
  // Token symbols are on-chain strings: every downstream message, question and line uses the safe form (M2).
  const run: ClassifiedRun = { ...input0, records: input0.records.map((r) => (r.asset.symbol === sanitizeSymbol(r.asset.symbol) ? r : { ...r, asset: { ...r.asset, symbol: sanitizeSymbol(r.asset.symbol) } })) };
  const withOwn = reapplyRules(run, input.ownAccounts);
  const questions = groupQuestions(withOwn);
  const { records, summary } = applyAnswers(withOwn, questions, input.answers);
  return { questions, records, summary, metrics: computeMetrics(records, run.aiResponses, run.attestation.verified) };
}
