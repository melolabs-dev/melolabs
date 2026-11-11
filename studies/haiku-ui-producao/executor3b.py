#!/usr/bin/env python3
"""Executor do estudo 3b. `claude -p` (assinatura), esforço médio, sem ferramentas e sem internet.
T2 melhorar (defeitos graduados): A0 puro, A1 regras da família, A2 relatório do verificador, A3 ambos.
T4 revisão aberta para produção (rascunho com todas as regras violadas): L0, L25, L50, L100 (lake em níveis de completude),
   D (lake do tamanho cheio mas de outros domínios), R (recuperação BM25 top-12), K (L100 + relatório do verificador).
Regras retidas (dados/estimulos/retidas.json) nunca aparecem em lake, relatório nem prompt.
Retomável. Uso: python executor3b.py --tarefas T4 --conds L0 L50 L100 --modelo haiku --amostras 2 --saida dados/bruto/haiku.jsonl --teto-usd 115
"""
import argparse, json, math, random, re, shutil, subprocess, tempfile, threading, time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

AQUI = Path(__file__).resolve().parent
import os
EST = Path(os.environ["EST3B"]) if os.environ.get("EST3B") else AQUI / "dados" / "estimulos"
LIMPO = Path(tempfile.gettempdir()) / "estudo3b-limpo"
SISTEMA = "Você é um desenvolvedor front-end sênior. Responda exatamente no formato pedido, sem explicações extras."
PRECO = {"haiku": (0.10, 0.50, 0.01), "sonnet": (2.0, 10.0, 0.10), "opus": (4.0, 20.0, 0.20)}
trava = threading.Lock()
GASTO = {"usd": 0.0}
LAKE = {r["id"]: r for r in json.loads((AQUI / "lake" / "lake-ref-v2.json").read_text(encoding="utf-8"))}
RETIDAS = json.loads((EST / "retidas.json").read_text(encoding="utf-8"))
TODAS_RETIDAS = {r for v in RETIDAS.values() for r in v}
POOL = [i for i, r in LAKE.items() if r["elegivel"] and i not in TODAS_RETIDAS]  # o que pode aparecer para o modelo
BRIEF = {
    "painel": "Este é o rascunho do painel de acompanhamento que a equipe de operações vai usar todos os dias.",
    "listagem": "Este é o rascunho da tela de busca e listagem do catálogo que clientes e atendentes vão usar.",
    "formulario": "Este é o rascunho do formulário de cadastro em várias etapas que novos clientes vão preencher.",
    "checkout": "Este é o rascunho da tela de finalização de compra da loja online.",
    "configuracoes": "Este é o rascunho da tela de configurações e perfil da conta.",
    "navegacao": "Este é o rascunho da página inicial do aplicativo, com a navegação principal.",
}
FMT_PATCH = ("Responda apenas com correções em trechos, neste formato (repita o bloco quantas vezes precisar):\n"
             "@@ ANTES\n<trecho exato do código atual, copiado sem alterar>\n@@ DEPOIS\n<trecho novo>\n@@ FIM\n"
             "Cada ANTES deve aparecer uma única vez no código. Não reescreva o arquivo inteiro.")
FMT_DEC = ("\nDepois dos blocos, liste as decisões de UX que você tomou, uma por linha, neste formato exato:\n"
           "@@ DECISOES\n- <decisão em uma frase> | regra: <ID da regra que a motivou, ou NENHUMA>\n@@ FIM")


def custo_nominal(r):
    pi, po, pc = PRECO[r["modelo"]]
    return sum((c["in"] + 1.25 * c["cache_w"]) * pi / 1e6 + c["cache_r"] * pc / 1e6 + c["out"] * po / 1e6 for c in r.get("chamadas", []))


def lista_regras(ids):
    return "\n".join(f"- {i}: {LAKE[i]['regra_final']}" for i in ids)


# ---------- recuperação BM25 ----------
STOP = set("de da do das dos a o as os e em um uma para por com no na nos nas que se ao à é ou como mais sem sobre ser deve devem cada quando entre pelo pela".split())
tok = lambda t: [w for w in re.findall(r"[a-zà-ú0-9]{3,}", t.lower()) if w not in STOP]
DOCS = {i: tok(LAKE[i]["regra_final"] + " " + LAKE[i]["dominio"]) for i in POOL}
DF = Counter(w for d in DOCS.values() for w in set(d))
AVG = sum(len(d) for d in DOCS.values()) / len(DOCS)


def bm25(query, k=12):
    q = Counter(tok(query)); sc = {}
    for i, d in DOCS.items():
        tf = Counter(d); s = 0.0
        for w in q:
            if w in tf:
                idf = math.log(1 + (len(DOCS) - DF[w] + .5) / (DF[w] + .5))
                s += idf * tf[w] * 2.2 / (tf[w] + 1.2 * (.25 + .75 * len(d) / AVG))
        sc[i] = s
    return [i for i, _ in sorted(sc.items(), key=lambda x: -x[1])[:k]]


