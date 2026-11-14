import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getCollateralAndVerify } from "@phala/dcap-qvl";
import { ethers } from "ethers";
import {
  ACCEPTED_TCB_STATUSES,
  HTTP_TIMEOUT_MS,
  NEAR_AI_API_ORIGIN,
  NVIDIA_NRAS_URL,
  SIGNING_ALGO,
  getApiKey,
} from "./config";
import type { CapturedExchange } from "./client";

/*
 * Verification of NEAR AI Cloud private inference, following:
 *   https://docs.near.ai/cloud/verification/cloud-api/gateway-attestation
 *   https://docs.near.ai/cloud/verification/cloud-api/model-attestations
 *   https://docs.near.ai/cloud/verification/reference/quote-nonce-signer
 *   https://docs.near.ai/cloud/verification/cloud-api/response-signatures
 *   https://docs.near.ai/cloud/verification/reference/response-signature-verification
 *
 * Flow (deployment-first): fresh nonce -> attestation report -> verify gateway
 * report and EVERY model candidate (TDX quote, debug bit, report-data binding,
 * echoed nonce, MRCONFIGID, RTMR3 replay, NVIDIA GPU evidence) -> completion ->
 * fetch response signature -> verify it over the exact bytes and match its
 * signer to the retained reports: at least one names it, and every report that names it passed all its
 * checks (NEAR AI Cloud can serve a model from several attested machines sharing one signing key).
 * Every step is fail-closed.
 */

export interface AttestationCheck {
  step: string;
  ok: boolean;
  detail: string;
}

export interface AttestationResult {
  verified: boolean;
  details: string;
  rawAttestationSummary: Record<string, unknown>;
}

interface NearReport {
  signing_address: string;
  signing_algo: string;
  intel_quote: string;
  event_log: unknown;
  request_nonce?: string;
  report_data?: string;
  tls_cert_fingerprint?: string;
  nvidia_payload?: string;
  info?: { tcb_info?: unknown };
}

interface AttestationReportResponse {
  gateway_attestation?: NearReport;
  model_attestations?: NearReport[];
}

export interface ReportVerification {
  label: string;
  ok: boolean;
  signingAddress: string;
  signingAlgo: string;
  checks: AttestationCheck[];
  summary: Record<string, unknown>;
}

export interface Preflight {
  model: string;
  nonce: string;
  gateway: ReportVerification | null;
  models: ReportVerification[];
  checks: AttestationCheck[];
}

// ---------------------------------------------------------------- helpers

const hexBytes = (value: string) => Buffer.from(value.replace(/^0x/i, ""), "hex");
const parseMaybeJson = <T>(value: unknown): T => (typeof value === "string" ? JSON.parse(value) : value) as T;
const sha = (algorithm: string, ...parts: (string | Buffer | Uint8Array)[]) => {
  const h = createHash(algorithm);
  for (const part of parts) h.update(part);
  return h.digest();
};
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sameBytes = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
}

// ---------------------------------------------------------------- transient retry

/** Progress reported to callers while evidence is fetched and verified. */
export type AttestationStatus =
  | { state: "verifying"; detail: string }
  | { state: "retrying verification"; detail: string; attempt: number; maxRetries: number }
  | { state: "verified" | "failed"; detail: string };

export type AttestationStatusFn = (status: AttestationStatus) => void;

/** Retries of a transient fetch (collateral, NRAS, report). Verdicts are never retried. */
export const ATTESTATION_MAX_RETRIES = 3;
const RETRY_BASE_MS = 1_000;

/**
 * Run `op` and retry up to ATTESTATION_MAX_RETRIES times with exponential backoff while it fails
 * transiently. Every attempt runs the full verification; only a passing attempt is ever accepted.
 */
