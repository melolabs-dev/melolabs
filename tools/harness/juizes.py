#!/usr/bin/env python3
"""Avaliação cega por juízes Opus isolados (adendo 1).

  python tools/harness/juizes.py montar <id...>     monta o pacote cego (códigos aleatórios) a partir de dados/bruto/<id>/sdd
  python tools/harness/juizes.py julgar [--max N]   roda 3 juízes por artefato, um processo `claude -p` por julgamento
  python tools/harness/juizes.py tabela             tabela de notas por condição (usa o mapa cego só aqui)

Isolamento: cada juiz roda com cwd em C:\\dev\\juizes\\j<n>, que contém só `repo/` (h3 no commit base, para conferir citações) e `artefato.md`.
Ferramentas: Read, Glob e Grep. O mapa código -> condição fica em dados/bruto/mapa-cego.json, fora do alcance do juiz.
"""
import json
import random
import re
import shutil
import statistics as st
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
import orquestrador as O  # noqa: E402

STUDY = ROOT / "studies" / "haiku-sdd-producao"
BRUTO = STUDY / "dados" / "bruto"
JUIZES = Path("C:/dev/juizes")
MAPA = BRUTO / "mapa-cego.json"
NOTAS = BRUTO / "juizes.jsonl"
NJ = 3  # adendo 2b: continuam 3 juizes por artefato (a ideia de 5 foi retirada por custo e por nao elevar o alfa)
RUBRICA = (STUDY / "rubrica.md").read_text(encoding="utf-8")
CRITERIOS = {"techspec": ["C1", "C2", "C3", "C4", "C5", "C6", "C7"], "tasks": ["T1", "T2", "T3", "T4", "T5"]}

PROMPT = ("Você é um avaliador técnico rigoroso. Leia o artefato em `artefato.md` (tipo: {TIPO}) e avalie-o com a rubrica abaixo. "
          "O repositório h3, no estado em que o autor do artefato o viu, está em `repo/`; use Read, Glob e Grep para conferir cada citação `arquivo:linha` "
          "e qualquer afirmação factual sobre o código. Não leia nada fora desta pasta. Não tente descobrir quem escreveu o artefato.\n\n"
          "{RUBRICA}\n\nAvalie só os critérios do tipo {TIPO}. Responda apenas com o bloco JSON exigido.")


def montar(ids):
    mapa = json.loads(MAPA.read_text(encoding="utf-8")) if MAPA.exists() else {}
    rnd = random.Random(20261106)
    for rid in ids:
        sdd = BRUTO / rid / "sdd"
        for tipo in ("techspec", "tasks"):
            arq = sdd / f"{tipo}.md"
            if not arq.exists():
                continue
            if any(v["id"] == rid and v["tipo"] == tipo for v in mapa.values()):
                continue
            cod = "a" + "".join(rnd.choice("0123456789abcdefghjkmnpqrstvwxyz") for _ in range(8))
            while cod in mapa:  # nunca reutiliza um codigo existente (a semente reinicia a cada chamada)
                cod = "a" + "".join(rnd.choice("0123456789abcdefghjkmnpqrstvwxyz") for _ in range(8))
            m = json.loads((BRUTO / rid / "concluida.json").read_text(encoding="utf-8"))
            mapa[cod] = {"id": rid, "tipo": tipo, "condicao": m["condicao"], "variante": m["variante"]}
            (JUIZES / "pacote").mkdir(parents=True, exist_ok=True)
            texto = arq.read_text(encoding="utf-8")
            (JUIZES / "pacote" / f"{cod}.md").write_text(texto, encoding="utf-8")
    MAPA.write_text(json.dumps(mapa, ensure_ascii=False, indent=1), encoding="utf-8")
    print(len(mapa), "artefatos no pacote cego")


def prepara_repo(pasta):
    repo = pasta / "repo"
    if repo.exists():
        return
    pasta.mkdir(parents=True, exist_ok=True)
    O.export_base(repo)
    (repo / "test" / "unit" / "cli.test.ts").unlink(missing_ok=True)


