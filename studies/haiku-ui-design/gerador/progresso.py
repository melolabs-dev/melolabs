"""Emite uma linha a cada 10% da rodada principal (2.220 itens: Haiku 1.140 + Sonnet 1.080; Opus fora por decisão do Caio), e em teto/fim/erros em excesso."""
import json, time, glob, os, sys
TOT = {"haiku": 1140, "sonnet": 1080}; ALVO = sum(TOT.values())
PRECO = {"haiku": (0.10, 0.50, 0.01), "sonnet": (2.0, 10.0, 0.10)}
B = "dados/bruto"; EST = B + "/.marco"
def estado():
    n = {m: 0 for m in TOT}; e = 0; usd = {m: 0.0 for m in TOT}
    for m in TOT:
        f = f"{B}/principal-{m}.jsonl"
        if not os.path.exists(f): continue
        for l in open(f, encoding="utf-8"):
            r = json.loads(l)
            if "erro" in r: e += 1; continue
            n[m] += 1; pi, po, pc = PRECO[m]
            usd[m] += sum((c["in"] + 1.25 * c["cache_w"]) * pi / 1e6 + c["cache_r"] * pc / 1e6 + c["out"] * po / 1e6 for c in r["chamadas"])
    return n, e, usd
ult = int(open(EST).read()) if os.path.exists(EST) else 0
while True:
    n, e, usd = estado(); pct = int(sum(n.values()) / ALVO * 100)
    marco = pct // 10 * 10
    if marco > ult:
        ult = marco; open(EST, "w").write(str(ult))
        print(f"MARCO {marco}%: haiku {n['haiku']}/1140, sonnet {n['sonnet']}/1080 | erros {e} | custo nominal US$ {sum(usd.values()):.2f} (H {usd['haiku']:.2f}, S {usd['sonnet']:.2f})", flush=True)
    log = open(B + "/principal.log", encoding="utf-8", errors="ignore").read()[-600:]
    if "TETO ATINGIDO" in log: print("TETO ATINGIDO: execução parou, preciso de decisão. " + f"custo nominal US$ {sum(usd.values()):.2f}", flush=True); break
    if n["sonnet"] >= 1080 and n["haiku"] >= 1139: print(f"FIM da rodada: {n}, erros {e}, custo nominal US$ {sum(usd.values()):.2f}", flush=True); break
    time.sleep(60)
