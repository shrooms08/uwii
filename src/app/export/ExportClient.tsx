"use client";

import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { AnchorCard } from "@/components/report/AnchorCard";
import { PrivacyPanel, proofAllVerified, proofCounts } from "@/components/report/PrivacyPanel";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Money } from "@/components/ui/Money";
import { requestBody } from "@/lib/client/request";
import type { StoredAnchor } from "@/lib/client/storage";
import { download, useReport } from "@/lib/client/useReport";
import { parseAccountList } from "@/lib/near/account-id";
import { linesCsv, summaryCsv } from "@/lib/report/csv";
import { reportFingerprint } from "@/lib/report/fingerprint";
import { fmtNgn } from "@/lib/report/format";
import { plainWarnings } from "@/lib/report/warnings";

/** The 36 states and the Federal Capital Territory. */
const STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu",
  "Federal Capital Territory", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun",
  "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara",
];

interface Personal {
  name: string;
  tin: string;
  state: string;
}
const EMPTY: Personal = { name: "", tin: "", state: "" };
/** Same key as /dev/report: personal fields live only in this browser. */
const personalKey = (account: string) => `uwii:personal:${account}`;

const groupHex = (h: string) => h.match(/.{1,8}/g)?.join(" ") ?? h;

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <rect x="4" y="9" width="12" height="8.5" rx="2" />
      <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
    </svg>
  );
}