def texto_visivel(html):
    h = re.sub(r"<(script|style)[\s\S]*?</\1>", " ", html)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", h))[:3000]


def dominios_familia(fam, est):
    return {LAKE[r]["dominio"] for r in est["regras_familia"]}


def regras_visiveis(est, cond, amostra):
    """Devolve a lista de ids de regras mostradas ao modelo nesta célula (ordem estável)."""
    rnd = random.Random(f"{est['id']}|{amostra}|{cond}")
    if cond == "L0":
        return []
    if cond in ("L25", "L50"):
        return sorted(rnd.sample(POOL, round(len(POOL) * int(cond[1:]) / 100)))
    if cond in ("L100", "K"):
        return sorted(POOL)
    if cond == "D":
        dom = dominios_familia(est["familia"], est)
        return sorted(i for i in POOL if LAKE[i]["dominio"] not in dom)
    if cond == "R":
        return bm25(est["familia"] + " " + texto_visivel(est["html"]))
    raise ValueError(cond)


# ---------- chamadas ----------
def verificador_rel(est, html, mostrar):
    r = subprocess.run(["node", str(AQUI / "gerador" / "verificar3b.mjs"), "rel"], input=json.dumps({"familia": est["familia"], "html": html, "mostrar": mostrar}),
                       capture_output=True, text=True, encoding="utf-8", timeout=180)
    if r.returncode:
        raise RuntimeError("verificador falhou: " + r.stderr[:200])
    return r.stdout.strip()


def chamar(modelo, texto, esforco="medium"):
    LIMPO.mkdir(exist_ok=True)
    cmd = [shutil.which("claude.cmd") or shutil.which("claude"), "-p", "--model", modelo, "--effort", esforco, "--output-format", "json",
           "--setting-sources", "project", "--strict-mcp-config", "--no-session-persistence", "--tools", "", "--system-prompt", SISTEMA]
    t0 = time.time()
    r = subprocess.run(cmd, input=texto, capture_output=True, text=True, encoding="utf-8", cwd=LIMPO, timeout=1500)
    d = json.loads(r.stdout); u = d.get("usage", {})
    ent = u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0) + u.get("cache_read_input_tokens", 0)
    if d.get("is_error") or not ent:
        raise RuntimeError("chamada sem uso de tokens: " + str(d.get("result", ""))[:150])
    return {"texto": str(d.get("result", "")), "in": u.get("input_tokens", 0), "cache_w": u.get("cache_creation_input_tokens", 0),
            "cache_r": u.get("cache_read_input_tokens", 0), "out": u.get("output_tokens", 0), "usd": d.get("total_cost_usd"),
            "modelos": list((d.get("modelUsage") or {}).keys()), "seg": round(time.time() - t0, 1)}


def aplicar(html, resposta):
    blocos = re.findall(r"@@ ANTES\n(.*?)\n@@ DEPOIS\n(.*?)\n?@@ FIM", resposta, re.S)
    ok, falha, atual = 0, 0, html
    for a, b in blocos:
        if atual.count(a) == 1:
            atual = atual.replace(a, b); ok += 1
        else:
            falha += 1
    return atual, {"blocos": len(blocos), "aplicados": ok, "falhos": falha}


def decisoes(resposta):
    m = re.search(r"@@ DECISOES\n(.*?)(?:\n@@ FIM|$)", resposta, re.S)
    out = []
    for l in (m.group(1).splitlines() if m else []):
        mm = re.search(r"regra:\s*([A-Z]{2}\d{2}|NENHUMA)", l)
        if l.strip().startswith("-"):
            out.append(mm.group(1) if mm else "?")
    return out


def rodar_t2(modelo, est, cond, amostra):
    H = set(RETIDAS[est["familia"]])
    vis = [r for r in est["regras_familia"] if r not in H] if cond in ("A1", "A2", "A3") else []
    p = "Melhore esta tela para produção: corrija problemas de UX, acessibilidade e consistência.\n\nCódigo atual:\n```html\n" + est["html"] + "```\n"
    if cond in ("A1", "A3"):
        p += "\nRegras de boas práticas desta família de telas (use-as como lista de verificação):\n" + lista_regras(vis) + "\n"
    kit_s = 0.0
    if cond in ("A2", "A3"):
        t0 = time.time(); p += "\n" + verificador_rel(est, est["html"], vis) + "\n"; kit_s = time.time() - t0
    c = chamar(modelo, p + "\n" + FMT_PATCH)
    novo, extra = aplicar(est["html"], c["texto"])
    return {"html_final": novo, "patch": extra, "chamadas": [c], "kit_seg": round(kit_s, 1), "visiveis": vis, "familia": est["familia"]}


