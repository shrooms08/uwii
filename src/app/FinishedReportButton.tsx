"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { loadSaved, setDemoPreset, setSource, storeSaved } from "@/lib/client/storage";
import { DEMO_ACCOUNT, ILLUSTRATIVE_ANSWERS } from "@/lib/demo/illustrative-answers";

/**
 * Opens the finished demo report in one click: the committed classified run of the demo account (the
 * cached-demo path, no live AI call) with the illustrative answers loaded in this browser.
 */
export function FinishedReportButton({ recordedAt, compact }: { recordedAt: string; compact?: boolean }) {
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  return (
    <button
      type="button"
      disabled={opening}
      onClick={() => {
        setOpening(true);
        const saved = loadSaved(DEMO_ACCOUNT);
        storeSaved(DEMO_ACCOUNT, { ...saved, groups: structuredClone(ILLUSTRATIVE_ANSWERS.groups), otherIncomeNgn: ILLUSTRATIVE_ANSWERS.otherIncomeNgn });
        setDemoPreset(DEMO_ACCOUNT, true);
        setSource(DEMO_ACCOUNT, { source: "fixture", recordedAt });
        router.push(`/result?account=${DEMO_ACCOUNT}`);
      }}
      className={`inline-flex items-center justify-center gap-2 border border-white/14 bg-transparent font-medium text-ink backdrop-blur-sm transition-colors duration-200 hover:border-ink-2 hover:bg-white/[0.03] disabled:opacity-60 ${compact ? "h-9 rounded-control px-3.5 text-label" : "h-12 rounded-[10px] px-5 text-ui"}`}
    >
      {opening ? "Opening…" : "See a finished report"}
      {!compact && <span aria-hidden="true">→</span>}
    </button>
  );
}
