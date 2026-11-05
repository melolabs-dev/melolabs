# Protocolo de Pesquisa do Melo Labs

Versão 1.0. Gerado de research/protocolo.json. Não editar à mão.

## Princípios

- Nenhum número, citação ou afirmação entra no artigo sem origem rastreável: um dado em studies/<slug>/dados ou uma fonte verificada em studies/<slug>/fontes.
- O que uma máquina consegue conferir, a máquina confere. Só passos que dependem de julgamento ficam como manuais, e exigem evidência escrita.
- Hipóteses, métricas, margens e regras de parada são definidas e congeladas antes de rodar qualquer teste.
- Resultado negativo, equivalente ou surpreendente tem o mesmo destaque do positivo.
- O estudo precisa ser repetível por outra pessoa com um único comando, a partir de um clone limpo.
- A IA ajuda a pesquisar, escrever e criticar. Quem mede, valida e aprova é o autor.
- Quem decide é o autor. O que a IA escreve (premissa, hipóteses, margens, síntese, plano, texto) é rascunho até o autor aprovar passo a passo.
- O objetivo do estudo é aprender: cada fase vira um artefato visual que explica o que foi feito, o que foi validado e o que o autor pode aplicar nos próprios processos.

## Status de uma hipótese

- **pendente**: ainda não testada
- **confirmada**: a previsão se cumpriu com o critério pré-registrado, em todas as execuções planejadas
- **refutada**: o critério de refutação pré-registrado foi atingido
- **equivalente**: a diferença ficou dentro da margem de equivalência pré-registrada: não há efeito prático
- **subpotente**: o desenho não tinha amostra suficiente para decidir. É falha do desenho: estender a amostra pela regra de parada antes de qualquer afirmação

## F0 · Premissa e escopo

Dizer com precisão o que será descoberto e que decisão o resultado vai informar.

| Passo | O que fazer | Pronto quando | Conferência |
| --- | --- | --- | --- |
| F0.1 | Escrever a premissa, a pergunta de pesquisa e a decisão que o resultado informa | premissa.md preenchido, sem TODO | automática |
| F0.2 | Definir escopo, fora de escopo, público do artigo e critérios de sucesso do estudo | Seção de escopo da premissa revisada pelo autor | manual, com evidência |
| F0.3 | Declarar conflitos de interesse, uso de material do trabalho e restrições de confidencialidade | Decisão registrada: o que pode e o que não pode ser publicado | manual, com evidência |

## F1 · Revisão de evidências

Saber o que já se sabe antes de testar, com fontes acadêmicas, de empresas e independentes, todas verificadas.

| Passo | O que fazer | Pronto quando | Conferência |
| --- | --- | --- | --- |
| F1.1 | Definir a estratégia de busca: termos, bases, critérios de inclusão e exclusão, data da busca | busca.md preenchido, sem TODO | automática |
| F1.2 | Coletar fontes em Markdown: no mínimo 10, sendo 3 acadêmicas, 3 de empresa ou documentação oficial e 2 independentes | Notas em fontes/ com frontmatter completo | automática |
| F1.3 | Verificar que cada fonte existe (URL ou DOI abre) e que ela diz o que o resumo afirma | Todas as fontes com verificada: true; comando links sem erro | automática |
| F1.4 | Classificar o nível de evidência (A a D) e o viés ou conflito de cada fonte | nivel_evidencia e vies preenchidos em todas | automática |
| F1.5 | Escrever a síntese: o que se sabe, onde as fontes discordam e o que falta testar | sintese.md preenchido, sem TODO | automática |
| F1.6 | Indexar as fontes no RAG e checar se a busca as encontra | python tools/rag/rag.py build rodado; busca devolve as fontes | manual, com evidência |

## F2 · Hipóteses

Transformar a premissa em previsões que podem ser refutadas por dados.

| Passo | O que fazer | Pronto quando | Conferência |
| --- | --- | --- | --- |
| F2.1 | Formular hipóteses falsificáveis, cada uma com métrica, limiar e critério de refutação | hipoteses.json sem TODO e com todos os campos | automática |
| F2.2 | Fixar para cada hipótese a margem de equivalência e o menor efeito que importa na prática | margem_equivalencia e efeito_minimo preenchidos | automática |
| F2.3 | Declarar a hipótese nula, ao menos um controle negativo e as explicações alternativas | Registrados na premissa ou em hipoteses.json | manual, com evidência |

## F3 · Pré-registro

Congelar o que será medido e como será analisado antes de ver qualquer resultado.

| Passo | O que fazer | Pronto quando | Conferência |
| --- | --- | --- | --- |
| F3.1 | Escrever o plano de análise: estatísticas, intervalos de confiança, correção de múltiplas comparações, regra de outliers | analise-plano.md preenchido, sem TODO | automática |
| F3.2 | Dimensionar a amostra com um piloto: estimar a variância e definir n e a regra de parada | Piloto registrado e n justificado no plano de testes | manual, com evidência |
| F3.3 | Congelar o pré-registro com uma tag git prereg-<slug> | Hash do commit e da tag registrados como evidência | manual, com evidência |

## F4 · Plano de testes

Documentar o experimento de forma que outra pessoa o repita sem perguntar nada.

| Passo | O que fazer | Pronto quando | Conferência |
| --- | --- | --- | --- |
| F4.1 | Especificar o ambiente: hardware, sistema, versões fixadas, lockfile ou container | ambiente.md preenchido, sem TODO | automática |
| F4.2 | Definir variáveis, condições, ordem aleatória, sementes, aquecimento e número de repetições | plano-de-testes.md preenchido, sem TODO | automática |
| F4.3 | Escrever o dicionário de dados e o esquema de coleta | dicionario.md preenchido, sem TODO | automática |
| F4.4 | Automatizar a execução em um único comando (experimentos/run), sem passo manual | Comando documentado em experimentos/README.md | automática |
| F4.5 | Fazer o ensaio geral com amostra pequena e validar a coleta | Execução piloto registrada no diário | manual, com evidência |
| F4.6 | Revisar o plano com um segundo leitor (humano ou IA adversária) antes de executar | Lista de objeções e como cada uma foi tratada | manual, com evidência |

