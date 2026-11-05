/**
 * Rules-first classification, then NEAR AI Cloud private inference (TEE, attested) for the rest.
 *
 * - Attestation reports are verified once per run with a fresh nonce (Phase 1 preflightAttestation).
 *   If they don't verify, no transaction data is sent to the model.
 * - Every AI response's signature is verified (Phase 1 verifyResponse) over the exact request/response bytes.
 * - Only minimal fields are sent; the raw indexer blob never leaves this process.
 * - `circularRef` always comes from labels.ts.
 */
import OpenAI from "openai";
import { z } from "zod";
import type { HistoryResult, NormalizedTx } from "../../history/types";
import { preflightAttestation, verifyResponse, type Preflight } from "../../near/attestation";
import { createNearClient, type CapturedExchange } from "../../near/client";
import { chooseModel } from "../../near/models";
import {
  ASSET_CATEGORIES,
  ASSET_CATEGORY_IDS,
  LABELS,
  LABEL_IDS,
  isKnownAsset,
  knownAssetCategory,
  type AssetCategory,
  type LabelId,
} from "./labels";
import { applyRules, type RuleMatch } from "./rules";
import {
  CLASSIFIED_SCHEMA_VERSION,
  type AiEvidence,
  type AiResponseRecord,
  type ClassificationMetrics,
  type ClassifiedRun,
  type ClassifiedTx,
  type EvidenceCheck,
} from "./types";

export const BATCH_SIZE = 20;
export const CONFIDENCE_THRESHOLD = 0.8;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------- building classified records (circularRef always from labels.ts) ----------

export interface Decision {
  label: LabelId;
  assetCategory?: AssetCategory;
  confidence: number;
  method: "rule" | "ai" | "user";
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

const fromRule = (tx: NormalizedTx, m: RuleMatch): ClassifiedTx =>
  toClassified(tx, { label: m.label, confidence: m.confidence, method: "rule", reason: m.reason, pairingId: m.pairingId, swapRole: m.swapRole });

// ---------- post-AI consistency guards (D12): flag only, never change the label ----------

const INFLOW_ONLY = (l: LabelId) =>
  l.startsWith("income_") || l === "gift_received" || l === "acquisition_fiat" || l === "acquisition_swap" || l === "loan_received";
const OUTFLOW_ONLY = (l: LabelId) => l.startsWith("disposal_") || l === "gift_given" || l === "loan_repayment";

/** Reasons an AI label is inconsistent with the record; empty when consistent. */
export function consistencyGuards(tx: NormalizedTx, label: LabelId, pairingId: string | undefined, all: NormalizedTx[]): string[] {
  const reasons: string[] = [];
  if ((label === "disposal_swap" || label === "acquisition_swap") && !pairingId) reasons.push("unpaired swap leg");
  if ((INFLOW_ONLY(label) && tx.direction === "out") || (OUTFLOW_ONLY(label) && tx.direction === "in")) {
    reasons.push("label contradicts direction");
  }
  if (label === "gas_refund" && tx.counterparty !== "system") {
    const calledInTx = !!tx.txHash && all.some((o) => o.id !== tx.id && o.txHash === tx.txHash && o.direction === "out" && o.counterparty === tx.counterparty);
    if (!calledInTx) reasons.push("gas_refund from a counterparty that is neither 'system' nor a contract the account called in this transaction");
  }
  return reasons;
}

// ---------- model I/O ----------

const ModelItem = z
  .object({
    id: z.string(),
    label: z.enum(LABEL_IDS),
    assetCategory: z.enum(ASSET_CATEGORY_IDS),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1),
  })
  .strict();
const ModelOutput = z.object({ results: z.array(ModelItem) }).strict();
export type ModelItem = z.infer<typeof ModelItem>;

/** Validate model output strictly: known labels only, no extra keys, exactly the requested ids. */
export function parseModelOutput(content: string, expectedIds: string[]): { ok: true; items: ModelItem[] } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(content.trim());
  } catch (e) {
    return { ok: false, error: `not JSON: ${errMsg(e)}` };
  }
  const parsed = ModelOutput.safeParse(json);
  if (!parsed.success) return { ok: false, error: `schema: ${z.prettifyError(parsed.error)}` };
  const ids = parsed.data.results.map((r) => r.id);
  const expected = new Set(expectedIds);
  if (new Set(ids).size !== ids.length) return { ok: false, error: "duplicate ids in output" };
  const missing = expectedIds.filter((id) => !ids.includes(id));
  const extra = ids.filter((id) => !expected.has(id));
  if (missing.length || extra.length) return { ok: false, error: `id mismatch: missing [${missing.join(",")}] extra [${extra.join(",")}]` };
  return { ok: true, items: parsed.data.results };
}

