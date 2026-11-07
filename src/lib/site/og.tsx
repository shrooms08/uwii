/**
 * Social card images (1200x630), rendered with next/og at build time: the dark gold theme, with a
 * static frame of the hero's glyph art (Marinus van Reymerswaele, The Tax Collectors, 1540s, public
 * domain; src/content/glyph-art.json). The fonts are the OFL files the PDF embeds (public/pdf-fonts);
 * IBM Plex Mono supplies the naira sign. Cards never contain a user's data: the site card is static
 * and the result card uses the cached demo figures only.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import glyphArt from "@/content/glyph-art.json";

export const OG_SIZE = { width: 1200, height: 630 };

const C = {
  page: "#0b0c0e",
  surface: "#121316",
  ink: "#f1f0ed",
  ink2: "#a3a3a6",
  ink3: "#8c8c8f",
  line: "#24252a",
  gold: "#e6bb79",
  goldLine: "#4a3c26",
  cream: "#f6e6c4",
};

const font = (file: string) => readFile(path.join(process.cwd(), "public", "pdf-fonts", file));

export async function ogFonts() {
  const [geist, geistBold, mono, plex] = await Promise.all([font("Geist-Regular.ttf"), font("Geist-SemiBold.ttf"), font("GeistMono-Medium.ttf"), font("IBMPlexMono-Regular.ttf")]);
  return [
    { name: "Geist", data: geist, weight: 400 as const, style: "normal" as const },
    { name: "Geist", data: geistBold, weight: 600 as const, style: "normal" as const },
    { name: "Geist Mono", data: mono, weight: 500 as const, style: "normal" as const },
    { name: "Plex Mono", data: plex, weight: 400 as const, style: "normal" as const },
  ];
}

/** The uwii "%" mark (same geometry as src/components/ui/Mark.tsx). */
function Mark({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <g fill="none" stroke={color}>
        <ellipse cx="26" cy="27" rx="14.5" ry="20.5" strokeWidth="10.5" />
        <ellipse cx="74" cy="73" rx="14.5" ry="20.5" strokeWidth="10.5" />
        <line x1="81" y1="3" x2="19" y2="97" strokeWidth="13" />
      </g>
    </svg>
  );
}

// ---------- static glyph frame ----------
const RAMP = " .:-=+*#%@";
/** Opacity bands: each band is one layer of whole-row strings (spaces elsewhere), so the frame is a few
 * hundred text rows rather than one element per glyph. */
const BANDS = [0.22, 0.4, 0.62, 0.9];

function glyphLayers(step: number) {
  const g = glyphArt as { cols: number; rows: number; levels: number; data: string };
  const bytes = Buffer.from(g.data, "base64");
  const lum = (i: number) => (i % 2 === 0 ? bytes[i >> 1] >> 4 : bytes[i >> 1] & 15) / (g.levels - 1);
  const cols = Math.floor(g.cols / step);
  const rows = Math.floor(g.rows / step);
  const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  const layers = BANDS.map(() => Array.from({ length: rows }, () => Array<string>(cols).fill(" ")));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let v = 0;
      for (let dy = 0; dy < step; dy++) for (let dx = 0; dx < step; dx++) v += lum((r * step + dy) * g.cols + c * step + dx);
      v /= step * step;
      if (v < 0.06) continue;
      const ex = c / (cols - 1);
      const ey = r / (rows - 1);
      const edge = smooth(0, 0.3, ex) * smooth(0, 0.06, 1 - ex) * smooth(0, 0.08, ey) * smooth(0, 0.14, 1 - ey);
      const a = (0.24 + 0.76 * Math.pow(v, 0.95)) * edge;
      if (a < 0.12) continue;
      const band = BANDS.reduce((best, b, i) => (Math.abs(b - a) < Math.abs(BANDS[best] - a) ? i : best), 0);
      layers[band][r][c] = RAMP[Math.min(RAMP.length - 1, Math.max(1, Math.round(Math.pow(v, 0.8) * (RAMP.length - 1))))];
    }
  }
  return { cols, rows, layers: layers.map((rowsOf) => rowsOf.map((cells) => cells.join(""))) };
}

