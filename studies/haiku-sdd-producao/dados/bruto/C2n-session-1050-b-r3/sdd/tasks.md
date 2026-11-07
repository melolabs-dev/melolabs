# Tarefas de implementação — Múltiplas senhas de unseal nas sessões (h3js/h3#1050)

Base: `sdd/prd.md` (RF-01 a RF-11) e `sdd/techspec.md` (decisões D-01 a D-10).

Antes de começar, reconferir os números de linha da techspec no código (T-02). Eles estão defasados: por exemplo, `getSession` está na linha 149 de `src/utils/session.ts`, e a techspec diz 194. As tarefas referenciam funções e símbolos, não linhas.

Ordem geral: primeiro o ajuste do PRD (T-01) e a linha de base dos testes (T-02). Depois os testes novos (T-03 a T-06). Só então a implementação (T-07 a T-11), e só depois que a equipe tiver confirmado as decisões do gate abaixo. Por fim, verificação (T-12 a T-13).

## Gate de decisões da equipe

Estas decisões precisam de confirmação antes de T-07. Até lá, T-01 pode escrever a recomendação, mas marcada como "proposta", não como decidida.

- **D-06:** validação de tamanho das senhas extras lança erro (em vez de só documentar).
- **D-07:** sem limite no código; recomendação de 3 senhas fica no JSDoc.
- **D-08:** a regravação renova `lastSeenAt` antes da metade da janela de inatividade.
- **D-10:** rotação em duas fases, com três deploys (A, B e C).

Se a equipe recusar alguma delas, a tarefa afetada volta para a techspec antes de mexer no código.

## Rastreabilidade

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-03, T-07 |
| RF-02 | T-03, T-10 |
| RF-03 | T-03, T-09 |
| RF-04 | T-04, T-08, T-10 |
| RF-05 | T-03, T-06, T-09 |
| RF-06 | T-02, T-09 |
| RF-07 | T-05, T-09 (ordem do código), T-11 |
| RF-08 | T-05, T-09 |
| RF-09 | T-08, T-12 |
| RF-10 | T-01, T-13 |
| RF-11 | T-07 |

---

### T-01 — Corrigir o PRD com as divergências da techspec

**Cobre:** RF-06, RF-07, RF-08, RF-10, "Procedimento de rotação", "Riscos", "Decisões pendentes"

**Depende de:** nenhuma

**Aceite:**
- Todas as ocorrências de `rejectLegacySeal` em `sdd/prd.md` viram `legacySealFallback`: RF-06, RF-08 (três trechos), "Riscos" e "Fora de escopo". Conferir com uma busca por texto no arquivo depois da edição.
- RF-10 e "Decisões pendentes" 5 dizem que `pnpm lint` e `pnpm typecheck` são comandos separados. O lint não inclui o typecheck.
- "Riscos" descreve o custo real: o legado custa uma derivação de 1 iteração, e o custo dominante é de `N + 1` derivações de 8192 iterações.
- RF-07 diz que a regravação por senha extra pode renovar `lastSeenAt` antes da metade da janela de inatividade (D-08), e que `maxAge` não é estendido. Essa redação fica como proposta até o gate.
- "Procedimento de rotação" passa a ter as duas fases do D-10. Deploy A: `password` antiga, extra nova. Deploy B: `password` nova, extra antiga. Deploy C: remoção da antiga.
- A janela de remoção da senha antiga conta a partir do **deploy B**, não do deploy que adicionou a senha nova (deploy A). Motivo: é no B que o selo muda, e as sessões seladas com a antiga expiram até `maxAge` depois dele. Corrigir também o passo 3 e o JSDoc (T-07) para dizer a mesma coisa.
- As pendências 1, 3 e 5 aparecem como decididas, com referência à techspec (seção 9). A 6 aparece como decidida só depois do gate. As 2 e 4 continuam abertas, porque dependem de D-06 e D-07.
- Sem `maxAge`, a janela não tem fim. Fica explícito que a remoção é decisão manual.

**Arquivos:** `sdd/prd.md`

---

### T-02 — Confirmar a cobertura da suíte existente (linha de base)

