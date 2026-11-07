# Tarefas — Várias senhas de unseal nas sessões (h3js/h3#1050-a)

Base: `sdd/prd.md` e `sdd/techspec.md`. Ordem pensada para o fluxo de correção do `AGENTS.md`: testes de regressão primeiro, confirmados como falhando, depois a implementação.

## Cobertura de requisitos

| Requisito | Tarefas |
| --- | --- |
| RF-01 | T-04, T-09 |
| RF-02 | T-02, T-05 |
| RF-03 | T-02, T-06 |
| RF-04 | T-02, T-03, T-07 |
| RF-05 | T-02, T-06 |
| RF-06 | T-01, T-02, T-06 |
| RF-07 | T-02, T-06, T-07 |
| RF-08 | T-02, T-04 |
| RF-09 | T-02, T-05, T-06, T-07 |
| RF-10 | T-02, T-08, T-09 |

## Tarefas

### T-01 — Preparar os testes existentes para o tipo alargado
Em `test/session.test.ts`, definir uma const `password` (string) em torno da linha 23, reutilizá-la em `sessionConfig` e trocar `sessionConfig.password` por `password` nas chamadas a `seal`/`unseal` das linhas ~137, ~157 e ~164, que exigem `string`. Os usos que só atribuem `password: sessionConfig.password` a um `SessionConfig` ficam como estão.

Cobre: RF-06
Arquivos: `test/session.test.ts`
Depende de: nenhuma
Aceite: `pnpm vitest run test/session.test.ts` passa com o mesmo número de testes e as mesmas verificações de antes; nenhuma asserção foi removida ou enfraquecida (conferir com `git diff`).

### T-02 — Escrever os testes de regressão da rotação de senha
No fim do `describeMatrix` de `test/session.test.ts`, adicionar os testes da §6 da techspec, usando `seal`/`unseal`/`sealDefaults` para fabricar cookies com a senha antiga e senhas de teste com 32 caracteres ou mais (`nova-senha-…`, `antiga-senha-…`, `senha-removida-…`):
- lista sela com a primeira senha (abre só com a nova, não abre só com a antiga);
- cookie da antiga abre com `[nova, antiga]`, com o mesmo `id` e `data`;
- leitura com a antiga devolve `Set-Cookie` que abre só com a nova e preserva `id`/`data`; cookie já na primeira senha não gera `Set-Cookie` extra;
- senha fora da lista gera `id` diferente, `data` vazio e status 200;
- `string` e lista de um item abrem o mesmo cookie;
- legado de 1 iteração com a antiga em segunda posição é aceito e reselado, e rejeitado com `legacySealFallback: false`;
- `password: []` e item curto (também em segunda posição) dão erro em `sealSession`/`updateSession`, e `getSession` cria sessão nova; a mensagem de senha curta é comparada com a do `iron-crypto`;
- `unsealSession`, `sealSession`, `updateSession`, `clearSession`, `getSession` e `useSession` funcionam com lista;
- `maxAge` e `idleTimeout` expirados com cookie da senha antiga geram sessão nova;
- sessão vinda do cabeçalho, selada com a antiga, é lida sem `Set-Cookie`;
- selo expirado ou malformado resulta em sessão nova.

Cobre: RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09, RF-10
Arquivos: `test/session.test.ts`
Depende de: T-01
Aceite: antes de qualquer mudança em `src/`, `pnpm vitest run test/session.test.ts` mostra os novos testes falhando (por tipo ou por comportamento) e os testes antigos passando. Guardar a saída dessa falha como evidência.

### T-03 — Criar o símbolo interno `kRotatedSeal`
Adicionar `export const kRotatedSeal: unique symbol = /* @__PURE__ */ Symbol.for("h3.internal.session.rotated-seal")` logo após `kLegacySeal` (linhas 7-9), no mesmo estilo dele.

Cobre: RF-04
Arquivos: `src/utils/internal/session.ts`
Depende de: nenhuma
Aceite: `pnpm typecheck` passa; o símbolo não aparece em `src/index.ts`.

### T-04 — Alargar o tipo de `password` e criar os helpers de normalização
Em `src/utils/session.ts`: mudar `password` para `string | string[]` e atualizar o JSDoc (primeira sela, demais só abrem, ordem significativa, cada senha com 32 caracteres ou mais, remover a antiga depois da rotação, listas curtas por causa do custo PBKDF2). No fim do arquivo, adicionar os helpers privados `getPasswords(config, sealOptions): string[]` e `isBadPassword(error): boolean`. `getPasswords` trata `string` como lista de um item e lança `Error("Empty password")` para lista vazia ou senha vazia, `Error("Invalid password")` para item não string e `Error("Password string too short (min N characters required)")` para item curto. Aqui `N = max(encryption.minPasswordlength, integrity.minPasswordlength)` de `sealOptions`. `isBadPassword` é `error instanceof Error && error.message === "Bad hmac value"`. Nenhum dos dois é exportado.

