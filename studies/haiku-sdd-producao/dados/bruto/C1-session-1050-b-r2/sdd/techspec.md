# Especificação técnica: várias senhas de unseal nas sessões (h3js/h3#1050)

Base: `sdd/pedido.md` (contrato #1050-b) e `sdd/prd.md` (RF-01 a RF-08).
Linha de base medida em 2026-11-06 na branch `master`: `pnpm vitest run test/session.test.ts test/unit/package.test.ts` passa com 59 testes.

## 1. Resumo

A mudança fica concentrada em `unsealSession`, que passa a tentar a senha atual e depois cada senha de `extraUnsealPasswords`, e em um campo novo em `SessionConfig`. Selagem continua exclusivamente com `password`. Não há novo export público, nem mudança de formato de cookie ou de assinatura de função.

## 2. Decisões de arquitetura

### D-01 — Forma da API: campo `extraUnsealPasswords`

**Alternativas**
- (a) `password: string | string[]`, a segunda alternativa da issue.
- (b) Campo novo opcional `extraUnsealPasswords?: string[]`.

**Escolha: (b).** O PRD fixa essa opção. A alternativa (a) muda o tipo de `password`, que hoje alimenta `seal` (`src/utils/session.ts:300`) e `unseal` (`src/utils/session.ts:324`), e quebra quem já lê o campo. A alternativa (b) é aditiva e opcional, então sem o campo o comportamento não muda.

### D-02 — Onde fica a tentativa de senhas: `unsealSession`

**Alternativas**
- (a) Laço dentro de `unsealSession` (`src/utils/session.ts:312`).
- (b) Passar uma lista de senhas para `unseal` do iron (`src/utils/internal/iron-crypto.ts:87`), usando o formato `PasswordHash` (`src/utils/internal/iron-crypto.ts:427`).
- (c) Gravar um `id` em cada senha, para o iron escolher pela chave do cookie.

**Escolha: (a).** A alternativa (b) exige ids nas senhas, e o `seal` atual grava o id vazio (`src/utils/internal/iron-crypto.ts:68` e `:79`). A alternativa (c) mudaria o cookie, o que está fora de escopo (PRD, "Fora de escopo"). O arquivo `iron-crypto.ts` é uma cópia vendorizada de outro projeto (cabeçalho em `src/utils/internal/iron-crypto.ts:1-9`), então manter o diff fora dele também reduz o custo de manutenção.

### D-03 — Critério para tentar a próxima senha: só `"Bad hmac value"`

**Alternativas**
- (a) Tentar a próxima senha em qualquer erro.
- (b) Tentar a próxima senha em qualquer erro, exceto expiração.
- (c) Tentar a próxima senha só quando o erro é `"Bad hmac value"`.

**Escolha: (c).** O erro `"Expired seal"` é lançado pelo iron antes de escolher a senha (`src/utils/internal/iron-crypto.ts:110-118`), então depende só do cookie. Tentar outra senha repetiria o mesmo erro e gastaria PBKDF2. O erro `"Session expired!"` é lançado depois da abertura (`src/utils/session.ts:353` e `:363`), fora do laço. A alternativa (a) mascararia erros de configuração e de expiração, e a (b) seria frágil, porque depende de conhecer a lista de erros do iron. Erros de senha inválida, como `"Password string too short"`, também propagam; ver R-03.

### D-04 — Fallback legado aplicado a cada senha, antes da próxima

**Alternativas**
- (a) Tentar todas as senhas com as opções atuais e só depois todas com as opções legadas.
- (b) Para cada senha: opções atuais, depois opções legadas (se permitido), depois a próxima senha.

**Escolha: (b)**, como a premissa do PRD. Após uma rotação, as sessões legadas seladas com a senha antiga precisam continuar abrindo. A alternativa (a) não traz ganho de segurança e muda a ordem de custo sem motivo claro. O custo de uma tentativa errada está em R-01.

### D-05 — Migração: só na regravação, sem reselar na leitura

**Alternativas**
- (a) Quando a sessão abre com senha extra, reselar dentro de `getSession`, do mesmo jeito que já é feito para sessões legadas (`src/utils/session.ts:214-216`).
- (b) Não reselar na leitura. A migração acontece quando a sessão é regravada.

**Escolha: (b).** Com (a), toda leitura de uma sessão antiga emitiria `Set-Cookie`, inclusive a de quem só consulta autenticação. Isso reabre a corrida descrita em `docs/4.examples/handle-session.md:183`. Com (b), a migração já funciona: `updateSession` sela sempre com `config.password` (`src/utils/session.ts:267`, que chama `sealSession`, e `:300`). Nenhuma linha nova é necessária para RF-06. O custo é que sessões que nunca são regravadas mantêm a senha antiga (R-04).

### D-06 — Expiração verificada depois da abertura, sobre o payload de qualquer senha

**Alternativas**
- (a) Verificar `maxAge` e `idleTimeout` dentro do laço, para cada senha.
- (b) Manter o bloco atual de expiração depois do laço.

**Escolha: (b).** O bloco atual (`src/utils/session.ts:349-365`) fica no lugar, sem alteração. Como o erro de expiração não é `"Bad hmac value"`, ele propagaria mesmo dentro do laço. Manter o bloco no lugar minimiza o diff e garante RF-05, porque a tentativa com outra senha nunca mascara a expiração.

### D-07 — Sem validação em tempo de execução das senhas extras

**Alternativas**
- (a) Validar `minPasswordlength` e a entropia de cada senha extra em `unsealSession`.
- (b) Não validar. A regra de entropia vai só para o JSDoc, como o PRD pede.

**Escolha: (b)**, porque o PRD marca a validação como fora de escopo. O risco de senha curta fica registrado em R-03 para a decisão do usuário.

### D-08 — Assinaturas públicas inalteradas e nenhum export novo

`unsealSession(_event, config, sealed)` continua com a mesma assinatura (`src/utils/session.ts:312-316`). Ela é exportada (`src/index.ts:209`) e aparece na lista de exports de `test/unit/package.test.ts:149`, então qualquer mudança nela quebraria esse teste. O helper novo fica não exportado.

## 3. Arquivos a alterar

| Arquivo | Trecho atual | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `:39-48`, interface `SessionConfig` e JSDoc de `password` | Adicionar `extraUnsealPasswords?: string[]` logo depois de `password` (`:48`), antes do JSDoc de `maxAge` (`:49`). |
| `src/utils/session.ts` | `:312-367`, `unsealSession` | Trocar a tentativa única (`:323-348`) por um laço sobre `[config.password, ...(config.extraUnsealPasswords || [])]`, chamando o helper `unsealWithPassword`. O bloco de expiração (`:349-365`) não muda. |
| `src/utils/session.ts` | `:312` (fim do arquivo, logo após `unsealSession`) | Novo helper `unsealWithPassword`, não exportado. Carrega o conteúdo atual de `:323-348` para uma senha. |
| `test/session.test.ts` | `:692`, bloco `describe("lazy creation")` | Novo bloco `describe("extraUnsealPasswords")` com os testes da seção 5, dentro do `describeMatrix` já existente. |

Arquivos que **não** mudam:
- `src/utils/internal/iron-crypto.ts`: fora do diff (D-02).
- `src/index.ts`: nenhum export novo (D-08).
- `docs/`: a documentação de `session.ts` é gerada por automd (`docs/2.utils/4.security.md`) e só lista as funções. `SessionConfig` não entra nela, então o JSDoc novo não gera mudança em `docs/`. Confirmar com `pnpm fmt` (automd) que não aparece diff.
- `CHANGELOG.md`: não editar. O arquivo tem links de commit, o que indica geração automática no release (inferência, não verificada).
- Testes existentes: nenhum precisa mudar. Com `extraUnsealPasswords` ausente, o laço tem uma única iteração e o comportamento é o atual. Se algum teste existente falhar, a causa será a implementação, não o teste.

## 4. Contratos e assinaturas

### 4.1 Tipo público

```ts
// src/utils/session.ts, dentro de SessionConfig
/**
 * Previous passwords that still open sessions sealed before a rotation.
 * They are only used to unseal: sessions are always sealed with `password`.
 * A session opened with one of them is resealed with `password` the next time
 * it is written. Each entry needs the same entropy as `password`. Keep the list
 * short, and remove an entry once the sessions it could have issued have expired.
 */
extraUnsealPasswords?: string[];
```

`password` continua `string`, com o JSDoc atual. Quando `extraUnsealPasswords` é `undefined` ou `[]`, o resultado é idêntico ao de hoje.

### 4.2 Função pública inalterada

```ts
// src/utils/session.ts:312
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;
```

Contrato de erro: lança `"Bad hmac value"` quando nenhuma senha abre o cookie, e propaga qualquer outro erro sem tentar as demais senhas. `"Session expired!"` é lançado depois da abertura, como hoje.

### 4.3 Helper interno (não exportado)

```ts
// src/utils/session.ts, após unsealSession
async function unsealWithPassword(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
  config: SessionConfig,
): Promise<Partial<Session>>;
```

Tenta `unseal` com `sealOptions`. Se o erro for `"Bad hmac value"` e `config.legacySealFallback !== false` com `sealOptions.integrity.iterations !== 1`, repete com 1 iteração e marca o resultado com `kLegacySeal` (como hoje, `src/utils/session.ts:340-347`). Qualquer outro erro, ou falha da repetição legada, sai para quem chamou.

### 4.4 Fluxo de `unsealSession`

```text
passwords = [config.password, ...(config.extraUnsealPasswords || [])]
para cada password em passwords:
    tenta unsealWithPassword(sealed, password, sealOptions, config)
    se abriu:                         guarda payload e sai do laço
    se erro == "Bad hmac value":      guarda como último erro, vai para a próxima senha
    senão:                            relança o erro
se nenhuma senha abriu:               relança o último erro ("Bad hmac value")
expiração maxAge (inalterada)         sobre o payload
expiração idleTimeout (inalterada)    sobre o payload
retorna payload
```

Nenhuma outra função muda de assinatura: `getSession`, `updateSession`, `sealSession` e `useSession` seguem como estão.

## 5. Estratégia de testes

**Padrão:** `describeMatrix` em `test/session.test.ts`, que roda cada teste em `web` e `node` (`AGENTS.md`, seção Testing). Senhas de teste com pelo menos 32 caracteres, como `sessionConfig.password` (`test/session.test.ts:23`). As senhas `"nova"` e `"antiga"` do PRD são ilustrativas: com o iron, `minPasswordlength` é 32 (`src/utils/internal/iron-crypto.ts:22` e `:28`), então `seal` e `unseal` lançam `"Password string too short"` com elas.

**Ordem:** escrever os testes primeiro e confirmar que os marcados como "falha" realmente falham antes da implementação. Os demais servem como guarda de regressão e já passam hoje.

| # | Teste | Cobre | Antes da mudança |
| --- | --- | --- | --- |
| 1 | Cookie selado com a senha extra abre, com o mesmo `id`, `createdAt` e `data.user === 1` | RF-01 | falha |
| 2 | `updateSession` grava um cookie que abre com `password` e não abre com a extra (`unseal` com a extra rejeita com `"Bad hmac value"`) | RF-02 | passa (guarda) |
| 3 | Sem `extraUnsealPasswords`, e com `[]`, um cookie de outra senha cria sessão nova sem erro | RF-03 | passa (guarda) |
| 4 | Cookie selado com senha desconhecida cria sessão nova com `data` vazio e resposta 200 | RF-04 | passa (guarda) |
| 5 | Com `maxAge: 3600` (e, em outro teste, `idleTimeout`), cookie da senha extra expirado com `vi.useFakeTimers({ toFake: ["Date"] })` vira sessão nova | RF-05 | passa (guarda) |
| 6 | Leitura seguida de `update({ visto: true })`: o `Set-Cookie` abre com `password` e mantém o `id` | RF-06 | falha |
| 7 | Cookie legado (`iterations: 1`) selado com a senha extra abre e é resselado com `password` | RF-01 e RF-06, legado | falha |
| 8 | Cookie legado selado com a senha extra e `legacySealFallback: false` vira sessão nova | Interação com D-04 | passa (guarda) |
| 9 | Cabeçalho `x-h3-test-session` selado com a senha extra devolve `id` e `data` | RF-07 | falha |
| 10 | `unsealSession` direto: cookie com a extra e `ttl` já vencido rejeita com `"Expired seal"` (sem tentar outra senha) | D-03 | passa (guarda) |
| 11 | `unsealSession` direto: senha desconhecida rejeita com `"Bad hmac value"` | D-03, contrato de mensagem | passa (guarda) |
| 12 | Um `SessionConfig` com `extraUnsealPasswords: ["..."]` compila | RF-08 | `pnpm typecheck` |

Notas sobre os testes:
- O teste 10 usa um `seal` com `ttl` negativo grande (por exemplo `-120_000`): a expiração do iron é `now + ttl`, e o erro acontece quando `exp <= now - timestampSkewSec * 1000` (`src/utils/internal/iron-crypto.ts:110-118`).
- O teste 11 fixa a string `"Bad hmac value"`, da qual D-03 depende. Se o iron mudar a mensagem, esse teste quebra.
- Para o cabeçalho (teste 9), o nome é `x-${sessionName.toLowerCase()}-session` (`src/utils/session.ts:179-182`). Com `name: "h3-test"`, o cabeçalho é `x-h3-test-session`.

**Comandos de verificação:**
1. `pnpm vitest run test/session.test.ts test/unit/package.test.ts`: deve manter os 59 testes da linha de base mais os novos.
2. `pnpm lint`: `oxlint` e `oxfmt --check` (`package.json:46`).
3. `pnpm typecheck`: `tsc --noEmit` (`package.json:54`).
4. `pnpm test` ao final: lint, typecheck e cobertura completa (`package.json:53`).

## 6. Riscos

**R-01 — Custo de CPU por senha extra.** Cada senha extra que não abre o cookie custa uma derivação PBKDF2 de integridade com 8192 iterações (`src/utils/internal/iron-crypto.ts:27`, o HMAC falha antes da decifragem), mais uma derivação de 1 iteração do fallback legado, se ele estiver habilitado (`src/utils/session.ts:340-344`). Para um cookie que nenhuma senha abre, o custo passa a ser de `(1 + N)` vezes esse valor. Não medi o tempo real. Mitigação: o JSDoc pede lista curta, e o PRD sugere documentar isso.

**R-02 — Senha antiga vazada.** Enquanto a senha estiver na lista, quem a conhecer forja sessões válidas. A remoção deve ocorrer depois da expiração do maior `maxAge` ou `idleTimeout` das sessões que ela pode ter emitido. Isso está no JSDoc (4.1), não é verificado pelo código.

**R-03 — Senha extra curta ou vazia: falha silenciosa.** Uma senha extra com menos de 32 caracteres faz o iron lançar `"Password string too short"` (`src/utils/internal/iron-crypto.ts:192-196`). Uma senha vazia lança `"Empty password"` (`src/utils/internal/iron-crypto.ts:94-96` e `:172-174`). Esses erros não são `"Bad hmac value"`, então o laço para ali, sem tentar as senhas seguintes. `getSession` engole o erro (`src/utils/session.ts:197`) e cria sessão nova. O efeito é que sessões seladas com as senhas depois da inválida viram anônimas, sem aviso. Como D-07 não valida, isso fica para decisão do usuário: aceitar com a documentação atual, ou validar a lista em `unsealSession` numa mudança posterior.

**R-04 — Sessões que nunca são regravadas.** Sem `idleTimeout`, uma sessão aberta com senha extra só migra quando for regravada (D-05). Enquanto isso, a senha antiga precisa continuar na lista.

**R-05 — Detecção por mensagem de erro.** A decisão de tentar a próxima senha depende da string `"Bad hmac value"` (`src/utils/internal/iron-crypto.ts:136` e `src/utils/session.ts:336`). Se a string mudar numa versão do iron, o laço para na primeira senha extra errada. A falha é segura: o cookie vira sessão nova, e nenhuma sessão é aberta indevidamente. O teste 11 cobre a mudança.

**R-06 — Ordem ambígua.** Se duas senhas abrirem o mesmo cookie, vale a primeira da ordem (`password` e depois a lista). O PRD diz que não precisa de tratamento especial.

**R-07 — Sessões de cabeçalho não migram.** Sessões lidas pelo cabeçalho `sessionHeader` nunca são resseladas (`src/utils/session.ts:183-187`, e a condição de reselagem em `:214` exige `sessionFromCookie`). Com senha extra, o cabeçalho continua sem migrar. Isso é o comportamento atual e está fora de escopo (PRD).

## 7. Pontos para o usuário decidir

1. R-03: validar as senhas extras em tempo de execução, ou aceitar a falha silenciosa documentada?
2. As senhas de exemplo do PRD (`"nova"`, `"antiga"`) estão abaixo do mínimo de 32 caracteres do iron. Vale trocá-las por exemplos válidos no próprio PRD? A implementação não depende disso.
