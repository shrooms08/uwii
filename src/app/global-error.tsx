"use client";

import "./globals.css";
import { GENERIC_ERROR } from "@/content/errors";

/** Root error boundary (replaces the root layout): the generic message and the error id only. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const id = error.digest ?? "in-browser";
  return (
    <html lang="en">
      <body>
        <main className="uwii mx-auto flex min-h-screen max-w-[640px] flex-col items-start justify-center gap-5 px-6">
          <span className="inline-flex h-7 items-center rounded-full border border-border bg-surface px-3 font-mono text-caption text-ink-2">Error</span>
          <h1 className="text-[44px] leading-none font-semibold tracking-[-0.02em]">Something went wrong</h1>
          <p className="text-body leading-[1.55] text-ink-2">
            {GENERIC_ERROR} <span className="font-mono text-ink">{id}</span>.
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={reset} className="inline-flex h-12 items-center rounded-full bg-ink px-6 text-ui font-medium text-on-ink">
              Try again
            </button>
            {/* A plain link: the app's router may be the thing that failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="inline-flex h-12 items-center rounded-full border border-border-strong bg-surface px-6 text-ui font-medium text-ink">
              Back to the start
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
