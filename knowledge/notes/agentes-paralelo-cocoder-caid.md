---
id: agentes-paralelo-cocoder-caid
title: "Agentes de código em paralelo: Co-Coder e CAID explicados"
source_url: "https://claude.ai/artifact/LymzwurWEPM8sxhAQEn3Xp"
kind: explainer
evidence: fonte-secundaria
validated_by_author: false
publishable: false
fidelity: lossless-html
date: 2026-11-03
tags: [multi-agente, paralelismo, co-coder, caid, particionamento, worktree]
---
# Agentes de código em paralelo: Co-Coder e CAID explicados

Início Glossário Co-Coder Resultados Co-Coder CAID Resultados CAID Comparação No seu fluxo

# Quando vale a pena pôr agentes de código para trabalhar em paralelo

Dois papers de 2026, explicados para quem conhece engenharia de software e quer entender a parte de orquestração de agentes. Nenhum resultado foi cortado: está tudo aqui, só que em formato visual.

Co-Coder (UT Austin e Oxford, NeurIPS 2026) e CAID (Carnegie Mellon). As figuras marcadas como “ilustração” explicam o conceito; todas as outras usam os números dos papers.

## As duas ideias em uma frase cada

#### Co-Coder

Paralelizar é um problema de **particionar o grafo de dependências**: cada fronteira entre agentes custa comunicação, então você agrupa os arquivos muito acoplados no mesmo agente e só paraleliza o resto.

#### CAID

Coordene agentes como uma equipe humana coordena devs: **um gerente, um git worktree por agente, merge com testes**. O isolamento físico vale mais do que pedir “não mexa no arquivo do colega”.

## Glossário rápido

Os termos de IA que aparecem nos dois papers, traduzidos para o vocabulário de engenharia de software.

| Termo | O que significa aqui |
| --- | --- |
| **Agente** | Um LLM em loop com ferramentas (ler arquivo, editar, rodar comando). Pense num processo worker com contexto próprio. |
| **Orquestrador / gerente / líder** | O agente que divide o trabalho e distribui tarefas. É o scheduler. |
| **Contexto** | Tudo que o agente “vê” no prompt. Transferir contexto entre agentes custa tokens, tempo e dinheiro: é o equivalente a I/O entre processos. |
| **Pass rate** | Fração dos testes unitários escondidos que o código gerado passa. Métrica de qualidade. |
| **Wall-clock** | Tempo real do início ao fim. É o que o paralelismo tenta reduzir. |
| **Custo de API** | Soma de tokens de entrada e saída de todos os agentes, em dólares. |
| **Benchmark** | Conjunto fixo de projetos com testes, usado para comparar métodos de forma justa. |
| **Baseline** | O método de referência contra o qual se compara (ex.: um agente único fazendo tudo). |
| **Fronteira de Pareto** | Conjunto de soluções em que não dá para melhorar uma métrica sem piorar outra. “Avançar a fronteira” é melhorar qualidade, tempo e custo ao mesmo tempo. |
| **Iterações** | Quantos passos (chamada de LLM + ação) o agente pode dar antes de parar. Funciona como orçamento. |

Paper 1

## Co-Coder: particionar por coesão

When Parallelism Pays Off: Cohesion-Aware Task Partitioning for Multi-Agent Coding

Xu Yang e Lunyiu Nie (contribuição igual), Ethan Chandra, Stanislav Gannutin, Fangru Lin, Swarat Chaudhuri The University of Texas at Austin e University of Oxford arXiv 2606.00953, publicado em 31 de maio de 2026, aceito na NeurIPS 2026 Código: github.com/Flitternie/CoCoder

### O problema

A promessa de vários agentes é simples: mais agentes, mais vazão, contexto mais organizado e menos tempo. Na prática isso nem sempre acontece. Estudos recentes mostram que adicionar agentes pode piorar a velocidade e a qualidade em comparação a um único agente bom.

Os autores argumentam que isso não é uma esquisitice de LLM. É o velho **trade-off entre comunicação e computação** que organiza quatro décadas de pesquisa em computação distribuída. Em qualquer sistema paralelo, o tempo total vem de dois termos que brigam entre si:

- o trabalho útil que cada worker faz isolado;

- o custo de coordenação toda vez que um worker depende de outro.

Em agentes, cada dependência entre agentes é resolvida transmitindo tokens de contexto, o que infla prompts, tempo de geração e custo. Quando arquivos muito interdependentes vão para agentes diferentes, esses agentes precisam parar repetidamente para consultar colegas ou reler o estado do repositório, e o tempo cresce com o número de agentes em vez de cair.

