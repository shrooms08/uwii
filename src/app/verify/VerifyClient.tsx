"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CheckIcon } from "@/components/ui/AnswerChip";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { readUwiiCsv } from "@/lib/report/csv-read";
import type { StoredAnchor } from "@/lib/client/storage";

type Result =
  | { kind: "anchored"; fingerprint: string; anchor: StoredAnchor; contractId: string }
  | { kind: "not_anchored"; fingerprint: string; contractId: string }
  | { kind: "error"; message: string };

const clean = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const groupHex = (h: string) => h.match(/.{1,8}/g)?.join(" ") ?? h;
const groupInt = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const utc = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;

export default function VerifyClient({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [csvNote, setCsvNote] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const ids = { fp: useId(), file: useId(), err: useId() };
  const autoChecked = useRef(false);

  async function check(raw: string) {
    const fp = clean(raw);
    if (!/^[0-9a-f]{64}$/.test(fp)) {
      setResult({ kind: "error", message: "A fingerprint is 64 hexadecimal characters (0-9, a-f). Spaces are ignored." });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/verify?fingerprint=${fp}`);
      const j = (await res.json()) as { anchored?: boolean; anchor?: StoredAnchor; contractId?: string; error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setResult(j.anchored && j.anchor ? { kind: "anchored", fingerprint: fp, anchor: j.anchor, contractId: j.contractId ?? j.anchor.contractId } : { kind: "not_anchored", fingerprint: fp, contractId: j.contractId ?? "" });
    } catch (e) {
      setResult({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (initial && !autoChecked.current) {
      autoChecked.current = true;
      void check(initial);
    }
  }, [initial]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void check(value);
  };

  async function onFile(file: File | undefined) {
    setCsvNote(null);
    if (!file) return;
    const csv = readUwiiCsv(await file.text());
    if (csv.kind === "summary") {
      if (!csv.fingerprint) {
        setCsvNote({ tone: "error", text: "This summary CSV has no valid fingerprint row." });
        return;
      }
      setValue(groupHex(csv.fingerprint));
      setCsvNote({
        tone: "info",
        text:
          "This summary CSV states the report fingerprint, and that is what is checked below. The fingerprint covers more than the CSV holds (every line, warnings, decisions, data sources and the privacy proof), " +
          "so it cannot be recomputed from this file alone.",
      });
      void check(csv.fingerprint);
    } else if (csv.kind === "lines") {
      setCsvNote({
        tone: "info",
        text: `This is a lines CSV (${csv.rows} lines). It does not carry the fingerprint or the rest of the report the fingerprint covers (totals, tax, warnings, privacy proof), so it cannot be recomputed from it. Paste the fingerprint from the PDF or the summary CSV.`,
      });
    } else {
      setCsvNote({ tone: "error", text: "This does not look like a Uwii CSV export (summary or lines)." });
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-6">
      <div className="pt-[clamp(20px,3cqi,40px)] pb-[clamp(8px,1.4cqi,16px)]">
        <h1 className="font-serif text-[clamp(44px,5cqi,72px)] leading-none font-normal tracking-[-0.02em]">Verify a report</h1>
        <p className="mt-3 max-w-[680px] text-body leading-[1.55] text-ink-2">
          Check whether a Uwii report fingerprint was anchored on NEAR testnet, and when. Only the fingerprint was ever written on-chain; nothing in the report is revealed.
        </p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,460px),1fr))] items-start gap-4">
        <Card className="flex flex-col gap-5 p-[clamp(20px,2.4cqi,32px)]">
          <form onSubmit={submit} noValidate className="flex flex-col gap-3">
            <label htmlFor={ids.fp} className="text-small font-medium">
              Report fingerprint (SHA-256)
            </label>
            <textarea
              id={ids.fp}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={2}
              spellCheck={false}
              autoCapitalize="none"
              placeholder="64 hexadecimal characters, as printed on the PDF"
              aria-describedby={result?.kind === "error" ? ids.err : undefined}
              className="resize-y rounded-[18px] border border-border-strong bg-surface px-4 py-3 font-mono text-small leading-[1.7] break-all text-ink"
            />
            <Button type="submit" disabled={busy} className="self-start">
              {busy ? "Checking…" : "Check on NEAR"}
            </Button>
          </form>
          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <label htmlFor={ids.file} className="text-small font-medium">
              Or read it from a Uwii CSV
            </label>
            <input
              id={ids.file}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void onFile(e.target.files?.[0])}
              className="text-small file:mr-3 file:h-9 file:cursor-pointer file:rounded-full file:border file:border-border-strong file:bg-surface file:px-3.5 file:text-label file:font-medium"
            />
            <p className="text-label text-ink-2">The file is read in your browser and never uploaded.</p>
            {csvNote && (
              <p role={csvNote.tone === "error" ? "alert" : "status"} className={csvNote.tone === "error" ? "text-label text-red-ink" : "rounded-inset bg-muted px-3.5 py-2.5 text-label leading-normal text-ink-soft"}>
                {csvNote.text}
              </p>
            )}
          </div>
        </Card>

        <div aria-live="polite">
          {result?.kind === "anchored" && (
            <Card className="flex flex-col gap-4 border-lime-line p-[clamp(20px,2.4cqi,32px)]">
              <span className="flex items-center gap-2.5 text-lg font-semibold text-lime-ink">
                <span className="grid size-7 flex-none place-items-center rounded-full bg-lime text-ink">
                  <CheckIcon size={13} />
                </span>
                Anchored on NEAR testnet
              </span>
              <code className="font-mono text-label leading-[1.7] [overflow-wrap:anywhere] [word-spacing:6px] text-ink-soft">{groupHex(result.fingerprint)}</code>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-small">
                <dt className="text-ink-2">Time</dt>
                <dd className="font-mono text-label">{utc(result.anchor.anchoredAt)}</dd>
                <dt className="text-ink-2">Block</dt>
                <dd className="font-mono text-label">
                  <a href={result.anchor.blockUrl} target="_blank" rel="noreferrer" className="underline underline-offset-[3px]">
                    {groupInt(result.anchor.blockHeight)}
                  </a>
                </dd>
                <dt className="text-ink-2">Transaction</dt>
                <dd className="font-mono text-label break-all">
                  {result.anchor.txHash && result.anchor.explorerUrl ? (
                    <a href={result.anchor.explorerUrl} target="_blank" rel="noreferrer" className="underline underline-offset-[3px]">
                      {result.anchor.txHash} ↗<span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ) : (
                    "not located (the anchor itself is confirmed by the contract)"
                  )}
                </dd>
                <dt className="text-ink-2">Contract</dt>
                <dd className="font-mono text-label break-all">{result.contractId}</dd>
                <dt className="text-ink-2">Anchored by</dt>
                <dd className="font-mono text-label break-all">{result.anchor.anchoredBy}</dd>
              </dl>
              <p className="text-label leading-normal text-ink-2">The report with this exact fingerprint existed at that time. Any change to the report would give a different fingerprint.</p>
            </Card>
          )}
          {result?.kind === "not_anchored" && (
            <Card className="flex flex-col gap-3 p-[clamp(20px,2.4cqi,32px)]">
              <Chip tone="neutral" className="self-start">
                Not anchored
              </Chip>
              <code className="font-mono text-label leading-[1.7] [overflow-wrap:anywhere] [word-spacing:6px] text-ink-soft">{groupHex(result.fingerprint)}</code>
              <p className="text-ui leading-normal text-ink-2">
                No anchor for this fingerprint on <span className="font-mono">{result.contractId}</span> (NEAR testnet). Either the report was never anchored, or it differs from the one that was:
                any change gives a different fingerprint.
              </p>
            </Card>
          )}
          {result?.kind === "error" && (
            <Card role="alert" id={ids.err} className="flex flex-col gap-3 border-red-line p-[clamp(20px,2.4cqi,32px)]">
              <Chip tone="error" className="self-start">
                Could not check
              </Chip>
              <p className="text-ui text-ink-2">{result.message}</p>
            </Card>
          )}
          {!result && (
            <Card className="flex flex-col gap-2 p-[clamp(20px,2.4cqi,32px)] text-ui leading-normal text-ink-2">
              <span className="font-medium text-ink">How it works</span>
              <span>
                When a final report is anchored, Uwii writes only its SHA-256 fingerprint to a small NEAR contract. Anyone can look it up here; the contract returns the block and time it was recorded.
              </span>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
