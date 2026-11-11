"""Juiz Fable em pares (imagem). Modos:
  wiser  : valida o juiz contra os 300 pares do WiserUI-Bench (rótulo = vencedora do teste A/B real); 100 pares repetidos com A/B trocados.
  t1     : julga as telas finais do T1 (renderizadas) contra uma âncora por pedido (ordem aleatória balanceada).
Uso: /tmp/uiclipenv/Scripts/python.exe -I gerador/juiz.py wiser|t1 --saida dados/juiz/x.jsonl [--teto-usd 60]
Custo = total_cost_usd reportado pela chamada (preço do modelo usado). Retomável. Não passa pelos modelos sob teste."""
import argparse, base64, hashlib, io, json, random, shutil, subprocess, sys, tempfile, threading, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from PIL import Image

AQUI = Path(__file__).resolve().parents[1]
LIMPO = Path(tempfile.gettempdir()) / "estudo3-limpo"; LIMPO.mkdir(exist_ok=True)
SISTEMA = "Você é um avaliador experiente de design de interfaces."
PERGUNTA = ("Compare as duas versões de interface (A e B). Qual delas guia melhor o usuário a concluir o objetivo da tela, considerando hierarquia visual, "
            "clareza, consistência e legibilidade? Responda em uma única linha neste formato exato: VENCEDORA: A ou B")
trava = threading.Lock(); GASTO = {"usd": 0.0}


def png_b64(path, maxdim=1024):
    im = Image.open(path).convert("RGB"); im.thumbnail((maxdim, maxdim * 2))
    b = io.BytesIO(); im.save(b, "PNG"); return base64.b64encode(b.getvalue()).decode()


def bloco(b64): return {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}}


def julgar(pa, pb, effort="medium", modelo="fable"):
    msg = {"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": "Versão A:"}, bloco(png_b64(pa)), {"type": "text", "text": "Versão B:"}, bloco(png_b64(pb)), {"type": "text", "text": PERGUNTA}]}}
    cmd = [shutil.which("claude.cmd") or shutil.which("claude"), "-p", "--model", modelo, "--effort", effort, "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
           "--setting-sources", "project", "--strict-mcp-config", "--no-session-persistence", "--tools", "", "--system-prompt", SISTEMA]
    r = subprocess.run(cmd, input=json.dumps(msg) + "\n", capture_output=True, text=True, encoding="utf-8", cwd=LIMPO, timeout=600)
    for l in r.stdout.splitlines():
        d = json.loads(l)
        if d.get("type") == "result":
            u = d.get("usage", {}); txt = str(d.get("result", ""))
            import re
            m = re.search(r"VENCEDORA:\s*([AB])", txt)
            if d.get("is_error") or not m: raise RuntimeError("sem veredito: " + txt[:120])
            return {"vencedora": m.group(1), "usd": d.get("total_cost_usd") or 0.0, "in": u.get("input_tokens", 0), "cache_w": u.get("cache_creation_input_tokens", 0),
                    "cache_r": u.get("cache_read_input_tokens", 0), "out": u.get("output_tokens", 0), "modelo": list((d.get("modelUsage") or {}).keys())}
    raise RuntimeError("sem resultado")


def lista_wiser():
    d = json.load(open(AQUI / "dados/wiserui/WiserUI_Bench.json", encoding="utf-8")); itens = []
    rng = random.Random(20261110); idx = [x["index"] for x in d]; trocados = set(rng.sample(idx, 100))
    for x in d:
        w = next(iter((AQUI / "dados/wiserui/img").glob(f"{x['index']:03d}_win.*")), None); l = next(iter((AQUI / "dados/wiserui/img").glob(f"{x['index']:03d}_lose.*")), None)
        if not (w and l): continue
        a_win = (int(hashlib.sha256(f"w{x['index']}".encode()).hexdigest(), 16) % 2 == 0)  # ordem fixa pseudo-aleatória
        for rep in ([0, 1] if x["index"] in trocados else [0]):
            vence_a = a_win if rep == 0 else not a_win
            itens.append({"id": f"W{x['index']:03d}r{rep}", "pa": str(w if vence_a else l), "pb": str(l if vence_a else w), "correta": "A" if vence_a else "B", "par": x["index"], "rep": rep})
    return itens


def lista_t1():
    itens = []
    for f in sorted((AQUI / "dados/estetica/t1png").glob("*.png")):
        # nome: T1-01__haiku__A0__0.png ; âncora: <pedido>__ANCORA.png
        if "__ANCORA" in f.name: continue
        pedido = f.name.split("__")[0]; anc = AQUI / "dados/estetica/t1png" / f"{pedido}__ANCORA.png"
        if not anc.exists(): continue
        a_primeiro = (int(hashlib.sha256(f.name.encode()).hexdigest(), 16) % 2 == 0)
        itens.append({"id": f.stem, "pa": str(f if a_primeiro else anc), "pb": str(anc if a_primeiro else f), "alvo": "A" if a_primeiro else "B"})
    return itens


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("modo", choices=["wiser", "t1"]); ap.add_argument("--saida", required=True)
    ap.add_argument("--teto-usd", type=float, default=0.0); ap.add_argument("--paralelo", type=int, default=3); ap.add_argument("--effort", default="medium"); ap.add_argument("--limite", type=int, default=0)
    a = ap.parse_args(); saida = Path(a.saida); saida.parent.mkdir(parents=True, exist_ok=True)
    feito = set()
    if saida.exists():
        for l in saida.read_text(encoding="utf-8").splitlines():
            r = json.loads(l)
            if "erro" not in r: feito.add(r["id"]); GASTO["usd"] += r.get("usd", 0)
    itens = [i for i in (lista_wiser() if a.modo == "wiser" else lista_t1()) if i["id"] not in feito]
    if a.limite: itens = itens[:a.limite]
    print(len(itens), "julgamentos; gasto prévio US$", round(GASTO["usd"], 2), flush=True)

    def rodar(i):
        if a.teto_usd and GASTO["usd"] >= a.teto_usd: return {"parado": True}
        try: r = julgar(i["pa"], i["pb"], a.effort)
        except Exception as e: r = {"erro": str(e)[:200]}
        r.update({k: v for k, v in i.items() if k not in ("pa", "pb")})
        with trava:
            GASTO["usd"] += r.get("usd", 0)
            with open(saida, "a", encoding="utf-8") as f: f.write(json.dumps(r, ensure_ascii=False) + "\n")
        return r
    with ThreadPoolExecutor(a.paralelo) as ex:
        for n, r in enumerate(ex.map(rodar, itens), 1):
            if r.get("parado"): print("TETO FABLE ATINGIDO", round(GASTO["usd"], 2), flush=True); break
            if n % 20 == 0 or "erro" in r: print(n, "/", len(itens), "US$", round(GASTO["usd"], 2), r.get("erro", ""), flush=True)


if __name__ == "__main__":
    main()
