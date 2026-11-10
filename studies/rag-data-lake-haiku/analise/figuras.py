#!/usr/bin/env python3
"""Figuras do estudo 2, geradas só a partir dos dados brutos (pt e en).
Uso: python studies/rag-data-lake-haiku/analise/figuras.py  -> assets/rag-data-lake-haiku/fig-*-{pt,en}.{svg,png}
"""
import collections, glob, json, math
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

ROOT = Path(__file__).resolve().parents[3]
D = ROOT / "studies" / "rag-data-lake-haiku"
OUT = ROOT / "assets" / "rag-data-lake-haiku"
OUT.mkdir(parents=True, exist_ok=True)
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11, "svg.fonttype": "none", "axes.spines.top": False,
                     "axes.spines.right": False, "axes.edgecolor": "#555", "axes.labelcolor": "#222"})
INK, MUT, BG = "#1f2a30", "#5b6a72", "#ffffff"
COL = {"none": "#8d99a0", "all": "#d98a2b", "search": "#3f78b5", "cur": "#1f8a70", "gold": "#0b6b6f", "bad": "#b8423b", "son": "#6b5b95"}

G = {g["qid"]: g for g in json.load(open(D / "gabarito" / "rascunho.json", encoding="utf-8"))}
R = collections.defaultdict(list)
for f in glob.glob(str(D / "dados" / "bruto" / "*.jsonl")):
    for l in open(f, encoding="utf-8"):
        r = json.loads(l)
        R[(r["modelo"], r["braco"], r["qid"])].append(r)


def vote(v):
    c = collections.Counter(x["letra"] for x in v)
    m = max(c.values())
    return sorted(k for k in c if c[k] == m)[0]


V = {k: vote(v) for k, v in R.items()}


def acc(m, b, bloco=None, resp=False):
    qs = [q for q, g in G.items() if (m, b, q) in V and (bloco is None or g["bloco"] == bloco) and (not resp or g["bloco"] != "sem_resposta")]
    return sum(V[(m, b, q)] == G[q]["correta"] for q in qs), len(qs)


def wilson(k, n, z=1.96):
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return c - h, c + h


T = {
    "pt": {"A0": "Só a pergunta", "A2": "Projeto inteiro colado", "A3": "Busca simples (vetor)", "A4a": "Busca híbrida", "A4b": "Híbrida + reranker",
           "A5": "Memória curada", "A6": "Curada + portão", "A1": "Documentos certos (teto)", "N1": "Só ruído", "N1b": "Ruído + certos",
           "N2": "Certos + decisões velhas", "acaso": "acaso (25%)", "comum": "Comuns", "conflito": "Conflito", "sem": "Sem resposta",
           "docs": "Documento-ouro entre os 10", "trecho": "Trecho-ouro entre os 10", "bm25": "Palavra-chave", "vet": "Significado\n(vetor)",
           "rrf": "Híbrido", "rer": "Híbrido +\nreranker", "t_acerto": "Acerto em 120 perguntas (Haiku 5.5)", "t_blocos": "Acerto por tipo de pergunta",
           "t_custo": "Custo de responder 1.000 perguntas", "t_ctl": "O que o ruído faz com o Haiku (90 perguntas com resposta)",
           "t_rec": "A busca acha o trecho certo? (10 trechos, 90 perguntas)", "gab": "certa",
           "t_ex": "Um exemplo real: o que cada forma de contexto respondeu"},
    "en": {"A0": "Question only", "A2": "Whole project pasted", "A3": "Simple search (vector)", "A4a": "Hybrid search", "A4b": "Hybrid + reranker",
           "A5": "Curated memory", "A6": "Curated + gate", "A1": "Right documents (ceiling)", "N1": "Noise only", "N1b": "Noise + right docs",
           "N2": "Right docs + old decisions", "acaso": "chance (25%)", "comum": "Ordinary", "conflito": "Conflict", "sem": "No answer",
           "docs": "Gold document in the top 10", "trecho": "Gold excerpt in the top 10", "bm25": "Keyword", "vet": "Meaning\n(vector)",
           "rrf": "Hybrid", "rer": "Hybrid +\nreranker", "t_acerto": "Accuracy on 120 questions (Haiku 5.5)", "t_blocos": "Accuracy by question type",
           "t_custo": "Cost of answering 1,000 questions", "t_ctl": "What noise does to Haiku (90 answerable questions)",
           "t_rec": "Does the search find the right excerpt? (10 chunks, 90 questions)", "gab": "correct",
           "t_ex": "A real example: what each way of giving context answered"},
}


