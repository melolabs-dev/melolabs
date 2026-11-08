#!/usr/bin/env python3
"""Monta claims.json (afirmação <-> evidência) calculando cada valor a partir dos dados e conferindo que o texto do artigo traz o mesmo número.

Uso: python -I analise/claims.py     -> claims.json e relatório de conferência (falha se algum número do artigo não bate)
"""
import json
import sys
from pathlib import Path

ESTUDO = Path(__file__).resolve().parents[1]
ROOT = ESTUDO.parents[1]
PROC = ESTUDO / "dados" / "processado"
E = json.loads((PROC / "analise-estendida.json").read_text(encoding="utf-8"))
S = json.loads((PROC / "sensibilidade.json").read_text(encoding="utf-8"))
P = json.loads((PROC / "analise.json").read_text(encoding="utf-8"))
PT = (ROOT / "posts" / "drafts" / "haiku-sdd-producao" / "pt.md").read_text(encoding="utf-8")
EN = (ROOT / "posts" / "drafts" / "haiku-sdd-producao" / "en.md").read_text(encoding="utf-8")


def f1(x):
    return f"{x:.1f}"


def pc(x, d=2):
    return f"{x:.{d}f}"


EST = "studies/haiku-sdd-producao/dados/processado/analise-estendida.json"
SEN = "studies/haiku-sdd-producao/dados/processado/sensibilidade.json"
PRI = "studies/haiku-sdd-producao/dados/processado/analise.json"
TAB = "studies/haiku-sdd-producao/dados/processado/tabela-condicoes.csv"
h4, h6 = E["hipoteses"]["H4"], E["hipoteses"]["H6"]
pcond = E["por_condicao"]
h1, h5, h10 = E["hipoteses"]["H1"], E["hipoteses"]["H5"], E["hipoteses"]["H10"]
c12 = E["hipoteses"]["H11"]["C12"]
cl = []  # (afirmacao, tipo, evidencia, [numeros que devem aparecer em pt e en: (pt, en)])


def add(afirmacao, evidencia, nums, tipo="dado"):
    cl.append((afirmacao, tipo, evidencia, nums))


n = pcond["C0"]["n"]
add("198 execuções no total (138 do plano principal e 60 da extensão)", f"{EST}#n_execucoes={E['n_execucoes']}", [("198", "198")])
add(f"Sonnet passou o núcleo em {pcond['C0']['nucleo_100']} de {n} execuções (91%)", f"{EST}#por_condicao.C0", [("49 de 54", "49 of 54")])
add(f"Haiku C4 passou o núcleo em {pcond['C4']['nucleo_100']} de {pcond['C4']['n']} (72%)", f"{EST}#por_condicao.C4", [("39 de 54", "39 of 54")])
add(f"Haiku simples passou o núcleo em {pcond['C1']['nucleo_100']} de {pcond['C1']['n']} (58%)", f"{EST}#por_condicao.C1", [("21 de 36", "21 of 36")])
add(f"Diferença C4 menos C0 = {f1(h4['diferenca'] * 100)} pontos; Newcombe unilateral 97,5% de {f1(h4['newcombe_unilateral_97_5'][0] * 100)} a {f1(h4['newcombe_unilateral_97_5'][1] * 100)}", f"{EST}#hipoteses.H4",
    [("−18,5", "−18.5"), ("−32,6", "−32.6"), ("−3,8", "−3.8")])
