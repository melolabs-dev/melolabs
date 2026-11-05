# Hipóteses candidatas (fora deste artigo)

Levantadas na busca de 04/11/2026. Não entram no pré-registro deste estudo, para o artigo sair com todas as hipóteses decididas. Cada uma vira um estudo próprio, com o mesmo protocolo. Base: apenas fontes verificadas.

| # | Hipótese candidata | Base verificada | Medida sugerida |
| --- | --- | --- | --- |
| C1 | Um pacote de contexto mínimo por tarefa reduz alucinações e erros em relação a colar o PRD inteiro | lost-in-the-middle, chroma-context-rot | Contagem de afirmações sem sustentação (C8) por texto |
| C2 | A verificação independente em perguntas separadas (CoVe) reduz inconsistências no PRD | cove | Contradições encontradas por juiz cego, antes e depois |
| C3 | IDs de requisito citados em cada tarefa permitem detectar pelo menos 80% das alucinações injetadas, sem falso positivo | citation-discipline-sdd | Recall e falsos positivos com erros plantados |
| C4 | Prefixo estático com cache reduz o custo de entrada por feature em pelo menos 50% | anthropic-pricing (cache hit de US$ 0,01 contra US$ 0,10) | USD de entrada por feature com e sem cache |
| C5 | Exemplos aprovados recuperados por similaridade superam um modelo fixo de exemplos | repocoder, agent-workflow-memory | Aceite na primeira passada |
| C6 | Lições e receitas extraídas de reprovações reduzem as iterações até o verde | erl, agent-workflow-memory, reflexion | Iterações até o verde |
| C7 | Roteamento por dificuldade, antes da geração, supera a cascata por gate em custo | routellm, frugalgpt | USD por artefato aceito |
| C8 | Gerar em texto livre e converter para JSON em uma segunda chamada preserva a qualidade do raciocínio | format-restrictions | Nota da rubrica com JSON direto e com duas chamadas |
| C9 | Híbrido: Haiku em PRD e Tasks e Sonnet só na TechSpec custa menos que a cascata completa, com qualidade equivalente | snell-test-time, frugalgpt | Razão de custo e de qualidade |
| C10 | A quantidade de amostras proporcional à dificuldade é mais barata que votar sempre | snell-test-time, llm-monkeys | USD por decisão correta |
| C11 | Prompts acima de 100 mil tokens custam proporcionalmente mais (tier de preço do Haiku 5.5) e o pacote mínimo evita isso | anthropic-pricing | Maior prompt por chamada e USD |
| C12 | O resultado se mantém em outros projetos e outras features | specdriven-registered-report (método) | Repetir o estudo em outro projeto aberto |
