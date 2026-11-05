# Melo Labs — instruções para o Claude

Nome do blog: **Melo Labs** (decisão do autor, Caio Melo, em 2026-11-04). Domínio: **melolabs.net** (registrado em 2026-11-04); usar o mesmo @ em GitHub, LinkedIn, DEV e Hashnode.

Blog de tecnologia em português focado em **cloud, arquitetura de software, engenharia de software e IA**.
Linha editorial: **estudo prático e científico** — hipótese, experimento, dados, conclusão (inclusive "não vale a pena").
Público: devs júnior/pleno que o autor mentora + comunidade em geral. Publicação: blog próprio e/ou Medium.

## Estrutura

- `inbox/` — artefatos brutos (notas de trabalho, rascunhos, links, prints). Nada aqui é publicado direto.
- `studies/<slug>/` — um estudo por pasta: `README.md` (hipótese e status), `experiments/`, `data/`, `results/`.
- `posts/drafts/` — artigos em andamento. `posts/published/` — já publicados.
- `templates/` — modelos de artigo, estudo e relatório de experimento.
- `assets/` — imagens e diagramas.

## Fluxo de trabalho

1. Autor joga material em `inbox/` (ou descreve por voz/texto pelo celular).
2. Claude lê, resume e propõe: hipótese testável + plano de experimento (usar `templates/estudo.md`).
3. Experimentos são executados/registrados em `studies/<slug>/experiments/` com dados reproduzíveis.
4. Resultados viram artigo em `posts/drafts/` (usar `templates/artigo.md`).
5. Revisão do autor → mover para `posts/published/` e publicar.

## Base de conhecimento (RAG local)

- `knowledge/notes/*.md` = **fonte de verdade** (Markdown com frontmatter). `knowledge/index/rag.sqlite` = índice derivado (SQLite FTS5/BM25), reconstruível.
- **Antes de escrever qualquer draft ou análise**, consultar: `python tools/rag/rag.py search "<pergunta>"` (use `--validated` para só o que o autor já validou). Citar a nota e a `source_url`.
- Frontmatter: `evidence` (experimento-proprio | revisao-de-literatura | hipoteses-nao-testadas | fonte-externa), `validated_by_author` (**experimentos feitos e executados pelo próprio autor chegam como `true`**, por decisão dele em 2026-11-04; revisões de literatura, resumos, hipóteses e material de terceiros começam `false` até o autor validar), `publishable` (começa `false`; só `true` após anonimização), `fidelity` (lossless-html | transcricao-fiel | resumo-curado).
- Nota **não validada** nunca é apresentada como fato em post: marcar como "relato/hipótese" ou medir de novo.
- Novos artefatos: colocar o original em `inbox/_raw/<slug>/`, registrar em `knowledge/sources.json`, rodar `import-html` (se HTML) e `build`. Notas escritas à mão entram direto em `knowledge/notes/`.
- Material do trabalho (repositórios, ferramentas de segurança, nomes internos) fica `publishable: false` até ser anonimizado.

## Publicação automática

- Draft: `posts/drafts/<slug>/pt.md` e `en.md`, com frontmatter `title`, `lang`, `tags`, `sources: [ids das notas do RAG]`, `status` (draft | review | approved).
- **Só o autor aprova.** Quando o autor disser "aprovado" para um post (e idioma), isso é a permissão para publicar aquele post: mudar `status: approved` e rodar `python tools/publish/publish.py <slug> --lang <pt|en> --yes`. Nunca aprovar por conta própria.
- Sempre rodar antes a simulação (sem `--yes`) e mostrar o resultado do portão. O portão bloqueia se: status ≠ approved, nota-fonte não validada ou não publicável, `TODO` no texto.
- O script publica no DEV e no Hashnode via API (com `canonical_url` do site), faz commit e push do repositório (o site publica a partir daí) e grava `linkedin-<lang>.txt` para o autor postar.
- Credenciais só em `.env` (ver `.env.example`). Eu não leio, peço nem digito senhas, tokens ou cookies; não uso o navegador para fazer login. Se um token faltar, o script pula aquela plataforma e avisa.

## Pesquisa (protocolo)

- Todo artigo nasce de um estudo, criado com `python tools/research/pesquisa.py new <slug> "Título"`. O protocolo (12 fases, 46 passos) está em `research/protocolo.json` e em `docs/protocolo-de-pesquisa.md`.
- Conferir o progresso com `python tools/research/pesquisa.py status <slug>`. Passos conferidos por máquina não podem ser marcados à mão; passos manuais só com `done <slug> <passo> "evidência"`.
- Ordem obrigatória: premissa, evidências (fontes verificadas em `studies/<slug>/fontes/`), hipóteses e margens, pré-registro congelado, plano de testes, execução, análise, réplica, congelamento dos dados, escrita, aprovação do autor, publicação.
- Nunca inventar fonte, DOI, URL ou número. Cada fonte precisa de `verificada: true` (confirmada por abertura da URL ou DOI) e cada número do artigo precisa de uma linha em `claims.json` apontando para dado ou fonte.
- Hipótese não termina como "inconclusiva": ou é confirmada, refutada ou equivalente, ou fica `subpotente` e a amostra é estendida pela regra de parada. Artigo com hipótese pendente ou subpotente não é publicado.
- Dados brutos só se acrescentam; nada é editado à mão. Mudanças no plano depois do pré-registro entram como emenda datada no diário.

## Idiomas

- O blog é **bilíngue: português (pt-BR) e inglês**. Decisão do autor em 2026-11-04.
- Cada post vira uma pasta `posts/drafts/<slug>/` com `pt.md` e `en.md`. Frontmatter: `lang` (pt|en) e, no espelho, `translation_of: <slug>`.
- Escrever o texto-base em pt-BR, gerar o `en.md` a partir dele e deixar os dois para revisão do autor. Números, tabelas e links de dados são idênticos nas duas versões; nunca ajustar um número só em um idioma.
- Publicar o pt-BR primeiro; o inglês sai no máximo 3 dias depois (HN, Reddit e DEV rendem mais em inglês).

## Regras de conteúdo

- Nunca inventar números ou benchmarks. Todo dado precisa vir de um experimento registrado em `studies/`; se não houver, marcar `TODO: medir`.
- Todo benchmark documenta: ambiente (hardware/região/versões), metodologia, nº de repetições, média e variação (p50/p95/desvio), limitações.
- Reportar resultados negativos e inconclusivos com o mesmo rigor.
- **Confidencialidade**: material de trabalho pode conter dados da empresa. Anonimizar nomes, clientes, URLs internas, credenciais e métricas de negócio antes de qualquer rascunho publicável. Em dúvida, perguntar.
- Nunca commitar segredos. Usar `.env` (ignorado pelo git).
- Tom: direto, didático, honesto sobre incertezas; escrever em pt-BR; termos técnicos em inglês quando padrão.
- Frontmatter obrigatório nos posts: `title`, `date`, `tags`, `status` (draft|review|published), `study` (slug do estudo).