**Cobre:** RF-06, RF-10

**Depende de:** nenhuma

**Aceite:**
- Reconferir no código os números de linha citados na techspec (seções 0, 1 e 3) antes de editar qualquer arquivo. Anotar as diferenças no PR, se houver.
- `pnpm vitest run test/session.test.ts` passa antes de qualquer mudança no código. Essa é a linha de base. Se falhar, parar: o problema é anterior a esta feature.
- Os caminhos de unseal estão cobertos pela suíte existente, ou com casos novos adicionados nesta tarefa:
  - legado, com e sem `legacySealFallback: false`;
  - `idleTimeout`;
  - `maxAge`;
  - sessão vinda do header.
- Sessão de header com cookie legado: a techspec aponta que não há cobertura. Acrescentar esse caso antes da mudança (risco "Regressão silenciosa" do PRD).
- Nenhuma asserção existente é alterada. O diff só tem adições.

**Arquivos:** `test/session.test.ts`

---

### T-03 — Testes de abertura por senha extra e validação da lista

**Cobre:** RF-01, RF-02, RF-03, RF-05, D-06

**Depende de:** T-02

**Aceite:**
- Novo `describe("extraUnsealPasswords", ...)` dentro de `describeMatrix("session", ...)`, antes do `});` final, com estes casos. Cada caso diz se falha hoje ou se é controle (passa hoje, porque o comportamento atual já satisfaz o requisito):
  - Cookie selado com a senha atual, com extras configuradas: dados iguais e `getSetCookie()` vazio (RF-02). **Controle.**
  - Cookie selado com a 1ª extra: `getSession` devolve os dados (RF-03). **Falha hoje.**
  - Cookie selado com a 2ª extra, sem a 1ª casar: abre na 2ª, sem erro (RF-03). **Falha hoje.**
  - Cookie selado com a senha atual, também presente em extras: abre na primeira tentativa, sem `Set-Cookie` (RF-03). **Controle.**
  - Cookie selado com `"C..."`, que não está na lista: sessão vazia, sem exceção e sem entrada em `ctx.errors`, igual a cookie inválido (RF-05). **Controle.**
  - Extra vazia (`""`) ou curta (`"123"`): `unsealSession` lança `Error` com o índice da entrada; `getSession` devolve sessão vazia (D-06). **Falha hoje.**
  - Duas extras, cookie da segunda, com legado: abre na 2ª (RF-03, D-04). **Falha hoje.** Este caso também é coberto em T-05; manter aqui só a parte de ordem, sem o legado.
  - `password` do tipo `string` continua aceito, com `extraUnsealPasswords` presente (RF-01). **Controle.**
- Para os casos de controle, anotar no código do teste que são controle. Eles servem para mostrar que a mudança não quebra o caminho atual.
- Rodar a suíte antes da implementação: os casos marcados como "falha hoje" precisam falhar pelo motivo esperado (cookie não aberto), não por erro de sintaxe ou de setup. A saída é guardada para o PR.

**Arquivos:** `test/session.test.ts`

---

### T-04 — Testes de regravação com a senha atual

**Cobre:** RF-04, D-02, D-03, D-10

**Depende de:** T-02

**Aceite:**
- Cookie aberto por extra recebe um `Set-Cookie` com selo novo. Descriptografar com `unseal(…, password, sealDefaults)` e conferir os dados (RF-04). **Falha hoje.**
- Na requisição seguinte, a configuração sem extras abre o cookie: dados iguais e sem `Set-Cookie` (convergência, RF-04). **Falha hoje.**
- Cookie no header (`x-h3-test-session`, conferir o nome real do header em `test/session.test.ts`) selado com extra: dados devolvidos e sem `Set-Cookie` (D-03). **Falha hoje.**
- Configuração de deploy A (`password` antiga, extra nova) abre cookie selado com a senha nova: dados devolvidos (D-10). **Falha hoje.**
- Configuração antiga (sem extras) rejeita cookie selado com a senha nova: sessão vazia. Esse teste documenta por que o deploy A é necessário (D-10). **Controle.**
- Marcadores não vazam (D-02). **Atenção:** o teste precisa primeiro abrir o cookie com a extra e conferir que os dados voltaram. Sem essa asserção positiva, ele passa hoje por vacuidade (sessão vazia, em qualquer caso). Depois, conferir que a sessão devolvida não tem os símbolos `kOpenedByExtraPassword` nem `kLegacySeal`, e que o JSON da resposta não contém dados internos.
- Nenhum teste nesta tarefa cobre "sem resposta onde gravar" (RF-04). `H3Event.res` sempre existe (techspec, seção 1), então esse caminho não é atingível por teste. Ver T-10.

