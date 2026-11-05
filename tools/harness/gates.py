#!/usr/bin/env python3
"""Gates determinísticos das etapas do pipeline SDD (usados na condição C4 e para registrar a conformidade em todas).

  python tools/harness/gates.py <prd|techspec|tasks> <pasta-da-execucao>

Saída: JSON com {"ok": bool, "erros": [...]}. Código de saída 0 se ok, 1 se reprovou.
Definição conta só cabeçalhos de requisito (`### RF-NN`), nunca menções no corpo, para não repetir o falso positivo do estudo anterior.
"""
import json
import re
import sys
from pathlib import Path

RF_DEF = re.compile(r"^#{2,4}\s*(RF-\d+)\b", re.M)
D_DEF = re.compile(r"^#{2,4}\s*(D-\d+)\b", re.M)
T_DEF = re.compile(r"^#{2,4}\s*(T-\d+)\b", re.M)
CIT = re.compile(r"([\w./@-]+\.(?:ts|mts|js|json|md)):(\d+)")


def sections(text, rx):
    ms = list(rx.finditer(text))
    out = {}
    for i, m in enumerate(ms):
        end = ms[i + 1].start() if i + 1 < len(ms) else len(text)
        out[m.group(1)] = text[m.end():end]
    return out


def gate_prd(root):
    t = (root / "sdd" / "prd.md").read_text(encoding="utf-8")
    erros = []
    rfs = sections(t, RF_DEF)
    if not rfs:
        erros.append("nenhum requisito com cabeçalho '### RF-NN'")
    for k, v in rfs.items():
        low = v.lower()
        if not all(w in low for w in ("dado", "quando", "então")):
            erros.append(f"{k} sem critério Dado/Quando/Então")
    if len(rfs) != len(RF_DEF.findall(t)):
        erros.append("requisitos duplicados")
    if "fora de escopo" not in t.lower():
        erros.append("falta a seção 'Fora de escopo'")
    return erros


def gate_techspec(root):
    t = (root / "sdd" / "techspec.md").read_text(encoding="utf-8")
    erros = []
    ds = sections(t, D_DEF)
    if not ds:
        erros.append("nenhuma decisão com cabeçalho '### D-NN'")
    cites = CIT.findall(t)
    if len(cites) < 3:
        erros.append(f"poucas citações caminho:linha ({len(cites)}; mínimo 3)")
    for path, line in cites:
        p = root / path
        if not p.exists():
            erros.append(f"citação a arquivo inexistente: {path}:{line}")
            continue
        n = len(p.read_text(encoding="utf-8", errors="replace").splitlines())
        if int(line) < 1 or int(line) > n:
            erros.append(f"linha fora do arquivo: {path}:{line} (tem {n})")
    return erros[:15]


def gate_tasks(root):
    t = (root / "sdd" / "tasks.md").read_text(encoding="utf-8")
    prd = (root / "sdd" / "prd.md")
    rfs = set(RF_DEF.findall(prd.read_text(encoding="utf-8"))) if prd.exists() else set()
    erros = []
    ts = sections(t, T_DEF)
    if not ts:
        erros.append("nenhuma tarefa com cabeçalho '### T-NN'")
    cobertos = set()
    for k, v in ts.items():
        for campo in ("cobre:", "arquivos:", "depende de:", "aceite:"):
            if campo not in v.lower():
                erros.append(f"{k} sem o campo '{campo}'")
        cobertos |= set(re.findall(r"RF-\d+", v))
    for r in sorted(rfs - cobertos):
        erros.append(f"{r} não é coberto por nenhuma tarefa")
    for r in sorted(cobertos - rfs):
        erros.append(f"tarefa cita {r}, que não existe no PRD")
    return erros


GATES = {"prd": gate_prd, "techspec": gate_techspec, "tasks": gate_tasks}

if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in GATES:
        sys.exit(__doc__)
    try:
        erros = GATES[sys.argv[1]](Path(sys.argv[2]))
    except FileNotFoundError as e:
        erros = [f"arquivo ausente: {Path(str(e)).name}"]
    r = {"ok": not erros, "erros": erros}
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    print(json.dumps(r, ensure_ascii=False))
    sys.exit(0 if r["ok"] else 1)
