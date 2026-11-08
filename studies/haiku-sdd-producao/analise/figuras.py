#!/usr/bin/env python3
"""Figuras e tabelas do artigo, geradas só a partir dos dados (passo F9.2). Todo número do texto vem destas saídas.

Uso: python -I analise/figuras.py   -> dados/processado/{tabela-*.csv, fig-*.svg} e cópia das figuras em assets/haiku-sdd-producao/
"""
import csv
import json
import shutil
import statistics as st
import sys
from collections import defaultdict
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

sys.argv.append("--estendida")  # usa o conjunto estendido (adendo 2b)
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import analise as A  # noqa: E402

PROC = A.PROC
ASSETS = A.ROOT.parents[1] / "assets" / "haiku-sdd-producao"
NOMES = {"C0": "Sonnet\npadrão", "C1": "Haiku\nsimples", "C4": "Haiku +\ntestes + loop", "C5": "Cascata", "C6": "Híbrido",
         "C2": "Gate +\nloop", "C2n": "Autorrevisão", "C10": "Persona", "C11": "Contexto", "C12": "Persona +\ncontexto", "C13": "Controle de\ntamanho"}
COR = {"C0": "#2f4b7c", "C1": "#d9822b", "C4": "#2b8a6e", "C5": "#6d6d6d", "C6": "#8a5a9e"}
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "axes.spines.top": False, "axes.spines.right": False,
                     "axes.edgecolor": "#555", "axes.labelcolor": "#222", "xtick.color": "#222", "ytick.color": "#222", "svg.fonttype": "none"})


def salva(fig, nome):
    p = PROC / nome
    fig.savefig(p, format="svg", bbox_inches="tight")
    fig.savefig(PROC / nome.replace(".svg", ".png"), format="png", dpi=130, bbox_inches="tight", facecolor="white")
    ASSETS.mkdir(parents=True, exist_ok=True)
    shutil.copy(p, ASSETS / nome)
    shutil.copy(PROC / nome.replace(".svg", ".png"), ASSETS / nome.replace(".svg", ".png"))
    plt.close(fig)


