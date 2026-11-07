"use client";

import { useSyncExternalStore } from "react";
import { DEMO_EVENT, SOURCE_EVENT, isDemoPresetOn, loadSource } from "@/lib/client/storage";
import { DEMO_ACCOUNT, DEMO_LABEL } from "@/lib/demo/illustrative-answers";

function subscribe(onChange: () => void) {
  window.addEventListener(DEMO_EVENT, onChange);
  window.addEventListener(SOURCE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(DEMO_EVENT, onChange);
    window.removeEventListener(SOURCE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Persistent label shown only while the illustrative demo answers are loaded for the demo account. */
export function DemoLabel({ account }: { account: string }) {
  const on = useSyncExternalStore(
    subscribe,
    // With the cached demo result too, CachedLabel shows one combined label instead.
    () => account === DEMO_ACCOUNT && isDemoPresetOn(account) && !loadSource(account),
    () => false,
  );
  if (!on) return null;
  return (
    <p className="inline-flex items-center gap-2 self-start rounded-full border border-amber-line bg-amber-tint px-3 py-1 text-label font-medium text-amber-ink">
      <span aria-hidden="true" className="size-[7px] rounded-full bg-amber-dot" />
      {DEMO_LABEL}
    </p>
  );
}