def julga(cod, tipo, juiz):
    pasta = JUIZES / f"j{juiz}"
    prepara_repo(pasta)
    shutil.copy(JUIZES / "pacote" / f"{cod}.md", pasta / "artefato.md")
    prompt = PROMPT.format(TIPO=tipo, RUBRICA=RUBRICA)
    cmd = [O.CLAUDE, "-p", "--model", "opus", "--output-format", "json", "--setting-sources", "project", "--strict-mcp-config",
           "--permission-mode", "default", "--no-session-persistence", "--allowedTools", "Read", "Glob", "Grep",
           "--disallowedTools", "WebFetch", "WebSearch", "Agent", "PowerShell", "Bash", "Edit", "Write", "Task", "NotebookEdit"]
    t0 = time.time()
    p = subprocess.run(cmd, input=prompt, cwd=str(pasta), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1800)
    try:
        res = json.loads(p.stdout)
    except Exception:
        return {"erro": (p.stdout + p.stderr)[:300]}
    txt = res.get("result") or ""
    m = re.search(r"\{.*\}", txt, re.S)
    try:
        j = json.loads(m.group(0))
        notas = {k: int(v) for k, v in j["criterios"].items() if k in CRITERIOS[tipo]}
    except Exception:
        return {"erro": "json invalido: " + txt[:200]}
    u = res.get("usage", {})
    return {"criterios": notas, "alucinacoes": int(j.get("alucinacoes", 0)), "observacao": str(j.get("observacao", ""))[:300],
            "tokens_totais": sum(u.get(k, 0) for k in ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")),
            "custo_usd_lista": res.get("total_cost_usd"), "duracao_s": round(time.time() - t0, 1), "modelo_efetivo": ",".join(res.get("modelUsage", {}).keys())}


def julgar(maximo=None):
    mapa = json.loads(MAPA.read_text(encoding="utf-8"))
    feitos = set()
    if NOTAS.exists():
        for l in open(NOTAS, encoding="utf-8"):
            r = json.loads(l)
            if "criterios" in r:
                feitos.add((r["codigo"], r["juiz"]))
    alvos = BRUTO / "ids-julgar-total.txt"
    permitidos = set(alvos.read_text(encoding="utf-8").split()) if alvos.exists() else None
    fila = [(c, v["tipo"], j) for c, v in mapa.items() if permitidos is None or v["id"] in permitidos for j in range(1, NJ + 1) if (c, j) not in feitos]
    random.Random(20261106).shuffle(fila)
    n = 0
    for cod, tipo, j in fila:
        if maximo is not None and n >= maximo:
            break
        r = julga(cod, tipo, j)
        r.update({"codigo": cod, "tipo": tipo, "juiz": j})
        with open(NOTAS, "a", encoding="utf-8") as f:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
        n += 1
        print(cod, tipo, j, sum(r.get("criterios", {}).values()) if "criterios" in r else r.get("erro"), flush=True)


def tabela():
    mapa = json.loads(MAPA.read_text(encoding="utf-8"))
    por = {}
    for l in open(NOTAS, encoding="utf-8"):
        r = json.loads(l)
        if "criterios" in r:
            por.setdefault(r["codigo"], []).append(sum(r["criterios"].values()))
    ag = {}
    for cod, somas in por.items():
        v = mapa[cod]
        ag.setdefault((v["variante"], v["condicao"], v["tipo"]), []).append(st.mean(somas))
    for k, v in sorted(ag.items()):
        print(k, "n=", len(v), "média", round(st.mean(v), 2))


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    if a[0] == "montar":
        montar(a[1:])
    elif a[0] == "julgar":
        julgar(int(a[a.index("--max") + 1]) if "--max" in a else None)
    elif a[0] == "tabela":
        tabela()
    else:
        sys.exit(__doc__)
