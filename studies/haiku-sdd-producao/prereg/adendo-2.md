# Adendo 2 ao pré-registro (07/11/2026): extensão da amostra pela regra de parada

> Feito **antes** de qualquer dado da extensão. A coleta principal (138 execuções) e a avaliação cega (396 julgamentos) terminaram em 06/11 e 07/11; a análise pré-registrada deu **H1, H4, H5 e H11 subpotentes** (rubrica com alfa de Krippendorff 0,62 < 0,67; H4 com intervalo de Newcombe de −34,2 a +1,9 pontos contra margem de 10). O passo F6.3 do protocolo manda estender a amostra antes de qualquer afirmação. O autor decidiu em 07/11/2026: **mais juízes e mais repetições**. Tag do adendo: `prereg-haiku-sdd-producao-adendo2`.

## O que se estende (uma única vez)
1. **Mais repetições de execução**, em todas as seis variantes (sem escolher as que "discriminam"), para não enviesar:
   - C0 (Sonnet padrão): repetições 7 a 9 nas 6 variantes (+18, total 54).
   - C4 (Haiku com testes primeiro e loop): repetições 7 a 9 nas 6 variantes (+18, total 54).
   - C1 (Haiku simples): repetições 4 a 6 nas 6 variantes (+18, total 36).
   - C5 (cascata): repetições 4 a 6 em #1267 e #1050-b (+6, total 12).
   - Total: **60 execuções novas** (`dados/bruto/plano-extensao.json`, ordem sorteada com semente 20261107, uma por vez, mesmo orquestrador e mesmos prompts).
2. **Mais artefatos julgados:** TechSpec e Tasks de **todas** as execuções de C0, C1, C4 e C5 em todas as variantes (antes só #1267 e #1050-b, repetições 1 a 3).
3. **Mais juízes:** 5 amostras do mesmo modelo (Opus) por artefato, em vez de 3, incluindo os artefatos já julgados (juízes 4 e 5 acrescentados). Continua a declaração: são amostras do mesmo modelo, não juízes independentes.

## Regras da extensão (fixadas agora)
- **Rubrica, prompt do juiz e material continuam congelados** (hashes no manifesto do adendo 1). Não se revisa a rubrica para subir a concordância.
- **Dois resultados lado a lado, sempre:**
  - **Análise primária pré-registrada** (a de 07/11): as 138 execuções originais e os 3 juízes originais nos artefatos originais. Já está em `dados/processado/analise.json` e **não muda**.
  - **Análise estendida** (esta): todas as execuções e todos os julgamentos, com as mesmas regras de decisão de `regras-de-decisao.md`. Mesmo método (Newcombe, permutação estratificada por feature, alfa de Krippendorff com limite de 0,67).
- **Alfa:** o limite de 0,67 vale sobre a matriz estendida (5 juízes, todos os artefatos). O alfa dos 3 juízes originais e o alfa por tipo e por critério são reportados ao lado. Reporta-se também, como exploratório e não como critério, o alfa esperado da **média** de 5 juízes pela fórmula de Spearman-Brown.
- **Regra de parada:** esta é a **única extensão**. O que continuar subpotente depois dela é publicado como subpotente, sem nova rodada e sem nova mudança de critério.
- **Ordem:** o script `analise/analise.py` ganha a opção de análise estendida e é commitado **antes** de se olhar qualquer resultado da extensão.
- **Estratos:** a permutação segue estratificada por feature (#1267, #1384, #1050), agora com todas as variantes.
- **Fase C** continua adiada.

## O que isto não resolve (limites declarados)
Mais juízes do mesmo modelo reduzem o ruído da média, mas não elevam por si o alfa individual: se o alfa continuar abaixo de 0,67, as hipóteses de rubrica seguem subpotentes pela regra. Mais repetições estreitam os intervalos da H4, mas não mudam o fato de o C4 ter falhado em #1384-a e #1384-c.