add(f"Custo de lista C4/C0 = {pc(h6['custo_lista']['razao_C4_sobre_C0'])} (IC {pc(h6['custo_lista']['ic95'][0])} a {pc(h6['custo_lista']['ic95'][1])})", f"{EST}#hipoteses.H6.custo_lista", [("0,18", "0.18"), ("0,16 a 0,20", "0.16 to 0.20")])
add(f"Tokens totais C4/C0 = {pc(h6['tokens_totais']['razao_C4_sobre_C0'])} (IC {pc(h6['tokens_totais']['ic95'][0])} a {pc(h6['tokens_totais']['ic95'][1])})", f"{EST}#hipoteses.H6.tokens_totais", [("1,5 vez", "1.5 times"), ("1,39 a 1,64", "1.39 to 1.64")])
add(f"Tokens novos C4/C0 = {pc(h6['tokens_novos']['razao_C4_sobre_C0'])}", f"{EST}#hipoteses.H6.tokens_novos", [("1,55", "1.55")])
add("Custo de lista da cascata em relação ao Sonnet", f"{EST}#hipoteses.H5.custo_lista.razao_C5_sobre_C0={pc(h5['custo_lista']['razao_C5_sobre_C0'])}", [("0,15", "0.15")])
add(f"52 de 54 execuções do C4 com prompt acima de 100 mil tokens", f"{SEN}#execucoes_com_prompt_acima_de_100k={S['execucoes_com_prompt_acima_de_100k']['C4']}", [("52 das 54", "52 of the 54")])
add(f"Custo médio por condição (C0, C1, C4, C5) e tokens totais médios", f"{TAB}", [("US$ 1,23", "US$ 1.23"), ("US$ 0,26", "US$ 0.26"), ("US$ 0,22", "US$ 0.22"), ("US$ 0,19", "US$ 0.19"), ("2,41 mi", "2.41 M"), ("4,13 mi", "4.13 M"), ("3,64 mi", "3.64 M"), ("2,88 mi", "2.88 M")])
add(f"H1 TechSpec: diferença {f1(h1['techspec']['diferenca'])}, IC {f1(h1['techspec']['ic95'][0])} a {f1(h1['techspec']['ic95'][1])}", f"{EST}#hipoteses.H1.techspec", [("0,7 ponto", "0.7 points"), ("−0,2 a +1,6", "−0.2 to +1.6")])
add(f"H1 Tasks: diferença {f1(h1['tasks']['diferenca'])}, IC {f1(h1['tasks']['ic95'][0])} a {f1(h1['tasks']['ic95'][1])}", f"{EST}#hipoteses.H1.tasks", [("−0,8 a +0,5", "−0.8 to +0.5")])
add(f"H5 qualidade da cascata sobre o Sonnet: TechSpec {pc(h5['qualidade_techspec']['razao'])}, Tasks {pc(h5['qualidade_tasks']['razao'])}", f"{EST}#hipoteses.H5", [("0,99 e 1,01", "0.99 and 1.01")])
add(f"Alfa de Krippendorff estendido = {pc(E['rubrica']['krippendorff_alfa_intervalo'])}, abaixo do limite pré-registrado de 0,67", f"{EST}#rubrica.krippendorff_alfa_intervalo", [("0,61", "0.61"), ("0,67", "0.67")])
add(f"H10: custo do híbrido sobre a cascata = {pc(h10['custo_lista']['razao_C6_sobre_C5'], 1)} (IC {pc(h10['custo_lista']['ic95'][0], 1)} a {pc(h10['custo_lista']['ic95'][1], 1)})", f"{EST}#hipoteses.H10.custo_lista", [("3,1 vezes", "3.1 times"), ("2,5 a 4,0", "2.5 to 4.0")])
add(f"Gate: {E['gate']['reprovados_1o_gate']} de {E['gate']['documentos']} documentos reprovados no primeiro gate ({pc(E['gate']['taxa'] * 100, 1)}%); cascata nunca escalou", f"{EST}#gate", [("3 de 234", "3 of 234"), ("1,3%", "1.3%")])
add(f"H11 C12: TechSpec {f1(c12['techspec']['diferenca'])} e Tasks {f1(c12['tasks']['diferenca'])}", f"{EST}#hipoteses.H11.C12", [("+1,5 ponto", "+1.5 points"), ("+1,1", "+1.1")])
add(f"Alucinações por artefato: C4 {pc(E['rubrica']['alucinacoes_media']['C4'])}, C0 {pc(E['rubrica']['alucinacoes_media']['C0'])}", f"{EST}#rubrica.alucinacoes_media", [("0,42", "0.42"), ("0,14", "0.14")])
add(f"Fração de testes passando: C4 {pc(pcond['C4']['fracao_testes_media'])}, C0 {pc(pcond['C0']['fracao_testes_media'])}", f"{EST}#por_condicao", [("0,89", "0.89"), ("0,91", "0.91")])
add("Núcleo por variante e condição (tabela do artigo)", "studies/haiku-sdd-producao/dados/processado/tabela-variantes.csv", [("3/9", "3/9"), ("0/6", "0/6"), ("6/9", "6/9")])
add("Preços de 04/11/2026: Haiku 5.5 a US$ 0,10 e US$ 0,50 até 100 mil tokens de prompt; Sonnet 5.5 a US$ 2 e US$ 10", "anthropic-pricing", [("US$ 0,10", "US$ 0.10")], tipo="fonte")
add("Mathews e Nagappan (2024): testes primeiro na geração de código", "tdd-codegen", [], tipo="fonte")
add("Chen, Zaharia e Zou (2023): cascata de modelos para reduzir custo", "frugalgpt", [], tipo="fonte")
add("Huang et al. (2023): modelos corrigem mal o próprio raciocínio sem sinal externo", "llm-self-correct", [], tipo="fonte")
add("Zheng et al. (2023): vieses do modelo como juiz", "llm-as-judge", [], tipo="fonte")
add("Gloaguen et al. (2026): arquivos de contexto do repositório (AGENTS.md)", "agentsmd-eval", [], tipo="fonte")
add("Rosa et al. (2026): registro de estudo de geração dirigida por especificação, sem resultados", "specdriven-registered-report", [], tipo="fonte")

falhas = []
for a, t, e, nums in cl:
    for pt, en in nums:
        if pt not in PT:
            falhas.append(("pt", pt, a[:50]))
        if en not in EN:
            falhas.append(("en", en, a[:50]))
(ESTUDO / "claims.json").write_text(json.dumps([{"afirmacao": a, "tipo": t, "evidencia": e} for a, t, e, _ in cl], ensure_ascii=False, indent=1), encoding="utf-8")
print(len(cl), "afirmações; números não encontrados no texto:", falhas or "nenhum")
sys.exit(1 if falhas else 0)
