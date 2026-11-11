#!/usr/bin/env python3
"""Figuras do estudo 3b (pt e en). Lê os arquivos pontuados (dados/bruto/pont-*.jsonl, ou outra pasta em PONT=...) e o axe (axe-*.json, se existir).
Nada é digitado à mão. Uso (a partir da raiz do repositório): python studies/haiku-ui-producao/analise/figuras3b.py
Saída: assets/haiku-ui-producao/fig-*-{pt,en}.{svg,png}"""
import collections, json, os
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

ROOT = Path(__file__).resolve().parents[3]
S = ROOT / "studies" / "haiku-ui-producao"
PONT = Path(os.environ.get("PONT", S / "dados" / "bruto"))
OUT = ROOT / "assets" / "haiku-ui-producao"
OUT.mkdir(parents=True, exist_ok=True)
RET = json.load(open(S / "dados" / "estimulos" / "retidas.json", encoding="utf-8"))
DEF = set(json.load(open(S / "dados" / "auditoria_regras_defeituosas.json")))
PRECO = {"haiku": (0.10, 0.50, 0.01), "sonnet": (2.0, 10.0, 0.10)}
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11, "svg.fonttype": "none", "axes.spines.top": False, "axes.spines.right": False,
                     "axes.edgecolor": "#555", "axes.labelcolor": "#222"})
INK, MUT = "#1f2a30", "#5b6a72"
COL = {"haiku": "#1f8a70", "sonnet": "#6b5b95", "none": "#8d99a0", "bad": "#b8423b", "amber": "#c98a1a", "blue": "#3f78b5"}
rng = np.random.default_rng(20261111)

R = []
for m in ("haiku", "sonnet"):
    f = PONT / f"pont-{m}.jsonl"
    if not f.exists():
        continue
    for l in open(f, encoding="utf-8"):
        r = json.loads(l)
        if "erro" in r or "ok" not in r:
            continue
        v, H, ok = r["violar"], set(RET[r["familia"]]), r["ok"]
        pi, po, pc = PRECO[m]
        usd = sum((c["in"] + 1.25 * c["cache_w"]) * pi / 1e6 + c["cache_r"] * pc / 1e6 + c["out"] * po / 1e6 for c in r["chamadas"])
        vis = set(r.get("visiveis", []))
        mean = lambda ids: float(np.mean([ok[x] for x in ids])) if ids else np.nan
        R.append(dict(m=m, t=r["tarefa"], c=r["cond"], id=r["id"], todas=mean(v), mostr=mean([x for x in v if x not in H]), ret=mean([x for x in v if x in H]),
                      sens2=mean([x for x in v if x not in DEF]), usd=usd, novas=sum(1 for k, o in ok.items() if not o and k not in v)))


def cel(m, t, c, campo="todas"):
    d = collections.defaultdict(list)
    for r in R:
        if r["m"] == m and r["t"] == t and r["c"] == c and not np.isnan(r[campo]):
            d[r["id"]].append(r[campo])
    return np.array([np.mean(v) for v in d.values()])


def ic(x):
    if len(x) < 3:
        return (np.nan, np.nan)
    b = [rng.choice(x, len(x)).mean() for _ in range(4000)]
    return np.percentile(b, 2.5), np.percentile(b, 97.5)


def media_ic(m, t, c, campo="todas"):
    x = cel(m, t, c, campo)
    if not len(x):
        return np.nan, np.nan, np.nan, 0
    lo, hi = ic(x); return x.mean(), lo, hi, len(x)


