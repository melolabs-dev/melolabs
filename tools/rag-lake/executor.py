#!/usr/bin/env python3
"""Executor do estudo 2: monta o prompt de cada braço e chama Haiku (ou outro modelo) via `claude -p`.

Uso (piloto):
  python tools/rag-lake/executor.py --piloto --amostras 3 --saida piloto.jsonl

Braços implementados: A0 (só a pergunta), A1 (documentos-ouro inteiros), A2 (lake inteiro),
A3 (vetor, top-k), A4a (BM25 + vetor por RRF, top-k). Retomável: pula (qid, braço, k, amostra) já gravados.
Configuração mínima do `claude -p` (sem ferramentas, prompt de sistema curto): sobrecarga medida ~1.000 tokens.
"""
import argparse, json, random, re, shutil, subprocess, sys, threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import indice as ix

RAIZ = ix.RAIZ
E2, LAKE = ix.E2, ix.LAKE
SISTEMA = "Você responde perguntas de múltipla escolha sobre decisões de projeto."
INSTR = ("Responda apenas com a letra da opção correta (A, B, C ou D). "
         "Se o material fornecido não permitir decidir, escolha a opção de informação insuficiente.")
LIMPO = Path.home() / "AppData" / "Local" / "Temp" / "estudo2-limpo"
trava = threading.Lock()


def bloco_pergunta(p):
    ops = "\n".join(f"{l}) {t}" for l, t in p["opcoes"].items())
    return f"Pergunta: {p['pergunta']}\n{ops}\n\n{INSTR}"


EX = None
BASE_A5 = "rerank"
ABST = {}


def extras(indice):
    global EX
    if EX is None:
        import bracos
        EX = bracos.Extras(indice)
    return EX


def ouro(g):
    docs = []
    for d in dict.fromkeys(s["doc"] for s in g["fontes"]):
        it = next(i for i in MAN if i["id"] == d)
        docs.append(f"=== {d} | {it['path']} ===\n" + (LAKE / "bruto" / it["path"]).read_text(encoding="utf-8"))
    return "\n\n".join(docs)


def prompt(braco, p, g, indice, k):
    q = p["pergunta"]
    docs_ouro = {s["doc"] for s in g["fontes"]}
    if braco == "A0":
        ctx = ""
    elif braco == "A1":
        ctx = ouro(g)
    elif braco == "A2":
        ctx = ""  # o lake inteiro vai no prompt de sistema (cache de prompt), ver chamar()
    elif braco in ("A3", "A4a", "A4b"):
        idx = {"A3": indice.vetor, "A4a": indice.rrf, "A4b": indice.rerank}[braco](q, k)
        ctx = "\n\n".join(f"[{indice.meta[i][1]} | {indice.meta[i][2]}]\n{indice.meta[i][4]}" for i in idx)
    elif braco in ("A5", "A6"):
        ex = extras(indice)
        ctx = ex.ctx_a5(q, k, BASE_A5)
        if braco == "A6":
            tau = json.load(open(LAKE / "indice" / "gate.json", encoding="utf-8"))["tau"]
            ABST[p["qid"]] = ex.sinal(q) < tau
    elif braco == "N1":
        ctx = extras(indice).ruido(p["qid"], docs_ouro, k or 10)
    elif braco == "N1b":
        ctx = extras(indice).ruido(p["qid"], docs_ouro, k or 10) + "\n\n" + ouro(g)
    elif braco == "N2":
        ctx = ouro(g) + "\n\n" + extras(indice).antigos(q, docs_ouro)
    else:
        raise ValueError(braco)
    return (f"Material do projeto:\n{ctx}\n\n" if ctx else "") + bloco_pergunta(p)


def chamar(modelo, texto, braco=""):
    cmd = [shutil.which("claude.cmd") or shutil.which("claude"), "-p", "--model", modelo, "--output-format", "json", "--setting-sources", "project",
           "--strict-mcp-config", "--no-session-persistence", "--tools", ""]
    cmd += ["--system-prompt-file", str(LIMPO / "lake_sistema.txt")] if braco == "A2" else ["--system-prompt", SISTEMA]
    r = subprocess.run(cmd, input=texto, capture_output=True, text=True, encoding="utf-8", cwd=LIMPO, timeout=900)
    d = json.loads(r.stdout)
    u = d.get("usage", {})
    if d.get("is_error") or not u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0) + u.get("cache_read_input_tokens", 0):
        raise RuntimeError("chamada sem uso de tokens: " + str(d.get("result", ""))[:150])
    entrada = u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0) + u.get("cache_read_input_tokens", 0)
    m = re.search(r"\b([ABCD])\b", str(d.get("result", "")))
    return {"bruto": str(d.get("result", ""))[:200], "letra": m.group(1) if m else None,
            "tokens_entrada": entrada, "tokens_saida": u.get("output_tokens", 0), "custo_usd": d.get("total_cost_usd")}


