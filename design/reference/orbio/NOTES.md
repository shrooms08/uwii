# Style reference: orbio.so/protocol (notes only)

Studied 2026-11-07 with Playwright at 1440x900 and 390x844 (full-page and first-screen captures, and
computed styles from the live page). The screenshots and `styles*.json` dumps stay in this folder locally
and are **not committed**. Uwii borrows the *style* only: no Orbio logo, copy, artwork, coin or other
asset.

## What the page is made of

- **Theme.** Near-black page `rgb(11,12,14)` (#0B0C0E); body text off-white `rgb(241,240,237)` (#F1F0ED);
  muted text `rgb(163,163,166)` (#A3A3A6); quieter grey `rgb(140,140,143)` (#8C8C8F, the second headline
  line); one warm gold accent `rgb(230,187,121)` (#E6BB79); text on gold `rgb(23,19,12)`. Hairlines are
  white at 8% (`rgba(255,255,255,0.08)`), outlined controls white at 14%. A green dot `rgb(127,209,139)`
  marks "LIVE".
- **Type.** Geist everywhere (variable; headlines at weight 450) and Geist Mono for labels, numbers and
  code. No serif in the UI (only the big wordmark over the footer painting).
  - h1: Geist 450, 64px / 65px, letter-spacing -3.2px (-0.05em); line 1 off-white, line 2 #8C8C8F.
  - h2: Geist 450, 52-62px, letter-spacing -0.045em, same two-tone treatment.
  - h3: Geist 500, 19px / 28.5px, -0.03em.
  - Body: Geist 400, 16-17px / 27px, #A3A3A6.
  - Eyebrow labels: Geist Mono 500, 11px, uppercase, letter-spacing 2.42px (0.22em), gold, preceded by a
    small gold star; numbered sections read "01 / CREDIT".
  - Nav links: Geist 400, 13px, #A3A3A6.
- **Nav.** A floating bar: `position: fixed; top: 16px`, 1240px wide, radius 14px, 1px white-8% border,
  background `rgba(11,12,14,0.72)`, padding 10px 10px 10px 18px. Right side: one outlined button (8%
  border, radius 9px, 13px text) and one light-filled button (#F1F0ED, dark text, radius 9px).
- **Hero.** Left column: gold mono eyebrow, two-tone headline ending in a small glowing gold mark, grey
  subline, primary button filled gold with a soft gold glow (radius ~10px, 48px tall), secondary button
  outlined (white 14% border, translucent dark fill, 8px backdrop blur). Right/background: a classical
  figure drawn entirely in gold text glyphs (`# % @ * = +`), brightness from the image, fading into the
  dark, plus sparse glyph clusters scattered across the background.
- **Stats row.** A bordered bar under the hero: green "LIVE" label in mono caps, then 4 figures in Geist
  Mono (~22px) each followed by a small grey caption.
- **Sections.** Max content width 1280px; section top padding 90-126px. Each starts with a numbered gold
  mono label, then a two-tone headline, a short grey paragraph, and often a row of four numbered items
  (`01 Earn`, `02 Swap`, ...) separated by thin vertical rules.
- **Radii and borders.** Controls 9-10px, cards 14px, pills fully round. Borders are hairlines, never
  heavy; no drop shadows except the gold button glow.
- **Motion.** Colour and background transitions `0.2s cubic-bezier(0.23, 1, 0.32, 1)`; buttons scale
  slightly on press (`transform 0.12s`). The glyph art shimmers slowly.
- **Footer.** A painting banner with a large serif wordmark, then a footer with three link columns, a
  copyright line and the painting credit in small mono caps.

## How Uwii adapts it

- Same families (Geist and Geist Mono, both OFL, already self-hosted with next/font). Headlines move from
  Instrument Serif to Geist at weight 450 with -0.045em tracking; money keeps tabular figures.
- Dark tokens with a single gold accent, checked for WCAG AA (see `src/app/globals.css`).
- Signature visual: Marinus van Reymerswaele's *The Tax Collectors* (public domain) rendered as gold
  ledger glyphs on a canvas, with Uwii's own copy, numbered sections and the % mark.
