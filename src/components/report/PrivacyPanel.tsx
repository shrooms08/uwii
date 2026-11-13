"use client";

import { useRef, useState } from "react";
import { DataFlowTable } from "@/components/DataFlowTable";
import { CheckIcon } from "@/components/ui/AnswerChip";
import { Button, TextButton } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { useModal } from "@/components/ui/useModal";
import { download } from "@/lib/client/useReport";
import type { ProofCheck, PrivacyProof } from "@/lib/report/privacy";
import { PRIVACY_SCOPE } from "@/content/privacy-scope";

export const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const utc = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;

/** Every recorded check passed and every AI response/decision has a verified signature. */
export { proofAllVerified, proofCounts } from "@/lib/report/privacy-summary";
import { proofAllVerified, proofCounts } from "@/lib/report/privacy-summary";

const GROUPS: { id: ProofCheck["group"]; title: string }[] = [
  { id: "report", title: "Attestation report" },
  { id: "gateway", title: "Gateway" },
  { id: "model", title: "Model" },
  { id: "signature", title: "Response signature" },
];

function CheckRow({ c }: { c: ProofCheck }) {
  return (
    <li className="flex items-start gap-2.5 border-b border-chip py-2.5 text-small">
      <span className={c.ok ? "mt-0.5 grid size-5 flex-none place-items-center rounded-full bg-gold text-on-ink" : "mt-0.5 grid size-5 flex-none place-items-center rounded-full bg-red-tint text-red-ink ring-1 ring-red-line"}>
        {c.ok ? <CheckIcon size={11} /> : <span aria-hidden="true" className="text-caption font-semibold">×</span>}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span>
          {c.step}
          <span className="sr-only">{c.ok ? " (passed)" : " (failed)"}</span>
        </span>
        <span className="truncate font-mono text-caption text-ink-2" title={c.detail}>
          {c.detail}
        </span>
      </span>
    </li>
  );
}

