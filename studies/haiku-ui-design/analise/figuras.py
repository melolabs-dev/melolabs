#!/usr/bin/env python3
"""Figuras do estudo 3 (pt e en), no estilo do estudo 2. Lê os números de dados/analise.txt, dos resultados do axe, das notas de validação
da estética e do juiz Fable; nada é digitado à mão, exceto os limiares fixados antes (dados/*CRITERIOS.md).
Uso: python studies/haiku-ui-design/analise/figuras.py  -> assets/haiku-ui-design/fig-*-{pt,en}.{svg,png}
"""
import collections, json, math, re
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

ROOT = Path(__file__).resolve().parents[3]
D = ROOT / "studies" / "haiku-ui-design" / "dados"
OUT = ROOT / "assets" / "haiku-ui-design"
OUT.mkdir(parents=True, exist_ok=True)
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11, "svg.fonttype": "none", "axes.spines.top": False,
                     "axes.spines.right": False, "axes.edgecolor": "#555", "axes.labelcolor": "#222"})
INK, MUT, BG = "#1f2a30", "#5b6a72", "#ffffff"
COL = {"none": "#8d99a0", "all": "#d98a2b", "search": "#3f78b5", "cur": "#1f8a70", "gold": "#0b6b6f", "bad": "#b8423b", "son": "#6b5b95", "amber": "#c98a1a"}
CONDC = {"A0": COL["none"], "A1": "#3f78b5", "A2": "#d98a2b", "A3": COL["cur"], "AC": "#a3a9ad"}

# ---------- leitura de dados/analise.txt ----------
TXT = (D / "analise.txt").read_text(encoding="utf-8")
MEDIA, CUSTO = {}, {}
for m in re.finditer(r"^(T\d) (haiku|sonnet)\s+(A\w): score ([\d.]+) \(n itens (\d+)\); custo médio/tarefa US\$([\d.]+)", TXT, re.M):
    t, mod, c, s, n, u = m.groups()
    MEDIA[(mod, t, c)] = float(s)
    CUSTO[(mod, t, c)] = float(u)
COMB = {}
for m in re.finditer(r"^\s+Haiku (A\d): acurácia ([\d.]+), custo médio/tarefa US\$([\d.]+) \| Sonnet A\d: ([\d.]+), US\$([\d.]+)", TXT, re.M):
    c, ah, ch, as_, cs = m.groups()
    COMB[("haiku", c)] = (float(ah), float(ch))
    COMB[("sonnet", c)] = (float(as_), float(cs))
RAZ = re.search(r"Haiku A3 / Sonnet A0 = ([\d.]+).*?razão de custo = ([\d.]+)", TXT)
RAZ_AC, RAZ_CU = float(RAZ.group(1)), float(RAZ.group(2))
TEST = {}  # nome -> (média, lo, hi, p)
for m in re.finditer(r"^\s+(H\d\w? [^:]+): n=(\d+) média [-\d.]+ vs [-\d.]+; diferença ([+-][\d.]+) IC95 \[([+-][\d.]+),([+-][\d.]+)\]; p=([\d.]+)", TXT, re.M):
    TEST[m.group(1)] = (float(m.group(3)), float(m.group(4)), float(m.group(5)), float(m.group(6)))
HOLM = {}
for m in re.finditer(r"^\s+(REJEITA H0|não rejeita) \| p=([\d.]+) limiar=([\d.]+) \| (.+)$", TXT, re.M):
    HOLM[m.group(4).strip()] = (m.group(1) == "REJEITA H0", float(m.group(2)), float(m.group(3)))
CAT = {}
for m in re.finditer(r"^\s+(css|conteudo|fluxo|composto|ruido|identico)\s+(H0=.*)$", TXT, re.M):
    CAT[m.group(1)] = {k: float(v) for k, v in re.findall(r"([HS]\d)=([\d.]+)", m.group(2))}
NITENS = {}
for mod in ("haiku", "sonnet"):
    NITENS[mod] = sum(1 for l in open(D / "bruto" / f"principal-{mod}-p.jsonl", encoding="utf-8") if "erro" not in json.loads(l))

