# Estudo 3 (rascunho): Haiku em UI, UX e CSS. Base de pesquisa

Coletada em 10/11/2026. Fontes lidas: resumos e páginas do arXiv e resultados de busca. Só DiffSpot, FullFront, DesignBench, WebDevJudge e Design2Code tiveram o resumo conferido na página do arXiv. Os demais itens vêm de snippets de busca e precisam ser conferidos antes de citar números.

## Três frentes do estudo
1. Criar uma tela do zero (texto, screenshot ou protótipo para código).
2. Melhorar ou redesenhar uma tela existente.
3. Verificar e comparar duas telas lendo o código: o que mudou, o que falta, o que melhorou ou piorou.

## Frente 1: criar tela (design para código)
- **Design2Code** (Si et al., NAACL 2025, arXiv 2403.03163): 484 páginas reais, screenshot para HTML. Os modelos erram mais em recuperar elementos visuais e em acertar o layout. Prompt com o texto da página ajuda. Conferido.
- **WebCode2M** (arXiv 2404.06369): 2,56 milhões de pares design/código para treino. Snippet.
- **Web2Code** e **WebSight** (arXiv 2403.09029): conjuntos de dados em larga escala; WebSight tem cerca de 2 milhões de pares sintéticos. Snippet.
- **Interaction2Code** (arXiv 2411.03292): páginas interativas, 127 páginas e 374 interações. Snippet.
- **FullFront** (arXiv 2505.17399): três tarefas (desenho, percepção da página, código). Limites em percepção, imagens, layout e interação; distância grande para especialistas humanos. Conferido.
- **DesignBench** (arXiv 2506.06251): React, Vue, Angular e HTML/CSS; tarefas de geração, edição e reparo; 900 amostras. Conferido, mas o resumo não traz resultados por tamanho de modelo.
- **WebGen-Bench** (NeurIPS 2025): sites a partir de instruções, 647 casos de teste; melhor combinação com 27,8%. **ArtifactsBench** (arXiv 2507.04952): 1.825 consultas, julgamento automático com 94,4% de concordância de ranking com o WebDev Arena. **WebGen-V** (arXiv 2510.15306). Snippets.
- **UICoder** (Apple, arXiv 2406.07739): modelo pequeno ajustado com feedback automático (compilador mais modelo de visão), cerca de 996 mil programas SwiftUI. Superou o GPT-4 em taxa de compilação. Snippet.
- Ajuste fino de modelos pequenos: modelo de 18B no Design2Code chegou a Block-Match 78,5 contra 93,0 do GPT-4o; LLaVA 1.6 7B ficou em 50,4. VisCodex-8B declara paridade com o GPT-4o (autorrelato, não conferido).

## Frente 2: melhorar e redesenhar
- **Refinamento guiado por visão** (arXiv 2604.05839): um modelo de visão critica a página renderizada e o código é revisado; o ganho depende de iterar. Snippet.
- **WebGen-Agent** (arXiv 2509.22644): ciclo de gerar, executar e coletar feedback com screenshots, com retrocesso. Snippet.
- **Zero-shot GUI generation** (arXiv 2412.11328): um modelo critica o protótipo, outro revisa o HTML/CSS. Snippet.
- **Designer feedback** (arXiv 2509.16779) e **AlignUI** (arXiv 2601.17614): alinhar a UI gerada a preferências de designers e usuários. Snippet.
- **Orientação semântica** (arXiv 2601.19171): as regras de prompt para UI são hierárquicas e interdependentes. Snippet.
- **Acessibilidade**: ChatGPT gera código que muitas vezes não cumpre WCAG (arXiv 2501.03572); AccessGuru (arXiv 2507.19549) classifica violações em sintáticas, semânticas e de layout; WebAccessVL (arXiv 2602.03850) reduz violações de 5,34 para 0,44 por site. Snippets.
- **Skill frontend-design da Anthropic**: orienta contra estética genérica (fontes e gradientes clichê). É material de prática, não paper; o efeito não foi medido em estudo que eu tenha achado.

