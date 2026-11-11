"""Análise pré-registrada do estudo 3b. Uso (a partir de studies/haiku-ui-producao):
  node gerador/verificar3b.mjs pontuar dados/bruto/principal-haiku.jsonl dados/parcial/pont-haiku.jsonl
  node gerador/verificar3b.mjs pontuar dados/bruto/principal-sonnet.jsonl dados/parcial/pont-sonnet.jsonl
  python analise3b.py > dados/analise.txt
Unidade de análise = tela (média das amostras). Wilcoxon pareado, IC95 por bootstrap de telas (10.000), Holm nas hipóteses confirmatórias."""
import json, sys, io, collections
import numpy as np
from scipy.stats import wilcoxon
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
rng = np.random.default_rng(20261111)
PRECO = {"haiku": (0.10, 0.50, 0.01), "sonnet": (2.0, 10.0, 0.10)}
COND_SENS = set(json.load(open("dados/estimulos/regras_condicionais.json")))
AUD_DEF = set(json.load(open("dados/auditoria_regras_defeituosas.json")))
RET = json.load(open("dados/estimulos/retidas.json", encoding="utf-8"))
LAKE = {r["id"]: r for r in json.load(open("lake/lake-ref-v2.json", encoding="utf-8"))}


def usd(r):
    pi, po, pc = PRECO[r["modelo"]]
    return sum((c["in"] + 1.25 * c["cache_w"]) * pi / 1e6 + c["cache_r"] * pc / 1e6 + c["out"] * po / 1e6 for c in r["chamadas"])


R = []
for m in ("haiku", "sonnet"):
    try:
        for l in open(f"dados/parcial/pont-{m}.jsonl", encoding="utf-8"):
            r = json.loads(l)
            if "erro" in r or "ok" not in r:
                continue
            fam = r["familia"]; H = set(RET[fam]); v = r["violar"]; ok = r["ok"]; vis = set(r.get("visiveis", []))
            exc = lambda ids, sens: [x for x in ids if not (sens and x in COND_SENS)]
            def taxa(ids): return float(np.mean([ok[x] for x in ids])) if ids else np.nan
            vm = [x for x in v if x not in H]; vr = [x for x in v if x in H]
            novas = sum(1 for k, o in ok.items() if not o and k not in v)
            R.append(dict(m=m, t=r["tarefa"], c=r["cond"], id=r["id"], fam=fam, am=r["amostra"], todas=taxa(v), mostr=taxa(vm), ret=taxa(vr),
                          sens=taxa(exc(v, True)), sens2=taxa([x for x in v if x not in AUD_DEF]), novas=novas, usd=usd(r), tin=sum(c["in"] + c["cache_w"] + c["cache_r"] for c in r["chamadas"]),
                          tout=sum(c["out"] for c in r["chamadas"]), vis_in=taxa([x for x in v if x in vis]), vis_out=taxa([x for x in v if x not in vis and x not in H]),
                          dec=len(r.get("decisoes", [])), dec_ok=sum(1 for d in r.get("decisoes", []) if d in vis), patch_falho=r["patch"]["falhos"], ok=ok, v=v, vis=vis))
    except FileNotFoundError:
        pass


def por_item(m, t, c, campo):
    d = collections.defaultdict(list)
    for r in R:
        if r["m"] == m and r["t"] == t and r["c"] == c and not (isinstance(r[campo], float) and np.isnan(r[campo])):
            d[r["id"]].append(r[campo])
    return {k: float(np.mean(v)) for k, v in d.items()}


def par(a, b):
    ks = sorted(set(a) & set(b)); return np.array([a[k] for k in ks]), np.array([b[k] for k in ks])


def teste(nome, a, b, alt="greater", margem=0.0):
    x, y = par(a, b)
    if len(x) < 3:
        print(f"  {nome}: sem dados suficientes"); return nome, 1.0, 0.0
    d = x - y; bs = [rng.choice(d, len(d)).mean() for _ in range(10000)]
    try: p = wilcoxon(d + margem, alternative=alt).pvalue if np.any(d + margem != 0) else 1.0
    except ValueError: p = 1.0
    print(f"  {nome}: n={len(x)} {x.mean():.3f} vs {y.mean():.3f}; dif {d.mean():+.3f} IC95 [{np.percentile(bs, 2.5):+.3f},{np.percentile(bs, 97.5):+.3f}]; p={p:.4f}")
    return nome, p, d.mean()


print("=== Médias por modelo, tarefa e condição (regras violadas que passam a cumprir) ===")
cells = sorted({(r["m"], r["t"], r["c"]) for r in R})
for m, t, c in cells:
    xs = [r for r in R if (r["m"], r["t"], r["c"]) == (m, t, c)]
    it = por_item(m, t, c, "todas")
    print(f"{m:6s} {t} {c:4s} n={len(xs):3d} todas {np.nanmean([r['todas'] for r in xs]):.3f} | mostradas {np.nanmean([r['mostr'] for r in xs]):.3f} | retidas {np.nanmean([r['ret'] for r in xs]):.3f} | sens {np.nanmean([r['sens'] for r in xs]):.3f} | novas {np.mean([r['novas'] for r in xs]):.2f} | US${np.mean([r['usd'] for r in xs]):.4f} | tok in {np.mean([r['tin'] for r in xs]):.0f} out {np.mean([r['tout'] for r in xs]):.0f}")