# ---------- axe ----------
AXE = collections.defaultdict(lambda: collections.defaultdict(list))
for mod in ("haiku", "sonnet"):
    for r in json.load(open(D / "bruto" / f"axe-{mod}.json", encoding="utf-8")):
        if "erro" not in r and r["tarefa"] == "T1":
            AXE[(mod, r["cond"])][r["id"]].append(r["violacoes"])
AXEM = {k: sum(sum(v) / len(v) for v in d.values()) / len(d) for k, d in AXE.items()}

# ---------- validação da estética e do juiz ----------
def spearman(xs, ys):
    def rk(a):
        o = sorted(range(len(a)), key=lambda i: a[i]); r = [0] * len(a); i = 0
        while i < len(o):
            j = i
            while j + 1 < len(o) and a[o[j + 1]] == a[o[i]]: j += 1
            for k in range(i, j + 1): r[o[k]] = (i + j) / 2 + 1
            i = j + 1
        return r
    rx, ry = rk(xs), rk(ys); mx, my = sum(rx) / len(rx), sum(ry) / len(ry)
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry)); den = math.sqrt(sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry))
    return num / den if den else 0.0


def valida(arq, chave):
    n = json.load(open(D / "estetica" / arq, encoding="utf-8"))
    ref = n["ref"][chave]; A = [k for k in n if k.startswith("A_")]
    a = sum(ref > n[k][chave] for k in A)
    S = collections.defaultdict(dict)
    for k in n:
        if k.startswith("B_"): S[k[2:k.rfind("_")]][int(k[k.rfind("_") + 1:])] = n[k][chave]
    b = sum(spearman(list(range(5)), [d[i] for i in sorted(d)]) <= -0.7999 for d in S.values())
    return a, len(A), b, len(S)


EST = {"uiclip1": valida("validacao-notas.json", "uiclip"), "uiclip2": valida("validacao-notas2.json", "uiclip"), "codigo": valida("validacao-codigo.json", "nota")}
W = [json.loads(l) for l in open(D / "juiz" / "wiser.jsonl", encoding="utf-8")]
W = [r for r in W if "erro" not in r]
W0 = [r for r in W if r["rep"] == 0]
WACC = (sum(r["vencedora"] == r["correta"] for r in W0), len(W0))
def wilson(k, n, z=1.96):
    p = k / n; d = 1 + z * z / n; c = p + z * z / (2 * n); a = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return (c - a) / d, (c + a) / d
WLO, WHI = wilson(*WACC)
par = collections.defaultdict(dict)
for r in W: par[r["par"]][r["rep"]] = r
par2 = [v for v in par.values() if 0 in v and 1 in v]
WCONS = (sum((v[0]["vencedora"] == v[0]["correta"]) == (v[1]["vencedora"] == v[1]["correta"]) for v in par2), len(par2))

# ---------- textos ----------
def num(x, lang, nd=2, sign=False):
    s = f"{x:+.{nd}f}" if sign else f"{x:.{nd}f}"
    return s.replace(".", ",") if lang == "pt" else s


def money(x, lang, nd=4):
    return "US$ " + num(x, lang, nd)


def pct(x, lang, nd=1):
    return num(100 * x, lang, nd) + "%"