## Frente 3: comparar e verificar telas
- **DiffSpot** (arXiv 2605.29615, mai/2026): 4.400 pares de screenshots, cada um com uma única propriedade CSS alterada em 13 operadores. Melhor modelo (Gemini 3.1 Pro) achou 40,7% das mudanças reais; no nível difícil nenhum passou de 23%. Claude Opus 4.7 ficou em 31,2% com 0,4% de alucinação. `line_height` teve recall mediano de 4%. Modelos abertos de 30B ficaram em 9% com 18% a 22% de alucinação. Distância em pixel e CLIP não prevê a dificuldade. Conferido na página.
- **WUICC-bench** (arXiv 2607.01728): legendar mudanças entre telas para teste de regressão visual; métodos têm dificuldade com layout variado, texto denso e mudanças finas. Snippet.
- **XBIDetective** (arXiv 2512.15804): inconsistências entre navegadores por screenshot. **Triagem de snapshots por LLM** (arXiv 2507.10062): separa regressão real de mudança intencional. Snippets.
- **WebDevJudge** (arXiv 2510.18560): juízes LLM ficam bem abaixo de especialistas humanos ao comparar duas implementações; falham em reconhecer equivalência funcional e têm vieses difíceis de remover. Conferido.
- **MLLM as a UI Judge** (arXiv 2510.08783), **DesignPref** (arXiv 2511.20513; designers profissionais discordam bastante entre si), **WiserUI-Bench** (arXiv 2505.05026), **UXBench** (arXiv 2606.16262) e **PerceptUI** (arXiv 2606.05697). Snippets.
- **Código versus imagem**: em agentes de celular, texto da árvore de UI rendeu quase o mesmo que screenshot, com o screenshot custando cerca de 25 vezes mais por tarefa (arXiv 2604.17817, snippet). Isso sustenta testar o Haiku lendo só o código.

## O que a literatura diz sobre modelos pequenos
- Não achei nenhum estudo que compare Haiku, Sonnet e Opus em design ou CSS. A lacuna é real e é o espaço do estudo.
- Evidência indireta de que tamanho importa na percepção fina: no DiffSpot os modelos abertos menores ficam bem atrás; mas tamanho sozinho não explica (dentro da família Qwen3-VL, o de 235B Instruct ficou abaixo do de 30B).
- Evidência de que a lacuna pode fechar com ajuda externa: ajuste fino com feedback automático (UICoder), texto da página no prompt (Design2Code), ciclo de crítica e revisão (refinamento guiado) e checagens por código.
- Dado de custo e capacidade geral (Roboflow Vision Evals, terceiro, não conferido): Haiku 5.5 77,2% contra Sonnet 5.5 83,8% e Opus 5.5 85,5% em visão geral. Relatos de designers (UX Planet) falam em Haiku como "primeiro rascunho". São anedóticos.

## Teoria por trás (hipóteses de trabalho)
1. **Percepção fina é o gargalo**, não a escrita de código: os erros vêm de ler espaçamento, altura de linha, raio e gradiente em imagem. Se o Haiku receber o código das duas telas em vez de imagens, a frente 3 pode ficar muito melhor.
2. **Estilo subjetivo converge para o genérico** em todos os modelos; modelos menores tendem a convergir mais. Restrições explícitas (tokens de design, regras, lista de proibições) devem ajudar mais o modelo pequeno.
3. **Ciclo de crítica e revisão com ferramenta** (renderizar, medir, corrigir) compensa parte da capacidade perdida, porque troca julgamento subjetivo por checagem objetiva.
4. **Juízes LLM são ruins para avaliar design**; o estudo precisa de métricas objetivas (diferenças por propriedade CSS, Lighthouse/axe, similaridade de bloco) e de um pequeno painel humano cego.

## Hipóteses candidatas (a pré-registrar)
- H1: na comparação de duas telas, o Haiku lendo o código acha mais mudanças reais por token que o Haiku lendo screenshots.
- H2: para criar tela, tokens de design e regras no prompt aumentam a nota do Haiku mais do que a do Sonnet.
- H3: um ciclo de uma rodada de crítica e revisão fecha parte da distância do Haiku para o Sonnet na melhoria de tela.
- H4: o Haiku tem mais alucinação (diferenças que não existem) que o Sonnet na verificação.

## Lacunas e riscos
- Sem estudo direto com Haiku, os números acima vêm de outros modelos.
- Muitos itens são de 2026 e foram lidos só em snippets; conferir antes de publicar.
- Avaliação de design é subjetiva: até designers profissionais divergem (DesignPref).
- Risco de vazamento: páginas do Design2Code vêm do C4 e podem estar no treino dos modelos; preferir páginas geradas ou criadas para o estudo.

## Material reaproveitável para o experimento
- Gerador de pares com uma propriedade CSS alterada (modelo do DiffSpot) para a frente 3, com gabarito exato por construção.
- Design2Code e DesignBench como referência de tarefa e de métrica (código aberto).
- Verificadores objetivos: Lighthouse, axe, comparação de blocos.
