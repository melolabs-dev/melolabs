# Tarefas de implementação — Várias senhas de unseal nas sessões (#1050-b)

Referências: `sdd/pedido.md` (contrato), `sdd/prd.md` (RF-01 a RF-10), `sdd/techspec.md` (decisões D-01 a D-08, seção 6 de testes e seção 8 de pendências). Antes de T-01, confirmar que as três referências existem; `sdd/pedido.md` não aparece no status inicial do repositório.

Ordem de trabalho: primeiro a baseline (T-01), depois os testes que provam a funcionalidade (T-02 a T-09), depois a confirmação de que eles falham antes da mudança (T-10), só então a implementação (T-11 a T-15), e por fim a verificação e o PR (T-16 e T-17). Medição de desempenho (`prd.md:170`) fica fora das tarefas, como pede o PRD.

Em todos os testes novos, as senhas reais têm 32 caracteres ou mais (techspec, seção 6). Os nomes entre aspas nas tarefas abaixo (`"senha-antiga"`, `"senha-nova"`, `"senha-outra"`) são rótulos ilustrativos: nos testes, use strings de 32+ caracteres, com a única exceção da extra curta de T-07.

---

### T-01 — Registrar a baseline antes de qualquer edição

Cobre: RF-05, RF-08, RF-10
Depende de: nenhuma

Antes de editar qualquer arquivo:

- Confirmar que as referências existem e reconferir os `arquivo:linha` citados na seção 2 do techspec, anotando as diferenças, se houver.
- Confirmar que `pnpm typecheck` inclui `test/session.test.ts`, porque T-02 depende disso.
- Capturar, no código atual, os valores de referência para RF-05 e D-03: corpo, cabeçalhos (inclusive `Set-Cookie`) e erros de `getSession`/`useSession` com cookie válido, com senha errada e com configuração sem `extraUnsealPasswords`, com `undefined` e com `[]`; e o tipo e a mensagem do erro de `unsealSession` direto com senha errada. Os valores ficam num objeto de constantes em `test/session.test.ts`, usado por T-06.
- Listar os canais de log que `src/` usa (`console.*` e qualquer outro), para T-07.
- Anotar a contagem atual de testes de `test/session.test.ts`, para comparar em T-17.
- Rodar `pnpm build` e guardar cópia de `dist/*.d.mts` fora de `src/` e `test/`, em pasta temporária não versionada, para a comparação de T-16.

Aceite: os valores de referência, a lista de canais de log, a contagem de testes e a cópia de `dist/*.d.mts` existem antes de qualquer alteração em `src/` ou `test/`. Nenhum arquivo versionado é alterado nesta tarefa; `dist/` é saída de build e não entra no commit.

Arquivos: `dist/*.d.mts` (leitura, cópia de baseline fora do repositório), `test/session.test.ts` (leitura)

---

### T-02 — Teste de tipo: `extraUnsealPasswords` em `SessionConfig`

Cobre: RF-01
Depende de: T-01

Adicionar em `test/session.test.ts` uma constante tipada como `SessionConfig` com `password` e `extraUnsealPasswords: ["senha-antiga"]`, e outra sem o campo, para provar que as duas compilam.

Aceite: `pnpm typecheck` falha antes da implementação, porque a propriedade não existe em `SessionConfig`. Depois de T-11, passa, e a configuração sem o campo continua compilando.

Arquivos: `test/session.test.ts`

---

### T-03 — Testes de abertura com senha extra

Cobre: RF-02, D-06
Depende de: T-01

Adicionar o bloco de testes de abertura em `test/session.test.ts`, dentro de `describeMatrix`:

- Cookie selado com a senha antiga, configuração com `password` nova e `extraUnsealPasswords` com a antiga: `getSession` devolve o mesmo corpo que devolveria com a antiga como única senha.
- Com a senha atual correta, a extra não é tentada: a contagem de chamadas a `crypto.subtle.deriveBits` (spy com `mockRestore()` no `finally`) é igual à de uma requisição sem extras.
- Extra certa depois de extra errada: a contagem é igual à de uma requisição com a senha atual correta (baseline) mais uma tentativa com HMAC inválido.
- Extra igual a `password` (D-06): sem erro e sem derivação extra; a contagem é igual à de uma requisição sem extras.

Comparar contagens relativas, não valores absolutos (techspec, seção 6).

Aceite: os casos 1 e 3 falham antes da implementação. Os casos 2 e 4 passam antes, por serem preservação: sem a lógica nova, nenhuma extra é tentada, então a contagem não muda. Registrar isso em T-10.

Arquivos: `test/session.test.ts`

---

### T-04 — Testes de selagem sempre com `password`

