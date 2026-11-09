# Credits

## Artwork: the landing hero

- **Work:** *The Tax Collectors*, Marinus van Reymerswaele (attributed), 1540s.
- **Source file:** Wikimedia Commons,
  [File:Marinus_van_Reymerswale_-_The_Tax_Collectors_-_WGA19332.jpg](https://commons.wikimedia.org/wiki/File:Marinus_van_Reymerswale_-_The_Tax_Collectors_-_WGA19332.jpg)
  (1000 × 1232, from the Web Gallery of Art, WGA19332).
- **Licence:** public domain. The painter died in the 16th century; Wikimedia Commons marks the file
  PD-Art, a faithful photographic reproduction of a two-dimensional public-domain work, which is
  itself public domain.
- **Why this file:** it is attributed to Reymerswaele himself. The National Museum in Warsaw version on
  Commons is labelled "After Marinus van Reymerswaele" (a 1600–1649 copy), so we did not use it.
- **How it is used:**
  - `scripts/glyph-art.ts` downloads the file to a temp folder at build time (it is never committed).
  - It maps the whole painting, in full tone, to a 260 × 199 grid with 15 brightness levels (only
    near-black cells are blank). It boosts local contrast, gently darkens the wood background around the
    figures (a soft weighting, no mask), adds edge emphasis and applies an S-curve, so the faces, hats,
    hands, ledger and coins read clearly.
  - It commits only that grid (`src/content/glyph-art.json`, about 35 KB).
  - The browser draws the grid as gold text characters, with an intro decode, brief glitches and a
    cursor light (`src/components/GlyphArt.tsx`, `src/components/glyph-art-run.ts`); the social
    cards draw a static frame of it (`src/lib/site/og.tsx`).
  - The painting itself is never shipped.
- **Credited in:** the site footer ("Glyph art after Marinus van Reymerswaele, *The Tax Collectors*
  (1540s), public domain", linked to the Commons page) and the hero's screen-reader description.

## Fonts

All are under the SIL Open Font License 1.1. Every font is bundled with the site at build time; none is fetched from Google Fonts or any other host.

| Font | Where | Source | Licence file |
| --- | --- | --- | --- |
| Geist, Geist Mono (Vercel) | Site (the `geist` npm package, 1.9.2), PDF, social cards, glyph art | https://github.com/vercel/geist-font | `public/pdf-fonts/OFL-Geist.txt`; the package ships its own `LICENSE.txt` (OFL-1.1) |
| IBM Plex Mono | The ₦ sign in the PDF and the social cards (Geist has no U+20A6) | https://github.com/google/fonts/tree/main/ofl/ibmplexmono | `public/pdf-fonts/OFL-IBMPlexMono.txt` |

## Visual reference

The dark editorial theme follows the *style* of [orbio.so/protocol](https://orbio.so/protocol):
- a near-black page and a single warm gold accent;
- Geist with tight tracking, two-tone headlines and mono eyebrow labels;
- a floating pill nav and glyph-art imagery.

Notes on what we measured are in [design/reference/orbio/NOTES.md](../design/reference/orbio/NOTES.md).

No Orbio logo, copy, artwork or other asset is used. The colours and type are re-chosen and checked for
WCAG AA in `src/app/globals.css`.

## Data

Powered by NearBlocks.io APIs. Other data sources and libraries are listed in the
[README](../README.md#hackathon-disclosures).
