#!/usr/bin/env python3
"""Análise pré-registrada do estudo haiku-sdd-producao (regras-de-decisao.md + adendo 1).

Uso:  python analise/analise.py            -> grava dados/processado/analise.json e analise.md
Entradas (somente leitura): dados/bruto/<id>/{concluida,score}.json, execucoes.jsonl, juizes.jsonl, mapa-cego.json
Semente fixa (20261106). Nenhum dado é editado; a saída registra o commit do script e a hora.
Escopo: fases A e B. A fase C (H2, H7, H8, H9, S8-S11) foi adiada para um paper futuro (status "não testada").
"""
import json
import math
import random
import statistics as st
import subprocess
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BRUTO = ROOT / "dados" / "bruto"
PROC = ROOT / "dados" / "processado"
SEED = 20261106
ESTENDIDA = "--estendida" in sys.argv  # adendo 2: todas as execucoes e todos os julgamentos; sem a flag, so o conjunto primario pre-registrado
SUF = "-estendida" if ESTENDIDA else ""
NBOOT = 10000
NPERM = 10000
Z = {0.05: 1.6449, 0.025: 1.9600}  # unilateral


def feature(variante):
    return "-".join(variante.split("-")[:2])


# ---------- carga ----------
def carrega():
    runs = {}
    plano_orig = {p["id"] for p in json.loads((BRUTO / "plano-execucoes.json").read_text(encoding="utf-8"))}
    for c in BRUTO.glob("*/concluida.json"):
        rid = c.parent.name
        if rid.startswith("mini-") or (not ESTENDIDA and rid not in plano_orig):
            continue
        m = json.loads(c.read_text(encoding="utf-8"))
        s = json.loads((c.parent / "score.json").read_text(encoding="utf-8"))
        runs[rid] = {"id": rid, "cond": m["condicao"], "var": m["variante"], "feat": feature(m["variante"]),
                     "rep": int(rid.rsplit("-r", 1)[1]), "doc": m["documentos"], "nucleo_100": bool(s["nucleo_100"]),
                     "frac": s["passaram"] / s["total"] if s.get("total") else None, "limpa": m.get("auditoria_limpa"),
                     "custo": 0.0, "tok": 0, "novos": 0, "maior": 0, "escalou": bool(m["documentos"].get("escalonou_codigo")) or any(isinstance(d, dict) and d.get("escalonou") for d in m["documentos"].values())}
    ex = BRUTO / "execucoes.jsonl"
    for l in open(ex, encoding="utf-8"):
        r = json.loads(l)
        if r["id"] in runs and not r.get("falha_infra"):
            u = runs[r["id"]]
            u["custo"] += r.get("custo_usd_lista") or 0
            u["tok"] += r.get("tokens_totais") or 0
            u["novos"] += r.get("tokens_novos") or 0
            u["maior"] = max(u["maior"], r.get("maior_prompt") or 0)
    return runs


# ---------- estatística ----------
def wilson(k, n, z):
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def newcombe(k1, n1, k0, n0, z):
    """IC (unilateral por z) da diferença p1 - p0, método 10 de Newcombe (score de Wilson)."""
    l1, u1 = wilson(k1, n1, z)
    l0, u0 = wilson(k0, n0, z)
    d = k1 / n1 - k0 / n0
    return d, d - math.sqrt((k1 / n1 - l1) ** 2 + (u0 - k0 / n0) ** 2), d + math.sqrt((u1 - k1 / n1) ** 2 + (k0 / n0 - l0) ** 2)


def boot_ratio(a, b, key, rnd):
    """Razão das médias a/b com bootstrap estratificado por feature. a, b: listas de dicts com 'feat' e key."""
    def razao(xa, xb):
        mb = st.mean(xb)
        return st.mean(xa) / mb if mb else float("nan")
    pa, pb = defaultdict(list), defaultdict(list)
    for r in a:
        pa[r["feat"]].append(r[key])
    for r in b:
        pb[r["feat"]].append(r[key])
    pt = razao([v for x in pa.values() for v in x], [v for x in pb.values() for v in x])
    out = []
    for _ in range(NBOOT):
        xa = [rnd.choice(v) for v in pa.values() for _ in v]
        xb = [rnd.choice(v) for v in pb.values() for _ in v]
        out.append(razao(xa, xb))
    out.sort()
    return pt, out[int(0.025 * NBOOT)], out[int(0.975 * NBOOT)], out[int(0.05 * NBOOT)]


