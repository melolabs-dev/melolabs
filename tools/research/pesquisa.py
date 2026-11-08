#!/usr/bin/env python3
"""Protocolo de pesquisa do Melo Labs: cria o estudo, confere o progresso e gera relatórios.

  python tools/research/pesquisa.py new <slug> "Título" [--congelar AAAA-MM-DD]
  python tools/research/pesquisa.py status [<slug>]        # progresso, o que falta, prazo
  python tools/research/pesquisa.py done <slug> <passo> "evidência"   # só passos manuais
  python tools/research/pesquisa.py aprovar <slug> <passo> "decisão do autor"   # passos marcados como decisão do autor
  python tools/research/pesquisa.py links <slug>           # confere se as URLs das fontes respondem
  python tools/research/pesquisa.py report [<slug>]        # grava PROGRESSO.md (e studies/INDEX.md)
  python tools/research/pesquisa.py render                 # gera docs/protocolo-de-pesquisa.(md|html)

Regra central: o que a máquina consegue conferir é conferido por ela (arquivo preenchido, fontes, hipóteses, dados).
Um passo conferido por máquina não pode ser marcado à mão. Só os passos manuais aceitam `done`, e exigem evidência.
"""
import html as htmllib
import json
import re
import sys
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "rag"))
from rag import parse_note  # noqa: E402

PROTO = json.loads((ROOT / "research" / "protocolo.json").read_text(encoding="utf-8"))
STUDIES = ROOT / "studies"
OK_STATUS = {"confirmada", "refutada", "equivalente", "subpotente", "nao informativa", "nao testada", "nao testavel", "descritiva"}  # adendo 1: estes status sao permitidos

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# ---------- modelos de arquivo criados por `new` ----------
TEMPLATES = {
    "premissa.md": """# Premissa e pergunta de pesquisa

## Premissa
TODO: o que se acredita ser verdade hoje e por quê (uma frase, com a fonte).

## Pergunta de pesquisa
TODO: uma pergunta que dados conseguem responder.

## Decisão que o resultado informa
TODO: que escolha técnica muda conforme a resposta (e quem a toma).

## Escopo e fora de escopo
TODO: o que entra e o que não entra neste estudo.

## Critérios de sucesso do estudo
TODO: o que precisa estar pronto para o estudo valer (dados, réplica, aprovação).

## Hipótese nula, controle negativo e explicações alternativas
TODO: o que seria verdade se não houvesse efeito, e o que mais poderia explicar o resultado.

## Conflitos de interesse e confidencialidade
TODO: material do trabalho usado, o que precisa ser anonimizado, quem tem interesse no resultado.
""",
    "busca.md": """# Estratégia de busca

- Data da busca: TODO
- Bases e sites consultados: TODO (acadêmicas: arXiv, ACM, IEEE, Google Scholar; empresas: documentação oficial e blogs de engenharia; independentes: relatórios, benchmarks abertos, repositórios)
- Termos de busca: TODO
- Critérios de inclusão: TODO
- Critérios de exclusão: TODO (por exemplo: sem método descrito, sem dados, material de marketing sem medição)
""",
    "sintese.md": """# Síntese das evidências

## O que as fontes estabelecem
TODO: afirmações bem sustentadas, cada uma com o id da fonte entre colchetes, por exemplo [fonte-01].

## Onde as fontes discordam
TODO: conflitos entre fontes e a provável razão (método, contexto, viés).

## O que ainda não foi testado (lacunas)
TODO: perguntas sem resposta nas fontes, que viram hipóteses deste estudo.
""",
    "analise-plano.md": """# Plano de análise (pré-registrado)

## Métricas primárias e secundárias
TODO

## Estatísticas e intervalos
TODO: medidas de tendência e dispersão (mediana, IQR), intervalo de confiança (por exemplo bootstrap), tamanho de efeito.

## Testes por hipótese
TODO: teste escolhido, nível de significância, teste de equivalência (TOST) quando a hipótese é "sem diferença".

## Correção para múltiplas comparações
TODO: método (por exemplo Holm) e a família de hipóteses.

## Regra de outliers e dados faltantes
TODO: definida agora, antes de ver os dados.

## Análises confirmatórias e exploratórias
TODO: quais são confirmatórias (pré-registradas) e como as exploratórias serão rotuladas.
""",
    "ambiente.md": """# Ambiente de execução

- Hardware (CPU, memória, disco): TODO
- Sistema operacional e versão: TODO
- Versões fixadas (runtimes, bibliotecas, modelos, com identificador exato): TODO
- Lockfile ou container usado: TODO
- Rede, região e custo, quando aplicável: TODO
- O que pode variar entre máquinas e a tolerância aceita: TODO
""",
    "plano-de-testes.md": """# Plano de testes

## Variáveis
- Independentes (o que muda): TODO
- Dependentes (o que se mede): TODO
- Controladas (o que se mantém fixo): TODO

## Condições e baseline
TODO: baseline, variantes e controle negativo.

## Aleatorização, sementes e aquecimento
TODO: ordem aleatória das execuções, sementes fixas, descarte de aquecimento.

## Repetições e regra de parada
TODO: n por condição, justificado pelo piloto; regra para estender a amostra se a decisão não sair.

## Avaliação cega (quando há avaliador)
TODO: como os rótulos são embaralhados e quem não vê a identidade.

## Custo e tempo
TODO: como tokens, dinheiro e tempo serão registrados.
""",
    "dicionario.md": """# Dicionário de dados

| Coluna | Tipo | Unidade | Descrição | Valores válidos |
| --- | --- | --- | --- | --- |
| TODO | TODO | TODO | TODO | TODO |
""",
    "diario.md": """# Diário de execução

Registre aqui, com data e hora, cada execução, desvio do plano, problema e decisão. Dados brutos nunca são editados.

- TODO
""",
    "validade.md": """# Ameaças à validade

## Interna (o resultado é causado pelo que mudamos?)
TODO

## Externa (vale fora deste contexto?)
TODO

## De construto (a métrica mede o que dizemos que mede?)
TODO

## De conclusão (a estatística sustenta a conclusão?)
TODO
""",
    "retro.md": """# Retrospectiva do estudo

- O que funcionou no método: TODO
- O que faltou ou atrasou: TODO
- Tempo gasto por fase: TODO
- O que vamos mudar no protocolo: TODO
""",
    "experimentos/README.md": """# Como repetir este estudo

TODO: pré-requisitos, comando único para rodar tudo, onde saem os dados, tempo esperado e como conferir o resultado.
""",
}