def money(x, lang):
    s = f"{x:,.2f}"
    return "US$ " + (s.replace(",", "X").replace(".", ",").replace("X", ".") if lang == "pt" else s)


def salva(fig, nome, lang):
    for ext in ("svg", "png"):
        fig.savefig(OUT / f"{nome}-{lang}.{ext}", format=ext, bbox_inches="tight", facecolor=BG, dpi=140)
    plt.close(fig)


def box(ax, x, y, w, h, fc, ec=None, r=0.02):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle=f"round,pad=0,rounding_size={r}", fc=fc, ec=ec or fc, lw=1.2))


def arrow(ax, x0, y0, x1, y1):
    ax.add_patch(FancyArrowPatch((x0, y0), (x1, y1), arrowstyle="-|>", mutation_scale=16, color=MUT, lw=1.6))


def fig_metodo(lang):
    pt = lang == "pt"
    steps = [("109 + 152", "documentos do projeto\ne cartões de decisão" if pt else "project documents\nand decision cards"),
             ("120", "perguntas de múltipla\nescolha (60·30·30)" if pt else "multiple-choice\nquestions (60·30·30)"),
             ("13", "formas de dar contexto\n(11 Haiku, 2 Sonnet)" if pt else "ways of giving context\n(11 Haiku, 2 Sonnet)"),
             ("5×", "respostas por pergunta,\nvoto por maioria" if pt else "answers per question,\nmajority vote"),
             ("7.200" if pt else "7,200", "chamadas, 0 erros,\n6 hipóteses de antemão" if pt else "calls, 0 errors,\n6 hypotheses upfront")]
    fig, ax = plt.subplots(figsize=(11.5, 2.7))
    ax.set_xlim(0, 11.5)
    ax.set_ylim(0, 2.7)
    ax.axis("off")
    for i, (big, small) in enumerate(steps):
        x = 0.1 + i * 2.3
        box(ax, x, 0.25, 1.95, 2.2, "#eef4f4", "#bcd3d4")
        ax.text(x + 0.975, 1.7, big, ha="center", va="center", fontsize=21, fontweight="bold", color=COL["gold"])
        ax.text(x + 0.975, 0.85, small, ha="center", va="center", fontsize=9.6, color=INK, linespacing=1.35)
        if i < 4:
            arrow(ax, x + 1.98, 1.35, x + 2.3, 1.35)
    salva(fig, "fig-metodo", lang)


def fig_metodo_simples(lang):
    pt = lang == "pt"
    steps = [("1", "Fizemos 120 perguntas\nsobre decisões de um projeto real" if pt else "We wrote 120 questions\nabout decisions in a real project"),
             ("2", "Demos ao Haiku 11 tipos de\ncontexto, do nada ao projeto todo" if pt else "We gave Haiku 11 kinds of\ncontext, from nothing to everything"),
             ("3", "Contamos os acertos\ne o custo de cada um" if pt else "We counted the hits\nand the cost of each")]
    fig, ax = plt.subplots(figsize=(10.5, 2.4))
    ax.set_xlim(0, 10.5)
    ax.set_ylim(0, 2.4)
    ax.axis("off")
    for i, (n, s) in enumerate(steps):
        x = 0.1 + i * 3.5
        box(ax, x, 0.2, 3.1, 2.0, "#eef4f4", "#bcd3d4")
        ax.text(x + 0.45, 1.2, n, ha="center", va="center", fontsize=26, fontweight="bold", color=COL["gold"])
        ax.text(x + 0.9, 1.2, s, ha="left", va="center", fontsize=10.5, color=INK, linespacing=1.4)
        if i < 2:
            arrow(ax, x + 3.13, 1.2, x + 3.5, 1.2)
    salva(fig, "fig-metodo-simples", lang)


