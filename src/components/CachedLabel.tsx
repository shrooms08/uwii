"use client";

import { useSyncExternalStore } from "react";
import { DEMO_EVENT, SOURCE_EVENT, isDemoPresetOn, loadSource } from "@/lib/client/storage";
import { DEMO_ACCOUNT } from "@/lib/demo/illustrative-answers";

function subscribe(onChange: () => void) {
  window.addEventListener(SOURCE_EVENT, onChange);
  window.addEventListener(DEMO_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SOURCE_EVENT, onChange);
    window.removeEventListener(DEMO_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** When the account uses the cached demo result (committed classified run): its recorded time, else null. */
export function useCachedSource(account: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => loadSource(account)?.recordedAt ?? null,
    () => null,
  );
}

/** Both the cached demo result and the illustrative answers are on (the one-click finished report). */
export function useFinishedDemo(account: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => account === DEMO_ACCOUNT && Boolean(loadSource(account)) && isDemoPresetOn(account),
    () => false,
  );
}

/** Shown on every page while an account uses the cached demo result (the committed classified run). */
export function CachedLabel({ account }: { account: string }) {
  const recordedAt = useCachedSource(account);
  const finished = useFinishedDemo(account);
  if (!recordedAt) return null;
  return (
    <p className="inline-flex items-center gap-2 self-start rounded-full border border-amber-line bg-amber-tint px-3 py-1 text-label font-medium text-amber-ink">
      <span aria-hidden="true" className="size-[7px] rounded-full bg-amber-dot" />
      {finished ? "Cached demo result · questions answered for illustration" : `Cached demo result · attestation recorded ${recordedAt.slice(0, 10)} ${recordedAt.slice(11, 16)} UTC`}
    </p>
  );
}
