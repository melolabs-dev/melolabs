#!/usr/bin/env python3
"""Reproduz a análise do zero em um clone limpo do repositório, com um comando (passo F7.1).

  python tools/harness/reproduzir.py [--tag TAG_OU_COMMIT]

Clona o repositório local numa pasta temporária, roda a análise primária, a estendida, a sensibilidade e a auditoria dos dados
e compara os resultados com os arquivos publicados em dados/processado/, ignorando só os campos de data e de commit.
Não precisa da chave do gabarito: a análise lê só os dados brutos já gravados.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ALVOS = {"analise.json": ["analise/analise.py"], "analise-estendida.json": ["analise/analise.py", "--estendida"],
         "sensibilidade.json": ["analise/sensibilidade.py", "--estendida"], "auditoria-dados.json": None}
IGNORAR = {"gerado", "commit_script"}


def limpa(o):
    if isinstance(o, dict):
        return {k: limpa(v) for k, v in o.items() if k not in IGNORAR}
    if isinstance(o, list):
        return [limpa(x) for x in o]
    return o


def main():
    ref = sys.argv[sys.argv.index("--tag") + 1] if "--tag" in sys.argv else "HEAD"
    tmp = Path(tempfile.mkdtemp(prefix="repro-"))
    clone = tmp / "repo"
    subprocess.run(["git", "clone", "-q", str(ROOT), str(clone)], check=True)
    subprocess.run(["git", "-C", str(clone), "checkout", "-q", ref], check=True)
    estudo = clone / "studies" / "haiku-sdd-producao"
    ok = True
    for saida, cmd in ALVOS.items():
        publicado = json.loads((ROOT / "studies" / "haiku-sdd-producao" / "dados" / "processado" / saida).read_text(encoding="utf-8"))
        if cmd is None:
            r = subprocess.run([sys.executable, "-I", str(clone / "tools" / "harness" / "auditar.py")], cwd=clone, capture_output=True, text=True, encoding="utf-8", errors="replace")
        else:
            r = subprocess.run([sys.executable, "-I", *cmd], cwd=estudo, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if r.returncode != 0:
            print(f"FALHOU {saida}: {r.stderr[-300:]}")
            ok = False
            continue
        novo = json.loads((estudo / "dados" / "processado" / saida).read_text(encoding="utf-8"))
        igual = limpa(novo) == limpa(publicado)
        if cmd is None:  # a auditoria tambem conta pastas locais fora do repositorio; so compara o que vem do repositorio
            ign = {"manifesto_arquivos", "pastas_em_C_dev_runs", "arquivos_brutos_modificados_apos_commit", "plano_execucoes_commits"}
            a = {k: v for k, v in limpa(novo).items() if k not in ign}
            b = {k: v for k, v in limpa(publicado).items() if k not in ign}
            igual = a == b
            if not igual:
                print("  campos diferentes:", {k: (a.get(k), b.get(k)) for k in set(a) | set(b) if a.get(k) != b.get(k)})
        print(f"{'IGUAL ' if igual else 'DIFERE'} {saida}")
        ok &= igual
    print("clone em", clone)
    print("REPRODUZIDO" if ok else "NAO REPRODUZIDO")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
