"""stage4: move arms/hands to the stage2 positions. hands pasted from stage2, arms + hip contour inpainted.
usage: arms4.py stage4.png stage2.png seeds"""
import sys
from PIL import Image, ImageDraw, ImageChops, ImageFilter
from sdlib import inpaint, save, contact
from prompts import prompt, neg
BG = (243, 241, 238); SKIN = (250, 224, 208)
s4 = Image.open(sys.argv[1]).convert("RGB"); s2 = Image.open(sys.argv[2]).convert("RGB")
W, H = s4.size
def P(polys, ells=()):
    m = Image.new("L", (W, H), 0); d = ImageDraw.Draw(m)
    for p in polys: d.polygon(p, fill=255)
    for e in ells: d.ellipse(e, fill=255)
    return m
region = P([[(400, 470), (505, 470), (500, 560), (488, 700), (480, 800), (480, 900), (500, 940), (500, 1075), (330, 1090), (330, 860)],
            [(745, 470), (850, 470), (950, 860), (950, 1090), (735, 1085), (735, 950), (765, 900), (762, 800), (752, 700), (770, 560)]])
body = P([[(505, 470), (500, 560), (488, 700), (475, 800), (468, 900), (458, 1000), (455, 1090), (640, 1090), (640, 470)],
          [(640, 470), (770, 560), (752, 700), (762, 800), (772, 900), (785, 1000), (790, 1090), (640, 1090)]])
hands = P([[(362, 905), (448, 905), (448, 1045), (362, 1045)], [(842, 900), (925, 900), (925, 1040), (842, 1040)]])
newarm = P([[(470, 470), (512, 470), (472, 700), (442, 905), (392, 905), (428, 690)],
            [(752, 470), (792, 470), (862, 690), (912, 900), (858, 905), (790, 700)]])
pre = s4.copy()
pre.paste(Image.new("RGB", (W, H), BG), (0, 0), ImageChops.subtract(ImageChops.subtract(region, newarm), body))
pre.paste(Image.new("RGB", (W, H), SKIN), (0, 0), ImageChops.subtract(ImageChops.multiply(region, body), newarm))
pre.paste(Image.new("RGB", (W, H), SKIN), (0, 0), ImageChops.multiply(region, newarm))
pre.paste(s2, (0, 0), hands)
dd = ImageDraw.Draw(pre)
for poly_ in ([(470, 470), (512, 470), (472, 700), (442, 905), (392, 905), (428, 690)],
              [(752, 470), (792, 470), (862, 690), (912, 900), (858, 905), (790, 700)]):
    dd.line(poly_ + [poly_[0]], fill=(150, 105, 95), width=3)
# shade inner side of arms a bit

m = ImageChops.subtract(region, hands)
pre.save("out/arms4_prefill.png")
ST = float(sys.argv[4]) if len(sys.argv) > 4 else 0.85
seeds = [int(s) for s in sys.argv[3].split(",")]
paths = []
for s in seeds:
    r = inpaint(pre, m, prompt(4), neg(4), s, strength=ST, steps=30, cfg=5.0, blur=4)
    r = inpaint(r, m, prompt(4), neg(4), s + 1000, strength=0.45, steps=30, cfg=5.0, blur=4)
    full = Image.composite(r, pre, m.filter(ImageFilter.GaussianBlur(4)))
    p = f"out/arms4/s{s}.png"
    save(full, p, dict(step="arms4", seed=s, strength=0.9))
    paths.append(p)
contact(paths, "out/arms4_sheet.jpg", cols=len(paths), thumb_h=900)
print("done")