def estrat_diff(a, b, estr):
    """Diferença média ponderada por estrato (peso = n_total do estrato). a, b: dict estrato -> lista."""
    num = den = 0
    for s in estr:
        if a.get(s) and b.get(s):
            w = len(a[s]) + len(b[s])
            num += w * (st.mean(a[s]) - st.mean(b[s]))
            den += w
    return num / den if den else float("nan")


def perm_boot_diff(a, b, rnd):
    """a, b: dict feature -> lista de somas por artefato. Devolve diferença, IC95 bilateral, limite inferior unilateral 97,5%, p unilateral (H1: a>b)."""
    estr = [s for s in a if s in b and a[s] and b[s]]
    obs = estrat_diff(a, b, estr)
    boots = []
    for _ in range(NBOOT):
        ra = {s: [rnd.choice(a[s]) for _ in a[s]] for s in estr}
        rb = {s: [rnd.choice(b[s]) for _ in b[s]] for s in estr}
        boots.append(estrat_diff(ra, rb, estr))
    boots.sort()
    cnt = 0
    for _ in range(NPERM):
        pa, pb = {}, {}
        for s in estr:
            junta = a[s] + b[s]
            rnd.shuffle(junta)
            pa[s], pb[s] = junta[:len(a[s])], junta[len(a[s]):]
        if estrat_diff(pa, pb, estr) >= obs - 1e-12:
            cnt += 1
    return {"diferenca": obs, "ic95": [boots[int(0.025 * NBOOT)], boots[int(0.975 * NBOOT)]],
            "lim_inf_97_5": boots[int(0.025 * NBOOT)], "lim_inf_95": boots[int(0.05 * NBOOT)],
            "p_unilateral": (cnt + 1) / (NPERM + 1), "n": {s: [len(a[s]), len(b[s])] for s in estr}}


def krippendorff_interval(unidades):
    """unidades: lista de listas de notas (uma lista por unidade, um valor por juiz). Alfa com métrica de intervalo."""
    un = [u for u in unidades if len(u) >= 2]
    n = sum(len(u) for u in un)
    if n <= 1:
        return None
    do = sum(sum((x - y) ** 2 for i, x in enumerate(u) for j, y in enumerate(u) if i != j) / (len(u) - 1) for u in un) / n
    todos = [x for u in un for x in u]
    de = sum((x - y) ** 2 for i, x in enumerate(todos) for j, y in enumerate(todos) if i != j) / (n * (n - 1))
    return 1 - do / de if de else None


# ---------- rubrica ----------
def carrega_rubrica():
    mapa_p = BRUTO / "mapa-cego.json"
    notas_p = BRUTO / "juizes.jsonl"
    if not (mapa_p.exists() and notas_p.exists()):
        return None
    mapa = json.loads(mapa_p.read_text(encoding="utf-8"))
    por = defaultdict(list)
    for l in open(notas_p, encoding="utf-8"):
        r = json.loads(l)
        if "criterios" in r:
            por[r["codigo"]].append(r)
    art = {}
    orig = set((BRUTO / "ids-juizes.txt").read_text(encoding="utf-8").split())
    for cod, js in por.items():
        v = mapa[cod]
        js = [j for j in js if j["juiz"] <= 3]  # adendo 2b: 3 juizes por artefato
        alvo = orig if not ESTENDIDA else set((BRUTO / "ids-julgar-total.txt").read_text(encoding="utf-8").split())
        if v["id"] not in alvo or len(js) < 3:
            continue
        art[(v["id"], v["tipo"])] = {"cond": v["condicao"], "var": v["variante"], "feat": feature(v["variante"]),
                                      "soma": st.mean(sum(j["criterios"].values()) for j in js), "n_juizes": len(js),
                                      "aluc": st.mean(j.get("alucinacoes", 0) for j in js),
                                      "itens": [[j["criterios"][k] for j in js] for k in js[0]["criterios"]]}
    return art


def por_cond_tipo(art, tipo, cond):
    d = defaultdict(list)
    for (rid, t), a in art.items():
        if t == tipo and a["cond"] == cond:
            d[a["feat"]].append(a["soma"])
    return d


