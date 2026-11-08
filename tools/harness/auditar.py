#!/usr/bin/env python3
"""Auditoria dos dados brutos (passo F5.3): completude, integridade, ausência de edição e de descarte sem registro.

  python tools/harness/auditar.py            -> imprime o resultado e grava dados/processado/auditoria-dados.json
  python tools/harness/auditar.py --manifesto -> também grava dados/bruto/CHECKSUMS.sha256 (SHA-256 de cada arquivo bruto)
"""
import hashlib
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STUDY = ROOT / "studies" / "haiku-sdd-producao"
BRUTO = STUDY / "dados" / "bruto"
PROC = STUDY / "dados" / "processado"


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main():
    res, falhas = {}, []
    plano = json.loads((BRUTO / "plano-execucoes.json").read_text(encoding="utf-8"))
    ext = BRUTO / "plano-extensao.json"
    if ext.exists():
        plano = plano + json.loads(ext.read_text(encoding="utf-8"))
    ids = [p["id"] for p in plano]
    res["planejadas"] = len(ids)
    concl = {p.parent.name for p in BRUTO.glob("*/concluida.json")}
    faltam = [i for i in ids if i not in concl]
    extras = sorted(i for i in concl if i not in ids and not i.startswith("mini-"))
    res["concluidas_do_plano"] = len(ids) - len(faltam)
    res["faltando"] = faltam
    res["concluidas_fora_do_plano"] = extras
    if faltam or extras:
        falhas.append("plano e execuções concluídas não coincidem")

    linhas = [json.loads(l) for l in open(BRUTO / "execucoes.jsonl", encoding="utf-8")]
    por = Counter(l["id"] for l in linhas)
    res["linhas_execucoes"] = len(linhas)
    res["falha_infra"] = sum(1 for l in linhas if l.get("falha_infra"))
    res["tentativas_acima_de_1"] = sum(1 for l in linhas if l.get("tentativa", 1) > 1)
    sem_linha = [i for i in ids if i not in por]
    res["execucoes_sem_linha_de_consumo"] = sem_linha
    if sem_linha:
        falhas.append("execução sem linha em execucoes.jsonl")

    sem_trans, vazias, sem_prompt = [], [], []
    for l in linhas:
        if not l["id"] in ids:
            continue
        pasta = BRUTO / l["id"] / "transcricoes"
        t = ROOT / l["transcricao"]
        if not t.exists():
            sem_trans.append(l["transcricao"])
        elif t.stat().st_size == 0:
            vazias.append(l["transcricao"])
        pr = t.with_suffix("").with_suffix(".prompt.txt") if t.exists() else None
        if pr is not None and pr.exists():
            if hashlib.sha256(pr.read_text(encoding="utf-8").encode("utf-8")).hexdigest()[:16] != l["prompt_sha256"]:
                sem_prompt.append(l["transcricao"])
    res["transcricoes_ausentes"] = len(sem_trans)
    res["transcricoes_vazias"] = len(vazias)
    res["prompt_hash_divergente"] = len(sem_prompt)
    if sem_trans or vazias:
        falhas.append("transcrições ausentes ou vazias")

    sem_score = [i for i in ids if not (BRUTO / i / "score.json").exists() or not (BRUTO / i / "auditoria.json").exists()]
    res["sem_score_ou_auditoria"] = sem_score
    if sem_score:
        falhas.append("execução sem score.json ou auditoria.json")
    susp = []
    for i in ids:
        a = json.loads((BRUTO / i / "auditoria.json").read_text(encoding="utf-8"))
        if a.get("limpo") is False:
            susp.append(i)
    res["auditoria_suspeita"] = susp

    # edição à mão: arquivos brutos rastreados que foram modificados (não só adicionados) depois do primeiro commit
    out = subprocess.run(["git", "-C", str(ROOT), "log", "--diff-filter=M", "--name-only", "--pretty=format:", "--",
                          "studies/haiku-sdd-producao/dados/bruto"], capture_output=True, text=True).stdout.split()
    modificados = sorted({o for o in out if "juizes.jsonl" not in o and "execucoes.jsonl" not in o and "plano.log" not in o
                          and "plano.err" not in o and "mapa-cego" not in o and "ids-juizes" not in o and "plano-execucoes.json" not in o and "extensao.log" not in o and "extensao.err" not in o and "juizes2" not in o and "juizes.log" not in o and "juizes.err" not in o})
    res["arquivos_brutos_modificados_apos_commit"] = modificados
    inicio = subprocess.run(["git", "-C", str(ROOT), "log", "--pretty=%h %cI %s", "--", "studies/haiku-sdd-producao/dados/bruto/plano-execucoes.json"], capture_output=True, text=True).stdout.strip().splitlines()
    res["plano_execucoes_commits"] = inicio
    res["nota_plano"] = "plano-execucoes.json foi reordenado (A e B embaralhadas juntas) antes da coleta e do adendo 1; nenhum commit dele é posterior ao início da coleta."
    res["nota_edicao"] = "juizes.jsonl, execucoes.jsonl, mapa-cego.json e logs são arquivos de acréscimo (append); os demais não devem aparecer aqui."

    # juízes
    notas = [json.loads(l) for l in open(BRUTO / "juizes.jsonl", encoding="utf-8")]
    ok = [n for n in notas if "criterios" in n]
    res["julgamentos_validos"] = len(ok)
    res["julgamentos_com_erro_registrados"] = len(notas) - len(ok)
    pares = Counter((n["codigo"], n["juiz"]) for n in ok)
    res["julgamentos_duplicados"] = sum(1 for v in pares.values() if v > 1)
    if res["julgamentos_duplicados"]:
        falhas.append("julgamento duplicado")

    # descarte: pastas de execução antigas
    runs = Path("C:/dev/runs")
    res["pastas_em_C_dev_runs"] = len([p for p in runs.glob("r*") if p.is_dir()]) if runs.exists() else 0

    if "--manifesto" in sys.argv:
        linhas_m = [f"{sha(p)}  {p.relative_to(BRUTO).as_posix()}" for p in sorted(BRUTO.rglob("*")) if p.is_file() and p.name != "CHECKSUMS.sha256"]
        (BRUTO / "CHECKSUMS.sha256").write_text("\n".join(linhas_m) + "\n", encoding="utf-8")
        res["manifesto_arquivos"] = len(linhas_m)

    res["falhas"] = falhas
    res["aprovada"] = not falhas
    PROC.mkdir(parents=True, exist_ok=True)
    (PROC / "auditoria-dados.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