function responseJsonSchema(ids: string[]) {
  return {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", enum: ids },
            label: { type: "string", enum: [...LABEL_IDS] },
            assetCategory: { type: "string", enum: [...ASSET_CATEGORY_IDS] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            reason: { type: "string" },
          },
          required: ["id", "label", "assetCategory", "confidence", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["results"],
    additionalProperties: false,
  };
}

export const SYSTEM_PROMPT = [
  "You classify NEAR blockchain transactions of one Nigerian individual for tax under NRS Information Circular 2026/21.",
  "Each input item is one balance movement from the user's point of view (direction in/out/self is relative to the user).",
  "Pick exactly one label per item from this list (id: treatment):",
  ...LABEL_IDS.map((id) => `- ${id}: ${LABELS[id].treatment}`),
  "Asset categories (circular para 5.0): " + Object.entries(ASSET_CATEGORIES).map(([k, v]) => `${k} = ${v}`).join("; ") + ".",
  "NEAR context:",
  "- A 0.000000000000000000000001 NEAR (1 yoctoNEAR) deposit is the protocol security deposit required by ft_transfer / ft_transfer_call calls; the economic movement is the token leg in the same transaction.",
  "- storage_deposit / tokens_storage_deposit pays NEAR to register storage on a contract; unused excess is returned as an incoming NEAR transfer from that contract.",
  "- kind 'other' with amount 0 is a zero-value call (for example a relayer delivering a meta-transaction, or a harvest/claim call); its token result, if any, appears as a separate item.",
  "- sameTxLegs lists the other movements in the same transaction, with the rule label already assigned to them when there is one.",
  "Rules: use only the given data. If the purpose cannot be determined from on-chain data (for example whether an incoming payment is a fee, salary, gift or own funds), use 'unknown' or give low confidence. Confidence must be honest; below 0.8 means the user will be asked.",
  "For assetCategory, use the token symbol; mention in the reason why if it is not 4.",
  'Respond with ONLY JSON: {"results":[{"id","label","assetCategory","confidence","reason"}]} covering every input id exactly once. Keep each reason under 200 characters. No prose, no markdown.',
].join("\n");

interface PayloadItem {
  id: string;
  date: string;
  direction: string;
  kind: string;
  asset: string;
  amount: string;
  counterparty: string | null;
  method: string | null;
  failed?: true;
  sameTxLegs?: { direction: string; kind: string; asset: string; amount: string; counterparty: string | null; method: string | null; label?: string }[];
}

/** Minimal per-transaction payload. Only these fields are ever sent to the model. */
export function buildPayload(batch: NormalizedTx[], all: NormalizedTx[], ruleMatches: Map<string, RuleMatch>): { items: PayloadItem[]; idMap: Map<string, string> } {
  const idMap = new Map<string, string>();
  const items = batch.map((tx, i) => {
    const shortId = `t${i + 1}`;
    idMap.set(shortId, tx.id);
    const legs = tx.txHash ? all.filter((o) => o.txHash === tx.txHash && o.id !== tx.id).slice(0, 8) : [];
    const item: PayloadItem = {
      id: shortId,
      date: tx.timestamp,
      direction: tx.direction,
      kind: tx.kind,
      asset: tx.asset.symbol,
      amount: tx.amount,
      counterparty: tx.counterparty,
      method: tx.method,
    };
    if (!tx.success) item.failed = true;
    if (legs.length) {
      item.sameTxLegs = legs.map((o) => {
        const leg: NonNullable<PayloadItem["sameTxLegs"]>[number] = {
          direction: o.direction,
          kind: o.kind,
          asset: o.asset.symbol,
          amount: o.amount,
          counterparty: o.counterparty,
          method: o.method,
        };
        const rm = ruleMatches.get(o.id);
        if (rm) leg.label = rm.label;
        return leg;
      });
    }
    return item;
  });
  return { items, idMap };
}

interface Completion {
  chatId: string | null;
  content: string;
  exchange: CapturedExchange | undefined;
}

async function complete(model: string, payload: PayloadItem[]): Promise<Completion> {
  let exchange: CapturedExchange | undefined;
  const client = createNearClient((e) => {
    if (e.url.endsWith("/chat/completions")) exchange = e;
  });
  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ items: payload }) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "tax_classification", strict: true, schema: responseJsonSchema(payload.map((p) => p.id)) },
    },
    reasoning_effort: "low",
    temperature: 0,
    stream: false,
  });
  return { chatId: completion.id ?? null, content: completion.choices[0]?.message?.content ?? "", exchange };
}