Cobre: RF-03
Depende de: T-01

Adicionar testes em `test/session.test.ts` em que uma nova sessão criada com `useSession` e com `sealSession`, usando `password` nova e `extraUnsealPasswords` com a antiga, só abre com a senha nova e não abre com a antiga (`unseal` direto nas duas senhas, padrão de `test/session.test.ts:157`).

Aceite: os testes passam antes da implementação, porque `sealSession` já usa `config.password` (techspec, D-05). Isso é esperado e fica registrado em T-10. Depois de T-13, continuam passando.

Arquivos: `test/session.test.ts`

---

### T-05 — Testes de migração ao ler a sessão

Cobre: RF-04
Depende de: T-01

Adicionar testes em `test/session.test.ts`:

- `getSession` com cookie selado com a senha antiga devolve um `Set-Cookie` que abre com a senha nova e não abre com a antiga.
- Segunda leitura desse cookie regravado não gera `Set-Cookie` (`headers.getSetCookie()` vazio). Este caso só vale junto com o anterior: sem a regravação, a segunda leitura também não gera nada e o teste passaria por engano. Por isso, o teste deve primeiro afirmar que a primeira leitura gerou `Set-Cookie`.
- Sessão lida pelo header com senha extra: o corpo deve estar presente (a sessão abre) e não pode gerar `Set-Cookie` (D-07).
- Resposta com cabeçalhos já enviados: a sessão continua válida, nenhuma exceção é lançada e a migração fica para a próxima leitura (`prd.md:65`).

Aceite: os três primeiros casos falham antes da implementação. O caso de cabeçalhos enviados depende do comportamento de `updateSession` que T-15 confirma; o resultado antes da implementação fica registrado em T-10 como preliminar.

Arquivos: `test/session.test.ts`

---

### T-06 — Testes de preservação sem senhas extras

Cobre: RF-05, D-03
Depende de: T-01

Adicionar testes em `test/session.test.ts` que comparam, para `extraUnsealPasswords` ausente, `undefined` e `[]`, o corpo, os cabeçalhos e os erros com os valores de referência de T-01. Incluir também o teste de `unsealSession` direto com senha errada, que compara tipo e mensagem do erro com o valor de referência.

Aceite: os testes passam antes e depois da implementação. Sem os valores de T-01, o teste não prova nada, então não pode usar valores inventados.

Arquivos: `test/session.test.ts`

---

### T-07 — Testes de falha com todas as senhas

Cobre: RF-06, D-08
Depende de: T-01

Adicionar testes em `test/session.test.ts`:

- Cookie selado com uma terceira senha, configuração com `password` nova e `extraUnsealPasswords` com a antiga: a sessão aparece vazia, sem erro e sem `Set-Cookie`.
- Nenhuma das três senhas aparece no corpo, nos cabeçalhos, nos canais de log listados em T-01 (`console.log`, `warn`, `error`, `debug` e os outros que `src/` usar) nem em qualquer outro canal. O teste espia cada canal listado.
- Extra curta (menos de 32 caracteres, D-08): a sessão aparece vazia, sem erro novo, e o teste documenta que a extra não tem validação própria.

Aceite: os testes passam antes e depois da implementação, porque o comportamento de falha já é o desejado. Registrar isso em T-10. Depois de T-13, continuam passando, e o teste de log continua verificando o que diz.

Arquivos: `test/session.test.ts`

---

### T-08 — Testes de selo legado com senha extra

Cobre: RF-07
Depende de: T-01

Adicionar testes em `test/session.test.ts`, seguindo o padrão de `test/session.test.ts:134-159` e `test/session.test.ts:161-186`:

- Cookie legado (1 iteração de PBKDF2) selado com a senha antiga, configuração com `password` nova, `extraUnsealPasswords` com a antiga e `legacySealFallback` não desligado: a sessão é aberta e a resposta traz `Set-Cookie` selado com a senha nova.
- Mesmo cenário com `legacySealFallback: false`: a sessão é rejeitada e aparece vazia.

Aceite: o primeiro caso falha antes da implementação e o segundo passa antes. Registrar em T-10.

Arquivos: `test/session.test.ts`

---

### T-09 — Testes de expiração com senha extra

Cobre: RF-04, D-03
Depende de: T-01

Adicionar testes em `test/session.test.ts`, um para cada critério de expiração: cookie selado com a senha antiga e já expirado por `maxAge`, e outro expirado por `idleTimeout`, ambos lidos com a extra configurada. Em cada caso, a sessão aparece vazia e não há `Set-Cookie`, porque as checagens de expiração rodam depois que a senha abriu (D-03).

