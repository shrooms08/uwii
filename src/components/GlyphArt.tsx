"use client";

import { useEffect, useRef } from "react";

/**
 * Hero signature: Marinus van Reymerswaele's "The Tax Collectors" (1540s, public domain) drawn in gold
 * ledger glyphs from a precomputed luminance grid (src/content/glyph-art.json, built by
 * scripts/glyph-art.ts). Decorative: the canvas is aria-hidden; the credit is in the footer.
 *
 * Cost: the art is drawn once into an offscreen canvas; each frame is one blit plus a few drifting glyph
 * clusters, and the shimmer redraws a handful of cells at a low rate. Starts after first paint (the
 * headline stays the LCP), pauses off-screen or in a background tab, and draws one static frame under
 * prefers-reduced-motion. Mobile uses a quarter of the cells and 30 fps.
 */

interface Grid {
  cols: number;
  rows: number;
  levels: number;
  data: string;
}

/** Ledger glyphs ordered by visual density. */
const RAMP = " .:-=+*#%@";
/** Occasional accents on bright cells. */
const ACCENTS = "₦0123456789";
const GOLD = [230, 187, 121] as const;
const CREAM = [246, 230, 196] as const;
/** Width / height of a monospace glyph cell. */
const CELL_ASPECT = 0.62;