def rodar_t4(modelo, est, cond, amostra):
    vis = regras_visiveis(est, cond, amostra)
    p = (BRIEF[est["familia"]] + " O gerente pediu: \"deixa isso pronto para entrar em produção; os usuários têm pressa e usam notebook e celular\". "
         "Não há especificação detalhada: decida você o que precisa mudar para a tela ficar boa de usar, acessível e confiável.\n\nCódigo atual:\n```html\n" + est["html"] + "```\n")
    if vis:
        rot = "Base de conhecimento de UX (regras consolidadas; consulte e use quando ajudar a decidir, ignore o que não servir a esta tela):" if cond != "R" else "Regras de UX recuperadas para esta tela:"
        p += "\n" + rot + "\n" + lista_regras(vis) + "\n"
    kit_s = 0.0
    if cond == "K":
        fam_vis = [r for r in est["regras_familia"] if r in vis]
        t0 = time.time(); p += "\n" + verificador_rel(est, est["html"], fam_vis) + "\n"; kit_s = time.time() - t0
    c = chamar(modelo, p + "\n" + FMT_PATCH + FMT_DEC)
    novo, extra = aplicar(est["html"], c["texto"])
    return {"html_final": novo, "patch": extra, "chamadas": [c], "kit_seg": round(kit_s, 1), "visiveis": vis, "decisoes": decisoes(c["texto"]), "familia": est["familia"]}


TAREFAS = {"T2": ("t2.json", rodar_t2), "T4": ("t4.json", rodar_t4)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tarefas", nargs="+", default=["T4", "T2"])
    ap.add_argument("--conds", nargs="+")
    ap.add_argument("--modelo", default="haiku")
    ap.add_argument("--amostras", type=int, default=2)
    ap.add_argument("--ids", nargs="*")
    ap.add_argument("--saida", required=True)
    ap.add_argument("--paralelo", type=int, default=6)
    ap.add_argument("--esforco", default="medium")
    ap.add_argument("--teto-usd", type=float, default=0.0)
    ap.add_argument("--limite", type=int, default=0, help="máximo de itens (piloto)")
    a = ap.parse_args()
    saida = Path(a.saida); saida.parent.mkdir(parents=True, exist_ok=True)
    feito = set()
    if saida.exists():
        for l in saida.read_text(encoding="utf-8").splitlines():
            r = json.loads(l)
            if "erro" not in r:
                feito.add((r["tarefa"], r["id"], r["cond"], r["modelo"], r["amostra"]))
    if a.teto_usd:
        for f in saida.parent.glob("*.jsonl"):
            for l in f.read_text(encoding="utf-8").splitlines():
                r = json.loads(l)
                if "erro" not in r and r.get("chamadas"):
                    GASTO["usd"] += custo_nominal(r)
        print("gasto nominal acumulado:", round(GASTO["usd"], 2), flush=True)
    padrao = {"T2": ["A0", "A1", "A2", "A3"], "T4": ["L0", "L25", "L50", "L100", "D", "R", "K"]}
    itens = []
    for tk in a.tarefas:
        arq, fn = TAREFAS[tk]
        ests = json.loads((EST / arq).read_text(encoding="utf-8"))
        for est in ests:
            if a.ids and est["id"] not in a.ids:
                continue
            for cond in (a.conds or padrao[tk]):
                if cond not in padrao[tk]:
                    continue
                for s in range(a.amostras):
                    if (tk, est["id"], cond, a.modelo, s) not in feito:
                        itens.append((tk, est, cond, s, fn))
    random.Random(7).shuffle(itens)  # mistura as células: se o teto parar a rodada, o desenho continua balanceado
    if a.limite:
        itens = itens[:a.limite]

    def rodar(it):
        tk, est, cond, s, fn = it
        if a.teto_usd and GASTO["usd"] >= a.teto_usd:
            return {"parado": True}
        try:
            r = fn(a.modelo, est, cond, s)
        except Exception as e:  # noqa
            r = {"erro": str(e)[:300]}
        if "erro" not in r:
            with trava:
                GASTO["usd"] += custo_nominal({**r, "modelo": a.modelo})
        r.update({"tarefa": tk, "id": est["id"], "cond": cond, "modelo": a.modelo, "amostra": s, "esforco": a.esforco, "violar": est["violar"], "retidas": RETIDAS[est["familia"]]})
        with trava:
            with open(saida, "a", encoding="utf-8") as f:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        return r

    print(len(itens), "itens", flush=True)
    with ThreadPoolExecutor(a.paralelo) as ex:
        for n, r in enumerate(ex.map(rodar, itens), 1):
            if r.get("parado"):
                print("TETO ATINGIDO, parando", round(GASTO["usd"], 2), flush=True); break
            if n % 10 == 0 or "erro" in r:
                print(n, "/", len(itens), "US$", round(GASTO["usd"], 2), r.get("erro", ""), flush=True)


if __name__ == "__main__":
    main()
