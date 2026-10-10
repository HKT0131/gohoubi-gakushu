"""paint non-hair non-skin light pixels in a box with back-hair shadow color. usage: in out x0,y0,x1,y1"""
import sys
import numpy as np
from PIL import Image
img = np.array(Image.open(sys.argv[1]).convert("RGB")).astype(int)
x0, y0, x1, y1 = [int(v) for v in sys.argv[3].split(",")]
sub = img[y0:y1, x0:x1]
r, g, b = sub[..., 0], sub[..., 1], sub[..., 2]
skin = (r - b > 22) & (r > 170)
hair = (r + g + b < 380)
sub[~skin & ~hair] = (82, 60, 58)
Image.fromarray(img.astype("uint8")).save(sys.argv[2])
