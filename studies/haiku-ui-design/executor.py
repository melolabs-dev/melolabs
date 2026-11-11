#!/usr/bin/env python3
"""Executor do estudo 3 (Haiku + kit + data lake em UI/UX). Chama `claude -p` (assinatura), esforço médio, sem ferramentas.
Condições: A0 (puro), A1 (+regras do data lake), A2 (+relatório do kit), A3 (ambos), AC (autocrítica sem kit; controle).
Tarefas: T1 criar (2 chamadas em A2/A3/AC: criar e depois corrigir por trechos), T2 melhorar (trechos), T3 comparar (JSON).
Retomável: pula (tarefa, id, cond, modelo, amostra) já gravados. Uso:
  python executor.py --tarefas T2 T3 --conds A0 A1 A2 A3 --modelo haiku --amostras 3 --saida dados/bruto/haiku.jsonl [--ids T2-01 ...]
"""
import argparse, json, re, shutil, subprocess, sys, tempfile, threading, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

AQUI = Path(__file__).resolve().parent
EST = AQUI / "dados" / "estimulos"
LAKE = json.loads((AQUI / "lake" / "login.json").read_text(encoding="utf-8"))
LIMPO = Path(tempfile.gettempdir()) / "estudo3-limpo"
SISTEMA = "Você é um desenvolvedor front-end sênior. Responda exatamente no formato pedido, sem explicações extras."
trava = threading.Lock()
PRECO = {"haiku": (0.10, 0.50, 0.01), "sonnet": (2.0, 10.0, 0.10), "opus": (4.0, 20.0, 0.20)}  # entrada, saída, leitura de cache (US$/MTok)
GASTO = {"usd": 0.0}


def custo_nominal(r):
    pi, po, pc = PRECO[r["modelo"]]
    return sum((c["in"] + 1.25 * c["cache_w"]) * pi / 1e6 + c["cache_r"] * pc / 1e6 + c["out"] * po / 1e6 for c in r.get("chamadas", []))


FMT_PATCH = ("Responda apenas com correções em trechos, neste formato (repita o bloco quantas vezes precisar):\n"
             "@@ ANTES\n<trecho exato do código atual, copiado sem alterar>\n@@ DEPOIS\n<trecho novo>\n@@ FIM\n"
             "Cada ANTES deve aparecer uma única vez no código. Não reescreva o arquivo inteiro.")
FMT_DIFF = ("Liste as diferenças reais entre a tela A e a tela B (conteúdo, estilo visual, estrutura ou fluxo). "
            "Ignore mudanças sem efeito (nomes de classe, espaços, comentários, ordem de atributos, notações equivalentes de cor ou unidade). "
            "Responda apenas com um array JSON; cada item: {\"elemento\": \"...\", \"propriedade\": \"...\", \"de\": \"...\", \"para\": \"...\"}. "
            "Se não houver diferença real, responda [].")


def regras_txt():
    return "\n".join(f"- {r['id']} ({r['tipo']}): {r['regra']} Bom: {r['bom']} Mau: {r['mau']}" for r in LAKE)


def kit(args, entrada=None):
    t0 = time.time()
    r = subprocess.run(["node", str(AQUI / "kit" / "kit.mjs"), *args], capture_output=True, text=True, encoding="utf-8", input=entrada)
    if r.returncode:
        raise RuntimeError("kit falhou: " + r.stderr[:200])
    return r.stdout.strip(), time.time() - t0


def kit_rel(html):
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8") as f:
        f.write(html)
    try:
        return kit([f.name])
    finally:
        Path(f.name).unlink(missing_ok=True)


def kit_diff(a, b):
    nomes = []
    for h in (a, b):
        with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8") as f:
            f.write(h)
        nomes.append(f.name)
    try:
        return kit(["diff", *nomes])
    finally:
        for n in nomes:
            Path(n).unlink(missing_ok=True)


def chamar(modelo, texto, esforco="medium"):
    LIMPO.mkdir(exist_ok=True)
    cmd = [shutil.which("claude.cmd") or shutil.which("claude"), "-p", "--model", modelo, "--effort", esforco, "--output-format", "json",
           "--setting-sources", "project", "--strict-mcp-config", "--no-session-persistence", "--tools", "", "--system-prompt", SISTEMA]
    t0 = time.time()
    r = subprocess.run(cmd, input=texto, capture_output=True, text=True, encoding="utf-8", cwd=LIMPO, timeout=1200)
    d = json.loads(r.stdout)
    u = d.get("usage", {})
    ent = u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0) + u.get("cache_read_input_tokens", 0)
    if d.get("is_error") or not ent:
        raise RuntimeError("chamada sem uso de tokens: " + str(d.get("result", ""))[:150])
    return {"texto": str(d.get("result", "")), "in": u.get("input_tokens", 0), "cache_w": u.get("cache_creation_input_tokens", 0),
            "cache_r": u.get("cache_read_input_tokens", 0), "out": u.get("output_tokens", 0), "usd": d.get("total_cost_usd"),
            "modelos": list((d.get("modelUsage") or {}).keys()), "seg": round(time.time() - t0, 1)}


def tirar_html(t):
    m = re.search(r"```(?:html)?\s*\n(.*?)```", t, re.S)
    if m:
        return m.group(1).strip() + "\n"
    i = t.lower().find("<!doctype")
    return (t[i:].strip() + "\n") if i >= 0 else t.strip() + "\n"


def aplicar(html, resposta):
    blocos = re.findall(r"@@ ANTES\n(.*?)\n@@ DEPOIS\n(.*?)\n?@@ FIM", resposta, re.S)
    ok, falha, atual = 0, 0, html
    for a, b in blocos:
        if atual.count(a) == 1:
            atual = atual.replace(a, b); ok += 1
        else:
            falha += 1
    return atual, {"blocos": len(blocos), "aplicados": ok, "falhos": falha}


