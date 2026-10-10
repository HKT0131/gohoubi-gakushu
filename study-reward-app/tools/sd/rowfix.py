"""replace rows y0..y1 in x-range by vertical linear interpolation (removes horizontal seams). usage: in out x0,x1 y0,y1"""
import sys
import numpy as np
from PIL import Image
a = np.array(Image.open(sys.argv[1]).convert("RGB")).astype(float)
x0, x1 = [int(v) for v in sys.argv[3].split(",")]
y0, y1 = [int(v) for v in sys.argv[4].split(",")]
top, bot = a[y0 - 1, x0:x1], a[y1 + 1, x0:x1]
for y in range(y0, y1 + 1):
    t = (y - y0 + 1) / (y1 - y0 + 2)
    a[y, x0:x1] = top * (1 - t) + bot * t
Image.fromarray(a.clip(0, 255).astype("uint8")).save(sys.argv[2])