**Arquivos:** `test/session.test.ts`

---

### T-05 — Testes de expiração e de legado com senha extra

**Cobre:** RF-07, RF-08, D-08

**Depende de:** T-02

**Aceite:**
- Cada teste de expiração tem **par positivo**: o mesmo cookie selado com a extra, sem expirar, precisa devolver os dados. Só o par negativo (expirado, sessão vazia) não basta, porque hoje a extra é ignorada e o cookie nem abre. Sem o par positivo, o teste passa por vacuidade.
  - Cookie selado com extra e `createdAt` além de `maxAge`: sessão vazia. Usar `vi.useFakeTimers`, como no teste de `test/session.test.ts` que já usa `maxAge` (RF-07). Par positivo: mesma configuração, sem avançar o tempo, devolve os dados. **Negativo passa hoje por vacuidade; positivo falha hoje.**
  - Cookie selado com extra e `lastSeenAt` além de `idleTimeout`: sessão vazia, com par positivo do mesmo jeito (RF-07).
- Regravação de cookie extra com `idleTimeout` ativo: o `lastSeenAt` do novo selo é a hora da requisição (RF-07, D-08). **Falha hoje.**
- Cookie legado selado com extra, sem `legacySealFallback` (padrão): aberto e regravado com as iterações atuais (RF-08). **Falha hoje.**
- Cookie legado selado com extra, com `legacySealFallback: false`: rejeitado, sem `Set-Cookie`. Par positivo: mesmo cookie, sem a flag, abre. **Negativo passa hoje por vacuidade; positivo falha hoje.**
- Os testes de expiração negativos que passam hoje por vacuidade são registrados no PR como tal, para que o revisor saiba que o par positivo é o que de fato prova a expiração.

**Arquivos:** `test/session.test.ts`

---

### T-06 — Testes do erro relançado quando nenhuma senha abre

**Cobre:** RF-03, RF-05, D-05

**Depende de:** T-02

**Aceite:**
- Cookie com prefixo inválido: `unsealSession` rejeita com a mensagem de prefixo, não com `"Bad hmac value"` (D-05). **Controle.**
- Cookie selado com `"C..."`, em que nenhuma senha abre: `unsealSession` rejeita com `"Bad hmac value"`, a mesma mensagem de hoje (techspec, seção 10). **Controle.**
- A garantia de que um erro que não é `"Bad hmac value"` não avança para a próxima senha **não é testada por comportamento**. `vi.spyOn` em export ESM não é confiável, e nenhum resultado observável distingue as duas situações. A garantia fica como item de revisão de código em T-09 (ordem de `isBadHmac` e `throw`), e é conferida no PR.

**Arquivos:** `test/session.test.ts`

---

### T-07 — Campo `extraUnsealPasswords` em `SessionConfig`, com JSDoc

**Cobre:** RF-01, RF-11, D-06, D-07, D-08, D-10

**Depende de:** T-03, T-04, T-05, T-06, **gate de decisões** (ver acima)

**Aceite:**
- `SessionConfig` tem `extraUnsealPasswords?: string[]`. `password` continua `string` (RF-01).
- O JSDoc, em inglês como o resto da interface, diz:
  - as senhas só abrem sessões e nunca selam;
  - são tentadas na ordem declarada, depois de `password`;
  - sessões abertas por elas são regravadas com `password` (só cookie);
  - remover depois de `maxAge` desde o **deploy em que `password` passou a ser a senha nova (deploy B do D-10)**. Sem `maxAge`, a remoção é decisão manual.
