"""stage4 with ControlNet OpenPose (xinsir/controlnet-openpose-sdxl-1.0, Apache-2.0): arms posed like stage0-3,
bikini (cute design) inpainted from stage3. usage: cn4.py stage3.png seeds [cn_scale] [strength]"""
import sys, math
import numpy as np, torch
from PIL import Image, ImageDraw, ImageChops, ImageFilter
from diffusers import ControlNetModel, StableDiffusionXLControlNetInpaintPipeline
from sdlib import pipes, embeds, gen, save, contact
from prompts import prompt, neg
import stages

KP = {0: (640, 300), 1: (640, 410), 2: (500, 445), 3: (447, 665), 4: (405, 890), 5: (785, 445), 6: (838, 665), 7: (880, 887),
      8: (585, 810), 9: (590, 1290), 10: (605, 1700), 11: (700, 810), 12: (690, 1290), 13: (690, 1700),
      14: (612, 265), 15: (672, 265), 16: (580, 285), 17: (712, 285)}
LIMBS = [[2, 3], [2, 6], [3, 4], [4, 5], [6, 7], [7, 8], [2, 9], [9, 10], [10, 11], [2, 12], [12, 13], [13, 14], [2, 1], [1, 15], [15, 17], [1, 16], [16, 18], [3, 17], [6, 18]]
COLORS = [[255, 0, 0], [255, 85, 0], [255, 170, 0], [255, 255, 0], [170, 255, 0], [85, 255, 0], [0, 255, 0], [0, 255, 85], [0, 255, 170], [0, 255, 255],
          [0, 170, 255], [0, 85, 255], [0, 0, 255], [85, 0, 255], [170, 0, 255], [255, 0, 255], [255, 0, 170], [255, 0, 85]]


def pose_map(W, H, sw=10, r=10):
    import cv2
    c = np.zeros((H, W, 3), np.uint8)
    for i, (a, b) in enumerate(LIMBS[:17]):
        x1, y1 = KP[a - 1]; x2, y2 = KP[b - 1]
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        L = math.hypot(x1 - x2, y1 - y2); ang = math.degrees(math.atan2(y1 - y2, x1 - x2))
        poly = cv2.ellipse2Poly((int(mx), int(my)), (int(L / 2), sw), int(ang), 0, 360, 1)
        cv2.fillConvexPoly(c, poly, [int(v * 0.6) for v in COLORS[i]])
    for i in range(18):
        cv2.circle(c, KP[i], r, COLORS[i], -1)
    return Image.fromarray(c)


inp = Image.open(sys.argv[1]).convert("RGB")
seeds = [int(s) for s in sys.argv[2].split(",")]
cs = float(sys.argv[3]) if len(sys.argv) > 3 else 0.8
st = float(sys.argv[4]) if len(sys.argv) > 4 else 0.95
W, H = inp.size
pm = pose_map(W, H); pm.save("out/pose4.png")

# mask + prefill (same as stages.py stage 4 but arms toward stage0-3 hand positions)
LA = [(470, 430), (525, 440), (470, 670), (432, 890), (385, 885), (425, 660)]
RA = [(765, 440), (812, 430), (862, 660), (905, 885), (860, 890), (815, 670)]
m = stages.poly((W, H), [[(320, 392), (960, 392), (960, 1385), (320, 1385)]])
body = stages.poly((W, H), [LA, RA, [(595, 378), (690, 378), (690, 425), (595, 425)], [(520, 415), (770, 415), (735, 720), (540, 720)],
                            [(530, 700), (745, 700), (775, 900), (505, 900)], [(505, 880), (645, 880), (640, 1385), (545, 1385)],
                            [(640, 880), (775, 880), (745, 1385), (660, 1385)]], [(368, 880, 452, 1010), (845, 880, 928, 1010)])
pre = stages.fill(inp, ImageChops.subtract(m, body), stages.BG)
pre = stages.fill(pre, ImageChops.multiply(body, m), stages.SKIN)
hk = stages.hair_keep(inp)
m = ImageChops.subtract(m, hk); pre = Image.composite(inp, pre, hk)
pre.save("out/cn4_prefill.png")

b = pipes()["t2i"]
cn = ControlNetModel.from_pretrained("xinsir/controlnet-openpose-sdxl-1.0", torch_dtype=torch.bfloat16).to("cuda")
pipe = StableDiffusionXLControlNetInpaintPipeline(vae=b.vae, text_encoder=b.text_encoder, text_encoder_2=b.text_encoder_2, tokenizer=b.tokenizer,
                                                  tokenizer_2=b.tokenizer_2, unet=b.unet, controlnet=cn, scheduler=b.scheduler)
pipe.set_progress_bar_config(disable=True)
P, N = prompt(4), neg(4)
paths = []
for s in seeds:
    r = pipe(**embeds(P, N), image=pre, mask_image=m, control_image=pm, width=W, height=H, strength=st, num_inference_steps=30,
             guidance_scale=5.0, controlnet_conditioning_scale=cs, generator=gen(s)).images[0]
    r = Image.composite(r, inp, m.filter(ImageFilter.GaussianBlur(6)))
    p = f"out/cn4/s{s}.png"
    save(r, p, dict(step="cn4", input=sys.argv[1], seed=s, prompt=P, negative=N, strength=st, controlnet="xinsir/controlnet-openpose-sdxl-1.0", cn_scale=cs, keypoints=KP))
    paths.append(p); print("seed", s, flush=True)
contact(paths, "out/cn4_sheet.jpg", cols=len(paths), thumb_h=900)
print("done")