HIPOTESES_MODELO = [{
    "id": "H1",
    "enunciado": "TODO: se [mudança], então [resultado mensurável], porque [raciocínio]",
    "direcao": "TODO: maior | menor | sem diferença",
    "metrica": "TODO",
    "limiar": "TODO: valor que conta como confirmação",
    "efeito_minimo": "TODO: menor efeito que importa na prática",
    "margem_equivalencia": "TODO: diferença que conta como 'sem diferença'",
    "refutada_se": "TODO",
    "status": "pendente",
    "evidencia": "",
    "nota": ""
}]

CLAIMS_MODELO = [{"afirmacao": "TODO: afirmação do artigo", "tipo": "dado | fonte", "evidencia": "TODO: caminho do dado ou id da fonte"}]

FONTE_MODELO = """---
id: fonte-01
titulo: "TODO"
autores: "TODO"
ano: TODO
tipo: TODO
url: TODO
doi:
acessado: TODO
nivel_evidencia: TODO
vies: "TODO"
verificada: false
---
# TODO: título da fonte

> tipo: academico | empresa | independente. nivel_evidencia: A (revisão sistemática ou experimento controlado), B (estudo com método e dados abertos), C (relato técnico com medição), D (opinião ou sem dados).

## Resumo
TODO

## Afirmações extraídas (com localização)
- TODO: afirmação, página ou seção

## Limitações da fonte
TODO
"""


