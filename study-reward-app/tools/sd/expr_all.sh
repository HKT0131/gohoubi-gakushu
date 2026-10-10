#!/bin/bash
# candidates for stage0 and stage1
PY=~/venvs/sdgen/bin/python
for st in 1 0; do
  $PY expr.py $st out/stage$st.png happy 101,102,103,104 0.62
  $PY expr.py $st out/stage$st.png shy 101,102,103,104 0.58
  $PY expr.py $st out/stage$st.png sad 101,102,103,104 0.58
  $PY expr.py $st out/stage$st.png pout 101,102,103,104 0.62
done
$PY - <<'P'
from PIL import Image, ImageDraw
for st in (1, 0):
    o = Image.new("RGB", (4 * 300, 4 * 330), (255, 255, 255)); d = ImageDraw.Draw(o)
    for r, ex in enumerate(["happy", "shy", "sad", "pout"]):
        for c, s in enumerate([101, 102, 103, 104]):
            im = Image.open(f"out/expr/st{st}_{ex}_s{s}.png").crop((530, 180, 750, 400)).resize((300, 300))
            o.paste(im, (c * 300, r * 330 + 30)); d.text((c * 300 + 5, r * 330 + 8), f"st{st} {ex} s{s}", fill=(0, 0, 0))
    o.save(f"out/expr_st{st}.jpg", quality=88)
P
echo ALLDONE
