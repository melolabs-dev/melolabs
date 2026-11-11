# Estudo 3b: Haiku com kit e data lake em telas de produção (rascunho, não congelado)

Data do rascunho: 10/11/2026. Complementa o estudo 3 (tela de login), que passa a ser tratado como piloto. Nada aqui foi rodado. Congelar com hash antes da rodada principal; depois disso, estímulos, gabarito, prompts, pontuação e hipóteses só mudam como desvio registrado.

## Perguntas
1. Em telas grandes e complicadas, o conjunto (modelo + regras + kit) continua levando o Haiku perto do Sonnet?
2. Quando o pedido é vago e as decisões de UX estão em aberto, **quanto da completude do data lake vira decisão melhor**? Existe dose-resposta (mais regras relevantes, mais acerto)?
3. O data lake atrapalha onde não tem regra (rigidez, ruído), ou só ajuda onde cobre?
4. Buscar só as regras relevantes (recuperação) funciona tão bem quanto colocar o lake inteiro no prompt, e a que custo em tokens?

## Mudanças em relação ao estudo 3
- **Telas complexas e variadas** em vez de login: 6 tipos, 300 a 1.500 linhas de HTML/CSS com tokens de design, componentes repetidos e estados (vazio, erro, carregando, parcial).
- **Muito mais itens**, com dificuldade graduada (defeito óbvio, médio, sutil) para fugir do teto de pontuação.
- **Data lake de referência grande** (alvo: 150 a 200 regras), só de fontes já validadas e citáveis: WCAG 2.2, Nielsen Norman (heurísticas e pesquisas publicadas), Baymard (formulários, checkout, tabelas; só o que for público), Material Design 3, web.dev, GOV.UK Design System. Cada regra: id, domínio, fonte com URL, como checar, bom, mau, severidade. Nenhuma regra de estética ou gosto.
- **Nova tarefa T4 (decisão com pedido vago)**, que é o centro da pergunta 2.
- **Completude do lake como variável manipulada.**
- Ferramenta independente de verificação (axe-core, e outras que forem confiáveis) em todas as telas geradas, para a régua não ser só a nossa.

## Catálogo de telas (6 tipos, variações geradas por script com semente fixa)
1. Painel de dados: tabela com 10+ colunas, filtros, ordenação, gráfico, KPIs.
2. Formulário longo em várias etapas, com validação, erros e rascunho.
3. Checkout com endereço, pagamento, resumo e erro de pagamento.
4. Listagem com busca, facetas, paginação, estados vazio e sem resultado.
5. Configurações e perfil: permissões, ações destrutivas, confirmações.
6. Fluxo de navegação: menu, breadcrumbs, modais, onboarding.
Alvo: 15 variações por tipo, 90 telas por tarefa. Ajustar no piloto conforme custo e poder estatístico.

## Conjunto de validade externa (produção real)
Você perguntou se o resultado vale em projeto grande e em produção. Não dá para provar com telas sintéticas. Mitigação em duas camadas:
- **Telas de projetos open source reais** com licença permissiva (por exemplo templates de admin e exemplos de design systems públicos). Risco: o modelo já pode ter visto esse código. Por isso só entram em T2 e T3, com defeitos injetados por nós (inéditos), e ficam num bloco separado, marcado como externo.
- **Estudo de caso final** em um projeto seu (a decidir), fora do pré-registro, descrito como relato e não como prova.

## Tarefas
- **T1 criar** (tela complexa a partir de um briefing completo), pontuada pelas regras cumpridas.
- **T2 melhorar** (tela com 5 a 8 defeitos injetados e graduados), pontuada por defeitos removidos menos defeitos novos.
- **T3 comparar** (pares de telas grandes; mudanças em CSS, conteúdo, fluxo, compostas, ruído, idênticas), pontuada por recall e alarmes falsos contra o gabarito por construção.
- **T4 decidir** (novo): briefing vago, por exemplo "tela de gestão de pedidos para operação logística, dados em anexo", com 8 a 12 **pontos de decisão** não especificados (padrão de tabela larga no celular, ordem e confirmação de ações destrutivas, estado vazio, paginação ou rolagem infinita, formato de datas e números, densidade, mensagens de erro). Cada ponto tem um gabarito ancorado numa regra do lake de referência, checável por código no HTML gerado. O modelo também lista as decisões que tomou, citando o id da regra usada; a citação é conferida por código, sem juiz humano nem juiz-modelo.

