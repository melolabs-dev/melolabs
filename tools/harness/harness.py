#!/usr/bin/env python3
"""Harness das execuções do estudo haiku-sdd-producao.

  python tools/harness/harness.py prep <id> <variante>        cria a pasta limpa C:/dev/runs/<id> no commit base
  python tools/harness/harness.py score <id> <variante>       decifra os testes ocultos, roda, grava o resultado e apaga os testes
  python tools/harness/harness.py finish <id>                 copia diff e artefatos para dados/bruto/<id> e remove a pasta
  python tools/harness/harness.py audit <id> <arquivo...>     varre transcrições por nomes do gabarito
  python tools/harness/harness.py registro <id> <json>        acrescenta uma linha em dados/bruto/execucoes.jsonl
  python tools/harness/harness.py ordem <semente> <saida>     sorteia a ordem a partir de dados/bruto/plano-execucoes.json
  python tools/harness/harness.py cifrar                      cifra os testes ocultos e os patches (AES-256, chave fora do projeto)

Execuções em fila: este script nunca roda duas execuções ao mesmo tempo.
"""
import json
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STUDY = ROOT / "studies" / "haiku-sdd-producao"
GAB = STUDY / "gabarito"
CIF = STUDY / "gabarito-cifrado"
BRUTO = STUDY / "dados" / "bruto"
BASE_REPO = Path("C:/dev/h3-estudo")
RUNS = Path("C:/dev/runs")
BASE_COMMIT = "f0e17808ac2439b6434bb10609a961067f4d555b"
KEY = Path(os.path.expanduser("~")) / ".melolabs-gabarito.key"
PNPM = shutil.which("pnpm") or "pnpm"
OPENSSL = shutil.which("openssl") or "openssl"

# variante -> (issue, contrato, arquivos de teste ocultos)
VARIANTES = {
    "range-1267": ("1267", "range-1267.contrato.md", ["range-1267.test.ts", "range-1267.extras.test.ts"]),
    "problem-1384-a": ("1384", "problem-1384-a.contrato.md", ["problem-1384-a.test.ts"]),
    "problem-1384-b": ("1384", "problem-1384-b.contrato.md", ["problem-1384-b.test.ts"]),
    "problem-1384-c": ("1384", "problem-1384-c.contrato.md", ["problem-1384-c.test.ts"]),
    "session-1050-a": ("1050", "session-1050-a.contrato.md", ["session-1050-a.test.ts", "session-1050-a.extras.test.ts"]),
    "session-1050-b": ("1050", "session-1050-b.contrato.md", ["session-1050-b.test.ts", "session-1050-b.extras.test.ts"]),
}
FORBIDDEN = re.compile(r"gabarito|range-1267|session-1050|problem-1384|blog-tech|h3-ref|melolabs-gabarito|\.enc\b|extras\.test", re.I)

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def run(cmd, cwd=None, env=None, timeout=900, check=True):
    p = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    if check and p.returncode != 0:
        sys.exit(f"falhou ({p.returncode}): {' '.join(map(str, cmd))}\n{p.stdout[-800:]}\n{p.stderr[-800:]}")
    return p


def prep(rid, var):
    issue, contrato, _ = VARIANTES[var]
    d = RUNS / rid
    if d.exists():
        sys.exit(f"{d} já existe")
    RUNS.mkdir(parents=True, exist_ok=True)
    run(["git", "-c", "core.autocrlf=false", "-C", str(BASE_REPO), "worktree", "add", "--detach", str(d), BASE_COMMIT])
    run(["git", "-C", str(d), "config", "core.autocrlf", "false"])
    run([PNPM, "install", "--frozen-lockfile"], cwd=d)
    # O teste test/unit/cli.test.ts do h3 abre abas reais do navegador no Windows (rundll32), uma rodada de abas por suíte completa.
    # Foi o que consumiu a memória do Chrome em 05/11/2026. É removido da pasta da execução, igual para todas as condições.
    (d / "test" / "unit" / "cli.test.ts").unlink(missing_ok=True)
    (d / "sdd").mkdir()
    enun = (Path(__file__).parent / "enunciados" / f"issue-{issue}.md").read_text(encoding="utf-8")
    cont = (GAB / contrato).read_text(encoding="utf-8")
    # remove a nota de cabeçalho do contrato (cita "testes ocultos"); o modelo não deve saber que eles existem
    cont = "\n".join(l for l in cont.splitlines() if not l.startswith("> Texto para o enunciado"))
    (d / "sdd" / "pedido.md").write_text(enun + "\n\n---\n\n" + cont, encoding="utf-8")
    livre = shutil.disk_usage("C:/").free // 2**30
    print(f"pronto: {d} | disco livre {livre} GB")