**Analogia de SE:** é o mesmo problema de quebrar um monólito em microsserviços “tagarelas”. Se você corta no lugar errado, cada request vira dez chamadas de rede e o sistema fica mais lento e mais caro do que o monólito.

Os sintomas aparecem nos baselines. No CodeProjectEval, o paralelismo por arquivo aumenta o custo em 60% para ganhar 1,56× de velocidade. Nos dois benchmarks, o Claude Code com Agent Teams é o mais rápido, mas fica abaixo do agente sequencial em qualidade. Um desperdiça dinheiro; o outro sacrifica a qualidade do código.

### Formulação: o grafo de dependências com pesos

A tarefa vira um grafo dirigido **G = (V, E)**:

- cada **vértice** vᵢ é uma subtarefa (no caso, gerar um arquivo) com peso **wᵢ** = custo de computação, o tempo esperado que um agente gasta nela sozinho;

- cada **aresta** (vᵢ, vⱼ) diz que vᵢ depende de vⱼ, com peso **cᵢⱼ** = custo de comunicação se os dois ficarem em agentes diferentes. Quanto mais interface compartilham, maior o peso.

Orquestrar K agentes é **particionar V em K grupos** P = {P₁, …, Pₖ}. Tudo num grupo é feito pelo mesmo agente, um arquivo por vez. Isso gera dois custos:

#### W(P): computação

A latência do **caminho crítico** no DAG agendado: a maior soma de wᵢ em qualquer caminho. Captura duas serializações: a fila de trabalho dentro de cada agente e as cadeias de dependência que fazem um agente esperar outro.

#### C(P): comunicação

A soma dos pesos cᵢⱼ de todas as arestas que **cruzam** a fronteira entre grupos. Cada corte é contexto que precisa ser transferido entre agentes.

T(P) = W(P) + α · C(P)Busca-se a partição P* que minimiza T. O α é o peso do trade-off, e K (número de agentes) sai da própria partição.

Grupos grandes internalizam dependências e reduzem C, mas criam filas longas dentro de um agente e aumentam W. Grupos pequenos expõem paralelismo e reduzem W, mas empurram mais dependências para as fronteiras e aumentam C. É o análogo direto do escalonamento distribuído clássico: W é o tempo de caminho crítico e αC é o overhead de comunicação entre processadores.

Brinque com o trade-off

Projeto pouco acoplado Projeto muito acoplado

Número de agentes: **4**

Ilustração conceitual com números inventados, não dados do paper. Repare que no projeto acoplado o ponto ótimo chega com bem menos agentes: depois dele, cada agente a mais custa mais em comunicação do que economiza em computação.

### Como o Co-Coder funciona: três estágios

#### Construção do grafo

A entrada é texto livre (especificação do produto, diagramas UML), então o grafo não existe pronto. Uma única chamada de LLM produz o **Repository Interface Blueprint (RIB)**: para cada arquivo, os símbolos que define (classes, funções com parâmetros tipados, constantes globais) e de quais arquivos importa. Os imports viram as arestas E; o tamanho da interface vira o peso wᵢ, como proxy do tempo de geração.

**Controle de qualidade do RIB:** um LLM-juiz dá nota de 1 a 10 em três dimensões (completude das interfaces, correção das dependências, consistência dos tipos). Se a média ficar abaixo de 7, a crítica volta para o gerador e o RIB é refeito, por até 3 rodadas. Tudo depois depende do RIB estar certo.

**Peso das arestas:** cada arquivo vira um vetor esparso de símbolos. Um símbolo que o arquivo **define** vale 2; um tipo que ele só **referencia** vale 1 (builtins, imports comuns, type aliases e constantes de módulo ficam de fora). O peso é a similaridade de cosseno entre os vetores, multiplicada por γ = 10. Resultado: aresta de “define e usa” fica pesada; coincidência de referenciar a mesma coisa fica leve. Arestas sem símbolo em comum recebem peso mínimo 0,1.

// Trecho do RIB do projeto zxcvbn (6 arquivos, 6 arestas) { "path": "zxcvbn/matching.py", "dependencies": ["zxcvbn/scoring.py"], "description": "Pattern detection (dictionary, spatial, sequence, etc.).", "functions": [{"name": "omnimatch"}, {"name": "dictionary_match"}] }

**Analogia de SE:** o RIB é praticamente a sua TechSpec em formato de máquina, com os contratos de cada módulo e o grafo de imports.

#### Particionamento por coesão

Coesão aqui é o quanto os arquivos de um grupo são mais acoplados entre si do que com o resto. Alta coesão mantém as dependências caras dentro do grupo (corta C) e limita o tamanho das filas (segura W).

