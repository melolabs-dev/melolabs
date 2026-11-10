#!/usr/bin/env python3
"""Monta a zona bruta do mini data lake do estudo 2 (rag-data-lake-haiku).

Regras de seleção (determinísticas; entram no pré-registro):
- h3 no commit fixado f0e17808 (22/10/2026): docs/*.md, AGENTS.md, README.md,
  as 20 versões mais recentes do CHANGELOG e um núcleo de código-fonte.
- Issues do h3 criadas antes do commit, de autor humano, com corpo >= 400 caracteres,
  ordenadas por número de comentários (desc) e número (desc), até o orçamento de tokens.
- PRs do h3 mesclados antes do commit, de autor humano, com corpo >= 300 caracteres,
  do mais recente para o mais antigo, até o orçamento de tokens.
- Registro de decisões do estudo 1 (arquivos de planejamento e adendos).
Tokens são estimados em caracteres/4 (aproximação; o número real depende do tokenizador).

Uso: python tools/rag-lake/build_bruto.py --h3 <clone do h3 no commit fixado> --issues issues.json --prs prs.json
"""
import argparse, hashlib, json, re, shutil, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
LAKE = RAIZ / "studies" / "rag-data-lake-haiku" / "lake"
BRUTO = LAKE / "bruto"
COMMIT = "f0e17808ac2439b6434bb10609a961067f4d555b"
CORTE = "2026-10-22T05:50:58Z"
ORC_ISSUES = 20000
ORC_PRS = 12000
NUCLEO_SRC = [
    "src/h3.ts", "src/event.ts", "src/error.ts", "src/handler.ts", "src/middleware.ts",
    "src/response.ts", "src/utils/static.ts", "src/utils/session.ts", "src/utils/cookie.ts",
    "src/utils/auth.ts", "src/utils/query.ts", "src/utils/cors.ts",
]
ESTUDO1 = [
    "premissa.md", "plano-de-testes.md", "regras-de-decisao.md", "solucoes-do-autor.md",
    "diario.md", "validade.md", "prereg/adendo-1.md", "prereg/adendo-2.md", "prereg/adendo-2b.md",
]
BOTS = ("bot", "renovate", "dependabot", "github-actions", "autofix")


def tok(s):
    return len(s) // 4


def humano(a):
    login = ((a or {}).get("login") or "").lower()
    return login and not any(b in login for b in BOTS)


def grava(rel, texto, meta, manifesto):
    destino = BRUTO / rel
    destino.parent.mkdir(parents=True, exist_ok=True)
    texto = texto.replace("\r\n", "\n")
    destino.write_text(texto, encoding="utf-8", newline="\n")
    b = texto.encode("utf-8")
    manifesto.append({
        "path": rel.replace("\\", "/"), "bytes": len(b), "tokens_est": tok(texto),
        "sha256": hashlib.sha256(b).hexdigest(), **meta,
    })


def changelog_recente(texto, n=20):
    partes = re.split(r"(?m)^(?=## v)", texto)
    cab, versoes = partes[0], partes[1:]
    return cab + "".join(versoes[:n])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--h3", required=True)
    ap.add_argument("--issues", required=True)
    ap.add_argument("--prs", required=True)
    a = ap.parse_args()
    h3 = Path(a.h3)
    if BRUTO.exists():
        shutil.rmtree(BRUTO)
    man = []

    for f in sorted((h3 / "docs").rglob("*.md")):
        rel = f.relative_to(h3).as_posix()
        grava("h3/" + rel, f.read_text(encoding="utf-8"), {"origem": "h3", "tipo": "doc", "commit": COMMIT}, man)
    for nome in ("AGENTS.md", "README.md"):
        grava("h3/" + nome, (h3 / nome).read_text(encoding="utf-8"), {"origem": "h3", "tipo": "doc-projeto", "commit": COMMIT}, man)
    grava("h3/CHANGELOG.md", changelog_recente((h3 / "CHANGELOG.md").read_text(encoding="utf-8")),
          {"origem": "h3", "tipo": "changelog", "commit": COMMIT, "nota": "20 versões mais recentes"}, man)
    for rel in NUCLEO_SRC:
        grava("h3/" + rel, (h3 / rel).read_text(encoding="utf-8"), {"origem": "h3", "tipo": "codigo", "commit": COMMIT}, man)

    issues = [x for x in json.load(open(a.issues, encoding="utf-8"))
              if x["createdAt"] < CORTE and humano(x.get("author")) and len(x.get("body") or "") >= 400]
    issues.sort(key=lambda x: (-len(x.get("comments") or []), -x["number"]))
    usado = 0
    for x in issues:
        corpo = f"# Issue #{x['number']}: {x['title']}\n\nEstado: {x['state']}. Criada em {x['createdAt'][:10]}"
        if x.get("closedAt"):
            corpo += f", fechada em {x['closedAt'][:10]}"
        corpo += f". Autor: {x['author']['login']}.\n\n{x['body'].strip()}\n"
        for c in (x.get("comments") or [])[:6]:
            if humano(c.get("author")):
                corpo += f"\n## Comentário de {c['author']['login']} em {c['createdAt'][:10]}\n\n{(c['body'] or '').strip()[:1500]}\n"
        if usado + tok(corpo) > ORC_ISSUES:
            continue
        usado += tok(corpo)
        grava(f"h3-issues/issue-{x['number']}.md", corpo,
              {"origem": "h3", "tipo": "issue", "numero": x["number"], "estado": x["state"], "data": x["createdAt"][:10],
               "url": f"https://github.com/h3js/h3/issues/{x['number']}"}, man)

    prs = [x for x in json.load(open(a.prs, encoding="utf-8"))
           if x.get("mergedAt") and x["createdAt"] < CORTE and x["mergedAt"] < CORTE and humano(x.get("author"))
           and len(x.get("body") or "") >= 300]
    prs.sort(key=lambda x: -x["number"])
    usado = 0
    for x in prs:
        corpo = (f"# PR #{x['number']}: {x['title']}\n\nMesclado em {x['mergedAt'][:10]}. Autor: {x['author']['login']}.\n\n"
                 f"{x['body'].strip()[:4000]}\n")
        if usado + tok(corpo) > ORC_PRS:
            continue
        usado += tok(corpo)
        grava(f"h3-prs/pr-{x['number']}.md", corpo,
              {"origem": "h3", "tipo": "pr", "numero": x["number"], "estado": "merged", "data": x["mergedAt"][:10],
               "url": f"https://github.com/h3js/h3/pull/{x['number']}"}, man)

    e1 = RAIZ / "studies" / "haiku-sdd-producao"
    for rel in ESTUDO1:
        grava("estudo1/" + rel, (e1 / rel).read_text(encoding="utf-8"), {"origem": "estudo1", "tipo": "decisao-estudo1"}, man)

    man.sort(key=lambda m: m["path"])
    for i, m in enumerate(man, 1):
        m["id"] = f"doc-{i:04d}"
    por_tipo = {}
    for m in man:
        por_tipo.setdefault(m["tipo"], [0, 0])
        por_tipo[m["tipo"]][0] += 1
        por_tipo[m["tipo"]][1] += m["tokens_est"]
    saida = {"commit_h3": COMMIT, "corte": CORTE, "documentos": len(man),
             "tokens_est_total": sum(m["tokens_est"] for m in man),
             "por_tipo": {k: {"docs": v[0], "tokens_est": v[1]} for k, v in por_tipo.items()},
             "itens": man}
    (LAKE / "manifesto-bruto.json").write_text(json.dumps(saida, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: saida[k] for k in ("documentos", "tokens_est_total", "por_tipo")}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    sys.exit(main())
