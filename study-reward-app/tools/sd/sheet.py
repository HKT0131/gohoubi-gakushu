"""contact sheet of final PNGs on a flat background. usage: sheet.py out.jpg bg_hex name [name...]"""
import sys
from PIL import Image, ImageDraw
out, bg, names = sys.argv[1], sys.argv[2], sys.argv[3:]
col = tuple(int(bg[i:i+2], 16) for i in (0, 2, 4))
tw, th = 400, 800
sheet = Image.new("RGB", (tw * len(names), th + 36), col)
d = ImageDraw.Draw(sheet)
for i, n in enumerate(names):
    im = Image.open(f"out/final/{n}.png").resize((tw, th), Image.LANCZOS)
    sheet.paste(im, (i * tw, 36), im)
    d.text((i * tw + 10, 10), n, fill=(60, 60, 60))
sheet.save(out, quality=90)
