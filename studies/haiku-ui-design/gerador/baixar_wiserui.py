"""Baixa as imagens do WiserUI-Bench a partir do JSON de metadados (CC BY-NC-SA 4.0, só pesquisa não comercial; não redistribuir).
Só https, só hosts do JSON, só content-type image/*, máximo 15 MB por arquivo."""
import json, sys, time, urllib.request, urllib.parse
from pathlib import Path
R = Path(__file__).resolve().parents[1] / "dados" / "wiserui"
d = json.load(open(R / "WiserUI_Bench.json", encoding="utf-8"))
perm = {urllib.parse.urlparse(x[k]).netloc for x in d for k in ("win_url", "lose_url")}
ok = falha = 0
for x in d:
    for k, nome in (("win_url", "win"), ("lose_url", "lose")):
        u = x[k]; p = urllib.parse.urlparse(u); dest = R / "img" / f"{x['index']:03d}_{nome}"
        if list((R / "img").glob(dest.name + ".*")): ok += 1; continue
        if p.scheme != "https" or p.netloc not in perm: falha += 1; continue
        try:
            rq = urllib.request.Request(u, headers={"User-Agent": "melolabs-pesquisa/1.0"})
            with urllib.request.urlopen(rq, timeout=30) as r:
                ct = r.headers.get("content-type", "")
                if not ct.startswith("image/"): raise ValueError("tipo " + ct)
                b = r.read(15_000_001)
                if len(b) > 15_000_000: raise ValueError("grande")
            ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}.get(ct.split(";")[0], ".img")
            Path(str(dest) + ext).write_bytes(b); ok += 1
        except Exception as e:
            falha += 1; print("falha", x["index"], nome, str(e)[:80], flush=True)
        time.sleep(0.2)
print("baixadas", ok, "falhas", falha)
