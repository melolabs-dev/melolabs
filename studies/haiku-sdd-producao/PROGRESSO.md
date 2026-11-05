# Progresso: SDD só com Haiku: o que sobra de qualidade quando o custo cai

Atualizado em 2026-11-05 07:56 · congelamento dos dados: 2026-11-13

**8/46 passos (17%)**

| Fase | Passos | Situação |
| --- | --- | --- |
| F0 Premissa e escopo | 1/3 | ███░░░░░░░ |
| F1 Revisão de evidências | 5/6 | ████████░░ |
| F2 Hipóteses | 2/3 | ███████░░░ |
| F3 Pré-registro | 0/3 | ░░░░░░░░░░ |
| F4 Plano de testes | 0/6 | ░░░░░░░░░░ |
| F5 Execução | 0/3 | ░░░░░░░░░░ |
| F6 Análise | 0/4 | ░░░░░░░░░░ |
| F7 Validação independente | 0/4 | ░░░░░░░░░░ |
| F8 Congelamento dos dados | 0/3 | ░░░░░░░░░░ |
| F9 Artefatos e escrita | 0/5 | ░░░░░░░░░░ |
| F10 Revisão e aprovação | 0/3 | ░░░░░░░░░░ |
| F11 Publicação e pós-publicação | 0/3 | ░░░░░░░░░░ |

## Passos

### F0 · Premissa e escopo
- [x] **F0.1** Escrever a premissa, a pergunta de pesquisa e a decisão que o resultado informa
- [ ] **F0.2** Definir escopo, fora de escopo, público do artigo e critérios de sucesso do estudo — falta: manual: falta evidência
- [ ] **F0.3** Declarar conflitos de interesse, uso de material do trabalho e restrições de confidencialidade — falta: manual: falta evidência

### F1 · Revisão de evidências
- [x] **F1.1** Definir a estratégia de busca: termos, bases, critérios de inclusão e exclusão, data da busca
- [x] **F1.2** Coletar fontes em Markdown: no mínimo 10, sendo 3 acadêmicas, 3 de empresa ou documentação oficial e 2 independentes
- [x] **F1.3** Verificar que cada fonte existe (URL ou DOI abre) e que ela diz o que o resumo afirma
- [x] **F1.4** Classificar o nível de evidência (A a D) e o viés ou conflito de cada fonte
- [x] **F1.5** Escrever a síntese: o que se sabe, onde as fontes discordam e o que falta testar
- [ ] **F1.6** Indexar as fontes no RAG e checar se a busca as encontra — falta: manual: falta evidência

### F2 · Hipóteses
- [x] **F2.1** Formular hipóteses falsificáveis, cada uma com métrica, limiar e critério de refutação
- [x] **F2.2** Fixar para cada hipótese a margem de equivalência e o menor efeito que importa na prática
- [ ] **F2.3** Declarar a hipótese nula, ao menos um controle negativo e as explicações alternativas — falta: manual: falta evidência

### F3 · Pré-registro
- [ ] **F3.1** Escrever o plano de análise: estatísticas, intervalos de confiança, correção de múltiplas comparações, regra de outliers — falta: analise-plano.md ainda tem TODO
- [ ] **F3.2** Dimensionar a amostra com um piloto: estimar a variância e definir n e a regra de parada — falta: manual: falta evidência
- [ ] **F3.3** Congelar o pré-registro com uma tag git prereg-<slug> — falta: manual: falta evidência

### F4 · Plano de testes
- [ ] **F4.1** Especificar o ambiente: hardware, sistema, versões fixadas, lockfile ou container — falta: ambiente.md ainda tem TODO
- [ ] **F4.2** Definir variáveis, condições, ordem aleatória, sementes, aquecimento e número de repetições — falta: plano-de-testes.md ainda tem TODO
- [ ] **F4.3** Escrever o dicionário de dados e o esquema de coleta — falta: dicionario.md ainda tem TODO
- [ ] **F4.4** Automatizar a execução em um único comando (experimentos/run), sem passo manual — falta: experimentos/README.md ainda tem TODO
- [ ] **F4.5** Fazer o ensaio geral com amostra pequena e validar a coleta — falta: manual: falta evidência
- [ ] **F4.6** Revisar o plano com um segundo leitor (humano ou IA adversária) antes de executar — falta: manual: falta evidência

