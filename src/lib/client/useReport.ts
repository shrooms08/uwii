"use client";

import { useEffect, useState } from "react";
import type { ReportData } from "@/lib/tax/ng/report";
import type { ClassificationMetrics } from "@/lib/tax/ng/types";
import { postJson, requestBody } from "./request";
import { loadSaved, type Saved } from "./storage";

export interface FlowSummary {
  /** Transactions in the classified run. */
  total: number;
  questions: number;
  metrics: ClassificationMetrics;
}

interface FlowResponse {
  questions: unknown[];
  metrics: ClassificationMetrics;
  records: unknown[];
}

/**
 * The report (and question-flow counts) for this account, computed by the server from the answers saved
 * in this browser. Nothing is stored server-side.
 */
export function useReport(account: string) {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [flow, setFlow] = useState<FlowSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Read this browser's answers after mount (localStorage is unavailable during server render).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaved(loadSaved(account));
  }, [account]);

  useEffect(() => {
    if (!saved) return;
    const controller = new AbortController();
    const body = requestBody(account, saved);
    Promise.all([postJson<ReportData>("/api/report", body, controller.signal), postJson<FlowResponse>("/api/questions", body, controller.signal)])
      .then(([r, f]) => {
        setReport(r);
        setFlow({ total: f.records.length, questions: f.questions.length, metrics: f.metrics });
        setError(null);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      });
    return () => controller.abort();
  }, [account, saved, attempt]);

  return {
    report,
    flow,
    saved,
    error,
    retry: () => {
      setError(null);
      setAttempt((n) => n + 1);
    },
  };
}

/** Trigger a browser download of in-memory data. */
export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
