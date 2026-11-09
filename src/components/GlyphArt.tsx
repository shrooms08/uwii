"use client";

import { useEffect, useRef } from "react";

/**
 * Hero glyph art (The Tax Collectors, in gold ledger glyphs): the decorative, aria-hidden canvas. The
 * renderer (src/components/glyph-art-run.ts) and the art grid are loaded after first paint, in an idle
 * callback, so neither is in the page's initial JavaScript and the headline stays the LCP.
 */
export function GlyphArt({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cleanup = () => {};
    let cancelled = false;
    const start = async () => {
      const [{ run }, { default: grid }] = await Promise.all([import("./glyph-art-run"), import("@/content/glyph-art.json"), document.fonts?.ready, document.fonts?.load('600 16px "Uwii Mono Symbols"', "\u20a6").catch(() => [])]);
      if (cancelled || !ref.current) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      cleanup = run(ref.current, grid, reduced);
    };
    const idle = "requestIdleCallback" in window;
    const id = idle ? window.requestIdleCallback(() => void start(), { timeout: 600 }) : window.setTimeout(() => void start(), 120);
    return () => {
      cancelled = true;
      if (idle) window.cancelIdleCallback(id);
      else window.clearTimeout(id);
      cleanup();
    };
  }, []);
  return <canvas ref={ref} aria-hidden="true" className={className} />;
}
