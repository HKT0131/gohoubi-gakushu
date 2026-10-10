"""Animagine XL 4.0 helper (runs on DGX Spark, ~/sdgen). Not used on the Mac.

txt2img (+ hires img2img pass), inpaint (whole picture / crop-"only masked"),
all pipelines share one set of weights.
"""
import json, os, sys, time
import numpy as np
import torch
from PIL import Image, ImageFilter
from diffusers import (StableDiffusionXLPipeline, StableDiffusionXLImg2ImgPipeline,
                       StableDiffusionXLInpaintPipeline, EulerAncestralDiscreteScheduler)

MODEL = "cagliostrolab/animagine-xl-4.0"
DTYPE = torch.bfloat16

QUALITY = "masterpiece, high score, great score, absurdres"
NEG_MODEL = ("lowres, bad anatomy, bad hands, text, error, missing finger, extra digits, fewer digits, cropped, "
             "worst quality, low quality, low score, bad score, average score, signature, watermark, username, blurry")
# ASSETS.md common negative (content policy)
NEG_POLICY = ("child, loli, shota, toddler, young child, teenager, aged down, petite body, small body, flat chest, chibi, large head, "
              "school uniform, serafuku, randoseru, "
              "nsfw, nude, naked, nipples, covered nipples, cleavage, large breasts, huge breasts, lingerie, underwear, bra, panties, "
              "see-through, wet clothes, sexually suggestive, seductive pose, spread legs, from below, ass focus, breast focus, "
              "bad anatomy, bad hands, extra fingers, missing fingers, extra arms, deformed, blurry, lowres, jpeg artifacts, "
              "watermark, signature, text, logo, cropped, out of frame")

_pipes = {}


def pipes():
    if not _pipes:
        t = time.time()
        base = StableDiffusionXLPipeline.from_pretrained(MODEL, torch_dtype=DTYPE, use_safetensors=True)
        base.scheduler = EulerAncestralDiscreteScheduler.from_config(base.scheduler.config)
        base.to("cuda")
        base.set_progress_bar_config(disable=True)
        _pipes["t2i"] = base
        _pipes["i2i"] = StableDiffusionXLImg2ImgPipeline(**base.components)
        _pipes["inp"] = StableDiffusionXLInpaintPipeline(**base.components)
        for p in _pipes.values():
            p.set_progress_bar_config(disable=True)
        print(f"[load] {time.time()-t:.1f}s", flush=True)
    return _pipes


_compel = {}


def embeds(prompt, neg):
    """long prompt support (>77 tokens) via compel chunking."""
    from compel import Compel, ReturnedEmbeddingsType
    if "c" not in _compel:
        b = pipes()["t2i"]
        _compel["c"] = Compel(tokenizer=[b.tokenizer, b.tokenizer_2], text_encoder=[b.text_encoder, b.text_encoder_2],
                              returned_embeddings_type=ReturnedEmbeddingsType.PENULTIMATE_HIDDEN_STATES_NON_NORMALIZED,
                              requires_pooled=[False, True], truncate_long_prompts=False)
    c = _compel["c"]
    pe, pp = c([prompt])
    ne, np_ = c([neg])
    if pe.shape[1] != ne.shape[1]:
        if "empty" not in _compel:
            _compel["empty"] = c([""])[0]
        e = _compel["empty"]
        while pe.shape[1] < ne.shape[1]:
            pe = torch.cat([pe, e], dim=1)
        while ne.shape[1] < pe.shape[1]:
            ne = torch.cat([ne, e], dim=1)
    return dict(prompt_embeds=pe, pooled_prompt_embeds=pp, negative_prompt_embeds=ne, negative_pooled_prompt_embeds=np_)


def gen(seed):
    return torch.Generator("cuda").manual_seed(int(seed))


def txt2img(prompt, neg, seed, w=832, h=1216, steps=28, cfg=5.0):
    return pipes()["t2i"](**embeds(prompt, neg), width=w, height=h, num_inference_steps=steps,
                          guidance_scale=cfg, generator=gen(seed)).images[0]


def img2img(img, prompt, neg, seed, strength=0.4, steps=28, cfg=5.0):
    return pipes()["i2i"](**embeds(prompt, neg), image=img, strength=strength,
                          num_inference_steps=steps, guidance_scale=cfg, generator=gen(seed)).images[0]


def hires(img, prompt, neg, seed, scale=1.5, strength=0.4, steps=28, cfg=5.0):
    w, h = img.size
    W, H = int(w * scale) // 8 * 8, int(h * scale) // 8 * 8
    up = img.resize((W, H), Image.LANCZOS)
    return img2img(up, prompt, neg, seed, strength, steps, cfg)


def inpaint(img, mask, prompt, neg, seed, strength=0.85, steps=30, cfg=5.0, blur=8, keep_outside=True):
    """whole-picture inpaint. mask: L image, white = repaint. Outside mask is restored pixel-exact."""
    w, h = img.size
    out = pipes()["inp"](**embeds(prompt, neg), image=img, mask_image=mask, width=w, height=h,
                         strength=strength, num_inference_steps=steps, guidance_scale=cfg,
                         generator=gen(seed)).images[0]
    if keep_outside:
        m = mask.filter(ImageFilter.GaussianBlur(blur)) if blur else mask
        out = Image.composite(out, img, m)
    return out


def inpaint_crop(img, mask, box, prompt, neg, seed, strength=0.45, steps=30, cfg=5.0, target=1024, blur=6):
    """'Only masked' style: crop box (x0,y0,x1,y1), upscale so long side = target, inpaint, paste back."""
    x0, y0, x1, y1 = box
    crop = img.crop(box)
    mcrop = mask.crop(box)
    cw, ch = crop.size
    s = target / max(cw, ch)
    W, H = int(round(cw * s / 8)) * 8, int(round(ch * s / 8)) * 8
    c2 = crop.resize((W, H), Image.LANCZOS)
    m2 = mcrop.resize((W, H), Image.LANCZOS)
    r = pipes()["inp"](**embeds(prompt, neg), image=c2, mask_image=m2, width=W, height=H,
                       strength=strength, num_inference_steps=steps, guidance_scale=cfg,
                       generator=gen(seed)).images[0]
    r = r.resize((cw, ch), Image.LANCZOS)
    mb = mcrop.filter(ImageFilter.GaussianBlur(blur))
    pasted = Image.composite(r, crop, mb)
    out = img.copy()
    out.paste(pasted, (x0, y0))
    return out


def save(img, path, meta):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    img.save(path)
    with open(os.path.splitext(path)[0] + ".json", "w") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)


def contact(paths, out, cols=6, thumb_h=600, labels=None):
    from PIL import ImageDraw
    ims = [Image.open(p).convert("RGB") for p in paths]
    ths = [im.resize((int(im.width * thumb_h / im.height), thumb_h), Image.LANCZOS) for im in ims]
    tw = max(t.width for t in ths)
    rows = (len(ths) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw, rows * (thumb_h + 24)), (60, 60, 60))
    d = ImageDraw.Draw(sheet)
    for i, t in enumerate(ths):
        x, y = (i % cols) * tw, (i // cols) * (thumb_h + 24)
        sheet.paste(t, (x, y + 24))
        d.text((x + 4, y + 4), labels[i] if labels else os.path.basename(paths[i]), fill=(255, 255, 0))
    sheet.save(out, quality=88)
