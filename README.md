# Melo Labs

Estudos práticos de cloud, arquitetura, engenharia de software e IA — com testes, benchmarks e dados.
Pergunta central de cada post: **"isso funciona? vale o custo? quanto ganha?"**

Veja `CLAUDE.md` para o fluxo e as regras editoriais.

## Pastas

| Pasta | Uso |
|---|---|
| `inbox/` | material bruto (notas, artefatos de estudo) |
| `studies/` | estudos com hipótese, experimentos e dados |
| `posts/drafts/` | artigos em andamento |
| `posts/published/` | artigos publicados |
| `templates/` | modelos de estudo, experimento e artigo |
| `assets/` | imagens e diagramas |

## Começar um estudo

Copie `templates/estudo.md` para `studies/<slug>/README.md` (ou peça ao Claude: "abre um estudo sobre X a partir de inbox/Y").

## Licenças

- **Código** (`tools/`, `site/`, scripts de análise em `studies/*/analise/` e demais programas): [MIT](LICENSE).
- **Textos, figuras e dados do estudo** (`posts/`, `knowledge/`, `assets/`, `studies/`, documentação): [CC BY 4.0](LICENSE-CONTENT-CC-BY-4.0.txt). Pode copiar, adaptar e redistribuir, desde que cite "Caio Melo, Melo Labs" e o DOI do estudo.
- **Material de terceiros** continua sob a licença original: os transcritos e diffs de execução em `studies/*/dados/bruto/` contêm trechos do projeto aberto h3 (licença MIT do próprio projeto) e saídas de modelos.

Como citar o Estudo 1: Melo, C. *SDD só com Haiku: o que sobra de qualidade quando o custo cai.* Melo Labs, 2026. https://doi.org/10.5281/zenodo.24048447
