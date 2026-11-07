// The hero glyph-art renderer, loaded on demand by src/components/GlyphArt.tsx after first paint (kept
// out of the page's initial JavaScript).
/**
 * Hero signature: Marinus van Reymerswaele's "The Tax Collectors" (1540s, public domain) drawn in gold
 * ledger glyphs from a precomputed, subject-masked luminance grid (src/content/glyph-art.json, built by
 * scripts/glyph-art.ts). Decorative: the canvas is aria-hidden; the credit is in the footer.
 *
 * Full-bleed: the canvas spans the viewport width and the hero height (behind the nav); the art is
 * anchored right and bleeds off the right edge; sparse glyph clusters form and dissolve across the rest.
 *
 * Motion: an intro decode (random glyphs resolve into the image in a left-to-right wave, ~1.2 s); a brief
 * glitch every 4-8 s (bands shift and scramble; sometimes two blocks swap and settle back); a soft gold
 * light follows the cursor (or the last touch), brightening glyphs, cycling their characters and nudging
 * them away, with a spring.
 *
 * Cost: every glyph is pre-rendered once into a sprite atlas (character x tint) and blitted; the art is
 * cached in its own layer, so a frame is one blit plus the overlays above. Fewer, larger cells and 30 fps
 * on small screens and low-end devices (hardwareConcurrency / deviceMemory), DPR capped. Starts after
 * first paint (the headline stays the LCP); pauses off-screen or in a background tab; under
 * prefers-reduced-motion it draws one static frame with no decode, glitch or cursor effects.
 */

export interface Grid {
  cols: number;
  rows: number;
  levels: number;
  data: string;
}

/** Ledger glyphs ordered by visual density (index 0 lightest). */
const RAMP = ".:-=+*#%@";
/** Occasional accents on bright cells. */
const ACCENTS = "₦0123456789";
/** Atlas characters: the ramp, the accents, then extra scramble glyphs. */
const CHARS = [...RAMP, ...ACCENTS, ..."/<>|$!?"];
const N_RAMP = RAMP.length;
const N_CHARS = CHARS.length;
/** Tints from brand gold to near-white gold (the last is used only inside the cursor light). */
const TINTS: [number, number, number][] = [
  [230, 187, 121],
  [237, 202, 146],
  [243, 218, 174],
  [249, 233, 203],
  [255, 247, 229],
];
/** Width / height of a monospace glyph cell. */
const CELL_ASPECT = 0.62;
const DECODE_MS = 1200;

type Rng = () => number;
function rng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
/** Stable pseudo-random value in [0,1) for (a, b): no allocation, used per cell per time bucket. */
function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function monoFamily(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-mono").trim();
  return `${v ? `${v}, ` : ""}ui-monospace, Menlo, monospace`;
}

interface Cluster {
  x: number;
  y: number;
  life: number;
  age: number;
  glyphs: { dc: number; dr: number; ch: number; max: number; a0: number; b0: number }[];
}

