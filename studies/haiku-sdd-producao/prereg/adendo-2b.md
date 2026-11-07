# Adendo 2b (07/11/2026): julgamento enxuto da extensão

> Feito **antes de qualquer resultado da extensão** (as execuções novas ainda estão rodando; só 3 julgamentos de teste da extensão foram gerados antes da decisão e ficam fora da análise se não pertencerem ao conjunto abaixo). Motivo: o autor achou 1.580 julgamentos Opus caros e demorados. Tag: `prereg-haiku-sdd-producao-adendo2b`. **Substitui o item 2 e o item 3 do adendo 2**; os demais itens valem.

## O que muda
1. **Volta a 3 juízes por artefato** (a ideia de 5 sai). Motivos: 5 amostras do mesmo modelo não elevam o alfa individual (só o ruído da média), e custavam 40% do total.
2. **Conjunto julgado, fixado agora** (`dados/bruto/ids-julgar-total.txt` e `ids-julgar-extensao.txt`):
   - Os 132 artefatos já julgados continuam como estão.
   - C0 e C1: repetições 1 a 3 das **6 variantes** (18 execuções por condição; antes só 6). Isso usa dados que já existem e acrescenta a feature #1384, que não tinha nenhum artefato julgado.
   - C5: repetições 1 a 6 em #1267 e #1050-b (12 execuções).
   - **C4 deixa de ser julgado além das 6 execuções originais**: nenhuma hipótese de rubrica usa os documentos do C4 (H3 é não testável, H4 é de código, H5 usa C5 contra C0).
   - Total novo: 60 artefatos × 3 juízes = **180 julgamentos** (cerca de 1,5 hora e US$ 50 de lista), no lugar de 1.580.
3. **Mesmas regras de análise:** rubrica e prompt congelados, 3 juízes, permutação estratificada por feature (agora com as 3 features nas comparações H1 e H5), alfa de Krippendorff com limite de 0,67 sobre o conjunto estendido, e o alfa dos 3 juízes originais ao lado. Os dois resultados (primário e estendido) continuam lado a lado.
4. **Execuções:** as 60 execuções do adendo 2 seguem como planejadas (a análise de código da H4 usa todas).
5. **Nota de medição:** como julgar e executar foi planejado em paralelo para ganhar tempo, a duração das execuções da extensão pode ter sofrido carga extra de um juiz rodando junto. Tokens e custo não são afetados; a duração é só descritiva e a diferença será declarada.

## Limite declarado
Sem os juízes 4 e 5 e sem os documentos do C4 em todas as variantes, a análise de alucinações do C4 (exploratória) continua com as 6 execuções originais.