T = {
    "pt": {"A0": "Puro", "A1": "+ regras do data lake", "A2": "+ relatório do kit", "A3": "+ regras e relatório", "AC": "Autocrítica (controle)",
           "T1": "Criar tela", "T2": "Melhorar tela", "T3": "Comparar duas telas", "haiku": "Haiku 5.5", "sonnet": "Sonnet 5.5",
           "t_acerto": "Pontuação (0 a 1) por tarefa, condição e modelo", "t_custo": "Custo nominal médio por tarefa (média de criar, melhorar e comparar)",
           "t_hip": "As hipóteses: o que o dado diz (correção de Holm)", "t_est": "Estética sem humano: três instrumentos, nenhum válido",
           "t_cat": "Comparar telas: F1 por tipo de par", "t_esc": "Do Haiku puro às regras e ao kit", "t_axe": "Checagem independente (axe-core): violações por tela criada",
           "t_met": "O desenho: 3 tarefas × 4 condições (e um controle)"},
    "en": {"A0": "Plain", "A1": "+ data lake rules", "A2": "+ kit report", "A3": "+ rules and report", "AC": "Self-critique (control)",
           "T1": "Create a screen", "T2": "Improve a screen", "T3": "Compare two screens", "haiku": "Haiku 5.5", "sonnet": "Sonnet 5.5",
           "t_acerto": "Score (0 to 1) by task, condition and model", "t_custo": "Average nominal cost per task (mean of create, improve and compare)",
           "t_hip": "The hypotheses: what the data says (Holm correction)", "t_est": "Aesthetics without humans: three instruments, none valid",
           "t_cat": "Comparing screens: F1 by pair type", "t_esc": "From plain Haiku to rules and the kit", "t_axe": "Independent check (axe-core): violations per created screen",
           "t_met": "The design: 3 tasks × 4 conditions (and one control)"},
}
CATN = {"pt": {"css": "CSS (1 propriedade)", "conteudo": "Conteúdo", "fluxo": "Fluxo", "composto": "Composto", "ruido": "Ruído (sem diferença)", "identico": "Idêntico"},
        "en": {"css": "CSS (1 property)", "conteudo": "Content", "fluxo": "Flow", "composto": "Compound", "ruido": "Noise (no real change)", "identico": "Identical"}}


def salva(fig, nome, lang):
    for ext in ("svg", "png"):
        fig.savefig(OUT / f"{nome}-{lang}.{ext}", format=ext, bbox_inches="tight", facecolor=BG, dpi=140)
    plt.close(fig)


def box(ax, x, y, w, h, fc, ec=None, r=0.02):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle=f"round,pad=0,rounding_size={r}", fc=fc, ec=ec or fc, lw=1.2))


def arrow(ax, x0, y0, x1, y1):
    ax.add_patch(FancyArrowPatch((x0, y0), (x1, y1), arrowstyle="-|>", mutation_scale=16, color=MUT, lw=1.6))


# ---------- 1. método ----------
def fig_metodo(lang):
    pt = lang == "pt"; t = T[lang]
    tarefas = [("T1", "12 pedidos de login" if pt else "12 login requests", "criar do zero, 2ª chamada de correção em trechos" if pt else "create from scratch, 2nd call fixes by patches"),
               ("T2", "20 telas, 3 defeitos cada" if pt else "20 screens, 3 defects each", "corrigir por trechos" if pt else "fix by patches"),
               ("T3", "60 pares de telas" if pt else "60 screen pairs", "listar as diferenças reais em JSON" if pt else "list the real differences as JSON")]
    fig, ax = plt.subplots(figsize=(11.5, 5.0)); ax.set_xlim(0, 11.5); ax.set_ylim(0, 5.0); ax.axis("off")
    ax.text(0.05, 4.8, t["t_met"], fontsize=12, fontweight="bold", va="center", color=INK)
    cols = ["A0", "A1", "A2", "A3", "AC"]; x0, w = 3.3, 1.55
    for j, c in enumerate(cols):
        x = x0 + j * (w + 0.06)
        box(ax, x, 3.65, w, 0.75, "#eef4f4" if c != "AC" else "#f3f4f5", "#bcd3d4", r=0.06)
        ax.text(x + w / 2, 4.02, c, ha="center", va="center", fontsize=13, fontweight="bold", color=CONDC[c])
        ax.text(x + w / 2, 3.78, t[c].replace("+ ", "+ ", 1), ha="center", va="center", fontsize=7.4, color=INK)
    for i, (k, a, b) in enumerate(tarefas):
        y = 2.5 - i * 1.15
        box(ax, 0.05, y, 3.1, 1.0, "#e4f2ee", "#9fcfc2", r=0.06)
        ax.text(0.2, y + 0.72, t[k], fontsize=11, fontweight="bold", va="center", color=COL["gold"])
        ax.text(0.2, y + 0.44, a, fontsize=8.8, va="center", color=INK)
        ax.text(0.2, y + 0.2, b, fontsize=7.4, va="center", color=MUT)
        for j, c in enumerate(cols):
            x = x0 + j * (w + 0.06)
            on = c != "AC" or k == "T1"
            box(ax, x, y, w, 1.0, "#f1f6f5" if on else "#fafafa", "#d3e0de" if on else "#e6e6e6", r=0.06)
            ax.text(x + w / 2, y + 0.5, "●" if on else "—", ha="center", va="center", fontsize=15 if on else 12, color=CONDC[c] if on else "#bbb")
    n = NITENS["haiku"] + NITENS["sonnet"]
    ns = f"{n:,}".replace(",", ".") if pt else f"{n:,}"
    rodape = (f"Haiku e Sonnet · 3 amostras por item · {ns} itens respondidos · sem Opus (custo) · AC só no Haiku e só em criar" if pt
              else f"Haiku and Sonnet · 3 samples per item · {ns} answered items · no Opus (cost) · AC only on Haiku and only on create")
    ax.text(0.05, 0.05, rodape, fontsize=8.6, color=MUT, va="center")
    salva(fig, "fig-metodo", lang)


