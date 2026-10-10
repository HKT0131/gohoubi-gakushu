"""paste chosen stage1 expression faces onto every stage (face region is pixel-identical across stages).
usage: compose_expr.py happy=out/expr/st1_happy_s105.png shy=... sad=... pout=..."""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
FACE = (563, 222, 717, 354)
ref = np.array(Image.open("out/stage1.png").convert("RGB")).astype(int)
for arg in sys.argv[1:]:
    ex, path = arg.split("=")
    face = np.array(Image.open(path).convert("RGB")).astype(int)
    # keep hair strands of the original where the new face painted skin/brow over hair
    hair = (ref.sum(-1) < 330) & (face.sum(-1) - ref.sum(-1) > 120)
    zone = np.zeros(hair.shape, bool); zone[236:258, 620:652] = True   # bang edge over the brow only
    hair &= zone
    if ex in ("happy", "shy"):   # brows unchanged in these: restore the bang edge region as-is (removes a skin-colored smudge)
        z = np.zeros(hair.shape, np.uint8); z[230:258, 624:660] = 255
        zm = np.array(Image.fromarray(z).filter(ImageFilter.GaussianBlur(3))).astype(float)[..., None] / 255
        face = (face * (1 - zm) + ref * zm).astype(int)
    face[hair] = ref[hair]
    m = Image.new("L", (ref.shape[1], ref.shape[0]), 0); ImageDraw.Draw(m).ellipse(FACE, fill=255)
    m = np.array(m.filter(ImageFilter.GaussianBlur(8))).astype(float)[..., None] / 255
    for st in range(5):
        base = np.array(Image.open(f"out/stage{st}.png").convert("RGB")).astype(float)
        out = base * (1 - m) + face * m
        Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(f"out/stage{st}_{ex}.png")
        print(st, ex, flush=True)
