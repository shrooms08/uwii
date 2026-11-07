"use client";

import { useEffect, useRef } from "react";

/**
 * The scan vessel in the hero's glyph language: a bowl of mono cells that fills with gold glyphs as
 * transactions are labelled (decorative; the number above it is the data). Denser glyphs deeper down, a
 * bright rippling surface line, faint dots for the empty bowl. ~700 cells drawn at up to 30 fps; pauses in
 * a background tab; one static frame per update under prefers-reduced-motion.
 */
const COLS = 46;
const ROWS = 16;
const FILL = "=+*#%@";
const GOLD = "230,187,121";
const CREAM = "249,233,203";

function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** Bowl outline in unit coordinates (from the original 280x150 vessel): a shallow rim over a round base. */
function insideBowl(x: number, y: number): boolean {
  const u = (x - 0.5) / 0.483;
  if (Math.abs(u) > 1) return false;
  const rim = (20 + 20 * (1 - u * u)) / 150;
  const base = 0.13 + 0.857 * Math.sqrt(1 - u * u);
  return y >= rim && y <= base;
}

export function GlyphVessel({ fraction }: { fraction: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const target = useRef(0.1);
  const redraw = useRef<(() => void) | null>(null);
  useEffect(() => {
    target.current = 0.1 + 0.8 * Math.max(0, Math.min(1, fraction));
    redraw.current?.();
  }, [fraction]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const v = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-mono").trim();
    const family = `${v ? `${v}, ` : ""}ui-monospace, Menlo, monospace`;
    let level = reduced ? target.current : 0.1;
    let raf = 0;
    let last = 0;

    const draw = (now: number) => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      level = reduced ? target.current : level + (target.current - level) * 0.06;
      const cw = w / COLS;
      const ch = h / ROWS;
      ctx.clearRect(0, 0, w, h);
      ctx.font = `600 ${ch * 0.92}px ${family}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const t = reduced ? 0 : now / 1000;
      const bucket = reduced ? 0 : Math.floor(now / 140);
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const x = (c + 0.5) / COLS;
          const y = (r + 0.5) / ROWS;
          if (!insideBowl(x, y)) continue;
          const surface = 1 - (level * 128) / 150 + 0.035 * Math.sin(x * Math.PI * 3 + t * 2.2) + 0.02 * Math.sin(x * Math.PI * 7 - t * 1.4);
          const i = r * COLS + c;
          let chr = ".";
          let a = 0.16;
          let rgb = GOLD;
          if (y > surface + 0.5 / ROWS) {
            const depth = Math.min(1, (y - surface) / 0.6);
            const k = Math.min(FILL.length - 1, Math.floor((0.35 + 0.65 * depth) * FILL.length * (0.8 + 0.4 * hash(i, bucket))));
            chr = FILL[Math.max(0, k)];
            a = 0.55 + 0.45 * depth;
          } else if (y > surface - 0.5 / ROWS) {
            chr = hash(i, bucket) < 0.5 ? "~" : "-";
            a = 1;
            rgb = CREAM;
          }
          ctx.fillStyle = `rgba(${rgb},${a})`;
          ctx.fillText(chr, c * cw + cw / 2, r * ch + ch / 2);
        }
      }
    };

    redraw.current = () => {
      if (reduced) draw(0);
    };
    if (reduced) {
      draw(0);
      const ro = new ResizeObserver(() => draw(0));
      ro.observe(canvas);
      return () => ro.disconnect();
    }
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 1000 / 30 - 2) return;
      last = now;
      draw(now);
    };
    const play = () => {
      if (!raf && !document.hidden) raf = requestAnimationFrame(loop);
    };
    const pause = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVis = () => (document.hidden ? pause() : play());
    document.addEventListener("visibilitychange", onVis);
    play();
    return () => {
      pause();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="block aspect-[280/150] w-full" />;
}