Cobre: RF-01, RF-08
Arquivos: `src/utils/session.ts`
Depende de: T-02
Aceite: `pnpm typecheck` passa com `password` em `string` e em `string[]`; `git diff src/index.ts` está vazio; `pnpm lint` passa.

### T-05 — Selar sempre com a primeira senha
Em `sealSession`, extrair `{...sealDefaults, ttl, ...config.seal}` para a const local `sealOptions` e chamar `seal(session, getPasswords(config, sealOptions)[0], sealOptions)`. `updateSession` e `useSession` herdam o comportamento por usarem `sealSession`.

Cobre: RF-02, RF-09
Arquivos: `src/utils/session.ts`
Depende de: T-04
Aceite: os testes de T-02 sobre selo com a primeira senha, `sealSession`/`updateSession` com lista e rejeição de lista vazia ou senha curta no selo passam.

### T-06 — Abrir com todas as senhas em duas fases
Em `unsealSession`, substituir o `unseal` único por um laço sequencial em duas fases:
- Fase 1: formato atual com cada senha, na ordem, parando na primeira que abrir.
- Fase 2: se `legacySealFallback !== false` e `iterations !== 1`, o mesmo laço com `iterations: 1`, marcando `kLegacySeal`.

Só `isBadPassword` avança para a próxima senha. Qualquer outro erro (`Expired seal`, componentes, prefixo, expiração inválida) é relançado na hora. Se todas falharem, relançar o erro da primeira tentativa do formato atual. Marcar `kRotatedSeal` quando a senha que abriu não for a primeira, em qualquer das fases. As checagens de `maxAge`/`idleTimeout` ficam depois do laço e valem para a sessão inteira.

Cobre: RF-03, RF-05, RF-06, RF-07, RF-09
Arquivos: `src/utils/session.ts`
Depende de: T-03, T-04
Aceite: `unsealSession` com lista abre cookies de qualquer senha da lista e rejeita senha removida; o legado funciona na segunda posição e é rejeitado com `legacySealFallback: false`; os testes de expiração com senha antiga e de selo malformado passam; a suíte antiga de sessão segue verde.

### T-07 — Reselar em `getSession` quando a senha não é a primeira
Em `getSession`, ler e apagar `kRotatedSeal` junto de `kLegacySeal` antes de copiar os dados para `session`, e incluir `rotatedSeal` na condição de reselagem (`session.id && sessionFromCookie && (legacySeal || rotatedSeal || shouldSlide(...))`). A reselagem reaproveita `updateSession` (primeira senha e opções atuais). Sessão vinda do cabeçalho não é reselada.

Cobre: RF-04, RF-07, RF-09
Arquivos: `src/utils/session.ts`
Depende de: T-05, T-06
Aceite: o teste de RF-04 mostra `Set-Cookie` que abre só com a nova senha, com `id`/`data` preservados; cookie na primeira senha não gera `Set-Cookie` extra; sessão pelo cabeçalho não gera `Set-Cookie`; o legado em segunda posição é reselado com a primeira senha.

### T-08 — Documentar a rotação de senha
Em `docs/4.examples/handle-session.md`, adicionar a subseção "Rotating the password" depois do aviso das linhas 36-43 (ou antes de `## Expiration`). Ela deve explicar: forma `string | string[]`, primeira sela e demais só abrem, reselagem automática de cookies, cabeçalho de sessão não é reselado, procedimento (adicionar a nova à frente, esperar `maxAge`/reselagem, remover a antiga), listas curtas por custo de CPU e mínimo de 32 caracteres por senha. Ajustar a frase "Every option is optional except `password`" (~linha 143) para citar `string | string[]`. Não editar `CHANGELOG.md` (gerado no release); não alterar `docs/2.utils/4.security.md`.

Cobre: RF-10
Arquivos: `docs/4.examples/handle-session.md`
Depende de: T-07
Aceite: a seção existe e descreve o procedimento acima; `pnpm lint` (oxfmt) passa nos arquivos de doc; o JSDoc de T-04 e a doc dizem a mesma coisa.

### T-09 — Verificação final e prova de regressão
Rodar `pnpm vitest run test/session.test.ts`, `pnpm lint`, `pnpm typecheck` e `pnpm vitest run` completo. Conferir `git diff src/index.ts` vazio e que `src/utils/internal/iron-crypto.ts` não mudou. Para provar que os novos testes detectam a regressão, guardar as mudanças de `src/` com `git stash`, rodar os novos testes e ver falhar, e restaurar com `git stash pop`. Anotar nas notas de versão a quebra de tipo para quem lê `config.password` como `string`.

Cobre: RF-01, RF-10
Arquivos: `test/session.test.ts`, `src/utils/session.ts`, `src/utils/internal/session.ts`, `docs/4.examples/handle-session.md`
Depende de: T-08
Aceite: todos os comandos acima passam com as mudanças aplicadas; com as mudanças de `src/` guardadas, os novos testes falham; `git diff src/index.ts` e o diff de `iron-crypto.ts` estão vazios.
