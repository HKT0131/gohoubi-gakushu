"""soft-masked crop inpaint (feathered ellipse/rect) for seams.
usage: softfix.py <stage> in out x0,y0,x1,y1 strength seed [feather]"""
import sys
from PIL import Image, ImageDraw, ImageFilter
from sdlib import pipes, embeds, gen
from prompts import prompt, neg
st, inp, outp = int(sys.argv[1]), sys.argv[2], sys.argv[3]
x0, y0, x1, y1 = [int(v) for v in sys.argv[4].split(",")]
strength, seed = float(sys.argv[5]), int(sys.argv[6])
fe = int(sys.argv[7]) if len(sys.argv) > 7 else 30
img = Image.open(inp).convert("RGB")
m = Image.new("L", img.size, 0); ImageDraw.Draw(m).rectangle((x0 + fe, y0 + fe, x1 - fe, y1 - fe), fill=255)
m = m.filter(ImageFilter.GaussianBlur(fe / 2))
box = (x0, y0, x1, y1)
crop, mc = img.crop(box), m.crop(box)
cw, ch = crop.size; s = 1024 / max(cw, ch)
W, H = int(cw * s) // 8 * 8, int(ch * s) // 8 * 8
r = pipes()["inp"](**embeds(prompt(st), neg(st)), image=crop.resize((W, H), Image.LANCZOS), mask_image=Image.new("L", (W, H), 255),
                   width=W, height=H, strength=strength, num_inference_steps=30, guidance_scale=5.0, generator=gen(seed)).images[0]
r = r.resize((cw, ch), Image.LANCZOS)
out = img.copy(); out.paste(Image.composite(r, crop, mc), (x0, y0))
out.save(outp); print("done")