**a. Isolar hubs.** Grafos de código reais têm poucos arquivos que dominam tudo:

  - **In-hubs** (muita gente depende deles): constantes, schemas compartilhados, hierarquia de exceções. Como seus dependentes estão espalhados por todos os grupos, o custo de corte quase não muda onde quer que ele fique. Mas, se entrar num grupo, entra na fila daquele agente. Solução: cada in-hub vira um grupo sozinho, fora do caminho crítico de todos.

  - **Out-hubs** (dependem de muita gente): agregadores e controllers de topo. Num grupo, forçam todos os upstream daquele grupo a virar uma corrente terminando nele. Solução: todos os out-hubs vão para um único grupo de integração, concentrando a serialização tardia num agente só.

Regra usada: um arquivo é in-hub se mais de 40% dos outros arquivos dependem dele, e out-hub se ele depende de mais de 40% dos outros. Subir esse limite junta mais utilitários nos clusters (mais fila); baixar isola arquivos demais (fragmenta módulos coesos). Isolar os hubs também evita que o algoritmo de clusterização junte tudo num comunidade só.

**b. Infomap.** No grafo sem hubs, roda-se o Infomap, um algoritmo de detecção de comunidades que funciona em grafos dirigidos com peso e descobre sozinho quantos grupos existem. Ele simula um passeio aleatório que segue as arestas proporcionalmente ao peso: o passeio tende a ficar preso dentro de módulos fortemente acoplados e raramente cruza arestas leves. O algoritmo escolhe a partição que minimiza o “tamanho de descrição” desse passeio, o que na prática evita cortar arestas pesadas e reduz C. O parâmetro tempo de Markov t controla a granularidade: t maior gera menos grupos e maiores (menos C, mais W). Usaram t = 1,0.

**c. Soltar folhas.** Coesão sozinha não resolve W: dentro de um grupo, dois arquivos que dependem do mesmo upstream mas não um do outro ainda seriam feitos em fila. O Co-Coder tira do grupo qualquer arquivo que (i) não tem dependentes dentro do grupo e (ii) compartilha seu único upstream interno com pelo menos um irmão. Isso cria um corte de custo α·cᵢⱼ, mas tira wᵢ do caminho crítico, então só compensa quando α·cᵢⱼ < wᵢ.

#### Execução sem barreiras

Esperar por “camadas” de profundidade topológica faria todo mundo aguardar a camada mais lenta. Em vez disso, há uma **lista de tarefas compartilhada**: cada arquivo passa de *pending* para *ready* no instante em que todos os seus upstream terminam, e o agente dono do grupo pega. Agentes mais rápidos seguem imediatamente para a próxima tarefa pronta.

**Reparo:** no fim, um agente líder roda a suíte de testes e usa o registro da partição para localizar cada falha no grupo dono do arquivo. O reparo é enviado só para esse grupo, com contexto limitado, e edições conflitantes entre grupos são evitadas por construção. O loop roda até 10 rodadas, reenviando só os grupos que ainda têm testes falhando.

Exemplo de partição

Ilustração em TypeScript, não um caso do paper. O tipo compartilhado sai do caminho crítico, os módulos coesos ficam inteiros em um agente, o ponto de entrada fica num grupo de integração e um arquivo que só depende do service vira tarefa paralela própria.

Por que não usar barreiras entre camadas

Ilustração. Com barreira, ninguém começa a camada 2 até a tarefa mais lenta da camada 1 acabar. Com a lista compartilhada, cada tarefa começa assim que suas dependências específicas terminam.

### Hiperparâmetros (fixos em todos os 28 repositórios)

| Componente | Parâmetro | Valor |
| --- | --- | --- |
| Peso da aresta | Peso de símbolo definido | 2 |
| Peso da aresta | Peso de tipo referenciado | 1 |
| Peso da aresta | Escala do cosseno γ | 10 |
| Peso da aresta | Peso padrão (sem símbolo em comum) | 0,1 |
| Detecção de comunidades | Tempo de Markov t | 1,0 |
| Isolamento de hubs | Limite de fan-in/fan-out | 0,4 |
| Geração do RIB | Rodadas máximas de refinamento | 3 |
| Reparo guiado por testes | Iterações máximas de reparo | 10 |

## Co-Coder: experimentos e resultados

#### Benchmarks

- **DevEval**: subconjunto Python de 10 projetos compactos, média de 3,1 arquivos e 243 linhas por implementação de referência. (Antes se chamava “DevBench”; há outros benchmarks com esses nomes.)

- **CodeProjectEval**: 18 projetos de bibliotecas open source reais, média de 11,9 arquivos e 2.371 linhas, com dependências profundas entre arquivos.