async function checkSignature(preflight: Preflight, c: Completion): Promise<{ ok: boolean; detail: string; signingAddress?: string; checks: EvidenceCheck[] }> {
  if (!c.chatId) return { ok: false, detail: "no chat id in response", checks: [] };
  if (!c.exchange) return { ok: false, detail: "exact request/response bytes not captured", checks: [] };
  const r = await verifyResponse(preflight, { chatId: c.chatId, ...c.exchange });
  const failed = r.checks.find((x) => !x.ok);
  if (r.checks.length === 0) return { ok: false, detail: "no signature checks ran", checks: [] };
  const signingAddress = typeof r.summary.signing_address === "string" ? r.summary.signing_address : undefined;
  const checks = r.checks.map(({ step, ok, detail }) => ({ step, ok, detail }));
  return failed
    ? { ok: false, detail: `${failed.step}: ${failed.detail}`, signingAddress, checks }
    : { ok: true, detail: `signature verified (${String(r.summary.signature_kind)})`, signingAddress, checks };
}

export function preflightVerified(p: Preflight): { ok: boolean; details: string } {
  const failed = p.checks.find((c) => !c.ok);
  if (failed) return { ok: false, details: `${failed.step}: ${failed.detail}` };
  if (!p.gateway?.ok) return { ok: false, details: "gateway report not verified" };
  if (!p.models.some((m) => m.ok)) return { ok: false, details: "no verified model report" };
  return { ok: true, details: `gateway + ${p.models.filter((m) => m.ok).length} model report(s) verified (${p.checks.length} checks, nonce ${p.nonce})` };
}

// ---------- run ----------

export function computeMetrics(records: ClassifiedTx[], aiResponses: AiResponseRecord[], attestationVerified: boolean): ClassificationMetrics {
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
  };
}

/** Structured progress for live UIs (the scan stream). Emitted only; never changes classification. */
export type ClassifyEvent =
  | { type: "rules"; total: number; matched: number; pending: number }
  | { type: "attestation_started"; model: string }
  | { type: "attestation"; verified: boolean; checksPassed: number; checksTotal: number; detail: string }
  | { type: "ai_response"; batch: number; attempt: number; txCount: number; received: boolean; valid: boolean; signatureVerified: boolean }
  | { type: "ai_batch"; processed: number; accepted: number; total: number };

export interface ClassifyOptions {
  ownAccounts?: string[];
  onProgress?: (message: string) => void;
  onEvent?: (event: ClassifyEvent) => void;
}

