#!/usr/bin/env python3
"""Análises de sensibilidade e exploratórias (F6.4), rotuladas como tais. Não alteram nenhum veredito pré-registrado.

Uso: python -I analise/sensibilidade.py -> dados/processado/sensibilidade.json e .md
"""
import json
import statistics as st
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import analise as A  # noqa: E402

ROOT = A.ROOT


def tabela_h4(runs, excluir=()):
    out = {}
    for c in ("C0", "C1", "C4"):
        rs = [r for r in runs.values() if r["cond"] == c and r["id"] not in excluir]
        out[c] = [sum(r["nucleo_100"] for r in rs), len(rs)]
    d, lo, hi = A.newcombe(out["C4"][0], out["C4"][1], out["C0"][0], out["C0"][1], A.Z[0.025])
    return {"contagens": out, "diferenca_C4_menos_C0": d, "newcombe_unilateral_97_5": [lo, hi]}


def main():
    runs = A.carrega()
    res = {"rotulo": "EXPLORATÓRIO / SENSIBILIDADE — não substitui a análise pré-registrada"}
    susp = [r["id"] for r in runs.values() if r["limpa"] is False]
    res["execucoes_suspeitas_excluidas"] = susp
    res["H4_principal"] = tabela_h4(runs)
    res["H4_sem_suspeitas"] = tabela_h4(runs, susp)

    # por variante (C0, C1, C4)
    pv = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    for r in runs.values():
        if r["cond"] in ("C0", "C1", "C4"):
            pv[r["var"]][r["cond"]][0] += r["nucleo_100"]
            pv[r["var"]][r["cond"]][1] += 1
    res["H4_por_variante"] = {v: dict(c) for v, c in sorted(pv.items())}

    # só as variantes em que o instrumento discrimina (alguma das três condições falha)
    disc = [v for v, c in pv.items() if any(k < n for k, n in c.values())]
    sub = {r["id"]: r for r in runs.values() if r["var"] in disc}
    res["variantes_que_discriminam"] = sorted(disc)
    res["H4_so_variantes_que_discriminam"] = tabela_h4(sub)

    # C4 contra C1 (o ganho das mitigações)
    c4 = [r for r in runs.values() if r["cond"] == "C4"]
    c1 = [r for r in runs.values() if r["cond"] == "C1"]
    k4, k1 = sum(r["nucleo_100"] for r in c4), sum(r["nucleo_100"] for r in c1)
    d, lo, hi = A.newcombe(k4, len(c4), k1, len(c1), A.Z[0.025])
    res["C4_contra_C1_nucleo_100"] = {"C4": [k4, len(c4)], "C1": [k1, len(c1)], "diferenca": d, "newcombe_bilateral_95": [A.newcombe(k4, len(c4), k1, len(c1), 1.96)[1], A.newcombe(k4, len(c4), k1, len(c1), 1.96)[2]]}

    # maior prompt: execuções que passaram do limite de 100 mil tokens (preço do Haiku sobe)
    res["execucoes_com_prompt_acima_de_100k"] = {c: sum(1 for r in runs.values() if r["cond"] == c and r["maior"] > 100000) for c in ("C0", "C1", "C4")}

    # rubrica: alfa por tipo e alucinações por condição e tipo
    art = A.carrega_rubrica()
    if art:
        for tipo in ("techspec", "tasks"):
            itens = [u for (rid, t), a in art.items() if t == tipo for u in a["itens"]]
            res.setdefault("alfa_por_tipo", {})[tipo] = A.krippendorff_interval(itens)
        al = defaultdict(list)
        for (rid, t), a in art.items():
            al[(a["cond"], t)].append(a["aluc"])
        res["alucinacoes_media_por_condicao_e_tipo"] = {f"{c}/{t}": round(st.mean(v), 3) for (c, t), v in sorted(al.items())}
        res["notas_medias_por_condicao_e_tipo"] = {}
        for tipo in ("techspec", "tasks"):
            for c in sorted({a["cond"] for a in art.values()}):
                v = [a["soma"] for (rid, t), a in art.items() if t == tipo and a["cond"] == c]
                res["notas_medias_por_condicao_e_tipo"][f"{c}/{tipo}"] = round(st.mean(v), 2)

    p = A.PROC
    (p / "sensibilidade.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    (p / "sensibilidade.md").write_text("# Sensibilidade e exploratórias (F6.4)\n\n```json\n" + json.dumps(res, ensure_ascii=False, indent=1) + "\n```\n", encoding="utf-8")
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
