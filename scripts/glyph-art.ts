// Usage: npm run glyph-art [-- --preview out.png]
// Builds the landing hero's glyph-art data from a public-domain painting: Marinus van Reymerswaele,
// "The Tax Collectors" (1540s), Wikimedia Commons (PD-Art; see docs/CREDITS.md). The painting is
// downloaded to a temp folder (never committed) and reduced to a small luminance grid; only that grid
// (src/content/glyph-art.json) is committed and shipped; the browser never loads the painting.
//
// Pipeline: the whole painting in full tone (not a silhouette), so the composition reads as glyphs:
//  1. The full painting, resized to the grid (cells ~0.62 wide per unit of height, like a mono glyph);
//     luminance normalised to the 1st-99.5th percentile.
//  2. Clarity: local contrast boosted so eyes, mouths, fingers, hat edges and coin rims separate.
//  3. Dodge and burn: a very soft weighting map (wide blobs over the faces, hats, hands, ledger and coins)
//     keeps the figures at full tone and holds the wood background to about 45%. No hard mask, so no holes.
//  4. Edge emphasis: Sobel edge strength added back (more on the subjects).
//  5. Contrast curve (gentle S), highlights normalised to full gold; 15 brightness levels, with only
//     near-black cells left blank (level 0).
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

/** The whole painting is used (the source is 1000x1232). */
const CROP = { left: 0, top: 0, width: 1000, height: 1232 };
/** Grid width; rows follow the crop's aspect for cells ~0.62 wide per unit of height (a mono glyph). */
const COLS = 260;
const CELL_ASPECT = 0.62;
const ROWS = Math.round(COLS * (CROP.height / CROP.width) * CELL_ASPECT);
const LEVELS = 16;
/** Working resolution: SS samples per cell in each direction, averaged down at the end. */
const SS = 3;

/** Subjects in painting coordinates (0-1): centre, radii and weight, for the soft dodge-and-burn map. */
const BLOBS: { x: number; y: number; rx: number; ry: number; w: number }[] = [
  { x: 0.3, y: 0.485, rx: 0.15, ry: 0.14, w: 1 }, // left collector's face
  { x: 0.28, y: 0.36, rx: 0.26, ry: 0.13, w: 0.85 }, // his feathered hat
  { x: 0.754, y: 0.48, rx: 0.11, ry: 0.13, w: 1 }, // right collector's face
  { x: 0.78, y: 0.46, rx: 0.22, ry: 0.16, w: 0.85 }, // his leaf headdress
  { x: 0.86, y: 0.66, rx: 0.14, ry: 0.12, w: 0.7 }, // his red sleeve
  { x: 0.322, y: 0.78, rx: 0.12, ry: 0.065, w: 1 }, // writing hand
  { x: 0.446, y: 0.773, rx: 0.065, ry: 0.045, w: 1 }, // his other hand
  { x: 0.692, y: 0.725, rx: 0.1, ry: 0.13, w: 1 }, // right collector's hands
  { x: 0.384, y: 0.876, rx: 0.31, ry: 0.1, w: 1 }, // the ledger
  { x: 0.842, y: 0.882, rx: 0.14, ry: 0.09, w: 1 }, // the coins
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

  // 1. The whole painting at the working resolution (SS samples per cell each way), luminance, normalised.
  const W = COLS * SS;
  const H = ROWS * SS;
  const raw = await sharp(img).extract(CROP).resize(W, H, { fit: "fill", kernel: "lanczos3" }).grayscale().raw().toBuffer();
  const L0 = plane(W, H);
  for (let i = 0; i < raw.length; i++) L0.d[i] = raw[i] / 255;
  const L = stretch(L0, 0.01, 0.995);

  // 2. Clarity (local contrast).
  const local = blur(L, Math.max(2, Math.round(W / 90)));
  // 3. Dodge and burn: soft weighting, noise-broken so it never reads as shapes; widely blurred.
  const noise = valueNoise(W, H, Math.round(W / 14), 1540);
  const weight0 = plane(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const v = y / (H - 1);
      const i = y * W + x;
      const wobble = 0.3 * (noise.d[i] - 0.5);
      let m = 0;
      for (const b of BLOBS) {
        const dx = (u - b.x) / b.rx;
        const dy = (v - b.y) / b.ry;
        m = Math.max(m, b.w * (1 - smooth(0.7, 1.8, Math.sqrt(dx * dx + dy * dy) + wobble)));
      }
      weight0.d[i] = m;
    }
  }
  const weight = blur(weight0, Math.round(W / 40), 3);

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

  // 5. Tone: clarity, edges and weighting, then a gentle S-curve.
  const val = plane(W, H);
  for (let i = 0; i < val.d.length; i++) {
    const clarity = L.d[i] + 0.6 * (L.d[i] - local.d[i]);
    const w = weight.d[i];
    let v = Math.min(1, Math.max(0, clarity + (0.15 + 0.25 * w) * En.d[i] * smooth(0.05, 0.4, L.d[i])));
    v *= 0.45 + 0.55 * w;
    v = v < 0.5 ? 2 * v * v * 0.9 + 0.1 * v : 1 - 2 * (1 - v) * (1 - v) * 0.9 - 0.1 * (1 - v);
    val.d[i] = Math.pow(Math.max(0, v), 0.85);
  }
  const grid = new Float32Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      let s = 0;
      for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) s += val.d[(r * SS + dy) * W + c * SS + dx];
      grid[r * COLS + c] = s / (SS * SS);
    }
  }
  // Highlights to full gold: the 99.6th percentile maps to 1. Only near-black cells are left blank.
  const top = percentile(grid, 0.996) || 1;
  const packed = Buffer.alloc(Math.ceil((COLS * ROWS) / 2));
  let filled = 0;
  for (let i = 0; i < grid.length; i++) {
    const v = Math.min(1, grid[i] / top);
    const q = v < 0.06 ? 0 : Math.max(1, Math.min(LEVELS - 1, Math.round(v * (LEVELS - 1))));
    if (q) filled++;
    packed[i >> 1] |= i % 2 === 0 ? q << 4 : q;
  }

  const out = {
    source: SOURCE,
    crop: CROP,
    cols: COLS,
    rows: ROWS,
    levels: LEVELS,
    note: "The whole painting in full tone. Level 0 = near-black (blank); 1-15 = brightness. Clarity, soft dodge-and-burn on the subjects, Sobel edges, S-curve.",
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
