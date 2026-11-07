// Usage: npm run glyph-art [-- --preview out.png]
// Builds the landing hero's glyph-art data from a public-domain painting: Marinus van Reymerswaele,
// "The Tax Collectors" (1540s), Wikimedia Commons (PD-Art; see docs/CREDITS.md). The painting is
// downloaded to a temp folder (never committed) and reduced to a small luminance grid; only that grid
// (src/content/glyph-art.json) is committed and shipped; the browser never loads the painting.
//
// Pipeline (so the figures read as a bright silhouette on empty black, not a dim rectangle):
//  1. Crop tight to the subjects: both faces, the hands, the ledger and the coins.
//  2. Luminance, normalised to the 2nd-99th percentile.
//  3. Subject mask: a score of luminance plus local contrast (local standard deviation), soft-thresholded,
//     inside a region of interest made of soft blobs over the subjects whose edges are broken up by
//     low-frequency noise (organic, never a rectangle); the mask is then feathered. Background cells are 0.
//  4. Edge emphasis: Sobel edge strength added back, so faces, fingers and coin rims read from a distance.
//  5. Clarity (local contrast), levels and gamma: mids lifted, highlights pushed to full gold; quantised to
//     15 levels (0 = empty); faint edge cells dropped.
// Uses sharp, which is already installed as part of Next.js (no new dependency).
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

export const SOURCE = {
  title: "The Tax Collectors",
  artist: "Marinus van Reymerswaele",
  date: "1540s",
  file: "https://upload.wikimedia.org/wikipedia/commons/2/29/Marinus_van_Reymerswale_-_The_Tax_Collectors_-_WGA19332.jpg",
  page: "https://commons.wikimedia.org/wiki/File:Marinus_van_Reymerswale_-_The_Tax_Collectors_-_WGA19332.jpg",
  license: "Public domain (PD-Art: a faithful reproduction of a two-dimensional public-domain work)",
};

/** Source pixels kept (the source is 1000x1232): both faces, the hands, the ledger and the coins. */
const CROP = { left: 120, top: 450, width: 880, height: 740 };
/** Grid width; rows follow the crop's aspect for cells ~0.62 wide per unit of height (a mono glyph). */
const COLS = 200;
const CELL_ASPECT = 0.62;
const ROWS = Math.round(COLS * (CROP.height / CROP.width) * CELL_ASPECT);
const LEVELS = 16;
/** Working resolution: SS samples per cell in each direction, averaged down at the end. */
const SS = 3;

/** Regions of interest in crop coordinates (0-1): centre, radii and weight. */
const BLOBS: { x: number; y: number; rx: number; ry: number; w: number }[] = [
  { x: 0.2, y: 0.2, rx: 0.17, ry: 0.23, w: 1 }, // left collector's face
  { x: 0.2, y: 0.03, rx: 0.25, ry: 0.1, w: 0.5 }, // his headdress, lower edge
  { x: 0.72, y: 0.19, rx: 0.12, ry: 0.22, w: 1 }, // right collector's face
  { x: 0.68, y: 0.14, rx: 0.2, ry: 0.27, w: 0.45 }, // his leaf headdress
  { x: 0.23, y: 0.69, rx: 0.13, ry: 0.1, w: 1 }, // writing hand
  { x: 0.37, y: 0.68, rx: 0.07, ry: 0.07, w: 1 }, // his other hand
  { x: 0.65, y: 0.6, rx: 0.11, ry: 0.21, w: 1 }, // right collector's hands
  { x: 0.3, y: 0.85, rx: 0.34, ry: 0.16, w: 1 }, // the ledger
  { x: 0.82, y: 0.86, rx: 0.15, ry: 0.14, w: 1 }, // the coins
];

async function source(): Promise<Buffer> {
  const dir = path.join(os.tmpdir(), "uwii-glyph-art");
  const file = path.join(dir, "tax-collectors.jpg");
  try {
    if ((await stat(file)).size > 0) return readFile(file);
  } catch {
    // not downloaded yet
  }
  await mkdir(dir, { recursive: true });
  const res = await fetch(SOURCE.file, { headers: { "user-agent": "uwii-build/1.0 (glyph-art preprocessing)" } });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(file, buf);
  return buf;
}