## F5 · Execução

Coletar os dados brutos exatamente como planejado, sem retoques.

| Passo | O que fazer | Pronto quando | Conferência |
| --- | --- | --- | --- |
| F5.1 | Executar todas as condições nas repetições planejadas; dados brutos só se acrescentam | Arquivos em dados/bruto/ | automática |
| F5.2 | Registrar ambiente e data de cada execução e todos os desvios do plano no diário | diario.md preenchido, sem TODO | automática |
| F5.3 | Auditar os dados: nenhuma linha editada à mão, checksums batendo, nenhuma execução descartada sem registro | Auditoria registrada com o resultado | manual, com evidência |

## F6 · Análise

Decidir cada hipótese como pré-registrado: confirmada, refutada ou equivalente.

| Passo | O que fazer | Pronto quando | Conferência |
| --- | --- | --- | --- |
| F6.1 | Rodar a análise exatamente como pré-registrada, com script versionado | Script em analise/ e resultados em dados/processado/ | automática |
| F6.2 | Atualizar o status de cada hipótese: confirmada, refutada ou equivalente | Nenhuma hipótese pendente ou subpotente | automática |
| F6.3 | Se alguma ficou subpotente, estender a amostra pela regra de parada; nunca publicar como conclusão | Registrado no diário o que foi estendido e por quê | manual, com evidência |
| F6.4 | Fazer as análises de sensibilidade e as exploratórias, rotuladas como tal | Seção exploratória separada das confirmatórias | manual, com evidência |

## F7 · Validação independente

Provar que o resultado não depende da máquina, da pessoa ou do acaso.

| Passo | O que fazer | Pronto quando | Conferência |
| --- | --- | --- | --- |
| F7.1 | Reproduzir do zero em um clone limpo ou container, com um comando | Saída idêntica ou dentro da tolerância declarada | manual, com evidência |
| F7.2 | Reproduzir em um segundo ambiente ou por uma segunda pessoa | Resultado da réplica registrado | manual, com evidência |
| F7.3 | Escrever as ameaças à validade: interna, externa, de construto e de conclusão | validade.md preenchido, sem TODO | automática |
| F7.4 | Revisão adversária: tentar refutar as conclusões e registrar o que sobrou | Objeções e respostas registradas | manual, com evidência |

## F8 · Congelamento dos dados

Fixar os dados e o código que sustentam as conclusões, de forma citável.

| Passo | O que fazer | Pronto quando | Conferência |
| --- | --- | --- | --- |
| F8.1 | Congelar dados e análise com tag git e manifesto de checksums | Tag e manifesto registrados | manual, com evidência |
| F8.2 | Montar o pacote de dados aberto: CSV, dicionário, licença e README | Arquivos em dados/pacote/ | automática |
| F8.3 | Arquivar com DOI (release no GitHub integrada ao Zenodo) | DOI registrado | manual, com evidência |

## F9 · Artefatos e escrita

Escrever o artigo a partir dos dados, e não o contrário.

| Passo | O que fazer | Pronto quando | Conferência |
| --- | --- | --- | --- |
| F9.1 | Montar a matriz afirmação ↔ evidência: toda afirmação do texto aponta para um dado ou uma fonte | claims.json sem TODO e com evidência em todas | automática |
| F9.2 | Gerar figuras e tabelas por script a partir dos dados; números do texto vêm dos resultados | Scripts de figuras em analise/ e saídas em dados/processado/ | manual, com evidência |
| F9.3 | Redigir o artigo em português e em inglês (resumo, introdução, métodos, resultados, discussão, limitações, conclusão, reprodutibilidade, referências) | posts/drafts/<slug>/pt.md e en.md sem TODO | automática |
| F9.4 | Validar os formatos: links, tabelas, imagens, acessibilidade e build do site | npm run build passa e o artigo abre no preview | manual, com evidência |
| F9.5 | Revisar confidencialidade e anonimização; marcar as notas-fonte como publicáveis | publishable: true nas notas usadas | manual, com evidência |

## F10 · Revisão e aprovação

Passar todos os portões e obter a aprovação explícita do autor.

| Passo | O que fazer | Pronto quando | Conferência |
| --- | --- | --- | --- |
| F10.1 | Conferir que todos os passos das fases F0 a F9 estão concluídos | Nenhum passo pendente antes desta fase | automática |
| F10.2 | Fact-check final: cada número do texto conferido contra os dados | Conferência registrada, com data | manual, com evidência |
| F10.3 | Aprovação do autor, dita de forma explícita para cada idioma | Frase de aprovação registrada com a data | manual, com evidência |

## F11 · Publicação e pós-publicação

Publicar, aceitar correção e aprender com o processo.

| Passo | O que fazer | Pronto quando | Conferência |
| --- | --- | --- | --- |
| F11.1 | Publicar com o publicador: site, DEV e, depois, as demais plataformas | Endereços publicados registrados | manual, com evidência |
| F11.2 | Abrir o canal de correção e registrar a política de errata e o histórico de versões | Errata e changelog criados no repositório do estudo | manual, com evidência |
| F11.3 | Retrospectiva: o que melhorou no método, o que faltou e quanto tempo cada fase levou | retro.md preenchido, sem TODO | automática |
