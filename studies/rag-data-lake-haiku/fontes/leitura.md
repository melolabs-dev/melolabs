# Leitura para o estudo 2 (08/11/2026)

Os 18 PDFs estão em `pdf/` (nome = ID do arXiv) e o texto extraído em `txt/`. Cada artigo tem uma ficha neste diretório, escrita depois da leitura do texto inteiro, com método, números e localização (seção, tabela, figura), limitações e ajustes ao plano. A síntese está registrada na base de conhecimento em `knowledge/notes/revisao-rag-data-lake-haiku.md` (não validada pelo autor).

Ressalvas: a extração de texto embaralhou algumas tabelas, e as fichas marcam "conferir no PDF" onde a leitura veio de tabela reconstruída. As figuras não foram lidas como imagem. A leitura foi feita por agentes; conferi à mão apenas três pontos (concordância das repetições no 4B, troca de índice no Lewis e a ausência de teste no corpo do artigo de ADR).

## Fichas
| Ficha | Artigo | Nível | Papel no estudo |
|---|---|---|---|
| [adr-context-strategies](adr-context-strategies.md) | 2604.03826, Context Matters (ADR) | B | contexto para ADR; empate entre estratégias, sem teste |
| [finetune-vs-rag-4b](finetune-vs-rag-4b.md) | 2604.23801, fine-tuning contra RAG (4B) | A | RAG sem ganho num modelo pequeno; estatística a copiar |
| [power-of-noise](power-of-noise.md) | 2401.14887 | B | controles N1 e N2 |
| [lost-in-the-middle](lost-in-the-middle.md) | 2307.03172 | A | posição; braço A2 |
| [agentic-rag-ablation](agentic-rag-ablation.md) | 2606.21553 | B | híbrido e reranqueamento |
| [draft-adr](draft-adr.md) | 2504.08207 | B | RAG em ADR (texto livre) |
| [rag-lewis](rag-lewis.md) | 2005.11401 | B | origem do RAG; troca de índice |
| [self-rag](self-rag.md) | 2310.11511 | B | quando recuperar; conceito |
| [crag](crag.md) | 2401.15884 | B | avaliador de recuperação (não abstém) |
| [seven-failure-points](seven-failure-points.md) | 2401.05856 | C | taxonomia de falhas |
| [chunk-size](chunk-size.md) | 2505.21700 | B | chunk como variável de controle |
| [ragops](ragops.md) | 2506.03401 | D | lake, metadados, versões |
| [lean-lm-rag](lean-lm-rag.md) | 2508.11386 | C | modelo pequeno sobre coleção de domínio |
| [drag-slm](drag-slm.md) | 2506.01954 | B | evidência para modelo pequeno (sem fine-tuning) |
| [repo-qa-benchmark](repo-qa-benchmark.md) | 2603.26567 | B | RAG em repositório; recuperação abaixo do modelo sozinho |
| [unweaving-graphrag](unweaving-graphrag.md) | 2603.29875 | C | vetor quase basta; oráculo não é teto |
| [agent-retrieval-bench](agent-retrieval-bench.md) | 2607.24882 | B | abstenção por pontuação falhou; ruído aleatório |
| [contextbench](contextbench.md) | 2602.05892 | B | validar o ouro; queda de uso |

## Não baixado, para conferir se precisar
- Contexto longo contra RAG (2501.01880) e ajuste fino com fatos novos (2405.05904): só vistos em resumos de blog, nunca confirmados.
- "Triple-Robustness Analysis of RAG for Multi-Hop Requirements Traceability": só visto em um agregador, ID não confirmado.
- Gloaguen et al. (2026) sobre CLAUDE.md e AGENTS.md está nas fontes do estudo 1.

## Lacuna
Nenhum artigo lido mede RAG em decisões de projeto com modelo pequeno comparado a um maior com o mesmo oráculo. Nenhum apoia diretamente curadoria por metadados (A5, H5) nem abstenção (H7).