def fig_acerto(lang):
    t = T[lang]
    arms = [("A0", "none"), ("A2", "all"), ("A3", "search"), ("A4a", "search"), ("A4b", "search"), ("A5", "cur"), ("A6", "cur")]
    fig, ax = plt.subplots(figsize=(9.5, 4.2))
    for i, (b, c) in enumerate(arms):
        k, n = acc("haiku", b)
        lo, hi = wilson(k, n)
        y = len(arms) - 1 - i
        ax.barh(y, 100 * k / n, color=COL[c], height=0.62)
        ax.errorbar(100 * k / n, y, xerr=[[100 * (k / n - lo)], [100 * (hi - k / n)]], color=INK, capsize=3, lw=1.2)
        ax.text(100 * hi + 1.5, y, f"{k}/{n}  ({100 * k / n:.0f}%)", va="center", fontsize=10, color=INK)
    ax.set_yticks(range(len(arms)))
    ax.set_yticklabels([t[b] for b, _ in reversed(arms)])
    ax.axvline(25, color=MUT, ls="--", lw=1)
    ax.text(25.5, len(arms) - 0.45, t["acaso"], fontsize=8.5, color=MUT)
    ax.set_xlim(0, 118)
    ax.set_xlabel("%")
    ax.set_title(t["t_acerto"], loc="left", fontsize=12, fontweight="bold")
    salva(fig, "fig-acerto", lang)


def fig_blocos(lang):
    t = T[lang]
    arms = [("A0", "none"), ("A2", "all"), ("A4b", "search"), ("A5", "cur")]
    blocos = [("comum", "comum"), ("conflito", "conflito"), ("sem_resposta", "sem")]
    fig, ax = plt.subplots(figsize=(9.5, 4.2))
    w = 0.19
    for j, (b, c) in enumerate(arms):
        for i, (bl, key) in enumerate(blocos):
            k, n = acc("haiku", b, bl)
            x = i + (j - 1.5) * w
            ax.bar(x, 100 * k / n, w * 0.92, color=COL[c], label=t[b] if i == 0 else None)
            ax.text(x, 100 * k / n + 1.5, f"{100 * k / n:.0f}", ha="center", fontsize=8.5, color=INK)
    ax.set_xticks(range(3))
    ax.set_xticklabels([f"{t[k]}\n(n={acc('haiku', 'A5', bl)[1]})" for bl, k in blocos])
    ax.set_ylim(0, 115)
    ax.set_ylabel("%")
    ax.legend(frameon=False, fontsize=9, ncol=4, loc="upper center", bbox_to_anchor=(0.5, 1.02))
    ax.set_title(t["t_blocos"], loc="left", fontsize=12, fontweight="bold", pad=22)
    salva(fig, "fig-blocos", lang)


def fig_custo(lang):
    t = T[lang]
    items = [("A2", "all"), ("A1s", "son"), ("A5", "cur")]
    names = {"pt": {"A2": "Haiku, projeto inteiro colado", "A1s": "Sonnet, documentos certos entregues", "A5": "Haiku, memória curada"},
             "en": {"A2": "Haiku, whole project pasted", "A1s": "Sonnet, right documents handed over", "A5": "Haiku, curated memory"}}[lang]
    nom = {"A2": 0.22391, "A1s": 0.02859, "A5": 0.00088}  # US$ nominal por chamada (analise.txt)
    fig, ax = plt.subplots(figsize=(9.5, 3.0))
    for i, (key, c) in enumerate(items):
        v = nom[key] * 1000
        y = len(items) - 1 - i
        ax.barh(y, v, color=COL[c], height=0.6)
        ax.text(v + 4, y, money(v, lang), va="center", fontsize=11, fontweight="bold", color=INK)
    ax.set_yticks(range(3))
    ax.set_yticklabels([names[k] for k, _ in reversed(items)])
    ax.set_xlim(0, 285)
    ax.set_xlabel("US$ (preço de lista, sem cache)" if lang == "pt" else "US$ (list price, no cache)")
    ax.set_title(t["t_custo"], loc="left", fontsize=12, fontweight="bold")
    salva(fig, "fig-custo", lang)


