"""Nota de estética por UIClip + métricas de apoio. Uso: python uiclip.py pasta_png saida.json"""
import sys, json, glob, os
import numpy as np
from PIL import Image
import torch
from transformers import CLIPModel, CLIPProcessor

MODEL = "biglab/uiclip_jitteredwebsites-2-224-paraphrased"
DESC = "login screen with email field, password field and sign in button"
model = CLIPModel.from_pretrained(MODEL).eval()
proc = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")


def janelas(img, s=224):
    w, h = img.size
    m = min(w, h); k = s / m
    img = img.resize((max(s, round(w * k)), max(s, round(h * k))))
    w, h = img.size
    if w >= h:
        return [img.crop((x, 0, x + s, s)) for x in range(0, max(1, w - s + 1), s)] or [img]
    return [img.crop((0, y, s, y + s)) for y in range(0, max(1, h - s + 1), s)]


@torch.no_grad()
def nota(img):
    ims = janelas(img.convert("RGB"))
    ie = model.visual_projection(model.vision_model(**proc(images=ims, return_tensors="pt")).pooler_output)
    ie = ie.mean(0, keepdim=True); ie = ie / ie.norm(dim=-1, keepdim=True)
    t = ["ui screenshot. well-designed. " + DESC, "ui screenshot. poor design. " + DESC]
    te = model.text_projection(model.text_model(**proc(text=t, return_tensors="pt", padding=True)).pooler_output)
    te = te / te.norm(dim=-1, keepdim=True)
    sc = (100 * ie @ te.T).softmax(dim=-1)
    return float(sc[0, 0])


def colorido(a):
    a = a.astype(float); rg = a[..., 0] - a[..., 1]; yb = .5 * (a[..., 0] + a[..., 1]) - a[..., 2]
    return float(np.hypot(rg.std(), yb.std()) + .3 * np.hypot(rg.mean(), yb.mean()))


def bordas(a):
    g = a.mean(-1); gx = np.abs(np.diff(g, axis=1))[:-1]; gy = np.abs(np.diff(g, axis=0))[:, :-1]
    return float((np.hypot(gx, gy) > 30).mean())


if __name__ == "__main__":
    pasta, saida = sys.argv[1:3]; out = {}
    for f in sorted(glob.glob(os.path.join(pasta, "*.png"))):
        im = Image.open(f).convert("RGB"); a = np.asarray(im)
        out[os.path.basename(f)[:-4]] = {"uiclip": nota(im), "colorido": colorido(a), "bordas": bordas(a)}
    json.dump(out, open(saida, "w"), indent=1)
    print(len(out), "telas")
