"""all 25 sprites (rows=stage, cols=expression) + 5 backgrounds on white. usage: all_sheet.py out.jpg"""
import sys
from PIL import Image, ImageDraw
EX = ["normal", "happy", "shy", "sad", "pout"]; BGS = ["room_morning", "room_evening", "room_night", "library", "cafe"]
tw, th = 300, 600
o = Image.new("RGB", (tw * 5, (th + 30) * 5 + 680 + 30), (255, 255, 255)); d = ImageDraw.Draw(o)
for r in range(5):
    for c, e in enumerate(EX):
        im = Image.open(f"out/final/stage{r}_{e}.png").resize((tw, th), Image.LANCZOS)
        o.paste(im, (c * tw, r * (th + 30) + 30), im); d.text((c * tw + 6, r * (th + 30) + 8), f"stage{r}_{e}", fill=(40, 40, 40))
y = 5 * (th + 30)
for c, b in enumerate(BGS):
    im = Image.open(f"out/final_bg/{b}.jpg"); im = im.resize((tw, round(tw * im.height / im.width)), Image.LANCZOS)
    o.paste(im, (c * tw, y + 30)); d.text((c * tw + 6, y + 8), b, fill=(40, 40, 40))
o.save(sys.argv[1], quality=88)
# face close-ups for checking expressions
f = Image.new("RGB", (5 * 260, 5 * 290), (255, 255, 255)); d = ImageDraw.Draw(f)
for r in range(5):
    for c, e in enumerate(EX):
        im = Image.open(f"out/final/stage{r}_{e}.png").crop((400, 150, 640, 400))
        bg = Image.new("RGB", im.size, (255, 255, 255)); bg.paste(im, (0, 0), im)
        f.paste(bg, (c * 260, r * 290 + 30)); d.text((c * 260 + 6, r * 290 + 8), f"stage{r}_{e}", fill=(40, 40, 40))
f.save(sys.argv[1].replace(".jpg", "_faces.jpg"), quality=88)