// ---------- small image helpers on Float32 planes ----------
type Plane = { w: number; h: number; d: Float32Array };
const plane = (w: number, h: number): Plane => ({ w, h, d: new Float32Array(w * h) });
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Separable box blur of radius r, repeated n times (approximately Gaussian). */
function blur(p: Plane, r: number, n = 3): Plane {
  let src = p.d;
  const { w, h } = p;
  for (let k = 0; k < n; k++) {
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        let c = 0;
        for (let i = -r; i <= r; i++) {
          const xx = x + i;
          if (xx >= 0 && xx < w) {
            s += src[y * w + xx];
            c++;
          }
        }
        tmp[y * w + x] = s / c;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        let c = 0;
        for (let i = -r; i <= r; i++) {
          const yy = y + i;
          if (yy >= 0 && yy < h) {
            s += tmp[yy * w + x];
            c++;
          }
        }
        out[y * w + x] = s / c;
      }
    }
    src = out;
  }
  return { w, h, d: src };
}

function percentile(d: Float32Array, q: number): number {
  const s = Float32Array.from(d).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
}

/** Normalises to [0,1] between the lo and hi percentiles. */
function stretch(p: Plane, lo: number, hi: number): Plane {
  const a = percentile(p.d, lo);
  const b = percentile(p.d, hi);
  const out = plane(p.w, p.h);
  for (let i = 0; i < p.d.length; i++) out.d[i] = Math.min(1, Math.max(0, (p.d[i] - a) / (b - a || 1)));
  return out;
}

/** Deterministic low-frequency value noise in [0,1]. */
function valueNoise(w: number, h: number, cell: number, seed: number): Plane {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const g = Array.from({ length: gw * gh }, rnd);
  const out = plane(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = x / cell;
      const fy = y / cell;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = smooth(0, 1, fx - x0);
      const ty = smooth(0, 1, fy - y0);
      const v00 = g[y0 * gw + x0];
      const v10 = g[y0 * gw + x0 + 1];
      const v01 = g[(y0 + 1) * gw + x0];
      const v11 = g[(y0 + 1) * gw + x0 + 1];
      out.d[y * w + x] = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
    }
  }
  return out;
}