# ---------- 2. acerto ----------
def fig_acerto(lang):
    t = T[lang]
    fig, axs = plt.subplots(1, 3, figsize=(12, 4.2), sharey=True)
    conds = ["A0", "A1", "A2", "A3"]; w = 0.38
    for ax, tk in zip(axs, ("T1", "T2", "T3")):
        for i, c in enumerate(conds):
            for j, m in enumerate(("haiku", "sonnet")):
                v = MEDIA[(m, tk, c)]
                ax.bar(i + (j - 0.5) * w, v, w * 0.94, color=CONDC[c] if m == "haiku" else COL["son"], alpha=1.0 if m == "haiku" else 0.55,
                       edgecolor=COL["son"] if m == "sonnet" else CONDC[c], lw=1)
                ax.text(i + (j - 0.5) * w, v + 0.012, num(v, lang, 2), ha="center", fontsize=7.4, color=INK, rotation=90, va="bottom")
        ax.set_xticks(range(4)); ax.set_xticklabels(conds); ax.set_ylim(0.6, 1.12)
        ax.set_title(t[tk], fontsize=11, fontweight="bold", loc="left")
    axs[0].set_ylabel("0 – 1")
    h = [matplotlib.patches.Patch(fc=COL["none"], label=t["haiku"] + (" (cor cheia)" if lang == "pt" else " (solid)")),
         matplotlib.patches.Patch(fc=COL["son"], alpha=0.55, label=t["sonnet"] + (" (roxo claro)" if lang == "pt" else " (light purple)"))]
    fig.legend(handles=h, loc="upper right", frameon=False, fontsize=9, ncol=2, bbox_to_anchor=(1.0, 1.02))
    fig.suptitle(t["t_acerto"], x=0.01, ha="left", fontsize=12, fontweight="bold", y=1.02)
    fig.text(0.01, -0.03, ("Eixo começa em 0,6. A0 puro · A1 regras · A2 relatório do kit · A3 ambos." if lang == "pt" else "Axis starts at 0.6. A0 plain · A1 rules · A2 kit report · A3 both."),
             fontsize=8.6, color=MUT)
    salva(fig, "fig-acerto", lang)


# ---------- 3. custo ----------
def fig_custo(lang):
    t = T[lang]
    itens = [("sonnet", "A0", COL["son"]), ("sonnet", "A3", COL["son"]), ("haiku", "A0", COL["none"]), ("haiku", "A3", COL["cur"])]
    fig, ax = plt.subplots(figsize=(10.5, 3.6))
    for i, (m, c, col) in enumerate(itens):
        acc, cu = COMB[(m, c)]
        y = len(itens) - 1 - i
        ax.barh(y, cu, color=col, height=0.6, alpha=1 if m == "haiku" else 0.75)
        ax.text(cu * 1.15, y, f"{money(cu, lang)}  ·  " + (f"acerto {num(acc, lang, 3)}" if lang == "pt" else f"score {num(acc, lang, 3)}"), va="center", fontsize=10, fontweight="bold", color=INK)
    ax.set_xscale("log"); ax.set_xlim(0.001, 0.2)
    ax.set_yticks(range(len(itens))); ax.set_yticklabels([f"{t[m]} {c}" for m, c, _ in reversed(itens)])
    ax.set_xlabel("US$ por tarefa (escala log, preço de lista, tokens medidos)" if lang == "pt" else "US$ per task (log scale, list price, measured tokens)")
    ax.set_title(t["t_custo"], loc="left", fontsize=12, fontweight="bold")
    ax.text(0.2, -0.36, (f"Haiku A3 custa {num(RAZ_CU, lang, 3)} do Sonnet A0 e pontua {num(RAZ_AC, lang, 3)} vezes o dele." if lang == "pt"
                         else f"Haiku A3 costs {num(RAZ_CU, lang, 3)} of Sonnet A0 and scores {num(RAZ_AC, lang, 3)} times its score."), transform=ax.transAxes, fontsize=9.4, color=MUT)
    salva(fig, "fig-custo", lang)