def fig_controles(lang):
    t = T[lang]
    arms = [("A0", "none"), ("N1", "bad"), ("A1", "gold"), ("N1b", "gold"), ("N2", "gold")]
    fig, ax = plt.subplots(figsize=(9.5, 3.6))
    for i, (b, c) in enumerate(arms):
        k, n = acc("haiku", b, resp=True)
        y = len(arms) - 1 - i
        ax.barh(y, 100 * k / n, color=COL[c], height=0.6)
        ax.text(100 * k / n + 1.5, y, f"{k}/{n}  ({100 * k / n:.0f}%)", va="center", fontsize=10, color=INK)
    ax.set_yticks(range(len(arms)))
    ax.set_yticklabels([t[b] for b, _ in reversed(arms)])
    ax.set_xlim(0, 118)
    ax.set_xlabel("%")
    ax.set_title(t["t_ctl"], loc="left", fontsize=12, fontweight="bold")
    salva(fig, "fig-controles", lang)


def fig_recall(lang):
    t = T[lang]
    dados = [("bm25", 0.48, 0.36), ("vet", 0.82, 0.50), ("rrf", 0.81, 0.66), ("rer", 0.91, 0.79)]  # piloto/recall-rerank.txt, k=10
    fig, ax = plt.subplots(figsize=(9.5, 3.8))
    w = 0.36
    for i, (k, d, tr) in enumerate(dados):
        ax.bar(i - w / 2, 100 * d, w * 0.95, color="#9db8d6", label=t["docs"] if i == 0 else None)
        ax.bar(i + w / 2, 100 * tr, w * 0.95, color=COL["search"], label=t["trecho"] if i == 0 else None)
        ax.text(i - w / 2, 100 * d + 1.5, f"{100 * d:.0f}", ha="center", fontsize=9)
        ax.text(i + w / 2, 100 * tr + 1.5, f"{100 * tr:.0f}", ha="center", fontsize=9)
    ax.set_xticks(range(4))
    ax.set_xticklabels([t[k] for k, *_ in dados])
    ax.set_ylim(0, 112)
    ax.set_ylabel("%")
    ax.legend(frameon=False, fontsize=9, loc="upper left", ncol=2)
    ax.set_title(t["t_rec"], loc="left", fontsize=12, fontweight="bold")
    salva(fig, "fig-recall", lang)