export default function ExportClient({ account }: { account: string }) {
  const { report, flow, saved, error, retry } = useReport(account);
  const [personal, setPersonal] = useState<Personal>(EMPTY);
  const [personalLoaded, setPersonalLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [recomputed, setRecomputed] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [proofOpen, setProofOpen] = useState(false);
  const closeProof = useCallback(() => setProofOpen(false), []);
  const [anchor, setAnchor] = useState<StoredAnchor | null>(null);
  const onAnchor = useCallback((a: StoredAnchor) => setAnchor(a), []);
  const ids = { name: useId(), tin: useId(), state: useId() };

  useEffect(() => {
    // Personal fields are read from this browser after mount; never sent to the server.
    try {
      const raw = window.localStorage.getItem(personalKey(account));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setPersonal({ ...EMPTY, ...(JSON.parse(raw) as Partial<Personal>) });
    } catch {
      // storage unavailable
    }
    setPersonalLoaded(true);
  }, [account]);

  useEffect(() => {
    if (!personalLoaded) return;
    try {
      window.localStorage.setItem(personalKey(account), JSON.stringify(personal));
    } catch {
      // storage unavailable (private mode)
    }
  }, [account, personal, personalLoaded]);

  useEffect(() => {
    if (!report) return;
    let live = true;
    void reportFingerprint(report).then((fp) => live && setRecomputed(fp));
    return () => {
      live = false;
    };
  }, [report]);

  if (error && !report) {
    return (
      <Card role="alert" className="mx-auto mt-16 flex max-w-[580px] flex-col items-start gap-4 border-red-line p-7">
        <Chip tone="error">Could not build your worksheet</Chip>
        <p className="text-ui text-ink-2">{error}</p>
        <Button variant="secondary" onClick={retry}>
          Try again
        </Button>
      </Card>
    );
  }
  if (!report || !flow) {
    return (
      <p role="status" className="py-24 text-center text-ui text-ink-2">
        Preparing your worksheet…
      </p>
    );
  }

  const r = report;
  const isDraft = r.status === "draft";
  const counts = proofCounts(r.privacyProof);
  const verified = proofAllVerified(r.privacyProof);
  const base = `uwii-${r.account}-${r.year}`;
  const ownAccounts = saved ? parseAccountList(saved.ownText).filter((a) => a !== account) : [];

  async function downloadPdf() {
    setPdfBusy(true);
    setPdfError(null);
    try {
      const { buildWorksheetPdf } = await import("@/lib/report/pdf");
      const bytes = await buildWorksheetPdf(r, { ...personal, ownAccounts }, new Date(), anchor && anchor.fingerprint === r.fingerprint ? anchor : null);
      download(`${base}-worksheet${isDraft ? "-DRAFT" : ""}.pdf`, bytes as BlobPart, "application/pdf");
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : String(e));
    } finally {
      setPdfBusy(false);
    }
  }

  const field = "h-[46px] rounded-full border border-border-strong bg-surface px-4 text-ui font-normal text-ink";

  return (
    <>
      <div className="pt-[clamp(20px,3cqi,40px)] pb-[clamp(20px,2.4cqi,28px)]">
        <h1 className="font-serif text-[clamp(44px,5cqi,72px)] leading-none font-normal tracking-[-0.02em]">Export your worksheet</h1>
        <p className="mt-3 max-w-[620px] text-body leading-[1.55] text-ink-2">A PDF your tax consultant can check line by line, with every figure tied to the NRS circular.</p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,460px),1fr))] items-start gap-4">
        <div className="flex flex-col gap-4">
          <Card aria-labelledby="fp-h" className="flex flex-col gap-5 p-[clamp(20px,2.4cqi,32px)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="fp-h" className="text-lg font-semibold tracking-[-0.01em]">
                Report fingerprint
              </h2>
              {isDraft ? <Chip tone="draft">Draft</Chip> : <Chip tone="final">Final</Chip>}
            </div>
            <div className="flex items-start gap-3 rounded-[18px] bg-muted py-4 pr-4 pl-5">
              <code className="min-w-0 flex-1 font-mono text-small leading-[1.7] [overflow-wrap:anywhere] [word-spacing:6px]" aria-label={`Fingerprint ${r.fingerprint}`}>
                {groupHex(r.fingerprint)}
              </code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(r.fingerprint).then(
                    () => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1800);
                    },
                    () => setCopied(false),
                  );
                }}
                className="inline-flex h-9 flex-none items-center rounded-full border border-border-strong bg-surface px-3.5 text-label font-medium hover:border-ink"
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
            <p className="-mt-2 text-label leading-normal text-ink-2">
              SHA-256 of the report&apos;s canonical data (your personal details are not included). The same value is printed in the PDF and the summary CSV.{" "}
              {recomputed && (recomputed === r.fingerprint ? <span className="text-lime-ink">Recomputed in your browser: matches.</span> : <span className="text-red-ink">Recomputed in your browser: does NOT match.</span>)}
            </p>
            {isDraft && (
              <div role="status" className="rounded-inset border border-amber-line bg-amber-tint px-4 py-3 text-small leading-normal text-amber-ink">
                This report is a draft{r.blockingQuestions > 0 ? ` (${r.blockingQuestions} ${r.blockingQuestions === 1 ? "question" : "questions"} open)` : ""}. Every PDF page carries a &ldquo;DRAFT, NOT FOR FILING&rdquo; watermark
                until it is final.
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={downloadPdf} disabled={pdfBusy} className="h-[54px] flex-[1_1_240px]">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13.5h10" />
                </svg>
                {pdfBusy ? "Building PDF…" : "Download PDF worksheet"}
              </Button>
              <Button variant="secondary" className="h-[54px]" onClick={() => download(`${base}-lines.csv`, linesCsv(r), "text/csv;charset=utf-8")}>
                Download CSV
              </Button>
            </div>
            <div className="-mt-2 flex flex-wrap items-center justify-between gap-2 text-label text-ink-2">
              <span>CSV: every line with its circular reference.</span>
              <button type="button" onClick={() => download(`${base}-summary.csv`, summaryCsv(r), "text/csv;charset=utf-8")} className="text-ink underline underline-offset-[3px]">
                Download summary CSV
              </button>
            </div>
            {pdfError && (
              <p role="alert" className="text-label text-red-ink">
                Could not build the PDF: {pdfError}
              </p>
            )}
          </Card>

          <Card aria-labelledby="det-h" className="flex flex-col gap-[18px] p-[clamp(20px,2.4cqi,32px)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="det-h" className="text-lg font-semibold tracking-[-0.01em]">
                Add your details <span className="text-ui font-normal whitespace-nowrap text-ink-2">(optional)</span>
              </h2>
              <span className="inline-flex items-center gap-1.5 text-label text-ink-2">
                <LockIcon />
                Stays in your browser
              </span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3">
              <label htmlFor={ids.name} className="col-span-full flex flex-col gap-2 text-small font-medium">
                Taxpayer name
                <input id={ids.name} value={personal.name} onChange={(e) => setPersonal((p) => ({ ...p, name: e.target.value }))} placeholder="As on your TIN record" autoComplete="name" className={field} />
              </label>
              <label htmlFor={ids.tin} className="flex flex-col gap-2 text-small font-medium">
                TIN
                <input
                  id={ids.tin}
                  value={personal.tin}
                  onChange={(e) => setPersonal((p) => ({ ...p, tin: e.target.value }))}
                  placeholder="12345678-0001"
                  inputMode="numeric"
                  autoComplete="off"
                  className={`${field} font-mono`}
                />
              </label>
              <label htmlFor={ids.state} className="flex flex-col gap-2 text-small font-medium">
                State of residence
                <select id={ids.state} value={personal.state} onChange={(e) => setPersonal((p) => ({ ...p, state: e.target.value }))} className={`${field} px-3.5`}>
                  <option value="">Choose a state</option>
                  {STATES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="text-label text-ink-2">Printed on the PDF only. Not sent to Uwii&apos;s server and not part of the fingerprint.</p>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
        <AnchorCard fingerprint={r.fingerprint} isFinal={!isDraft} body={saved ? requestBody(account, saved) : { account }} onAnchor={onAnchor} />
        <section aria-label="Worksheet contents" className="flex flex-col gap-4 rounded-card bg-ink p-[clamp(20px,2.4cqi,32px)] text-white">
          <div className="flex items-center justify-between gap-3">
            <span className="text-small text-onink">In this worksheet</span>
            {isDraft ? <Chip tone="draft">Draft</Chip> : <Chip tone="onInk">Final</Chip>}
          </div>
          <Money value={r.tax.taxAttributableToVaNgn} className="text-[56px] leading-[0.95] tracking-[-0.02em]" />
          <span className="-mt-2 text-label text-onink">Tax attributable to your crypto, {r.year}</span>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2.5 border-t border-white/14 pt-4 text-small">
            <dt className="text-onink">Chargeable VA</dt>
            <dd className="font-mono text-label">₦{fmtNgn(r.totals.chargeableVaNgn)}</dd>
            <dt className="text-onink">Lines, each with circular ref</dt>
            <dd className="font-mono text-label">{r.lines.length}</dd>
            <dt className="text-onink">Warnings</dt>
            <dd className="font-mono text-label">{plainWarnings(r).length}</dd>
            <dt className="text-onink">Privacy proof</dt>
            <dd className="font-mono text-label">
              {r.privacyProof.aiDecisions === 0 ? "rules only" : counts ? `${counts.passed}/${counts.total} checks${verified ? "" : " (not all verified)"}` : "counts not recorded"}
            </dd>
          </dl>
          <Button variant="secondary" size="md" onClick={() => setProofOpen(true)} className="focus-onink self-start border-white">
            View privacy proof
          </Button>
        </section>
        </div>
      </div>

      <p className="mt-10 max-w-[760px] border-t border-rule pt-[22px] text-small leading-normal text-ink-2">
        Computation for review; not tax advice. File personal income tax with your State Internal Revenue Service by 31 March.{" "}
        <Link href={`/verify?fingerprint=${r.fingerprint}`} className="text-ink underline underline-offset-[3px]">
          Verify a report fingerprint
        </Link>
      </p>

      {proofOpen && <PrivacyPanel proof={r.privacyProof} account={account} ruleCount={flow.total - r.privacyProof.aiDecisions} onClose={closeProof} />}
    </>
  );
}
