---
id: format-restrictions
titulo: "Let Me Speak Freely? A Study on the Impact of Format Restrictions on Performance of Large Language Models"
autores: "Tam, Wu, Tsai, Lin, Lee, Chen"
ano: 2024
tipo: academico
url: https://arxiv.org/abs/2408.02442
doi:
acessado: 2026-11-04
nivel_evidencia: B
vies: "preprint no arXiv; confirmar a publicação em evento antes de citar como revisado por pares"
verificada: true
---
# Let Me Speak Freely? A Study on the Impact of Format Restrictions on Performance of Large Language Models

> Verificada em 04/11/2026: a página foi aberta e o título, os autores e o resultado abaixo conferem com o texto dela.

## Resumo
Exigir saída estruturada (JSON, XML) reduz de forma significativa o desempenho de raciocínio em comparação com respostas livres; restrições mais rígidas degradam mais. Sem números no resumo.

## Afirmações extraídas (com localização)
- formato rígido degrada o raciocínio; mais rígido, pior (resumo)
- Conferido no texto completo em 05/11/2026 (HTML do arXiv v3): modelos testados incluem gpt-3.5-turbo, claude-3-haiku, gemini-1.5-flash, LLaMA-3-8B e Gemma-2-9B. Na Tabela 9, GSM8K com Claude 3 Haiku: 86,5 em texto contra 23,4 em prompt JSON (desvio 22,8); GPT-3.5: 76,6 contra 49,3. O Gemini-1.5-Flash ficou igual (89,3 contra 89,2).
- Ordem do pior ao melhor em GSM8K, Last Letter e Shuffled Objects: JSON-mode, instrução de formato, conversão de texto para formato, texto livre (legenda da Figura 2). A conversão em duas etapas tem desempenho quase idêntico ao texto livre na maioria dos modelos.
- Em classificação o JSON ajudou: DDXPlus com Claude 3 Haiku, 33,8 em texto contra 52,0 em JSON. As Tabelas 10 e 11 trazem valores diferentes para JSON-mode, então esses números pedem cautela.
- No JSON-mode do GPT-3.5, 100% das respostas puseram a chave "answer" antes de "reason", o que anula o raciocínio passo a passo (texto).
- O efeito é muito dependente do modelo: o Gemini não piorou. Isso reforça medir no Haiku 5.5 em vez de assumir.

## Limitações da fonte
preprint no arXiv; confirmar a publicação em evento antes de citar como revisado por pares.