# ---------- 4. hipóteses ----------
def fig_hipoteses(lang):
    pt = lang == "pt"; t = T[lang]
    def g(prefix):
        k = next(k for k in TEST if k.startswith(prefix)); return TEST[k]
    def holm(prefix):
        k = next(k for k in HOLM if k.startswith(prefix)); return HOLM[k]
    def ic(v): return f"{num(v[0], lang, 3, True)} (IC {num(v[1], lang, 2, True)} a {num(v[2], lang, 2, True)})" if pt else f"{num(v[0], lang, 3, True)} (CI {num(v[1], lang, 2, True)} to {num(v[2], lang, 2, True)})"
    h1, h3, h4, h6, h7a, h7b, h7c = g("H1 "), g("H3 T2"), g("H4"), g("H6"), g("H7a"), g("H7b"), g("H7c")
    h5 = {k: g(f"H5 {k}") for k in ("T1", "T2", "T3")}
    S, P, N, U = "sup", "par", "nao", "unt"
    rows = [("H1", "Kit melhora o recall do Haiku ao comparar?" if pt else "Does the kit raise Haiku's recall when comparing?", ic(h1),
             ("p = " + num(h1[3], lang, 4) + (", não passa em Holm" if pt else ", fails Holm")), N),
            ("H2", "Kit reduz alarme falso em ruído e idênticos?" if pt else "Does the kit cut false alarms on noise and identical pairs?",
             "0 alarmes em todas as condições" if pt else "0 false alarms in every condition", "n = 16 pares · não testável (sem margem)" if pt else "n = 16 pairs · not testable (no headroom)", U),
            ("H3", "Haiku A3 melhora telas melhor que o Haiku puro (T2)?" if pt else "Does Haiku A3 improve screens more than plain Haiku (T2)?", ic(h3),
             "p = " + num(h3[3], lang, 4) + (" · passa em Holm" if pt else " · passes Holm"), S),
            ("H4", "Haiku A3 cria telas mais completas (T1)?" if pt else "Does Haiku A3 create more complete screens (T1)?", ic(h4),
             "p = " + num(h4[3], lang, 4) + (" · passa em Holm" if pt else " · passes Holm"), S),
            ("H5", "O kit ajuda mais o Haiku que o Sonnet?" if pt else "Does the kit help Haiku more than Sonnet?",
             f"T1 {num(h5['T1'][0], lang, 3, True)} · T2 {num(h5['T2'][0], lang, 3, True)} · T3 {num(h5['T3'][0], lang, 3, True)}",
             "passa em T1 e T2; T3 não (p = " + num(h5["T3"][3], lang, 3) + ")" if pt else "passes in T1 and T2; not T3 (p = " + num(h5["T3"][3], lang, 3) + ")", P),
            ("H6", "O kit vale mais que uma 2ª passada de autocrítica (T1)?" if pt else "Is the kit worth more than a 2nd self-critique pass (T1)?", ic(h6),
             "p = " + num(h6[3], lang, 4) + (" · passa em Holm (mas o axe não separa)" if pt else " · passes Holm (but axe does not separate)"), S),
            ("H7", "Regras sozinhas ajudam; relatório melhora a comparação?" if pt else "Do rules alone help; does the report improve comparison?",
             f"A1: T1 {num(h7a[0], lang, 2, True)} · T2 {num(h7b[0], lang, 2, True)} · T3 A2−A1 {num(h7c[0], lang, 2, True)}",
             "regras sim; no T3 o kit piorou" if pt else "rules yes; in T3 the kit made it worse", P),
            ("H9", "Haiku A3 ≥ 90% do Sonnet A0 com ≤ 50% do custo?" if pt else "Haiku A3 ≥ 90% of Sonnet A0 at ≤ 50% of the cost?",
             (f"acerto {num(RAZ_AC, lang, 3)}× · custo {num(RAZ_CU, lang, 3)}×"), "só contra o Sonnet; Opus fora por custo" if pt else "vs Sonnet only; Opus left out for cost", S)]
    STY = {S: ("#f1f6f5", "#d3e0de", COL["gold"], "apoiada" if pt else "supported"), P: ("#fbf3e1", "#ebd49e", COL["amber"], "parcial" if pt else "partial"),
           N: ("#fbefe8", "#ecc9b6", COL["bad"], "não apoiada" if pt else "not supported"), U: ("#f1f2f3", "#d8dcde", MUT, "não testável" if pt else "not testable")}
    fig, ax = plt.subplots(figsize=(11.5, 5.9)); ax.set_xlim(0, 11.5); ax.set_ylim(0, len(rows) + 0.7); ax.axis("off")
    ax.text(0.05, len(rows) + 0.45, t["t_hip"], fontsize=12, fontweight="bold", va="center", color=INK)
    for i, (h, q, est, crit, st) in enumerate(rows):
        y = len(rows) - 1 - i + 0.1; fc, ec, tc, label = STY[st]
        box(ax, 0, y, 11.5, 0.8, fc, ec, r=0.08)
        ax.text(0.2, y + 0.4, h, fontsize=13, fontweight="bold", va="center", color=tc)
        ax.text(1.0, y + 0.4, q, fontsize=9.2, va="center", color=INK)
        ax.text(6.15, y + 0.52, est, fontsize=9.2, va="center", fontweight="bold", color=INK)
        ax.text(6.15, y + 0.22, crit, fontsize=8.2, va="center", color=MUT)
        ax.text(11.3, y + 0.4, label, fontsize=10, ha="right", va="center", fontweight="bold", color=tc)
    salva(fig, "fig-hipoteses", lang)


