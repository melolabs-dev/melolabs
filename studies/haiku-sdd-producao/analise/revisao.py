#!/usr/bin/env python3
"""Análises pedidas pela revisão adversarial (F7.4). EXPLORATÓRIAS: não alteram vereditos pré-registrados.

Uso: python -I analise/revisao.py -> dados/processado/revisao.json e .md  (usa o conjunto estendido)
"""
import json
import math
import random
import re
import statistics as st
import sys
from collections import defaultdict
from pathlib import Path

sys.argv.append("--estendida")
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import analise as A  # noqa: E402

ESTUDO = A.ROOT
CLASS = json.loads((ESTUDO / "gabarito" / "classificacao.json").read_text(encoding="utf-8"))["observacao"]
T975 = {2: 4.303, 5: 2.571}  # t bilateral 95% (gl 2 e 5)


def codigo(nome):
    m = re.search(r"\b([PERSO]\d+)\b", nome.split("::", 1)[-1])
    return m.group(1) if m else None


def nucleo_sem(runs, cod_extra):
    """Núcleo recontado tratando os códigos de cod_extra (por variante) como observação."""
    res = {}
    for rid, r in runs.items():
        s = json.loads((A.BRUTO / rid / "score.json").read_text(encoding="utf-8"))
        obs = set(CLASS[r["var"]]) | set(cod_extra.get(r["var"], ()))
        por = defaultdict(lambda: True)
        for nome, st_ in s["testes"].items():
            c = codigo(nome)
            if c is None or c in obs:
                continue
            por[c] = por[c] and st_ == "passed"
        # confere com o núcleo oficial quando não há extras
        base = set(CLASS[r["var"]])
        oficial = all(st_ == "passed" for n, st_ in s["testes"].items() if codigo(n) not in base and codigo(n) is not None)
        res[rid] = (all(por.values()) if por else False, oficial == bool(s["nucleo_100"]), [c for c, ok in por.items() if not ok])
    return res


def ic_t(xs, gl):
    m = st.mean(xs)
    se = st.stdev(xs) / math.sqrt(len(xs))
    return m, m - T975[gl] * se, m + T975[gl] * se


