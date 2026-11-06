# Rubrica de avaliação cega (congelada no adendo 1, 06/11/2026)

Cada artefato recebe uma nota de 0 a 5 por critério. O juiz recebe só o artefato (com um código aleatório), esta rubrica e o repositório h3 no commit base, em modo leitura. Ele não sabe qual modelo, condição ou variante gerou o texto.

Âncoras comuns: **0** ausente ou errado; **1** muito fraco, quase inutilizável; **2** fraco, com falhas que exigem retrabalho; **3** aceitável, com falhas pontuais; **4** bom, com pequenas lacunas; **5** excelente, sem lacunas relevantes.

## TechSpec (7 critérios, soma de 35)
- **C1 Cobertura do pedido:** cobre todo o comportamento pedido na issue e na norma citada, sem inventar escopo.
- **C2 Precisão factual:** as citações `arquivo:linha` existem e dizem o que a TechSpec afirma. O juiz confere cada citação no repositório. Citação inventada ou errada derruba a nota; conte-as em `alucinacoes`.
- **C3 Decisões:** cada decisão tem alternativas reais e uma escolha justificada, e as escolhas são coerentes entre si.
- **C4 Executabilidade:** um desenvolvedor pleno implementa a partir do texto, sem precisar perguntar nada; assinaturas, contratos e arquivos a alterar estão claros.
- **C5 Testabilidade:** a estratégia de testes cobre os comportamentos e os casos de borda relevantes, de forma verificável.
- **C6 Escopo e riscos:** fora de escopo, premissas, lacunas e riscos reais estão declarados.
- **C7 Rastreabilidade:** requisitos ligados a decisões, arquivos e testes.

## Tasks (5 critérios, soma de 25)
- **T1 Cobertura:** todo requisito do PRD e toda decisão da TechSpec aparece em alguma tarefa.
- **T2 Rodapé de arquivos:** cada tarefa declara os arquivos que toca, e esses arquivos são plausíveis para a tarefa.
- **T3 Dependências:** a ordem e as dependências entre tarefas fazem sentido e não têm ciclos.
- **T4 Granularidade:** tarefas pequenas e independentes o bastante para serem feitas e verificadas uma a uma.
- **T5 Aceite:** cada tarefa tem um critério de aceite verificável.

## Saída exigida do juiz
Um único bloco JSON, sem texto fora dele:
`{"criterios": {"C1": n, "C2": n, ...}, "alucinacoes": n, "observacao": "no máximo 2 frases"}`