#### Métricas e setup

- Pass rate nos testes escondidos; wall-clock em segundos (sem contar testes); custo de API em USD. Média de 3 execuções.

- Todos usam **gpt-5-mini**. Sequencial, paralelo por arquivo e Co-Coder rodam no OpenHands SDK v1.11.4; Claude Code v2.1.119 com LiteLLM v1.83.8.

### Os quatro métodos comparados

Todos recebem o mesmo blueprint. **Sequencial**: um agente gera o repositório inteiro e decide a ordem sozinho. **Paralelo por arquivo**: um líder cria um agente por arquivo, todos rodam ao mesmo tempo e podem conversar, sem partição nem agendamento por dependência. **Claude Code com Agent Teams**: o modo nativo da Anthropic, em que um líder cria sessões independentes que trocam mensagens diretamente. **Co-Coder**: o sistema completo.

+14,0

pontos de pass rate no CodeProjectEval (20,1% → 34,1%)

2,10×

mais rápido que o sequencial no CodeProjectEval

−35%

de custo de API no CodeProjectEval

+11,3

pontos no DevEval (56,8% → 68,1%), 1,81× mais rápido, −28% de custo

Médias por benchmark

Pass rate Tempo Custo

Pass rate médio por tarefa. Maior é melhor.

**O padrão que aparece nos dois benchmarks:** o paralelo por arquivo troca custo por velocidade sem melhorar a qualidade; o Claude Code com Agent Teams troca qualidade por velocidade; o Co-Coder melhora as três métricas ao mesmo tempo.

### O que aconteceu com cada baseline

**DevEval.** O paralelo por arquivo não reduz tempo (806 s contra 800 s) e aumenta custo em 44% (US$ 0,36 contra US$ 0,25) para ganho quase nulo de qualidade (57,7% contra 56,8%). A partição ruim faz os agentes produzirem interfaces conflitantes, e a regeração redundante custa caro sem melhorar o código. O Claude Code reduz a latência para 536 s mas tem o pior pass rate (54,1%). Em projetos simples onde um agente já resolve (Hybrid_Images, pso), os quatro empatam. A vantagem aparece onde há coordenação entre arquivos: em hone o Co-Coder passa 6,0 de 7 testes contra 2,3 do sequencial; em TextCNN, 5,0 de 10 contra 1,7.

**CodeProjectEval.** A diferença aumenta. Co-Coder: 34,1% contra 20,1% do sequencial e 23,3% do paralelo por arquivo, com 52% menos tempo (1.315 s contra 2.756 s) e 35% menos custo (US$ 0,67 contra US$ 1,03). O paralelo por arquivo aumenta o custo em 60% para ganhar só 3,2 pontos, porque arquivos gerados em paralelo violam contratos de tipo entre si. O Claude Code tem o menor tempo (680 s) e custo (US$ 0,38), mas o pior pass rate (16,3%), abaixo até do sequencial. Os maiores ganhos estão nos projetos de dependência mais profunda: em simpy, 58,0 de 149 testes contra 10,3; em pyjwt, 140,0 de 294 contra 79,0.

Pass rate por projeto

CodeProjectEval DevEval

Calculado como testes passados ÷ total de testes, a partir das tabelas do paper. Barras ausentes indicam valor ilegível na extração do PDF.

Quanto mais acoplado o projeto, maior o ganho

Cada ponto é um projeto do CodeProjectEval com pass rate diferente de zero (16 projetos). O paper relata correlação positiva entre densidade de arestas (|E|/|V|) e ganho absoluto sobre o sequencial: Pearson r = 0,65 e Spearman ρ = 0,60, ambos com p < 0,05. O eixo vertical aqui é a diferença de testes passados, calculada das tabelas.

### Discussão dos autores

**Por que o ganho cresce com a complexidade.** Num arquivo que importa símbolos de k outros, há k pontos possíveis de interface incompatível se esses arquivos forem gerados de forma independente. Dependências entre arquivos crescem mais que linearmente com o tamanho do projeto. O CodeProjectEval tem densidade média em torno de 1,5, contra cerca de 0,3 no DevEval, o que explica os ganhos maiores. A partição coesa coloca arquivos muito acoplados no mesmo agente, internalizando a maioria das arestas, e resolve o resto pela ordem topológica da lista compartilhada.

**Trade-off entre latência e correção.** O Claude Code distribui trabalho agressivamente e fica rápido, mas perde qualidade. O sequencial mantém interfaces consistentes mas não paraleliza nada. O Co-Coder libera cada arquivo assim que seus upstream ficam prontos, então os agentes começam com acesso às interfaces reais já produzidas, e não a placeholders especulativos. Isso dá 45% a 52% menos tempo e mais qualidade.