Aceite: os testes passam antes e depois da implementação; sem a extra o resultado é o mesmo. Registrar em T-10. Depois de T-13, continuam passando.

Arquivos: `test/session.test.ts`

---

### T-10 — Confirmar que os testes novos falham antes da implementação

Cobre: RF-10
Depende de: T-02, T-03, T-04, T-05, T-06, T-07, T-08, T-09

Rodar `pnpm typecheck` e `pnpm vitest run test/session.test.ts` sem nenhuma alteração em `src/`. Para cada teste novo, confirmar o resultado:

- Devem falhar, pelo motivo esperado: T-02 (tipo); T-03 casos 1 e 3 (abertura com extra); T-05 itens 1, 2 e 3 (regravação, segunda leitura e sessão do header); T-08 caso 1 (legado com extra).
- Devem passar, por serem preservação ou limite: T-03 casos 2 e 4; T-04; T-06; T-07; T-08 caso 2 (`legacySealFallback: false`); T-09.
- Preliminar: T-05 item 4 (cabeçalhos já enviados). Passa sem a mudança, porque nenhuma migração ocorre; o resultado final depende de T-15.

Anotar a lista real dos resultados para a descrição do PR (T-17). Se algum teste falhar por motivo diferente do esperado, corrigir o teste antes de seguir, sem tocar em `src/`.

Aceite: o relatório da execução está anotado, e todos os testes que deveriam falhar falham antes da implementação. Qualquer divergência desta lista fica anotada com o motivo.

Arquivos: `test/session.test.ts` (somente execução; sem mudança de `src/`)

---

### T-11 — Campo público `extraUnsealPasswords` e JSDoc

Cobre: RF-01, RF-09
Depende de: T-10

Em `src/utils/session.ts`, adicionar `extraUnsealPasswords?: string[]` logo após `password` e antes do JSDoc de `maxAge` (techspec, seção 4). O JSDoc tem as cinco frases de RF-09, na forma da seção 5.1 do techspec:

- as senhas servem só para abrir e nunca para selar;
- a ordem de tentativa é `password` e depois as extras;
- cada extra custa uma derivação por requisição com cookie que não abre com a atual;
- as extras devem ser removidas depois que as sessões antigas forem regravadas (RF-04) ou expirarem (`maxAge`/`idleTimeout`);
- a regravação gera `Set-Cookie` durante a janela de rotação.

Não alterar a documentação do site (`docs/`).

Aceite: `pnpm typecheck` passa, o teste de tipo de T-02 passa, e o JSDoc tem as cinco frases, conferidas por leitura.

Arquivos: `src/utils/session.ts`

---

### T-12 — Símbolo interno `kUnsealedWithExtra`

Cobre: RF-04 (sinalização usada pela migração, D-04)
Depende de: T-10

Em `src/utils/internal/session.ts`, definir `kUnsealedWithExtra` com `Symbol.for("h3.internal.session.extra-unseal")`, seguindo o padrão de `kLegacySeal` (techspec, seção 5.2). Não exportar o símbolo pela API pública.

Aceite: `pnpm typecheck` passa, e `src/index.ts` não muda.

Arquivos: `src/utils/internal/session.ts`

---

### T-13 — Laço de senhas em `unsealSession`

Cobre: RF-02, RF-05, RF-06, RF-07, RF-03
Depende de: T-11, T-12

Em `src/utils/session.ts`, alterar `unsealSession` (techspec, seção 5.4 e decisões D-01 a D-03 e D-06):

- lista de tentativas `[...new Set([config.password, ...(config.extraUnsealPasswords ?? [])])]`;
- para cada senha, selo atual e, se permitido e o erro for `"Bad hmac value"`, o selo legado com 1 iteração, antes de passar para a próxima senha;
- parar na primeira senha que abrir; marcar `kUnsealedWithExtra` quando a senha que abriu não for `config.password`;
- se nenhuma abrir, lançar o primeiro erro;
- manter as checagens de `maxAge` e `idleTimeout` depois do laço, sem alteração.

Não alterar `src/utils/internal/iron-crypto.ts` (D-01, `prd.md:145`).

Aceite: T-03 (casos 1 e 3), T-06, T-07 e T-08 passam, e T-04 continua passando. O caminho com uma senha só continua igual ao atual. `pnpm typecheck` passa. T-05 e T-09 continuam como estavam até T-14.

Arquivos: `src/utils/session.ts`

---

### T-14 — Marcação e regravação em `getSession`

Cobre: RF-04
Depende de: T-13

Em `src/utils/session.ts`, alterar `getSession` (techspec, seção 5.5):