def fig_hipoteses(lang):
    pt = lang == "pt"
    rows = [("H1", "O contexto certo ajuda mesmo?" if pt else "Does the right context help?", "+81 pp (IC 72 a 89)" if pt else "+81 pp (CI 72 to 89)",
             "meta: ≥ 25 pp" if pt else "target: ≥ 25 pp", True),
            ("H2", "Haiku chega perto do Sonnet?" if pt else "Does Haiku get close to Sonnet?", "−4,4 pp (IC −8,9 a −1,1)" if pt else "−4.4 pp (CI −8.9 to −1.1)",
             "meta: dentro de 10 pp" if pt else "target: within 10 pp", True),
            ("H3", "A busca recupera o ganho do contexto certo?" if pt else "Does search recover the gain?", "97%", "meta: ≥ 80%" if pt else "target: ≥ 80%", True),
            ("H9", "Haiku + busca = Sonnet + docs certos, com metade do custo?" if pt else "Haiku + search = Sonnet + right docs at half the cost?",
             "p = 0,08" if pt else "p = 0.08", "meta: p < 0,05 (Holm)" if pt else "target: p < 0.05 (Holm)", False),
            ("H10a", "Curada a ¼ do custo de colar tudo, sem perder acerto?" if pt else "Curated at ¼ the cost of pasting, no accuracy loss?",
             "~1/250 do custo, +19 pp" if pt else "~1/250 of the cost, +19 pp", "meta: ≤ 25% do custo" if pt else "target: ≤ 25% of cost", True),
            ("H10b", "A memória curada é mais barata que a busca simples?" if pt else "Is curated memory cheaper than simple search?",
             "−US$ 0,0002 (IC < 0)" if pt else "−US$ 0.0002 (CI < 0)", "meta: IC abaixo de zero" if pt else "target: CI below zero", True)]
    fig, ax = plt.subplots(figsize=(11, 4.6))
    ax.set_xlim(0, 11)
    ax.set_ylim(0, len(rows) + 0.2)
    ax.axis("off")
    for i, (h, q, est, crit, ok) in enumerate(rows):
        y = len(rows) - 1 - i + 0.1
        box(ax, 0, y, 11, 0.8, "#f1f6f5" if ok else "#fbefe8", "#d3e0de" if ok else "#ecc9b6", r=0.08)
        ax.text(0.2, y + 0.4, h, fontsize=13, fontweight="bold", va="center", color=COL["gold"] if ok else COL["bad"])
        ax.text(1.1, y + 0.4, q, fontsize=9.8, va="center", color=INK)
        ax.text(7.3, y + 0.52, est, fontsize=10.2, va="center", fontweight="bold", color=INK)
        ax.text(7.3, y + 0.22, crit, fontsize=8.8, va="center", color=MUT)
        ax.text(10.8, y + 0.4, ("apoiada" if pt else "supported") if ok else ("não apoiada" if pt else "not supported"), fontsize=10, ha="right",
                va="center", fontweight="bold", color=COL["gold"] if ok else COL["bad"])
    salva(fig, "fig-hipoteses", lang)


def fig_escada(lang):
    t = T[lang]
    arms = [("A0", "none"), ("A2", "all"), ("A4b", "search"), ("A5", "cur"), ("A1", "gold")]
    fig, ax = plt.subplots(figsize=(9.5, 3.9))
    for i, (b, c) in enumerate(arms):
        k, n = acc("haiku", b, resp=True)
        ax.bar(i, 100 * k / n, color=COL[c], width=0.62)
        ax.text(i, 100 * k / n + 2, f"{100 * k / n:.0f}%", ha="center", fontsize=14, fontweight="bold", color=INK)
    ax.set_xticks(range(len(arms)))
    ax.set_xticklabels([t[b].replace(" ", "\n", 1) for b, _ in arms], fontsize=9.5)
    ax.set_ylim(0, 115)
    ax.set_yticks([])
    ax.spines["left"].set_visible(False)
    ax.set_title("Acerto nas 90 perguntas que têm resposta no material" if lang == "pt" else "Accuracy on the 90 questions that have an answer in the material",
                 loc="left", fontsize=12, fontweight="bold")
    salva(fig, "fig-escada", lang)


def fig_receita(lang):
    pt = lang == "pt"
    steps = ["Não cole o projeto\ninteiro" if pt else "Do not paste the\nwhole project",
             "Busque trechos por\npalavra + significado" if pt else "Search chunks by\nkeyword + meaning",
             "Reordene os candidatos\ncom um reranker" if pt else "Rerank the candidates\nwith a reranker",
             "Escreva cartões de decisão\ne marque os substituídos" if pt else "Write decision cards\nand flag superseded ones",
             "Meça com perguntas que\nnão vieram dos cartões" if pt else "Measure with questions\nnot written from the cards"]
    fig, ax = plt.subplots(figsize=(11.5, 2.5))
    ax.set_xlim(0, 11.5)
    ax.set_ylim(0, 2.5)
    ax.axis("off")
    for i, s in enumerate(steps):
        x = 0.05 + i * 2.3
        box(ax, x, 0.2, 2.1, 2.1, "#eef4f4", "#bcd3d4")
        ax.text(x + 1.05, 1.85, str(i + 1), ha="center", va="center", fontsize=18, fontweight="bold", color=COL["gold"])
        ax.text(x + 1.05, 0.95, s, ha="center", va="center", fontsize=9.4, color=INK, linespacing=1.4)
    salva(fig, "fig-receita", lang)