def decrypt(name, out):
    src = CIF / (name + ".enc")
    if not src.exists():
        src = GAB / name  # antes da cifragem
        if not src.exists():
            return False
        shutil.copy(src, out)
        return True
    run([OPENSSL, "enc", "-d", "-aes-256-cbc", "-pbkdf2", "-in", str(src), "-out", str(out), "-pass", f"file:{KEY}"])
    return True


def score(rid, var):
    d = RUNS / rid
    _, _, tests = VARIANTES[var]
    out = BRUTO / rid
    out.mkdir(parents=True, exist_ok=True)
    obs = out / "observacoes.jsonl"
    env = dict(os.environ, H3_GABARITO_OBS_FILE=str(obs))
    res = {"id": rid, "variante": var, "quando": datetime.now().isoformat(timespec="seconds"), "testes": {}}
    copiados = []
    try:
        for t in tests:
            dst = d / "test" / t
            if decrypt(t, dst):
                copiados.append(dst)
        for dst in copiados:
            jf = Path(tempfile.gettempdir()) / f"vitest-{rid}-{dst.stem}.json"
            p = run([PNPM, "vitest", "run", f"test/{dst.name}", "--reporter=json", f"--outputFile={jf}"], cwd=d, env=env, check=False, timeout=900)
            try:
                j = json.loads(jf.read_text(encoding="utf-8"))
                for f in j.get("testResults", []):
                    for a in f.get("assertionResults", []):
                        res["testes"][f"{dst.name}::{a['fullName']}"] = a["status"]
                jf.unlink()
            except Exception as e:
                res["testes"][f"{dst.name}::ERRO"] = f"sem relatório: {e}; saída: {(p.stdout + p.stderr)[-300:]}"
        tc = run([PNPM, "typecheck"], cwd=d, check=False, timeout=900)
        res["typecheck_ok"] = tc.returncode == 0
        res["typecheck_tail"] = (tc.stdout + tc.stderr)[-600:] if tc.returncode else ""
        sv = run([PNPM, "vitest", "run", "--reporter=dot"], cwd=d, env=env, check=False, timeout=1800)
        # suíte completa inclui os testes ocultos copiados; o resumo é o que interessa
        m = re.findall(r"Tests\s+(.*)", sv.stdout + sv.stderr)
        res["suite_completa"] = m[-1].strip() if m else "sem resumo"
    finally:
        for dst in copiados:
            dst.unlink(missing_ok=True)
    # núcleo = testes que contam para aprovação (o resto é observação), segundo gabarito/classificacao.json
    import re as _re
    try:
        obs_ids = set(json.loads((GAB / "classificacao.json").read_text(encoding="utf-8"))["observacao"].get(var, []))
    except Exception:
        obs_ids = set()
    def _id(k):
        m = _re.search(r"(?<![A-Za-z0-9])([A-Z]\d{1,2})(?![A-Za-z0-9])", k.split("::", 1)[-1])
        return m.group(1) if m else None
    nuc = {k: v for k, v in res["testes"].items() if _id(k) not in obs_ids}
    res["nucleo_passaram"] = list(nuc.values()).count("passed")
    res["nucleo_total"] = len(nuc)
    st = list(res["testes"].values())
    res["passaram"] = st.count("passed")
    res["falharam"] = st.count("failed")
    res["total"] = len(st)
    (out / "score.json").write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{rid}: {res['passaram']}/{res['total']} passaram | typecheck_ok={res['typecheck_ok']} | suíte: {res['suite_completa']}")


def finish(rid):
    d = RUNS / rid
    out = BRUTO / rid
    out.mkdir(parents=True, exist_ok=True)
    run(["git", "-C", str(d), "add", "-A"], check=False)
    diff = run(["git", "-C", str(d), "diff", "--cached", "--", ".", ":(exclude)sdd", ":(exclude)test/unit/cli.test.ts"], check=False).stdout
    (out / "codigo.diff").write_text(diff, encoding="utf-8")
    if (d / "sdd").exists():
        shutil.copytree(d / "sdd", out / "sdd", dirs_exist_ok=True)
    run(["git", "-C", str(BASE_REPO), "worktree", "remove", "--force", str(d)], check=False)
    print(f"{rid}: diff {len(diff)} bytes, artefatos copiados, pasta removida")


