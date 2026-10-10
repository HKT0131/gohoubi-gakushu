"""match skirt color of stage2/3 to stage0 (per-channel gain on beige skirt pixels). usage: skirtfix.py ref.png in.png out.png"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
ref = np.array(Image.open(sys.argv[1]).convert("RGB")).astype(float)
img = np.array(Image.open(sys.argv[2]).convert("RGB")).astype(float)
def beige(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return (r > 120) & (r - b > 12) & (r - b < 80) & (g < r + 2)
H, W = img.shape[:2]
reg = Image.new("L", (W, H), 0); ImageDraw.Draw(reg).polygon([(490, 640), (790, 640), (870, 1400), (400, 1400)], fill=255)
reg = np.array(reg) > 0
sample = np.zeros_like(reg); sample[950:1250, 560:720] = True
mr = beige(ref) & sample; mi = beige(img) & sample
gain = np.median(ref[mr], axis=0) / np.median(img[mi], axis=0)
print("ref", np.median(ref[mr], axis=0), "img", np.median(img[mi], axis=0), "gain", gain)
m = (beige(img) & reg).astype(np.uint8) * 255
m = np.array(Image.fromarray(m).filter(ImageFilter.GaussianBlur(2))).astype(float)[..., None] / 255
out = img * (1 - m) + np.clip(img * gain, 0, 255) * m
Image.fromarray(out.astype(np.uint8)).save(sys.argv[3])
