"""face-only expression inpaint. usage: expr.py <stage> <in.png> <expr> <seeds> <strength>"""
import sys
from PIL import Image, ImageDraw
from sdlib import inpaint_crop, save
from prompts import prompt, neg
FACE = (563, 222, 717, 354)
BOX = (450, 90, 830, 470)
st, inp, ex = int(sys.argv[1]), sys.argv[2], sys.argv[3]
seeds = [int(s) for s in sys.argv[4].split(",")]
strength = float(sys.argv[5])
img = Image.open(inp).convert("RGB")
m = Image.new("L", img.size, 0); ImageDraw.Draw(m).ellipse(FACE, fill=255)
for s in seeds:
    r = inpaint_crop(img, m, BOX, prompt(st, ex), neg(st, ex), s, strength=strength, blur=8)
    save(r, f"out/expr/st{st}_{ex}_s{s}.png", dict(stage=st, expr=ex, input=inp, seed=s, strength=strength, face_mask=FACE, box=BOX,
                                                  prompt=prompt(st, ex), negative=neg(st, ex)))
    print(st, ex, s, flush=True)
