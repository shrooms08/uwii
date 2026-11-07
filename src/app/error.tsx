"use client";

import { AppShell } from "@/components/AppShell";
import { StatusPage } from "@/components/StatusPage";
import { GENERIC_ERROR } from "@/content/errors";

/** Route error boundary: the generic message and the error id only (never the internal message). */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const id = error.digest ?? "in-browser";
  return (
    <AppShell>
      <StatusPage
        chip="Error"
        title="Something went wrong"
        actions={
          <button type="button" onClick={reset} className="inline-flex h-12 items-center rounded-full bg-ink px-6 text-ui font-medium text-white hover:bg-ink-hover">
            Try again
          </button>
        }
      >
        <p>
          {GENERIC_ERROR} <span className="font-mono text-ink">{id}</span>.
        </p>
      </StatusPage>
    </AppShell>
  );
}