# ---------- 5. estética ----------
def fig_estetica(lang):
    pt = lang == "pt"; t = T[lang]
    u1, u2, cd = EST["uiclip1"], EST["uiclip2"], EST["codigo"]
    rows = [("UIClip, tentativa 1 (inteira)" if pt else "UIClip, attempt 1 (full)", [(f"A: {u1[0]}/{u1[1]}", "≥ 12/15"), (f"B: {u1[2]}/{u1[3]}", "≥ 4/5")]),
            ("UIClip, tentativa 2 (cortada)" if pt else "UIClip, attempt 2 (cropped)", [(f"A: {u2[0]}/{u2[1]}", "≥ 12/15"), (f"B: {u2[2]}/{u2[3]}", "≥ 4/5")]),
            ("Consistência por código" if pt else "Consistency by code", [(f"A: {cd[0]}/{cd[1]}", "≥ 12/15"), (f"B: {cd[2]}/{cd[3]}", "≥ 4/5")]),
            ("Juiz Fable × WiserUI-Bench" if pt else "Fable judge vs WiserUI-Bench",
             [(pct(WACC[0] / WACC[1], lang) + (f" acerto (IC {num(100*WLO, lang, 1)} a {num(100*WHI, lang, 1)})" if pt else f" accuracy (CI {num(100*WLO, lang, 1)} to {num(100*WHI, lang, 1)})"), "≥ 60%, IC > 50%"),
              (pct(WCONS[0] / WCONS[1], lang) + (" consistência" if pt else " consistency"), "≥ 70%")])]
    ok = {0: [False, False], 1: [False, False], 2: [False, EST["codigo"][2] >= 4], 3: [False, False]}
    ok[2][0] = cd[0] >= 12
    fig, ax = plt.subplots(figsize=(11.5, 4.6)); ax.set_xlim(0, 11.5); ax.set_ylim(0, 5.3); ax.axis("off")
    ax.text(0.05, 5.05, t["t_est"], fontsize=12, fontweight="bold", va="center", color=INK)
    ax.text(0.05, 4.62, ("Medido (esquerda) contra o limiar fixado antes de calcular (direita, cinza)." if pt else "Measured (left) against the threshold fixed before computing (right, gray)."), fontsize=8.8, color=MUT, va="center")
    for i, (nome, ms) in enumerate(rows):
        y = 3.4 - i * 1.0
        box(ax, 0, y, 11.5, 0.88, "#fbefe8", "#ecc9b6", r=0.08)
        ax.text(0.2, y + 0.44, nome, fontsize=10.2, fontweight="bold", va="center", color=INK)
        for j, (val, lim) in enumerate(ms):
            x = 4.9 + j * 3.1
            passou = (val.startswith("A:") and int(val[3:].split("/")[0]) >= 12) or (val.startswith("B:") and int(val[3:].split("/")[0]) >= 4)
            ax.text(x, y + 0.57, val, fontsize=9.2, fontweight="bold", va="center", color=COL["gold"] if passou else COL["bad"])
            ax.text(x, y + 0.24, ("limiar " if pt else "threshold ") + lim, fontsize=8, va="center", color=MUT)
        ax.text(11.35, y + 0.44, "NÃO VÁLIDO" if pt else "NOT VALID", fontsize=10.5, ha="right", va="center", fontweight="bold", color=COL["bad"])
    salva(fig, "fig-estetica", lang)