# ---------- principal ----------
def main():
    rnd = random.Random(SEED)
    runs = carrega()
    R = lambda c: [r for r in runs.values() if r["cond"] == c]
    out = {"gerado": datetime.now().isoformat(timespec="seconds"), "n_execucoes": len(runs),
           "por_condicao": {}, "hipoteses": {}}
    try:
        out["commit_script"] = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip() or None
    except Exception:
        out["commit_script"] = None

    for c in sorted({r["cond"] for r in runs.values()}):
        rs = R(c)
        out["por_condicao"][c] = {"n": len(rs), "nucleo_100": sum(r["nucleo_100"] for r in rs),
                                  "fracao_testes_media": round(st.mean(r["frac"] for r in rs if r["frac"] is not None), 4),
                                  "tokens_totais_media": round(st.mean(r["tok"] for r in rs)),
                                  "tokens_novos_media": round(st.mean(r["novos"] for r in rs)),
                                  "custo_lista_medio_usd": round(st.mean(r["custo"] for r in rs), 4),
                                  "acessos_suspeitos": sum(1 for r in rs if r["limpa"] is False),
                                  "maior_prompt_max": max(r["maior"] for r in rs)}

    # gate: taxa de reprovação no primeiro gate (fase A, condições com gate: C2, C2n, C4, C5, C6)
    docs = [d for r in runs.values() if r["cond"] in ("C2", "C4", "C5", "C6") for d in r["doc"].values() if isinstance(d, dict) and "gate_primeira_tentativa" in d]
    rep = sum(1 for d in docs if d.get("gate_primeira_tentativa") is False)
    out["gate"] = {"documentos": len(docs), "reprovados_1o_gate": rep, "taxa": round(rep / len(docs), 4) if docs else None,
                   "regra_testabilidade_H3": "taxa >= 10%"}

    # H4
    c0, c4, c1 = R("C0"), R("C4"), R("C1")
    k0, k4, k1 = (sum(r["nucleo_100"] for r in x) for x in (c0, c4, c1))
    h4 = {"C0": [k0, len(c0)], "C4": [k4, len(c4)], "C1": [k1, len(c1)]}
    if c0 and c4:
        d, lo, hi = newcombe(k4, len(c4), k0, len(c0), Z[0.025])
        _, lo2, hi2 = newcombe(k4, len(c4), k0, len(c0), Z[0.05])
        h4.update({"diferenca": d, "newcombe_unilateral_97_5": [lo, hi], "newcombe_unilateral_95": [lo2, hi2]})
        sensivel = (k1 < len(c1)) or (k0 < len(c0)) or (k4 < len(c4))
        if hi < -0.10:
            st4 = "refutada"
        elif lo >= -0.10 and sensivel:
            st4 = "equivalente (não inferioridade)"
        elif lo >= -0.10:
            st4 = "não informativa (saturação)"
        else:
            st4 = "subpotente"
        h4["instrumento_sensivel"] = sensivel
        h4["status"] = st4
        h4["sensibilidade_fracao_de_testes"] = {c: out["por_condicao"][c]["fracao_testes_media"] for c in ("C0", "C1", "C4")}
    out["hipoteses"]["H4"] = h4

    # H6 (descritiva)
    h6 = {}
    if c0 and c4:
        for chave, nome in (("custo", "custo_lista"), ("tok", "tokens_totais"), ("novos", "tokens_novos")):
            pt, lo, hi, _ = boot_ratio(c4, c0, chave, rnd)
            h6[nome] = {"razao_C4_sobre_C0": pt, "ic95": [lo, hi]}
        h6["razao_C1_sobre_C0"] = {nome: boot_ratio(c1, c0, ch, rnd)[0] for ch, nome in (("custo", "custo_lista"), ("tok", "tokens_totais"), ("novos", "tokens_novos"))}
    out["hipoteses"]["H6"] = {"status": "descritiva", **h6}

    # Rubrica
    art = carrega_rubrica()
    if art:
        sumn = defaultdict(int)
        for (rid, t), a in art.items():
            sumn[(a["cond"], t)] += 1
        out["rubrica"] = {"artefatos_julgados": {f"{c}/{t}": n for (c, t), n in sorted(sumn.items())}}
        itens = [u for a in art.values() for u in a["itens"]]
        out["rubrica"]["krippendorff_alfa_intervalo"] = krippendorff_interval(itens)
        out["rubrica"]["alucinacoes_media"] = {c: round(st.mean(a["aluc"] for a in art.values() if a["cond"] == c), 3) for c in sorted({a["cond"] for a in art.values()})}

        def contraste(cond_a, cond_b, minimo, nome):
            res = {}
            for tipo in ("techspec", "tasks"):
                a, b = por_cond_tipo(art, tipo, cond_a), por_cond_tipo(art, tipo, cond_b)
                if not any(a.values()) or not any(b.values()):
                    res[tipo] = {"status": "sem dados"}
                    continue
                r = perm_boot_diff(a, b, rnd)
                r["limiar_pontos"] = minimo
                r["status"] = "confirmada" if r["lim_inf_97_5"] >= minimo else "não confirmada"
                res[tipo] = r
            return res

        out["hipoteses"]["H1"] = contraste("C0", "C1", 3, "Sonnet menos Haiku simples")
        if out["gate"]["taxa"] is not None and out["gate"]["taxa"] >= 0.10:
            out["hipoteses"]["H3"] = contraste("C2", "C1", 3, "gate+loop menos simples")
        else:
            out["hipoteses"]["H3"] = {"status": "não testável neste desenho", "motivo": "taxa de reprovação no primeiro gate < 10%", "taxa": out["gate"]["taxa"]}
        for cx in ("C10", "C11", "C12"):
            if any(a["cond"] == cx for a in art.values()):
                out["hipoteses"].setdefault("H11", {})[cx] = contraste(cx, "C1", 3, f"{cx} menos C1")
        if any(a["cond"] == "C13" for a in art.values()):
            out["hipoteses"].setdefault("H11", {})["controle_C13"] = contraste("C13", "C1", 2, "C13 menos C1")
        # H5 (a): razão de qualidade cascata/Sonnet; (b) custo de lista
        h5 = {}
        for tipo in ("techspec", "tasks"):
            a = [{"feat": f, "v": v} for f, vs in por_cond_tipo(art, tipo, "C5").items() for v in vs]
            b = [{"feat": f, "v": v} for f, vs in por_cond_tipo(art, tipo, "C0").items() for v in vs]
            if a and b:
                pt, lo, hi, lo95 = boot_ratio(a, b, "v", rnd)
                h5[f"qualidade_{tipo}"] = {"razao": pt, "ic95": [lo, hi], "lim_inf_97_5": lo}
        c5 = R("C5")
        if c5 and c0:
            pt, lo, hi, _ = boot_ratio(c5, c0, "custo", rnd)
            h5["custo_lista"] = {"razao_C5_sobre_C0": pt, "ic95": [lo, hi]}
            h5["taxa_escalonamento"] = round(sum(r["escalou"] for r in c5) / len(c5), 4)
            q_ok = all(v["lim_inf_97_5"] >= 0.90 for k, v in h5.items() if k.startswith("qualidade_")) and any(k.startswith("qualidade_") for k in h5)
            h5["status"] = "confirmada" if q_ok and pt <= 0.50 else "não confirmada"
            if h5.get("taxa_escalonamento", 0) == 0:
                h5["observacao"] = "a cascata não escalou nenhuma vez: C5 equivale a C1 e o escalonamento não foi testado (não testável neste desenho)"
        out["hipoteses"]["H5"] = h5
        # H10 (se houver C6)
        if R("C6"):
            h10 = {}
            for tipo in ("techspec", "tasks"):
                a = [{"feat": f, "v": v} for f, vs in por_cond_tipo(art, tipo, "C6").items() for v in vs]
                b = [{"feat": f, "v": v} for f, vs in por_cond_tipo(art, tipo, "C5").items() for v in vs]
                if a and b:
                    pt, lo, hi, _ = boot_ratio(a, b, "v", rnd)
                    h10[f"qualidade_{tipo}"] = {"razao_C6_sobre_C5": pt, "ic95": [lo, hi]}
            pt, lo, hi, _ = boot_ratio(R("C6"), R("C5"), "custo", rnd)
            h10["custo_lista"] = {"razao_C6_sobre_C5": pt, "ic95": [lo, hi]}
            out["hipoteses"]["H10"] = h10
    else:
        out["rubrica"] = "juízes ainda não rodaram"

    for h in ("H2", "H7", "H8", "H9"):
        out["hipoteses"][h] = {"status": "não testada", "motivo": "fase C adiada para um paper futuro (decisão do autor, 06/11/2026)"}

    PROC.mkdir(parents=True, exist_ok=True)
    (PROC / f"analise{SUF}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    md = ["# Resultado da análise pré-registrada", f"Gerado em {out['gerado']} (commit do script: {out['commit_script']}). {out['n_execucoes']} execuções.", "",
          "| Condição | n | núcleo 100% | frac. de testes | tokens totais | tokens novos | custo lista (US$) | suspeitas |", "|---|---|---|---|---|---|---|---|"]
    for c, v in out["por_condicao"].items():
        md.append(f"| {c} | {v['n']} | {v['nucleo_100']} | {v['fracao_testes_media']} | {v['tokens_totais_media']:,} | {v['tokens_novos_media']:,} | {v['custo_lista_medio_usd']} | {v['acessos_suspeitos']} |")
    md += ["", "```json", json.dumps({"gate": out["gate"], "hipoteses": out["hipoteses"], "rubrica": out["rubrica"]}, ensure_ascii=False, indent=1), "```"]
    (PROC / f"analise{SUF}.md").write_text("\n".join(md), encoding="utf-8")
    print("\n".join(md[:30]))


if __name__ == "__main__":
    sys.exit(main())