- A redação do JSDoc não pode dizer "desde o deploy que adicionou a senha nova": no D-10 essa senha entra como extra no deploy A, e a janela só começa no B. A techspec (seção 4.1) tem essa mesma frase e precisa ser corrigida junto.
- O JSDoc não tem `@default`.
- `pnpm typecheck` passa.

**Arquivos:** `src/utils/session.ts`

---

### T-08 — Símbolo interno `kOpenedByExtraPassword`

**Cobre:** RF-04, RF-09

**Depende de:** T-04

**Aceite:**
- `src/utils/internal/session.ts` exporta `kOpenedByExtraPassword`, com o mesmo formato de `kLegacySeal` (`Symbol.for("h3.internal.session.extra-unseal")`).
- O símbolo não é exportado por `src/index.ts` nem pelos subpaths (RF-09).
- `src/index.ts` não muda.

**Arquivos:** `src/utils/internal/session.ts`

---

### T-09 — Loop de tentativas em `unsealSession`

**Cobre:** RF-03, RF-05, RF-06, RF-07, RF-08, D-04, D-05, D-06

**Depende de:** T-07, T-08

**Aceite:**
- `unsealSession` percorre `[config.password, ...(config.extraUnsealPasswords || [])]` na ordem e para na primeira senha que abrir o cookie (D-01, RF-03).
- Validação no início, antes do loop: senha extra com menos de `sealOptions.encryption.minPasswordlength` caracteres lança `Error` com o índice (D-06). `getSession` continua engolindo o erro. A mensagem inclui o índice, para que o operador saiba qual entrada corrigir.
- Helper interno `unsealWithPassword(sealed, password, sealOptions, legacyAllowed)`: contém a lógica atual de formato atual e depois legado (D-04, RF-08). `legacyAllowed` é `config.legacySealFallback !== false`.
- **Na tentativa com senha, se o formato atual falhar e o legado também falhar, `unsealWithPassword` relança o erro do formato atual, não o do legado.** Sem isso, a mensagem final deixa de ser `"Bad hmac value"` quando a senha não confere.
- Helper interno `isBadHmac(error)`: só `"Bad hmac value"` passa para a próxima senha. Qualquer outro erro é relançado na hora, antes de tentar a senha seguinte (D-05). Conferir na revisão de código que o `throw` vem antes de qualquer `continue`.
- Se nenhuma senha abrir, relança o primeiro erro guardado, que é `"Bad hmac value"`.
- Usa um flag `opened: boolean`, não checagem de `unsealed`, porque `unseal` pode devolver `null` (techspec, 4.2).
- Marca `kOpenedByExtraPassword` só quando o índice aberto é maior que 0. Sem `extraUnsealPasswords`, não há marcador extra (RF-06).
- Sem `extraUnsealPasswords` (ou `[]`), o resultado é igual ao de hoje: mesma ordem, mesmo legado, mesma mensagem (RF-06).
- A expiração (`maxAge` e `idleTimeout`, em `unsealSession` depois do loop) continua aplicada ao resultado de qualquer senha, sem bloco novo (RF-07). Ver T-11.
- Assinatura pública de `unsealSession` não muda.
- Testes de T-03, T-05 (legado e positivos de expiração) e T-06 passam.

**Arquivos:** `src/utils/session.ts`

---

### T-10 — Regravação e limpeza do marcador em `getSession`

**Cobre:** RF-02, RF-04, D-02, D-03

**Depende de:** T-09

**Aceite:**
- Em `getSession`, ler `kOpenedByExtraPassword` e apagá-lo antes de `Object.assign(session, unsealed)`, do mesmo jeito que já é feito com `kLegacySeal` (D-02, techspec 4.5). Os dois marcadores são lidos antes de qualquer `delete`.
- A condição de regravação passa a ser `session.id && sessionFromCookie && (legacySeal || extraSeal || shouldSlide(session, config))` (D-03).
- Sessão vinda do header nunca recebe `Set-Cookie` (D-03). Coberto em T-04.
- Cookie selado com a senha atual continua sem `Set-Cookie` (RF-02). Coberto em T-03.
- "Se não houver resposta onde gravar, a sessão continua válida" (RF-04): **não é testável**, porque `H3Event.res` sempre existe (techspec, seção 1). A garantia é conferida por leitura de código: a escrita passa por `updateSession`, e nada nesta tarefa pode lançar quando a escrita não tem efeito. Registrar essa conferência no PR.
- Testes de T-04 passam.

