/**
 * Social card images (1200x630), rendered with next/og at build time. The fonts are the same OFL files
 * the PDF embeds (public/pdf-fonts); IBM Plex Mono supplies the naira sign. Cards never contain a
 * user's data: the site card is static and the result card uses the cached demo figures only.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

export const OG_SIZE = { width: 1200, height: 630 };

const C = { page: "#f4f2ee", surface: "#ffffff", ink: "#0e0e0c", ink2: "#5f5b54", border: "#e7e4de", lime: "#c5f06a" };

const font = (file: string) => readFile(path.join(process.cwd(), "public", "pdf-fonts", file));

export async function ogFonts() {
  const [serif, geist, geistBold, plex] = await Promise.all([font("InstrumentSerif-Regular.ttf"), font("Geist-Regular.ttf"), font("Geist-SemiBold.ttf"), font("IBMPlexMono-Regular.ttf")]);
  return [
    { name: "Instrument Serif", data: serif, weight: 400 as const, style: "normal" as const },
    { name: "Geist", data: geist, weight: 400 as const, style: "normal" as const },
    { name: "Geist", data: geistBold, weight: 600 as const, style: "normal" as const },
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

function Brand() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <Mark size={52} color={C.ink} />
      <span style={{ fontFamily: "Instrument Serif", fontSize: 56, color: C.ink, lineHeight: 1 }}>uwii</span>
    </div>
  );
}

function NearChip() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.lime, color: C.ink, borderRadius: 999, padding: "10px 22px", fontFamily: "Geist", fontWeight: 600, fontSize: 24 }}>
      Built on NEAR
    </div>
  );
}

export function SiteCard() {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: C.page, padding: "64px 72px", position: "relative" }}>
      <div style={{ position: "absolute", right: -60, bottom: -90, display: "flex", opacity: 0.07 }}>
        <Mark size={560} color={C.ink} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Brand />
        <NearChip />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ fontFamily: "Instrument Serif", fontSize: 96, lineHeight: 1, color: C.ink, letterSpacing: -2 }}>Crypto tax, without the guesswork.</div>
        <div style={{ fontFamily: "Geist", fontSize: 30, color: C.ink2, lineHeight: 1.35, maxWidth: 900 }}>
          Private crypto-tax agent for NEAR accounts, under Nigeria&apos;s NRS Circular 2026/21.
        </div>
      </div>
    </div>
  );
}

/** The demo report's card: figures from the cached demo (committed run, illustrative answers) only. */
export function DemoResultCard({ tax, chargeable, status }: { tax: string; chargeable: string; status: string }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: C.page, padding: "56px 72px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Brand />
        <NearChip />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 18, background: C.ink, borderRadius: 36, padding: "40px 48px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", right: -40, bottom: -120, display: "flex", opacity: 0.1 }}>
          <Mark size={380} color="#ffffff" />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "Geist", fontSize: 26, color: "#d6d3cc" }}>
          <span>Example report · tax attributable to crypto, 2026</span>
          <span style={{ color: C.lime }}>{status}</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", fontFamily: "Instrument Serif", fontSize: 128, lineHeight: 1, color: "#ffffff" }}>
          <span style={{ fontFamily: "Plex Mono", fontSize: 104, marginRight: 6 }}>₦</span>
          <span>{tax}</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, fontFamily: "Geist", fontSize: 24, color: "#d6d3cc" }}>
          <span>Chargeable crypto amount</span>
          <span style={{ fontFamily: "Plex Mono" }}>₦{chargeable}</span>
          <span>·</span>
          <span>cached demo, answers for illustration</span>
        </div>
      </div>
    </div>
  );
}
