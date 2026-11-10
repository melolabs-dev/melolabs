---
id: rag2-2602.05892
titulo: "ContextBench: A Benchmark for Context Retrieval in Coding Agents"
autores: "Han Li, Letian Zhu, Bohan Zhang, Rili Feng, Jiaming Wang, Yue Pan, Earl T. Barr, Federica Sarro, Zhaoyang Chu, He Ye (Nanjing University e University College London)"
ano: 2026
tipo: academico
url: https://arxiv.org/abs/2602.05892
doi: 10.48550/arXiv.2602.05892
acessado: 2026-11-08
nivel_evidencia: B
vies: "Preprint (v3, 11/02/2026), sem revisão por pares declarada. Agentes de código resolvendo issues, não perguntas de decisão com opções fechadas. Gabarito (contexto-ouro) derivado do patch correto e anotado por humanos, incluindo os próprios autores. Uma execução por tarefa e sem intervalos de confiança (não consta). Os autores sugerem possível contaminação do Devstral 2 (apêndice K)."
verificada: true
---
# ContextBench: A Benchmark for Context Retrieval in Coding Agents

> tipo: academico. nivel_evidencia: B (benchmark com método detalhado e anotação humana; o site do projeto é citado, mas a liberação dos dados não foi conferida no texto). Leitura integral do texto extraído (seções 1 a 5 e apêndices A a K). As Tabelas 2 e 3 saíram embaralhadas na extração do PDF; só uso números que a prosa ou as Tabelas 4 e 5 confirmam.

## Resumo
Os autores criam o ContextBench, um benchmark que mede a qualidade da recuperação de contexto por agentes de código, e não só se o patch final passa nos testes. São 1.136 tarefas de resolução de issues, de 66 repositórios e 8 linguagens, cada uma com um "contexto-ouro" anotado por humanos (o conjunto mínimo de trechos de código suficiente para resolver a issue). Avaliam 4 LLMs e 5 agentes. Conclusões: (1) scaffolds sofisticados não superam de forma consistente o agente simples; (2) os modelos priorizam recall sobre precisão; (3) há uma grande lacuna entre o contexto que o agente encontra e o que ele efetivamente usa no patch final.

## Método
- **Dados:** pool de 4.497 tarefas de SWE-bench Verified (500), Multi-SWE-bench (1.632), SWE-PolyBench PB500 (500) e SWE-bench Pro (1.865). Deduplicação por regras (3.981 tarefas) e por similaridade de embeddings com limiar de cosseno 0,90 mais inspeção manual (3.100). Seleção por dificuldade (solvabilidade pelos agentes do leaderboard, número de arquivos editados, dispersão das edições): 1.500 candidatas, 1.136 após revisão manual (seção 2, apêndices A e B). O apêndice A diz "cerca de 1,2 mil" no resumo do filtro final; a contagem oficial é 1.136. Subconjunto Lite de 500 tarefas para os experimentos de agentes e modelos.
- **Anotação do ouro (seção 2.3, apêndices D, F, G):** anotadores com mais de 3 anos de experiência, 4 meses de trabalho, seis autores mais desenvolvedores convidados. Partem do patch correto e rastreiam dependências (chamadas, herança, fluxo de dados). Verificação de suficiência: o GPT-5, recebendo só o contexto anotado, gera 5 patches candidatos; o contexto vale se pelo menos 1 passa em toda a suíte de testes. Se falha, mais duas rodadas com anotadores diferentes e cegos entre si. Se passa, um segundo anotador remove o que é redundante (princípio do contexto mínimo; os autores dizem que não alegam minimalidade global). Tempo médio de cerca de 40 minutos por tarefa (20 minutos a 1,5 hora).
- **Métricas (seção 2.5, apêndice H):** recall, precisão e F1 em três granularidades (arquivo, bloco AST de definição, linha), com alinhamento via tree-sitter. Métricas de processo: eficiência (área sob a curva de cobertura do ouro ao longo dos passos), redundância (fração do contexto novo que já tinha sido visto) e queda de uso, ou "usage drop" (fração do ouro visto durante a trajetória que não aparece no contexto final declarado). Robustez do ouro por similaridade de Jaccard.
- **Agentes e modelos (seção 3):** agentes mini-SWE-agent (linha de base, só comandos bash), Agentless (recuperação semântica por embeddings), SWE-agent e OpenHands (navegação no sistema de arquivos), Prometheus (grafo do repositório), todos com GPT-5. Modelos GPT-5, Claude Sonnet 4.5, Gemini 2.5 Pro e Devstral 2, todos no mini-SWE-agent. O agente declara o contexto usado antes de enviar o patch (bloco PATCH CONTEXT).
- **Parâmetros:** temperatura 0,0 para o Sonnet 4.5 no mini-SWE-agent e 1,0 para o GPT-5 no SWE-agent (apêndice C); timeout de 180 s por comando. Número de execuções por tarefa: não consta. k de recuperação: não se aplica (agentes iterativos). Tamanho de chunk: não se aplica (unidade é arquivo, bloco ou linha).

