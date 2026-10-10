"""backgrounds. usage: bg.py t2i <name> <seeds> | bg.py i2i <name> <src.png> <seeds> <strength> | bg.py final <name> <src.png>"""
import sys
from PIL import Image
from sdlib import txt2img, img2img, hires, save, contact, QUALITY
COMMON = ("no humans, scenery, indoors, vertical composition, eye level, soft focus, depth of field, anime background art, "
          "warm off-white and indigo color palette, subtle vermilion accents, detailed background, newest, " + QUALITY)
NEG = ("1girl, 1boy, people, person, character, humanoid, text, watermark, signature, logo, lowres, blurry foreground objects, "
       "distorted perspective, fisheye, worst quality, low quality, low score, bad score, average score, bed sheets mess, "
       "stuffed toy, school desk, randoseru, nsfw")
SCENES = {
 "room_morning": "small one-room apartment of a working adult in Japan, tidy, wooden desk with laptop and notebooks, bookshelf with business books, potted plant, coffee mug, white curtains, bright morning sunlight through window, light blue sky, fresh atmosphere",
 "room_evening": "same small one-room apartment of a working adult, wooden desk with laptop and notebooks, bookshelf, potted plant, desk lamp, orange sunset light through window, sunset, long warm shadows, calm evening",
 "room_night": "same small one-room apartment of a working adult at night, night, desk lamp on, warm lamp light, laptop screen glow, dark blue night sky and city lights outside window, curtains half open, quiet cozy atmosphere",
 "library": "quiet public library study area, long wooden study tables, tall bookshelves, reading lamps, large windows, late afternoon light, calm and studious atmosphere",
 "cafe": "cozy cafe interior, wooden counter and small tables, coffee cups, pendant lights, plants, large window with street view, soft afternoon light, relaxed atmosphere",
}
mode, name = sys.argv[1], sys.argv[2]
P = SCENES[name] + ", " + COMMON
if mode == "t2i":
    seeds = [int(s) for s in sys.argv[3].split(",")]
    paths = []
    for s in seeds:
        im = txt2img(P, NEG, s, w=768, h=1344)
        im = hires(im, P, NEG, s, scale=1.5, strength=0.4)
        p = f"out/bg/{name}_s{s}.png"; save(im, p, dict(name=name, seed=s, prompt=P, negative=NEG, size=[768, 1344], hires=1.5, hires_strength=0.4))
        paths.append(p); print(name, s, flush=True)
    contact(paths, f"out/bg_{name}_sheet.jpg", cols=len(paths), thumb_h=700, labels=[f"{name} s{s}" for s in seeds])
elif mode == "i2i":
    src = Image.open(sys.argv[3]).convert("RGB"); seeds = [int(s) for s in sys.argv[4].split(",")]; st = float(sys.argv[5])
    paths = []
    for s in seeds:
        im = img2img(src, P, NEG, s, strength=st)
        p = f"out/bg/{name}_s{s}.png"; save(im, p, dict(name=name, seed=s, src=sys.argv[3], strength=st, prompt=P, negative=NEG))
        paths.append(p); print(name, s, flush=True)
    contact(paths, f"out/bg_{name}_sheet.jpg", cols=len(paths), thumb_h=700, labels=[f"{name} s{s}" for s in seeds])
elif mode == "final":
    im = Image.open(sys.argv[3]).convert("RGB")
    W, H = 1170, 2532
    s = max(W / im.width, H / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    x0 = (im.width - W) // 2; y0 = (im.height - H) // 2
    im.crop((x0, y0, x0 + W, y0 + H)).save(f"out/final_bg/{name}.jpg", quality=84, optimize=True, progressive=True)
    print("final", name)