# ---------- 6. T3 por categoria ----------
def fig_t3(lang):
    t = T[lang]; cats = ["css", "conteudo", "fluxo", "composto", "ruido", "identico"]
    fig, axs = plt.subplots(2, 1, figsize=(10.5, 6.2), sharex=True)
    w = 0.2
    for ax, pre, mod in zip(axs, ("H", "S"), ("haiku", "sonnet")):
        for j, c in enumerate(("A0", "A1", "A2", "A3")):
            for i, cat in enumerate(cats):
                v = CAT[cat][f"{pre}{c[1]}"]
                ax.bar(i + (j - 1.5) * w, v, w * 0.92, color=CONDC[c], label=c if i == 0 else None)
                ax.text(i + (j - 1.5) * w, v + 0.01, num(v, lang, 2)[1:] if v < 1 else "1", ha="center", fontsize=7, color=INK)
        ax.set_ylim(0.6, 1.1); ax.set_ylabel("F1"); ax.set_title(t[mod], loc="left", fontsize=11, fontweight="bold")
    axs[0].legend(frameon=False, fontsize=9, ncol=4, loc="upper right")
    axs[1].set_xticks(range(len(cats))); axs[1].set_xticklabels([CATN[lang][c] for c in cats], fontsize=9)
    fig.suptitle(t["t_cat"], x=0.01, ha="left", fontsize=12, fontweight="bold", y=0.98)
    fig.text(0.01, 0.0, ("Eixo começa em 0,6. Ruído e idêntico: 1,00 em todas as condições, inclusive no A0." if lang == "pt" else "Axis starts at 0.6. Noise and identical: 1.00 in every condition, including A0."), fontsize=8.6, color=MUT)
    salva(fig, "fig-t3-categorias", lang)


# ---------- 7. escada (guia) ----------
def fig_escada(lang):
    t = T[lang]; fig, ax = plt.subplots(figsize=(9.5, 4.0)); w = 0.26
    for g_i, tk in enumerate(("T1", "T2")):
        for j, c in enumerate(("A0", "A1", "A3")):
            v = MEDIA[("haiku", tk, c)]
            ax.bar(g_i + (j - 1) * w * 1.08, 100 * v, w, color=CONDC[c], label=t[c] if g_i == 0 else None)
            ax.text(g_i + (j - 1) * w * 1.08, 100 * v + 1.5, f"{100 * v:.0f}%", ha="center", fontsize=13, fontweight="bold", color=INK)
    ax.set_xticks([0, 1]); ax.set_xticklabels([t["T1"], t["T2"]], fontsize=11); ax.set_ylim(0, 118); ax.set_yticks([]); ax.spines["left"].set_visible(False)
    ax.legend(frameon=False, fontsize=9.5, ncol=3, loc="upper center", bbox_to_anchor=(0.5, 1.0))
    ax.set_title(t["t_esc"] + (" (Haiku 5.5)" if True else ""), loc="left", fontsize=12, fontweight="bold", pad=22)
    salva(fig, "fig-escada", lang)