- ler `kUnsealedWithExtra` do resultado de `unsealSession` e removê-lo antes de `Object.assign`, junto com `kLegacySeal`;
- incluir a condição `extraSeal` na regravação existente, que continua restrita a sessões lidas do cookie (`sessionFromCookie`, D-07).

Adicionar um teste de que a sessão retornada não tem nenhum dos dois símbolos internos (`kLegacySeal` e `kUnsealedWithExtra`), em `getSession` com cookie que abre com a extra e em `getSession` com cookie que abre com a senha atual.

Aceite: T-05 (regravação, segunda leitura e sessão do header) e T-09 passam. O teste de ausência de símbolos passa.

Arquivos: `src/utils/session.ts`, `test/session.test.ts`

---

### T-15 — Confirmar `useSession` e `updateSession` nos casos pendentes

Cobre: RF-04, RF-03
Depende de: T-14

Resolver as pendências de techspec, seção 8:

- Confirmar que `useSession` chama `getSession` e não tem caminho próprio de abertura. Se tiver, replicar a marcação e a regravação ali.
- Confirmar o que `updateSession` faz quando o cookie não pode ser definido porque a resposta já foi enviada. Ajustar `src/utils/session.ts` apenas se o caso não passar sem exceção e sem perda da sessão.

Registrar, no PR, o resultado de cada confirmação e o resultado final de T-05 item 4, que em T-10 ficou preliminar.

Aceite: T-05 (caso de cabeçalhos já enviados) passa sem exceção, e o resultado de `useSession` com senha extra é o mesmo de `getSession`.

Arquivos: `src/utils/session.ts` (se necessário), `test/session.test.ts`

---

### T-16 — Compatibilidade de API pública e tipos gerados

Cobre: RF-08
Depende de: T-14, T-15

- Rodar `test/unit/package.test.ts` sem alterar o snapshot de exports.
- Rodar `pnpm build` e comparar `dist/*.d.mts` com a cópia de T-01. A única diferença na API pública deve ser o campo `extraUnsealPasswords` em `SessionConfig`, com o JSDoc de T-11.
- Verificar se o JSDoc de T-11 aparece no `.d.mts`. O plugin de build remove comentários, exceto anotações `#`/`@` (AGENTS.md). Se a descrição sumir, registrar no PR e não alterar o plugin nesta entrega.

Aceite: o snapshot passa sem alteração, e o diff dos tipos gerados contém só `extraUnsealPasswords` (com ou sem o JSDoc, conforme o registro acima). Se houver outra diferença, corrigir antes de seguir.

Arquivos: `dist/*.d.mts` (gerado), `test/unit/package.test.ts` (sem alteração)

---

### T-17 — Verificação final e descrição do PR

Cobre: RF-10
Depende de: T-16

Rodar, nesta ordem: `pnpm lint`, `pnpm typecheck`, `pnpm vitest run test/session.test.ts` e `pnpm test`. Todos devem passar. `pnpm test` já inclui lint e typecheck (AGENTS.md); os comandos anteriores servem para isolar uma falha, se houver.

Conferir que nenhum teste existente foi removido: a contagem de testes de `test/session.test.ts` deve ser igual à de T-01 mais os testes novos.

Escrever a descrição do PR com:

- a lista de resultados de T-10 (quais testes falharam antes e quais passaram por preservação), com os resultados finais de T-05 item 4 e de T-15;
- qualquer alteração em testes existentes, com o que eles verificam e por que a alteração preserva isso (`prd.md:130`);
- a limitação de D-07: sessões lidas do header com senha extra não são regravadas e pagam a derivação extra até expirar;
- o custo de CPU por senha extra e a decisão de não impor limite (decisão 2 do PRD);
- o risco de a senha antiga continuar válida enquanto estiver na configuração;
- a pendência de documentação do `iterations` em `src/utils/internal/iron-crypto.ts:377`, fora deste PR;
- a situação do JSDoc no `.d.mts`, se T-16 encontrar remoção.

Aceite: `pnpm lint`, `pnpm typecheck` e `pnpm test` passam, a contagem de testes confere com T-01, e a descrição do PR tem os seis pontos acima.

Arquivos: `test/session.test.ts` (se houver ajuste final), descrição do PR (fora do repositório)

---

## Cobertura dos requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-02, T-11 |
| RF-02 | T-03, T-13 |
| RF-03 | T-04, T-13, T-15 |
| RF-04 | T-05, T-09, T-12, T-14, T-15 |
| RF-05 | T-01, T-06, T-13 |
| RF-06 | T-07, T-13 |
| RF-07 | T-08, T-13 |
| RF-08 | T-01, T-16 |
| RF-09 | T-11 |
| RF-10 | T-01, T-10, T-17 |
