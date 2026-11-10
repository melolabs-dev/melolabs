# Mini data lake do estudo 2 (rascunho de 08/11/2026)

Zonas:
- `bruto/`: documentos como estão. Gerado por `tools/rag-lake/build_bruto.py` (regras de seleção no cabeçalho do script). Manifesto com hash, tamanho e estimativa de tokens em `manifesto-bruto.json`.
- `curado/`: cartões de decisão (`cartoes-*.json`, conferidos por `tools/rag-lake/verificar_cartoes.py`) e metadados por documento.
- `indice/`: BM25 (SQLite FTS5) e embeddings. Ainda não construído.

Origem do conteúdo:
- **h3** (github.com/h3js/h3, licença MIT) no commit `f0e17808ac2439b6434bb10609a961067f4d555b`: documentação, AGENTS.md, README.md, as 20 versões mais recentes do CHANGELOG, 12 arquivos de código-fonte, 23 issues e 26 PRs escolhidos por regra. O texto desses arquivos pertence aos autores do h3 e segue a licença MIT do projeto; nada foi alterado, exceto a normalização de quebras de linha.
- **estudo1/**: arquivos de planejamento e adendos do estudo 1 do Melo Labs (MIT e CC BY 4.0, conforme o repositório). Nenhum dado de empresa.

Cuidado de interpretação: o tamanho é estimado em caracteres divididos por 4. Código e tabelas costumam gerar mais tokens que isso, então o total real deve ser medido no piloto antes de rodar o braço A2 (lake inteiro colado).

## Estado em 08/11/2026 (noite)
- `bruto/`: 109 documentos (manifesto-bruto.json). O PR #1608 (doc-0056) termina cortado no limite de 4.000 caracteres do script; nenhuma pergunta o usa.
- `curado/`: 152 cartões conferidos (`cartoes.json`); `correcoes-ids-iss.json` registra a correção de 68 ids de documento.
- `perguntas/`: 120 perguntas em `perguntas.json`; os rascunhos por bloco estão em `rascunho-*.json`.
- `revisao/`: respostas da revisão cega por Opus (`saida-1..5.json`) e comparação (`comparacao.json`, da primeira passada).
- `indice/`: ainda não construído.
