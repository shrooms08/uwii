"use client";

import { useSyncExternalStore } from "react";
import { SOURCE_EVENT, loadSource } from "@/lib/client/storage";

function subscribe(onChange: () => void) {
  window.addEventListener(SOURCE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SOURCE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Shown on every page while an account uses the cached demo result (the committed classified run). */
export function CachedLabel({ account }: { account: string }) {
  const recordedAt = useSyncExternalStore(
    subscribe,
    () => loadSource(account)?.recordedAt ?? null,
    () => null,
  );
  if (!recordedAt) return null;
  return (
    <p className="inline-flex items-center gap-2 self-start rounded-full border border-border bg-surface px-3 py-1 text-label font-medium text-ink-soft">
      <span aria-hidden="true" className="size-[7px] rounded-full bg-ink-3" />
      Cached demo result · attestation recorded {recordedAt.slice(0, 10)} {recordedAt.slice(11, 16)} UTC
    </p>
  );
}
