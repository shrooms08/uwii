"use client";

import Link from "next/link";

/** Nav call to action (light-filled): brings the account field into view and focuses it. */
export function NavStartButton() {
  return (
    <Link
      href="/#acct"
      onClick={(e) => {
        const el = document.getElementById("acct");
        if (!el) return;
        e.preventDefault();
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
        el.focus({ preventScroll: true });
      }}
      className="inline-flex h-9 items-center gap-1.5 rounded-control bg-ink px-3.5 text-label font-medium whitespace-nowrap text-on-ink transition-colors duration-200 hover:bg-ink-hover"
    >
      Start private scan
    </Link>
  );
}