## Resultados
- **Escala (Tabela 1, seção 2.4):** 66 repositórios, 1.136 tarefas, 4.548 arquivos, 23.116 blocos e 522.115 linhas de contexto-ouro.
- **RQ1, agentes (Tabela 2, seção 3.1):** o mini-SWE-agent, o mais simples, tem métricas de contexto iguais ou melhores que as de vários scaffolds sofisticados; Prometheus explora mais, com recall maior e precisão menor. Os valores por célula ficaram ilegíveis na extração; o Pass@1 dos cinco agentes fica entre 0,452 e 0,512 na leitura do texto extraído, sem que eu consiga atribuir cada valor com segurança. Conferir no PDF antes de citar.
- **RQ2, modelos (Tabela 3, seção 3.2):** o F1 por bloco fica abaixo de 0,45 e o F1 por linha abaixo de 0,35 para todos os modelos (texto da seção 3.2). Pass@1 na ordem GPT-5, Sonnet 4.5, Gemini 2.5 Pro, Devstral 2: 0,472, 0,530, 0,364, 0,402 (leitura da tabela extraída; o texto confirma só que o Sonnet 4.5 supera o GPT-5). O GPT-5 tem recall maior em bloco e linha, mas precisão menor, F1 menor e Pass@1 menor que o Sonnet 4.5. Maior recall de contexto se associa a maior Pass@1.
- **RQ3, padrões (Tabela 4):** passos por instância 5,87 (GPT-5), 14,38 (Sonnet 4.5), 7,57 (Gemini), 22,16 (Devstral 2); linhas por passo 119,29, 29,74, 26,29, 11,98; custo por instância em dólares 0,45, 0,76, 0,38, 0,91. A estratégia equilibrada do Sonnet 4.5 dá o melhor F1 por linha e o melhor Pass@1.
- **RQ4, dinâmica (Tabela 5):** eficiência 0,591, 0,658, 0,529, 0,616; redundância 0,487, 0,708, 0,558, 0,672; queda de uso 0,179, 0,196, 0,431, 0,435 (mesma ordem dos modelos). Gemini e Devstral perdem mais de 40% do ouro que viram.
- **RQ5, robustez (seção 3.5, apêndice H):** em 82 tarefas com patches equivalentes, similaridade de Jaccard média de 0,9518 entre os contextos-ouro.

## Afirmações extraídas (com localização)
- Scaffolds mais complexos não vencem de forma consistente a linha de base simples de busca por bash: seção 3.1, resposta ao RQ1, Figura 1a e Tabela 2.
- Os LLMs privilegiam recall em vez de precisão, e há trade-off claro entre os dois: seção 3.2, Tabela 3, Figura 1b.
- Contexto demais "pode introduzir ruído e prejudicar o raciocínio" do agente: seção 3.2 (afirmação dos autores; o experimento não isola esse efeito).
- Maior recall do contexto-ouro correlaciona com maior Pass@1: seção 3.2.
- Menos rodadas de consulta reduzem custo; Devstral 2 é o mais caro por causa das muitas rodadas: seção 3.3, Tabela 4.
- Há queda consistente de uso: parte do ouro encontrado no meio da trajetória não entra no raciocínio final, e isso explica falhas apesar do sucesso de recuperação: seção 3.4, Tabela 5.
- O contexto-ouro é estável entre patches equivalentes (Jaccard 0,9518, 82 tarefas): seção 3.5.
- Verificação de suficiência do ouro por existência (pelo menos 1 de 5 patches passa): apêndice G; precisão e F1 devem ser lidas contra uma referência compacta, e não como punição estrita por trazer contexto extra útil: apêndice D.
- Casos de falha: recuperação parcial de semântica de classe (Prometheus), erro já na localização de arquivo que se propaga (Agentless), e "túnel de contexto" por busca por palavra-chave (OpenHands): apêndice I.
- Indício de contaminação e desalinhamento de protocolo no Devstral 2: apêndice K (hipótese dos autores, não testada).

