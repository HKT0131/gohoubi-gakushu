"""remove leftover coat-beige pixels in a box by painting background. usage: fix_beige.py in out x0,y0,x1,y1 [x0,y0,x1,y1...]"""
import sys
import numpy as np
from PIL import Image
img = np.array(Image.open(sys.argv[1]).convert("RGB")).astype(int)
for b in sys.argv[3:]:
    x0, y0, x1, y1 = [int(v) for v in b.split(",")]
    sub = img[y0:y1, x0:x1]
    r, g, bl = sub[..., 0], sub[..., 1], sub[..., 2]
    beige = (r > 150) & (r - bl > 25) & (r - bl < 90) & (g > 120) & (r < 245)
    sub[beige] = (243, 241, 238)
Image.fromarray(img.astype("uint8")).save(sys.argv[2])
