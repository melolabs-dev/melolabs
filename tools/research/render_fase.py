#!/usr/bin/env python3
"""Gera o artefato visual de um estudo a partir dos arquivos reais: docs/estudo-<slug>.html

  python tools/research/render_fase.py <slug>

Lê estado, hipóteses e fontes do estudo; nada é escrito à mão na página.
"""
import html
import json
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "research"))
sys.path.insert(0, str(ROOT / "tools" / "rag"))
import pesquisa as P  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

e = html.escape


def main(slug):
    st, rows, done, total = P.summary(slug)
    hs = P.hipoteses(slug)
    fs = P.fontes(slug)
    tipos = Counter(m.get("tipo", "?") for _, m, _, _ in fs)
    niveis = Counter(str(m.get("nivel_evidencia", "?")) for _, m, _, _ in fs)
    verif = sum(1 for _, m, _, _ in fs if m.get("verificada"))
    aprov = st.get("aprovacoes", {})
    hoje = datetime.now().strftime("%d/%m/%Y às %H:%M")

    def barra(k, n):
        return f"<div class=\"bar\"><i style=\"width:{round(100 * k / n) if n else 0}%\"></i></div>"

    fases = "".join(
        f"<div class=\"fase\"><div class=\"fh\"><b>{ph['id']}</b><span>{e(ph['nome'])}</span><em>{k}/{n}</em></div>{barra(k, n)}</div>"
        for ph, steps, k, n in rows)

    pend = []
    for ph, steps, k, n in rows:
        for s, ok, why in steps:
            if s.get("autor") and not ok and "aprovação" in why:
                pend.append(s)
    aguard = "".join(f"<li><b>{s['id']}</b> {e(s['titulo'])}</li>" for s in pend)

    hip = "".join(
        f"<tr><td class=\"w\">{e(h['id'])}</td><td>{e(h['enunciado'])}</td><td>{e(h['metrica'])}</td><td>{e(h['limiar'])}</td>"
        f"<td>{e(h['margem_equivalencia'])}</td><td>{e(h['refutada_se'])}</td><td><span class=\"tag\">{e(h['status'])}</span></td></tr>"
        for h in hs)

    def lista(tipo):
        its = [(p, m) for p, m, _, _ in fs if m.get("tipo") == tipo]
        return "".join(
            f"<tr><td><a href=\"{e(str(m.get('url', '')))}\" target=\"_blank\" rel=\"noopener\">{e(str(m.get('titulo', p.stem)))}</a><br><span class=\"sub\">{e(str(m.get('autores', '')))} · {m.get('ano', '')}</span></td>"
            f"<td class=\"w\"><span class=\"nv nv{e(str(m.get('nivel_evidencia', '?')))}\">{e(str(m.get('nivel_evidencia', '?')))}</span></td>"
            f"<td>{e(str(m.get('vies', '')))}</td></tr>" for p, m in its)

    def mini(counter, ordem, cls):
        tot = sum(counter.values()) or 1
        return "".join(
            f"<div class=\"hb\"><span>{e(k)}</span><div class=\"bar {cls}\"><i style=\"width:{round(100 * counter.get(k, 0) / tot)}%\"></i></div><b>{counter.get(k, 0)}</b></div>"
            for k in ordem)

    page = HTML.format(
        titulo=e(st["titulo"]), slug=e(slug), hoje=hoje, done=done, total=total, pct=round(100 * done / total),
        congelar=e(st["congelar_dados"]), fases=fases, aguard=aguard or "<li>Nenhuma aprovação pendente.</li>",
        nfontes=len(fs), verif=verif, nhip=len(hs), hip=hip,
        tipos=mini(tipos, ["academico", "empresa", "independente"], ""),
        niveis=mini(niveis, ["A", "B", "C", "D"], "alt"),
        l_aca=lista("academico"), l_emp=lista("empresa"), l_ind=lista("independente"),
        n_aca=tipos.get("academico", 0), n_emp=tipos.get("empresa", 0), n_ind=tipos.get("independente", 0),
        aprovadas=len(aprov))
    out = ROOT / "docs" / f"estudo-{slug}.html"
    out.write_text(page, encoding="utf-8")
    print("gerado:", out.relative_to(ROOT))


