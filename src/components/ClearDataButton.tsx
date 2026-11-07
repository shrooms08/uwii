"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { clearRuns } from "@/lib/client/runs";
import { cx } from "./ui/cx";

/** Removes everything Uwii keeps in this browser: answers, personal fields, reliefs, anchors and saved scans (N4). */
export async function clearUwiiBrowserData(): Promise<void> {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k?.startsWith("uwii:")) keys.push(k);
    }
    for (const k of keys) window.localStorage.removeItem(k);
  } catch {
    // storage unavailable: nothing was kept
  }
  await clearRuns();
}

export function ClearDataButton({ className }: { className?: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  return (
    <button
      type="button"
      disabled={state === "busy"}
      onClick={async () => {
        if (!window.confirm("Remove your answers, personal details, reliefs and saved scans from this browser? This cannot be undone.")) return;
        setState("busy");
        await clearUwiiBrowserData();
        setState("done");
        router.push("/");
      }}
      className={cx("p-0 disabled:opacity-60", className ?? "text-ink underline underline-offset-[3px] hover:text-ink-soft")}
    >
      {state === "done" ? "Cleared" : "Clear my data from this browser"}
    </button>
  );
}
