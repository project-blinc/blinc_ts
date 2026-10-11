"""Regenerate the original geometric test faces with fonttools and brotli.
These fixtures and their outlines are licensed under the repository's Apache-2.0 license.
No third-party font data is included. Run: python generate.py
"""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

root = Path(__file__).parent
for style, advance, italic in [('Regular', 500, False), ('Bold', 700, False), ('Italic', 600, True)]:
    builder = FontBuilder(1000, isTTF=True)
    chars = list(range(32, 127))
    order = ['.notdef'] + [f'u{c:04X}' for c in chars]
    builder.setupGlyphOrder(order)
    builder.setupCharacterMap({c: f'u{c:04X}' for c in chars})
    glyphs, metrics = {}, {}
    for i, name in enumerate(order):
        pen = TTGlyphPen(None)
        width = 300 if name == 'u0020' else advance
        if name != 'u0020':
            slant = 140 if italic else 0
            top = 700 if i % 2 else 550
            pen.moveTo((70, 0))
            pen.lineTo((width - 70, 0))
            pen.lineTo((width - 70 + slant, top))
            pen.lineTo((70 + slant, top))
            pen.closePath()
            # The hole keeps these obviously geometric, while exercising contours and WOFF2 transforms.
            pen.moveTo((140, 100))
            pen.lineTo((140 + slant, top - 100))
            pen.lineTo((width - 140 + slant, top - 100))
            pen.lineTo((width - 140, 100))
            pen.closePath()
        glyphs[name] = pen.glyph()
        metrics[name] = (width, 70 if name != 'u0020' else 0)
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics(metrics)
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable({'familyName': 'Blinc Embedded Fixture', 'styleName': style,
        'uniqueFontIdentifier': f'BlincFixture-{style}', 'fullName': f'Blinc Embedded Fixture {style}',
        'psName': f'BlincFixture-{style}', 'version': 'Version 1.0'})
    builder.font['name'].setName('Blinc Embedded Fixture', 16, 3, 1, 0x409)
    builder.font['name'].setName(style, 17, 3, 1, 0x409)
    builder.font['name'].names = [n for n in builder.font['name'].names if n.platformID == 3]
    builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200,
        usWeightClass=700 if style == 'Bold' else 400, fsSelection=1 if italic else 32 if style == 'Bold' else 64)
    builder.setupPost(italicAngle=-12 if italic else 0)
    builder.setupMaxp()
    builder.font['head'].created = builder.font['head'].modified = 2082844800
    builder.font.recalcTimestamp = False
    builder.font['head'].macStyle = 2 if italic else 1 if style == 'Bold' else 0
    path = root / f'{style.lower()}.ttf'
    builder.save(path)
    if style == 'Regular':
        font = TTFont(path, recalcTimestamp=False)
        font.flavor = 'woff2'
        font.save(root / 'regular.woff2')
