"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { TextButton } from "@/components/ui/Button";
import { loadSaved, storeSaved } from "@/lib/client/storage";
import { DEMO_ACCOUNT } from "@/lib/demo/illustrative-answers";
import { isValidAccountId, parseAccountList } from "@/lib/near/account-id";

export function LandingForm() {
  const router = useRouter();
  const [account, setAccount] = useState("");
  const [showOthers, setShowOthers] = useState(false);
  const [others, setOthers] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [othersError, setOthersError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const errId = useId();
  const othersErrId = useId();

  function start(e: FormEvent) {
    e.preventDefault();
    const id = account.trim().toLowerCase();
    if (!isValidAccountId(id)) {
      setError(id ? `“${id}” is not a valid NEAR account id. Use lowercase letters, digits, - and _, like yourname.near.` : "Enter your NEAR account, like yourname.near.");
      return;
    }
    const own = parseAccountList(others).filter((a) => a !== id);
    const bad = own.filter((a) => !isValidAccountId(a));
    if (bad.length) {
      setOthersError(`Not a valid NEAR account id: ${bad.join(", ")}`);
      return;
    }
    setError(null);
    setOthersError(null);
    // Own accounts stay in this browser; the scan sends them only to count the questions left.
    if (showOthers) storeSaved(id, { ...loadSaved(id), ownText: own.join(", ") });
    setStarting(true);
    router.push(`/scan?account=${encodeURIComponent(id)}`);
  }

  return (
    <form onSubmit={start} noValidate className="w-full max-w-[560px] text-left">
      <label htmlFor="acct" className="mb-2.5 ml-1 block text-small font-medium text-ink-soft">
        Your NEAR account
      </label>
      <div className="flex flex-wrap gap-2 rounded-card border border-border-strong bg-surface/80 p-1.5 shadow-raised backdrop-blur-sm">
        <input
          id="acct"
          name="account"
          value={account}
          onChange={(e) => {
            setAccount(e.target.value);
            if (error) setError(null);
          }}
          placeholder="yourname.near"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          className="h-[50px] min-w-0 flex-[999_1_220px] rounded-control bg-transparent px-4 font-mono text-[17px] text-ink"
        />
        <button
          type="submit"
          disabled={starting}
          className="btn-glow flex h-[50px] flex-[1_0_auto] items-center justify-center gap-2.5 rounded-control bg-gold px-6 text-ui font-medium text-on-ink shadow-[0_0_0_1px_rgb(230_187_121_/0.35),0_10px_34px_-8px_rgb(230_187_121_/0.6)] hover:bg-gold-hover disabled:opacity-60"
        >
          {starting ? "Starting…" : "Start private scan"}
          <span aria-hidden="true" className="arrow-nudge">→</span>
        </button>
      </div>
      {error && (
        <p id={errId} role="alert" className="mt-2.5 ml-1.5 text-label text-red-ink">
          {error}
        </p>
      )}

      <div className="mt-3 ml-1 flex flex-wrap items-center gap-x-5 gap-y-2">
        {!showOthers && (
          <TextButton aria-expanded={false} aria-controls="others-panel" onClick={() => setShowOthers(true)}>
            + Other accounts you own
          </TextButton>
        )}
        <TextButton
          onClick={() => {
            setAccount(DEMO_ACCOUNT);
            setError(null);
            document.getElementById("acct")?.focus();
          }}
          className="text-ink-2"
        >
          Try the demo account
        </TextButton>
      </div>

      {showOthers && (
        <div id="others-panel" className="mt-3.5 flex flex-col gap-2.5 rounded-card border border-border bg-surface p-[18px]">
          <label htmlFor="acct2" className="text-small font-medium">
            Other accounts you own
          </label>
          <textarea
            id="acct2"
            value={others}
            onChange={(e) => {
              setOthers(e.target.value);
              if (othersError) setOthersError(null);
            }}
            placeholder={"another.near, savings.near\none per line also works"}
            rows={2}
            spellCheck={false}
            autoCapitalize="none"
            aria-invalid={othersError ? true : undefined}
            aria-describedby={othersError ? `${othersErrId} others-help` : "others-help"}
            className="min-h-[46px] resize-y rounded-control border border-border-strong bg-sunken px-4 py-[11px] font-mono text-ui leading-[1.5] text-ink"
          />
          {othersError && (
            <p id={othersErrId} role="alert" className="text-label text-red-ink">
              {othersError}
            </p>
          )}
          <p id="others-help" className="text-label leading-normal text-ink-2">
            Separate with commas or new lines. Transfers between your own accounts are treated as self-transfers, not income. Saved only in this browser.
          </p>
          <TextButton
            aria-expanded={true}
            onClick={() => {
              setShowOthers(false);
              setOthers("");
              setOthersError(null);
            }}
            className="self-start text-label text-ink-2"
          >
            Remove
          </TextButton>
        </div>
      )}
    </form>
  );
}