MAN = json.load(open(LAKE / "manifesto-bruto.json", encoding="utf-8"))["itens"]


def piloto_ids(gab):
    rng = random.Random(20261109)
    sel = []
    for b in ("comum", "conflito", "sem_resposta"):
        ids = sorted(g["qid"] for g in gab if g["bloco"] == b)
        sel += rng.sample(ids, 5)
    return sel


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--piloto", action="store_true")
    ap.add_argument("--qids", nargs="*")
    ap.add_argument("--bracos", nargs="+", default=["A0", "A1", "A3:10", "A4a:3", "A4a:5", "A4a:10", "A4a:15"])
    ap.add_argument("--amostras", type=int, default=3)
    ap.add_argument("--modelo", default="haiku")
    ap.add_argument("--saida", required=True)
    ap.add_argument("--paralelo", type=int, default=6)
    ap.add_argument("--base-a5", default="rerank", choices=["rerank", "rrf"])
    a = ap.parse_args()
    global BASE_A5
    BASE_A5 = a.base_a5
    LIMPO.mkdir(exist_ok=True)
    src = Path(__file__).resolve().parents[0]
    if not (LIMPO / "lake_inteiro.txt").exists():
        t = ""
        for it in MAN:
            t += f"\n\n=== {it['id']} | {it['path']} ===\n" + (LAKE / "bruto" / it["path"]).read_text(encoding="utf-8")
        (LIMPO / "lake_inteiro.txt").write_text(t, encoding="utf-8")
    (LIMPO / "lake_sistema.txt").write_text(SISTEMA + "\n\nMaterial do projeto:\n" + (LIMPO / "lake_inteiro.txt").read_text(encoding="utf-8"), encoding="utf-8")
    perg = {p["qid"]: p for p in json.load(open(LAKE / "perguntas" / "perguntas.json", encoding="utf-8"))}
    gab = {g["qid"]: g for g in json.load(open(E2 / "gabarito" / "rascunho.json", encoding="utf-8"))}
    qids = piloto_ids(list(gab.values())) if a.piloto else a.qids
    saida = Path(a.saida)
    feito = set()
    if saida.exists():
        for l in saida.read_text(encoding="utf-8").splitlines():
            r = json.loads(l)
            feito.add((r["qid"], r["braco"], r["k"], r["amostra"]))
    indice = ix.Indice()
    indice.vetor("aquecer", 1)
    tarefas = []
    for q in qids:
        for b in a.bracos:
            nome, _, k = b.partition(":")
            k = int(k) if k else 0
            if nome in ("A1", "N1b", "N2") and not gab[q]["fontes"]:
                continue  # sem_resposta não tem documento-ouro
            for s in range(a.amostras):
                if (q, nome, k, s) not in feito:
                    tarefas.append((q, nome, k, s))

    textos = {}
    for (q, nome, k, s) in tarefas:
        if (q, nome, k) not in textos:
            textos[(q, nome, k)] = prompt(nome, perg[q], gab[q], indice, k)

    def rodar(t):
        q, nome, k, s = t
        txt = textos[(q, nome, k)]
        try:
            if nome == "A6" and ABST.get(q):
                letra = next(l for l, t in perg[q]["opcoes"].items() if t == "Informação insuficiente no material")
                r = {"bruto": "abstém (portão)", "letra": letra, "tokens_entrada": 0, "tokens_saida": 0, "custo_usd": 0.0}
            else:
                r = chamar(a.modelo, txt, nome)
        except Exception as e:  # noqa
            r = {"erro": str(e)[:200], "letra": None}
        r.update({"qid": q, "braco": nome, "k": k, "amostra": s, "modelo": a.modelo, "bloco": gab[q]["bloco"],
                  "correta": gab[q]["correta"], "chars_prompt": len(txt)})
        with trava:
            with open(saida, "a", encoding="utf-8") as f:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        return r

    print(len(tarefas), "chamadas")
    # aquecimento do cache: a primeira chamada do A2 roda sozinha, para as demais lerem o cache
    for t in list(tarefas):
        if t[1] == "A2":
            rodar(t)
            tarefas.remove(t)
            break
    with ThreadPoolExecutor(a.paralelo) as ex:
        for n, r in enumerate(ex.map(rodar, tarefas), 1):
            if n % 20 == 0:
                print(n, "/", len(tarefas), flush=True)


if __name__ == "__main__":
    main()