type Rng = () => number;
function rng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function decode(g: Grid): Float32Array {
  const bytes = Uint8Array.from(atob(g.data), (c) => c.charCodeAt(0));
  const out = new Float32Array(g.cols * g.rows);
  for (let i = 0; i < out.length; i++) {
    const q = i % 2 === 0 ? bytes[i >> 1] >> 4 : bytes[i >> 1] & 15;
    out[i] = q / (g.levels - 1);
  }
  return out;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function monoFamily(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-mono").trim();
  return `${v ? `${v}, ` : ""}ui-monospace, Menlo, monospace`;
}

function run(canvas: HTMLCanvasElement, grid: Grid, reduced: boolean): () => void {
  const lum = decode(grid);
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const family = monoFamily();
  let disposed = false;
  let raf = 0;
  let shimmerTimer = 0;
  let onScreen = true;

  // Layout state (rebuilt on resize).
  let W = 0;
  let H = 0;
  let dpr = 1;
  let mobile = false;
  let art: HTMLCanvasElement | null = null;
  let artX = 0;
  let artY = 0;
  let cellW = 0;
  let cellH = 0;
  let step = 1;
  let cols = 0;
  let rows = 0;
  let fontPx = 0;
  let alphas = new Float32Array(0);
  let levels = new Float32Array(0);
  let clusters: { x: number; y: number; vx: number; vy: number; glyphs: { dx: number; dy: number; ch: string; a: number }[] }[] = [];
  const pointer = { tx: 0, ty: 0, x: 0, y: 0 };
  const random = rng(20261107);

  const glyphFor = (v: number, r: Rng) => {
    if (v > 0.62 && r() < 0.025) return ACCENTS[Math.floor(r() * ACCENTS.length)];
    const i = Math.min(RAMP.length - 1, Math.max(1, Math.round(Math.pow(v, 0.8) * (RAMP.length - 1))));
    return RAMP[i];
  };
  const colourFor = (v: number, a: number) => {
    const t = smooth(0.7, 1, v);
    const c = GOLD.map((g, i) => Math.round(g + (CREAM[i] - g) * t));
    return `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
  };

  function drawCell(actx: CanvasRenderingContext2D, c: number, r: number, ch: string) {
    const i = r * cols + c;
    const a = alphas[i];
    actx.clearRect(c * cellW, r * cellH, cellW, cellH);
    if (a <= 0.02 || ch === " ") return;
    actx.fillStyle = colourFor(levels[i], a);
    actx.fillText(ch, c * cellW + cellW / 2, r * cellH + cellH / 2);
  }

  function layout() {
    const rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    mobile = W < 760;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Art box: the right ~60% of the hero on desktop, the top band on mobile.
    const box = mobile ? { x: 0, y: 0, w: W, h: Math.min(H * 0.5, 440) } : { x: W * 0.4, y: 0, w: W * 0.6, h: H };
    step = mobile ? 2 : 1;
    cols = Math.floor(grid.cols / step);
    rows = Math.floor(grid.rows / step);
    cellW = box.w / cols;
    cellH = cellW / CELL_ASPECT;
    if (rows * cellH > box.h) {
      cellH = box.h / rows;
      cellW = cellH * CELL_ASPECT;
    }
    const artW = cols * cellW;
    const artH = rows * cellH;
    artX = box.x + (box.w - artW) / (mobile ? 2 : 1.4);
    artY = box.y + (box.h - artH) / 2;
    fontPx = Math.max(5, cellH * 1.02);

    levels = new Float32Array(cols * rows);
    alphas = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let v = 0;
        for (let dy = 0; dy < step; dy++) for (let dx = 0; dx < step; dx++) v += lum[(r * step + dy) * grid.cols + (c * step + dx)];
        v /= step * step;
        // Fade toward the art's edges (and more toward the text column on desktop).
        const ex = c / (cols - 1);
        const ey = r / (rows - 1);
        const edge = smooth(0, mobile ? 0.12 : 0.28, ex) * smooth(0, 0.08, 1 - ex) * smooth(0, 0.1, ey) * smooth(0, mobile ? 0.3 : 0.12, 1 - ey);
        const i = r * cols + c;
        levels[i] = v;
        alphas[i] = v < 0.06 ? 0 : (0.24 + 0.76 * Math.pow(v, 0.95)) * edge * (mobile ? 0.9 : 1);
      }
    }

    art = document.createElement("canvas");
    art.width = Math.ceil(artW * dpr);
    art.height = Math.ceil(artH * dpr);
    const actx = art.getContext("2d")!;
    actx.setTransform(dpr, 0, 0, dpr, 0, 0);
    actx.font = `600 ${fontPx}px ${family}`;
    actx.textAlign = "center";
    actx.textBaseline = "middle";
    const r0 = rng(1540);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) drawCell(actx, c, r, glyphFor(levels[r * cols + c], r0));

    // Sparse drifting clusters across the rest of the hero.
    const count = mobile ? 7 : 16;
    clusters = Array.from({ length: count }, () => {
      const n = 3 + Math.floor(random() * 9);
      return {
        x: random() * W,
        y: random() * H,
        vx: (random() - 0.5) * 6,
        vy: (random() - 0.5) * 3,
        glyphs: Array.from({ length: n }, () => ({
          dx: Math.round((random() - 0.5) * 7) * cellW * 1.6,
          dy: Math.round((random() - 0.5) * 4) * cellH * 1.2,
          ch: RAMP[2 + Math.floor(random() * (RAMP.length - 2))],
          a: 0.07 + random() * 0.2,
        })),
      };
    });
  }

  function frame(dt: number) {
    ctx!.clearRect(0, 0, W, H);
    pointer.x += (pointer.tx - pointer.x) * 0.06;
    pointer.y += (pointer.ty - pointer.y) * 0.06;
    ctx!.font = `600 ${fontPx}px ${family}`;
    ctx!.textAlign = "center";
    ctx!.textBaseline = "middle";
    for (const k of clusters) {
      k.x = (k.x + k.vx * dt + W) % W;
      k.y = (k.y + k.vy * dt + H) % H;
      for (const g of k.glyphs) {
        ctx!.fillStyle = `rgba(${GOLD[0]},${GOLD[1]},${GOLD[2]},${g.a})`;
        ctx!.fillText(g.ch, k.x + g.dx + pointer.x * 26, k.y + g.dy + pointer.y * 26);
      }
    }
    if (art) ctx!.drawImage(art, artX + pointer.x * 14, artY + pointer.y * 14, art.width / dpr, art.height / dpr);
  }

  function shimmer() {
    if (!art || disposed) return;
    const actx = art.getContext("2d")!;
    actx.font = `600 ${fontPx}px ${family}`;
    actx.textAlign = "center";
    actx.textBaseline = "middle";
    const n = mobile ? 10 : 26;
    for (let k = 0; k < n; k++) {
      const c = Math.floor(random() * cols);
      const r = Math.floor(random() * rows);
      const v = levels[r * cols + c];
      if (v < 0.25) continue;
      const nudged = Math.min(1, Math.max(0, v + (random() - 0.5) * 0.25));
      drawCell(actx, c, r, glyphFor(nudged, random));
    }
  }

  layout();
  frame(0);
  if (reduced) {
    const ro = new ResizeObserver(() => {
      layout();
      frame(0);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }

  let last = performance.now();
  let acc = 0;
  const minFrame = mobile ? 1000 / 30 : 0;
  const loop = (now: number) => {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    acc += now - last;
    last = now;
    if (acc < minFrame) return;
    acc = 0;
    frame(dt);
  };
  const play = () => {
    if (raf || disposed || !onScreen || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(loop);
    shimmerTimer = window.setInterval(shimmer, mobile ? 160 : 90);
  };
  const pause = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    window.clearInterval(shimmerTimer);
  };
  const onPointer = (e: PointerEvent) => {
    pointer.tx = e.clientX / window.innerWidth - 0.5;
    pointer.ty = e.clientY / window.innerHeight - 0.5;
  };
  const onVisibility = () => (document.hidden ? pause() : play());
  const io = new IntersectionObserver((entries) => {
    onScreen = entries.some((e) => e.isIntersecting);
    if (onScreen) play();
    else pause();
  });
  const ro = new ResizeObserver(() => {
    layout();
    frame(0);
  });
  io.observe(canvas);
  ro.observe(canvas);
  window.addEventListener("pointermove", onPointer, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  play();
  return () => {
    disposed = true;
    pause();
    io.disconnect();
    ro.disconnect();
    window.removeEventListener("pointermove", onPointer);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

export function GlyphArt({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cleanup = () => {};
    let cancelled = false;
    const start = async () => {
      const [{ default: grid }] = await Promise.all([import("@/content/glyph-art.json"), document.fonts?.ready]);
      if (cancelled || !ref.current) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      cleanup = run(ref.current, grid as Grid, reduced);
    };
    // After first paint, so the headline and buttons render first.
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
