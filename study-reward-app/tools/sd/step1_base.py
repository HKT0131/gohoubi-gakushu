"""stage0_normal candidates: txt2img 832x1216, N seeds."""
import sys, time
from sdlib import txt2img, save, contact
from prompts import prompt, neg
from PIL import Image
seeds = [int(s) for s in sys.argv[1].split(",")] if len(sys.argv) > 1 else list(range(1001, 1025))
P, N = prompt(0), neg(0)
TAG = sys.argv[2] if len(sys.argv) > 2 else ""
CFG = float(sys.argv[3]) if len(sys.argv) > 3 else 5.0
paths = []
for s in seeds:
    t = time.time()
    im = txt2img(P, N, s, cfg=CFG)
    p = f"out/base{TAG}/s{s}.png"
    save(im, p, dict(seed=s, prompt=P, negative=N, w=832, h=1216, steps=28, cfg=CFG, sampler="euler_a"))
    paths.append(p)
    print(f"seed {s} {time.time()-t:.1f}s", flush=True)
contact(paths, f"out/base_sheet{TAG}.jpg", cols=8, thumb_h=560, labels=[f"s{s}" for s in seeds])
# face crops
faces = []
for p in paths:
    im = Image.open(p)
    fp = p.replace(".png", "_face.jpg")
    im.crop((216, 0, 616, 400)).save(fp)
    faces.append(fp)
contact(faces, f"out/base_faces{TAG}.jpg", cols=8, thumb_h=300, labels=[f"s{s}" for s in seeds])
print("done", flush=True)