# ---------- 8. receita (guia) ----------
def fig_receita(lang):
    pt = lang == "pt"
    steps = ["Escreva as regras da tela\ncom fonte aberta\n(WCAG, Material)" if pt else "Write the screen's rules\nfrom open sources\n(WCAG, Material)",
             "Ponha as regras no prompt\n(foi o maior ganho)" if pt else "Put the rules in the prompt\n(the biggest gain)",
             "Deixe um código mínimo\nchecar o que o modelo gerou" if pt else "Let minimal code check\nwhat the model produced",
             "Peça correções em trechos,\nnão o arquivo inteiro" if pt else "Ask for patches,\nnot the whole file",
             "Meça com uma checagem\nindependente, não com\na própria régua" if pt else "Measure with an independent\ncheck, not with\nyour own ruler"]
    fig, ax = plt.subplots(figsize=(11.5, 2.7)); ax.set_xlim(0, 11.5); ax.set_ylim(0, 2.7); ax.axis("off")
    for i, s in enumerate(steps):
        x = 0.05 + i * 2.3
        box(ax, x, 0.2, 2.1, 2.3, "#eef4f4", "#bcd3d4")
        ax.text(x + 1.05, 2.05, str(i + 1), ha="center", va="center", fontsize=18, fontweight="bold", color=COL["gold"])
        ax.text(x + 1.05, 1.05, s, ha="center", va="center", fontsize=9.2, color=INK, linespacing=1.4)
    salva(fig, "fig-receita", lang)


# ---------- 9. axe ----------
def fig_axe(lang):
    t = T[lang]; conds = ["A0", "A1", "A2", "A3", "AC"]; w = 0.38
    fig, ax = plt.subplots(figsize=(9.5, 3.9))
    for i, c in enumerate(conds):
        for j, m in enumerate(("haiku", "sonnet")):
            if (m, c) not in AXEM: continue
            v = AXEM[(m, c)]
            ax.bar(i + (j - 0.5) * w, v, w * 0.94, color=CONDC[c] if m == "haiku" else COL["son"], alpha=1 if m == "haiku" else 0.55, edgecolor=CONDC[c] if m == "haiku" else COL["son"])
            ax.text(i + (j - 0.5) * w, v + 0.012, num(v, lang, 2), ha="center", fontsize=9, color=INK)
    ax.set_xticks(range(5)); ax.set_xticklabels([f"{c}\n{t[c]}" for c in conds], fontsize=8.2); ax.set_ylabel("violações / tela" if lang == "pt" else "violations / screen")
    h = [matplotlib.patches.Patch(fc=COL["none"], label=t["haiku"]), matplotlib.patches.Patch(fc=COL["son"], alpha=0.55, label=t["sonnet"] + (" (sem AC)" if lang == "pt" else " (no AC)"))]
    ax.legend(handles=h, frameon=False, fontsize=9, loc="upper right")
    ax.set_title(t["t_axe"], loc="left", fontsize=12, fontweight="bold")
    salva(fig, "fig-axe", lang)


if __name__ == "__main__":
    print("verificação:", {"axe haiku": {c: round(AXEM[("haiku", c)], 2) for c in ["A0", "A1", "A2", "A3", "AC"]}, "estetica": EST, "wiser": (WACC, round(WLO, 3), round(WHI, 3), WCONS),
                           "itens": NITENS, "razoes": (RAZ_AC, RAZ_CU)})
    for lang in ("pt", "en"):
        for f in (fig_metodo, fig_acerto, fig_custo, fig_hipoteses, fig_estetica, fig_t3, fig_escada, fig_receita, fig_axe):
            f(lang)
    print(sorted(p.name for p in OUT.glob("*-pt.png")))
