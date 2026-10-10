"""base s3014: hires x1.5 (img2img 0.35) + face detail (crop inpaint 0.35)."""
import sys
from PIL import Image, ImageDraw
from sdlib import hires, inpaint_crop, save
from prompts import prompt, neg
SEED = 3014
P, N = prompt(0), neg(0)
src = Image.open(f"out/base_v3/s{SEED}.png").convert("RGB")
hs = float(sys.argv[1]) if len(sys.argv) > 1 else 0.35
h = hires(src, P, N, SEED, scale=1.5, strength=hs)
save(h, "out/s0_hires.png", dict(seed=SEED, prompt=P, negative=N, hires_scale=1.5, hires_strength=hs, size=h.size))
fm = Image.new("L", h.size, 0)
ImageDraw.Draw(fm).ellipse((560, 230, 720, 395), fill=255)
fs = float(sys.argv[2]) if len(sys.argv) > 2 else 0.35
f = inpaint_crop(h, fm, (470, 60, 790, 460), P, N, SEED, strength=fs)
save(f, "out/s0_base.png", dict(seed=SEED, prompt=P, negative=N, face_box=(470, 60, 790, 460), face_mask=(560, 230, 720, 395), face_strength=fs))
# grid overlay for mask coordinates
g = f.copy(); d = ImageDraw.Draw(g)
for x in range(0, g.width, 50):
    d.line((x, 0, x, g.height), fill=(255, 0, 0) if x % 200 == 0 else (255, 180, 180), width=1)
for y in range(0, g.height, 50):
    d.line((0, y, g.width, y), fill=(0, 0, 255) if y % 200 == 0 else (180, 180, 255), width=1)
for x in range(0, g.width, 200):
    for y in range(0, g.height, 200):
        d.text((x + 2, y + 2), f"{x},{y}", fill=(0, 0, 0))
g.save("out/s0_grid.png")
f.crop((420, 0, 840, 500)).save("out/s0_face.png")
print("done")