**Arquivos:** `src/utils/session.ts`

---

### T-11 — Expiração igual para qualquer senha

**Cobre:** RF-07, D-08

**Depende de:** T-09

**Aceite:**
- Esta tarefa não tem código próprio. A verificação de `maxAge` e `idleTimeout` já fica depois do loop em T-09. Esta tarefa só confirma, na revisão, que essa ordem foi mantida e que nenhum bloco de expiração foi duplicado dentro de `unsealWithPassword`.
- Testes de expiração de T-05 passam, incluindo os pares positivos.
- A extensão de `lastSeenAt` pela regravação é aceita (D-08, gate). `maxAge` não é estendido, porque `createdAt` não muda.

**Arquivos:** `src/utils/session.ts` (somente revisão)

---

### T-12 — Verificar a superfície pública

**Cobre:** RF-09, D-09

**Depende de:** T-10

**Aceite:**
- Nenhum export novo em `src/index.ts`. A única adição pública é o campo `extraUnsealPasswords` em `SessionConfig` (RF-09).
- `pnpm vitest run test/unit/package.test.ts` passa (lista de exports públicos em tempo de execução). Esse teste não vê campos de tipo, então a checagem do campo fica na revisão do diff.
- Nenhum símbolo novo exportado de `src/utils/internal/session.ts` para além de `kOpenedByExtraPassword`, e nenhum desses símbolos aparece em `src/index.ts`.
- `iron-crypto.ts`, `package.json`, `docs/` e `AGENTS.md` não mudam (D-09).

**Arquivos:** `test/unit/package.test.ts`, `src/index.ts` (apenas conferido, sem mudança)

---

### T-13 — Verificação final e medição de custo

**Cobre:** RF-10, D-07

**Depende de:** T-10, T-11, T-12

**Aceite:**
- `pnpm lint` passa.
- `pnpm typecheck` passa.
- `pnpm vitest run test/session.test.ts` passa, sem alteração de asserção nas partes existentes (RF-06, RF-10).
- `pnpm test` (com cobertura) passa antes de abrir o PR.
- Medição de custo com 0, 1 e 3 extras (techspec, seção 6, pendência 4). **Decisão de como medir:** `test/bench/bench.ts` não tem parâmetro de número de extras, e D-09 não quer mudança fora de `src/utils/session.ts` e `src/utils/internal/session.ts`. Portanto: não alterar o bench. Rodar `pnpm bench:node` como está e, para as variações de extras, usar um script temporário fora do repositório (na pasta de scratchpad), que não entra no PR. Se o resultado não puder ser obtido assim, registrar no PR que a medição com extras ficou pendente, em vez de mudar o bench.
- Os números vão para o PR, para definir o limite recomendado (techspec, seção 6, pendência 4).
- A lista de conferência da techspec (seção 10) é verificada e registrada no PR, item por item.

**Arquivos:** nenhum arquivo do repositório muda nesta tarefa, exceto `test/session.test.ts`, se houver ajuste de T-02 a T-06.

---

## Fora desta lista

- `docs/2.utils/4.security.md:60`: linha sobre a lista de senhas extras. Fica para a próxima rodada, porque a documentação pública está fora de escopo (RF-11, seção "Fora de escopo" do PRD).
- Correção do `AGENTS.md:18` (ele diz que `pnpm lint` inclui o typecheck): mudança separada.
- Decisões do gate (D-06, D-07, D-08, D-10): ver seção "Gate de decisões da equipe" no início. Esta lista não substitui a confirmação da equipe.
- Rollback (techspec, seção 7, item 5): não é tarefa de código. Vai para o texto de release, com a regra de que o código antigo só é seguro antes do deploy B.