async function withTransientRetry<T>(
  what: string,
  op: () => Promise<T>,
  isTransient: (result: { ok: true; value: T } | { ok: false; error: unknown }) => boolean,
  onStatus?: AttestationStatusFn,
): Promise<{ value?: T; error?: unknown; retries: number }> {
  for (let attempt = 0; ; attempt++) {
    let outcome: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      outcome = { ok: true, value: await op() };
    } catch (error) {
      outcome = { ok: false, error };
    }
    if (attempt >= ATTESTATION_MAX_RETRIES || !isTransient(outcome)) {
      return outcome.ok ? { value: outcome.value, retries: attempt } : { error: outcome.error, retries: attempt };
    }
    const detail = outcome.ok ? "transient response" : errMsg(outcome.error);
    onStatus?.({ state: "retrying verification", detail: `${what}: ${detail}`, attempt: attempt + 1, maxRetries: ATTESTATION_MAX_RETRIES });
    await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** attempt));
  }
}

const isTransientHttp = (status: number) => status === 408 || status === 429 || status >= 500;
const retried = (n: number) => (n ? ` (after ${n} transient retr${n === 1 ? "y" : "ies"})` : "");

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${getApiKey()}`, Accept: "application/json" };
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1];
  if (!part) throw new Error("malformed JWT");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

/** Docs: "Replay the RTMR3 event log". */
export function replayRtmr3(eventLog: unknown): Buffer {
  let rtmr3 = Buffer.alloc(48);
  const events = parseMaybeJson<
    { imr: number; event_type: number; event: string; event_payload?: string; digest?: string }[]
  >(eventLog);
  for (const event of events) {
    if (event.imr !== 3) continue;
    const eventType = Buffer.alloc(4);
    eventType.writeUInt32LE(event.event_type);
    const digest = sha("sha384", eventType, ":", Buffer.from(event.event, "utf8"), ":", hexBytes(event.event_payload ?? ""));
    if (event.digest && !hexBytes(event.digest).equals(digest)) {
      throw new Error(`digest mismatch for event ${event.event}`);
    }
    rtmr3 = sha("sha384", rtmr3, digest);
  }
  return rtmr3;
}

// ---------------------------------------------------------------- report checks

/** Run the docs' per-report checks; never throws, records each step. */
async function checkNearReport(
  label: string,
  report: NearReport,
  nonceHex: string,
  requireGpu: boolean,
  onStatus?: AttestationStatusFn,
): Promise<ReportVerification> {
  const checks: AttestationCheck[] = [];
  const summary: Record<string, unknown> = {
    signing_address: report.signing_address,
    signing_algo: report.signing_algo,
  };
  const pass = (step: string, detail: string) => checks.push({ step: `${label}: ${step}`, ok: true, detail });
  const fail = (step: string, detail: string) => {
    checks.push({ step: `${label}: ${step}`, ok: false, detail });
    return { label, ok: false, signingAddress: report.signing_address, signingAlgo: report.signing_algo, checks, summary };
  };

  // 1. Verify intel_quote with Intel DCAP (dcap-qvl) and apply TCB policy.
  let quote;
  try {
    // Collateral is fetched from the network; a thrown error is retried, a returned verdict is not.
    const attempt = await withTransientRetry(
      `${label} Intel TDX collateral`,
      () => getCollateralAndVerify(hexBytes(report.intel_quote)),
      (o) => !o.ok,
      onStatus,
    );
    if (attempt.error !== undefined) throw attempt.error;
    const verified = attempt.value!;
    summary.collateral_retries = attempt.retries;
    summary.tcb_status = verified.status;
    summary.advisory_ids = verified.advisory_ids;
    if (!ACCEPTED_TCB_STATUSES.includes(verified.status)) {
      return fail(
        "Intel TDX quote TCB status",
        `status ${verified.status} not in accepted set [${ACCEPTED_TCB_STATUSES.join(", ")}]; advisories: ${verified.advisory_ids.join(", ") || "none"}`,
      );
    }
    if (verified.report.type !== "td10") return fail("Intel TDX quote type", `expected td10, got ${verified.report.type}`);
    quote = verified.report.asTd10();
    if (!quote) return fail("Intel TDX quote type", "report could not be read as TD10");
    pass("Intel TDX quote verified (dcap-qvl)", `TCB status ${verified.status}${retried(attempt.retries)}`);
  } catch (e) {
    return fail("Intel TDX quote verification (dcap-qvl)", errMsg(e));
  }

  // Debug mode must be off (bit 0 of TD_ATTRIBUTES).
  if (quote.tdAttributes[0] & 1) return fail("TDX debug mode", "debug mode is enabled");
  pass("TDX debug mode", "disabled");

  // 2. Report data binds signer + client nonce; echoed nonce matches.
  try {
    if (report.signing_algo !== SIGNING_ALGO) {
      return fail("signing algorithm", `expected ${SIGNING_ALGO}, got ${report.signing_algo}`);
    }
    const identity = hexBytes(report.signing_address);
    if (identity.length !== 20) return fail("signing identity", `ECDSA address must be 20 bytes, got ${identity.length}`);
    const boundIdentity = report.tls_cert_fingerprint
      ? sha("sha256", identity, hexBytes(report.tls_cert_fingerprint))
      : Buffer.concat([identity, Buffer.alloc(32 - identity.length)]);
    const expectedReportData = Buffer.concat([boundIdentity, hexBytes(nonceHex)]);
    const quoteReportData = Buffer.from(quote.reportData);
    if (!quoteReportData.equals(expectedReportData)) {
      return fail(
        "report data binds signer + nonce",
        `quote report_data ${quoteReportData.toString("hex")} != expected ${expectedReportData.toString("hex")}`,
      );
    }
    pass("report data binds signer + nonce", "verified quote report_data = signing_address (padded) || client nonce");

    if (!report.request_nonce || report.request_nonce.toLowerCase() !== nonceHex.toLowerCase()) {
      return fail("echoed request_nonce", `request_nonce ${report.request_nonce ?? "(missing)"} != client nonce`);
    }
    if (report.report_data && !hexBytes(report.report_data).equals(quoteReportData)) {
      return fail("echoed report_data", "HTTP report_data differs from the verified quote");
    }
    pass("echoed request_nonce", "matches client nonce");
  } catch (e) {
    return fail("report data binding", errMsg(e));
  }

  // 3. Replay RTMR3 event log.
  try {
    const replayed = replayRtmr3(report.event_log);
    if (!replayed.equals(Buffer.from(quote.rtMr3))) {
      return fail("RTMR3 event-log replay", `replayed ${replayed.toString("hex")} != quote ${Buffer.from(quote.rtMr3).toString("hex")}`);
    }
    pass("RTMR3 event-log replay", "matches quote RTMR3");
  } catch (e) {
    return fail("RTMR3 event-log replay", errMsg(e));
  }

  // 4. MRCONFIGID = 01 || sha256(raw app_compose) || 15 zero bytes.
  try {
    const tcbInfo = parseMaybeJson<{ app_compose?: string }>(report.info?.tcb_info);
    const appCompose = tcbInfo?.app_compose;
    if (typeof appCompose !== "string") return fail("MRCONFIGID matches app_compose", "info.tcb_info.app_compose missing");
    const composeHash = sha("sha256", Buffer.from(appCompose, "utf8"));
    const expected = Buffer.concat([Buffer.from([1]), composeHash, Buffer.alloc(15)]);
    if (!Buffer.from(quote.mrConfigId).equals(expected)) {
      return fail("MRCONFIGID matches app_compose", `MRCONFIGID ${Buffer.from(quote.mrConfigId).toString("hex")} != expected ${expected.toString("hex")}`);
    }
    summary.compose_sha256 = composeHash.toString("hex");
    summary.image_digests = [...new Set(appCompose.match(/sha256:[0-9a-f]{64}/g) ?? [])];
    pass("MRCONFIGID matches app_compose", `compose sha256 ${composeHash.toString("hex")}`);
  } catch (e) {
    return fail("MRCONFIGID matches app_compose", errMsg(e));
  }

  // 5. GPU evidence via NVIDIA NRAS (required for model reports).
  if (requireGpu) {
    const gpu = await verifyGpuEvidence(report, nonceHex, onStatus);
    summary.gpu = gpu.summary;
    if (!gpu.ok) return fail("NVIDIA GPU attestation (NRAS)", gpu.detail);
    pass("NVIDIA GPU attestation (NRAS)", gpu.detail);
  }

  return { label, ok: true, signingAddress: report.signing_address, signingAlgo: report.signing_algo, checks, summary };
}

/** NVIDIA's overall token must echo the client nonce: a missing eat_nonce is a failure, not a pass (M3). */
export function nrasNonceProblem(overall: Record<string, unknown>, nonceHex: string): string | null {
  if (typeof overall.eat_nonce !== "string" || overall.eat_nonce === "") return "NRAS eat_nonce missing";
  if (overall.eat_nonce.toLowerCase() !== nonceHex.toLowerCase()) return "NRAS eat_nonce does not match client nonce";
  return null;
}

/** Docs: "Verify GPU evidence when present". */
async function verifyGpuEvidence(
  report: NearReport,
  nonceHex: string,
  onStatus?: AttestationStatusFn,
): Promise<{ ok: boolean; detail: string; summary: Record<string, unknown> }> {
  const summary: Record<string, unknown> = {};
  if (!report.nvidia_payload) return { ok: false, detail: "nvidia_payload missing (policy requires GPU evidence)", summary };
  let payload: { nonce?: unknown };
  try {
    payload = JSON.parse(report.nvidia_payload);
  } catch (e) {
    return { ok: false, detail: `nvidia_payload is not JSON: ${errMsg(e)}`, summary };
  }
  if (typeof payload.nonce !== "string" || payload.nonce.toLowerCase() !== nonceHex.toLowerCase()) {
    return { ok: false, detail: "nvidia_payload nonce does not match client nonce", summary };
  }

  let body: unknown;
  let nrasRetries = 0;
  try {
    const attempt = await withTransientRetry(
      "NVIDIA NRAS",
      async () => {
        const res = await fetchWithTimeout(NVIDIA_NRAS_URL, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: report.nvidia_payload, // the decoded JSON object, unchanged
        });
        return { status: res.status, ok: res.ok, text: await res.text() };
      },
      (o) => !o.ok || isTransientHttp(o.value.status),
      onStatus,
    );
    nrasRetries = attempt.retries;
    if (attempt.error !== undefined) throw attempt.error;
    const res = attempt.value!;
    if (!res.ok) return { ok: false, detail: `NRAS HTTP ${res.status}: ${res.text.slice(0, 200)}${retried(nrasRetries)}`, summary };
    body = JSON.parse(res.text);
  } catch (e) {
    return { ok: false, detail: `NRAS request failed: ${errMsg(e)}${retried(nrasRetries)}`, summary };
  }

  if (!Array.isArray(body) || !Array.isArray(body[0]) || body[0][0] !== "JWT" || typeof body[0][1] !== "string") {
    return { ok: false, detail: "NRAS response malformed (expected [[\"JWT\", token], {...}])", summary };
  }
  const overall = decodeJwtPayload(body[0][1]);
  summary.overall_att_result = overall["x-nvidia-overall-att-result"];
  summary.eat_nonce = overall.eat_nonce;
  const perGpu = (body[1] && typeof body[1] === "object" ? body[1] : {}) as Record<string, string>;
  summary.gpus = Object.entries(perGpu).map(([key, token]) => {
    try {
      const c = decodeJwtPayload(token);
      return { key, hwmodel: c.hwmodel, secboot: c.secboot, dbgstat: c.dbgstat, measres: c.measres };
    } catch {
      return { key, error: "undecodable JWT" };
    }
  });

  if (overall["x-nvidia-overall-att-result"] !== true) {
    return { ok: false, detail: `x-nvidia-overall-att-result is ${JSON.stringify(overall["x-nvidia-overall-att-result"])}`, summary };
  }
  const nonceProblem = nrasNonceProblem(overall, nonceHex);
  if (nonceProblem) return { ok: false, detail: nonceProblem, summary };
  return { ok: true, detail: `overall result true, ${(summary.gpus as unknown[]).length} GPU(s), nonce matches${retried(nrasRetries)}`, summary };
}

// ---------------------------------------------------------------- preflight

/**
 * Fetch and verify fresh gateway + NEAR model evidence BEFORE the completion.
 * Retains every verified report for the later signature match.
 * Transient fetch failures (report, Intel collateral, NRAS) are retried up to ATTESTATION_MAX_RETRIES
 * times with backoff; `onStatus` reports "retrying verification" while that happens.
 */
export async function preflightAttestation(model: string, options: { onStatus?: AttestationStatusFn } = {}): Promise<Preflight> {
  const { onStatus } = options;
  onStatus?.({ state: "verifying", detail: "fetching attestation report" });
  const nonce = randomBytes(32).toString("hex");
  const checks: AttestationCheck[] = [];
  const result: Preflight = { model, nonce, gateway: null, models: [], checks };

  const params = new URLSearchParams({
    model,
    provider: "near",
    include_tls_fingerprint: "false",
    signing_algo: SIGNING_ALGO,
    nonce,
  });
  let report: AttestationReportResponse;
  let reportRetries = 0;
  try {
    const attempt = await withTransientRetry(
      "attestation report",
      async () => {
        const res = await fetchWithTimeout(`${NEAR_AI_API_ORIGIN}/v1/attestation/report?${params}`, {
          headers: { ...authHeaders(), "x-no-aliasing": "true" },
        });
        return { status: res.status, ok: res.ok, text: await res.text() };
      },
      (o) => !o.ok || isTransientHttp(o.value.status),
      onStatus,
    );
    reportRetries = attempt.retries;
    if (attempt.error !== undefined) throw attempt.error;
    const res = attempt.value!;
    if (!res.ok) {
      checks.push({ step: "fetch attestation report", ok: false, detail: `HTTP ${res.status}: ${res.text.slice(0, 200)}${retried(reportRetries)}` });
      onStatus?.({ state: "failed", detail: "fetch attestation report" });
      return result;
    }
    report = JSON.parse(res.text);
    checks.push({ step: "fetch attestation report", ok: true, detail: `fresh nonce ${nonce}${retried(reportRetries)}` });
  } catch (e) {
    checks.push({ step: "fetch attestation report", ok: false, detail: `${errMsg(e)}${retried(reportRetries)}` });
    onStatus?.({ state: "failed", detail: "fetch attestation report" });
    return result;
  }

  if (!report.gateway_attestation) {
    checks.push({ step: "gateway attestation present", ok: false, detail: "gateway_attestation missing" });
  }
  const candidates = report.model_attestations ?? [];
  if (candidates.length === 0) {
    checks.push({ step: "model attestations present", ok: false, detail: "model_attestations missing or empty (policy requires NEAR model evidence)" });
  }

  const [gateway, ...models] = await Promise.all([
    report.gateway_attestation ? checkNearReport("gateway", report.gateway_attestation, nonce, false, onStatus) : Promise.resolve(null),
    ...candidates.map((c, i) => checkNearReport(`model #${i + 1}`, c, nonce, true, onStatus)),
  ]);
  result.gateway = gateway;
  result.models = models as ReportVerification[];
  if (gateway) checks.push(...gateway.checks);
  for (const m of result.models) checks.push(...m.checks);
  const failed = checks.find((c) => !c.ok);
  onStatus?.(failed ? { state: "failed", detail: failed.step } : { state: "verified", detail: `${checks.length} checks passed` });
  return result;
}

