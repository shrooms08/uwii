import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site/metadata";
import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import type { SearchParams } from "@/components/account-param";
import VerifyClient from "./VerifyClient";

export const metadata: Metadata = pageMetadata("Verify a report · Uwii", "Check whether a Uwii report fingerprint was anchored on NEAR testnet, and when. Only the fingerprint is ever written on-chain.", "/verify");

async function Verify({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.fingerprint) ? sp.fingerprint[0] : sp.fingerprint;
  const fp = (raw ?? "").replace(/\s+/g, "").toLowerCase();
  return <VerifyClient key={fp} initial={/^[0-9a-f]{64}$/.test(fp) ? fp : ""} />;
}

export default function VerifyPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <Verify searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}