#### Limitações declaradas

- Projeto quase totalmente acoplado vira um grupo só e a execução degrada para sequencial. Ainda ganha a resolução estruturada de dependências, mas sem ganho de tempo.

- Só foi avaliado em Python. Se os ganhos se transferem para linguagens estaticamente tipadas com feedback de compilador (Rust, Java) é questão em aberto.

#### Onde se encaixa na literatura

- Frameworks com papéis (MetaGPT, ChatDev), conversacionais (AutoGen, CAMEL) e baseados em grafo (GPTSwarm) priorizam qualidade e dependem de handoffs sequenciais.

- Estudos de diagnóstico mostram que agentes concordam sobre *onde* editar mas falham em coordenar *o que* implementar: o gargalo é estrutural.

- Estende CodePlan (edição em DAG, um agente) e LLMCompiler (chamadas de função paralelas, um agente) para vários agentes, unindo alocação e agendamento num só problema.

### Tabelas completas por projeto

Testes passados (#Pass), tempo em segundos e custo em USD, média de 3 execuções. Em azul, o melhor #Pass da linha. Na linha de média, pass rate em % e tempo e custo normalizados pelo sequencial (verde melhor, vermelho pior). “—” indica valor ilegível na extração do PDF; confira no PDF original.

#### DevEval

#### CodeProjectEval

#### Estatísticas das partições

Arquivos e linhas contam só o que os agentes precisam gerar (arquivos auto-gerados, como migrations do Django e tabelas estáticas, já vêm prontos). Arestas = |E|; densidade = |E|/|V|; hubs isolados; grupos = K; maior grupo; singletons = hubs + folhas soltas.

Paper 2

## CAID: coordenar agentes com as ferramentas do time

Effective Strategies for Asynchronous Software Engineering Agents

Jiayi Geng e Graham Neubig Carnegie Mellon University, Language Technologies Institute arXiv 2603.21489, publicado em 23 de março de 2026 Código: github.com/JiayiGeng/CAID. Financiado pela Fujitsu.

CAID significa **Centralized Asynchronous Isolated Delegation**: delegação centralizada, execução assíncrona e espaços de trabalho isolados.

### O problema

Agentes já resolvem bem tarefas isoladas, como corrigir uma issue no GitHub. Tarefas longas, com várias subtarefas interdependentes (construir uma biblioteca do zero, reproduzir um paper inteiro), ainda são difíceis em qualidade e em tempo. Um agente sozinho tem escopo limitado e demora.

Vários agentes ao mesmo tempo seria a saída natural, mas é surpreendentemente difícil: edições concorrentes interferem entre si, dependências são difíceis de sincronizar e juntar progresso parcial num todo coerente é complicado.

**O exemplo do paper:** dois agentes editam o mesmo arquivo. Um renomeia uma função; o outro escreve código novo que ainda chama o nome antigo. Cada um fez seu trabalho certo isoladamente, mas o resultado integrado não roda. Esses conflitos costumam aparecer só na integração, e aí a correção não é um patch de uma linha, é refazer o trabalho de pelo menos um agente.

Times humanos lidam com isso todo dia e já têm infraestrutura madura: cópias isoladas do repositório, merge que expõe conflitos explicitamente, grafos de dependência que dizem o que pode ser feito em paralelo e testes que verificam cada mudança automaticamente. A ideia do CAID é usar exatamente essas primitivas como mecanismo de coordenação.

### Cada primitiva de SE vira um mecanismo de coordenação

| Primitiva de SE | Mecanismo | Papel no CAID |
| --- | --- | --- |
| Grafo de dependências | Restrições de agendamento | A ordem das dependências define o que é seguro delegar |
| `git worktree` | Isolamento | Cada agente trabalha num worktree independente |
| `git commit` / pull request | Sinalização estruturada | Agentes avisam que terminaram fazendo commit |
| `git merge` | Integração | Mudanças concluídas entram na main |
| Resolução de conflito | Tratamento de conflito | O próprio engenheiro resolve o conflito que causou |
| Code review | Verificação | O engenheiro faz autoverificação |
| `asyncio` | Execução concorrente | Vários agentes rodam ao mesmo tempo |
| Event loop + `await` | Ciclo de coordenação | Espera conclusão, integra, redistribui tarefas |
| `git reset --hard HEAD` | Sincronização de estado | Worktrees sincronizam com o último estado integrado |

O fluxo do CAID

Ilustração do fluxo descrito no paper. Assim que um engenheiro termina, o gerente faz merge na main, atualiza o plano e atribui a próxima tarefa, sem esperar os outros.

#### Especificação e grafo de dependências

Num teste preliminar, deixar os agentes dividirem a tarefa livremente fazia eles esquecerem partes importantes. Por isso o gerente monta primeiro um grafo dirigido G = (V, E) do repositório, em que cada nó é uma unidade de trabalho. Uma unidade só pode ser delegada quando todas as suas dependências já foram concluídas **e integradas na main**. A cada rodada, o gerente escolhe tarefas desse conjunto “pronto”. Os engenheiros só recebem tarefas depois que o grafo existe.

#### Delegação ciente de dependências

  - O trabalho é dividido em no máximo N grupos, onde N é o número máximo de engenheiros em paralelo. Nem todos são necessariamente ativados.

  - Arquivos com dependência forte ou circular vão para o mesmo engenheiro.

  - Prioridade para tarefas que habilitam testes mais cedo, expõem mais sinal de avaliação ou estão mais perto do início da cadeia de dependências. Começar pelas funções mais simples.

  - No Commit0, o gerente lê imports, coleta os testes e vê que arquivos cada teste exercita. Delega por arquivo; se um arquivo tem muitas funções vazias, divide por função, sem sobreposição.

  - Depois de cada entrega, o gerente atualiza o estado e decide se dá nova tarefa ou deixa o engenheiro ocioso.

#### Isolamento e integração

  - Cada engenheiro tem seu `git worktree`, derivado da main, e só mexe ali.

  - Antes de delegar, o gerente deixa o repo executável (ambiente, entry points, stubs mínimos) e commita na main, para todos partirem da mesma base.

  - Arquivos compartilhados como `__init__.py` são marcados como restritos: engenheiros não podem commitar neles.

  - Integração via `git commit` e `git merge`. Se der conflito, **quem causou resolve**: puxa a main para o próprio worktree, resolve localmente e reenvia. A main é a única fonte do estado integrado.

#### Comunicação e execução assíncrona

  - Gerente e engenheiros se comunicam por **JSON estruturado** e commits, não por conversa livre. Isso evita o desalinhamento entre agentes, apontado em outro estudo como a principal causa de falha.

  - Um event loop controlado pelo gerente; cada engenheiro é uma coroutine, até um limite de engenheiros ativos.

  - Para o contexto do gerente não explodir, um condensador resume periodicamente as rodadas anteriores, preservando grafo, tarefas concluídas e erros pendentes.

#### Autoverificação e término

  - Antes do commit, o engenheiro roda **só os testes que importam ou referenciam os arquivos que ele mudou**. Sem esse mapeamento, roda o comando padrão de testes ou um entry point mínimo.

  - Qualquer teste falhando ou exceção precisa ser resolvido antes de enviar.

  - O gerente não revisa código a cada passo; só acompanha o progresso.

  - Para quando todas as unidades foram integradas ou quando acabam os limites de rodadas e iterações (aí a tarefa conta como incompleta).

Formato da delegação (prompt do Commit0)

{ "assign_task": { "reasoning": "Explain your decision", "assignments": [{ "engineer_id": "engineer_id", "task_id": "task-unique-id or 'fix-<original-task-id>'", "file_path": "path/to/file.py", "functions_to_implement": ["func1", "func2"], "instruction": "Detailed explanation of the purpose of the implementation.", "complexity": "simple|medium|complex" }] } }

Formato de saída exigido do gerente, como aparece no apêndice A do paper. Na primeira rodada há também uma lista de tarefas restantes com campo `depends_on`. O prompt proíbe o gerente de escrever código das funções e de renomear qualquer coisa, e pede que, se um engenheiro não commitar, o gerente inspecione o worktree e faça o merge do que estiver pronto.

## CAID: experimentos e resultados

#### Benchmarks

- **Commit0-Lite**: implementar bibliotecas Python do zero (tinydb, minitorch, jinja…) a partir de um esqueleto e uma suíte de testes.

- **PaperBench** (protocolo Code-Dev): reproduzir as principais contribuições de um paper de conferência. Correção julgada por gpt-5-mini.

#### Setup

- OpenHands agent SDK v1.11.0. Modelos: GLM 4.7, MiniMax 2.5 e Claude Sonnet 4.5.

- Agente único: 100 iterações. CAID: gerente com 50 e cada engenheiro com 80. 2 rodadas de implementação.

- 2 engenheiros no PaperBench, 4 no Commit0. Configurações fixadas antes dos experimentos.

- Baseline: um agente único na mesma base OpenHands, para isolar o efeito da coordenação.

+26,7

pontos sobre agente único no PaperBench (resumo do paper)

+14,3

pontos sobre agente único no Commit0 (resumo do paper)

10,4 → 36,7

MiniMax 2.5 no PaperBench: modelo fraco é o que mais ganha

Agente único contra CAID, por modelo

PaperBench Commit0-Lite

Score Tempo (s) Custo

Tabela 2 do paper. “Único + CAID” simula tentar primeiro com um agente e, se falhar, rodar o CAID depois. O paper não indica a unidade de custo na tabela.

**Lição estratégica:** não use multiagente como plano B depois que o agente único falhar. Rodar os dois em sequência soma quase todo o tempo e custo, e o resultado fica praticamente igual ao do CAID direto. Exemplo: PaperBench com Claude Sonnet 4.5 vai de 63,3 para 66,8, mas o tempo sobe de 2.080 s para 3.884 s e o custo de 9,3 para 12,6. No Commit0 com MiniMax 2.5, o resultado fica em 57,0 nos dois casos. Melhor começar já coordenado.

### Dar mais iterações para um agente só não resolve

Rodaram o agente único com 100 e com 200 iterações. Dobrar o orçamento trouxe ganho marginal e, em alguns casos, piora: no PaperBench a diferença foi pequena para GLM 4.7 e MiniMax 2.5 e negativa para Claude Sonnet 4.5; no Commit0-Lite o ganho também foi limitado e negativo para MiniMax 2.5. Isso bate com o próprio PaperBench, onde forçar o agente a rodar até o limite de tempo não melhora a nota de forma confiável. O ganho do CAID sobre o agente de 100 iterações foi muito maior, por exemplo mais de 25 pontos para MiniMax 2.5 no PaperBench.

### Worktree de verdade contra “isolamento só por instrução”

Tabela 3, com Claude Sonnet 4.5. No isolamento “soft”, todos compartilham um workspace e o gerente só pede para não interferirem (arquivos diferentes, avisos explícitos). Número entre parênteses: iterações usadas.

No Commit0-Lite, o soft isolation já melhora sobre o agente único (53,1 → 56,1), mostrando que só a delegação centralizada ajuda quando a estrutura e as dependências estão explícitas. O worktree leva a 59,1: separar por instrução não basta em trajetórias longas. No PaperBench o padrão muda: soft isolation cai para 55,5, **abaixo do agente único** (57,2), enquanto o worktree chega a 63,3. No PaperBench não há estrutura de arquivos nem grafo explícito, o gerente precisa inferir o plano a partir do paper, e quando essa decomposição é imperfeita o workspace compartilhado amplifica a descoordenação. Conclusão: isolamento e delegação são complementares, e em tarefas abertas o worktree é necessário.

### Quantos engenheiros usar

Desenho qualitativo da figura 3 do paper (os valores exatos de 8 engenheiros não estão no texto). No Commit0-Lite, 2 → 4 engenheiros melhora e 8 piora mesmo custando mais. No PaperBench, passar de 2 quase não muda o score, enquanto tempo e custo sobem.

Mais engenheiros **não** melhora monotonicamente. O ponto ótimo depende de dois fatores: quanto da tarefa é realmente independente e quanta coordenação o gerente consegue sustentar. Delegação fina demais cria overhead de integração e conflitos, principalmente quando vários engenheiros mexem em módulos próximos. Com mais engenheiros, erros de delegação e sincronização atrasada se propagam e desestabilizam toda a trajetória.

### A delegação decide o resultado

Repositório minitorch, Commit0-Lite. A diferença entre as duas execuções do CAID não foi a quantidade de módulos implementados, mas quais.

Na execução 2, o gerente colocou um engenheiro no `autodiff.py`, arquivo crítico para os testes, e o esforço contínuo nele destravou os componentes dependentes. Na execução 1, vários engenheiros trabalharam, mas ninguém recebeu o `autodiff.py`. O agente único chegou a mexer nele durante a exploração, mas deixou incompleto. A capacidade do gerente de identificar e atribuir as dependências de alto impacto é crítica.

### Revisar mais custa mais tempo e dá mais qualidade

Figura 5: subconjunto de repositórios do Commit0-Lite (babel, chardet, cookiecutter, imapclient, jinja, minitorch, simpy, tinydb). Resultado de fase de desenvolvimento.

**Revisão do gerente a cada rodada**: o gerente revisa a qualidade de cada engenheiro antes de integrar. **Autoverificação**: o engenheiro se revisa, sem inspeção repetida (é a configuração dos resultados principais). **Prioridade à eficiência**: todos são instruídos a priorizar tempo e lembrados de que o tempo será avaliado. Há um trade-off claro entre intensidade da verificação e eficiência.

#### Limitações declaradas

- **Custo e tempo:** o multiagente sempre custou mais em API, e o tempo total não caiu de forma relevante. Os engenheiros rodam em paralelo, mas a integração continua sequencial e bloqueada por testes. Próximos passos: agendamento mais eficiente, menos ciclos redundantes de verificação, aprender quando fazer merge ou podar estados.

- **Delegação por prompt:** a decomposição do gerente usa heurísticas de prompt, não uma política aprendida. Futuro: delegação via reinforcement learning e planejamento ciente de dependências.

- **Generalização:** só testado em engenharia de software, que tem fronteiras claras, versionamento e testes executáveis. Outros domínios exigiriam outras formas de isolar e validar.

#### Onde se encaixa na literatura

- Arquiteturas multiagente (CAMEL, ChatDev, EvoMAC, AutoAgents, AgentOrchestra, MASS, DyLAN) ainda sofrem com comunicação densa e sobrecarga em tarefas longas.

- Estudos de escala mostram um “imposto de coordenação”: custo de sincronização cresce mais que linearmente com o número de agentes.

- Alinhamento por linguagem harmoniza intenção, mas não serializa transições de estado concorrentes nem garante consistência na integração.

- CooperBench (2026) aponta modificação concorrente e conflito de merge como falha principal quando essas primitivas não são modeladas.

### Tabela completa dos resultados principais

## Os dois lado a lado

|  | Co-Coder | CAID |
| --- | --- | --- |
| **Pergunta central** | Como dividir o trabalho entre agentes? | Como evitar que agentes concorrentes se atrapalhem? |
| **Ideia-chave** | Partição coesa do grafo (minimizar W + αC) | Branch-and-merge com primitivas de git |
| **Quem decide a divisão** | Algoritmo (hubs + Infomap + folhas), a partir do blueprint | Gerente LLM, por prompt |
| **Isolamento** | Por construção: cada arquivo tem um dono | Físico: um git worktree por engenheiro |
| **Agendamento** | Lista compartilhada, sem barreiras | Event loop assíncrono; reatribui ao fim de cada tarefa |
| **Verificação** | Testes no fim; reparo despachado só para o grupo dono da falha | Autoverificação com testes afetados antes de cada commit; merge bloqueado por teste |
| **Tempo** | Cai 45–52% | Não cai de forma relevante; às vezes sobe |
| **Custo** | Cai 28–35% | Sobe |
| **Qualidade** | +11,3 e +14,0 pontos | Melhora em todos os modelos e benchmarks |
| **Modelos** | gpt-5-mini | GLM 4.7, MiniMax 2.5, Claude Sonnet 4.5 |
| **Baselines** | Sequencial, paralelo por arquivo, Claude Code Agent Teams | Agente único na mesma base |

Os números não são diretamente comparáveis entre os papers: benchmarks, modelos e baselines são diferentes. Mas as conclusões se encaixam. O CAID mostra que **isolamento físico e integração por teste** são o que garantem qualidade, e admite que o tempo não melhora porque a integração é sequencial. O Co-Coder mostra que **dividir pelo acoplamento real** e agendar sem barreiras é o que faz o paralelismo de fato economizar tempo e dinheiro. Os dois concordam que mais agentes não é melhor por si só e que o gargalo é estrutural, não de comunicação.

## O que isso muda num fluxo PRD → TechSpec → tasks

#### Divida pelo acoplamento, não só por arquivos que não se sobrepõem

Duas tasks em arquivos diferentes podem compartilhar contratos de tipo. Calcule o peso das dependências pelos símbolos compartilhados e agrupe tasks acopladas no mesmo agente.

#### Trate hubs à parte

Tipos, schemas e constantes compartilhados vão primeiro, sozinhos. Pontos de entrada e composição ficam num grupo de integração no fim.

#### Troque gates por camada por uma lista de tasks prontas

Cada task começa quando suas dependências específicas terminam, não quando a camada inteira termina.

#### Um worktree por agente, merge bloqueado por teste

Quem causa o conflito resolve. Marque arquivos compartilhados como restritos.

#### Teste só o que foi afetado antes do commit

A suíte completa fica no gate de integração. É o que o CAID faz, e alivia exatamente o gargalo de CPU e memória dos testes.

#### Comece com poucos agentes e meça

No CAID o ótimo foi 4 no Commit0 e 2 no PaperBench. Meça pass rate, tempo, custo e conflitos contra um baseline sequencial.

Esta última seção é uma aplicação sugerida a partir dos papers, não algo que os autores testaram.