// ---------------------------------------------------------------- response signature

interface SignatureResponse {
  text?: string;
  signature?: string;
  signing_address?: string;
  signing_algo?: string;
  signature_kind?: string;
  error_code?: string;
  message?: string;
}

async function fetchSignature(chatId: string): Promise<{ ok: true; sig: SignatureResponse } | { ok: false; detail: string }> {
  const url = `${NEAR_AI_API_ORIGIN}/v1/signature/${encodeURIComponent(chatId)}?signing_algo=${SIGNING_ALGO}`;
  let last = "";
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetchWithTimeout(url, { headers: authHeaders() });
      const text = await res.text();
      if (res.ok) {
        const sig = JSON.parse(text) as SignatureResponse;
        if (sig.error_code) return { ok: false, detail: `signature unavailable: ${sig.error_code}: ${sig.message ?? ""}` };
        return { ok: true, sig };
      }
      last = `HTTP ${res.status}: ${text.slice(0, 200)}`;
      if (res.status !== 404) break;
    } catch (e) {
      last = errMsg(e);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { ok: false, detail: `signature not available after bounded retry: ${last}` };
}

/**
 * provider_tee signer match: at least one model report names the signer, and EVERY report naming it
 * (whatever its algorithm) passed all its checks (TDX quote, debug off, signer + nonce in report_data,
 * RTMR3 replay, MRCONFIGID, NVIDIA GPU) with the same signing algorithm. Otherwise rejected.
 */
