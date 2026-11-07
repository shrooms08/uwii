# Fonts embedded in the PDF worksheet and the social cards

Loaded only when a PDF is built (fetched by the PDF builder) or a social card is rendered at build time;
not part of any page bundle. The site itself loads Geist and Geist Mono through next/font.

| File | Font | Source | Licence |
| --- | --- | --- | --- |
| Geist-Regular.ttf, Geist-SemiBold.ttf | Geist 1.8.2 | https://github.com/vercel/geist-font (release v1.8.2) | SIL Open Font License 1.1, OFL-Geist.txt |
| GeistMono-Regular.ttf, GeistMono-Medium.ttf | Geist Mono 1.8.2 | same | SIL Open Font License 1.1, OFL-Geist.txt |
| IBMPlexMono-Regular.ttf | IBM Plex Mono | https://github.com/google/fonts/tree/main/ofl/ibmplexmono | SIL Open Font License 1.1, OFL-IBMPlexMono.txt |

Geist and Geist Mono have no naira sign (U+20A6), so the PDF and the cards draw only that glyph with
IBM Plex Mono.
