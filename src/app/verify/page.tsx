import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import type { SearchParams } from "@/components/account-param";
import VerifyClient from "./VerifyClient";

export const metadata: Metadata = { title: "Verify a report · Uwii" };

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
