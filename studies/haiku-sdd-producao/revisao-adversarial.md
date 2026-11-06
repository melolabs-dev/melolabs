# Revisão adversarial do plano (antes da coleta principal)

> Revisor independente, 05/11/2026. Li: premissa.md, hipoteses.json, plano-de-testes.md, analise-plano.md, ambiente.md, piloto.md, dicionario.md, gabarito/classificacao.json, gabarito/enxuto/*.md, prereg/manifesto.json, dados/bruto/plano-execucoes.json, dados/bruto/execucoes.jsonl, uma pasta de piloto, e tools/harness/{harness.py, gates.py, prompts.md}. Os testes cifrados não foram abertos e a chave não foi procurada. Nenhum arquivo do projeto foi alterado além deste relatório.
>
> Ordem: bloqueante (invalida uma conclusão anunciada se não for corrigido antes da coleta), importante (enfraquece ou distorce uma conclusão), menor.

---

## BLOQUEANTES

### B1. A auditoria de vazamento é vazia: as transcrições registradas têm 0 bytes
- **Evidência.** As 52 linhas de `dados/bruto/execucoes.jsonl` apontam `transcricao` para arquivos `...\Temp\claude\...\tasks\<agente>.output`. Conferi todos: **52 de 52 existem e têm 0 bytes** (só um arquivo não vazio na pasta, `adca572143c3cbdad.output`, que não aparece no registro). `harness.py audit` lê o arquivo, não acha nada e grava `{"limpo": true}`; não falha quando o arquivo está vazio. A frase "Auditoria de vazamento: limpa nas 12 execuções" (piloto.md) não tem base.
- **Efeito.** Toda a proteção contra contaminação (o único controle, porque o próprio plano admite que não há barreira técnica) está inoperante, e o piloto não demonstrou nada.
- **Correção.** (1) Auditar a transcrição real do subagente (o JSONL da sessão em `~/.claude/projects/...`, ou a saída `--output-format stream-json` de uma execução headless, ver B2) e copiá-la para `dados/bruto/<id>/transcricoes/`; (2) `audit` deve falhar (exit 1, `limpo: null`) se algum arquivo estiver ausente, vazio ou menor que um mínimo; (3) refazer a auditoria do piloto com as transcrições reais antes de usá-lo como prova do harness.

### B2. O gabarito em texto claro está ao alcance dos agentes (e dos juízes)
- **Evidência.**
  - A sessão orquestradora roda com diretório de trabalho `C:\...\blog-tech`. Subagentes do Claude Code herdam esse diretório: `Glob`/`Grep` sem `path` e `Bash` sem `cd` começam em `blog-tech`, não em `C:\dev\runs\<id>`. A regra "trabalhe só dentro da pasta" é só instrução.
  - Só `*.test.ts` e `*.patch` foram cifrados. Continuam em texto claro, dentro de `blog-tech`: `gabarito-rascunho.md` (tabela com os casos e valores, por exemplo "R10 ... `bytes 0-4/18`"), `gabarito/enxuto/rastreio.md` (descreve cada teste), `gabarito/*.contrato.md` (contratos completos, com todos os casos de borda), `dados/bruto/piloto-*/codigo.diff` (12 soluções que passam em 100% dos testes) e `dados/bruto/piloto-*/sdd/pedido.md` (contrato completo). Durante a coleta, `dados/bruto/<id>/codigo.diff` de execuções anteriores vai se acumulando no mesmo lugar. `blog-tech` tem `.git` com o gabarito no histórico (o próprio plano admite) e um `.env`.
  - Os subagentes recebem o conjunto de ferramentas da sessão pai: o piloto registra "Agentes Haiku tentaram por engano chamar uma ferramenta de handoff de sessão". Logo, têm também WebFetch/WebSearch (issue e PRs no GitHub) e `git fetch` (o `C:\dev\h3-estudo` tem `origin` apontando para github.com/h3js/h3).
  - Os juízes rodam do mesmo jeito e podem ler `dados/bruto/mapa-cego.json` ("fora da pasta que os juízes enxergam" é falso nessas condições).
- **Efeito.** Vazamento possível em qualquer execução. Como a regex de auditoria (`range-1267|...|blog-tech`) não pega busca na web, nem caminhos relativos, nem nomes de PR, a contaminação pode passar sem ser notada. Além disso, se o Haiku fizer mais buscas sem `path` que o Sonnet, as exclusões por auditoria vão ser **diferenciais** por condição (ver I11).
- **Correção.** Rodar cada etapa como processo headless isolado: `claude -p` com o diretório de trabalho em `C:\dev\runs\<id>`, `--model` explícito, `--allowedTools` restrito (Read, Edit, Write, Glob, Grep e Bash limitado a `pnpm`/`git` local), `--disallowedTools WebFetch WebSearch`, e regras `deny` de leitura para `C:\Users\**`. Antes da coleta: cifrar ou tirar do disco `gabarito-rascunho.md`, `rastreio.md`, `gabarito/*.contrato.md` e `dados/bruto/piloto-*`; gravar `dados/bruto` da coleta fora de qualquer caminho que o agente consiga alcançar; remover `origin` do `h3-estudo`. Fazer o mesmo com os juízes.

### B3. "Tokens" não mede consumo, e a estimativa em dólar não depende das proporções
- **Evidência.** `tokens_totais` vem da notificação do subagente. Os números batem com o **tamanho final do contexto**, não com o total consumido: PRD com 7 chamadas de ferramenta = 78.711 tokens; TechSpec com 27 chamadas = 137.599. Se fosse acumulado, cada volta reenviaria o prefixo fixo (~60 a 65 mil tokens de sistema, ferramentas e CLAUDE.md), e o total passaria de 400 mil. O CV de 2,3% e a razão Haiku/Sonnet de 1,21 refletem esse prefixo fixo, não o gasto. Mais três pontos:
  - O preço do Haiku 5.5 é exatamente 1/20 do Sonnet 5.5 tanto na entrada quanto na saída (fontes/anthropic-pricing.md). Com isso, **as três proporções 60/40, 80/20 e 95/5 dão a mesma razão de custo**: a análise de sensibilidade prometida não testa nada.
  - O preço de cache hit está numa razão de 1/10 (US$ 0,01 contra 0,10). Como quase todo o prefixo é lido do cache, é isso que domina a fatura, e o cache é ignorado.
  - Os contextos finais do código ficam entre 128 e 164 mil tokens, ou seja, acima do tier de 100 mil do Haiku. O harness não registra o maior prompt por chamada, que a H6 exige.
- **Efeito.** As métricas de custo de H5, H6 e H10 e a frase "o Haiku gasta 21% mais tokens" não medem o que dizem medir. O dimensionamento "3 repetições bastam" se apoia num CV artificial.
- **Correção.** Somar o `usage` de cada mensagem (input, output, cache_creation, cache_read, `model`) a partir da transcrição real, ou usar `--output-format json` do headless, que traz `usage`, `modelUsage` e `total_cost_usd`. Registrar o maior `input+cache` por requisição, para detectar o tier. Recalcular o piloto com isso antes de fixar n.

### B4. H6 (e a metade de custo da H5) já está decidida pela tabela de preços
- **Evidência.** Com a razão de preço de 1/20 (1/4 no pior tier), a razão de custo só passa de 0,50 se o Haiku consumir mais de 10 vezes os tokens do Sonnet (mais de 2 vezes no tier acima de 100 mil). O piloto mostra razões perto de 1,2 em todas as células. A hipótese "confirma" por construção. Ainda por cima, ela entra na família principal de Holm, onde um p ≈ 0 garantido afrouxa o limiar das outras duas.
- **Correção.** Escolher uma de duas saídas: (a) tirar a H6 da família confirmatória e reportá-la como descritiva; ou (b) reescrevê-la com um limiar informativo em consumo real (por exemplo, tokens acumulados do Haiku com mitigações ≤ 1,5 vez os do Sonnet, ou razão de custo ≤ 0,10) **antes** do congelamento. Na H5, declarar que a parte de custo é quase certa e que a conclusão depende da parte de qualidade.

### B5. A H4 não tem sensibilidade: "equivalente" vai sair de um instrumento que não discrimina
- **Evidência.**
  - Piloto: 198 de 198 testes passando nas três condições, **inclusive no Haiku simples (C1)**. Nenhuma condição separa das outras.
  - A conta de Wilson do plano (36/36 dá limite inferior de 0,90) trata 36 execuções como independentes, mas elas são 6 variantes aninhadas em 3 features. A H4 é uma diferença entre duas proporções, não um limite de uma proporção só. Com Newcombe, 36/36 contra 36/36 dá limite inferior de cerca de −0,096: passa por um fio. Já 35/36 contra 36/36 dá cerca de −0,14 e reprova. Isso quer dizer que **uma única falha do Haiku derruba a hipótese, e zero falhas a confirma**. Não há região intermediária.
  - O analise-plano manda usar bootstrap percentil estratificado. Com todos os valores iguais a 1, o bootstrap dá um IC de largura zero, que "cabe" em qualquer margem: equivalência espúria.
  - O piloto rodou com o **contrato completo** (conferido em `piloto-C0-range-1267-r1/sdd/pedido.md`). A coleta usa o **contrato enxuto**, que nunca foi pilotado. Saturação, variância e taxa de falha sob o enxuto são desconhecidas, e o n=6 foi calculado supondo "tudo passa".
- **Correção.** (1) Pré-registrar o método para proporções: Newcombe (ou Miettinen-Nurminen) na versão de não inferioridade unilateral, ao nível ajustado por Holm, com análise por feature ao lado. Nunca bootstrap percentil para proporções na fronteira. (2) Pré-registrar uma checagem de sensibilidade do ensaio: a mesma bateria precisa separar alguma condição (por exemplo, o C1 ou um braço degradado de propósito), senão a H4 sai como "não informativa", não como "equivalente". (3) Usar a fração de testes passando, incluindo os de observação, como desfecho secundário contínuo pré-registrado. (4) Mini-piloto com o contrato enxuto (C0 e C1, 2 variantes, 2 repetições) antes da coleta, para medir a saturação.

### B6. Bug de pontuação: um arquivo de teste que não carrega some do núcleo, e a execução pode "passar"
- **Evidência.** `score()` só cria chaves a partir de `assertionResults`. Se um arquivo oculto falha no import (por exemplo, `problem` não exportado na #1384-C, ou um erro de sintaxe no `src`), o JSON do vitest traz o arquivo com status de falha e **sem asserções**: nenhuma chave entra em `res["testes"]`. O `nucleo_total` passa a contar só o outro arquivo (`*.novos.test.ts` ou `extras`), e `nucleo_passaram == nucleo_total` pode virar "100%". O caminho de exceção grava uma única chave `::ERRO`, que conta como 1 teste no lugar de dezenas. `_id()` também depende de a primeira ocorrência de `[A-Z]\d{1,2}` no nome completo ser o ID; testes dos arquivos `novos` sem esse padrão caem no núcleo sem controle.
- **Correção.** Pré-registrar, por variante, a lista esperada de IDs × alvo (web/node) e a contagem esperada. Teste esperado que estiver ausente conta como falha. Conferir o `status` de cada arquivo no JSON. Fazer a execução abortar se `nucleo_total` for diferente do esperado. Testar o harness com um diff que quebra o import, antes da coleta.

### B7. Os gates nunca reprovam e o C4 executado não é o C4 do plano: H3 e o escalonamento da H5 não são testáveis
- **Evidência.** No piloto, os 36 documentos (PRD, TechSpec e Tasks de C0, C1 e C4) têm `gate_ok = true` na primeira tentativa, sem nenhuma rodada de correção de documento. Os gates conferem só formato (cabeçalhos `RF-`/`D-`/`T-`, palavras "dado/quando/então", ≥ 3 citações `arquivo:linha`, cobertura de RF), e os prompts neutros já pedem exatamente esse formato. Consequências:
  - **C2 ≡ C1** nos documentos (o loop nunca dispara) e a H3 (+4 pontos) vai sair "refutada" ou "equivalente" por construção, não por evidência.
  - **C5 ≡ C4** (a cascata escala "quando o gate reprova duas vezes" e "quando o código não passa nos testes do próprio agente após 3 rodadas", e nenhum dos dois aconteceu no piloto). A H5 vira só C4 contra C0, e a H10 compara o híbrido com um C4 rebatizado.
  - O **C2n sempre intervém** (a autorrevisão roda em todo documento), então o controle negativo recebe mais intervenção que o tratamento.
  - O plano define C4 como "C2, C3, citação de IDs e TDD". O prompts.md não tem etapa de voto (C3) para o C4. **O C4 executado é "C1 + prompt de TDD"**, e o artigo não pode chamá-lo de "mitigações completas".
- **Correção.** Uma de duas saídas: (a) endurecer os gates com checagens determinísticas de conteúdo (cada nome público do contrato aparece na TechSpec; cada citação `arquivo:linha` contém o símbolo citado; cada RF tem pelo menos um teste em `test/sdd-*`; cada arquivo do rodapé de Tasks existe e aparece no diff) e comprovar, nas saídas do C1 do piloto, uma taxa de reprovação > 0; ou (b) declarar H3 e o escalonamento como não testáveis neste desenho e tirá-los da família confirmatória. Nos dois casos, reescrever a definição do C4 no plano conforme o que de fato roda.

---

## IMPORTANTES

### I1. O orquestrador está contaminado e o protocolo é manual
A sessão que escreveu os testes e as referências é a mesma que monta os prompts, decide se o gate reprovou, decide a cascata, decifra e pontua, e copia os tokens à mão para o `execucoes.jsonl`. Os prompts enviados não são gravados. `etapa()` grava `falha_infra: False` e `escalonou: False` fixos (não há parâmetro para marcar escalonamento na C5) e não existe campo de tentativa. Em cerca de 138 × 6 a 10 passos, a sessão vai compactar o contexto várias vezes, e o protocolo pode derivar.
**Correção:** um script orquestrador determinístico (headless) que gera o prompt a partir do template, grava o texto e o hash de cada prompt, roda o gate, decide o loop e a cascata por regra, extrai `usage` e o modelo da transcrição e acrescenta campos `tentativa`, `escalonou` e `falha_infra` reais.

### I2. A fase B não tem controle concorrente
`plano-execucoes.json`: toda a fase A ocupa as ordens 1 a 90, toda a fase B as ordens 91 a 138. Os comparadores das 8 condições da fase B (C1 e C4, repetições 1 a 3) foram coletados antes. Mudança no que o apelido resolve, carga do serviço, limites da assinatura e deriva do orquestrador se confundem com o efeito de H3, H5, H10 e H11. O mesmo C1 serve de comparador para seis condições (C2, C2n, C6, C10 a C13), e as comparações ficam correlacionadas.
**Correção:** sortear a fase B junto com a A, ou rodar dentro da fase B um C1 e um C4 novos nas duas variantes, intercalados, e usá-los como comparadores.

### I3. Rubrica e juízes não estão pré-registrados, e o desenho dos juízes é frágil
O texto da rubrica (C1 a C7, T1 a T5), as âncoras, o prompt do juiz e o material que o juiz recebe (contrato enxuto ou completo? código do h3, para conferir as citações?) não aparecem em nenhum arquivo lido nem no manifesto. Os "3 juízes" são três amostras do mesmo modelo com o mesmo prompt: o alfa de Krippendorff entre eles mede consistência de amostragem, não confiabilidade entre avaliadores, e com notas concentradas o alfa cai mesmo com concordância alta (paradoxo da prevalência), o que leva a hipótese a `subpotente` sem relação com a qualidade. O estilo do Sonnet e o do Haiku são reconhecíveis, e uma TechSpec da C4 cita TDD. Os artefatos mudam entre etapas (no piloto, "agente editou a premissa do PRD"), e `finish` copia a versão final de `sdd/`, não a saída de cada etapa. Volume: cerca de 11 condições × 6 × 2 artefatos × 3 juízes ≈ 396 chamadas de Opus, fora do cálculo de limite da assinatura.
**Correção:** congelar a rubrica, o prompt do juiz e o material de entrada no manifesto; guardar uma cópia com hash de cada artefato logo depois da sua etapa; normalizar a formatação antes do juiz; calibrar com uma amostra pequena avaliada às cegas pelo autor; incluir as chamadas dos juízes no plano de limites.

### I4. O tamanho de amostra das hipóteses de rubrica não foi calculado
O piloto não avaliou nenhum artefato com a rubrica. O piloto.md justifica "3 repetições" para H1, H3, H5, H10 e H11 com o CV de tokens (que, além disso, é artificial, ver B3). Por braço ficam n = 6 (2 features × 3 repetições). O bootstrap da mediana com 3 valores por estrato só assume poucos valores e tem cobertura ruim.
**Correção:** avaliar agora os 24 artefatos (TechSpec e Tasks) das 12 execuções do piloto com a rubrica e os juízes finais, estimar o desvio-padrão e recalcular o poder para 3 ou 4 pontos. Usar a média dos juízes por artefato e um teste de permutação estratificado por feature em vez do bootstrap da mediana com n = 3.

### I5. Regras de decisão incoerentes entre hipoteses.json e analise-plano.md
- H4 e H5 têm limiares de **não inferioridade** ("≥ Sonnet − 10 pp"; "≥ 0,90"), mas o analise-plano manda TOST bilateral, e a H5 tem margem de 0,90 a 1,10. Uma cascata melhor que o Sonnet (razão > 1,10) sairia "não equivalente".
- H6 tem três regras diferentes: "refutada se o limite inferior > 0,50" (hipoteses), "confirmada se o limite superior < limiar" (analise) e "de 0,45 a 0,55 exige mais amostra".
- H1: não está claro se "≥ 3 pontos" se aplica à estimativa pontual ou ao limite do IC. A hipótese também exige TechSpec **e** Tasks: são dois testes contados como um no Holm.
- H11: 3 variantes × 2 desfechos ligados por "ou", tudo contado como uma hipótese no Holm.
- Holm sobre decisões por IC não diz qual nível de IC usar em cada passo.

**Correção:** um quadro único por hipótese com o teste (unilateral ou bilateral), o nível de IC ajustado por passo de Holm (ou Bonferroni para os ICs) e a regra de confirmação. Desdobrar H1 (2 desfechos) e H11 (3 contrastes × 1 desfecho principal) em subhipóteses dentro da família.

### I6. Documentos congelados contradizem uns aos outros
- premissa.md exige "nenhuma [hipótese] fica pendente ou subpotente", mas o plano admite H8 "não mensurável" e H2, H7, H9 na fase C "não testados". O status "não testado" não está entre os permitidos, e não se diz como ele entra na família de Holm.
- "Pronto para produção" é "100% dos testes de aceite ocultos" na premissa, e "100% do núcleo" no plano.
- A premissa diz que os braços S8 a S11 "rodam em paralelo"; o plano os põe na fase C, em fila.
- O plano fala em "300 a 350 execuções"; o arquivo tem 138. A ordem deveria estar em `dados/bruto/ordem.json`, mas está em `plano-execucoes.json`, e `harness.py ordem` reembaralha um plano que já foi sorteado.
- dicionario.md aceita repeticao de 1 a 5; o plano usa 6. A regra de parada "estende até 5" é incompatível com a base de 6. O analise-plano ainda diz "3 por condição".
- Documentos com hash no manifesto continuam com cabeçalhos "Rascunho", "aguardando a aprovação do autor", e as 11 hipóteses com "Proposta aguardando revisão do autor".
- A H4 exige `tsc` **e lint** limpos, mas `score()` não roda lint.
- validade.md está todo em TODO.
- A premissa põe "as 12 hipóteses candidatas" fora do escopo, mas H7 a H10 vêm das candidatas C3, C4, C8 e C9.

**Correção:** um adendo datado que alinha tudo, seguido de um novo manifesto.

### I7. O núcleo foi definido depois de ver o piloto
E2, E3 e E4 falharam no piloto e foram para observação, junto com outros testes que o rastreio considerou indeterminados. O critério é razoável, mas a escolha do desfecho foi informada pelo resultado, e o contrato enxuto que justifica a reclassificação nunca foi pilotado (B5). Além disso, os núcleos têm tamanhos diferentes (#1050: 6 IDs; #1384-A: 7; #1384-C: 8; #1267: 14 ou mais), então "passar 100%" não tem a mesma dificuldade entre variantes.
**Correção:** declarar a sequência dos fatos no pré-registro; reportar sempre, ao lado, a análise com todos os testes; pré-registrar o resultado por feature.

### I8. Configuração dos agentes não controlada
`modelo_efetivo` = "nao informado" em 52 de 52 linhas. Esforço e pensamento estendido padrão podem diferir entre Haiku e Sonnet. O conjunto de ferramentas herdado (com as de sessão, que o Haiku tentou usar) e o CLAUDE.md do blog-tech entram no contexto de todas as condições sem controle. A premissa diz que só o CLAUDE.md e o AGENTS.md do h3 entram.
**Correção:** nas execuções headless, fixar o modelo pelo ID completo, o esforço e as ferramentas, e gravar o `message.model` de cada resposta.

### I9. O controle da H11 não casa com os braços
C13 tem 136 palavras. C11 tem 161, C10 tem de 14 a 30 por etapa, e C12 de 175 a 190. O controle só iguala (de longe) o C11. O C11 repete os critérios dos gates e, provavelmente, da rubrica ("cita arquivo e linha reais, justifica cada decisão com alternativas e lista riscos"): é ensinar para a prova, não "contexto do domínio". A persona de código cita "HTTP, sessões e segurança" e favorece a #1050-b.
**Correção:** um controle por comprimento para cada braço (ou casar C13 com C12 e criar um C10n curto); tirar do C11 os critérios da rubrica; persona de código neutra quanto à feature.

### I10. Riscos operacionais da fila de 138 execuções
- **Memória:** o piloto registrou de 1,1 a 2,3 GB livres antes das etapas (de 15,6 GB). Uma suíte vitest completa mais o typecheck nessas condições pode falhar por memória, e as falhas podem se concentrar em certas horas ou condições.
- **Limites da assinatura:** o consumo real é várias vezes o registrado (B3), e ainda há cerca de 396 chamadas de Opus para os juízes e o próprio orquestrador. Um limite atingido no meio de uma etapa pode produzir um artefato truncado que, pela regra de intenção de tratar, conta como falha do modelo.
- **Retomada e retentativa:** o id é fixo (`C0-range-1267-r1`). Uma retentativa esbarra no `prep` ("já existe"), mistura arquivos em `dados/bruto/<id>` e duplica linhas no `execucoes.jsonl`. `proxima()` dá por feita qualquer execução com `score.json`, mesmo com auditoria suja ou falha de infraestrutura.
- As transcrições ficam no `%TEMP%` e não são copiadas.

**Correção:** id com tentativa (`...-r1-t2`); regra pré-registrada que classifica "limite de uso ou truncamento" como falha de infraestrutura (detectada pela transcrição); fechar o Chrome e conferir a memória livre (≥ 4 GB) antes de cada execução, com abortar e refazer; `proxima()` consultando também `auditoria.json` e uma marca `concluida`; cópia das transcrições.

### I11. As exclusões por auditoria podem enviesar a comparação
As execuções com vazamento são excluídas, mas as falhas do modelo contam como reprovação (intenção de tratar). Se uma condição vaza mais (o Haiku explora mais sem `path`), a exclusão tira dela justamente as execuções em que ela buscou ajuda, e o viés vai numa direção desconhecida.
**Correção:** reportar as exclusões por condição e uma análise de sensibilidade que conta cada exclusão como reprovação; se as taxas de exclusão diferirem, a hipótese afetada fica `subpotente`.

---

## MENORES

1. **Desequilíbrio temporal na fase A:** o C1 aparece 7, 7 e 4 vezes nos terços da fila; o C4, 13, 8 e 15. Uma aleatorização em blocos (cada bloco com todas as células) evitaria isso.
2. **O manifesto não cobre** `tools/harness/enunciados/issue-*.md` (texto entregue aos modelos), a rubrica, o prompt do juiz, `gabarito-rascunho.md` e os scripts de análise (`analise/` está vazia: nada do código de análise foi congelado).
3. **As linhas do piloto** em `execucoes.jsonl` não têm `descartar: true` (só o aquecimento tem). O script de análise precisa excluí-las pelo prefixo do id, e isso deveria estar escrito.
4. **O agente pode editar ou apagar testes existentes** ("ajuste só os testes existentes..."), e `suite_completa` passa a não provar "não quebrar". Registrar o diff em `test/` à parte e rodar a suíte original do commit base contra o `src` modificado.
5. **O aquecimento** foi feito só na #1267; o plano promete "uma por variante".
6. **A H8 aparece na família secundária de Holm** apesar de declarada não mensurável. Tirá-la antes do congelamento.
7. **`decrypt()` cai para `GAB/<nome>` em texto claro** se o `.enc` faltar. Durante a coleta, isso deveria ser um erro, não uma alternativa silenciosa.
8. **"Percentual de tarefas"** (H4) é ambíguo com as "Tasks" T-NN; usar "execuções".
9. **Repetições 1 a 3 do C4** são escolhidas como comparadoras da fase B sem critério declarado. Usar as 6 ou sortear.

---

## Resumo (bloqueantes e importantes)

- **B1** A auditoria de vazamento é vazia: as 52 transcrições registradas têm 0 bytes, e o "limpo" do piloto não vale. Auditar o JSONL real e fazer a auditoria falhar com arquivo vazio.
- **B2** O gabarito em texto claro (gabarito-rascunho, rastreio, contratos completos, diffs do piloto, .git) está ao alcance dos subagentes, que começam em `blog-tech` e têm web e git. Rodar headless isolado em `C:\dev\runs\<id>`, com ferramentas restritas, e tirar esse material do disco.
- **B3** `tokens_totais` é o tamanho final do contexto, não o consumo. As três proporções de entrada e saída dão a mesma razão (preço de 1/20 nas duas), e o cache e o tier acima de 100 mil são ignorados. Extrair o `usage` por mensagem.
- **B4** H6 (e o custo da H5) já está confirmada pela tabela de preços. Tornar descritiva ou fixar um limiar informativo.
- **B5** A H4 satura (C1 também passa 100%), o contrato enxuto não foi pilotado, e com o bootstrap qualquer resultado perfeito vira "equivalente". Usar Newcombe unilateral, checagem de sensibilidade e mini-piloto com o contrato enxuto.
- **B6** Um arquivo oculto que não carrega some do núcleo e pode dar 100%. Usar a lista esperada de IDs e contar os ausentes como falha.
- **B7** Os gates nunca reprovaram (C2 ≡ C1, C5 ≡ C4), e o C4 executado não tem voto. Endurecer os gates ou declarar H3 e a cascata não testáveis.
- **I1** a **I11**: orquestrador contaminado e manual; fase B sem controle concorrente; rubrica e juízes não congelados e não independentes; poder da rubrica não calculado (os 24 artefatos do piloto servem para isso); regras unilateral × bilateral e Holm incoerentes; documentos congelados contraditórios (incluindo o lint nunca rodado); núcleo definido depois do piloto; modelo e esforço não registrados; controle da H11 desigual e o C11 ensina a rubrica; memória, limites e retomada frágeis; exclusões por auditoria possivelmente diferenciais.
