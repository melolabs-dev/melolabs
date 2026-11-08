# Pacote de dados: SDD só com Haiku

Estudo do Melo Labs, 198 execuções (138 do plano principal e 60 da extensão) e 579 julgamentos de rubrica. Coleta em 06 e 07/11/2026.

| Arquivo | Conteúdo |
|---|---|
| `execucoes.csv` | uma linha por execução: condição, variante, núcleo de testes, typecheck, lint, gates, tokens e custo de lista somados |
| `etapas.csv` | uma linha por etapa de cada execução (PRD, TechSpec, Tasks, código), com tokens (entrada, saída, cache), custo, tempo e acessos suspeitos |
| `julgamentos.csv` | uma linha por juiz, artefato e critério da rubrica (3 juízes por artefato; TechSpec C1 a C7, Tasks T1 a T5) |
| `dicionario.md` | dicionário de dados |
| `LICENSE` | licença dos dados e do código |

Reprodução: `python tools/harness/reproduzir.py` (clone limpo) regenera `dados/processado/` a partir de `dados/bruto/`. O texto completo, as transcrições e os prompts de cada execução estão em `dados/bruto/`. O gabarito de testes ocultos está cifrado no repositório.

Limites: um projeto (h3, TypeScript); modelos e preços de 04/11/2026; juízes são amostras do mesmo modelo (alfa de Krippendorff 0,61).