def main():
    runs = A.carrega()
    out = {"rotulo": "EXPLORATÓRIO — respostas à revisão adversarial (F7.4); não substitui a análise pré-registrada"}
    c0, c1, c4 = ([r for r in runs.values() if r["cond"] == c] for c in ("C0", "C1", "C4"))

    # 1. deficit do código: quais testes explicam as falhas do núcleo
    base = nucleo_sem(runs, {})
    out["conferencia_recontagem_igual_ao_oficial"] = all(v[1] for v in base.values())
    falhas = {c: defaultdict(int) for c in ("C0", "C1", "C4")}
    for rid, (ok, _, quais) in base.items():
        c = runs[rid]["cond"]
        if c in falhas and not ok:
            for q in quais:
                falhas[c][f"{runs[rid]['feat']}:{q}"] += 1
    out["testes_que_falham_por_condicao"] = {c: dict(sorted(v.items(), key=lambda kv: -kv[1])) for c, v in falhas.items()}
    sem = nucleo_sem(runs, {"problem-1384-a": ["P1"], "problem-1384-b": ["P1"], "problem-1384-c": ["P1"]})
    tab = {}
    for c, rs in (("C0", c0), ("C1", c1), ("C4", c4)):
        tab[c] = [sum(sem[r["id"]][0] for r in rs), len(rs)]
    d, lo, hi = A.newcombe(tab["C4"][0], tab["C4"][1], tab["C0"][0], tab["C0"][1], 1.96)
    out["nucleo_sem_P1_como_observacao"] = {"contagens": tab, "diferenca_C4_menos_C0": d, "newcombe_bilateral_95": [lo, hi],
                                            "nota": "P1 (rota inexistente responde 404 em problem+json) não é pedido pelo contrato enxuto de 1384-a e 1384-c; classificação nucleo/observacao foi do autor (adendo 1)"}

    # 2. unidade de generalização: variante e feature
    pv = defaultdict(lambda: defaultdict(list))
    for r in runs.values():
        if r["cond"] in ("C0", "C4"):
            pv[r["var"]][r["cond"]].append(r["nucleo_100"])
    dv = {v: round(100 * (st.mean(x["C4"]) - st.mean(x["C0"])), 1) for v, x in sorted(pv.items())}
    out["diferenca_C4_menos_C0_por_variante_pp"] = dv
    m, lo, hi = ic_t(list(dv.values()), 5)
    out["IC_t95_nivel_variante_pp"] = {"media": round(m, 1), "ic": [round(lo, 1), round(hi, 1)], "gl": 5}
    pf = defaultdict(lambda: defaultdict(list))
    for r in runs.values():
        if r["cond"] in ("C0", "C4"):
            pf[r["feat"]][r["cond"]].append(r["nucleo_100"])
    df = {f: round(100 * (st.mean(x["C4"]) - st.mean(x["C0"])), 1) for f, x in sorted(pf.items())}
    out["diferenca_C4_menos_C0_por_feature_pp"] = df
    m, lo, hi = ic_t(list(df.values()), 2)
    out["IC_t95_nivel_feature_pp"] = {"media": round(m, 1), "ic": [round(lo, 1), round(hi, 1)], "gl": 2}

    # 3. custo por núcleo aceito (métrica pré-registrada) e razão por variante
    def cpa(rs):
        k = sum(r["nucleo_100"] for r in rs)
        return (sum(r["custo"] for r in rs) / len(rs)) / (k / len(rs)) if k else float("inf")
    out["custo_por_nucleo_aceito"] = {"C0": round(cpa(c0), 3), "C4": round(cpa(c4), 3), "C1": round(cpa(c1), 3), "razao_C4_C0": round(cpa(c4) / cpa(c0), 3)}
    out["razao_custo_C4_C0_por_variante"] = {v: round(st.mean(r["custo"] for r in c4 if r["var"] == v) / st.mean(r["custo"] for r in c0 if r["var"] == v), 3) for v in sorted(pv)}

    # 4. C12 vs C1 pareado por variante (1267 e 1050-b), permutação dentro de variante
    art = A.carrega_rubrica()
    rnd = random.Random(A.SEED)
    out["C12_pareado"] = {}
    for tipo in ("techspec", "tasks"):
        for ctrl in ("C1", "C13"):
            g = defaultdict(lambda: defaultdict(list))
            for (rid, t), a in art.items():
                if t == tipo and a["cond"] in ("C12", ctrl):
                    g[a["var"]][a["cond"]].append(a["soma"])
            vs = [v for v, x in g.items() if x["C12"] and x[ctrl]]
            if not vs:
                continue

            def est(gg):
                num = den = 0
                for v in vs:
                    w = len(gg[v]["C12"]) + len(gg[v][ctrl])
                    num += w * (st.mean(gg[v]["C12"]) - st.mean(gg[v][ctrl]))
                    den += w
                return num / den
            obs = est(g)
            cnt = 0
            for _ in range(20000):
                gg = {}
                for v in vs:
                    j = g[v]["C12"] + g[v][ctrl]
                    rnd.shuffle(j)
                    gg[v] = {"C12": j[:len(g[v]["C12"])], ctrl: j[len(g[v]["C12"]):]}
                if est(gg) >= obs - 1e-12:
                    cnt += 1
            out["C12_pareado"][f"{tipo}_C12_menos_{ctrl}"] = {"variantes": sorted(vs), "diferenca": round(obs, 2), "p_unilateral_permutacao": round((cnt + 1) / 20001, 4),
                                                              "n": {v: [len(g[v]["C12"]), len(g[v][ctrl])] for v in vs}}

    # 5. confiabilidade: alfa sobre a soma por artefato e Spearman-Brown para a média de 3 juízes
    mapa = json.loads((A.BRUTO / "mapa-cego.json").read_text(encoding="utf-8"))
    por = defaultdict(list)
    alvo = set((A.BRUTO / "ids-julgar-total.txt").read_text(encoding="utf-8").split())
    for l in open(A.BRUTO / "juizes.jsonl", encoding="utf-8"):
        r = json.loads(l)
        if "criterios" in r and r["juiz"] <= 3 and mapa[r["codigo"]]["id"] in alvo:
            por[r["codigo"]].append(r)
    al = {}
    for tipo in ("techspec", "tasks"):
        un = [[sum(j["criterios"].values()) for j in js] for cod, js in por.items() if mapa[cod]["tipo"] == tipo and len(js) == 3]
        a = A.krippendorff_interval(un)
        al[tipo] = {"alfa_soma": round(a, 3), "confiabilidade_media_3_juizes_spearman_brown": round(3 * a / (1 + 2 * a), 3), "artefatos": len(un)}
    out["confiabilidade"] = al

    # 6. alucinações por juiz, artefatos pareados (1267 e 1050-b, repetições 1 a 3, TechSpec)
    pareados = defaultdict(list)
    for cod, js in por.items():
        v = mapa[cod]
        if v["tipo"] == "techspec" and v["variante"] in ("range-1267", "session-1050-b") and int(v["id"].rsplit("-r", 1)[1]) <= 3 and v["condicao"] in ("C0", "C1", "C4", "C5"):
            pareados[v["condicao"]].extend(j.get("alucinacoes", 0) for j in js)
    out["alucinacoes_por_julgamento_pareadas"] = {c: [round(st.mean(x), 2), len(x)] for c, x in sorted(pareados.items())}

    # 7. portões e escalonamento
    out["gate_documentos_por_condicao"] = {}
    for c in ("C2", "C4", "C5", "C6", "C0", "C1"):
        n = k = 0
        for r in runs.values():
            if r["cond"] == c:
                for nome in ("prd", "techspec", "tasks"):
                    d = r["doc"].get(nome)
                    if isinstance(d, dict) and d.get("gate_primeira_tentativa") is not None:
                        n += 1
                        k += 0 if d["gate_primeira_tentativa"] in (True, "ok", "aprovado", "passou") else 1
        out["gate_documentos_por_condicao"][c] = [k, n]
    out["typecheck_ou_lint_falhou_em_alguma_execucao"] = any(not json.loads((A.BRUTO / rid / "score.json").read_text(encoding="utf-8")).get("typecheck_ok", True) or not json.loads((A.BRUTO / rid / "score.json").read_text(encoding="utf-8")).get("lint_ok", True) for rid in runs)

    (A.PROC / "revisao.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    (A.PROC / "revisao.md").write_text("# Respostas à revisão adversarial (F7.4)\n\n```json\n" + json.dumps(out, ensure_ascii=False, indent=1) + "\n```\n", encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