def prompt_t1_criar(est, cond):
    p = est["pedido"]
    if cond in ("A1", "A3"):
        p += "\n\nRegras de boas práticas para telas de login (siga-as):\n" + regras_txt()
    return p + "\n\nResponda apenas com o arquivo HTML completo dentro de um bloco ```html."


def prompt_corrigir(html, cond, relatorio=None):
    if cond == "AC":
        cab = "Revise o código abaixo como um crítico rigoroso de UX, acessibilidade e consistência visual, e corrija os problemas que achar."
    else:
        cab = "O relatório abaixo vem de uma checagem automática do código. Corrija o código para resolver o que falhou, sem introduzir problemas novos."
    p = cab + "\n\nCódigo atual:\n```html\n" + html + "```\n"
    if relatorio:
        p += "\n" + relatorio + "\n"
    return p + "\n" + FMT_PATCH


def rodar_t1(modelo, est, cond):
    cham = []
    c1 = chamar(modelo, prompt_t1_criar(est, cond)); cham.append(c1)
    html = tirar_html(c1["texto"]); extra = {}; kit_s = 0.0
    if cond in ("A2", "A3", "AC"):
        rel = None
        if cond != "AC":
            rel, kit_s = kit_rel(html)
        c2 = chamar(modelo, prompt_corrigir(html, cond, rel)); cham.append(c2)
        html, extra = aplicar(html, c2["texto"])
    return {"html_final": html, "patch": extra, "chamadas": cham, "kit_seg": kit_s}


def rodar_t2(modelo, est, cond):
    html = est["html"]; cab = "Melhore esta tela de login: corrija problemas de UX, acessibilidade e consistência visual."
    p = cab + "\n\nCódigo atual:\n```html\n" + html + "```\n"
    if cond in ("A1", "A3"):
        p += "\nRegras de boas práticas para telas de login:\n" + regras_txt() + "\n"
    kit_s = 0.0
    if cond in ("A2", "A3"):
        rel, kit_s = kit_rel(html); p += "\n" + rel + "\n"
    c = chamar(modelo, p + "\n" + FMT_PATCH)
    novo, extra = aplicar(html, c["texto"])
    return {"html_final": novo, "patch": extra, "chamadas": [c], "kit_seg": kit_s}


def rodar_t3(modelo, est, cond):
    p = "Tela A:\n```html\n" + est["a"] + "```\n\nTela B:\n```html\n" + est["b"] + "```\n\n"
    if cond in ("A1", "A3"):
        p += "Pontos que importam em uma tela de login (use como lista de atenção):\n" + regras_txt() + "\n\n"
    kit_s = 0.0
    if cond in ("A2", "A3"):
        rel, kit_s = kit_diff(est["a"], est["b"]); p += rel + "\n\n"
    c = chamar(modelo, p + FMT_DIFF)
    return {"resposta": c["texto"], "chamadas": [c], "kit_seg": kit_s}


TAREFAS = {"T1": ("t1.json", rodar_t1), "T2": ("t2.json", rodar_t2), "T3": ("t3.json", rodar_t3)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tarefas", nargs="+", default=["T1", "T2", "T3"])
    ap.add_argument("--conds", nargs="+", default=["A0", "A1", "A2", "A3"])
    ap.add_argument("--modelo", default="haiku")
    ap.add_argument("--amostras", type=int, default=3)
    ap.add_argument("--ids", nargs="*")
    ap.add_argument("--saida", required=True)
    ap.add_argument("--paralelo", type=int, default=6)
    ap.add_argument("--esforco", default="medium")
    ap.add_argument("--teto-usd", type=float, default=0.0, help="para antes de passar deste gasto nominal acumulado (soma dos principal-*.jsonl da pasta)")
    a = ap.parse_args()
    saida = Path(a.saida); saida.parent.mkdir(parents=True, exist_ok=True)
    feito = set()
    if saida.exists():
        for l in saida.read_text(encoding="utf-8").splitlines():
            r = json.loads(l)
            if "erro" not in r:
                feito.add((r["tarefa"], r["id"], r["cond"], r["modelo"], r["amostra"]))
    if a.teto_usd:
        for f in saida.parent.glob("principal-*.jsonl"):
            for l in f.read_text(encoding="utf-8").splitlines():
                r = json.loads(l)
                if "erro" not in r:
                    GASTO["usd"] += custo_nominal(r)
        print("gasto nominal acumulado:", round(GASTO["usd"], 2), flush=True)
    itens = []
    for tk in a.tarefas:
        arq, fn = TAREFAS[tk]
        for est in json.loads((EST / arq).read_text(encoding="utf-8")):
            if a.ids and est["id"] not in a.ids:
                continue
            for cond in a.conds:
                if cond == "AC" and tk != "T1":
                    continue
                for s in range(a.amostras):
                    if (tk, est["id"], cond, a.modelo, s) not in feito:
                        itens.append((tk, est, cond, s, fn))

    def rodar(it):
        tk, est, cond, s, fn = it
        if a.teto_usd and GASTO["usd"] >= a.teto_usd:
            return {"parado": True}
        try:
            r = fn(a.modelo, est, cond)
        except Exception as e:  # noqa
            r = {"erro": str(e)[:300]}
        if "erro" not in r:
            with trava:
                GASTO["usd"] += custo_nominal({**r, "modelo": a.modelo})
        r.update({"tarefa": tk, "id": est["id"], "cond": cond, "modelo": a.modelo, "amostra": s, "esforco": a.esforco})
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
                print(n, "/", len(itens), r.get("erro", ""), flush=True)


if __name__ == "__main__":
    main()