### F5 · Execução
- [ ] **F5.1** Executar todas as condições nas repetições planejadas; dados brutos só se acrescentam — falta: 0/1 arquivo(s) em dados/bruto/*
- [ ] **F5.2** Registrar ambiente e data de cada execução e todos os desvios do plano no diário — falta: diario.md ainda tem TODO
- [ ] **F5.3** Auditar os dados: nenhuma linha editada à mão, checksums batendo, nenhuma execução descartada sem registro — falta: manual: falta evidência

### F6 · Análise
- [ ] **F6.1** Rodar a análise exatamente como pré-registrada, com script versionado — falta: 0/1 arquivo(s) em analise/*
- [ ] **F6.2** Atualizar o status de cada hipótese: confirmada, refutada ou equivalente — falta: sem decisão ou sem evidência: H1=pendente, H2=pendente, H3=pendente, H4=pendente, H5=pendente, H6=pendente, H7=pendente, H8=pendente, H9=pendente, H10=pendente
- [ ] **F6.3** Se alguma ficou subpotente, estender a amostra pela regra de parada; nunca publicar como conclusão — falta: manual: falta evidência
- [ ] **F6.4** Fazer as análises de sensibilidade e as exploratórias, rotuladas como tal — falta: manual: falta evidência

### F7 · Validação independente
- [ ] **F7.1** Reproduzir do zero em um clone limpo ou container, com um comando — falta: manual: falta evidência
- [ ] **F7.2** Reproduzir em um segundo ambiente ou por uma segunda pessoa — falta: manual: falta evidência
- [ ] **F7.3** Escrever as ameaças à validade: interna, externa, de construto e de conclusão — falta: validade.md ainda tem TODO
- [ ] **F7.4** Revisão adversária: tentar refutar as conclusões e registrar o que sobrou — falta: manual: falta evidência

### F8 · Congelamento dos dados
- [ ] **F8.1** Congelar dados e análise com tag git e manifesto de checksums — falta: manual: falta evidência
- [ ] **F8.2** Montar o pacote de dados aberto: CSV, dicionário, licença e README — falta: 0/3 arquivo(s) em dados/pacote/*
- [ ] **F8.3** Arquivar com DOI (release no GitHub integrada ao Zenodo) — falta: manual: falta evidência

### F9 · Artefatos e escrita
- [ ] **F9.1** Montar a matriz afirmação ↔ evidência: toda afirmação do texto aponta para um dado ou uma fonte — falta: afirmações sem evidência: 1
- [ ] **F9.2** Gerar figuras e tabelas por script a partir dos dados; números do texto vêm dos resultados — falta: manual: falta evidência
- [ ] **F9.3** Redigir o artigo em português e em inglês (resumo, introdução, métodos, resultados, discussão, limitações, conclusão, reprodutibilidade, referências) — falta: rascunho ausente, curto ou com TODO em: pt, en
- [ ] **F9.4** Validar os formatos: links, tabelas, imagens, acessibilidade e build do site — falta: manual: falta evidência
- [ ] **F9.5** Revisar confidencialidade e anonimização; marcar as notas-fonte como publicáveis — falta: manual: falta evidência

### F10 · Revisão e aprovação
- [ ] **F10.1** Conferir que todos os passos das fases F0 a F9 estão concluídos — falta: pendentes: F0.2, F0.3, F1.6, F2.3, F3.1, F3.2, F3.3, F4.1…
- [ ] **F10.2** Fact-check final: cada número do texto conferido contra os dados — falta: manual: falta evidência
- [ ] **F10.3** Aprovação do autor, dita de forma explícita para cada idioma — falta: manual: falta evidência

### F11 · Publicação e pós-publicação
- [ ] **F11.1** Publicar com o publicador: site, DEV e, depois, as demais plataformas — falta: manual: falta evidência
- [ ] **F11.2** Abrir o canal de correção e registrar a política de errata e o histórico de versões — falta: manual: falta evidência
- [ ] **F11.3** Retrospectiva: o que melhorou no método, o que faltou e quanto tempo cada fase levou — falta: retro.md ainda tem TODO