/** A static frame of the hero's glyph art, `width` px wide, absolutely positioned by the caller. */
function GlyphFrame({ width, opacity = 1 }: { width: number; opacity?: number }) {
  const { cols, rows, layers } = glyphLayers(2);
  const cellW = width / cols;
  const fontSize = cellW / 0.6; // Geist Mono advance is 0.6em
  const lineHeight = cellW / 0.62;
  return (
    <div style={{ display: "flex", position: "relative", width, height: rows * lineHeight, opacity }}>
      {layers.map((rowsOf, b) => (
        <div key={b} style={{ position: "absolute", left: 0, top: 0, display: "flex", flexDirection: "column", opacity: BANDS[b] }}>
          {rowsOf.map((row, r) => (
            <div
              key={r}
              style={{ display: "flex", height: lineHeight, fontFamily: "Geist Mono", fontWeight: 500, fontSize, lineHeight: `${lineHeight}px`, whiteSpace: "pre", color: b === BANDS.length - 1 ? C.cream : C.gold }}
            >
              {row}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Brand() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <Mark size={40} color={C.gold} />
      <span style={{ fontFamily: "Geist", fontWeight: 600, fontSize: 40, color: C.ink, lineHeight: 1, letterSpacing: -1.8 }}>uwii</span>
    </div>
  );
}

function Eyebrow({ children }: { children: string }) {
  return <div style={{ display: "flex", fontFamily: "Geist Mono", fontWeight: 500, fontSize: 18, letterSpacing: 4, color: C.gold }}>{children}</div>;
}

function NearChip() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, border: `1.5px solid ${C.goldLine}`, background: "#221d14", color: C.gold, borderRadius: 12, padding: "9px 18px", fontFamily: "Geist", fontWeight: 600, fontSize: 22 }}>
      <div style={{ display: "flex", width: 9, height: 9, borderRadius: 9, background: C.gold }} />
      Built on NEAR
    </div>
  );
}

export function SiteCard() {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: C.page, padding: "56px 64px", position: "relative" }}>
      <div style={{ position: "absolute", right: -40, top: 40, display: "flex" }}>
        <GlyphFrame width={600} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Brand />
        <NearChip />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <Eyebrow>PRIVATE AI · NRS CIRCULAR 2026/21</Eyebrow>
        <div style={{ display: "flex", flexDirection: "column", fontFamily: "Geist", fontSize: 66, lineHeight: 1.05, letterSpacing: -2.4 }}>
          <span style={{ color: C.ink }}>Crypto tax,</span>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ color: C.ink3 }}>without the guesswork.</span>
            <Mark size={40} color={C.gold} />
          </div>
        </div>
        <div style={{ display: "flex", fontFamily: "Geist", fontSize: 24, color: C.ink2, lineHeight: 1.4, maxWidth: 540 }}>
          Private crypto-tax agent for NEAR accounts, under Nigeria&apos;s NRS Circular 2026/21.
        </div>
      </div>
    </div>
  );
}

/** The demo report's card: figures from the cached demo (committed run, illustrative answers) only. */
export function DemoResultCard({ tax, chargeable, status }: { tax: string; chargeable: string; status: string }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: C.page, padding: "52px 64px", position: "relative" }}>
      <div style={{ position: "absolute", right: -10, top: -20, display: "flex" }}>
        <GlyphFrame width={560} opacity={0.55} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Brand />
        <NearChip />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 18,
          background: C.surface,
          backgroundImage: "radial-gradient(circle at 100% 100%, rgba(230,187,121,0.16), rgba(230,187,121,0) 60%)",
          border: `1.5px solid ${C.goldLine}`,
          borderRadius: 22,
          padding: "38px 46px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div style={{ position: "absolute", right: -30, bottom: -110, display: "flex", opacity: 0.1 }}>
          <Mark size={360} color={C.gold} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "Geist", fontSize: 25, color: C.ink2 }}>
          <span>Example report · tax attributable to crypto, 2026</span>
          <span style={{ color: C.gold }}>{status}</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", fontFamily: "Geist", fontSize: 116, lineHeight: 1, letterSpacing: -3.5, color: C.gold }}>
          <span style={{ fontFamily: "Plex Mono", fontSize: 96, marginRight: 10, letterSpacing: 0 }}>₦</span>
          <span>{tax}</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, fontFamily: "Geist", fontSize: 23, color: C.ink2 }}>
          <span>Chargeable crypto amount</span>
          <span style={{ fontFamily: "Plex Mono", color: C.ink }}>₦{chargeable}</span>
          <span>·</span>
          <span>cached demo, answers for illustration</span>
        </div>
      </div>
    </div>
  );
}
