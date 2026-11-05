"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AnswerChip } from "@/components/ui/AnswerChip";
import { Button, ButtonLink, TextButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { cx } from "@/components/ui/cx";
import { Money } from "@/components/ui/Money";
import { Mono } from "@/components/ui/Mono";
import { SegmentBar } from "@/components/ui/ProgressBar";
import { EMPTY_SAVED, NGN_INPUT_RE, isDemoPresetOn, loadSaved, setDemoPreset, storeSaved, stripNgn, type Saved } from "@/lib/client/storage";
import { DEMO_ACCOUNT, ILLUSTRATIVE_ANSWERS } from "@/lib/demo/illustrative-answers";
import { parseAccountList, shortParty } from "@/lib/near/account-id";
import { fmtAmount, fmtDate, fmtUsd } from "@/lib/report/format";
import type { ReportData } from "@/lib/tax/ng/report";
import type { AnswerOption, GroupAnswer, Question, QuestionTx } from "@/lib/tax/ng/questions";
import { isPositiveQuantity, normalizeSourceLeg, type SourceLegInput } from "@/lib/tax/ng/source-leg";
import type { ClassificationMetrics } from "@/lib/tax/ng/types";

interface AssetChoice {
  symbol: string;
  contract: string | null;
}

interface FlowResponse {
  questions: Question[];
  metrics: ClassificationMetrics;
  records: { id: string }[];
  /** Assets seen in this account (source-leg choices). */
  assets: AssetChoice[];
  error?: string;
}

const RECOMPUTE_DEBOUNCE_MS = 450;

const FOLLOW_UP_LABEL: Record<NonNullable<AnswerOption["followUp"]>, string> = {
  ngn_paid: "How much naira did you pay?",
  ngn_received: "How much naira did you receive?",
};

/** Source leg as it will be sent: separators stripped; null until the asset and a positive quantity are given. */
function legForRequest(leg: SourceLegInput | undefined): SourceLegInput | null {
  if (!leg) return null;
  const quantity = stripNgn(leg.quantity);
  if (!leg.asset.symbol.trim() || leg.asset.contract === "" || !isPositiveQuantity(quantity)) return null;
  return { asset: leg.asset, quantity, ...(leg.timestamp ? { timestamp: leg.timestamp } : {}) };
}

/** Request body pieces built from what is saved in this browser (naira separators stripped). */
function requestBody(account: string, saved: Saved) {
  const groups: Record<string, GroupAnswer> = {};
  for (const [id, g] of Object.entries(saved.groups)) {
    const ngn = g.ngn ? Object.fromEntries(Object.entries(g.ngn).map(([k, v]) => [k, stripNgn(v)]).filter(([, v]) => v !== "")) : undefined;
    const legs = g.sourceLegs
      ? Object.fromEntries(Object.entries(g.sourceLegs).flatMap(([k, v]) => {
          const l = legForRequest(v);
          return l ? [[k, l]] : [];
        }))
      : undefined;
    groups[id] = {
      option: g.option,
      ...(g.overrides && Object.keys(g.overrides).length ? { overrides: g.overrides } : {}),
      ...(ngn && Object.keys(ngn).length ? { ngn } : {}),
      ...(legs && Object.keys(legs).length ? { sourceLegs: legs } : {}),
    };
  }
  const other = stripNgn(saved.otherIncomeNgn);
  return {
    account,
    ownAccounts: parseAccountList(saved.ownText).filter((a) => a !== account),
    answers: { groups },
    profile: { otherIncomeNgn: NGN_INPUT_RE.test(other) ? other : "" },
  };
}

async function postJson<T>(url: string, body: unknown, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function QuestionsClient({ account }: { account: string }) {
  const [saved, setSaved] = useState<Saved>(EMPTY_SAVED);
  const [loaded, setLoaded] = useState(false);
  const [flow, setFlow] = useState<FlowResponse | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [retry, setRetry] = useState(0);
  const [demoOn, setDemoOn] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    // Hydrate from this browser's storage after mount (unavailable during server render).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaved(loadSaved(account));
    setDemoOn(isDemoPresetOn(account));
    setLoaded(true);
  }, [account]);

  useEffect(() => {
    if (loaded) storeSaved(account, saved);
  }, [account, saved, loaded]);

  // Recompute the question flow and the draft report after every change (debounced, latest wins).
  useEffect(() => {
    if (!loaded) return;
    const controller = new AbortController();
    const delay = first.current ? 0 : RECOMPUTE_DEBOUNCE_MS;
    first.current = false;
    const t = setTimeout(async () => {
      setUpdating(true);
      const body = requestBody(account, saved);
      const flowP = postJson<FlowResponse>("/api/questions", body, controller.signal)
        .then((f) => {
          setFlow(f);
          setFlowError(null);
        })
        .catch((e: unknown) => {
          if (!controller.signal.aborted) setFlowError(e instanceof Error ? e.message : String(e));
        });
      const reportP = postJson<ReportData>("/api/report", body, controller.signal)
        .then((r) => {
          setReport(r);
          setReportError(null);
        })
        .catch((e: unknown) => {
          if (!controller.signal.aborted) setReportError(e instanceof Error ? e.message : String(e));
        });
      await Promise.all([flowP, reportP]);
      if (!controller.signal.aborted) setUpdating(false);
    }, delay);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [account, saved, loaded, retry]);

  const setGroup = useCallback(
    (groupId: string, update: (g: GroupAnswer | undefined) => GroupAnswer | undefined) =>
      setSaved((s) => {
        const groups = { ...s.groups };
        const g = update(groups[groupId]);
        if (g) groups[groupId] = g;
        else delete groups[groupId];
        return { ...s, groups };
      }),
    [],
  );

  const usdById = useMemo(() => {
    const m = new Map<string, string>();
    // The transaction's own line only: gas-fee and source-leg lines share the record id but value another asset.
    for (const l of report?.lines ?? []) if (l.usdValue && l.recordId && l.kind !== "gas_fee") m.set(`${l.recordId}|${l.asset}`, l.usdValue);
    return m;
  }, [report]);

  if (flowError && !flow) {
    return (
      <Card role="alert" className="mx-auto mt-16 flex max-w-[580px] flex-col items-start gap-4 border-red-line p-7">
        <Chip tone="error">Could not load your questions</Chip>
        <p className="text-ui text-ink-2">{flowError}</p>
        <Button variant="secondary" onClick={() => setRetry((n) => n + 1)}>
          Try again
        </Button>
      </Card>
    );
  }
  if (!flow) {
    return (
      <p role="status" className="py-24 text-center text-ui text-ink-2">
        Loading your questions…
      </p>
    );
  }

  const questions = flow.questions;
  const n = questions.length;
  const answered = questions.filter((q) => saved.groups[q.groupId]).length;
  const total = flow.records.length;
  const needsYou = questions.reduce((k, q) => k + q.txs.length, 0);
  const m = flow.metrics;
  const verified = m.attestationVerified && m.aiResponses > 0 && m.aiResponsesVerified === m.aiResponses;
  const isDraft = report ? report.status === "draft" : true;
  const resultHref = `/result?account=${encodeURIComponent(account)}`;
  const ctaLabel = report ? (isDraft ? "See draft result" : "See final result") : "See result";

  const applyPreset = () => {
    setSaved((s) => ({ ...s, groups: structuredClone(ILLUSTRATIVE_ANSWERS.groups), otherIncomeNgn: ILLUSTRATIVE_ANSWERS.otherIncomeNgn }));
    setDemoPreset(account, true);
    setDemoOn(true);
  };
  const clearPreset = () => {
    setSaved((s) => ({ ...s, groups: {}, otherIncomeNgn: "" }));
    setDemoPreset(account, false);
    setDemoOn(false);
  };

  const taxFigure = report ? (
    <Money value={report.tax.taxAttributableToVaNgn} />
  ) : (
    <span className="text-ink-3">{reportError ? "–" : "…"}</span>
  );

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4 pt-[clamp(20px,3cqi,40px)] pb-[clamp(20px,2.4cqi,32px)]">
        <div className="max-w-[720px]">
          <h1 className="font-serif text-[clamp(44px,5cqi,72px)] leading-none font-normal tracking-[-0.02em]">
            {n === 0 ? "Nothing needs you" : n === 1 ? "1 thing needs you" : `${n} things need you`}
          </h1>
          <p className="mt-3 text-body leading-[1.55] text-pretty text-ink-2">
            Uwii labelled {total - needsYou} of {total} transactions on its own.{" "}
            {n > 0 ? "These need a person who knows the story. Answer in plain terms; you can change any answer later." : "There is nothing to ask you."}
          </p>
          {account === DEMO_ACCOUNT && (
            <p className="mt-3 text-label text-ink-2">
              {demoOn ? (
                <TextButton onClick={clearPreset} className="text-label text-ink-2">
                  Clear illustrative demo answers
                </TextButton>
              ) : (
                <TextButton onClick={applyPreset} className="text-label text-ink-2">
                  Fill illustrative demo answers
                </TextButton>
              )}
            </p>
          )}
        </div>
        {verified ? (
          <Chip tone="verified">Verified private</Chip>
        ) : m.aiResponses === 0 && !m.attestationVerified ? (
          <Chip tone="neutral">Labelled by rules only</Chip>
        ) : (
          <Chip tone="error">AI checks not fully verified</Chip>
        )}
      </div>

      <div className="flex flex-wrap items-start gap-6 pb-6">
        <div className="flex min-w-0 flex-[1_1_600px] flex-col gap-4">
          {questions.map((q, qi) => (
            <QuestionCard
              key={q.groupId}
              q={q}
              index={qi}
              count={n}
              answer={saved.groups[q.groupId]}
              usdById={usdById}
              assets={flow.assets ?? []}
              setGroup={setGroup}
            />
          ))}
        </div>

        <aside className="sticky top-6 flex max-w-full flex-[1_1_340px] flex-col gap-4 self-start">
          <Card aria-label="Summary" className="flex flex-col gap-5 p-6">
            <div className="flex flex-col gap-2.5">
              <div className="flex items-baseline justify-between">
                <span className="text-small text-ink-2">Questions answered</span>
                <Mono className="text-ui font-medium">
                  {answered}/{n}
                </Mono>
              </div>
              <SegmentBar total={n} done={answered} />
            </div>
            <div className="flex flex-col gap-2 border-t border-line pt-[18px]" aria-busy={updating}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-small text-ink-2">{isDraft ? "Draft tax so far" : "Tax on your crypto"}</span>
                {report && (isDraft ? <Chip tone="draft" size="sm">Draft</Chip> : <Chip tone="final" size="sm">Final</Chip>)}
              </div>
              <div aria-live="polite" className={cx("font-serif text-[52px] leading-none tracking-[-0.02em] transition-opacity", updating && report && "opacity-60")}>
                {taxFigure}
              </div>
              <p className="text-label leading-normal text-ink-2">
                {reportError
                  ? `Could not compute the figure: ${reportError}`
                  : !report
                    ? "Computing from your transactions…"
                    : isDraft
                      ? `Provisional. ${report.draftReasons[0]?.message ?? ""}${report.draftReasons.length > 1 ? ` (+${report.draftReasons.length - 1} more)` : ""}`
                      : "All questions answered. Ready to finalise."}
                {updating && report && <span className="sr-only"> Updating.</span>}
              </p>
              {updating && report && (
                <p className="text-caption text-ink-2" aria-hidden="true">
                  Updating…
                </p>
              )}
              {reportError && (
                <TextButton onClick={() => setRetry((k) => k + 1)} className="self-start text-label">
                  Try again
                </TextButton>
              )}
            </div>
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2.5 border-t border-line pt-4 text-small">
              <dt className="text-ink-2">Labelled by NRS rules</dt>
              <dd className="font-mono tabular-nums">{m.rule}</dd>
              <dt className="text-ink-2">Classified by private AI</dt>
              <dd className="font-mono tabular-nums">{m.ai}</dd>
              <dt className="text-ink-2">Answered by you</dt>
              <dd className="font-mono tabular-nums">{m.user}</dd>
            </dl>
            <ButtonLink href={resultHref} arrow className="w-full">
              {ctaLabel}
            </ButtonLink>
          </Card>
          <OtherIncome value={saved.otherIncomeNgn} onChange={(v) => setSaved((s) => ({ ...s, otherIncomeNgn: v }))} />
        </aside>
      </div>

      <div className="sticky bottom-3 mb-3 flex items-center gap-3 rounded-full bg-ink py-2.5 pr-2.5 pl-5 text-white shadow-float @min-[760px]:hidden">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-caption text-onink">
            {answered}/{n} answered{report ? ` · ${isDraft ? "Draft" : "Final"}` : ""}
          </span>
          <span className="font-serif text-2xl leading-none">{taxFigure}</span>
        </span>
        <ButtonLink href={resultHref} variant="secondary" size="md" arrow className="focus-onink border-white">
          See result
        </ButtonLink>
      </div>
    </>
  );
}