# ---------- estado e utilidades ----------
def folder(slug):
    d = STUDIES / slug
    if not d.exists():
        sys.exit(f"estudo '{slug}' não existe. Crie com: python tools/research/pesquisa.py new {slug} \"Título\"")
    return d


def load_state(slug):
    return json.loads((folder(slug) / "estado.json").read_text(encoding="utf-8"))


def save_state(slug, st):
    (folder(slug) / "estado.json").write_text(json.dumps(st, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def next_friday(d=None):
    d = d or date.today()
    return d + timedelta(days=(4 - d.weekday()) % 7)


def read(path):
    return path.read_text(encoding="utf-8") if path.exists() else ""


def has_todo(text):
    return "TODO" in text


def fontes(slug):
    out = []
    for p in sorted((folder(slug) / "fontes").glob("*.md")):
        if p.name.startswith("_"):
            continue
        meta, body = parse_note(p)
        out.append((p, meta, body, has_todo(p.read_text(encoding="utf-8"))))
    return out


def hipoteses(slug):
    p = folder(slug) / "hipoteses.json"
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return []


# ---------- verificações automáticas ----------
def check(slug, step, st):
    v = step.get("verifica", {})
    t, d = v.get("tipo"), folder(slug)
    if t == "arquivo":
        txt = read(d / v["caminho"])
        if not txt:
            return False, f"{v['caminho']} não existe"
        if has_todo(txt):
            return False, f"{v['caminho']} ainda tem TODO"
        if len(txt) < v.get("min", 100):
            return False, f"{v['caminho']} curto demais (mínimo {v.get('min')} caracteres)"
        return True, "ok"
    if t == "fontes":
        items = [f for f in fontes(slug) if not f[3]]
        cont = {}
        for _, m, _, _ in items:
            cont[m.get("tipo", "")] = cont.get(m.get("tipo", ""), 0) + 1
        falta = [f"{k}: {cont.get(k, 0)}/{n}" for k, n in v["por_tipo"].items() if cont.get(k, 0) < n]
        if len(items) < v["total"]:
            falta.insert(0, f"total: {len(items)}/{v['total']}")
        return (not falta), ("ok" if not falta else "faltam " + ", ".join(falta))
    if t == "fontes_verificadas":
        items = fontes(slug)
        bad = [p.stem for p, m, _, td in items if not m.get("verificada") or td]
        return (bool(items) and not bad), ("ok" if items and not bad else f"não verificadas: {', '.join(bad) or 'nenhuma fonte'}")
    if t == "fontes_classificadas":
        items = fontes(slug)
        bad = [p.stem for p, m, _, td in items if str(m.get("nivel_evidencia", "")) not in list("ABCD") or not m.get("vies") or td]
        return (bool(items) and not bad), ("ok" if items and not bad else f"sem classificação: {', '.join(bad) or 'nenhuma fonte'}")
    if t == "hipoteses_completas":
        hs = hipoteses(slug)
        req = ["id", "enunciado", "direcao", "metrica", "limiar", "refutada_se"]
        bad = [h.get("id", "?") for h in hs if any(not h.get(k) or has_todo(str(h.get(k))) for k in req)]
        return (bool(hs) and not bad), ("ok" if hs and not bad else f"incompletas: {', '.join(bad) or 'nenhuma hipótese'}")
    if t == "hipoteses_margens":
        hs = hipoteses(slug)
        bad = [h.get("id", "?") for h in hs if any(not h.get(k) or has_todo(str(h.get(k))) for k in ("efeito_minimo", "margem_equivalencia"))]
        return (bool(hs) and not bad), ("ok" if hs and not bad else f"sem margem: {', '.join(bad) or 'nenhuma hipótese'}")
    if t == "hipoteses_resolvidas":
        hs = hipoteses(slug)
        bad = [f"{h.get('id')}={h.get('status')}" for h in hs if h.get("status") not in OK_STATUS or not h.get("evidencia")]
        return (bool(hs) and not bad), ("ok" if hs and not bad else "sem decisão ou sem evidência: " + (", ".join(bad) or "nenhuma hipótese"))
    if t == "arquivos_min":
        n = len([p for p in d.glob(v["padrao"]) if p.is_file() and not p.name.startswith(".")])
        return n >= v["n"], (f"ok ({n})" if n >= v["n"] else f"{n}/{v['n']} arquivo(s) em {v['padrao']}")
    if t == "claims":
        try:
            cs = json.loads(read(d / "claims.json"))
        except Exception:
            cs = []
        bad = [str(i + 1) for i, c in enumerate(cs) if not c.get("evidencia") or has_todo(json.dumps(c, ensure_ascii=False))]
        return (bool(cs) and not bad), ("ok" if cs and not bad else f"afirmações sem evidência: {', '.join(bad) or 'matriz vazia'}")
    if t == "rascunhos":
        base = ROOT / "posts" / "drafts" / slug
        if not base.exists():
            base = ROOT / "posts" / "published" / slug
        bad = []
        for lang in ("pt", "en"):
            txt = read(base / f"{lang}.md")
            if not txt or has_todo(txt) or len(txt) < 1500:
                bad.append(lang)
        return (not bad), ("ok" if not bad else "rascunho ausente, curto ou com TODO em: " + ", ".join(bad))
    if t == "fases_anteriores":
        limite = int(v["ate"][1:])
        pend = [s["id"] for ph in PROTO["fases"] for s in ph["passos"]
                if phase_idx(s["id"]) <= limite and not step_ok(slug, s, st)[0]]
        return (not pend), ("ok" if not pend else "pendentes: " + ", ".join(pend[:8]) + ("…" if len(pend) > 8 else ""))
    return False, "manual"


def phase_idx(step_id):
    return int(step_id.split(".")[0][1:])


def step_ok(slug, step, st):
    if step.get("verifica", {}).get("tipo") == "manual":
        e = st["etapas"].get(step["id"])
        return (bool(e), (e["evidencia"][:60] if e else "manual: falta evidência"))
    ok, why = check(slug, step, st)
    if ok and step.get("autor") and not st.get("aprovacoes", {}).get(step["id"]):
        return False, "pronto como rascunho; aguardando a aprovação do autor"
    return ok, why


# ---------- comandos ----------
def cmd_new(slug, titulo, congelar):
    d = STUDIES / slug
    if d.exists():
        sys.exit(f"{d} já existe")
    for sub in ("fontes", "dados/bruto", "dados/processado", "dados/pacote", "experimentos", "analise"):
        (d / sub).mkdir(parents=True)
        (d / sub / ".gitkeep").write_text("")
    for name, body in TEMPLATES.items():
        (d / name).parent.mkdir(parents=True, exist_ok=True)
        (d / name).write_text(body, encoding="utf-8")
    (d / "hipoteses.json").write_text(json.dumps(HIPOTESES_MODELO, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (d / "claims.json").write_text(json.dumps(CLAIMS_MODELO, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (d / "fontes" / "_modelo.md").write_text(FONTE_MODELO, encoding="utf-8")
    (d / "README.md").write_text(f"# {titulo}\n\nEstudo do Melo Labs. Protocolo: research/protocolo.json. Progresso: `python tools/research/pesquisa.py status {slug}`.\n", encoding="utf-8")
    (ROOT / "posts" / "drafts" / slug).mkdir(parents=True, exist_ok=True)
    save = {"slug": slug, "titulo": titulo, "criado": date.today().isoformat(),
            "congelar_dados": congelar or next_friday().isoformat(), "etapas": {}}
    (d / "estado.json").write_text(json.dumps(save, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"estudo criado em studies/{slug} · congelamento dos dados: {save['congelar_dados']}")
    print(f"próximo passo: preencher studies/{slug}/premissa.md (F0.1)")


def summary(slug):
    st = load_state(slug)
    rows, total, done = [], 0, 0
    for ph in PROTO["fases"]:
        n = len(ph["passos"])
        steps = [(s, *step_ok(slug, s, st)) for s in ph["passos"]]
        k = sum(1 for _, ok, _ in steps if ok)
        rows.append((ph, steps, k, n))
        total += n
        done += k
    return st, rows, done, total


def bar(k, n, w=20):
    f = round(w * k / n) if n else 0
    return "█" * f + "░" * (w - f)


def cmd_status(slug=None):
    if slug is None:
        for p in sorted(STUDIES.glob("*/estado.json")):
            _, _, done, total = summary(p.parent.name)
            print(f"{p.parent.name:40s} {bar(done, total)} {done}/{total} ({round(100 * done / total)}%)")
        return
    st, rows, done, total = summary(slug)
    prazo = datetime.strptime(st["congelar_dados"], "%Y-%m-%d").date()
    dias = (prazo - date.today()).days
    print(f"\n{st['titulo']}  [{slug}]")
    print(f"Progresso geral: {bar(done, total, 30)} {done}/{total} ({round(100 * done / total)}%)")
    print(f"Congelamento dos dados: {prazo.isoformat()} ({'em ' + str(dias) + ' dia(s)' if dias >= 0 else 'ATRASADO ' + str(-dias) + ' dia(s)'})\n")
    for ph, steps, k, n in rows:
        print(f"{ph['id']:4s} {ph['nome']:30s} {bar(k, n, 12)} {k}/{n}")
    nxt = [(s, why) for ph, steps, _, _ in rows for s, ok, why in steps if not ok][:4]
    if nxt:
        print("\nPróximos passos:")
        for s, why in nxt:
            print(f"  {s['id']:5s} {s['titulo']}\n        falta: {why}")
    hs = hipoteses(slug)
    cont = {}
    for h in hs:
        cont[h.get("status", "?")] = cont.get(h.get("status", "?"), 0) + 1
    print("\nHipóteses:", ", ".join(f"{k}={v}" for k, v in cont.items()) or "nenhuma")
    fs = fontes(slug)
    print(f"Fontes: {len(fs)} ({sum(1 for _, m, _, _ in fs if m.get('verificada'))} verificadas)")
    inconc = [h["id"] for h in hs if h.get("status") == "subpotente"]
    if inconc:
        print(f"ATENÇÃO: hipóteses subpotentes ({', '.join(inconc)}): estender a amostra antes de publicar.")


def cmd_done(slug, step_id, evidencia):
    st = load_state(slug)
    step = next((s for ph in PROTO["fases"] for s in ph["passos"] if s["id"] == step_id), None)
    if not step:
        sys.exit(f"passo {step_id} não existe")
    if step.get("verifica", {}).get("tipo") != "manual":
        ok, why = check(slug, step, st)
        sys.exit(f"{step_id} é conferido automaticamente ({'passa' if ok else 'não passa'}: {why}). Corrija os arquivos; não dá para marcar à mão.")
    if len(evidencia.strip()) < 15:
        sys.exit("informe a evidência (pelo menos 15 caracteres): o que foi feito e onde está registrado")
    st["etapas"][step_id] = {"feito": date.today().isoformat(), "evidencia": evidencia.strip()}
    save_state(slug, st)
    print(f"{step_id} concluído: {step['titulo']}")


def cmd_aprovar(slug, step_id, decisao):
    st = load_state(slug)
    step = next((s for ph in PROTO["fases"] for s in ph["passos"] if s["id"] == step_id), None)
    if not step or not step.get("autor"):
        sys.exit(f"{step_id} não é um passo de aprovação do autor")
    ok, why = check(slug, step, st)
    if not ok:
        sys.exit(f"{step_id} ainda não está pronto como rascunho: {why}")
    if len(decisao.strip()) < 10:
        sys.exit("registre a decisão do autor (pelo menos 10 caracteres): o que foi aprovado, ajustado ou recusado")
    st.setdefault("aprovacoes", {})[step_id] = {"feito": date.today().isoformat(), "decisao": decisao.strip()}
    save_state(slug, st)
    print(f"{step_id} aprovado pelo autor: {step['titulo']}")


def cmd_links(slug):
    for p, m, _, _ in fontes(slug):
        url = str(m.get("url", ""))
        if not url.startswith("http"):
            print(f"{p.stem}: sem URL"); continue
        try:
            req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "melo-labs-links"})
            with urllib.request.urlopen(req, timeout=20) as r:
                print(f"{p.stem}: {r.status} {url}")
        except Exception as e:
            print(f"{p.stem}: FALHOU ({type(e).__name__}) {url}")


def report_one(slug):
    st, rows, done, total = summary(slug)
    out = [f"# Progresso: {st['titulo']}", "", f"Atualizado em {datetime.now().strftime('%Y-%m-%d %H:%M')} · congelamento dos dados: {st['congelar_dados']}", "",
           f"**{done}/{total} passos ({round(100 * done / total)}%)**", "", "| Fase | Passos | Situação |", "| --- | --- | --- |"]
    for ph, steps, k, n in rows:
        out.append(f"| {ph['id']} {ph['nome']} | {k}/{n} | {bar(k, n, 10)} |")
    out += ["", "## Passos"]
    for ph, steps, k, n in rows:
        out += ["", f"### {ph['id']} · {ph['nome']}"]
        for s, ok, why in steps:
            out.append(f"- [{'x' if ok else ' '}] **{s['id']}** {s['titulo']}" + ("" if ok else f" — falta: {why}"))
    (folder(slug) / "PROGRESSO.md").write_text("\n".join(out) + "\n", encoding="utf-8")
    return done, total


def cmd_report(slug=None):
    slugs = [slug] if slug else [p.parent.name for p in sorted(STUDIES.glob("*/estado.json"))]
    lines = ["# Estudos do Melo Labs", "", "| Estudo | Progresso | Congelamento dos dados |", "| --- | --- | --- |"]
    for s in slugs:
        done, total = report_one(s)
        st = load_state(s)
        lines.append(f"| [{st['titulo']}]({s}/PROGRESSO.md) | {done}/{total} ({round(100 * done / total)}%) | {st['congelar_dados']} |")
        print(f"studies/{s}/PROGRESSO.md atualizado ({done}/{total})")
    if not slug:
        (STUDIES / "INDEX.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
        print("studies/INDEX.md atualizado")


def cmd_render():
    md = [f"# {PROTO['titulo']}", "", f"Versão {PROTO['versao']}. Gerado de research/protocolo.json. Não editar à mão.", "", "## Princípios", ""]
    md += [f"- {p}" for p in PROTO["principios"]]
    md += ["", "## Status de uma hipótese", ""] + [f"- **{k}**: {v}" for k, v in PROTO["status_hipotese"].items()]
    for ph in PROTO["fases"]:
        md += ["", f"## {ph['id']} · {ph['nome']}", "", ph["objetivo"], "", "| Passo | O que fazer | Pronto quando | Conferência |", "| --- | --- | --- | --- |"]
        for s in ph["passos"]:
            tipo = "manual, com evidência" if s["verifica"]["tipo"] == "manual" else "automática"
            md.append(f"| {s['id']} | {s['titulo']} | {s['criterio']} | {tipo} |")
    (ROOT / "docs" / "protocolo-de-pesquisa.md").write_text("\n".join(md) + "\n", encoding="utf-8")

    esc = htmllib.escape
    secs = []
    for ph in PROTO["fases"]:
        n_auto = sum(1 for s in ph["passos"] if s["verifica"]["tipo"] != "manual")
        rows = "".join(
            f"<tr><td class=\"w\">{s['id']}</td><td>{esc(s['titulo'])}</td><td>{esc(s['criterio'])}</td>"
            f"<td><span class=\"tag{' auto' if s['verifica']['tipo'] != 'manual' else ''}\">{'automática' if s['verifica']['tipo'] != 'manual' else 'manual'}</span>{' <span class=\"tag\">autor decide</span>' if s.get('autor') else ''}</td></tr>"
            for s in ph["passos"])
        secs.append(f"<section class=\"phase\"><header><h3>{ph['id']} · {esc(ph['nome'])}</h3><span class=\"sub\">{len(ph['passos'])} passos · {n_auto} automáticos</span></header>"
                    f"<p>{esc(ph['objetivo'])}</p><div class=\"tbl\"><table><thead><tr><th>Passo</th><th>O que fazer</th><th>Pronto quando</th><th>Conferência</th></tr></thead><tbody>{rows}</tbody></table></div></section>")
    status = "".join(f"<tr><td class=\"w\">{k}</td><td>{esc(v)}</td></tr>" for k, v in PROTO["status_hipotese"].items())
    princ = "".join(f"<li>{esc(p)}</li>" for p in PROTO["principios"])
    page = HTML_PAGE.replace("{{PRINCIPIOS}}", princ).replace("{{FASES}}", "\n".join(secs)).replace("{{STATUS}}", status).replace("{{VERSAO}}", PROTO["versao"])
    (ROOT / "docs" / "protocolo-de-pesquisa.html").write_text(page, encoding="utf-8")
    print("docs/protocolo-de-pesquisa.md e .html gerados")


HTML_PAGE = """<title>Protocolo de Pesquisa</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Public+Sans:wght@400;600;800&display=swap">
<style>
/* Layout: coluna de leitura, uma seção por fase com tabela de passos. Cabeçalho com princípios e ciclo semanal. */
:root{--bg:#f2f5f6;--panel:#ffffff;--ink:#13232b;--muted:#566872;--line:#d3dde1;--accent:#0d7a6b;--accent-soft:#d9efeb;--warn:#a8650c;--warn-soft:#f6e8d2;
  --font-body:"Public Sans",system-ui,"Segoe UI",sans-serif;--font-mono:"JetBrains Mono",ui-monospace,Consolas,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0f1a1f;--panel:#16252c;--ink:#e4edf0;--muted:#93a8b1;--line:#2a3d46;--accent:#4cc9b4;--accent-soft:#17403a;--warn:#e5a54b;--warn-soft:#3b2d14;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0f1a1f;--panel:#16252c;--ink:#e4edf0;--muted:#93a8b1;--line:#2a3d46;--accent:#4cc9b4;--accent-soft:#17403a;--warn:#e5a54b;--warn-soft:#3b2d14;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 var(--font-body);padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
main{max-width:900px;margin:0 auto;padding-block:36px 72px}
h1{font-size:clamp(28px,6vw,40px);line-height:1.1;margin:6px 0 10px;font-weight:800;text-wrap:balance}
h2{font-size:21px;margin:44px 0 6px;font-weight:800;text-wrap:balance}
h3{font-size:17px;margin:0}
p{margin:0 0 12px;max-width:68ch}
.eyebrow{font:600 12px/1 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.lead{font-size:18px;color:var(--muted);max-width:62ch}
.sub{color:var(--muted);font-size:13px;font-family:var(--font-mono)}
.phase{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:16px 18px;margin-bottom:12px}
.phase header{display:flex;justify-content:space-between;gap:12px;align-items:baseline;flex-wrap:wrap;margin-bottom:6px}
.tbl{overflow-x:auto;margin:8px 0 0}
table{border-collapse:collapse;width:100%;font-size:14.5px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font:600 11px/1.3 var(--font-mono);letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
td.w{font-family:var(--font-mono);white-space:nowrap}
.tag{font:600 11px/1 var(--font-mono);letter-spacing:.04em;text-transform:uppercase;padding:4px 7px;border-radius:3px;background:var(--warn-soft);color:var(--warn);white-space:nowrap}
.tag.auto{background:var(--accent-soft);color:var(--accent)}
ul.rules{padding-left:20px;margin:8px 0}ul.rules li{margin-bottom:6px;max-width:70ch}
.cycle{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:10px 0}
.cycle div{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:10px 12px;font-size:14px;min-width:0}
.cycle b{display:block;font:600 11px/1 var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--accent);margin-bottom:6px}
.callout{border-left:3px solid var(--warn);background:var(--warn-soft);padding:12px 16px;border-radius:0 6px 6px 0;margin:16px 0}
code{font:13px var(--font-mono);background:var(--accent-soft);padding:1px 5px;border-radius:3px}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
</style>
<main>
  <div class="eyebrow">Melo Labs · método · versão {{VERSAO}}</div>
  <h1>Protocolo de Pesquisa</h1>
  <p class="lead">Cada artigo é um estudo: premissa, evidências, hipóteses registradas antes do teste, dados abertos, réplica e só então a escrita. O mesmo protocolo vale para todos os estudos, com progresso medido passo a passo.</p>

  <h2>Princípios</h2>
  <ul class="rules">{{PRINCIPIOS}}</ul>

  <h2>Ciclo de um estudo</h2>
  <div class="cycle">
    <div><b>Dia 1</b>F0 a F2: premissa, evidências e hipóteses</div>
    <div><b>Dia 2</b>F3 e F4: pré-registro e plano de testes, com piloto</div>
    <div><b>Dia 3</b>F5 e F6: execução e análise</div>
    <div><b>Dia 4</b>F7 e F8: réplica, validade e congelamento dos dados</div>
    <div><b>Dia 5 em diante</b>F9 a F11: escrita, aprovação e publicação</div>
  </div>
  <div class="callout"><b>Primeiro ciclo (4 a 8 de novembro):</b> dados congelados na sexta, 6/11. Sábado e domingo ficam para os artefatos, a revisão e a sua aprovação. Se a réplica (F7) ou uma hipótese subpotente pedir mais dados, o congelamento adia: o artigo só sai com todas as hipóteses decididas.</div>

  <h2>Como uma hipótese termina</h2>
  <p>Nenhuma hipótese termina como "inconclusiva". O desenho evita isso com margem de equivalência e tamanho de amostra definidos no pré-registro. Se mesmo assim faltar poder, o status é <code>subpotente</code>, que bloqueia a publicação até a amostra ser estendida pela regra de parada.</p>
  <div class="tbl"><table><tbody>{{STATUS}}</tbody></table></div>

  <h2>Fases e passos</h2>
  <p>Passos <span class="tag auto">automática</span> são conferidos por <code>python tools/research/pesquisa.py status &lt;estudo&gt;</code> e não podem ser marcados à mão. Passos <span class="tag">manual</span> exigem uma evidência escrita.</p>
  {{FASES}}

  <h2>Comandos</h2>
  <div class="tbl"><table><tbody>
    <tr><td class="w">new</td><td>Cria o estudo com todos os modelos e o prazo de congelamento dos dados.</td></tr>
    <tr><td class="w">status</td><td>Mostra progresso por fase, próximos passos, hipóteses, fontes e prazo.</td></tr>
    <tr><td class="w">done</td><td>Marca um passo manual como concluído, com a evidência.</td></tr>
    <tr><td class="w">links</td><td>Confere se as URLs das fontes respondem.</td></tr>
    <tr><td class="w">report</td><td>Grava <code>PROGRESSO.md</code> do estudo e o índice de todos os estudos.</td></tr>
  </tbody></table></div>
</main>
"""


def main():
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    c = a[0]
    if c == "new" and len(a) >= 3:
        cong = a[a.index("--congelar") + 1] if "--congelar" in a else None
        cmd_new(a[1], a[2], cong)
    elif c == "status":
        cmd_status(a[1] if len(a) > 1 else None)
    elif c == "done" and len(a) >= 4:
        cmd_done(a[1], a[2], a[3])
    elif c == "aprovar" and len(a) >= 4:
        cmd_aprovar(a[1], a[2], a[3])
    elif c == "links" and len(a) >= 2:
        cmd_links(a[1])
    elif c == "report":
        cmd_report(a[1] if len(a) > 1 else None)
    elif c == "render":
        cmd_render()
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