TXT = {
    "pt": dict(comp="Completude do lake no T4 (Haiku e Sonnet)", x="Regras do lake mostradas ao modelo", y="Regras violadas que o modelo passou a cumprir",
               niv=["0%", "25%", "50%", "100%"], d="outros\ndomínios", r="BM25\n(12 regras)", k="100% +\nrelatório", haiku="Haiku 5.5", sonnet="Sonnet 5.5",
               t2="T2: o relatório cumpre o que lista e deixa o resto", t2y="Regras violadas que passaram a cumprir", mostr="regras mostradas", ret="regras retidas (nunca vistas)",
               cond=["puro", "regras", "relatório", "regras +\nrelatório"], custo="Custo nominal por tela e acerto", cx="Custo nominal por chamada (US$, escala log)", cy="Acerto (T4, lake 100%)",
               novas="Regras que a tela já cumpria e passaram a falhar (T2)", metodo="O desenho do estudo 3b",
               m1="6 famílias de telas\n(300 a 1.200 linhas)", m2="140 regras do lake\n(25% retidas)", m3="T2: defeitos graduados\nT4: rascunho com todos", m4="Haiku e Sonnet\n(sem internet)", m5="Verificador em navegador\n+ axe-core", m6="Regras corrigidas\nvs novas falhas"),
    "en": dict(comp="Lake completeness in T4 (Haiku and Sonnet)", x="Lake rules shown to the model", y="Violated rules the model brought into compliance",
               niv=["0%", "25%", "50%", "100%"], d="other\ndomains", r="BM25\n(12 rules)", k="100% +\nreport", haiku="Haiku 5.5", sonnet="Sonnet 5.5",
               t2="T2: the report fixes what it lists and drops the rest", t2y="Violated rules brought into compliance", mostr="shown rules", ret="held-out rules (never seen)",
               cond=["plain", "rules", "report", "rules +\nreport"], custo="Nominal cost per screen and accuracy", cx="Nominal cost per call (US$, log scale)", cy="Accuracy (T4, 100% lake)",
               novas="Rules the screen already met that started failing (T2)", metodo="Study 3b design",
               m1="6 screen families\n(300 to 1,200 lines)", m2="140 lake rules\n(25% held out)", m3="T2: graded defects\nT4: draft with all", m4="Haiku and Sonnet\n(no internet)", m5="Real-browser verifier\n+ axe-core", m6="Rules fixed\nvs new failures"),
}


def salvar(fig, nome, lang):
    for ext in ("svg", "png"):
        fig.savefig(OUT / f"fig-{nome}-{lang}.{ext}", dpi=160, bbox_inches="tight", facecolor="white")
    plt.close(fig)


def fig_completude(lang):
    T = TXT[lang]; fig, ax = plt.subplots(figsize=(8.4, 4.8))
    niveis = ["L0", "L25", "L50", "L100"]
    for m in ("haiku", "sonnet"):
        pts = [media_ic(m, "T4", c, "mostr") for c in niveis]
        ys = [p[0] for p in pts]; lo = [p[0] - p[1] for p in pts]; hi = [p[2] - p[0] for p in pts]
        ax.errorbar(range(4), ys, yerr=[lo, hi], marker="o", color=COL[m], lw=2, capsize=3, label=T[m])
        for c, xx, mk in (("D", 4.6, "s"), ("R", 5.4, "^"), ("K", 6.2, "D")):
            p = media_ic(m, "T4", c, "mostr")
            if not np.isnan(p[0]):
                ax.errorbar([xx + (0.12 if m == "sonnet" else -0.12)], [p[0]], yerr=[[p[0] - p[1]], [p[2] - p[0]]], marker=mk, color=COL[m], capsize=3)
    ax.set_xticks(list(range(4)) + [4.6, 5.4, 6.2]); ax.set_xticklabels(T["niv"] + [T["d"], T["r"], T["k"]], fontsize=9)
    ax.axvline(3.9, color="#bbb", lw=.8, ls="--")
    ax.set_xlabel(T["x"]); ax.set_ylabel(T["y"]); ax.set_ylim(0.3, 1.0); ax.set_title(T["comp"], color=INK, loc="left", fontsize=12)
    ax.legend(frameon=False, loc="upper left"); salvar(fig, "completude", lang)