async function main() {
  const previewArg = process.argv.indexOf("--preview");
  const preview = previewArg > 0 ? process.argv[previewArg + 1] : null;

  const img = await source();
  const meta = await sharp(img).metadata();
  if (meta.width !== 1000 || meta.height !== 1232) throw new Error(`Unexpected source size ${meta.width}x${meta.height}; review CROP`);

  // 1-2. Crop, resize to the working grid (cells are taller than wide), luminance, normalise.
  const W = COLS * SS;
  const H = ROWS * SS;
  const raw = await sharp(img).extract(CROP).resize(W, H, { fit: "fill", kernel: "lanczos3" }).grayscale().raw().toBuffer();
  const L0 = plane(W, H);
  for (let i = 0; i < raw.length; i++) L0.d[i] = raw[i] / 255;
  const L = stretch(L0, 0.02, 0.99);

  // 3. Subject mask: luminance + local contrast, inside the organic region of interest.
  const mean = blur(L, Math.round(W / 60));
  const dev = plane(W, H);
  for (let i = 0; i < dev.d.length; i++) dev.d[i] = (L.d[i] - mean.d[i]) ** 2;
  const std = stretch({ w: W, h: H, d: blur(dev, Math.round(W / 60)).d.map(Math.sqrt) }, 0.02, 0.98);
  const noise = valueNoise(W, H, Math.round(W / 14), 1540);
  const fine = valueNoise(W, H, Math.round(W / 40), 2026);
  const roi = plane(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const v = y / (H - 1);
      const i = y * W + x;
      // Noise breaks the blob edges up so the silhouette is organic.
      const wobble = 0.55 * (noise.d[i] - 0.5) + 0.25 * (fine.d[i] - 0.5);
      let m = 0;
      for (const b of BLOBS) {
        const dx = (u - b.x) / b.rx;
        const dy = (v - b.y) / b.ry;
        const r = Math.sqrt(dx * dx + dy * dy) + wobble;
        m = Math.max(m, b.w * (1 - smooth(0.55, 1.05, r)));
      }
      roi.d[i] = m;
    }
  }
  const mask0 = plane(W, H);
  for (let i = 0; i < mask0.d.length; i++) {
    const score = 0.7 * L.d[i] + 0.55 * std.d[i];
    mask0.d[i] = smooth(0.14, 0.48, score) * roi.d[i];
  }
  const mask = blur(mask0, Math.max(1, Math.round(SS * 0.8)), 2);

  // 4. Edge emphasis (Sobel on a lightly blurred luminance).
  const Ls = blur(L, 1, 1);
  const E = plane(W, H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const p = (dx: number, dy: number) => Ls.d[(y + dy) * W + (x + dx)];
      const gx = -p(-1, -1) - 2 * p(-1, 0) - p(-1, 1) + p(1, -1) + 2 * p(1, 0) + p(1, 1);
      const gy = -p(-1, -1) - 2 * p(0, -1) - p(1, -1) + p(-1, 1) + 2 * p(0, 1) + p(1, 1);
      E.d[y * W + x] = Math.hypot(gx, gy);
    }
  }
  const En = stretch(E, 0.05, 0.97);

  // 5. Levels and gamma on the masked image, then average down to the grid.
  const local = blur(L, Math.max(2, Math.round(W / 90)));
  const val = plane(W, H);
  for (let i = 0; i < val.d.length; i++) {
    // Clarity: local contrast boosted so features (eyes, mouths, fingers, coin rims) separate.
    const clarity = L.d[i] + 0.9 * (L.d[i] - local.d[i]);
    const v = Math.min(1, Math.max(0, 0.9 * clarity + 0.45 * En.d[i] * smooth(0.1, 0.5, L.d[i] + 0.3)));
    val.d[i] = Math.pow(v, 0.8) * mask.d[i];
  }
  const grid = new Float32Array(COLS * ROWS);
  const gmask = new Float32Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      let s = 0;
      let m = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = (r * SS + dy) * W + c * SS + dx;
          s += val.d[i];
          m += mask.d[i];
        }
      }
      grid[r * COLS + c] = s / (SS * SS);
      gmask[r * COLS + c] = m / (SS * SS);
    }
  }
  // Highlights to full gold: the 99.5th percentile of the subject maps to 1.
  const top = percentile(grid.filter((_, i) => gmask[i] > 0.2), 0.995) || 1;
  const packed = Buffer.alloc(Math.ceil((COLS * ROWS) / 2));
  let filled = 0;
  for (let i = 0; i < grid.length; i++) {
    const v = Math.min(1, grid[i] / top);
    const q = gmask[i] < 0.12 || v < 0.1 ? 0 : Math.max(1, Math.min(LEVELS - 1, Math.round(v * (LEVELS - 1))));
    if (q) filled++;
    packed[i >> 1] |= i % 2 === 0 ? q << 4 : q;
  }

  const out = {
    source: SOURCE,
    crop: CROP,
    cols: COLS,
    rows: ROWS,
    levels: LEVELS,
    note: "Level 0 = empty (background); 1-15 = brightness. Subject masked by luminance + local contrast inside soft organic regions; Sobel edges added.",
    data: packed.toString("base64"),
  };
  const file = path.join(process.cwd(), "src", "content", "glyph-art.json");
  await writeFile(file, `${JSON.stringify(out)}\n`);
  console.log(
    `Wrote ${path.relative(process.cwd(), file)}: ${COLS}x${ROWS} cells (${filled} filled, ${Math.round((filled / grid.length) * 100)}%), ${LEVELS} levels, ${packed.length} bytes packed (${out.data.length} base64)`,
  );

  if (preview) {
    const px = Buffer.alloc(COLS * ROWS);
    for (let i = 0; i < px.length; i++) {
      const q = i % 2 === 0 ? packed[i >> 1] >> 4 : packed[i >> 1] & 15;
      px[i] = q * 17;
    }
    await sharp(px, { raw: { width: COLS, height: ROWS, channels: 1 } })
      .resize(COLS * 4, Math.round((ROWS * 4) / CELL_ASPECT), { kernel: "nearest", fit: "fill" })
      .png()
      .toFile(preview);
    console.log(`Preview: ${preview}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
