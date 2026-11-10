"use client";

import { useEffect, useState } from "react";
import type { ReportData } from "@/lib/tax/ng/compute";
import type { ClassificationMetrics } from "@/lib/tax/ng/types";
import { loadSaved, type Saved } from "./storage";

export interface FlowSummary {
  /** Transactions in the classified run. */
  total: number;
  questions: number;
  metrics: ClassificationMetrics;
}

/**
 * The report (and question-flow counts) for this account, computed in this browser from the signed scan
 * and the answers saved here (src/lib/client/local-report.ts). Nothing is sent to the server.
 */
export function useReport(account: string) {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [flow, setFlow] = useState<FlowSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set when only a new scan can help (no scan in this browser, or one saved by an older version). */
  const [needsScan, setNeedsScan] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Read this browser's answers after mount (localStorage is unavailable during server render).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaved(loadSaved(account));
  }, [account]);

  useEffect(() => {
    if (!saved) return;
    let live = true;
    import("./local-report")
      .then(({ computeLocalReport }) => computeLocalReport(account, saved))
      .then(({ report: r, view }) => {
        if (!live) return;
        setReport(r);
        setFlow({ total: view.records.length, questions: view.questions.length, metrics: view.metrics });
        setError(null);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setError(e instanceof Error ? e.message : String(e));
        setNeedsScan(isScanError(e));
      });
    return () => {
      live = false;
    };
  }, [account, saved, attempt]);

  return {
    report,
    flow,
    saved,
    error,
    needsScan,
    retry: () => {
      setError(null);
      setAttempt((n) => n + 1);
    },
  };
}

const isScanError = (e: unknown) => typeof e === "object" && e !== null && "code" in e && (e.code === "not_scanned" || e.code === "rescan");

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
