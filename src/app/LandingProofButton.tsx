"use client";

import { useCallback, useState } from "react";
import { PrivacyPanel } from "@/components/report/PrivacyPanel";
import type { PrivacyProof } from "@/lib/report/privacy";

/** Opens the privacy proof recorded for the demo account's committed run. */
export function LandingProofButton({ proof, account, ruleCount, label }: { proof: PrivacyProof; account: string; ruleCount: number; label: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="self-start text-left text-small font-medium text-gold underline-offset-[3px] hover:underline">
        {label}
        <span aria-hidden="true"> →</span>
      </button>
      {open && <PrivacyPanel proof={proof} account={account} ruleCount={ruleCount} onClose={close} />}
    </>
  );
}