export function matchProviderSigner(
  models: Pick<ReportVerification, "label" | "ok" | "signingAddress" | "signingAlgo">[],
  signingAlgo: string,
  address: Buffer,
): { ok: true; detail: string } | { ok: false; detail: string } {
  const naming = models.filter((m) => typeof m.signingAddress === "string" && sameBytes(hexBytes(m.signingAddress), address));
  if (naming.length === 0) return { ok: false, detail: "signer matches no verified model report" };
  const bad = naming.filter((m) => !m.ok || m.signingAlgo !== signingAlgo);
  if (bad.length > 0) {
    return { ok: false, detail: `signer is named by ${bad.length} model report(s) that did not pass every check (${bad.map((m) => m.label).join(", ")})` };
  }
  const labels = naming.map((m) => m.label).join(", ");
  return {
    ok: true,
    detail: naming.length === 1 ? `provider_tee signer = verified ${labels}` : `provider_tee signer bound to ${naming.length} verified model reports (${labels})`,
  };
}

/** Docs: response-signature verification over exact bytes + preflight signer match. */
export async function verifyResponse(
  preflight: Preflight,
  evidence: { chatId: string } & CapturedExchange,
): Promise<{ checks: AttestationCheck[]; summary: Record<string, unknown> }> {
  const checks: AttestationCheck[] = [];
  const summary: Record<string, unknown> = { chat_id: evidence.chatId };
  const done = () => ({ checks, summary });

  const fetched = await fetchSignature(evidence.chatId);
  if (!fetched.ok) {
    checks.push({ step: "fetch response signature", ok: false, detail: fetched.detail });
    return done();
  }
  const sig = fetched.sig;
  summary.signature_kind = sig.signature_kind ?? null;
  summary.signing_address = sig.signing_address;
  summary.signed_text = sig.text;
  checks.push({ step: "fetch response signature", ok: true, detail: `signature_kind=${sig.signature_kind ?? "(absent)"}` });

  // signature_kind decides which preflight evidence must match; absent => unavailable.
  if (sig.signature_kind !== "provider_tee" && sig.signature_kind !== "gateway") {
    checks.push({ step: "signature kind", ok: false, detail: `signature_kind ${JSON.stringify(sig.signature_kind)} is absent or unfamiliar; signer classification unavailable` });
    return done();
  }

  const requestHash = sha("sha256", Buffer.from(evidence.requestBody, "utf8")).toString("hex");
  const responseHash = sha("sha256", Buffer.from(evidence.responseBody, "utf8")).toString("hex");
  const hashes = `${requestHash}:${responseHash}`;
  const expectedText = sig.signature_kind === "provider_tee" ? `${preflight.model}:${hashes}` : hashes;
  summary.request_sha256 = requestHash;
  summary.response_sha256 = responseHash;

  if (sig.text !== expectedText) {
    checks.push({ step: "signed text matches exact request/response bytes", ok: false, detail: `signed "${sig.text}" != expected "${expectedText}"` });
    return done();
  }
  checks.push({ step: "signed text matches exact request/response bytes", ok: true, detail: expectedText });

  try {
    if (sig.signing_algo !== SIGNING_ALGO) throw new Error(`unsupported signing_algo ${sig.signing_algo}`);
    const address = hexBytes(sig.signing_address ?? "");
    const signatureBytes = hexBytes(sig.signature ?? "");
    if (address.length !== 20) throw new Error("signing_address must be 20 bytes");
    if (signatureBytes.length !== 65) throw new Error("ECDSA signature must be 65 bytes");
    const recovered = hexBytes(ethers.verifyMessage(Buffer.from(sig.text, "utf8"), ethers.hexlify(signatureBytes)));
    if (!sameBytes(recovered, address)) throw new Error("recovered EIP-191 signer does not match signing_address");
    checks.push({ step: "ECDSA (EIP-191) signature valid", ok: true, detail: `recovered signer ${sig.signing_address}` });

    // Match signer to retained, verified preflight evidence.
    if (sig.signature_kind === "provider_tee") {
      const match = matchProviderSigner(preflight.models, sig.signing_algo, address);
      if (!match.ok) throw new Error(match.detail);
      checks.push({ step: "signer matches verified preflight evidence", ok: true, detail: match.detail });
    } else {
      const gw = preflight.gateway;
      if (!gw?.ok || gw.signingAlgo !== sig.signing_algo || !sameBytes(hexBytes(gw.signingAddress), address)) {
        throw new Error("gateway signer does not match the verified gateway report");
      }
      checks.push({ step: "signer matches verified preflight evidence", ok: true, detail: "gateway signer = verified gateway report" });
    }
  } catch (e) {
    checks.push({ step: "response signature", ok: false, detail: errMsg(e) });
  }
  return done();
}

