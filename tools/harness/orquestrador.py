#!/usr/bin/env python3
"""Orquestrador determinístico do estudo haiku-sdd-producao (substitui a orquestração manual do piloto).

Cada etapa é um processo `claude -p` novo (contexto limpo), com modelo explícito, ferramentas restritas,
diretório de trabalho na pasta da execução e a transcrição completa (stream-json) gravada em disco.
O consumo vem do campo `usage` real (entrada, saída, cache criado e cache lido), não do tamanho final do contexto.

  python tools/harness/orquestrador.py unica <id> <condicao> <variante>   roda uma execução completa
  python tools/harness/orquestrador.py plano [--fase A|B|T] [--max N]     roda o plano em fila (retoma de onde parou)
  python tools/harness/orquestrador.py esperado                           gera gabarito/esperado.json (testes esperados por variante)
  python tools/harness/orquestrador.py resumo                             resumo do que já foi coletado
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
import gates as G  # noqa: E402
import harness as H  # noqa: E402

STUDY = ROOT / "studies" / "haiku-sdd-producao"
BRUTO = STUDY / "dados" / "bruto"
GAB = STUDY / "gabarito"
BASE_REPO = Path("C:/dev/h3-estudo")
RUNS = Path("C:/dev/runs")
BASE_COMMIT = H.BASE_COMMIT
CLAUDE = shutil.which("claude") or "claude"
PNPM = shutil.which("pnpm") or "pnpm"

ALLOWED = ["Read", "Edit", "Write", "Glob", "Grep", "Bash(pnpm *)", "Bash(node *)", "Bash(npx *)", "Bash(ls *)", "Bash(pwd)",
           "Bash(cat *)", "Bash(head *)", "Bash(tail *)", "Bash(wc *)", "Bash(grep *)", "Bash(rg *)", "Bash(find *)",
           "Bash(git status*)", "Bash(git diff*)", "Bash(git log*)", "Bash(git show*)", "Bash(mkdir *)", "Bash(rm *)", "Bash(mv *)", "Bash(cp *)"]
DISALLOWED = ["WebFetch", "WebSearch", "Agent", "PowerShell", "Task", "NotebookEdit"]
PROIBIDO = re.compile(r"gabarito|blog-tech|h3-ref|melolabs|\.enc\b|range-1267|session-1050|problem-1384|esperado\.json|classificacao|\.melolabs|OneDrive", re.I)

MODELO = {"C0": "sonnet", "C1": "haiku", "C4": "haiku", "C2": "haiku", "C2n": "haiku", "C5": "haiku", "C6": "haiku",
          "C10": "haiku", "C11": "haiku", "C12": "haiku", "C13": "haiku"}

COMUM = ("Trabalhe somente dentro da pasta {RUN} (um clone do projeto h3). Não leia, liste nem procure arquivos fora dela. "
         "Leia o CLAUDE.md e o AGENTS.md dessa pasta antes de começar. Responda no final com no máximo 5 linhas: o que foi feito e se algo ficou pendente.")

ETAPAS = {
    "prd": ("Leia sdd/pedido.md. Escreva o PRD em sdd/prd.md, em português, com: problema e objetivo; requisitos funcionais, cada um com cabeçalho "
            "`### RF-NN — título` e um critério de aceite no formato Dado/Quando/Então; seção \"Fora de escopo\"; premissas e riscos. Não altere o código do projeto."),
    "techspec": ("Leia sdd/pedido.md, sdd/prd.md e o código relevante do projeto. Escreva a especificação técnica em sdd/techspec.md, em português, com: decisões de "
                 "arquitetura, cada uma com cabeçalho `### D-NN — título`, alternativas consideradas e a escolha justificada; arquivos a alterar com citações no formato "
                 "`caminho/arquivo.ts:linha` conferidas no código; contratos e assinaturas; estratégia de testes; riscos. Não altere o código do projeto."),
    "tasks": ("Leia sdd/prd.md e sdd/techspec.md. Escreva as tarefas de implementação em sdd/tasks.md, em português. Cada tarefa tem cabeçalho `### T-NN — título` e os "
              "campos `Cobre:` (ids RF-NN), `Arquivos:` (rodapé com os arquivos que a tarefa toca), `Depende de:` (ids de tarefa ou \"nenhuma\") e `Aceite:` (como verificar). "
              "Todo requisito do PRD deve ser coberto por pelo menos uma tarefa. Não altere o código do projeto."),
    "codigo": ("Implemente a feature seguindo sdd/techspec.md e sdd/tasks.md. Rode `pnpm typecheck` e os testes existentes relacionados ao que você alterou e corrija o que "
               "quebrar. Não crie arquivos de documentação além dos de sdd/."),
    "codigo_tdd": ("Implemente a feature seguindo sdd/techspec.md e sdd/tasks.md, nesta ordem: (1) escreva primeiro testes de aceite em `test/sdd-<nome>.test.ts`, derivados do "
                   "PRD e da TechSpec, no estilo dos testes existentes do projeto; rode-os e confirme que falham; (2) implemente; (3) rode os testes que você escreveu, "
                   "`pnpm typecheck` e os testes existentes relacionados, e repita a correção usando a saída real do comando, no máximo 3 rodadas. "
                   "Não crie arquivos de documentação além dos de sdd/."),
}
CORRECAO = ("O gate determinístico reprovou `sdd/{ARQ}` com estes erros reais:\n\n{ERROS}\n\nCorrija somente esses pontos em `sdd/{ARQ}`, mantendo o resto. "
            "Não altere o código do projeto.")
AUTORREVISAO = "Releia o documento sdd/{ARQ} e melhore o que achar que está fraco, sem consultar nenhum comando ou ferramenta de verificação."
CORRECAO_CODIGO = ("A verificação reprovou o código com esta saída real:\n\n{ERROS}\n\nCorrija o código para que `pnpm typecheck` passe e os testes existentes "
                   "continuem passando. Não crie arquivos de documentação além dos de sdd/.")

PERSONA = {
    "prd": "Você é uma gerente de produto sênior, com anos de experiência em frameworks HTTP e bibliotecas de código aberto, e escreve requisitos que um engenheiro consegue testar sem perguntar nada.",
    "techspec": "Você é um arquiteto de software sênior de TypeScript e de plataformas web, e escreve especificações técnicas que um engenheiro pleno implementa sem ambiguidade.",
    "tasks": "Você é uma tech lead que quebra especificações em tarefas pequenas, independentes e verificáveis.",
    "codigo": "Você é um engenheiro sênior de TypeScript, e entrega código pequeno, testado e compatível com o que já existe.",
}
CONTEXTO = ("Contexto do projeto: o h3 é um framework HTTP mínimo e de alto desempenho, baseado nos primitivos padrão da web (Request, Response, URL, Headers), "
            "que roda em Node.js, Bun, Deno e Cloudflare Workers. O código-fonte fica em src/, os testes em test/ (vitest, executados nos alvos web e node por meio de "
            "describeMatrix) e as convenções do projeto estão no AGENTS.md e no CLAUDE.md. O projeto usa TypeScript, pnpm, oxlint e oxfmt. Os módulos públicos são "
            "exportados por src/index.ts. O repositório mantém poucas dependências e prioriza a compatibilidade entre runtimes e a retrocompatibilidade da API pública.")
CONTROLE = ("Observações gerais sobre organização de trabalho: documentos costumam ser lidos de cima para baixo, por isso vale começar pelo mais importante. Frases curtas "
            "ajudam a leitura, e listas ajudam quando há itens paralelos. Revisar o texto antes de entregar costuma melhorar a clareza. Vale usar nomes consistentes para as "
            "mesmas coisas ao longo do documento e manter a formatação uniforme. Ao trabalhar em equipe, é útil registrar decisões e combinar quem confere cada parte. "
            "Trabalhos longos se beneficiam de pausas regulares, e um ambiente organizado reduz erros de distração. Também ajuda manter anotações do que já foi feito, "
            "para não repetir esforço, e reservar tempo no fim para uma leitura final com calma.")


def bloco(cond, etapa):
    """Bloco inserido depois da regra comum (H11)."""
    e = "codigo" if etapa.startswith("codigo") else etapa
    if cond == "C10":
        return PERSONA[e]
    if cond == "C11":
        return CONTEXTO
    if cond == "C12":
        return PERSONA[e] + " " + CONTEXTO
    if cond == "C13":
        return CONTROLE
    return ""


def monta_prompt(cond, etapa, run, extra=None):
    partes = [COMUM.format(RUN=run)]
    b = bloco(cond, etapa) if etapa in ETAPAS else ""
    if b:
        partes.append(b)
    partes.append(extra if extra is not None else ETAPAS[etapa])
    return "\n\n".join(partes)


# ---------------------------------------------------------------- execução de uma etapa
def mem_livre_gb():
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-c", "[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,2)"],
                             capture_output=True, text=True, timeout=30).stdout.strip().replace(",", ".")
        return float(out)
    except Exception:
        return None


def espera_memoria(minimo=3.0, max_min=15):
    t0 = time.time()
    while True:
        m = mem_livre_gb()
        if m is None or m >= minimo or time.time() - t0 > max_min * 60:
            return m
        time.sleep(30)


def parse_stream(texto):
    """Extrai do stream-json: resultado final, usos e ferramentas."""
    res, tools, acessos = None, 0, []
    for linha in texto.splitlines():
        linha = linha.strip()
        if not linha.startswith("{"):
            continue
        try:
            ev = json.loads(linha)
        except Exception:
            continue
        if ev.get("type") == "result":
            res = ev
        elif ev.get("type") == "assistant":
            for c in (ev.get("message", {}).get("content") or []):
                if isinstance(c, dict) and c.get("type") == "tool_use":
                    tools += 1
                    acessos.append(json.dumps(c.get("input", {}), ensure_ascii=False))
    return res, tools, acessos


def etapa_claude(rid, run, nome, modelo, prompt, tentativa=1, timeout=2400):
    out_dir = BRUTO / rid / "transcricoes"
    out_dir.mkdir(parents=True, exist_ok=True)
    base = f"{nome}-t{tentativa}"
    (out_dir / f"{base}.prompt.txt").write_text(prompt, encoding="utf-8")
    cmd = [CLAUDE, "-p", "--model", modelo, "--output-format", "stream-json", "--verbose", "--setting-sources", "project",
           "--strict-mcp-config", "--permission-mode", "acceptEdits", "--no-session-persistence",
           "--allowedTools", *ALLOWED, "--disallowedTools", *DISALLOWED]
    mem = espera_memoria()
    t0 = time.time()
    inicio = datetime.now().isoformat(timespec="seconds")
    try:
        p = subprocess.run(cmd, input=prompt, cwd=str(run), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
        saida, err, rc = p.stdout, p.stderr, p.returncode
    except subprocess.TimeoutExpired as e:
        saida, err, rc = (e.stdout or ""), "timeout", 124
        if isinstance(saida, bytes):
            saida = saida.decode("utf-8", "replace")
    dur = time.time() - t0
    (out_dir / f"{base}.jsonl").write_text(saida, encoding="utf-8")
    res, tools, acessos = parse_stream(saida)
    rs = str(run).replace("\\", "\\\\")
    suspeito = [a[:160] for a in acessos if PROIBIDO.search(a.replace(rs, "").replace(str(run), ""))]
    row = {"id": rid, "etapa": nome, "tentativa": tentativa, "modelo": modelo, "inicio": inicio, "duracao_s": round(dur, 1),
           "mem_livre_gb": mem, "chamadas_ferramenta": tools, "prompt_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:16],
           "transcricao": str((out_dir / f"{base}.jsonl").relative_to(ROOT)).replace("\\", "/"), "acessos_suspeitos": suspeito,
           "falha_infra": False, "returncode": rc}
    if res and not res.get("is_error"):
        u = res.get("usage", {})
        mu = res.get("modelUsage", {})
        iters = u.get("iterations") or []
        row.update({
            "modelo_efetivo": ",".join(mu.keys()), "tokens_entrada": u.get("input_tokens", 0), "tokens_saida": u.get("output_tokens", 0),
            "tokens_cache_criado": u.get("cache_creation_input_tokens", 0), "tokens_cache_lido": u.get("cache_read_input_tokens", 0),
            "tokens_totais": sum(u.get(k, 0) for k in ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")),
            "tokens_novos": sum(u.get(k, 0) for k in ("input_tokens", "output_tokens", "cache_creation_input_tokens")),
            "maior_prompt": max([(i.get("input_tokens", 0) + i.get("cache_read_input_tokens", 0) + i.get("cache_creation_input_tokens", 0)) for i in iters] or [0]),
            "custo_usd_lista": res.get("total_cost_usd"), "turnos": res.get("num_turns"), "duracao_api_ms": res.get("duration_api_ms"),
            "negacoes": len(res.get("permission_denials", [])), "resposta_final": (res.get("result") or "")[:600]})
    else:
        row["falha_infra"] = True
        row["erro"] = ((res or {}).get("result") or err or "sem resultado")[:400]
    with open(BRUTO / "execucoes.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
    return row


def etapa_robusta(rid, run, nome, modelo, prompt, max_tent=3):
    for t in range(1, max_tent + 1):
        row = etapa_claude(rid, run, nome, modelo, prompt, tentativa=t)
        if not row["falha_infra"]:
            return row
        txt = (row.get("erro") or "").lower()
        espera = 600 if any(k in txt for k in ("limit", "rate", "quota", "usage", "overloaded")) else 60
        time.sleep(espera)
    return row


# ---------------------------------------------------------------- preparo e gates
def export_base(run):
    run.mkdir(parents=True, exist_ok=True)
    p1 = subprocess.Popen(["git", "-C", str(BASE_REPO), "archive", BASE_COMMIT], stdout=subprocess.PIPE)
    r = subprocess.run(["tar", "-x", "-C", str(run)], stdin=p1.stdout, capture_output=True, text=True)
    p1.wait()
    # links simbólicos do repositório (docs/5.migration/0.index.md aponta para MIGRATION.md) não existem no Windows: vira cópia
    if r.returncode != 0:
        outros = [l for l in r.stderr.splitlines() if l.strip() and "Can't create" not in l and "Error exit delayed" not in l]
        if outros:
            raise RuntimeError("tar falhou: " + " | ".join(outros[:3]))
    mig = run / "docs" / "5.migration" / "0.index.md"
    if not mig.exists() and (run / "MIGRATION.md").exists():
        mig.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(run / "MIGRATION.md", mig)


def pasta(rid):
    """Nome opaco: a pasta da execução não revela condição nem variante."""
    return RUNS / ("r" + hashlib.sha1(rid.encode("utf-8")).hexdigest()[:10])


def prep(rid, var):
    run = pasta(rid)
    if run.exists():
        shutil.rmtree(run, ignore_errors=True)
    export_base(run)
    (run / "test" / "unit" / "cli.test.ts").unlink(missing_ok=True)
    issue, contrato, _ = H.VARIANTES[var]
    enun = (HERE / "enunciados" / f"issue-{issue}.md").read_text(encoding="utf-8")
    cont = (GAB / "enxuto" / contrato).read_text(encoding="utf-8")
    (run / "sdd").mkdir(exist_ok=True)
    (run / "sdd" / "pedido.md").write_text(enun + "\n\n---\n\n" + cont, encoding="utf-8")
    env = dict(os.environ)
    subprocess.run(["git", "init", "-q"], cwd=run, check=True)
    subprocess.run(["git", "config", "core.autocrlf", "false"], cwd=run, check=True)
    subprocess.run(["git", "config", "user.email", "estudo@example.invalid"], cwd=run, check=True)
    subprocess.run(["git", "config", "user.name", "estudo"], cwd=run, check=True)
    subprocess.run([PNPM, "install", "--frozen-lockfile"], cwd=run, check=True, capture_output=True, timeout=900, env=env)
    subprocess.run(["git", "add", "-A"], cwd=run, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-q", "-m", "base"], cwd=run, check=True, capture_output=True)
    return run


NOMES_PUBLICOS = {
    "range-1267": ["serveStatic"],
    "problem-1384-a": ["problemDetails", "HTTPError"],
    "problem-1384-b": ["HTTPError"],
    "problem-1384-c": ["problem", "HTTPError"],
    "session-1050-a": ["SessionConfig", "password"],
    "session-1050-b": ["SessionConfig", "extraUnsealPasswords"],
}


def nomes_publicos(var):
    return NOMES_PUBLICOS[var]


def gate(var, tipo, run):
    erros = []
    try:
        erros += G.GATES[tipo](run)
    except FileNotFoundError as e:
        erros.append(f"arquivo ausente: {Path(str(e)).name}")
    if tipo == "techspec" and not erros:
        txt = (run / "sdd" / "techspec.md").read_text(encoding="utf-8")
        falt = [n for n in nomes_publicos(var) if n not in txt]
        if falt:
            erros.append("a TechSpec não menciona os nomes públicos do contrato: " + ", ".join(falt))
    if tipo == "tasks" and not erros:
        txt = (run / "sdd" / "tasks.md").read_text(encoding="utf-8")
        for m in re.finditer(r"(?im)^\s*\**arquivos:?\**:?\s*(.+)$", txt):
            for f in re.findall(r"[\w./@-]+\.(?:ts|mts|js|json|md)", m.group(1)):
                if not (run / f).exists() and not f.startswith(("src/", "test/", "docs/", "sdd/")):
                    erros.append(f"tarefa cita arquivo que não existe e fora de src/test/docs: {f}")
    return erros


def doc(rid, run, var, cond, nome, modelo_padrao, tent_doc):
    """Gera um documento aplicando gate e as regras da condição. Devolve (linhas_de_registro, gate_ok)."""
    arq = f"{nome}.md"
    modelo = modelo_padrao
    prompt = monta_prompt(cond, nome, str(run))
    etapa_robusta(rid, run, nome, modelo, prompt)
    erros = gate(var, nome, run)
    primeira = not erros
    rodadas = 0
    if cond in ("C2", "C4", "C5"):
        while erros and rodadas < 2:
            rodadas += 1
            etapa_robusta(rid, run, f"{nome}-correcao{rodadas}", modelo, monta_prompt(cond, nome, str(run), CORRECAO.format(ARQ=arq, ERROS="\n".join("- " + e for e in erros))))
            erros = gate(var, nome, run)
        if erros and cond == "C5":
            etapa_robusta(rid, run, f"{nome}-escalonado", "sonnet", monta_prompt(cond, nome, str(run)))
            erros = gate(var, nome, run)
            tent_doc["escalonou"] = True
    if cond == "C2n":
        etapa_robusta(rid, run, f"{nome}-autorrevisao", modelo, monta_prompt(cond, nome, str(run), AUTORREVISAO.format(ARQ=arq)))
        erros = gate(var, nome, run)
    tent_doc[nome] = {"gate_primeira_tentativa": primeira, "rodadas": rodadas, "gate_final": not erros}
    return not erros


def resumo_codigo(run):
    d = subprocess.run(["git", "add", "-A"], cwd=run, capture_output=True)
    diff = subprocess.run(["git", "diff", "--cached", "--", ".", ":(exclude)sdd"], cwd=run, capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
    return diff


def typecheck(run):
    p = subprocess.run([PNPM, "typecheck"], cwd=run, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900)
    return p.returncode == 0, (p.stdout + p.stderr)[-1500:]


def lint(run):
    p = subprocess.run([PNPM, "exec", "oxlint", "."], cwd=run, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900)
    return p.returncode == 0


def pontua(rid, run, var):
    """Pontua com os testes ocultos; teste esperado ausente conta como falha."""
    exp = json.loads((GAB / "esperado.json").read_text(encoding="utf-8")).get(var, {})
    obs_ids = set(json.loads((GAB / "classificacao.json").read_text(encoding="utf-8"))["observacao"].get(var, []))
    out = BRUTO / rid
    obs = out / "observacoes.jsonl"
    env = dict(os.environ, H3_GABARITO_OBS_FILE=str(obs))
    res = {"id": rid, "variante": var, "quando": datetime.now().isoformat(timespec="seconds"), "testes": {}, "arquivos": {}}
    copiados = []
    try:
        for t in H.VARIANTES[var][2]:
            dst = run / "test" / t
            if H.decrypt(t, dst):
                copiados.append(dst)
        for dst in copiados:
            jf = Path(tempfile.gettempdir()) / f"vitest-{rid}-{dst.stem}.json"
            p = subprocess.run([PNPM, "vitest", "run", f"test/{dst.name}", "--reporter=json", f"--outputFile={jf}"], cwd=run, env=env,
                               capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1200)
            try:
                j = json.loads(jf.read_text(encoding="utf-8"))
                jf.unlink()
                for f in j.get("testResults", []):
                    res["arquivos"][dst.name] = f.get("status")
                    for a in f.get("assertionResults", []):
                        res["testes"][f"{dst.name}::{a['fullName']}"] = a["status"]
            except Exception as e:
                res["arquivos"][dst.name] = f"sem relatorio: {e}"
        tc_ok, tc_tail = typecheck(run)
        res["typecheck_ok"] = tc_ok
        res["lint_ok"] = lint(run)
    finally:
        for dst in copiados:
            dst.unlink(missing_ok=True)
    # testes esperados que não apareceram contam como falha
    for arq, nomes in exp.items():
        for n in nomes:
            res["testes"].setdefault(f"{arq}::{n}", "falhou_ausente")

    def idv(k):
        m = re.search(r"(?<![A-Za-z0-9])([A-Z]\d{1,2})(?![A-Za-z0-9])", k.split("::", 1)[-1])
        return m.group(1) if m else None
    nuc = {k: v for k, v in res["testes"].items() if idv(k) not in obs_ids}
    res["nucleo_passaram"] = list(nuc.values()).count("passed")
    res["nucleo_total"] = len(nuc)
    res["nucleo_esperado"] = sum(1 for arq, nomes in exp.items() for n in nomes if idv(f"{arq}::{n}") not in obs_ids)
    res["nucleo_100"] = bool(nuc) and res["nucleo_passaram"] == res["nucleo_total"] == res["nucleo_esperado"] and res.get("typecheck_ok") and res.get("lint_ok")
    res["passaram"] = list(res["testes"].values()).count("passed")
    res["total"] = len(res["testes"])
    (out / "score.json").write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
    return res


# ---------------------------------------------------------------- execução completa
def unica(rid, cond, var):
    out = BRUTO / rid
    if (out / "concluida.json").exists():
        return json.loads((out / "concluida.json").read_text(encoding="utf-8"))
    out.mkdir(parents=True, exist_ok=True)
    purga(rid)
    run = prep(rid, var)
    meta = {"id": rid, "condicao": cond, "variante": var, "inicio": datetime.now().isoformat(timespec="seconds")}
    info = {}
    m = MODELO[cond]
    modelos = {"prd": m, "techspec": m, "tasks": m}
    if cond == "C6":
        modelos["techspec"] = "sonnet"
    for nome in ("prd", "techspec", "tasks"):
        doc(rid, run, var, cond, nome, modelos[nome], info)
    cod = "codigo_tdd" if cond in ("C4", "C5") else "codigo"
    etapa_robusta(rid, run, "codigo", m, monta_prompt(cond, cod, str(run)))
    ok, tail = typecheck(run)
    if cond == "C5" and not ok:
        etapa_robusta(rid, run, "codigo-escalonado", "sonnet", monta_prompt(cond, "codigo", str(run), CORRECAO_CODIGO.format(ERROS=tail)))
        info["escalonou_codigo"] = True
    diff = resumo_codigo(run)
    sc = pontua(rid, run, var)
    (out / "codigo.diff").write_text(diff, encoding="utf-8")
    if (run / "sdd").exists():
        shutil.copytree(run / "sdd", out / "sdd", dirs_exist_ok=True)
    # auditoria real: acessos suspeitos e transcrições não vazias
    trans = list((out / "transcricoes").glob("*.jsonl"))
    vazias = [t.name for t in trans if t.stat().st_size < 200]
    suspeitos = []
    for linha in open(BRUTO / "execucoes.jsonl", encoding="utf-8"):
        r = json.loads(linha)
        if r["id"] == rid and r.get("acessos_suspeitos"):
            suspeitos += r["acessos_suspeitos"]
    aud = {"limpo": (not suspeitos) and (not vazias) and bool(trans), "acessos_suspeitos": suspeitos[:10], "transcricoes_vazias": vazias, "n_transcricoes": len(trans)}
    (out / "auditoria.json").write_text(json.dumps(aud, ensure_ascii=False, indent=2), encoding="utf-8")
    shutil.rmtree(run, ignore_errors=True)
    meta.update({"fim": datetime.now().isoformat(timespec="seconds"), "documentos": info, "nucleo": f"{sc['nucleo_passaram']}/{sc['nucleo_total']}",
                 "nucleo_100": sc["nucleo_100"], "auditoria_limpa": aud["limpo"]})
    (out / "concluida.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return meta


def purga(rid):
    """Descarta o que sobrou de uma execução interrompida (sem marca de concluída), para o reinício ser limpo."""
    f = BRUTO / "execucoes.jsonl"
    if f.exists():
        mantidas = [l for l in open(f, encoding="utf-8") if json.loads(l).get("id") != rid]
        open(f, "w", encoding="utf-8").write("".join(mantidas))
    shutil.rmtree(BRUTO / rid / "transcricoes", ignore_errors=True)
    for nome in ("score.json", "auditoria.json", "codigo.diff", "observacoes.jsonl"):
        (BRUTO / rid / nome).unlink(missing_ok=True)


def linhas_run(rid):
    rows = [json.loads(l) for l in open(BRUTO / "execucoes.jsonl", encoding="utf-8") if f'"{rid}"' in l]
    return [r for r in rows if r["id"] == rid and not r.get("falha_infra")]


def resumo_run(rid):
    rows = linhas_run(rid)
    tok = sum(r.get("tokens_totais", 0) for r in rows)
    novos = sum(r.get("tokens_novos", 0) for r in rows)
    custo = sum(r.get("custo_usd_lista") or 0 for r in rows)
    dur = sum(r.get("duracao_s", 0) for r in rows)
    return dict(tokens_totais=tok, tokens_novos=novos, custo_usd=round(custo, 3), duracao_s=round(dur), chamadas=sum(r.get("chamadas_ferramenta", 0) for r in rows), etapas=len(rows))


def plano(fase=None, maximo=None, arquivo="plano-execucoes.json"):
    pl = json.loads((BRUTO / arquivo).read_text(encoding="utf-8"))
    n = 0
    for it in pl:
        if fase and it["fase"] != fase:
            continue
        if (BRUTO / it["id"] / "concluida.json").exists():
            continue
        if maximo is not None and n >= maximo:
            break
        t0 = time.time()
        meta = unica(it["id"], it["condicao"], it["variante"])
        n += 1
        r = resumo_run(it["id"])
        print(f"[{it['ordem']}/{len(pl)}] {it['id']}: núcleo {meta['nucleo']} | auditoria limpa={meta['auditoria_limpa']} | "
              f"tokens {r['tokens_totais']:,} (novos {r['tokens_novos']:,}) | US$ {r['custo_usd']} | {r['duracao_s']} s | {r['chamadas']} ferramentas", flush=True)
    print("fim do lote:", n, "execuções")


def esperado():
    """Roda o conjunto oculto no commit base (sem a feature) e grava os nomes de todos os testes esperados."""
    resultado = {}
    for var, (_, _, arqs) in H.VARIANTES.items():
        rid = f"esperado-{var}"
        out = BRUTO / rid
        out.mkdir(parents=True, exist_ok=True)
        run = prep(rid, var)
        copiados = []
        nomes = {}
        try:
            for t in arqs:
                dst = run / "test" / t
                if H.decrypt(t, dst):
                    copiados.append(dst)
            for dst in copiados:
                jf = Path(tempfile.gettempdir()) / f"esp-{var}-{dst.stem}.json"
                subprocess.run([PNPM, "vitest", "run", f"test/{dst.name}", "--reporter=json", f"--outputFile={jf}"], cwd=run, capture_output=True, text=True, timeout=1200)
                j = json.loads(jf.read_text(encoding="utf-8"))
                jf.unlink()
                nomes[dst.name] = sorted(a["fullName"] for f in j.get("testResults", []) for a in f.get("assertionResults", []))
        finally:
            for dst in copiados:
                dst.unlink(missing_ok=True)
        resultado[var] = nomes
        shutil.rmtree(run, ignore_errors=True)
        shutil.rmtree(out, ignore_errors=True)
        print(var, {k: len(v) for k, v in nomes.items()}, flush=True)
    (GAB / "esperado.json").write_text(json.dumps(resultado, ensure_ascii=False, indent=1), encoding="utf-8")


def mini():
    """Mini-piloto 2 (adendo 1): contrato enxuto, C0 e C1, duas variantes, duas repetições."""
    import random
    itens = [(c, v, r) for c in ("C0", "C1") for v in ("range-1267", "session-1050-b") for r in (1, 2)]
    random.Random(20261106).shuffle(itens)
    for c, v, r in itens:
        rid = f"mini-{c}-{v}-r{r}"
        meta = unica(rid, c, v)
        x = resumo_run(rid)
        print(f"{rid}: núcleo {meta['nucleo']} | auditoria limpa={meta['auditoria_limpa']} | tokens {x['tokens_totais']:,} (novos {x['tokens_novos']:,}) | "
              f"US$ {x['custo_usd']} | {x['duracao_s']} s | {x['chamadas']} ferramentas", flush=True)


def resumo():
    feitas = sorted(p.parent.name for p in BRUTO.glob("*/concluida.json"))
    print(len(feitas), "execuções concluídas")
    for rid in feitas:
        m = json.loads((BRUTO / rid / "concluida.json").read_text(encoding="utf-8"))
        r = resumo_run(rid)
        print(rid, m["nucleo"], r["tokens_totais"], r["custo_usd"], r["duracao_s"])


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    if a[0] == "unica":
        print(json.dumps(unica(a[1], a[2], a[3]), ensure_ascii=False))
    elif a[0] == "plano":
        fase = a[a.index("--fase") + 1] if "--fase" in a else None
        mx = int(a[a.index("--max") + 1]) if "--max" in a else None
        plano(fase, mx, a[a.index("--plano") + 1] if "--plano" in a else "plano-execucoes.json")
    elif a[0] == "mini":
        mini()
    elif a[0] == "esperado":
        esperado()
    elif a[0] == "resumo":
        resumo()
    else:
        sys.exit(__doc__)