export async function classifyHistory(history: HistoryResult, options: ClassifyOptions = {}): Promise<ClassifiedRun> {
  const ownAccounts = [...new Set((options.ownAccounts ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean))].sort();
  const log = options.onProgress ?? (() => {});
  const all = history.records;
  const ruleMatches = applyRules(all, { accountId: history.accountId, ownAccounts });
  const classified = new Map<string, ClassifiedTx>();
  for (const tx of all) {
    const m = ruleMatches.get(tx.id);
    if (m) classified.set(tx.id, fromRule(tx, m));
  }
  const pending = all.filter((tx) => !classified.has(tx.id));
  log(`Rules matched ${classified.size}/${all.length}; ${pending.length} left for AI.`);
  const emit = options.onEvent ?? (() => {});
  emit({ type: "rules", total: all.length, matched: classified.size, pending: pending.length });
  let processed = 0;
  let acceptedTotal = 0;

  const aiResponses: AiResponseRecord[] = [];
  let model: string | null = null;
  let attestation: ClassifiedRun["attestation"] = { verified: false, details: "not needed: every record matched a rule", nonce: null };

  if (pending.length) {
    let preflight: Preflight | null = null;
    try {
      model = (await chooseModel()).id;
      log(`Model ${model}; verifying TEE attestation (fresh nonce)…`);
      emit({ type: "attestation_started", model });
      preflight = await preflightAttestation(model, {
        onStatus: (st) => {
          if (st.state === "retrying verification") log(`  retrying verification (${st.attempt}/${st.maxRetries}): ${st.detail}`);
        },
      });
      const v = preflightVerified(preflight);
      attestation = {
        verified: v.ok,
        details: v.details,
        nonce: preflight.nonce,
        checksPassed: preflight.checks.filter((c) => c.ok).length,
        checksTotal: preflight.checks.length,
        reportSigners: [
          ...(preflight.gateway ? [{ label: "gateway", address: preflight.gateway.signingAddress, verified: preflight.gateway.ok }] : []),
          ...preflight.models.map((m) => ({ label: m.label, address: m.signingAddress, verified: m.ok })),
        ],
        attestedAt: new Date().toISOString(),
        checks: preflight.checks.map(({ step, ok, detail }) => ({ step, ok, detail })),
      };
    } catch (e) {
      attestation = { verified: false, details: `attestation preflight failed: ${errMsg(e)}`, nonce: preflight?.nonce ?? null };
    }
    log(`Attestation ${attestation.verified ? "verified" : "NOT verified"}: ${attestation.details}`);
    emit({
      type: "attestation",
      verified: attestation.verified,
      checksPassed: attestation.checksPassed ?? 0,
      checksTotal: attestation.checksTotal ?? 0,
      detail: attestation.details,
    });

    if (!attestation.verified || !preflight || !model) {
      for (const tx of pending) {
        classified.set(tx.id, toClassified(tx, { label: "unknown", confidence: 0, method: "ai", reason: `Not sent to AI: TEE attestation not verified (${attestation.details}).`, forceQuestion: true }));
      }
    } else {
      for (let b = 0; b * BATCH_SIZE < pending.length; b++) {
        const batch = pending.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
        const { items, idMap } = buildPayload(batch, all, ruleMatches);
        let accepted: { items: ModelItem[]; evidence: AiEvidence } | null = null;
        let lastError = "";
        for (let attempt = 1; attempt <= 2 && !accepted; attempt++) {
          log(`AI batch ${b + 1} (${batch.length} txs), attempt ${attempt}…`);
          let c: Completion;
          try {
            c = await complete(model, items);
          } catch (e) {
            lastError = e instanceof OpenAI.APIError ? `NEAR AI API error ${e.status}: ${e.message}` : errMsg(e);
            aiResponses.push({ batch: b + 1, attempt, chatId: null, txCount: batch.length, valid: false, signatureVerified: false, detail: `request failed: ${lastError}` });
            emit({ type: "ai_response", batch: b + 1, attempt, txCount: batch.length, received: false, valid: false, signatureVerified: false });
            continue;
          }
          const sig = await checkSignature(preflight, c);
          const parsed = parseModelOutput(c.content, items.map((i) => i.id));
          aiResponses.push({
            batch: b + 1,
            attempt,
            chatId: c.chatId,
            txCount: batch.length,
            valid: parsed.ok,
            signatureVerified: sig.ok,
            detail: parsed.ok ? sig.detail : `invalid output (${parsed.error}); ${sig.detail}`,
            ...(sig.signingAddress ? { signingAddress: sig.signingAddress } : {}),
            ...(sig.checks.length ? { signatureChecks: sig.checks } : {}),
          });
          emit({ type: "ai_response", batch: b + 1, attempt, txCount: batch.length, received: Boolean(c.chatId), valid: parsed.ok, signatureVerified: sig.ok });
          log(`  chat ${c.chatId}: output ${parsed.ok ? "valid" : "INVALID"}, signature ${sig.ok ? "verified" : `NOT verified (${sig.detail})`}`);
          if (parsed.ok) {
            accepted = {
              items: parsed.items,
              evidence: { chatId: c.chatId ?? "", signatureVerified: sig.ok, model, attempt, ...(sig.ok ? {} : { detail: sig.detail }) },
            };
          } else {
            lastError = parsed.error;
          }
        }

        processed += batch.length;
        if (accepted) acceptedTotal += batch.length;
        emit({ type: "ai_batch", processed, accepted: acceptedTotal, total: pending.length });
        for (const tx of batch) {
          if (!accepted) {
            classified.set(tx.id, toClassified(tx, { label: "unknown", confidence: 0, method: "ai", reason: `model output invalid (${lastError.slice(0, 200)})`, forceQuestion: true }));
            continue;
          }
          const shortId = [...idMap.entries()].find(([, full]) => full === tx.id)![0];
          const it = accepted.items.find((i) => i.id === shortId)!;
          const sigOk = accepted.evidence.signatureVerified;
          const guards = consistencyGuards(tx, it.label, undefined, all);
          let reason = it.reason;
          if (guards.length) reason += ` [guard: ${guards.join("; ")}]`;
          if (!sigOk) reason += ` [response signature NOT verified: ${accepted.evidence.detail}]`;
          classified.set(
            tx.id,
            toClassified(tx, {
              label: it.label,
              assetCategory: it.assetCategory,
              confidence: it.confidence,
              method: "ai",
              reason,
              evidence: accepted.evidence,
              forceQuestion: !sigOk || guards.length > 0,
            }),
          );
        }
      }
    }
  }

  const records = all.map((tx) => classified.get(tx.id)!);
  return {
    schemaVersion: CLASSIFIED_SCHEMA_VERSION,
    accountId: history.accountId,
    from: history.from,
    to: history.to,
    ownAccounts,
    historyFetchedAt: history.fetchedAt,
    classifiedAt: new Date().toISOString(),
    model,
    attestation,
    aiResponses,
    metrics: computeMetrics(records, aiResponses, attestation.verified),
    records,
  };
}