/** Privacy proof panel (design 06): only the checks this run actually recorded, with their real results. */
export function PrivacyPanel({ proof, account, ruleCount, onClose }: { proof: PrivacyProof; account: string; ruleCount: number | null; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useModal(true, panel, onClose);
  const [copied, setCopied] = useState(false);
  const all = proofAllVerified(proof);
  const counts = proofCounts(proof);
  const signer = proof.signerAddresses[0] ?? null;
  const checks = proof.checks ?? [];
  const noAi = proof.aiDecisions === 0;

  const skipped = proof.aiSkipped;
  const heading = skipped ? "Private AI step skipped" : noAi ? "No AI was needed" : all ? "Verified private" : "Not fully verified";
  const explanation = skipped
    ? `The private AI step did not run for ${skipped.count} ${skipped.count === 1 ? "transaction" : "transactions"} in this scan${skipped.reason === "attestation" ? " because its hardware could not be verified" : skipped.reason === "out_of_time" ? " because the scan ran out of time" : " because the service was unavailable"}. ${noAi ? "Nothing was sent to an AI model." : "Those transactions were not sent to it."} You answered them yourself; ${ruleCount !== null ? `the other ${ruleCount - skipped.count}` : "the rest"} were labelled by deterministic NRS rules on Uwii's server${noAi ? "" : " or by the private AI step before it stopped"}.`
    : noAi
    ? `Every transaction matched a deterministic NRS rule on Uwii's server, so nothing was sent to an AI model and no attestation was needed.`
    : `The ${proof.aiDecisions} transactions the rules could not label were classified by an AI model running in a TEE on NEAR AI Cloud, on hardware whose attestation Uwii verified (Intel TDX and NVIDIA GPU, debug off, a fresh nonce, the response-signing key bound to that hardware). ` +
      `Before anything was sent, Uwii verified the hardware's attestation; afterwards it verified the signature on every AI response. ` +
      `${ruleCount !== null ? `The other ${ruleCount} transactions` : "The rest"} were labelled by deterministic NRS rules on Uwii's server. Here is the evidence from this run.`;

  const downloadJson = () => {
    const data = {
      account,
      source: "Uwii stored classification run (attestation preflight and response-signature results)",
      provider: "NEAR AI Cloud",
      model: proof.model,
      attestedAt: proof.attestedAt,
      nonce: proof.nonce,
      gatewayAndModelReportsVerified: proof.gatewayAndModelReportsVerified,
      checksPassed: proof.checksPassed,
      checksTotal: proof.checksTotal,
      reportSigners: proof.reportSigners,
      responseSigners: proof.signerAddresses,
      aiResponses: proof.aiResponses,
      aiResponsesVerified: proof.aiResponsesVerified,
      aiDecisions: proof.aiDecisions,
      aiDecisionsSignatureVerified: proof.aiDecisionsSignatureVerified,
      checks: checks,
      aiEvidence: proof.aiEvidence,
      missing: proof.missing,
    };
    download(`uwii-${account}-attestation.json`, JSON.stringify(data, null, 2), "application/json");
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 bg-page/75" />
      <div className="pointer-events-none relative flex min-h-full justify-center p-[clamp(12px,3cqi,48px)]">
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby="proof-h"
          tabIndex={-1}
          className="pointer-events-auto flex h-fit w-[min(820px,100%)] flex-col gap-6 rounded-hero bg-surface p-[clamp(22px,3cqi,40px)] shadow-overlay outline-none"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-3.5">
              {counts && !skipped ? (
                <Chip tone={counts.passed === counts.total && all ? "verified" : noAi ? "neutral" : "error"} className="self-start">
                  {counts.passed} of {counts.total} checks passed
                </Chip>
              ) : (
                <Chip tone="neutral" className="self-start">
                  {skipped ? "No AI checks ran" : noAi ? "No checks needed" : "Check results not recorded"}
                </Chip>
              )}
              <h2 id="proof-h" className="font-serif text-[clamp(40px,4cqi,56px)] leading-none font-normal tracking-[-0.045em]">
                {heading}
              </h2>
            </div>
            <button type="button" onClick={onClose} aria-label="Close privacy proof" className="grid size-10 flex-none place-items-center rounded-full border border-border-strong bg-surface text-lg hover:border-ink">
              ×
            </button>
          </div>
          <p className="max-w-[640px] text-[17px] leading-[1.55] text-pretty text-ink-soft">{explanation}</p>

          {!noAi && (
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2">
              <div className="flex flex-col gap-1.5 rounded-inset bg-muted px-4 py-3.5">
                <dt className="text-caption text-ink-2">Model</dt>
                <dd className="font-mono text-label break-all">{proof.model ?? "not recorded"}</dd>
              </div>
              <div className="flex flex-col gap-1.5 rounded-inset bg-muted px-4 py-3.5">
                <dt className="text-caption text-ink-2">Provider</dt>
                <dd className="text-small">NEAR AI Cloud</dd>
              </div>
              <div className="flex flex-col gap-1.5 rounded-inset bg-muted px-4 py-3.5">
                <dt className="text-caption text-ink-2">Attested</dt>
                <dd className="font-mono text-label">{proof.attestedAt ? utc(proof.attestedAt) : "not recorded"}</dd>
              </div>
              <div className="flex flex-col gap-1.5 rounded-inset bg-muted px-4 py-3.5">
                <dt className="text-caption text-ink-2">Response signer</dt>
                <dd className="flex items-center justify-between gap-2 font-mono text-label">
                  {signer ? (
                    <>
                      <span title={signer}>{shortAddr(signer)}</span>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(signer).then(() => setCopied(true), () => setCopied(false));
                        }}
                        aria-label={copied ? "Signer address copied" : `Copy signer address ${signer}`}
                        className="rounded-full border border-border-strong bg-surface px-2 py-0.5 font-sans text-caption hover:border-ink"
                      >
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </>
                  ) : (
                    "not recorded"
                  )}
                </dd>
              </div>
            </dl>
          )}

          {!noAi &&
            (proof.checksRecorded && checks.length ? (
              GROUPS.map((g) => {
                const list = checks.filter((c) => c.group === g.id);
                if (!list.length) return null;
                const subjects = [...new Set(list.map((c) => c.subject))];
                const sub =
                  g.id === "signature"
                    ? `${subjects.length} ${subjects.length === 1 ? "response" : "responses"} · ${list.length} checks`
                    : `${g.id === "model" ? `${subjects.join(", ")} · ` : ""}${list.length} ${list.length === 1 ? "check" : "checks"}`;
                return (
                  <section key={g.id} aria-labelledby={`proof-${g.id}`} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
                      <h3 id={`proof-${g.id}`} className="text-body font-semibold">
                        {g.title}
                      </h3>
                      <span className="font-mono text-caption text-ink-2">{sub}</span>
                    </div>
                    <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-x-6">
                      {list.map((c, i) => (
                        <CheckRow key={`${c.subject}-${c.step}-${i}`} c={c} />
                      ))}
                    </ul>
                  </section>
                );
              })
            ) : (
              <div className="rounded-inset border border-amber-line bg-amber-tint p-4 text-small leading-normal text-amber-ink">
                This classification run recorded only the totals: attestation {proof.gatewayAndModelReportsVerified ? "verified" : "not verified"}
                {proof.checksPassed !== null ? ` (${proof.checksPassed} of ${proof.checksTotal} checks passed)` : ""}, and {proof.aiResponsesVerified} of {proof.aiResponses} AI response
                signatures verified. The individual check results were not recorded; run a new scan to record them.
              </div>
            ))}

          {/* What attestation proves only applies when the AI actually ran. */}
          {!(skipped && noAi) && (
          <section aria-labelledby="proof-scope" className="grid gap-4 rounded-tile bg-muted p-5 @min-[640px]:grid-cols-2">
            <div className="flex flex-col gap-2">
              <h3 id="proof-scope" className="text-small font-semibold">
                {PRIVACY_SCOPE.title}
              </h3>
              <ul className="flex flex-col gap-1.5 text-label leading-normal text-ink-soft">
                {PRIVACY_SCOPE.covers.map((c) => (
                  <li key={c.title} className="flex gap-2">
                    <span aria-hidden="true" className="text-gold-ink">✓</span>
                    {c.text}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-small font-semibold">{PRIVACY_SCOPE.notTitle}</h3>
              <ul className="flex flex-col gap-1.5 text-label leading-normal text-ink-soft">
                {PRIVACY_SCOPE.notCovered.map((c) => (
                  <li key={c.title} className="flex gap-2">
                    <span aria-hidden="true" className="text-ink-2">–</span>
                    {c.text}
                  </li>
                ))}
              </ul>
            </div>
          </section>
          )}

          <DataFlowTable id="proof-data-flow" className="rounded-tile bg-muted p-5" />

          <div className="flex flex-wrap items-center justify-between gap-3">
            {skipped && noAi ? <span /> : <TextButton onClick={downloadJson}>Download attestation report (JSON)</TextButton>}
            <Button size="md" onClick={onClose} className="h-[46px] px-6 text-ui">
              Done
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
