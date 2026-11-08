# Ameaças à validade

Escrito em 07/11/2026, depois da coleta, dos julgamentos e das análises primária e estendida. Cada item diz o que ameaça, o que foi feito e o que sobra.

## Interna (o resultado é causado pelo que mudamos?)
- **Isolamento do agente.** Cada etapa é um processo `claude -p` novo, com a pasta de execução de nome opaco, sem `.git` do projeto nem remoto, web negada e ferramentas restritas. A auditoria varre as ações do agente e não achou vazamento: uma execução (C2n-session-1050-b-r1) foi marcada, e o conteúdo são edições do próprio agente em arquivos de teste com nome parecido com o do gabarito (provável falso positivo, mantida na análise principal). O que sobra: o histórico git do repositório do estudo ainda contém versões antigas dos testes ocultos em texto claro, fora do alcance do agente, mas declarado.
- **Quem escreveu os testes e quem roda é a mesma sessão** (orquestrador, autor do gabarito e do protocolo). Reduzido por um script que monta os prompts, por hashes e por um adendo de revisão adversarial independente, mas não eliminado.
- **Ordem e carga.** A ordem das execuções foi sorteada (semente fixa) e as condições comparadas estão intercaladas. A duração das execuções da extensão pode ter sofrido carga de um juiz rodando junto (declarado no adendo 2b); tokens e custo não são afetados.
- **Ajustes durante o estudo.** O contrato enxuto e o núcleo de testes foram definidos depois do piloto, e a extensão da amostra veio depois dos primeiros resultados. Ambos estão registrados em adendos com tag, antes dos dados que afetam; a análise primária (138 execuções) fica ao lado da estendida (198).
- **Juízes.** Cegos à condição e com códigos aleatórios, mas os estilos do Haiku e do Sonnet são reconhecíveis; o cegamento não é perfeito.

## Externa (vale fora deste contexto?)
- **Um projeto (h3, TypeScript), três features, seis variantes.** Resultado pode não valer para outras linguagens, domínios ou tamanhos de tarefa. A diferença entre variantes (o C4 perde em #1384 e #1267, não em #1050) mostra que o efeito depende da tarefa.
- **Versões de modelo e preços de 04/11/2026** (Haiku 5.5, Sonnet 5.5, Opus 5.5). Os modelos mudam; os números têm data.
- **Ferramenta e permissões.** Tudo roda no Claude Code CLI, com `CLAUDE.md` e `AGENTS.md` do h3 presentes nas duas condições. Outro agente ou outro projeto de contexto pode dar resultados diferentes.
- **Custo é de lista**, vindo do campo `total_cost_usd` da CLI com a assinatura do autor, não de uma conta de API. A faixa mais cara do Haiku (acima de 100 mil tokens de prompt) já está incluída em 52 das 54 execuções do C4, mas descontos e limites reais de uso não são medidos.
- **A fase C não foi feita:** voto, erros plantados, cache e variantes extras (H2, H7, H8, H9 e S8 a S11) ficam não testados.

## De construto (a métrica mede o que dizemos que mede?)
- **"Qualidade de código" é o núcleo de testes ocultos (100% mais typecheck e lint).** É uma medida estrita e binária: uma falha em qualquer teste reprova a execução. Os testes foram escritos por nós, a partir de contratos de comportamento; podem premiar uma solução que se parece com a nossa. O desfecho secundário (fração de testes passando, incluindo observações) é reportado ao lado e dá um quadro menos duro: 0,89 (C4) contra 0,91 (C0).
- **"Qualidade de documento" é uma rubrica de TechSpec (35 pontos) e de Tasks (25).** As notas ficam coladas no teto (cerca de 32 de 35 e de 20 a 21 de 25), então a rubrica separa pouco. O PRD não foi pontuado.
- **Os três juízes são amostras do mesmo modelo (Opus)** e o alfa de Krippendorff ficou em 0,61 (TechSpec 0,55, Tasks 0,56), abaixo do 0,67 pré-registrado: a rubrica é pouco confiável como instrumento de decisão.
- **A "cascata" nunca escalou** (0 em 12 execuções), então o construto "cascata" equivale ao Haiku com gates.

## De conclusão (a estatística sustenta a conclusão?)
- **Amostras pequenas em vários braços:** C5 com 12, C6 e as condições de persona e contexto com 6 execuções. Intervalos largos nesses braços; os sinais de H11 são exploratórios.
- **Regra de decisão pré-registrada manda o resultado:** H1, H4, H5 e H11 saem subpotentes. Na H4, a diferença entre C4 e Sonnet (−18,5 pontos, Newcombe unilateral 97,5% de −32,6 a −3,8) é negativa com credibilidade, mas o intervalo não exclui um déficit menor que a margem de 10 pontos; escrever "o Haiku equivale ao Sonnet em código" seria falso, e escrever "o Haiku é pior por mais de 10 pontos" também.
- **Múltiplas comparações:** a família principal (H4 e H5) usa Holm; os p-valores unilaterais de H11 (0,01 a 0,02 no C12) não foram corrigidos e são exploratórios.
- **Unidade de análise:** a execução, com estratos por feature. Variantes dentro da mesma feature não são independentes; a análise por variante vai ao lado.
- **Análise estendida única.** A extensão foi uma só e não houve critério de parada por resultado; ainda assim, quem olha os dados parciais antes do fim (como foi feito) corre o risco de enviesar escolhas futuras. Nenhuma regra mudou depois de olhar.