def main():
    runs = A.carrega()
    art = A.carrega_rubrica()
    cond = ["C0", "C1", "C4", "C5", "C6", "C2", "C2n", "C10", "C11", "C12", "C13"]

    # tabela 1: por condição
    linhas = []
    for c in cond:
        rs = [r for r in runs.values() if r["cond"] == c]
        k = sum(r["nucleo_100"] for r in rs)
        lo, hi = A.wilson(k, len(rs), 1.96)
        linhas.append({"condicao": c, "n": len(rs), "nucleo_100": k, "taxa": round(k / len(rs), 4), "wilson_lo": round(lo, 4), "wilson_hi": round(hi, 4),
                       "fracao_testes": round(st.mean(r["frac"] for r in rs), 4), "custo_lista_usd": round(st.mean(r["custo"] for r in rs), 4),
                       "tokens_totais": round(st.mean(r["tok"] for r in rs)), "tokens_novos": round(st.mean(r["novos"] for r in rs))})
    with open(PROC / "tabela-condicoes.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(linhas[0]))
        w.writeheader()
        w.writerows(linhas)

    # tabela 2: núcleo por variante e condição (C0, C1, C4)
    pv = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    for r in runs.values():
        if r["cond"] in ("C0", "C1", "C4"):
            pv[r["var"]][r["cond"]][0] += r["nucleo_100"]
            pv[r["var"]][r["cond"]][1] += 1
    with open(PROC / "tabela-variantes.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["variante", "C0_acertos", "C0_n", "C1_acertos", "C1_n", "C4_acertos", "C4_n"])
        for v in sorted(pv):
            w.writerow([v] + [x for c in ("C0", "C1", "C4") for x in pv[v][c]])

    # tabela 3: rubrica por condição e tipo (média ± erro-padrão por artefato)
    linhas_r = []
    for tipo in ("techspec", "tasks"):
        for c in cond:
            v = [a["soma"] for (rid, t), a in art.items() if t == tipo and a["cond"] == c]
            if v:
                linhas_r.append({"tipo": tipo, "condicao": c, "n": len(v), "media": round(st.mean(v), 2), "erro_padrao": round(st.stdev(v) / len(v) ** 0.5, 2) if len(v) > 1 else None,
                                 "maximo": 35 if tipo == "techspec" else 25})
    with open(PROC / "tabela-rubrica.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(linhas_r[0]))
        w.writeheader()
        w.writerows(linhas_r)

    # figura 1: núcleo 100% (C0, C1, C4) no geral e por variante
    fig, axs = plt.subplots(1, 2, figsize=(11, 4), gridspec_kw={"width_ratios": [1, 2.6]})
    ax = axs[0]
    for i, c in enumerate(["C0", "C1", "C4"]):
        l = next(x for x in linhas if x["condicao"] == c)
        ax.bar(i, l["taxa"] * 100, color=COR[c], width=0.6)
        ax.errorbar(i, l["taxa"] * 100, yerr=[[l["taxa"] * 100 - l["wilson_lo"] * 100], [l["wilson_hi"] * 100 - l["taxa"] * 100]], color="#222", capsize=3)
        ax.text(i, 3, f'{l["nucleo_100"]}/{l["n"]}', ha="center", color="white", fontsize=9)
    ax.set_xticks(range(3), [NOMES[c] for c in ("C0", "C1", "C4")])
    ax.set_ylabel("execuções com núcleo 100% (%)")
    ax.set_ylim(0, 105)
    ax.set_title("Todas as variantes (IC 95% de Wilson)", fontsize=10, loc="left")
    ax = axs[1]
    vs = sorted(pv)
    for j, c in enumerate(["C0", "C1", "C4"]):
        xs = [i + (j - 1) * 0.27 for i in range(len(vs))]
        ys = [100 * pv[v][c][0] / pv[v][c][1] for v in vs]
        ax.bar(xs, ys, width=0.26, color=COR[c], label=NOMES[c].replace("\n", " "))
        for x, y, v in zip(xs, ys, vs):
            ax.text(x, y + 1.5, f"{pv[v][c][0]}/{pv[v][c][1]}", ha="center", fontsize=6.5, color="#333")
    ax.set_xticks(range(len(vs)), [v.replace("problem-", "#").replace("range-", "#").replace("session-", "#") for v in vs], rotation=0, fontsize=8)
    ax.set_ylim(0, 112)
    ax.legend(frameon=False, fontsize=8, loc="upper center", ncol=3, bbox_to_anchor=(0.5, 1.0))
    ax.set_title("Por variante de tarefa (acertos/execuções)", fontsize=10, loc="left")
    fig.tight_layout()
    salva(fig, "fig-nucleo.svg")

    # figura 2: custo de lista e tokens relativos ao Sonnet
    ref = next(x for x in linhas if x["condicao"] == "C0")
    fig, axs = plt.subplots(1, 2, figsize=(10, 3.8))
    for ax, chave, titulo in ((axs[0], "custo_lista_usd", "Custo de lista (Sonnet = 1)"), (axs[1], "tokens_totais", "Tokens totais (Sonnet = 1)")):
        cs = ["C0", "C1", "C4", "C5"]
        vals = [next(x for x in linhas if x["condicao"] == c)[chave] / ref[chave] for c in cs]
        ax.bar(range(len(cs)), vals, color=[COR[c] for c in cs], width=0.6)
        for i, v in enumerate(vals):
            ax.text(i, v + 0.02 * max(vals), f"{v:.2f}", ha="center", fontsize=9)
        ax.set_xticks(range(len(cs)), [NOMES[c] for c in cs], fontsize=8)
        ax.set_title(titulo, fontsize=10, loc="left")
    fig.tight_layout()
    salva(fig, "fig-custo.svg")

    # figura 3: rubrica por condição, gráfico de pontos (posição, não comprimento) com eixo truncado declarado
    curto = {"C0": "Sonnet", "C1": "Haiku\nsimples", "C4": "Haiku +\ntestes", "C5": "Cascata", "C6": "Híbrido", "C10": "Persona",
             "C11": "Contexto", "C12": "Pers. +\ncont.", "C13": "Controle"}
    fig, axs = plt.subplots(1, 2, figsize=(11, 4))
    for ax, tipo, mx in ((axs[0], "techspec", 35), (axs[1], "tasks", 25)):
        ls = [x for x in linhas_r if x["tipo"] == tipo and x["condicao"] in curto]
        ax.errorbar(range(len(ls)), [x["media"] for x in ls], yerr=[x["erro_padrao"] or 0 for x in ls], fmt="none", ecolor="#222", capsize=3, zorder=3)
        for i, x in enumerate(ls):
            ax.plot(i, x["media"], "o", color=COR.get(x["condicao"], "#9a9a9a"), markersize=9, zorder=4)
        ax.set_xticks(range(len(ls)), [curto[x["condicao"]] for x in ls], fontsize=7.5)
        ax.set_ylim(mx * 0.78, mx)
        ax.set_ylabel(f"nota (máx. {mx}); eixo truncado")
        ax.set_title(f"{'TechSpec' if tipo == 'techspec' else 'Tasks'}: média ± erro-padrão", fontsize=10, loc="left")
        ax.axhline(mx, color="#bbb", lw=0.6)
    fig.tight_layout()
    salva(fig, "fig-rubrica.svg")
    extras(runs, linhas)
    print("figuras e tabelas geradas em", PROC)


def extras(runs, linhas):
    """Figuras adicionais (mapa por tarefa, efeito do P1, custo por resultado aceito, receita do guia). Usa revisao.json (rode revisao.py antes)."""
    from matplotlib.patches import FancyBboxPatch
    REV = json.loads((PROC / "revisao.json").read_text(encoding="utf-8"))
    pv = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    for r in runs.values():
        if r["cond"] in ("C0", "C1", "C4"):
            pv[r["var"]][r["cond"]][0] += r["nucleo_100"]
            pv[r["var"]][r["cond"]][1] += 1
    # mapa por tarefa
    vs = sorted(pv)
    cs = ["C0", "C1", "C4"]
    fig, ax = plt.subplots(figsize=(7.2, 3.6))
    import matplotlib.colors as mc
    cmap = mc.LinearSegmentedColormap.from_list("v", ["#c0504d", "#f2d98d", "#2b8a6e"])
    for i, v in enumerate(vs):
        for j, c in enumerate(cs):
            k, n = pv[v][c]
            ax.add_patch(plt.Rectangle((j, len(vs) - 1 - i), 0.96, 0.92, color=cmap(k / n)))
            ax.text(j + 0.48, len(vs) - 1 - i + 0.46, f"{k}/{n}", ha="center", va="center", fontsize=10, color="#111")
    ax.set_xlim(0, 3)
    ax.set_ylim(0, len(vs))
    ax.set_xticks([0.48, 1.48, 2.48], ["Sonnet\npadrão", "Haiku\nsimples", "Haiku + testes\n+ loop"])
    ax.xaxis.tick_top()
    ax.set_yticks([len(vs) - 1 - i + 0.46 for i in range(len(vs))], [v.replace("problem-", "#").replace("range-", "#").replace("session-", "#") for v in vs])
    for s in ax.spines.values():
        s.set_visible(False)
    ax.tick_params(length=0)
    ax.set_title("Execuções que passaram em todo o núcleo de testes, por tarefa", fontsize=10, loc="left", pad=34)
    fig.tight_layout()
    salva(fig, "fig-mapa-tarefas.svg")

    # efeito do P1: C4 menos Sonnet, com e sem o teste P1 no núcleo
    from math import isfinite
    h4 = None
    c0 = [r for r in runs.values() if r["cond"] == "C0"]
    c4 = [r for r in runs.values() if r["cond"] == "C4"]
    d, lo, hi = A.newcombe(sum(r["nucleo_100"] for r in c4), len(c4), sum(r["nucleo_100"] for r in c0), len(c0), 1.96)
    sp = REV["nucleo_sem_P1_como_observacao"]
    d2, lo2, hi2 = sp["diferenca_C4_menos_C0"], sp["newcombe_bilateral_95"][0], sp["newcombe_bilateral_95"][1]
    fig, ax = plt.subplots(figsize=(7.2, 2.6))
    for y, (rot, dd, l, h, cor) in enumerate([("Sem o teste P1 no núcleo\n(51/54 contra 49/54)", d2, lo2, hi2, "#2b8a6e"), ("Núcleo como definido\n(39/54 contra 49/54)", d, lo, hi, "#c0504d")]):
        ax.errorbar(dd * 100, y, xerr=[[dd * 100 - l * 100], [h * 100 - dd * 100]], fmt="o", color=cor, capsize=4, markersize=8)
        ax.text(h * 100 + 1.5, y, f"{dd * 100:+.1f}".replace(".", ",") + " pontos", va="center", fontsize=9)
        ax.text(-49, y, rot, va="center", fontsize=8.5)
    ax.axvline(0, color="#555", lw=1)
    ax.set_xlim(-50, 28)
    ax.set_ylim(-0.6, 1.6)
    ax.set_yticks([])
    ax.set_xlabel("Haiku + testes + loop menos Sonnet (pontos percentuais, IC 95%)")
    ax.spines["left"].set_visible(False)
    ax.set_title("O déficit de código quase some quando se tira um único teste", fontsize=10, loc="left")
    fig.tight_layout()
    salva(fig, "fig-efeito-p1.svg")

    # custo por execução e por resultado aceito
    cq = REV["custo_por_nucleo_aceito"]
    c0m = next(x for x in linhas if x["condicao"] == "C0")["custo_lista_usd"]
    c4m = next(x for x in linhas if x["condicao"] == "C4")["custo_lista_usd"]
    fig, ax = plt.subplots(figsize=(7.2, 2.8))
    grupos = [("Por execução", c0m, c4m), ("Por execução que passou\nno núcleo de testes", cq["C0"], cq["C4"])]
    for i, (rot, a, b) in enumerate(grupos):
        y = 1 - i
        ax.barh(y + 0.18, a, height=0.32, color=COR["C0"])
        ax.barh(y - 0.18, b, height=0.32, color=COR["C4"])
        ax.text(a + 0.02, y + 0.18, f"US$ {a:.2f}".replace(".", ",") + "  Sonnet", va="center", fontsize=9)
        ax.text(b + 0.02, y - 0.18, (f"US$ {b:.2f}  Haiku + testes + loop ({b / a:.2f} do Sonnet)").replace(".", ","), va="center", fontsize=9)
        ax.text(-0.02, y, rot, ha="right", va="center", fontsize=9)
    ax.set_xlim(0, 2.6)
    ax.set_yticks([])
    ax.set_xlabel("custo de lista, em dólares")
    ax.spines["left"].set_visible(False)
    fig.tight_layout()
    salva(fig, "fig-custo-aceito.svg")

    # receita do guia
    passos = [("1. Pedido\nclaro", "contrato curto com\nnomes públicos"), ("2. Haiku\nescreve", "PRD, TechSpec\ne Tasks"), ("3. Checagem\nautomática", "até 2 correções\ncom os erros reais"),
              ("4. Testes\nprimeiro", "ver falhar,\nimplementar"), ("5. Loop de\ncorreção", "até 3 rodadas com\na saída real"), ("6. Pessoa\nrevisa", "escala p/ Sonnet se\nfalhar (sugestão)")]
    fig, ax = plt.subplots(figsize=(10, 2.6))
    cores = ["#8a8f98", "#2b8a6e", "#2b8a6e", "#2b8a6e", "#2b8a6e", "#d9822b"]
    for i, ((t, s), c) in enumerate(zip(passos, cores)):
        x = i * 1.65
        ax.add_patch(FancyBboxPatch((x, 0.3), 1.45, 1.4, boxstyle="round,pad=0.02,rounding_size=0.08", fc=c, ec="none"))
        ax.text(x + 0.725, 1.3, t, ha="center", va="center", color="white", fontsize=9.5, fontweight="bold")
        ax.text(x + 0.725, 0.68, s, ha="center", va="center", color="white", fontsize=8)
        if i < len(passos) - 1:
            ax.annotate("", xy=(x + 1.62, 1.0), xytext=(x + 1.47, 1.0), arrowprops=dict(arrowstyle="->", color="#444"))
    ax.text(0, -0.05, "verde: medido no estudo   |   laranja: sugestão, não testada aqui   |   cinza: parte do desenho do estudo", fontsize=8, color="#444")
    ax.set_xlim(-0.1, 9.9)
    ax.set_ylim(-0.3, 1.9)
    ax.axis("off")
    salva(fig, "fig-guia-receita.svg")


if __name__ == "__main__":
    main()