// ---------------------------------------------------------------- combine

export function summarizeAttestation(
  preflight: Preflight,
  response: { checks: AttestationCheck[]; summary: Record<string, unknown> } | null,
  responseUnavailableReason?: string,
): AttestationResult {
  const checks = [...preflight.checks, ...(response?.checks ?? [])];
  if (!response) {
    checks.push({ step: "response signature", ok: false, detail: responseUnavailableReason ?? "no completion to verify" });
  }
  const failed = checks.find((c) => !c.ok);
  const verified = !failed && checks.length > 0;

  const rawAttestationSummary = {
    model: preflight.model,
    nonce: preflight.nonce,
    signing_algo: SIGNING_ALGO,
    accepted_tcb_statuses: ACCEPTED_TCB_STATUSES,
    gateway: preflight.gateway?.summary ?? null,
    model_attestations: preflight.models.map((m) => ({ label: m.label, verified: m.ok, ...m.summary })),
    response_signature: response?.summary ?? null,
    policy_notes: [
      "No measurement allowlist / image-provenance policy is applied yet; compose hashes and image digests are reported for review.",
      "NRAS verdict relies on the TLS-authenticated NRAS response (docs' minimal flow); no local JWT/EAT signature validation.",
    ],
    checks,
  };

  const details = verified
    ? `All ${checks.length} checks passed: gateway + ${preflight.models.length} model TEE report(s) verified (Intel TDX + NVIDIA GPU), ` +
      `response signed (${String(response?.summary.signature_kind)}) by a verified signer.`
    : `Failed step: ${failed?.step ?? "unknown"} — ${failed?.detail ?? "no checks ran"}`;

  return { verified, details, rawAttestationSummary };
}