function OtherIncome({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const stripped = stripNgn(value);
  const invalid = stripped !== "" && !NGN_INPUT_RE.test(stripped);
  return (
    <Card className="flex flex-col gap-2.5 p-6">
      <label htmlFor="otherIncome" className="text-small font-medium">
        Your other taxable income in 2026 (₦)
      </label>
      <span className={cx("flex h-[46px] items-center rounded-full border pr-1.5 pl-4", invalid ? "border-red-dot" : "border-border-strong")}>
        <span aria-hidden="true" className="font-mono text-ink-2">
          ₦
        </span>
        <input
          id="otherIncome"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          aria-invalid={invalid || undefined}
          aria-describedby="otherIncome-help"
          className="h-10 min-w-0 flex-1 rounded-full px-2 font-mono text-ui text-ink"
        />
      </span>
      {invalid && (
        <p role="alert" className="text-label text-red-ink">
          Use digits only, with up to 2 decimal places (commas are fine).
        </p>
      )}
      <p id="otherIncome-help" className="flex items-start gap-2 text-label leading-normal text-ink-2">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" className="mt-0.5 flex-none">
          <rect x="4" y="9" width="12" height="8.5" rx="2" />
          <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
        </svg>
        Optional. Used to apply your correct tax band. Stays in your browser.
      </p>
    </Card>
  );
}

function QuestionCard({
  q,
  index,
  count,
  answer,
  usdById,
  assets,
  setGroup,
}: {
  q: Question;
  index: number;
  count: number;
  answer: GroupAnswer | undefined;
  usdById: Map<string, string>;
  assets: AssetChoice[];
  setGroup: (groupId: string, update: (g: GroupAnswer | undefined) => GroupAnswer | undefined) => void;
}) {
  const hid = useId();
  const optionById = new Map(q.options.map((o) => [o.id, o]));
  const effective = (txId: string) => (answer ? optionById.get(answer.overrides?.[txId] ?? answer.option) : undefined);
  const missing = q.txs.filter((t) => {
    const o = effective(t.id);
    const v = stripNgn(answer?.ngn?.[t.id] ?? "");
    return o?.followUp && !NGN_INPUT_RE.test(v);
  }).length;
  const dontKnow = q.txs.some((t) => effective(t.id)?.unresolved);
  const swapTxs = q.txs.filter((t) => effective(t.id)?.incompleteSourceLeg);
  const legOk = (t: QuestionTx) => {
    const l = legForRequest(answer?.sourceLegs?.[t.id]);
    return l !== null && normalizeSourceLeg(l, t.timestamp).ok;
  };
  const legsMissing = swapTxs.filter((t) => !legOk(t)).length;

  const pick = (optionId: string) =>
    setGroup(q.groupId, (g) =>
      g?.option === optionId
        ? undefined
        : { option: optionId, ...(g?.ngn ? { ngn: g.ngn } : {}), ...(g?.overrides ? { overrides: g.overrides } : {}), ...(g?.sourceLegs ? { sourceLegs: g.sourceLegs } : {}) },
    );

  let note: string | null = null;
  if (!answer) note = "Not sure? Choose “I don't know”. The transaction stays flagged and your report stays a draft.";
  else if (missing > 0) note = `${plural(missing, "naira amount")} still blank. ${missing === 1 ? "That transaction stays" : "Those transactions stay"} unanswered until you add ${missing === 1 ? "it" : "them"}.`;
  else if (dontKnow) note = "Marked “I don't know”: it stays flagged in your warnings and the report stays a draft.";
  if (swapTxs.length) {
    const swapNote =
      legsMissing === 0
        ? "Recorded as a swap. What you gave up is valued at its dollar price at that time; that value is both your proceeds and the cost of what you received (Circular 9.3.2)."
        : "Add what you gave up inside NEAR Intents to finalise. Until then the cost uses the dollar value you received (Circular 9.1.2 Step 1(b)) and the report stays a draft.";
    note = `${note ? `${note} ` : ""}${swapNote}`;
  }

  return (
    <section aria-labelledby={hid} className={cx("overflow-hidden rounded-card border bg-surface", answer ? "border-border" : "border-dash")}>
      <div className="flex flex-col gap-3 px-[clamp(18px,2cqi,28px)] pt-[clamp(18px,2cqi,28px)] pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-mono text-caption tracking-[0.02em] text-ink-2">
            Question {index + 1} of {count}
          </span>
          {answer ? (
            <Chip tone="verified" size="sm">
              Answered
            </Chip>
          ) : (
            <Chip tone="needs" size="sm">
              Needs you
            </Chip>
          )}
        </div>
        <h2 id={hid} className="text-[clamp(18px,1.5cqi,21px)] leading-[1.35] font-semibold tracking-[-0.01em] text-pretty">
          {q.text}
        </h2>
      </div>
      <ul className="px-[clamp(10px,1.2cqi,16px)]">
        {q.txs.map((t) => (
          <TxRow key={t.id} q={q} t={t} answer={answer} option={effective(t.id)} usd={usdById.get(`${t.id}|${t.asset}`)} assets={assets} setGroup={setGroup} />
        ))}
      </ul>
      <div className="border-t border-line bg-panel px-[clamp(18px,2cqi,28px)] pt-4 pb-[clamp(18px,2cqi,24px)]">
        <div role="group" aria-labelledby={hid} className="flex flex-wrap gap-2">
          {q.options.map((o) => (
            <AnswerChip key={o.id} selected={answer?.option === o.id} onClick={() => pick(o.id)}>
              {o.text}
            </AnswerChip>
          ))}
        </div>
        {note && <p className="mt-3 text-label leading-normal text-ink-2">{note}</p>}
      </div>
    </section>
  );
}

function TxRow({
  q,
  t,
  answer,
  option,
  usd,
  assets,
  setGroup,
}: {
  q: Question;
  t: QuestionTx;
  answer: GroupAnswer | undefined;
  option: AnswerOption | undefined;
  usd: string | undefined;
  assets: AssetChoice[];
  setGroup: (groupId: string, update: (g: GroupAnswer | undefined) => GroupAnswer | undefined) => void;
}) {
  const inputId = useId();
  const selectId = useId();
  const errId = useId();
  const incoming = q.direction === "in";
  const party = shortParty(q.counterparty);
  const override = answer?.overrides?.[t.id];
  const [overrideOpen, setShowOverride] = useState(false);
  const showOverride = overrideOpen || Boolean(override);
  const ngnValue = answer?.ngn?.[t.id] ?? "";
  const ngnStripped = stripNgn(ngnValue);
  const ngnInvalid = ngnStripped !== "" && !NGN_INPUT_RE.test(ngnStripped);
  const canOverride = Boolean(answer) && q.txs.length > 1;

  const setNgn = (v: string) =>
    setGroup(q.groupId, (g) => (g ? { ...g, ngn: { ...(g.ngn ?? {}), [t.id]: v } } : g));
  const setOverride = (v: string) =>
    setGroup(q.groupId, (g) => {
      if (!g) return g;
      const overrides = { ...(g.overrides ?? {}) };
      if (v === "" || v === g.option) delete overrides[t.id];
      else overrides[t.id] = v;
      return { ...g, overrides };
    });

  return (
    <li className="border-t border-line">
      <div className="flex flex-wrap items-center gap-3.5 px-[clamp(8px,1cqi,12px)] py-3">
        <span aria-hidden="true" className="grid size-[34px] flex-none place-items-center rounded-full bg-page text-ui">
          {incoming ? "↙" : "↗"}
        </span>
        <span className="flex min-w-0 flex-[1_1_120px] flex-col gap-0.5">
          <span className="truncate font-mono text-small" title={q.counterparty ?? undefined}>
            {party}
          </span>
          <span className="text-label text-ink-2">
            {fmtDate(t.timestamp)} · {incoming ? "Received" : "Sent"}
          </span>
        </span>
        <span className="ml-auto flex flex-col items-end gap-0.5">
          <Mono className="text-small font-medium">
            {incoming ? "+" : "−"}
            {fmtAmount(t.amount)} {t.asset}
          </Mono>
          {usd && <Mono className="text-caption text-ink-2">${fmtUsd(usd)}</Mono>}
        </span>
      </div>

      {(option?.followUp || option?.incompleteSourceLeg || canOverride) && (
        <div className="flex flex-col gap-2.5 pr-[clamp(8px,1cqi,12px)] pb-3.5 pl-[60px]">
          {option?.incompleteSourceLeg && (
            <SourceLegFields
              t={t}
              leg={answer?.sourceLegs?.[t.id]}
              assets={assets}
              onChange={(leg) => setGroup(q.groupId, (g) => (g ? { ...g, sourceLegs: { ...(g.sourceLegs ?? {}), [t.id]: leg } } : g))}
            />
          )}
          {option?.followUp && (
            <div className="flex flex-wrap items-center gap-2.5">
              <label htmlFor={inputId} className="text-label text-ink-2">
                {FOLLOW_UP_LABEL[option.followUp]}
              </label>
              <span
                className={cx(
                  "flex h-[38px] flex-[0_1_200px] items-center rounded-full border bg-surface pr-1 pl-3.5",
                  ngnInvalid ? "border-red-dot" : ngnStripped ? "border-border-strong" : "border-ink",
                )}
              >
                <span aria-hidden="true" className="font-mono text-small text-ink-2">
                  ₦
                </span>
                <input
                  id={inputId}
                  inputMode="decimal"
                  autoComplete="off"
                  value={ngnValue}
                  onChange={(e) => setNgn(e.target.value)}
                  placeholder="0.00"
                  aria-invalid={ngnInvalid || undefined}
                  aria-describedby={ngnInvalid ? errId : undefined}
                  className="h-[34px] min-w-0 flex-1 rounded-full px-2 font-mono text-small text-ink"
                />
              </span>
              {ngnInvalid && (
                <span id={errId} role="alert" className="text-label text-red-ink">
                  Digits only, up to 2 decimal places.
                </span>
              )}
            </div>
          )}
          {canOverride &&
            (showOverride ? (
              <div className="flex flex-wrap items-center gap-2.5">
                <label htmlFor={selectId} className="text-label text-ink-2">
                  Answer for this one
                </label>
                <select
                  id={selectId}
                  value={override ?? ""}
                  onChange={(e) => setOverride(e.target.value)}
                  className="h-[38px] max-w-full rounded-full border border-border-strong bg-surface px-3.5 text-small"
                >
                  <option value="">Same as the others</option>
                  {q.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.text}
                    </option>
                  ))}
                </select>
                {!override && (
                  <TextButton onClick={() => setShowOverride(false)} className="text-label text-ink-2">
                    Cancel
                  </TextButton>
                )}
              </div>
            ) : (
              <TextButton onClick={() => setShowOverride(true)} className="self-start text-label text-ink-2">
                Different answer for this one
              </TextButton>
            ))}
        </div>
      )}
    </li>
  );
}