def audit(rid, files):
    bad = []
    for f in files:
        txt = Path(f).read_text(encoding="utf-8", errors="replace")
        for m in FORBIDDEN.finditer(txt):
            a = max(0, m.start() - 60)
            bad.append(f"{Path(f).name}: ...{txt[a:m.end() + 60]!r}")
            if len(bad) > 8:
                break
    out = BRUTO / rid
    out.mkdir(parents=True, exist_ok=True)
    (out / "auditoria.json").write_text(json.dumps({"limpo": not bad, "ocorrencias": bad}, ensure_ascii=False, indent=2), encoding="utf-8")
    print("LIMPO" if not bad else f"VAZAMENTO? {len(bad)} ocorrência(s):\n" + "\n".join(bad))


def registro(rid, js):
    BRUTO.mkdir(parents=True, exist_ok=True)
    row = {"id": rid, "registrado_em": datetime.now().isoformat(timespec="seconds")}
    row.update(json.loads(js))
    with open(BRUTO / "execucoes.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print("ok")


def etapa(rid, et, cond, modelo, var, rep, tokens, tools, dur, agent, gate="null", rodadas="0", obs=""):
    import glob
    tmp = os.environ.get("TEMP", tempfile.gettempdir())
    achados = glob.glob(os.path.join(tmp, "claude", "*", "*", "tasks", agent + ".output"))
    mem = None
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-c", "[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,2)"], capture_output=True, text=True).stdout.strip().replace(",", ".")
        mem = float(out)
    except Exception:
        pass
    row = {"etapa": et, "variante": var, "condicao": cond, "modelo": modelo, "modelo_efetivo": "nao informado",
           "repeticao": int(rep), "tokens_totais": int(tokens), "chamadas_ferramenta": int(tools), "duracao_s": float(dur),
           "mem_livre_gb": mem, "falha_infra": False, "rodadas_correcao": int(rodadas), "escalonou": False,
           "gate_ok": None if gate == "null" else gate == "true", "obs": obs, "transcricao": achados[0].replace("\\", "/") if achados else None}
    registro(rid, json.dumps(row, ensure_ascii=False))


def proxima():
    plano = json.loads((BRUTO / "plano-execucoes.json").read_text(encoding="utf-8"))
    feitas = {p.parent.name for p in BRUTO.glob("*/score.json")}
    pend = [x for x in plano if x["id"] not in feitas]
    print(f"{len(plano) - len(pend)} de {len(plano)} feitas")
    if pend:
        print(json.dumps(pend[0], ensure_ascii=False))
    for ph in ("A", "B"):
        print(f"fase {ph}: {sum(1 for x in pend if x['fase'] == ph)} pendentes")


def ordem(seed, saida):
    plano = json.loads((BRUTO / "plano-execucoes.json").read_text(encoding="utf-8"))
    rnd = random.Random(int(seed))
    itens = list(plano)
    rnd.shuffle(itens)
    Path(saida).write_text(json.dumps(itens, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(itens)} execuções, semente {seed}")


def cifrar():
    if not KEY.exists():
        KEY.write_text(run([OPENSSL, "rand", "-hex", "32"]).stdout.strip(), encoding="utf-8")
        print(f"chave criada em {KEY} (fora do projeto; guarde uma cópia)")
    CIF.mkdir(exist_ok=True)
    arquivos = [p for p in GAB.glob("*.test.ts")] + [p for p in (GAB / "referencia").glob("*.patch")]
    for p in arquivos:
        run([OPENSSL, "enc", "-aes-256-cbc", "-pbkdf2", "-salt", "-in", str(p), "-out", str(CIF / (p.name + ".enc")), "-pass", f"file:{KEY}"])
    # confere a decifragem antes de qualquer remoção
    for p in arquivos:
        tmp = Path(tempfile.gettempdir()) / ("chk-" + p.name)
        run([OPENSSL, "enc", "-d", "-aes-256-cbc", "-pbkdf2", "-in", str(CIF / (p.name + ".enc")), "-out", str(tmp), "-pass", f"file:{KEY}"])
        assert tmp.read_bytes() == p.read_bytes(), p.name
        tmp.unlink()
    print(f"{len(arquivos)} arquivos cifrados e conferidos em {CIF}")


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    c = a[0]
    if c == "prep":
        prep(a[1], a[2])
    elif c == "score":
        score(a[1], a[2])
    elif c == "finish":
        finish(a[1])
    elif c == "audit":
        audit(a[1], a[2:])
    elif c == "registro":
        registro(a[1], a[2])
    elif c == "etapa":
        etapa(*a[1:])
    elif c == "proxima":
        proxima()
    elif c == "ordem":
        ordem(a[1], a[2])
    elif c == "cifrar":
        cifrar()
    else:
        sys.exit(__doc__)
