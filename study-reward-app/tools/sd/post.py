"""rembg (isnet-anime) -> alpha cleanup + defringe -> 1024x2048 canvas with one shared transform.
usage: post.py name=path [name=path ...]   (first one must be stage0_normal: defines the transform)"""
import sys, json, os
import numpy as np, cv2
from PIL import Image
from rembg import remove, new_session

sess = new_session("isnet-anime")
CW, CH = 1024, 2048
TOP, BOT = int(CH * 0.05), CH - int(CH * 0.03)
os.makedirs("out/final", exist_ok=True)
tf_path = "out/final/transform.json"


def cut(path):
    im = Image.open(path).convert("RGB")
    rgba = remove(im, session=sess, post_process_mask=True)
    a = np.array(rgba)[..., 3].astype(np.float32) / 255
    # drop faint ghosts / specks: keep largest component of alpha>0.5
    n, lab, stats, _ = cv2.connectedComponentsWithStats((a > 0.5).astype(np.uint8), 8)
    if n > 1:
        big = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
        keep = cv2.dilate((lab == big).astype(np.uint8), np.ones((5, 5), np.uint8))
        a = a * keep
    a[a < 0.06] = 0
    # erode 1px (white halo)
    a = cv2.erode(a, np.ones((3, 3), np.uint8))
    rgb = np.array(im).astype(np.float32)
    solid = (a > 0.97).astype(np.float32)
    k = (0, 0)
    num = cv2.GaussianBlur(rgb * solid[..., None], k, 3)
    den = cv2.GaussianBlur(solid, k, 3)[..., None]
    fg = np.where(den > 1e-3, num / np.maximum(den, 1e-3), rgb)
    edge = (a < 0.97)[..., None]
    rgb = np.where(edge, fg, rgb)
    return np.dstack([rgb, a * 255]).clip(0, 255).astype(np.uint8)


tf = json.load(open(tf_path)) if os.path.exists(tf_path) else None
for arg in sys.argv[1:]:
    name, path = arg.split("=")
    arr = cut(path)
    if tf is None:
        ys, xs = np.where(arr[..., 3] > 128)
        top, bot = ys.min(), ys.max()
        s = (BOT - TOP) / (bot - top)
        # horizontal center = head center (rows 3-8% of canvas height below the top), so the face sits at 50%
        r0, r1 = top + int(0.03 * CH / s), top + int(0.08 * CH / s)
        al = arr[..., 3] > 16
        cs = [(np.where(al[y])[0].min() + np.where(al[y])[0].max()) / 2 for y in range(r0, r1) if al[y].any()]
        cx = float(np.mean(cs))
        tf = dict(scale=s, ox=CW / 2 - cx * s, oy=TOP - top * s, ref=name, src_size=arr.shape[:2])
        json.dump({k: (float(v) if not isinstance(v, (str, tuple)) else v) for k, v in tf.items()}, open(tf_path, "w"))
    s = tf["scale"]
    im = Image.fromarray(arr, "RGBA")
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    canvas = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    canvas.alpha_composite(im, (round(tf["ox"]), round(tf["oy"]))) if tf["ox"] >= 0 and tf["oy"] >= 0 else canvas.paste(im, (round(tf["ox"]), round(tf["oy"])), im)
    canvas.save(f"out/final/{name}.png", optimize=True)
    print(name, "ok", flush=True)