EXEMPLO = {
    "pt": ("Na discussão de junho de 2025 no h3 sobre um util defineRoute, pi0 propôs um método declarativo no core\ne, quatro dias depois, disse ter acabado adicionando outra coisa. O que foi adicionado?",
           {"A": "O util defineRoute no core", "B": "Uma interface de plugins de uso geral", "C": "Informação insuficiente no material", "D": "O método app.register(spec) no core"}),
    "en": ("In the June 2025 h3 discussion about a defineRoute util, pi0 proposed a declarative method in core\nand, four days later, said they ended up adding something else. What was added?",
           {"A": "The defineRoute util in core", "B": "A general-purpose plugin interface", "C": "Insufficient information in the material", "D": "The app.register(spec) method in core"}),
}


def fig_exemplo(lang):
    t = T[lang]
    q = "q035"
    g = G[q]
    pergunta, ops = EXEMPLO[lang]
    fig, ax = plt.subplots(figsize=(11, 5.2))
    ax.set_xlim(0, 11)
    ax.set_ylim(0, 5.2)
    ax.axis("off")
    ax.text(0.1, 5.0, t["t_ex"], fontsize=12, fontweight="bold", va="center", color=INK)
    box(ax, 0, 2.55, 11, 1.95, "#f4f6f7", "#d5dde0", r=0.06)
    ax.text(0.2, 4.05, pergunta, fontsize=9.8, va="center", color=INK, linespacing=1.4)
    for i, L in enumerate("ABCD"):
        x = 0.2 + (i % 2) * 5.5
        y = 3.35 - (i // 2) * 0.5
        ok = L == g["correta"]
        ax.text(x, y - 0.35, f"{L}) {ops[L]}" + (f"   ✔ {t['gab']}" if ok else ""), fontsize=9.4, va="center",
                color=COL["gold"] if ok else INK, fontweight="bold" if ok else "normal")
    arms = ["A0", "A2", "A3", "A4b", "A5", "A1"]
    for j, b in enumerate(arms):
        x = 0.05 + j * 1.8
        L = V[("haiku", b, q)]
        ok = L == g["correta"]
        box(ax, x, 0.2, 1.65, 2.1, "#e4f2ee" if ok else "#fbe9e7", "#9fcfc2" if ok else "#e6b5ae", r=0.06)
        ax.text(x + 0.825, 1.9, t[b].replace(" ", "\n", 1), ha="center", va="center", fontsize=8.6, color=INK, linespacing=1.2)
        ax.text(x + 0.825, 1.15, L, ha="center", va="center", fontsize=24, fontweight="bold", color=COL["gold"] if ok else COL["bad"])
        ax.text(x + 0.825, 0.5, "✔" if ok else "✘", ha="center", va="center", fontsize=11, color=COL["gold"] if ok else COL["bad"])
    salva(fig, "fig-exemplo", lang)


if __name__ == "__main__":
    for lang in ("pt", "en"):
        for f in (fig_metodo, fig_metodo_simples, fig_acerto, fig_blocos, fig_custo, fig_controles, fig_recall, fig_hipoteses, fig_escada,
                  fig_receita, fig_exemplo):
            f(lang)
    print(sorted(p.name for p in OUT.glob("*-pt.png")))
    print({b: V[("haiku", b, "q035")] for b in ("A0", "A1", "A2", "A3", "A4b", "A5")}, G["q035"]["correta"])