const OTHER = "__other__";
const assetKey = (contract: string | null) => contract ?? "native";
/** "2026-10-13T15:52:22.647Z" -> "2026-10-13T15:52:22" for a UTC datetime-local input. */
const toUtcInput = (iso: string) => iso.slice(0, 19);

/** NEAR Intents swap follow-up: what was given up (asset, quantity, UTC time; time defaults to the receipt). */
function SourceLegFields({ t, leg, assets, onChange }: { t: QuestionTx; leg: SourceLegInput | undefined; assets: AssetChoice[]; onChange: (leg: SourceLegInput) => void }) {
  const ids = { asset: useId(), other: useId(), qty: useId(), time: useId(), err: useId() };
  const known = leg ? assets.some((a) => a.contract === leg.asset.contract && a.symbol === leg.asset.symbol) : false;
  const [otherOpen, setOtherOpen] = useState(false);
  const otherMode = otherOpen || (leg !== undefined && !known && leg.asset.contract !== null);
  const current: SourceLegInput = leg ?? { asset: { symbol: "", contract: "" }, quantity: "" };
  const update = (patch: Partial<SourceLegInput>) => onChange({ ...current, ...patch });

  const qty = stripNgn(current.quantity);
  const qtyInvalid = qty !== "" && !isPositiveQuantity(qty);
  const ready = legForRequest(leg);
  const check = ready ? normalizeSourceLeg(ready, t.timestamp) : null;
  const error = qtyInvalid ? "Quantity must be a positive number." : check && !check.ok ? `Check this: ${check.error}.` : null;
  const selectValue = otherMode ? OTHER : leg && known ? assetKey(leg.asset.contract) : "";
  const field = "h-[38px] rounded-full border bg-surface text-small";

  return (
    <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={error ? ids.err : undefined}>
      <legend className="mb-2 text-label text-ink-2">What did you give up?</legend>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={ids.asset} className="sr-only">
          Asset given up
        </label>
        <select
          id={ids.asset}
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value;
            if (v === OTHER) {
              setOtherOpen(true);
              update({ asset: { symbol: "", contract: "" } });
              return;
            }
            setOtherOpen(false);
            const a = assets.find((x) => assetKey(x.contract) === v);
            if (a) update({ asset: { symbol: a.symbol, contract: a.contract } });
          }}
          className={cx(field, "max-w-full px-3.5", selectValue ? "border-border-strong" : "border-ink")}
        >
          <option value="" disabled>
            Choose asset
          </option>
          {assets.map((a) => (
            <option key={assetKey(a.contract)} value={assetKey(a.contract)}>
              {a.contract ? `${a.symbol} (${a.contract})` : `${a.symbol} (native)`}
            </option>
          ))}
          <option value={OTHER}>Other token contract</option>
        </select>
        {otherMode && (
          <>
            <label htmlFor={ids.other} className="sr-only">
              Token contract account
            </label>
            <input
              id={ids.other}
              value={current.asset.contract ?? ""}
              onChange={(e) => {
                const c = e.target.value.trim().toLowerCase();
                update({ asset: { symbol: c, contract: c } });
              }}
              placeholder="token.example.near"
              spellCheck={false}
              autoCapitalize="none"
              className={cx(field, "w-[200px] max-w-full px-3.5 font-mono", current.asset.contract ? "border-border-strong" : "border-ink")}
            />
          </>
        )}
        <span className={cx("flex flex-[0_1_180px] items-center pr-3.5 pl-1", field, qtyInvalid ? "border-red-dot" : qty ? "border-border-strong" : "border-ink")}>
          <label htmlFor={ids.qty} className="sr-only">
            Quantity given up
          </label>
          <input
            id={ids.qty}
            inputMode="decimal"
            autoComplete="off"
            value={current.quantity}
            onChange={(e) => update({ quantity: e.target.value })}
            placeholder="Quantity"
            aria-invalid={qtyInvalid || undefined}
            className="h-[34px] min-w-0 flex-1 rounded-full px-2.5 font-mono text-small text-ink"
          />
          {current.asset.symbol && current.asset.symbol !== current.asset.contract && (
            <span aria-hidden="true" className="font-mono text-caption text-ink-2">
              {current.asset.symbol}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1.5">
          <label htmlFor={ids.time} className="sr-only">
            Date and time given up, UTC
          </label>
          <input
            id={ids.time}
            type="datetime-local"
            step="1"
            value={toUtcInput(current.timestamp ?? t.timestamp)}
            max={toUtcInput(t.timestamp)}
            onChange={(e) => {
              const v = e.target.value;
              if (v) update({ timestamp: `${v.length === 16 ? `${v}:00` : v}Z` });
            }}
            className={cx(field, "border-border-strong px-3 font-mono")}
          />
          <span className="text-caption text-ink-2">UTC</span>
        </span>
      </div>
      {error && (
        <p id={ids.err} role="alert" className="text-label text-red-ink">
          {error}
        </p>
      )}
    </fieldset>
  );
}
