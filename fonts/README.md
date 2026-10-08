# Fonts for the Word → PDF renderer

TrueType faces embedded (as subsets) into PDFs produced by `src/lib/pdf/docx.ts`.
They are lazy-loaded per face: the browser fetches them from `/fonts/`
(`build.ts` copies this directory to `dist/fonts`), Bun reads them from disk.

| Family | Stands in for | Files | License |
|--------|---------------|-------|---------|
| Liberation Sans | Arial, Helvetica, generic sans | `LiberationSans-*.ttf` | OFL-1.1 (`LICENSE-Liberation.txt`) |
| Liberation Serif | Times New Roman, generic serif | `LiberationSerif-*.ttf` | OFL-1.1 |
| Liberation Mono | Courier New, Consolas, generic mono | `LiberationMono-*.ttf` | OFL-1.1 |
| Carlito | Calibri | `Carlito-*.ttf` | OFL-1.1 (`LICENSE-Carlito.txt`) |
| Caladea | Cambria | `Caladea-*.ttf` | OFL-1.1 (`LICENSE-Caladea.txt`) |
| DejaVu Sans | per-character fallback for glyphs the others lack | `DejaVuSans-{Regular,Bold}.ttf` | Bitstream Vera / public domain (`LICENSE-DejaVu.txt`) |

Liberation, Carlito and Caladea are metric-compatible with the Microsoft fonts
they replace, so line breaks land close to Word's.

The files are **not** the upstream originals: `scripts/prepare-fonts.py`
(fontTools) strips hinting and OpenType layout features, and pads glyph data to
4 bytes. The padding matters — pdf-lib's subsetter may write a short `loca`
table and halve offsets, which corrupts glyphs stored at odd offsets. To
regenerate from system fonts:

```sh
pip install fonttools
for f in /usr/share/fonts/truetype/liberation/*.ttf; do python3 scripts/prepare-fonts.py "$f" "fonts/$(basename "$f")"; done
```
