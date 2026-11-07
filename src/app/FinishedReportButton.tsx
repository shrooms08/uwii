"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { loadSaved, setDemoPreset, setSource, storeSaved } from "@/lib/client/storage";
import { DEMO_ACCOUNT, ILLUSTRATIVE_ANSWERS } from "@/lib/demo/illustrative-answers";

/**
 * Opens the finished demo report in one click: the committed classified run of the demo account (the
 * cached-demo path, no live AI call) with the illustrative answers loaded in this browser.
 */
export function FinishedReportButton({ recordedAt }: { recordedAt: string }) {
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
      className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-border-strong bg-surface px-6 text-ui font-medium text-ink transition-colors hover:border-ink disabled:opacity-60"
    >
      {opening ? "Opening…" : "See a finished report"}
      <span aria-hidden="true">→</span>
    </button>
  );
}