export function run(canvas: HTMLCanvasElement, grid: Grid, reduced: boolean): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const family = monoFamily();
  let levels: Uint8Array | null = null;
  const random = rng(20261107);
  const nav = navigator as Navigator & { deviceMemory?: number };
  const lowEnd = (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;

  let disposed = false;
  let raf = 0;
  let onScreen = true;

  // ---------- layout state (rebuilt on resize) ----------
  let W = 0; // CSS px
  let H = 0;
  let dpr = 1;
  let small = false; // narrow screen or low-end device: fewer, larger cells and 30 fps
  let mobile = false;
  let cols = 0;
  let rows = 0;
  let cellW = 0; // CSS px
  let cellH = 0;
  let sw = 0; // sprite size, device px
  let sh = 0;
  let artXd = 0; // art origin, device px
  let artYd = 0;
  let artAlpha = 1;
  let atlas: HTMLCanvasElement | null = null;
  let nctx: CanvasRenderingContext2D | null = null;
  let ready = false;
  const noiseRng = rng(2026);
  let layer: HTMLCanvasElement | null = null;
  let lctx: CanvasRenderingContext2D | null = null;
  /** Per art cell (row-major, cols x rows): level (0 = empty), char, tint, alpha. */
  let lv = new Float32Array(0);
  let ch = new Uint8Array(0);
  let tint = new Uint8Array(0);
  let alpha = new Float32Array(0);
  let filled = new Uint32Array(0);
  /** Decode: a pre-rendered layer of scrambled glyphs and a per-row jitter of the resolving wave. */
  let noise: HTMLCanvasElement | null = null;
  let rowJitter = new Float32Array(0);
  let clusters: Cluster[] = [];

  const sprite = (c: CanvasRenderingContext2D, k: number, t: number, x: number, y: number, a: number) => {
    if (a <= 0.01) return;
    c.globalAlpha = a > 1 ? 1 : a;
    c.drawImage(atlas!, k * sw, t * sh, sw, sh, x, y, sw, sh);
  };
  const cellX = (c: number) => Math.round(artXd + c * cellW * dpr);
  const cellY = (r: number) => Math.round(artYd + r * cellH * dpr);
  const rampFor = (v: number) => Math.min(N_RAMP - 1, Math.max(0, Math.round(Math.pow(v, 0.8) * (N_RAMP - 1))));

  /** Ambient field drawable (atlas tint 0 and clusters exist) before the art itself is ready. */
  let fieldReady = false;

  /**
   * Start-up and re-layout as a sequence of small steps (each well under 16 ms on a 4x-throttled phone),
   * run in idle slices by runSteps(): grid decode, geometry, the atlas one tint at a time (the ambient
   * field starts drawing after the first), the cells a few rows at a time, then the art and decode layers
   * in batches. The intro decode starts when the last step is done.
   */
  function* initSteps(): Generator<void> {
    ready = false;
    fieldReady = false;
    if (!levels) {
      const bytes = atob(grid.data);
      yield;
      const out = new Uint8Array(grid.cols * grid.rows);
      for (let i = 0; i < out.length; i++) {
        const b = bytes.charCodeAt(i >> 1);
        out[i] = i % 2 === 0 ? b >> 4 : b & 15;
        if ((i & 8191) === 8191) yield;
      }
      levels = out;
      yield;
    }
    yield* layoutSteps();
  }

  function* layoutSteps(): Generator<void> {
    const src = levels!;
    const rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    mobile = W < 760;
    small = mobile || lowEnd;
    dpr = Math.min(window.devicePixelRatio || 1, lowEnd ? 1.5 : 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    yield;

    // Art: anchored right, bleeding off the right edge. Desktop: up to ~74% of the width and the hero
    // height; narrow screens: wider than the screen, behind the headline area, at reduced opacity.
    const step = small ? 2 : 1;
    cols = Math.floor(grid.cols / step);
    rows = Math.floor(grid.rows / step);
    if (mobile) {
      cellW = (W * 1.18) / cols;
    } else {
      const byWidth = (W * 0.74) / cols;
      const byHeight = ((H - 40) * CELL_ASPECT) / rows;
      cellW = Math.min(byWidth, byHeight);
    }
    cellH = cellW / CELL_ASPECT;
    const artW = cols * cellW;
    const artH = rows * cellH;
    const artX = W - artW * (mobile ? 0.9 : 0.92);
    const artY = mobile ? 64 : Math.max(48, (H - artH) / 2 + 12);
    artXd = artX * dpr;
    artYd = artY * dpr;
    artAlpha = mobile ? 0.92 : 1;
    sw = Math.ceil(cellW * dpr);
    sh = Math.ceil(cellH * dpr);

    // Sprite atlas: CHARS across, TINTS down, one tint per step. The ambient field only needs tint 0,
    // so it starts drawing as soon as that row exists.
    atlas = document.createElement("canvas");
    atlas.width = sw * N_CHARS;
    atlas.height = sh * TINTS.length;
    const a = atlas.getContext("2d")!;
    a.font = `600 ${Math.max(5, cellH * dpr * 0.98)}px ${family}`;
    a.textAlign = "center";
    a.textBaseline = "middle";
    for (let t = 0; t < TINTS.length; t++) {
      const [r, g, b] = TINTS[t];
      a.fillStyle = `rgb(${r},${g},${b})`;
      CHARS.forEach((c, k) => a.fillText(c, k * sw + sw / 2, t * sh + sh / 2));
      yield;
      if (t === 0) {
        // Ambient field: sparse clusters anywhere in the hero (also behind the nav).
        const count = small ? 14 : 34;
        clusters = Array.from({ length: count }, () => spawn(random() * 6000));
        fieldReady = true;
        yield;
      }
    }

    // Cells.
    const n = cols * rows;
    lv = new Float32Array(n);
    ch = new Uint8Array(n);
    tint = new Uint8Array(n);
    alpha = new Float32Array(n);
    const list: number[] = [];
    const r0 = rng(1540);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let s = 0;
        let m = 0;
        for (let dy = 0; dy < step; dy++) {
          for (let dx = 0; dx < step; dx++) {
            const q = src[(r * step + dy) * grid.cols + (c * step + dx)];
            if (q) {
              s += q;
              m++;
            }
          }
        }
        const i = r * cols + c;
        // A cell is empty unless at least half of its source cells are subject.
        if (m * 2 < step * step) continue;
        const v = s / m / (grid.levels - 1);
        lv[i] = v;
        ch[i] = v > 0.55 && r0() < 0.03 ? N_RAMP + Math.floor(r0() * ACCENTS.length) : rampFor(v);
        tint[i] = v > 0.88 ? 3 : v > 0.72 ? 2 : v > 0.55 ? 1 : 0;
        // Larger, averaged cells on small screens read darker, so their curve is gentler.
        alpha[i] = artAlpha * (small ? 0.16 + 0.84 * Math.pow(v, 0.95) : 0.1 + 0.9 * Math.pow(v, 1.3));
        list.push(i);
      }
      if ((r & 7) === 7) yield;
    }
    filled = Uint32Array.from(list);
    yield;

    // Art layer: every filled cell, drawn once (the shimmer updates single cells).
    layer = document.createElement("canvas");
    layer.width = Math.ceil(artW * dpr) + sw;
    layer.height = Math.ceil(artH * dpr) + sh;
    lctx = layer.getContext("2d")!;
    yield;

    // Decode layer (only while the intro runs): the same cells as random glyphs.
    rowJitter = Float32Array.from({ length: rows }, () => r0());
    noise = null;
    nctx = null;
    if (decoding) {
      noise = document.createElement("canvas");
      noise.width = layer.width;
      noise.height = layer.height;
      nctx = noise.getContext("2d")!;
      yield;
    }
    // Fill both layers in batches.
    for (let k = 0; k < filled.length; k++) {
      drawLayerCell(filled[k]);
      if ((k & 127) === 127) yield;
    }
    yield;
    if (nctx) {
      for (let k = 0; k < filled.length; k++) {
        const i = filled[k];
        const c = i % cols;
        const r = (i - c) / cols;
        sprite(nctx, Math.floor(noiseRng() * N_CHARS), Math.floor(noiseRng() * 3), Math.round(c * cellW * dpr), Math.round(r * cellH * dpr), alpha[i] * 0.75);
        if ((k & 127) === 127) yield;
      }
    }
    ready = true;
    // The intro decode starts once its layers exist.
    if (decoding) start = performance.now();
  }

  // ---------- chunked start-up scheduler ----------
  let job: Generator<void> | null = null;
  let jobHandle = 0;
  const hasIdle = typeof window.requestIdleCallback === "function";
  /** Called when the current job finishes (draws the static frame under reduced motion). */
  let onReady: () => void = () => {};

  function slice() {
    jobHandle = 0;
    if (disposed || !job) return;
    const t0 = performance.now();
    // ~8 ms of steps per slice; each step is small, so no task comes near 50 ms.
    do {
      if (job.next().done) {
        job = null;
        onReady();
        return;
      }
    } while (performance.now() - t0 < 8);
    schedule();
  }
  function schedule() {
    jobHandle = hasIdle ? window.requestIdleCallback(slice, { timeout: 120 }) : window.setTimeout(slice, 16);
  }
  function cancelJob() {
    if (jobHandle) {
      if (hasIdle) window.cancelIdleCallback(jobHandle);
      else window.clearTimeout(jobHandle);
    }
    jobHandle = 0;
    job = null;
  }
  function relayout() {
    cancelJob();
    job = initSteps();
    schedule();
  }

  function drawLayerCell(i: number) {
    const c = i % cols;
    const r = (i - c) / cols;
    const x = Math.round(c * cellW * dpr);
    const y = Math.round(r * cellH * dpr);
    lctx!.clearRect(x, y, sw, sh);
    sprite(lctx!, ch[i], tint[i], x, y, alpha[i]);
  }

  function spawn(age = 0): Cluster {
    const n = 4 + Math.floor(random() * 11);
    const glyphs: Cluster["glyphs"] = [];
    const seen = new Set<string>();
    let dc = 0;
    let dr = 0;
    for (let k = 0; k < n * 2 && glyphs.length < n; k++) {
      const key = `${dc},${dr}`;
      if (!seen.has(key)) {
        seen.add(key);
        glyphs.push({
          dc,
          dr,
          ch: random() < 0.12 ? N_RAMP + Math.floor(random() * ACCENTS.length) : 1 + Math.floor(random() * (N_RAMP - 1)),
          max: 0.07 + random() * 0.16,
          a0: random() * 0.35,
          b0: 0.6 + random() * 0.25,
        });
      }
      if (random() < 0.72) dc += random() < 0.5 ? 1 : -1;
      else dr += random() < 0.5 ? 1 : -1;
    }
    // Snap to the art's cell grid so clusters read as ledger fragments.
    const gx = Math.floor((random() * W) / cellW) * cellW;
    const gy = Math.floor((random() * H) / cellH) * cellH;
    return { x: gx, y: gy, life: 4000 + random() * 5000, age, glyphs };
  }

  // ---------- interaction state ----------
  const ptr = { x: 0, y: 0, tx: 0, ty: 0, inten: 0, target: 0, speed: 0, push: 0, pushV: 0, lastX: 0, lastY: 0, lastT: 0 };
  let start = 0;
  let decoding = !reduced;
  let nextGlitch = 0;
  let glitch: {
    t0: number;
    dur: number;
    bands: { r0: number; r1: number; dx: number }[];
    swap: { ac: number; ar: number; bc: number; br: number; w: number; h: number; dur: number } | null;
  } | null = null;
  let lastShimmer = 0;

  function scheduleGlitch(now: number) {
    nextGlitch = now + 3000 + random() * 3000;
  }

  function makeGlitch(now: number) {
    // 3-6 bands of 1-4 rows, placed on rows that have art (so every band shows), shifted 24-90 px.
    const nb = 3 + Math.floor(random() * 4);
    const bands = Array.from({ length: nb }, () => {
      const h = 1 + Math.floor(random() * 4);
      const at = Math.floor((filled[Math.floor(random() * filled.length)] ?? 0) / cols);
      const r0 = Math.max(0, Math.min(rows - h, at - Math.floor(h / 2)));
      return { r0, r1: r0 + h, dx: (random() < 0.5 ? -1 : 1) * (24 + random() * 66) };
    });
    let swap = null;
    if (random() < 1 / 3) {
      const w = 6 + Math.floor(random() * 8);
      const h = 3 + Math.floor(random() * 4);
      // Two blocks on filled cells, so the swap is visible.
      const pick = () => filled[Math.floor(random() * filled.length)] ?? 0;
      const a = pick();
      const b = pick();
      swap = {
        ac: Math.min(cols - w, a % cols),
        ar: Math.min(rows - h, Math.floor(a / cols)),
        bc: Math.min(cols - w, b % cols),
        br: Math.min(rows - h, Math.floor(b / cols)),
        w,
        h,
        dur: 420 + random() * 200,
      };
    }
    glitch = { t0: now, dur: 180 + random() * 180, bands, swap };
  }

  // ---------- drawing ----------
  function drawAmbient(now: number, dt: number) {
    for (let k = 0; k < clusters.length; k++) {
      let cl = clusters[k];
      if (!reduced) {
        cl.age += dt;
        if (cl.age > cl.life) cl = clusters[k] = spawn();
      }
      const t = reduced ? 0.5 : cl.age / cl.life;
      for (let g = 0; g < cl.glyphs.length; g++) {
        const gl = cl.glyphs[g];
        const a = gl.max * smooth(gl.a0, gl.a0 + 0.12, t) * (1 - smooth(gl.b0, gl.b0 + 0.12, t));
        if (a <= 0.01) continue;
        // Characters turn over now and then.
        const chr = !reduced && hash(k * 64 + g, Math.floor(now / 420)) < 0.12 ? 1 + Math.floor(hash(g, k + Math.floor(now / 420)) * (N_RAMP - 1)) : gl.ch;
        sprite(ctx!, chr, 0, Math.round((cl.x + gl.dc * cellW) * dpr), Math.round((cl.y + gl.dr * cellH) * dpr), a * (mobile ? 0.8 : 1));
      }
    }
  }

  /**
   * Intro decode: a left-to-right wave (each row jittered) over DECODE_MS. Resolved parts of each row show
   * the art layer; the rest shows the scrambled layer, offset by a cell every 55 ms so its glyphs flicker.
   * Two clipped blits per frame, whatever the number of cells.
   */
  function drawDecode(t: number) {
    if (!layer || !noise) return;
    const p = t / DECODE_MS;
    const ch_ = cellH * dpr;
    const bounds = new Float32Array(rows);
    for (let r = 0; r < rows; r++) bounds[r] = Math.max(0, Math.min(1, (p - 0.28 * rowJitter[r]) / 0.72)) * canvas.width;
    ctx!.globalAlpha = 1;
    ctx!.save();
    ctx!.beginPath();
    for (let r = 0; r < rows; r++) if (bounds[r] > 0) ctx!.rect(0, cellY(r), bounds[r], ch_ + 1);
    ctx!.clip();
    ctx!.drawImage(layer, artXd, artYd);
    ctx!.restore();
    ctx!.save();
    ctx!.beginPath();
    for (let r = 0; r < rows; r++) if (bounds[r] < canvas.width) ctx!.rect(bounds[r], cellY(r), canvas.width - bounds[r], ch_ + 1);
    ctx!.clip();
    ctx!.globalAlpha = smooth(0, 180, t);
    const shift = [0, 1, -1][Math.floor(t / 55) % 3] * Math.round(cellW * dpr);
    ctx!.drawImage(noise, artXd + shift, artYd);
    ctx!.restore();
  }

  function drawCursor(now: number) {
    const R = mobile ? 110 : 140;
    const px = ptr.x;
    const py = ptr.y;
    const Rd = R * dpr;
    const cxd = px * dpr;
    const cyd = py * dpr;
    ctx!.save();
    ctx!.beginPath();
    ctx!.arc(cxd, cyd, Rd, 0, Math.PI * 2);
    ctx!.clip();
    ctx!.clearRect(cxd - Rd, cyd - Rd, Rd * 2, Rd * 2);
    const g = ctx!.createRadialGradient(cxd, cyd, 0, cxd, cyd, Rd);
    g.addColorStop(0, `rgba(230,187,121,${0.16 * ptr.inten})`);
    g.addColorStop(0.55, `rgba(230,187,121,${0.06 * ptr.inten})`);
    g.addColorStop(1, "rgba(230,187,121,0)");
    ctx!.globalAlpha = 1;
    ctx!.fillStyle = g;
    ctx!.fillRect(cxd - Rd, cyd - Rd, Rd * 2, Rd * 2);
    const ax = artXd / dpr;
    const ay = artYd / dpr;
    const c0 = Math.max(0, Math.floor((px - R - ax) / cellW) - 1);
    const c1 = Math.min(cols - 1, Math.ceil((px + R - ax) / cellW) + 1);
    const rA = Math.max(0, Math.floor((py - R - ay) / cellH) - 1);
    const rB = Math.min(rows - 1, Math.ceil((py + R - ay) / cellH) + 1);
    const bucket = Math.floor(now / 70);
    const pushPx = 14 * ptr.push;
    for (let r = rA; r <= rB; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * cols + c;
        const v = lv[i];
        if (!v) continue;
        const gx = ax + (c + 0.5) * cellW;
        const gy = ay + (r + 0.5) * cellH;
        const dx = gx - px;
        const dy = gy - py;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= R) {
          sprite(ctx!, ch[i], tint[i], cellX(c), cellY(r), alpha[i]);
          continue;
        }
        const f = (1 - d / R) ** 2 * ptr.inten;
        const k = d > 0.001 ? (f * pushPx) / d : 0;
        let chr = ch[i];
        if (f > 0.2) {
          const base = rampFor(v);
          chr = Math.min(N_RAMP - 1, Math.max(0, base - 2 + Math.floor(hash(i, bucket) * 5)));
        }
        const t = Math.min(TINTS.length - 1, tint[i] + Math.round(f * 4));
        sprite(ctx!, chr, t, Math.round((ax + c * cellW + dx * k) * dpr), Math.round((ay + r * cellH + dy * k) * dpr), alpha[i] * (1 + 1.6 * f) + 0.25 * f);
      }
    }
    ctx!.restore();
  }

  function drawGlitch(now: number) {
    if (!glitch || !layer) return;
    const g = glitch;
    const t = now - g.t0;
    if (t < g.dur) {
      const jitter = Math.floor(t / 45);
      for (const b of g.bands) {
        const y0 = cellY(b.r0);
        const y1 = cellY(b.r1);
        ctx!.clearRect(0, y0, canvas.width, y1 - y0);
        const dx = b.dx * (hash(b.r0, jitter) < 0.5 ? 1 : 0.4) * dpr;
        // Split: a faint duplicate offset against the shift direction (an RGB-split look in gold).
        const split = -Math.sign(b.dx) * (7 + 5 * hash(jitter, b.r0)) * dpr;
        for (let r = b.r0; r < b.r1; r++) {
          for (let c = 0; c < cols; c++) {
            const i = r * cols + c;
            if (!lv[i]) continue;
            const scramble = hash(i, jitter) < 0.55;
            const k = scramble ? Math.floor(hash(jitter, i) * N_CHARS) : ch[i];
            const t = scramble ? Math.min(TINTS.length - 1, tint[i] + 2) : tint[i];
            const a = alpha[i] * (scramble ? 1.35 : 1) + (scramble ? 0.1 : 0);
            const x = Math.round(cellX(c) + dx);
            sprite(ctx!, k, TINTS.length - 1, Math.round(x + split), cellY(r) - Math.round(dpr), a * 0.35);
            sprite(ctx!, k, t, x, cellY(r), a);
          }
        }
      }
    }
    const s = g.swap;
    if (s && t < s.dur) {
      // Blocks swap, hold, then slide back into place.
      const k = smooth(0.45, 1, t / s.dur);
      const w = Math.round(s.w * cellW * dpr);
      const h = Math.round(s.h * cellH * dpr);
      const ax = Math.round(s.ac * cellW * dpr);
      const ay = Math.round(s.ar * cellH * dpr);
      const bx = Math.round(s.bc * cellW * dpr);
      const by = Math.round(s.br * cellH * dpr);
      ctx!.clearRect(artXd + ax, artYd + ay, w, h);
      ctx!.clearRect(artXd + bx, artYd + by, w, h);
      ctx!.globalAlpha = 1;
      ctx!.drawImage(layer, bx, by, w, h, artXd + bx + (ax - bx) * (1 - k), artYd + by + (ay - by) * (1 - k), w, h);
      ctx!.drawImage(layer, ax, ay, w, h, artXd + ax + (bx - ax) * (1 - k), artYd + ay + (by - ay) * (1 - k), w, h);
    }
    if (t >= g.dur && (!s || t >= s.dur)) {
      glitch = null;
      scheduleGlitch(now);
    }
  }

  function frame(now: number, dt: number) {
    ctx!.setTransform(1, 0, 0, 1, 0, 0);
    ctx!.globalAlpha = 1;
    ctx!.clearRect(0, 0, canvas.width, canvas.height);
    if (!ready) {
      // Still starting up: the ambient field draws as soon as its atlas row exists.
      if (fieldReady) drawAmbient(now, dt);
      return;
    }
    const t = now - start;
    if (decoding && t < DECODE_MS + 50) {
      drawDecode(t);
    } else {
      if (decoding) {
        decoding = false;
        noise = null;
        nctx = null;
        scheduleGlitch(now);
      }
      if (layer) ctx!.drawImage(layer, artXd, artYd);
      if (!reduced) {
        if (ptr.inten > 0.01) drawCursor(now);
        if (!glitch && now >= nextGlitch && nextGlitch) makeGlitch(now);
        if (glitch) drawGlitch(now);
      }
    }
    drawAmbient(now, dt);
  }

  function shimmer(now: number) {
    if (!ready || decoding || now - lastShimmer < (small ? 200 : 110) || !filled.length) return;
    lastShimmer = now;
    const n = small ? 8 : 24;
    for (let k = 0; k < n; k++) {
      const i = filled[Math.floor(random() * filled.length)];
      const v = lv[i];
      if (v < 0.25 || ch[i] >= N_RAMP) continue;
      ch[i] = rampFor(Math.min(1, Math.max(0, v + (random() - 0.5) * 0.3)));
      drawLayerCell(i);
    }
  }

  function updatePointer(dt: number) {
    const ease = 1 - Math.pow(1 - 0.18, dt / 16.7);
    ptr.x += (ptr.tx - ptr.x) * ease;
    ptr.y += (ptr.ty - ptr.y) * ease;
    ptr.inten += (ptr.target - ptr.inten) * (1 - Math.pow(1 - 0.08, dt / 16.7));
    // Spring on the push: faster pointer movement pushes glyphs further; they spring back as it slows.
    const target = 0.45 + 0.55 * Math.min(1, ptr.speed / 900);
    const s = dt / 1000;
    ptr.pushV += ((target - ptr.push) * 140 - ptr.pushV * 12) * s;
    ptr.push += ptr.pushV * s;
    ptr.speed *= Math.pow(0.9, dt / 16.7);
  }

  /** True when the canvas size differs from the current layout (the observer also fires once on start). */
  const resized = () => {
    const r = canvas.getBoundingClientRect();
    return Math.round(r.width) !== W || Math.round(r.height) !== H;
  };

  // ---------- run ----------
  if (reduced) {
    // One static frame once the layers are built (again after a resize).
    decoding = false;
    onReady = () => frame(performance.now(), 0);
    relayout();
    const ro = new ResizeObserver(() => {
      if (resized()) relayout();
    });
    ro.observe(canvas);
    return () => {
      disposed = true;
      cancelJob();
      ro.disconnect();
    };
  }
  relayout();

  let last = performance.now();
  let acc = 0;
  const loop = (now: number) => {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    const minFrame = small ? 1000 / 30 - 2 : 0;
    acc += now - last;
    last = now;
    if (acc < minFrame) return;
    const step = Math.min(100, acc);
    acc = 0;
    updatePointer(step);
    shimmer(now);
    frame(now, step);
  };
  const play = () => {
    if (raf || disposed || !onScreen || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  };
  const pause = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };

  const setTarget = (clientX: number, clientY: number, snap: boolean) => {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const now = performance.now();
    if (ptr.lastT) {
      const dtp = Math.max(1, now - ptr.lastT);
      ptr.speed = Math.max(ptr.speed, (Math.hypot(x - ptr.lastX, y - ptr.lastY) / dtp) * 1000);
    }
    ptr.lastX = x;
    ptr.lastY = y;
    ptr.lastT = now;
    ptr.tx = x;
    ptr.ty = y;
    if (snap || ptr.inten < 0.02) {
      ptr.x = x;
      ptr.y = y;
    }
    return y >= 0 && y <= rect.height && x >= 0 && x <= rect.width;
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") {
      setTarget(e.clientX, e.clientY, false);
      ptr.target = 1;
      return;
    }
    ptr.target = setTarget(e.clientX, e.clientY, false) ? 1 : 0;
  };
  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    ptr.target = setTarget(e.clientX, e.clientY, ptr.inten < 0.05) ? 1 : 0;
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerType === "touch") ptr.target = 0;
  };
  const onLeave = () => {
    ptr.target = 0;
  };
  const onVisibility = () => (document.hidden ? pause() : play());
  const io = new IntersectionObserver((entries) => {
    onScreen = entries.some((e) => e.isIntersecting);
    if (onScreen) play();
    else pause();
  });
  const ro = new ResizeObserver(() => {
    if (resized()) relayout();
  });
  io.observe(canvas);
  ro.observe(canvas);
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerdown", onDown, { passive: true });
  window.addEventListener("pointerup", onUp, { passive: true });
  window.addEventListener("pointercancel", onUp, { passive: true });
  document.documentElement.addEventListener("pointerleave", onLeave);
  document.addEventListener("visibilitychange", onVisibility);
  play();
  return () => {
    disposed = true;
    pause();
    cancelJob();
    io.disconnect();
    ro.disconnect();
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    document.documentElement.removeEventListener("pointerleave", onLeave);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

