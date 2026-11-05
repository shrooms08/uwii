"use client";

import { useEffect, useState } from "react";
import type { AnswerOption, ApplySummary, GroupAnswer, Question } from "@/lib/tax/ng/questions";
import type { ClassificationMetrics } from "@/lib/tax/ng/types";

interface SlimRecord {
  id: string;
  timestamp: string;
  kind: string;
  direction: string;
  asset: string;
  amount: string;
  counterparty: string | null;
  label: string;
  method: string;
  needsQuestion: boolean;
  circularRef: string;
  reason: string;
  userFiat: { ngn: string } | null;
  previousLabel: string | null;
}

interface FlowResponse {
  origin: string;
  classifiedAt: string;
  questions: Question[];
  summary: ApplySummary;
  metrics: ClassificationMetrics;
  records: SlimRecord[];
  error?: string;
}

interface Saved {
  ownText: string;
  groups: Record<string, GroupAnswer>;
  otherIncomeNgn: string;
}

const EMPTY: Saved = { ownText: "", groups: {}, otherIncomeNgn: "" };
const storageKey = (account: string) => `uwii:answers:${account}`;
const parseOwn = (text: string) => text.split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
const cell = { border: "1px solid #ddd", padding: "4px 6px", textAlign: "left", verticalAlign: "top" } as const;