HTML = """<title>Estudo 1 · Haiku no SDD</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Public+Sans:wght@400;600;800&display=swap">
<style>
/* Layout: coluna de leitura. Topo com estado e decisões do autor, depois hipóteses, evidências e o que se aprende. */
:root{{--bg:#f2f5f6;--panel:#ffffff;--ink:#13232b;--muted:#566872;--line:#d3dde1;--accent:#0d7a6b;--accent-soft:#d9efeb;--warn:#a8650c;--warn-soft:#f6e8d2;--bad:#a63b32;
  --font-body:"Public Sans",system-ui,"Segoe UI",sans-serif;--font-mono:"JetBrains Mono",ui-monospace,Consolas,monospace}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{--bg:#0f1a1f;--panel:#16252c;--ink:#e4edf0;--muted:#93a8b1;--line:#2a3d46;--accent:#4cc9b4;--accent-soft:#17403a;--warn:#e5a54b;--warn-soft:#3b2d14;--bad:#ef8a80;color-scheme:dark}}}}
:root[data-theme="dark"]{{--bg:#0f1a1f;--panel:#16252c;--ink:#e4edf0;--muted:#93a8b1;--line:#2a3d46;--accent:#4cc9b4;--accent-soft:#17403a;--warn:#e5a54b;--warn-soft:#3b2d14;--bad:#ef8a80;color-scheme:dark}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 var(--font-body);padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}}
main{{max-width:920px;margin:0 auto;padding-block:36px 72px}}
h1{{font-size:clamp(26px,5.5vw,38px);line-height:1.12;margin:6px 0 10px;font-weight:800;text-wrap:balance}}
h2{{font-size:21px;margin:42px 0 6px;font-weight:800;text-wrap:balance}}
h3{{font-size:16px;margin:0 0 4px}}
p{{margin:0 0 12px;max-width:68ch}}
a{{color:var(--accent)}}
.eyebrow{{font:600 12px/1 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}}
.lead{{font-size:18px;color:var(--muted);max-width:62ch}}
.sub{{color:var(--muted);font-size:13px}}
.draft{{border-left:3px solid var(--warn);background:var(--warn-soft);padding:12px 16px;border-radius:0 6px 6px 0;margin:18px 0}}
.panel{{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:16px 18px;margin-bottom:12px}}
.stats{{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:18px 0}}
.stat{{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:12px 14px;min-width:0}}
.stat b{{display:block;font:600 26px/1.1 var(--font-mono);font-variant-numeric:tabular-nums}}
.stat span{{font-size:13px;color:var(--muted)}}
.bar{{height:8px;background:var(--line);border-radius:99px;overflow:hidden}}
.bar i{{display:block;height:100%;background:var(--accent)}}
.bar.alt i{{background:var(--warn)}}
.fase{{margin:8px 0}}.fh{{display:flex;gap:10px;align-items:baseline;font-size:14px;margin-bottom:3px}}
.fh b{{font-family:var(--font-mono);min-width:34px}}.fh span{{flex:1;min-width:0}}.fh em{{font:600 12px var(--font-mono);color:var(--muted);font-style:normal}}
.hb{{display:grid;grid-template-columns:96px 1fr 28px;gap:10px;align-items:center;margin:6px 0;font-size:14px}}
.hb b{{text-align:right;font-family:var(--font-mono)}}
.grid2{{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}}
.tbl{{overflow-x:auto;margin:8px 0}}
table{{border-collapse:collapse;width:100%;font-size:14px;background:var(--panel)}}
th,td{{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}}
th{{font:600 11px/1.3 var(--font-mono);letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}}
td.w{{font-family:var(--font-mono);white-space:nowrap}}
.tag{{font:600 11px/1 var(--font-mono);letter-spacing:.04em;text-transform:uppercase;padding:4px 7px;border-radius:3px;background:var(--warn-soft);color:var(--warn);white-space:nowrap}}
.nv{{font:600 12px var(--font-mono);padding:3px 8px;border-radius:3px;background:var(--accent-soft);color:var(--accent)}}
.nvC{{background:var(--warn-soft);color:var(--warn)}}.nvD{{background:var(--line);color:var(--muted)}}
details{{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:10px 16px;margin-bottom:10px}}
summary{{cursor:pointer;font-weight:600;padding:2px 0}}
ul.l{{padding-left:20px;margin:8px 0}}ul.l li{{margin-bottom:7px;max-width:72ch}}
.dec{{display:grid;grid-template-columns:34px 1fr;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}}
.dec:last-child{{border-bottom:0}}.dec b.n{{font:600 13px var(--font-mono);color:var(--accent);padding-top:2px}}
.dec .q{{font-weight:600}}.dec .o{{color:var(--muted);font-size:14.5px;margin-top:2px}}
code{{font:13px var(--font-mono);background:var(--accent-soft);padding:1px 5px;border-radius:3px}}
:focus-visible{{outline:3px solid var(--accent);outline-offset:2px}}
</style>
<main>
  <div class="eyebrow">Melo Labs · estudo 1 · atualizado em {hoje}</div>
  <h1>{titulo}</h1>
  <p class="lead">Esta página mostra o que foi levantado até agora, o que já foi conferido e o que depende de você. Tudo vem dos arquivos do estudo, sem número escrito à mão.</p>

  <div class="draft"><b>Tudo o que a IA escreveu aqui é rascunho.</b> Premissa, hipóteses, limiares, margens e síntese só valem depois que você decidir, passo a passo. O que foi conferido de fato foi a existência e o conteúdo das {nfontes} fontes.</div>

  <div class="stats">
    <div class="stat"><b>{pct}%</b><span>do protocolo ({done} de {total} passos)</span></div>
    <div class="stat"><b>{verif}/{nfontes}</b><span>fontes abertas e conferidas</span></div>
    <div class="stat"><b>{nhip}</b><span>hipóteses registradas, todas pendentes</span></div>
    <div class="stat"><b>{aprovadas}</b><span>decisões aprovadas por você</span></div>
  </div>

  <h2>Onde estamos no protocolo</h2>
  <div class="panel">{fases}</div>
  <p class="sub">Dados congelados previstos para <b>{congelar}</b>. Esse prazo é proposta, e é sua decisão se ele é realista (pergunta 6 abaixo).</p>

  <h2>O que espera a sua decisão</h2>
  <div class="panel">
    <div class="dec"><b class="n">1</b><div><div class="q">Qual projeto aberto será o alvo, e quais 3 features?</div><div class="o">Os estudos anteriores usaram repositórios do trabalho. Um projeto TypeScript aberto deixa o estudo reproduzível e publicável. Sem essa escolha não dá para começar o piloto.</div></div></div>
    <div class="dec"><b class="n">2</b><div><div class="q">Os limiares e as margens das hipóteses fazem sentido para você?</div><div class="o">Propus 3 pontos de rubrica como efeito mínimo, 2 como margem de equivalência, 10 pontos percentuais para os testes e 50% de custo. São números de partida, e mudam o que o estudo consegue concluir.</div></div></div>
    <div class="dec"><b class="n">3</b><div><div class="q">As 6 hipóteses são as certas para este artigo?</div><div class="o">As outras 12 ideias estão em <code>candidatas.md</code> para estudos futuros. Artigo com hipótese pendente não é publicado, então quanto mais hipóteses, mais trabalho antes da publicação.</div></div></div>
    <div class="dec"><b class="n">4</b><div><div class="q">Qual título de trabalho?</div><div class="o">Usei uma pergunta de propósito, para o artigo poder sair com qualquer resultado.</div></div></div>
    <div class="dec"><b class="n">5</b><div><div class="q">Qual orçamento para os juízes (Opus)?</div><div class="o">Os estudos anteriores gastaram cerca de 2,27 milhões de tokens para avaliar 18 textos. Com mais textos, o custo sobe. Posso reduzir os juízes e apoiar mais a nota em testes e gates automáticos.</div></div></div>
    <div class="dec"><b class="n">6</b><div><div class="q">Dá para fechar os dados na sexta?</div><div class="o">O desenho prevê 4 condições, 3 features e várias repetições. Se a réplica ou uma hipótese subpotente pedir mais dados, o prazo adia em vez de o rigor encurtar.</div></div></div>
  </div>
  <p class="sub">Passos prontos como rascunho, esperando a sua aprovação:</p>
  <ul class="l">{aguard}</ul>

  <h2>As hipóteses (rascunho)</h2>
  <p>Cada uma diz o que se espera, como se mede, quanto conta como efeito, o que conta como "sem diferença" e o que a refuta. Nenhuma pode terminar inconclusiva: ou decide, ou fica <code>subpotente</code> e a amostra é estendida.</p>
  <div class="tbl"><table><thead><tr><th>ID</th><th>Hipótese</th><th>Métrica</th><th>Limiar</th><th>Equivalente se</th><th>Refutada se</th><th>Status</th></tr></thead><tbody>{hip}</tbody></table></div>

  <h2>O que a pesquisa encontrou</h2>
  <div class="grid2">
    <div class="panel"><h3>{nfontes} fontes por tipo</h3><p class="sub">Meta do protocolo: 3 acadêmicas, 3 de empresa, 2 independentes.</p>{tipos}</div>
    <div class="panel"><h3>Nível de evidência</h3><p class="sub">A: revisão ou experimento controlado. B: método e dados. C: relato técnico ou vendor. D: sem resultados.</p>{niveis}</div>
  </div>

  <h2>O que a verificação ensinou</h2>
  <ul class="l">
    <li><b>O mesmo artigo pode ter números diferentes.</b> O resumo atual do Agentless diz 32,00% das issues a US$ 0,70. Os artefatos anteriores citavam 27,33% a US$ 0,34. Sem abrir a fonte, o erro passaria. Em artigo, citar sempre a versão.</li>
    <li><b>A razão de preço de 1/20 não vale sempre.</b> Segundo a documentação, o Haiku 5.5 custa US$ 0,10 de entrada e US$ 0,50 de saída por milhão de tokens até 100 mil tokens de prompt, e US$ 0,50 e US$ 2,50 acima disso. O Sonnet 5.5 custa US$ 2 e US$ 10. Acima de 100 mil tokens a razão cai para 1/4. Isso muda a hipótese de custo (H6), e o estudo vai registrar o maior prompt de cada chamada.</li>
    <li><b>Nem toda fonte recente é evidência.</b> O estudo de Rosa e colegas (2026) é um Registered Report: descreve um plano e não tem resultados. Serve como referência de método, não como prova. O de Panda (2026) tem resultados, mas testou Sonnet 4.6 e GLM-5-turbo, não o Haiku.</li>
    <li><b>Há uma lacuna real.</b> Não encontrei estudo que compare a alucinação em PRD ou especificação entre modelos pequenos e grandes. É uma contribuição possível deste estudo.</li>
    <li><b>Algumas fontes dos seus artefatos anteriores ainda não foram abertas</b> (CodeMonkeys, anúncio do Haiku 5.5, LLMLingua) e por isso não entram no estudo.</li>
  </ul>
  <div class="draft"><b>Um limite desta verificação:</b> abri cada página com uma ferramenta que devolve um resumo do conteúdo, e conferi título, autores e números contra o que ela devolveu. Vale você abrir 3 ou 4 fontes ao acaso e conferir com os próprios olhos. Se algo não bater, a nota correspondente é corrigida.</div>

  <h2>As fontes</h2>
  <details><summary>Acadêmicas ({n_aca})</summary><div class="tbl"><table><thead><tr><th>Fonte</th><th>Nível</th><th>Limitação</th></tr></thead><tbody>{l_aca}</tbody></table></div></details>
  <details><summary>De empresa ou documentação oficial ({n_emp})</summary><div class="tbl"><table><thead><tr><th>Fonte</th><th>Nível</th><th>Limitação</th></tr></thead><tbody>{l_emp}</tbody></table></div></details>
  <details><summary>Independentes ({n_ind})</summary><div class="tbl"><table><thead><tr><th>Fonte</th><th>Nível</th><th>Limitação</th></tr></thead><tbody>{l_ind}</tbody></table></div></details>

  <h2>O que você pode aplicar nos seus processos</h2>
  <ul class="l">
    <li><b>Abra a fonte antes de citar um número.</b> Resumos feitos por IA erram versão, ano e valor.</li>
    <li><b>Defina o que conta como "sem diferença" antes de medir.</b> Sem margem combinada, qualquer resultado vira "inconclusivo" ou é interpretado depois, a favor de quem mediu.</li>
    <li><b>Calcule o custo total, e não o preço do token.</b> Votos, retentativas e gates entram na conta. O preço pode mudar de faixa conforme o tamanho do prompt.</li>
    <li><b>Separe quem decide de quem mede.</b> A IA propõe e confere o que dá para conferir; a decisão sobre o que importa é sua.</li>
    <li><b>Registre o que não foi verificado.</b> Uma lista de pendências honesta vale mais que uma lista de fontes grande.</li>
  </ul>

  <h2>O que acontece depois que você decidir</h2>
  <ol class="l">
    <li>Eu ajusto premissa, hipóteses e margens como você mandar e registro a sua aprovação em cada passo.</li>
    <li>Escrevo o plano de análise, o plano de testes, o ambiente e o dicionário de dados como rascunho, e você aprova.</li>
    <li>Com o piloto, estimamos a variância e fixamos o tamanho da amostra. Só então o pré-registro é congelado.</li>
  </ol>
</main>
"""

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1])
