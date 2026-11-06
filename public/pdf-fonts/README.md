# Fonts embedded in the PDF worksheet

Loaded only when a PDF is built (fetched by the PDF builder); not part of any page bundle.

| File | Font | Source | Licence |
| --- | --- | --- | --- |
| Geist-Regular.ttf, Geist-SemiBold.ttf | Geist 1.8.2 | https://github.com/vercel/geist-font (release v1.8.2) | SIL Open Font License 1.1, OFL-Geist.txt |
| GeistMono-Regular.ttf, GeistMono-Medium.ttf | Geist Mono 1.8.2 | same | SIL Open Font License 1.1, OFL-Geist.txt |
| InstrumentSerif-Regular.ttf | Instrument Serif | https://github.com/google/fonts/tree/main/ofl/instrumentserif | SIL Open Font License 1.1, OFL-InstrumentSerif.txt |
| IBMPlexMono-Regular.ttf | IBM Plex Mono | https://github.com/google/fonts/tree/main/ofl/ibmplexmono | SIL Open Font License 1.1, OFL-IBMPlexMono.txt |

Geist, Geist Mono and Instrument Serif have no naira sign (U+20A6), so the PDF draws only that glyph
with IBM Plex Mono.
