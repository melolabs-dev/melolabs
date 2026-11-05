---
id: formatspread
titulo: "Quantifying Language Models' Sensitivity to Spurious Features in Prompt Design or: How I learned to start worrying about prompt formatting"
autores: "Sclar, Choi, Tsvetkov, Suhr"
ano: 2024
tipo: academico
url: https://arxiv.org/abs/2310.11324
doi:
acessado: 2026-11-05
nivel_evidencia: B
vies: "versão final do ICLR 2024 (indicada nos comentários do arXiv); modelos abertos, avaliação com poucos exemplos (few-shot); o Haiku não foi testado"
verificada: true
---
# Sensibilidade a características espúrias na formatação do prompt (FormatSpread)

> Verificada em 05/11/2026: a página do arXiv foi aberta e as afirmações abaixo conferem com o resumo.

## Resumo
Mostra que modelos abertos muito usados são extremamente sensíveis a mudanças sutis de formatação do prompt, e propõe o FormatSpread, que amostra formatos plausíveis e informa a faixa de desempenho esperada sem acesso aos pesos.

## Afirmações extraídas (com localização)
- Diferenças de até 76 pontos de acurácia com o LLaMA-2-13B, o único modelo citado para esse número (resumo).
- A sensibilidade continua ao aumentar o tamanho do modelo, o número de exemplos ou após ajuste por instruções (resumo).
- A correlação do desempenho por formato entre modelos é fraca; comparar modelos com um único formato arbitrário é questionável (resumo).
- Recomendação: reportar a faixa de desempenho entre formatos plausíveis, e não um único formato (resumo).

## Limitações da fonte
Poucos exemplos no prompt (few-shot) em tarefas de classificação; não cobre agentes nem geração de documentos longos como PRD ou TechSpec.