print("\n=== Hipóteses confirmatórias (Haiku; p unilateral de Wilcoxon, depois Holm) ===")
P = []
h = lambda t, c, campo="todas": por_item("haiku", t, c, campo)
# H1: regra presente > ausente em L25 e L50 (dentro da mesma tela/amostra, só regras de família)
for niv in ("L25", "L50"):
    com, sem = collections.defaultdict(list), collections.defaultdict(list)
    for r in R:
        if r["m"] == "haiku" and r["t"] == "T4" and r["c"] == niv:
            for x in r["v"]:
                if x in RET[r["fam"]]: continue
                (com if x in r["vis"] else sem)[r["id"]].append(r["ok"][x])
    P.append(teste(f"H1 T4 {niv} regra presente > ausente", {k: np.mean(v) for k, v in com.items()}, {k: np.mean(v) for k, v in sem.items()}))
P.append(teste("H2a T4 L25 > L0", h("T4", "L25", "mostr"), h("T4", "L0", "mostr")))
P.append(teste("H2b T4 L50 > L25", h("T4", "L50", "mostr"), h("T4", "L25", "mostr")))
P.append(teste("H2c T4 L100 > L50", h("T4", "L100", "mostr"), h("T4", "L50", "mostr")))
P.append(teste("H3 T4 retidas: L100 não pior que L0 (margem 0,05)", h("T4", "L100", "ret"), h("T4", "L0", "ret"), margem=0.05))
P.append(teste("H4 T4 L100 > D (mostradas)", h("T4", "L100", "mostr"), h("T4", "D", "mostr")))
P.append(teste("H6a T2 A3 > A1", h("T2", "A3"), h("T2", "A1")))
P.append(teste("H6b T4 K > L100", h("T4", "K"), h("T4", "L100")))
P.append(teste("H7a T2 novas A0 > A2 (menos é melhor)", h("T2", "A0", "novas"), h("T2", "A2", "novas")))
P.append(teste("H7b T4 novas L100 > K", h("T4", "L100", "novas"), h("T4", "K", "novas")))
ps = sorted(P, key=lambda x: x[1]); m = len(ps); print("\nHolm (alfa 0,05):"); bloq = False
for i, (n, p, d) in enumerate(ps):
    lim = 0.05 / (m - i); ok = (p <= lim) and not bloq; bloq = bloq or not ok
    print(f"  {'REJEITA H0' if ok else 'não rejeita'} | p={p:.4f} limiar={lim:.4f} | {n}")

print("\n=== H5 recuperação: R mantém >=90% do ganho de L100 sobre L0 (Haiku, T4, regras mostradas por L100) ===")
l0, l100, rr = h("T4", "L0"), h("T4", "L100"), h("T4", "R")
g100 = np.mean(list(l100.values())) - np.mean(list(l0.values())); gr = np.mean(list(rr.values())) - np.mean(list(l0.values()))
tin = lambda c: np.mean([r["tin"] for r in R if r["m"] == "haiku" and r["t"] == "T4" and r["c"] == c])
print(f"  ganho L100 {g100:+.3f}; ganho R {gr:+.3f}; razão {gr / g100 if g100 else float('nan'):.2f} (critério >=0,90); tokens de entrada L100 {tin('L100'):.0f}, R {tin('R'):.0f}")

print("\n=== Sensibilidade: sem regras condicionais ===")
for c in ("L0", "L25", "L50", "L100", "D", "R", "K"):
    print(f"  T4 {c}: {np.nanmean([r['sens'] for r in R if r['m'] == 'haiku' and r['t'] == 'T4' and r['c'] == c]):.3f}")
for c in ("A0", "A1", "A2", "A3"):
    print(f"  T2 {c}: {np.nanmean([r['sens'] for r in R if r['m'] == 'haiku' and r['t'] == 'T2' and r['c'] == c]):.3f}")

print("\n=== Sensibilidade 2: sem as regras com defeito de verificador confirmado em auditoria ===")
for tt, cs in (("T4", ("L0", "L25", "L50", "L100", "D", "R", "K")), ("T2", ("A0", "A1", "A2", "A3"))):
    for mm in ("haiku", "sonnet"):
        linha = [f"{c} {np.nanmean([r['sens2'] for r in R if r['m'] == mm and r['t'] == tt and r['c'] == c]):.3f}" for c in cs if any(r['m'] == mm and r['t'] == tt and r['c'] == c for r in R)]
        print(f"  {mm} {tt}: " + " | ".join(linha))

print("\n=== H9 (descritivo): Haiku vs Sonnet nas mesmas telas ===")
for t, ch, cs in (("T2", "A3", "A0"), ("T4", "L100", "L0")):
    ih, is_ = por_item("haiku", t, ch, "todas"), por_item("sonnet", t, cs, "todas")
    x, y = par(ih, is_)
    ch_, cs_ = np.mean([r["usd"] for r in R if r["m"] == "haiku" and r["t"] == t and r["c"] == ch]), np.mean([r["usd"] for r in R if r["m"] == "sonnet" and r["t"] == t and r["c"] == cs])
    if len(x): print(f"  {t}: Haiku {ch} {x.mean():.3f} vs Sonnet {cs} {y.mean():.3f}; razão {x.mean() / y.mean():.2f} (>=0,90); custo {ch_:.4f} vs {cs_:.4f}, razão {ch_ / cs_:.3f} (<=0,50); n={len(x)}")

print("\n=== Decisões citadas (T4, Haiku): fração que aponta para regra mostrada ===")
for c in ("L25", "L50", "L100", "D", "R", "K"):
    xs = [r for r in R if r["m"] == "haiku" and r["t"] == "T4" and r["c"] == c and r["dec"]]
    if xs: print(f"  {c}: {sum(r['dec_ok'] for r in xs) / sum(r['dec'] for r in xs):.2f} ({sum(r['dec'] for r in xs)} decisões)")
print("\nTrechos que falharam ao aplicar (média por chamada):", round(np.mean([r["patch_falho"] for r in R]), 2))
print("Custo nominal total da rodada principal US$", round(sum(r["usd"] for r in R), 2))
