# Premissa e pergunta de pesquisa

> Rascunho do protocolo, escrito a partir das suas notas validadas e das fontes verificadas. Os valores propostos aguardam a sua revisão (passos F0.2 e F0.3).

## Título de trabalho
**SDD só com Haiku: o que sobra de qualidade quando o custo cai**

Alternativas, se preferir:
- *Haiku de ponta a ponta: o que um modelo pequeno entrega em SDD, e quanto custa fazê-lo acertar*
- *Pequeno, barato e pronto para produção? Testei engenharia contra o gargalo do Haiku no SDD*

Em inglês: *Spec-driven development with only Haiku: how much of a large model's quality can engineering give back?*

O título é uma pergunta de propósito: o resultado pode ser "devolve quase tudo", "devolve parte" ou "não compensa", e o artigo precisa sair com qualquer um deles.

## Premissa
Um modelo pequeno erra em SDD sobretudo por carga cognitiva por chamada (muitas restrições, contexto longo, decisões encadeadas), e não por falta de conhecimento de engenharia. Se isso é verdade, estratégias de engenharia de software aplicadas ao redor do modelo (decompor, fixar opções, conferir com gates determinísticos, alimentar a correção com erro real, escrever testes antes do código, escalar só quando necessário) devolvem parte relevante da qualidade de um modelo maior a uma fração do custo. Fontes que sustentam o raciocínio, todas verificadas: planejar antes de gerar (self-planning, AlphaCodium), feedback externo em vez de autocorreção (Huang et al.), computação adaptativa e cascatas (Snell et al., FrugalGPT, RouteLLM) e testes como especificação (TiCoder, Mathews e Nagappan). Nada disso foi medido ainda com o Haiku 5.5 em um fluxo completo de SDD.

Dado de partida das suas notas validadas (versões anteriores do pipeline, uma feature, três execuções por braço): o Haiku enxuto custou cerca de 6% do Sonnet em dólar, mas ficou abaixo em TechSpec (média 18,0 contra 31,3 de 35) e em Tasks (16,7 contra 23,3 de 25). O estudo atual existe para saber se mitigações melhores fecham essa distância sem perder o ganho de custo.

## Pergunta de pesquisa
Um pipeline de SDD (PRD, TechSpec, Tasks e código) executado só com o Haiku 5.5, com mitigações de engenharia, produz artefatos "prontos para produção" (definição operacional abaixo) com qualidade equivalente à do Sonnet 5.5 padrão e custo total por artefato aceito pelo menos 50% menor?

**Definição operacional de "pronto para produção":** gates determinísticos verdes (estrutura, rastreabilidade de IDs, `tsc` e lint), nota de rubrica de pelo menos 80% do máximo (28 de 35 em PRD e TechSpec; 20 de 25 em Tasks), e, para o código, 100% dos testes de aceite ocultos passando. Limiares propostos; ajustar no piloto, antes do pré-registro.

## Decisão que o resultado informa
Se vale adotar o Haiku como modelo padrão de SDD no trabalho e na mentoria, e quais mitigações pagam seu custo. Quem decide: o autor.

## Escopo e fora de escopo
> Seção revisada com as decisões do autor de 05/11/2026. Aguardando a aprovação final do autor (F0.2).

- **Dentro:**
  - As quatro etapas: PRD, TechSpec, Tasks e código.
  - Haiku 5.5 contra Sonnet 5.5 como referência, medindo qualidade, custo em dólar e tempo.
  - As 10 hipóteses do registro (`hipoteses.json`, H1 a H10).
  - Os 4 braços do autor, que rodam em paralelo (`solucoes-do-autor.md`): repo map do TypeScript, N candidatos em worktrees, limite de chamadas por worker e checagem de rodapé.
- **Fora:**
  - Outros modelos e fornecedores.
  - Fine-tuning e agentes autônomos de livre exploração.
  - Generalização para qualquer projeto, linguagem ou tamanho de repositório.
  - As 12 hipóteses candidatas (`candidatas.md`), que ficam para estudos seguintes.
  - Qualquer dado da empresa onde o autor trabalha (regras em `declaracoes.md`).
- **Projeto-alvo:** h3 (github.com/h3js/h3), TypeScript, licença MIT, testes em vitest. O CLAUDE.md e o AGENTS.md do h3 entram nas duas condições. O commit fica fixado no pré-registro, antes de qualquer issue ser resolvida.
- **Features:** três issues abertas do h3: #1267 (HTTP Range no `serveStatic`), #1384 (erro no formato RFC 9457) e #1050 (várias senhas de unseal em sessões).
- **Juízes e orçamento:** Opus como avaliador cego, até US$ 50. Detalhes na fase de plano de testes (F4).
- **Prazo:** dados congelados na sexta, 13/11/2026.

## Público do artigo
- **Quem lê:** engenheiros e engenheiras de software que já usam agentes de IA em SDD e decidem qual modelo usar por etapa, e mentores e líderes técnicos que precisam justificar custo.
- **O que levam:** se o Haiku serve como modelo padrão de SDD, quais mitigações valem o custo e quais não valem, com os dados e o código para refazer.
- **O que não se promete:** que o resultado vale para outros projetos, linguagens ou versões de modelo.
- **Idiomas:** português e inglês, com o mesmo conteúdo.

## Critérios de sucesso do estudo
- Todas as hipóteses terminam como confirmada, refutada ou equivalente. Nenhuma fica pendente ou subpotente.
- **Qualidade equivalente** significa razão de qualidade (Haiku com mitigações sobre Sonnet padrão) de pelo menos 0,90. **Custo menor** significa razão de custo de no máximo 0,50.
- Réplica em clone limpo com um comando, com resultado dentro da tolerância declarada.
- Dados brutos, scripts e pacote de dados abertos e arquivados.
- Aprovação explícita do autor, em português e em inglês.
- **Sucesso não exige resultado positivo.** Se o Haiku não chegar a 0,90 ou o custo anular o ganho, o artigo sai do mesmo jeito, com o resultado negativo.

## Hipótese nula, controle negativo e explicações alternativas
- **Nula:** as mitigações não alteram a qualidade do Haiku além da margem de equivalência, ou o custo adicional delas anula o ganho.
- **Controle negativo:** Haiku com autorrevisão sem feedback externo (a literatura prevê que isso não ajuda). Se esse controle melhorar muito, o método de medição está errado.
- **Explicações alternativas:** o juiz LLM favorece certo estilo (vieses de posição, verbosidade e autopreferência descritos por Zheng et al.); as features escolhidas são fáceis demais (saturação, como nas decisões da rodada anterior); diferenças entre versões do modelo; variação entre execuções.

## Conflitos de interesse e confidencialidade
> Declarações confirmadas pelo autor em 05/11/2026; detalhes em `declaracoes.md`.

- Sem vínculo com fornecedor de modelo, sem patrocínio, crédito ou acesso gratuito, e sem necessidade de autorização do empregador.
- O autor mentora pessoas e quer promover o método: risco de viés de confirmação. Mitigação: hipóteses, margens e análise pré-registradas, avaliação cega e resultados negativos publicados.
- Dados do trabalho só aparecem anonimizados e agregados. O projeto-alvo é aberto.
- Três das fontes são de fornecedor de modelo ou de empresa com produto (Anthropic e Chroma); os vieses estão registrados nas notas.