def fig_t2(lang):
    T = TXT[lang]; fig, axs = plt.subplots(1, 2, figsize=(10, 4.4), sharey=True)
    conds = ["A0", "A1", "A2", "A3"]
    for ax, m in zip(axs, ("haiku", "sonnet")):
        w = 0.36; xs = np.arange(4)
        for off, campo, cor, lab in ((-w / 2, "mostr", COL[m], T["mostr"]), (w / 2, "ret", COL["amber"], T["ret"])):
            ps = [media_ic(m, "T2", c, campo) for c in conds]
            ax.bar(xs + off, [p[0] for p in ps], w, color=cor, label=lab, yerr=[[p[0] - p[1] if not np.isnan(p[1]) else 0 for p in ps], [p[2] - p[0] if not np.isnan(p[2]) else 0 for p in ps]], capsize=2, ecolor="#555")
        ax.set_xticks(xs); ax.set_xticklabels(T["cond"], fontsize=9); ax.set_title(T[m], color=INK, fontsize=11); ax.set_ylim(0, 1.05)
    axs[0].set_ylabel(T["t2y"]); axs[0].legend(frameon=False, fontsize=9, loc="upper center", bbox_to_anchor=(1.05, -0.17), ncol=2); fig.suptitle(T["t2"], x=0.01, ha="left", color=INK, fontsize=12)
    salvar(fig, "t2", lang)


def fig_custo(lang):
    T = TXT[lang]; fig, ax = plt.subplots(figsize=(7.6, 4.6))
    for m in ("haiku", "sonnet"):
        for c, mk in (("L0", "o"), ("L100", "s"), ("K", "D")):
            xs = [r["usd"] for r in R if r["m"] == m and r["t"] == "T4" and r["c"] == c]
            p = media_ic(m, "T4", c, "todas")
            if xs and not np.isnan(p[0]):
                ax.scatter(np.mean(xs), p[0], s=70, marker=mk, color=COL[m]); ax.annotate(f"{c}", (np.mean(xs), p[0]), textcoords="offset points", xytext=(6, 4), fontsize=8, color=MUT)
    ax.set_xscale("log"); ax.set_xlabel(T["cx"]); ax.set_ylabel(T["cy"].replace("lake 100%", "todas as regras") if lang == "pt" else T["cy"].replace("100% lake", "all rules"))
    ax.set_title(T["custo"], loc="left", color=INK, fontsize=12)
    ax.scatter([], [], color=COL["haiku"], label=T["haiku"]); ax.scatter([], [], color=COL["sonnet"], label=T["sonnet"]); ax.legend(frameon=False)
    salvar(fig, "custo", lang)


def fig_metodo(lang):
    T = TXT[lang]; fig, ax = plt.subplots(figsize=(10, 2.6)); ax.axis("off"); ax.set_xlim(0, 12); ax.set_ylim(0, 3)
    caixas = [T["m1"], T["m2"], T["m3"], T["m4"], T["m5"], T["m6"]]
    for i, tx in enumerate(caixas):
        x = 0.1 + i * 1.98
        ax.add_patch(FancyBboxPatch((x, 0.7), 1.75, 1.6, boxstyle="round,pad=0.03,rounding_size=0.08", fc="#eef5f3", ec="#1f8a70"))
        ax.text(x + 0.875, 1.5, tx, ha="center", va="center", fontsize=8.6, color=INK)
        if i < 5:
            ax.annotate("", xy=(x + 1.95, 1.5), xytext=(x + 1.77, 1.5), arrowprops=dict(arrowstyle="->", color=MUT))
    ax.set_title(T["metodo"], loc="left", color=INK, fontsize=12); salvar(fig, "metodo", lang)


if __name__ == "__main__":
    for lang in ("pt", "en"):
        fig_metodo(lang); fig_completude(lang); fig_t2(lang); fig_custo(lang)
    print("figuras geradas em", OUT, "n registros", len(R))