function load(account: string): Saved {
  try {
    const raw = window.localStorage.getItem(storageKey(account));
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Saved) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

export default function QuestionFlow({ account }: { account: string }) {
  const [saved, setSaved] = useState<Saved>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [data, setData] = useState<FlowResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"own" | "questions">("own");

  useEffect(() => {
    // Hydrate from this browser's storage after mount (localStorage is unavailable during SSR).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaved(load(account));
    setLoaded(true);
  }, [account]);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(storageKey(account), JSON.stringify(saved));
    } catch {
      // storage unavailable (private mode); answers still work for this session
    }
  }, [account, saved, loaded]);

  async function submit(next: Saved) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/questions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          account,
          ownAccounts: parseOwn(next.ownText),
          answers: { groups: next.groups },
          profile: { otherIncomeNgn: next.otherIncomeNgn.trim() },
        }),
      });
      const json = (await res.json()) as FlowResponse;
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json);
      setStep("questions");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const setGroup = (groupId: string, update: (g: GroupAnswer | undefined) => GroupAnswer | undefined) =>
    setSaved((s) => {
      const groups = { ...s.groups };
      const g = update(groups[groupId]);
      if (g) groups[groupId] = g;
      else delete groups[groupId];
      return { ...s, groups };
    });

  if (!loaded) return <p>Loading…</p>;

  return (
    <div>
      <section style={{ border: "1px solid #ccc", padding: 12, marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Step 1 · Your other NEAR accounts</h2>
        <p style={{ fontSize: 13, color: "#555" }}>
          List any other NEAR accounts you own (comma or line separated). Transfers between them are not taxable. Stored only in this browser.
        </p>
        <textarea
          data-testid="own-accounts"
          rows={3}
          style={{ width: "100%", fontFamily: "ui-monospace, monospace" }}
          value={saved.ownText}
          onChange={(e) => setSaved((s) => ({ ...s, ownText: e.target.value }))}
          placeholder="savings.near, 52435fe9…"
        />
        <p>
          <label>
            Other taxable income in 2026 (NGN, optional):{" "}
            <input
              data-testid="other-income"
              inputMode="decimal"
              value={saved.otherIncomeNgn}
              onChange={(e) => setSaved((s) => ({ ...s, otherIncomeNgn: e.target.value }))}
              placeholder="e.g. 4800000"
            />
          </label>
        </p>
        <button data-testid="continue" disabled={busy} onClick={() => submit(saved)}>
          {step === "own" ? "Continue" : "Re-check with these accounts"}
        </button>
      </section>

      {error && <p style={{ color: "#b00020" }}>Error: {error}</p>}

      {data && step === "questions" && (
        <>
          <section>
            <h2 style={{ fontSize: 16 }}>Step 2 · Questions ({data.questions.length})</h2>
            {data.questions.length === 0 && <p>Nothing to ask: every transaction is classified.</p>}
            {data.questions.map((q) => (
              <QuestionCard key={q.groupId} q={q} answer={saved.groups[q.groupId]} onChange={(fn) => setGroup(q.groupId, fn)} />
            ))}
            {data.questions.length > 0 && (
              <button data-testid="apply" disabled={busy} onClick={() => submit(saved)}>
                Apply answers
              </button>
            )}
          </section>

          <section data-testid="summary" style={{ marginTop: 20 }}>
            <h2 style={{ fontSize: 16 }}>Summary</h2>
            <p>
              Resolved by you: <strong>{data.summary.resolvedByUser}</strong> · Answered “I don&apos;t know”: {data.summary.answeredDontKnow} · Still
              unresolved: <strong>{data.summary.unresolved}</strong> · Naira amounts missing: {data.summary.missingFollowUps.length}
            </p>
            <p style={{ fontSize: 12, color: "#555" }}>
              {data.metrics.total} transactions · rule {data.metrics.rule} · AI {data.metrics.ai} · you {data.metrics.user} · source {data.origin}
            </p>
            <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  {["date", "dir", "amount", "counterparty", "label", "method", "naira", "circularRef", "question?"].map((h) => (
                    <th key={h} style={cell}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.records
                  .filter((r) => r.method === "user" || r.needsQuestion)
                  .map((r) => (
                    <tr key={r.id} style={r.needsQuestion ? { background: "#fff8e1" } : undefined}>
                      <td style={cell}>{r.timestamp.slice(0, 10)}</td>
                      <td style={cell}>{r.direction}</td>
                      <td style={cell}>{r.amount} {r.asset}</td>
                      <td style={{ ...cell, fontSize: 12 }}>{r.counterparty ?? "—"}</td>
                      <td style={cell}>{r.label}{r.previousLabel ? ` (was ${r.previousLabel})` : ""}</td>
                      <td style={cell}>{r.method}</td>
                      <td style={cell}>{r.userFiat ? `₦${r.userFiat.ngn}` : "—"}</td>
                      <td style={{ ...cell, fontSize: 12 }}>{r.circularRef}</td>
                      <td style={cell}>{r.needsQuestion ? "yes" : "no"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}

function QuestionCard({
  q,
  answer,
  onChange,
}: {
  q: Question;
  answer: GroupAnswer | undefined;
  onChange: (fn: (g: GroupAnswer | undefined) => GroupAnswer | undefined) => void;
}) {
  const effective = (txId: string): AnswerOption | undefined => q.options.find((o) => o.id === (answer?.overrides?.[txId] ?? answer?.option));
  return (
    <div data-testid={`question-${q.groupId}`} style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12 }}>
      <p style={{ fontWeight: 600, marginTop: 0 }}>{q.text}</p>
      <div>
        {q.options.map((o) => (
          <label key={o.id} style={{ display: "block", fontSize: 14 }}>
            <input
              type="radio"
              name={q.groupId}
              checked={answer?.option === o.id}
              onChange={() => onChange((g) => ({ ...g, option: o.id }))}
            />{" "}
            {o.text}
            {o.followUp && <span style={{ color: "#555" }}> (asks for the naira amount)</span>}
          </label>
        ))}
      </div>
      <table style={{ borderCollapse: "collapse", fontSize: 13, marginTop: 8 }}>
        <thead>
          <tr>
            {["date", "amount", "answer for this transaction", "naira amount"].map((h) => (
              <th key={h} style={cell}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {q.txs.map((t) => {
            const eff = effective(t.id);
            return (
              <tr key={t.id}>
                <td style={cell}>{t.timestamp.slice(0, 10)}</td>
                <td style={cell}>{t.amount} {t.asset}</td>
                <td style={cell}>
                  <select
                    value={answer?.overrides?.[t.id] ?? ""}
                    onChange={(e) =>
                      onChange((g) => {
                        const overrides = { ...(g?.overrides ?? {}) };
                        if (e.target.value) overrides[t.id] = e.target.value;
                        else delete overrides[t.id];
                        return { option: g?.option ?? "", ...g, overrides };
                      })
                    }
                  >
                    <option value="">Same as group</option>
                    {q.options.map((o) => (
                      <option key={o.id} value={o.id}>{o.text}</option>
                    ))}
                  </select>
                </td>
                <td style={cell}>
                  {eff?.followUp ? (
                    <input
                      inputMode="decimal"
                      placeholder={eff.followUp === "ngn_paid" ? "₦ paid" : "₦ received"}
                      value={answer?.ngn?.[t.id] ?? ""}
                      onChange={(e) => onChange((g) => ({ option: g?.option ?? "", ...g, ngn: { ...(g?.ngn ?? {}), [t.id]: e.target.value } }))}
                    />
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
