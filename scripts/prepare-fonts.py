"""Prepare TrueType faces for pdf-lib embedding.

- Strip hinting (PDF viewers don't use it; halves the files).
- Strip GSUB/GPOS layout features so pdf-lib's shaping can't substitute
  ligatures the renderer didn't measure.
- Pad glyph data to 4 bytes: pdf-lib's subsetter may emit a short loca table
  and halves offsets, which corrupts glyphs stored at odd offsets.
"""
import sys
from fontTools.ttLib import TTFont
from fontTools.subset import Subsetter, Options

src, dst = sys.argv[1], sys.argv[2]
font = TTFont(src)
opts = Options()
opts.hinting = False
opts.layout_features = []
opts.name_IDs = ["*"]
opts.glyph_names = True
opts.notdef_outline = True
opts.drop_tables += ["FFTM", "DSIG"]
sub = Subsetter(options=opts)
sub.populate(unicodes=range(0x110000))
sub.subset(font)
font["glyf"].padding = 4
font.save(dst)
