# Síntese das evidências

> Rascunho com base apenas nas 30 fontes verificadas em `fontes/`. Cada afirmação cita o id da fonte. O autor precisa ler e validar.

## O que as fontes estabelecem
- **Mudar o fluxo ajuda mais que mudar o prompt.** Dividir a tarefa e planejar antes de gerar elevou o desempenho em código: o pass@5 do GPT-4 foi de 19% para 44% no CodeContests [alphacodium], e planejar antes de codificar deu até 25,4% de ganho em Pass@1 sobre a geração direta [self-planning].
- **Autocorreção precisa de feedback externo.** Sem feedback externo, os modelos não melhoram e às vezes pioram [llm-self-correct]. Com feedback de testes, o Reflexion chegou a 91% de pass@1 no HumanEval contra 80% do GPT-4 [reflexion].
- **Testes escritos antes ajudam.** Dar testes junto do enunciado melhorou a geração de código [tdd-codegen]; o fluxo TiCoder teve melhora média absoluta de 45,97% no pass@1 [ticoder]; gerar testes para escolher entre soluções subiu o pass@1 do HumanEval para 65,8% [codet].
- **Gastar computação onde é difícil compensa.** A alocação adaptativa foi mais de 4 vezes mais eficiente que best-of-N, e um modelo menor superou um 14 vezes maior onde já tinha sucesso moderado [snell-test-time]; 250 amostras elevaram um modelo de 15,9% para 56% no SWE-bench Lite [llm-monkeys].
- **Cascatas e roteadores reduzem custo.** Até 98% menos custo com desempenho igual ao do GPT-4 [frugalgpt]; custo reduzido em mais de 2 vezes em certos casos com a qualidade mantida [routellm].
- **Votação melhora raciocínio.** Self-consistency trouxe de +3,9% a +17,9% conforme o benchmark [self-consistency].
- **Contexto longo e formato rígido pioram o modelo.** A informação no meio do contexto é a mais perdida [lost-in-the-middle]; 18 modelos pioraram com a entrada maior [chroma-context-rot]; saída estruturada rígida reduz o desempenho de raciocínio [format-restrictions].
- **Rastreabilidade permite detecção automática.** Exigir citação por linha permitiu detectar alucinação automaticamente em cerca de 86–88% dos casos contra 0% sem citação, com troca de determinismo por verificabilidade [citation-discipline-sdd]. Testado em Sonnet 4.6 e GLM-5-turbo, não em Haiku.
- **Requisitos por LLM exigem revisão humana.** A qualidade depende da entrada e costuma pedir revisão [llm-requirements-consulting].
- **Preço.** Haiku 5.5: US$ 0,10 de entrada e US$ 0,50 de saída por milhão de tokens até 100 mil tokens de prompt, e US$ 0,50 e US$ 2,50 acima disso; Sonnet 5.5: US$ 2 e US$ 10 [anthropic-pricing]. A razão de 1/20 só vale até 100 mil tokens; acima, cai para 1/4.

## Onde as fontes discordam ou são frágeis
- **Números mudam entre versões.** O Agentless aparece com 32,00% e US$ 0,70 na versão atual do resumo e com 27,33% e US$ 0,34 nos artefatos anteriores [agentless]. Citar sempre a versão.
- **Ganhos de agentes são de fornecedor.** O ganho de 90,2% do multiagente e o argumento de que tokens explicam 80% da variância vêm de avaliação interna da Anthropic [anthropic-multi-agent]; a recomendação de começar simples e só complicar com ganho demonstrado vem da mesma fonte [anthropic-effective-agents].
- **Os resultados são de modelos e tarefas diferentes.** Quase nenhum usa o Haiku 5.5 nem fluxos completos de SDD. Tratar os números como direção, não como magnitude.
- **Juízes LLM têm vieses.** Posição, verbosidade e autopreferência [llm-as-judge]. Por isso o estudo ancora a nota em medidas determinísticas e em testes ocultos.

## O que ainda não foi testado (lacunas)
- Nenhuma fonte mede um fluxo completo de SDD (PRD, TechSpec, Tasks e código) só com um modelo pequeno.
- Nenhuma fonte compara a alucinação em PRD e especificação entre modelos pequenos e grandes.
- O efeito combinado das mitigações (e o custo delas somado) não aparece nas fontes; elas medem cada técnica isolada.
- O comportamento do Haiku 5.5 em contextos acima de 100 mil tokens, onde o preço sobe, não foi medido por nenhuma fonte.
