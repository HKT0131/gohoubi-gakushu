"""stage inpaint chain on 1248x1824 base. usage: python stages.py <stage> <input.png> <seeds> """
import sys
from PIL import Image, ImageDraw, ImageChops
from sdlib import inpaint, save, contact
from prompts import prompt, neg

BG = (243, 241, 238)
NAVY = (28, 45, 85)
WHITE = (240, 240, 244)
SKIN = (250, 222, 205)
SKIRT = (222, 212, 196)
HANDS = [(370, 885, 465, 1025), (845, 890, 925, 1012)]  # hands as redrawn at stage2; kept from stage3 on
RHAND = (836, 870, 898, 984)
LHAND = (368, 878, 442, 988)


def poly(size, polys, ells=()):
    m = Image.new("L", size, 0); d = ImageDraw.Draw(m)
    for p in polys: d.polygon(p, fill=255)
    for e in ells: d.ellipse(e, fill=255)
    return m


def minus_hands(m):
    d = ImageDraw.Draw(m)
    for h in HANDS: d.ellipse(h, fill=0)
    return m


def fill(img, region_mask, color):
    out = img.copy()
    out.paste(Image.new("RGB", img.size, color), (0, 0), region_mask)
    return out


L_ARM = [(468, 418), (540, 430), (465, 880), (385, 872)]
R_ARM = [(760, 418), (812, 438), (875, 862), (815, 865)]
TORSO = [(505, 410), (790, 410), (755, 725), (512, 725)]
SKIRT_P = [(512, 700), (752, 700), (835, 1372), (418, 1372)]


def hair_keep(img):
    import numpy as np
    a = np.array(img).astype(int)
    hm = ((a[..., 0] > a[..., 2] + 12) & (a.sum(-1) < 360)).astype("uint8") * 255
    hm[405:] = 0; hm[:, :490] = 0; hm[:, 770:] = 0
    from PIL import ImageFilter
    return Image.fromarray(hm, "L").filter(ImageFilter.MaxFilter(5))


def setup(stage, img):
    W, H = img.size
    if stage == 1:
        m = poly((W, H), [[(555, 345), (712, 345), (712, 462), (555, 462)]], [(488, 60, 760, 236)])
        import numpy as np
        a = np.array(img).astype(int)
        navy = ((a[..., 2] > a[..., 0] + 20) & (a.sum(-1) < 450)).astype("uint8") * 255
        hm = ImageChops.multiply(Image.fromarray(navy, "L"), poly((W, H), [], [(488, 60, 760, 236)]))
        hm = hm.filter(__import__("PIL.ImageFilter", fromlist=["x"]).MaxFilter(7))
        pre = fill(img, hm, BG)
        strength = 0.95
    elif stage == 2:
        m = poly((W, H), [[(300, 392), (920, 392), (920, 1385), (300, 1385)]])
        sil = poly((W, H), [L_ARM, R_ARM, TORSO, SKIRT_P])
        out_sil = ImageChops.subtract(m, sil)
        pre = fill(img, out_sil, BG)
        arms = ImageChops.multiply(poly((W, H), [L_ARM, R_ARM]), m)
        pre = fill(pre, arms, NAVY)
        sk = ImageChops.subtract(ImageChops.multiply(poly((W, H), [SKIRT_P]), m), poly((W, H), [TORSO]))
        pre = fill(pre, sk, SKIRT)
        pre = fill(pre, poly((W, H), [], [LHAND, RHAND]), SKIN)
        strength = 0.9
    elif stage == 3:
        import numpy as np
        from PIL import ImageFilter
        a = np.array(img).astype(int)
        navy = ((a[..., 2] > a[..., 0] + 25) & (a.sum(-1) < 420)).astype("uint8") * 255
        navy[:395] = 0; navy[900:] = 0
        N = Image.fromarray(navy, "L").filter(ImageFilter.MaxFilter(9))
        m = minus_hands(ImageChops.lighter(N, poly((W, H), [[(480, 405), (815, 405), (780, 762), (495, 762)]])))
        inner = N.filter(ImageFilter.MinFilter(29))
        pre = fill(img, N, BG)
        pre = fill(pre, inner, WHITE)
        strength = 0.85
    elif stage == 4:
        LA = [(478, 425), (535, 435), (452, 885), (395, 880)]
        RA = [(758, 425), (810, 440), (905, 885), (850, 888)]
        m = poly((W, H), [[(320, 392), (960, 392), (960, 1385), (320, 1385)]])  # hands redrawn too
        body = poly((W, H), [LA, RA,
                            [(595, 378), (690, 378), (690, 425), (595, 425)],      # neck
                            [(520, 415), (770, 415), (735, 720), (540, 720)],      # torso
                            [(530, 700), (745, 700), (775, 900), (505, 900)],      # hips
                            [(505, 880), (645, 880), (640, 1385), (545, 1385)],    # left thigh
                            [(640, 880), (775, 880), (745, 1385), (660, 1385)]],   # right thigh
                       [(372, 880, 452, 1000), (850, 885, 922, 1000)])                # hands
        pre = fill(img, ImageChops.subtract(m, body), BG)
        pre = fill(pre, ImageChops.multiply(body, m), SKIN)
        strength = 0.9
    if stage >= 2:
        hk = hair_keep(img)
        m = ImageChops.subtract(m, hk)
        pre = Image.composite(img, pre, hk)
    return m, pre, strength


if __name__ == "__main__":
    stage = int(sys.argv[1]); inp = sys.argv[2]
    seeds = [int(s) for s in sys.argv[3].split(",")]
    strength_override = float(sys.argv[4]) if len(sys.argv) > 4 else None
    img = Image.open(inp).convert("RGB")
    m, pre, strength = setup(stage, img)
    if strength_override: strength = strength_override
    pre.save(f"out/st{stage}_prefill.png"); m.save(f"out/st{stage}_mask.png")
    P, N = prompt(stage), neg(stage)
    paths = []
    for s in seeds:
        r = inpaint(pre, m, P, N, s, strength=strength, steps=30, cfg=5.0, blur=6)
        # restore outside-mask from the true input (prefill only inside)
        r = Image.composite(r, img, m.filter(__import__("PIL.ImageFilter", fromlist=["x"]).GaussianBlur(6)))
        p = f"out/st{stage}/s{s}.png"
        save(r, p, dict(stage=stage, input=inp, seed=s, prompt=P, negative=N, strength=strength, steps=30, cfg=5.0))
        paths.append(p); print("seed", s, flush=True)
    contact(paths, f"out/st{stage}_sheet.jpg", cols=len(paths), thumb_h=900, labels=[f"s{s}" for s in seeds])
    print("done")
