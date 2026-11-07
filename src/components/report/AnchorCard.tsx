"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckIcon } from "@/components/ui/AnswerChip";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ANCHOR_CAVEAT } from "@/content/anchor";
import { serializeBody } from "@/lib/client/request";
import { loadAnchor, storeAnchor, type StoredAnchor } from "@/lib/client/storage";

const shortHash = (h: string) => (h.length > 12 ? `${h.slice(0, 4)}…${h.slice(-4)}` : h);
const utc = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
const groupInt = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

type State = { kind: "checking" } | { kind: "idle" } | { kind: "busy" } | { kind: "done"; anchor: StoredAnchor; already: boolean } | { kind: "error"; message: string };

/**
 * "Anchor this report on NEAR" (design 07). Only the fingerprint goes on-chain; the server recomputes
 * the report from the same request body and refuses drafts.
 */
export function AnchorCard({ fingerprint, isFinal, body, onAnchor }: { fingerprint: string; isFinal: boolean; body: { account?: string; classificationSource?: string } & Record<string, unknown>; onAnchor?: (a: StoredAnchor) => void }) {
  const [state, setState] = useState<State>({ kind: "checking" });

  useEffect(() => {
    if (!isFinal) return;
    const stored = loadAnchor(fingerprint);
    if (stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ kind: "done", anchor: stored, already: true });
      onAnchor?.(stored);
      return;
    }
    // Anchored from another browser? The public verify endpoint says.
    const controller = new AbortController();
    fetch(`/api/verify?fingerprint=${fingerprint}`, { signal: controller.signal })
      .then((r) => r.json() as Promise<{ anchored?: boolean; anchor?: StoredAnchor }>)
      .then((j) => {
        if (j.anchored && j.anchor) {
          storeAnchor(j.anchor);
          setState({ kind: "done", anchor: j.anchor, already: true });
          onAnchor?.(j.anchor);
        } else setState({ kind: "idle" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: "idle" });
      });
    return () => controller.abort();
  }, [fingerprint, isFinal, onAnchor]);

  async function anchor() {
    setState({ kind: "busy" });
    try {
      const res = await fetch("/api/anchor", { method: "POST", headers: { "content-type": "application/json" }, body: await serializeBody(body) });
      const json = (await res.json()) as StoredAnchor & { alreadyAnchored?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      if (json.fingerprint !== fingerprint) throw new Error("The server computed a different fingerprint; reload the page and try again.");
      const a: StoredAnchor = {
        fingerprint: json.fingerprint,
        status: json.status,
        network: json.network,
        contractId: json.contractId,
        anchoredBy: json.anchoredBy,
        blockHeight: json.blockHeight,
        anchoredAt: json.anchoredAt,
        txHash: json.txHash,
        explorerUrl: json.explorerUrl,
        blockUrl: json.blockUrl,
      };
      storeAnchor(a);
      setState({ kind: "done", anchor: a, already: Boolean(json.alreadyAnchored) });
      onAnchor?.(a);
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <Card aria-labelledby="anc-h" className="flex flex-col gap-4 p-[clamp(20px,2.4cqi,32px)]">
      <h2 id="anc-h" className="text-lg font-semibold tracking-[-0.01em]">
        Anchor this report on NEAR
      </h2>
      <p className="text-ui leading-[1.55] text-pretty text-ink-2">
        Writes only the fingerprint to the NEAR blockchain, with a timestamp; nothing in the report is revealed.{" "}
        <span className="whitespace-nowrap">NEAR testnet.</span>
      </p>
      <p className="rounded-inset border border-border bg-muted px-3.5 py-2.5 text-label leading-normal text-ink-soft">{ANCHOR_CAVEAT}</p>

      {!isFinal ? (
        <div className="flex flex-col gap-2">
          <Button disabled className="h-[50px] self-start px-6 text-ui" aria-describedby="anc-draft">
            Anchor fingerprint
          </Button>
          <p id="anc-draft" className="text-label text-amber-ink">
            Finalise the report to anchor it.
          </p>
        </div>
      ) : state.kind === "checking" ? (
        <p role="status" className="text-label text-ink-2">
          Checking whether this fingerprint is already anchored…
        </p>
      ) : state.kind === "idle" || state.kind === "error" ? (
        <div className="flex flex-col gap-2">
          <Button onClick={anchor} className="h-[50px] self-start px-6 text-ui">
            {state.kind === "error" ? "Try again" : "Anchor fingerprint"}
          </Button>
          {state.kind === "error" && (
            <p role="alert" className="text-label text-red-ink">
              Could not anchor: {state.message}
            </p>
          )}
        </div>
      ) : state.kind === "busy" ? (
        <span role="status" className="inline-flex h-[50px] items-center gap-2.5 self-start rounded-full bg-chip px-6 text-ui font-medium">
          <span aria-hidden="true" className="size-3.5 rounded-full border-2 border-border-strong border-t-ink [animation:uwii-spin_.8s_linear_infinite]" />
          Anchoring on NEAR…
        </span>
      ) : (
        <div role="status" className="flex flex-col gap-3 rounded-[18px] border border-gold-line bg-gold-tint p-[18px]">
          <span className="flex items-center gap-2.5 text-ui font-semibold text-gold-ink">
            <span className="grid size-6 flex-none place-items-center rounded-full bg-gold text-on-ink">
              <CheckIcon size={12} />
            </span>
            {state.already ? "Already anchored on NEAR testnet" : "Anchored on NEAR testnet"}
          </span>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-small text-gold-ink">
            <dt>Block</dt>
            <dd className="font-mono text-label">{groupInt(state.anchor.blockHeight)}</dd>
            <dt>Time</dt>
            <dd className="font-mono text-label">{utc(state.anchor.anchoredAt)}</dd>
            <dt>Contract</dt>
            <dd className="font-mono text-label break-all">{state.anchor.contractId}</dd>
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            {state.anchor.explorerUrl && state.anchor.txHash ? (
              <a
                href={state.anchor.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 max-w-full min-w-0 items-center gap-2 rounded-full border border-gold-line bg-surface px-4 font-mono text-label hover:border-ink"
                title={state.anchor.txHash}
              >
                <span className="truncate">nearvalidate.org/txns/{shortHash(state.anchor.txHash)}</span>
                <span aria-hidden="true" className="flex-none">↗</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <a href={state.anchor.blockUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-full border border-gold-line bg-surface px-4 font-mono text-label hover:border-ink">
                block {groupInt(state.anchor.blockHeight)} ↗
              </a>
            )}
            <Link href={`/verify?fingerprint=${fingerprint}`} className="text-label text-gold-ink underline underline-offset-[3px]">
              Verify it
            </Link>
          </div>
        </div>
      )}
    </Card>
  );
}
