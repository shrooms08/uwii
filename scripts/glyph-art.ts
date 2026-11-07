// Usage: npx tsx scripts/glyph-art.ts
// Builds the landing hero's glyph-art data from a public-domain painting: Marinus van Reymerswaele,
// "The Tax Collectors" (1540s), Wikimedia Commons (PD-Art; see docs/CREDITS.md). The painting is
// downloaded to a temp folder (never committed), cropped to the faces, hands, ledger and coins, reduced
// to a luminance grid, quantised to 16 levels and packed two cells per byte. Only that small grid
// (src/content/glyph-art.json) is committed and shipped; the browser never loads the painting.
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

/** Source pixels kept: the faces, the hands, the ledger and the coins (the source is 1000x1232). */
const CROP = { left: 150, top: 400, width: 850, height: 832 };
/** Grid size: cells are ~0.62 wide per unit of height, close to a monospace glyph. */
const COLS = 180;
const ROWS = 110;
const LEVELS = 16;

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

async function main() {
  const img = await source();
  const meta = await sharp(img).metadata();
  if (meta.width !== 1000 || meta.height !== 1232) throw new Error(`Unexpected source size ${meta.width}x${meta.height}; review CROP`);
  const lum = await sharp(img)
    .extract(CROP)
    .resize(COLS, ROWS, { fit: "fill", kernel: "lanczos3" })
    .grayscale()
    .normalise({ lower: 2, upper: 99 })
    .gamma(1.6) // lifts the mid-tones so faces and hands read as glyphs
    .raw()
    .toBuffer();
  if (lum.length !== COLS * ROWS) throw new Error(`Expected ${COLS * ROWS} luminance bytes, got ${lum.length}`);
  const packed = Buffer.alloc(Math.ceil((COLS * ROWS) / 2));
  for (let i = 0; i < lum.length; i++) {
    const q = Math.min(LEVELS - 1, Math.floor((lum[i] / 256) * LEVELS));
    packed[i >> 1] |= i % 2 === 0 ? q << 4 : q;
  }
  const out = { source: SOURCE, crop: CROP, cols: COLS, rows: ROWS, levels: LEVELS, data: packed.toString("base64") };
  const file = path.join(process.cwd(), "src", "content", "glyph-art.json");
  await writeFile(file, `${JSON.stringify(out)}\n`);
  console.log(`Wrote ${path.relative(process.cwd(), file)}: ${COLS}x${ROWS} cells, ${LEVELS} levels, ${packed.length} bytes packed (${out.data.length} base64)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
