"""color grade an image before img2img (evening/night look). usage: grade.py in out r,g,b_gain gamma"""
import sys
import numpy as np
from PIL import Image
a = np.array(Image.open(sys.argv[1]).convert("RGB")).astype(float) / 255
g = np.array([float(v) for v in sys.argv[3].split(",")])
a = (a ** float(sys.argv[4])) * g
Image.fromarray((a.clip(0, 1) * 255).astype(np.uint8)).save(sys.argv[2])
