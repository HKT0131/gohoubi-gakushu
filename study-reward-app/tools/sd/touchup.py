"""local crop-inpaint touchup. usage: touchup.py <stage> <in> <out> <x0,y0,x1,y1 mask> <strength> <seed> [expr]"""
import sys
from PIL import Image, ImageDraw
from sdlib import inpaint_crop, save
from prompts import prompt, neg
st, inp, outp = int(sys.argv[1]), sys.argv[2], sys.argv[3]
mx = [int(v) for v in sys.argv[4].split(",")]
strength, seed = float(sys.argv[5]), int(sys.argv[6])
expr = sys.argv[7] if len(sys.argv) > 7 else "normal"
img = Image.open(inp).convert("RGB")
m = Image.new("L", img.size, 0); ImageDraw.Draw(m).rounded_rectangle(mx, radius=12, fill=255)
pad = 96
box = (max(0, mx[0]-pad), max(0, mx[1]-pad), min(img.width, mx[2]+pad), min(img.height, mx[3]+pad))
r = inpaint_crop(img, m, box, prompt(st, expr), neg(st, expr), seed, strength=strength)
save(r, outp, dict(stage=st, input=inp, touchup_mask=mx, box=box, strength=strength, seed=seed, expr=expr))
print("done")