## Completude do lake (variável principal de T4)
- **Níveis:** 0% (sem lake), 25%, 50%, 100% do lake de referência. Os subconjuntos são sorteados com semente fixa, estratificados por domínio, e **sorteados de novo por amostra**. Assim, cada ponto de decisão fica às vezes com a regra relevante presente e às vezes ausente, e dá para estimar o efeito de ter a regra no nível da decisão, pareado, em vez de só comparar níveis.
- **Tipos de ponto de decisão:** (a) coberto por uma regra do lake; (b) sem nenhuma regra no lake de referência (controle de transbordamento); (c) com regras em conflito, onde o lake traz um critério de precedência.
- **Controle de volume (distratores):** lake com o mesmo tamanho do 100%, mas com regras de outros domínios, para separar "mais texto" de "regra certa".
- **Acesso ao lake:** tudo no prompt versus recuperação das 8 regras mais próximas do briefing (BM25, por código, sem modelo), para medir a perda e a economia de tokens.

## Condições
A0 puro; A1 + lake no prompt (com os níveis acima em T4); A2 + relatório do kit; A3 regras + relatório; AC autocrítica (T1); R recuperação top-8 (T4). Modelos: Haiku 5.5 e Sonnet 5.5; Opus fora por custo; validação com Fable fica para depois. `claude -p --effort medium`, sem ferramentas e sem internet. 3 amostras por célula.

## Hipóteses confirmatórias (Holm)
- H1 (efeito do lake em decisão aberta): em T4, o acerto do ponto de decisão é maior com a regra presente que ausente, no Haiku e no Sonnet, em pontos do tipo (a).
- H2 (dose-resposta): o acerto em T4 cresce com a completude (0, 25, 50, 100%), tendência monótona.
- H3 (quem mais ganha): o efeito de H1 é maior no Haiku que no Sonnet.
- H4 (sem dano onde não há regra): nos pontos do tipo (b), o lake de 100% não reduz o acerto além de 3 pontos percentuais (não inferioridade).
- H5 (regra certa, não volume): o lake relevante supera o lake de distratores do mesmo tamanho.
- H6 (recuperação): R mantém pelo menos 90% do ganho do lake completo no prompt, com menos tokens de entrada.
- H7 (kit em telas complexas): em T1 e T2, A3 supera A1 no Haiku.
- H8 (dificuldade): Haiku A0 pontua menos em telas complexas que no estudo 3 (verifica que o teste ficou mais difícil).
- H9 (critério principal): Haiku com o conjunto atinge 90% da acurácia combinada do Sonnet A0, com custo de no máximo 50%, agora nas telas complexas.
Descritivas: onde cada modelo falha por tipo de tela e por domínio; custo em tokens por nível de completude; citação de regra (o id citado existe e corresponde à decisão?).

## Piloto de calibração (antes de congelar)
6 telas por tipo, Haiku e Sonnet em A0, 3 amostras. Se o Haiku A0 pontuar acima de 85% na média de T1 e T2, aumentar a dificuldade (mais regras, defeitos mais sutis) e repetir o piloto. Depois de congelar, a dificuldade não muda. O piloto fica fora da análise.

## Fonte de verdade e limites da régua
Pontuação por regras do lake de referência **e** por ferramenta independente (axe-core) quando a regra for de acessibilidade. Para regras de Nielsen e Baymard, que são pesquisa e não norma, o gabarito de cada ponto de decisão cita a fonte, e as fontes são conferidas uma a uma antes de congelar. Estética não é medida, e o estudo não diz nada sobre beleza.

## Limitações declaradas antes de ver os dados
1. Telas sintéticas geradas por script: ainda não é produção. O conjunto externo e o estudo de caso reduzem, mas não eliminam, a lacuna.
2. O gabarito de T4 vem de regras que nós escolhemos como "decisão melhor". Onde a literatura tem consenso fraco, a decisão ancorada é discutível; por isso só entram pontos com fonte pública e conferida.
3. Os mesmos autores montam o lake, o kit e o gabarito: risco de o kit ensinar a prova. A checagem independente e os pontos do tipo (b) mitigam.
4. Custo nominal (preço de tabela), sem o limite do plano.
5. Só Haiku e Sonnet; Opus e Fable ficam de fora desta rodada.
6. O ajuste de dificuldade do piloto é uma decisão de projeto declarada, não um resultado.

## Etapas e custo
1. Montar o lake de referência com fontes conferidas (a parte mais demorada e a que mais afeta a qualidade).
2. Gerador das 6 famílias de telas, com defeitos graduados e gabarito.
3. Kit estendido (parse5, css-tree, culori) para tabelas, formulários longos e estados.
4. Pontuação de T4 e integração do axe-core.
5. Piloto, calibração, congelamento por hash.
6. Rodada principal, análise, artigo em pt e en, guia, painel.
Custo nominal: **ainda não estimado**. Telas grandes e lake grande no prompt aumentam os tokens. O piloto mede o custo real por chamada, e eu mostro a conta total antes de qualquer rodada principal.
