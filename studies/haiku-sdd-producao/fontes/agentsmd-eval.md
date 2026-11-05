---
id: agentsmd-eval
titulo: "Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?"
autores: "Gloaguen, Mündler-Sasahara, Müller, Raychev, Vechev"
ano: 2026
tipo: academico
url: https://arxiv.org/abs/2602.11988
doi:
acessado: 2026-11-05
nivel_evidencia: B
vies: "preprint no arXiv (v1 de 12/02/2026, v3 de 29/09/2026); a página de eventos do ICLR 2026 aparece em buscas, mas a aceitação não foi conferida; os últimos 3 mil caracteres do texto não foram lidos"
verificada: true
---
# Evaluating AGENTS.md

> Verificada em 05/11/2026: resumo e texto completo (HTML do arXiv) foram abertos. Os números abaixo são do texto; um número que apareceu num resumo de terceiros (4%) não confere e foi descartado.

## Resumo
Testa arquivos de contexto de repositório (AGENTS.md e similares) em agentes de código, em tarefas do SWE-bench com arquivos gerados por LLM e numa coleção nova de issues de repositórios que já têm arquivos escritos por desenvolvedores.

## Afirmações extraídas (com localização)
- Arquivos de contexto não melhoram, em geral, a taxa de sucesso e aumentam o custo de inferência em mais de 20% em média (resumo).
- Arquivos gerados por LLM: a taxa média de resolução cai 0,5% no SWE-bench e 2% na coleção nova, sem significância (p = 0,87 e p = 0,37) (texto).
- Arquivos escritos por desenvolvedores: ganho de 2,4% em média sobre nenhum arquivo, sem significância (p = 21%); contra os gerados por LLM, ganho de 7% (p = 0,038) (texto).
- Custo: aumento de 20% e 23% com arquivos gerados por LLM; no máximo 19% com os de desenvolvedores (texto).
- Visões gerais do repositório, recomendadas pelos fornecedores de modelos, não ajudaram; os agentes seguem bem as instruções dos arquivos (resumo).
- Com toda a documentação removida do repositório, os arquivos gerados por LLM melhoram o desempenho em 2,7% em média (Apêndice B).

## Limitações da fonte
Modelos testados incluem Sonnet 4.5, GPT-5.2, GPT-5.1 mini e Qwen3-30B; o Haiku não foi testado. As diferenças são pequenas e sem significância, então o resultado é "sem efeito detectável", e não "efeito negativo".