## Limitações da fonte
- **Dos autores:** o ouro é compacto e verificado, mas não minimal de forma global (apêndice D); o ouro depende de um patch correto e há várias soluções possíveis (tratado só em 82 tarefas); possível contaminação do Devstral 2 (apêndice K). Não há seção de limitações própria.
- **Minhas:** (1) o domínio é código com agentes iterativos usando ferramentas; o desenho do estudo 2 é recuperação por top-k para perguntas de decisão com opções fechadas, então a transferência é indireta. (2) Sem repetições, sem intervalos de confiança e sem testes estatísticos para as comparações entre agentes e modelos (não consta). (3) Agentes e modelos variam juntos em parte dos ajustes: temperatura 0,0 num caso e 1,0 em outro (apêndice C), e os prompts foram adaptados por agente. (4) O ouro foi validado com o GPT-5, o mesmo modelo avaliado como backbone dos agentes, o que pode favorecê-lo. (5) O "contexto usado" é autodeclarado pelo agente, não observado. (6) A causalidade "ruído prejudica" é sugerida, não medida. (7) Tabelas 2 e 3 ilegíveis na extração.

## O que importa para o estudo 2
- **Copiar do método:** a validação de suficiência do documento-ouro (apêndice G). Antes de usar o A1 como teto, rodar o Haiku e o Sonnet só com o ouro e checar que as perguntas são respondíveis; descartar ou reescrever as que falham nas duas. Também copiar anotação em duas passagens, com um segundo revisor enxugando o ouro (princípio do contexto mínimo), e a exigência de documentar que o ouro não é minimal.
- **Métrica nova (apoia H3 e a métrica de citação):** a queda de uso (retrieval é diferente de uso). Calcular, por braço, a fração dos documentos-ouro recuperados que o Haiku de fato cita. Assim separa-se erro de recuperação (A3 a A6) de erro de consolidação (documento certo no prompt, resposta errada), que é o que o A1 e o A2 já tentam separar.
- **H4 (A4 supera A3):** o resultado "o simples empata ou vence o sofisticado" (seção 3.1) é um aviso de que H4 pode falhar; ele não a refuta, pois o domínio é outro. Mantém a ideia do plano de tratar H4 como teste real, e não como confirmação.
- **H6 e custo (H9):** o custo cresce com o número de rodadas, e recuperar mais (recall alto) com precisão baixa não ajudou o GPT-5. Apoia reportar precisão da recuperação além do recall@k.
- **Contradição parcial:** nada na fonte contradiz uma hipótese do plano; ela não testa colar tudo (A2) nem abstenção (A6).

## Contradições ou ajustes que o plano.md precisa
1. Adicionar à lista de métricas a precisão da recuperação (documentos recuperados que são ouro) e a taxa de uso (ouro recuperado e citado), junto com recall@k e citação.
2. Incluir no protocolo uma etapa de validação de suficiência do oráculo (A1) antes de congelar o gabarito, com revisor distinto do autor da pergunta se possível.
3. O texto do plano diz que a literatura "moldou o desenho"; esta fonte só entra como inspiração de métricas, não como evidência sobre RAG em decisões. Em `fontes/leitura.md` a nota ("agentes leem o código certo e não o usam") está correta e consistente com a queda de uso, mas vale acrescentar que o estudo é de agentes iterativos em código.
