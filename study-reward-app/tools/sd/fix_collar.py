"""paint leftover collar (white/blue-grey) pixels to background in a box. usage: fix_collar.py in out x0,y0,x1,y1"""
import sys
import numpy as np
from PIL import Image
img = np.array(Image.open(sys.argv[1]).convert("RGB")).astype(int)
x0, y0, x1, y1 = [int(v) for v in sys.argv[3].split(",")]
sub = img[y0:y1, x0:x1]
r, g, b = sub[..., 0], sub[..., 1], sub[..., 2]
collar = (b >= r - 4) & (r > 120)   # bluish/neutral light pixels (skin and hair are red-dominant)
sub[collar] = (243, 241, 238)
Image.fromarray(img.astype("uint8")).save(sys.argv[2])
