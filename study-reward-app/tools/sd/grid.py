"""grid overlay for coordinates. usage: grid.py in out [x0,y0,x1,y1]"""
import sys
from PIL import Image, ImageDraw
im = Image.open(sys.argv[1]).convert("RGB")
if len(sys.argv) > 3:
    b = [int(v) for v in sys.argv[3].split(",")]
else:
    b = [0, 0, im.width, im.height]
c = im.crop(b); d = ImageDraw.Draw(c)
for x in range((b[0] // 50 + 1) * 50, b[2], 50):
    d.line((x - b[0], 0, x - b[0], c.height), fill=(255, 0, 0) if x % 100 == 0 else (255, 190, 190))
    if x % 100 == 0: d.text((x - b[0] + 2, 2), str(x), fill=(200, 0, 0))
for y in range((b[1] // 50 + 1) * 50, b[3], 50):
    d.line((0, y - b[1], c.width, y - b[1]), fill=(0, 0, 255) if y % 100 == 0 else (190, 190, 255))
    if y % 100 == 0: d.text((2, y - b[1] + 2), str(y), fill=(0, 0, 200))
c.save(sys.argv[2])
