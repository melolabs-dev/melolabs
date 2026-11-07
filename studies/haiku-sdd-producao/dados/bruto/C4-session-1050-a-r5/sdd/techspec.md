# Especificação técnica — várias senhas de unseal nas sessões

Referências: `sdd/pedido.md` (contrato #1050-a), `sdd/prd.md` (RF-01 a RF-08), issue h3js/h3#1050.

Este documento não altera código. Todas as citações `arquivo:linha` foram conferidas na árvore atual do projeto.

## 1. Estado atual

- `SessionConfig.password` é `string` (`src/utils/session.ts:48`). Sua documentação JSDoc está em `src/utils/session.ts:40-47`.
- A selagem usa `config.password` diretamente (`src/utils/session.ts:300`).
- A abertura usa `config.password` em `src/utils/session.ts:324` e, no fallback legado, em `src/utils/session.ts:340`.
- O fallback legado (1 iteração de PBKDF2) fica em `src/utils/session.ts:326-347`. Ele só é tentado quando o erro é `"Bad hmac value"` e `legacySealFallback !== false` (`src/utils/session.ts:332-337`).
- A verificação de expiração (`maxAge` e `idleTimeout`) acontece depois de abrir, em `src/utils/session.ts:350-365`.
- `getSession` engole qualquer erro de `unsealSession` com `.catch(() => {})` (`src/utils/session.ts:196-197`). Uma sessão que falha ao abrir vira uma sessão nova, sem erro para quem chamou.
- Em `src/utils/internal/iron-crypto.ts`, uma senha `string` gera token com id vazio (`src/utils/internal/iron-crypto.ts:68`, que vira `""` no token). Na abertura, o id vazio vira `"default"` (`src/utils/internal/iron-crypto.ts:121`). Com senha `string`, o código usa a senha direto e ignora o id (`src/utils/internal/iron-crypto.ts:122-123`). O id do token não identifica a senha usada, então a lista precisa ser tentada em ordem. A premissa do PRD (seção "Premissas") está confirmada.
- Um `Array` passado hoje como senha falha em `src/utils/internal/iron-crypto.ts:124-127` com `"Cannot find password: default"`. Esse é o motivo dos testes novos falharem antes da mudança.
- A falha de integridade acontece antes da decifragem (`src/utils/internal/iron-crypto.ts:135-137`, e a decifragem vem em `:147`). Uma senha errada custa só o PBKDF2 de integridade.
- O tamanho mínimo da senha é validado em `src/utils/internal/iron-crypto.ts:192-195`, com padrão de 32 em `:22` e `:28`.
- `SessionConfig` é exportado em `src/index.ts:203`.
- O typecheck cobre `src` e `test` (`tsconfig.json`, campo `include`). Os scripts são `typecheck` (`tsc --noEmit`) e `lint` (`oxlint . && oxfmt --check .`) em `package.json:46` e `:54`.

## 2. Decisões de arquitetura

### D-01 — A rotação é resolvida em `session.ts`, com laço sobre a lista

**Escolha.** Manter `iron-crypto.ts` como está. Em `src/utils/session.ts`, um laço percorre as senhas em ordem e chama `unseal` com cada uma. A primeira que verifica o HMAC vence.

**Por quê.** O token não carrega qual senha o selou (ver seção 1). Assim, a lista precisa ser tentada no nível de sessão. Mudar o formato do token ou o `iron-crypto` iria contra o PRD ("Mudanças no formato do cookie selado… ou no algoritmo de selagem" estão fora de escopo).

**Alternativas.**
- *Usar `PasswordHash` do iron (`{ id: secret }`)*: rejeitada. A abertura procura a chave `"default"` (`src/utils/internal/iron-crypto.ts:121`), então só uma entrada casaria. Para funcionar, exigiria selar com ids, o que muda o formato do token.
- *Aceitar lista dentro de `iron-crypto.ts`*: rejeitada. O módulo é um port genérico do iron. A lista é uma regra da API de sessão (qual senha sela, quando parar), então pertence a `session.ts`.

### D-02 — Normalização em uma função única, com validação só para lista

**Escolha.** Uma função interna `sessionPasswords(config)` devolve `string[]`:
- Se `config.password` não é `Array`, devolve `[config.password]`, sem validação nova. Assim o caminho de senha única fica igual ao de hoje (RF-04).
- Se é `Array`, valida (decisão D-03) e devolve a lista.

**Por quê.** Os três pontos de uso (selagem, abertura e validação em `getSession`) ficam com a mesma regra. A senha única passa pelo mesmo código, sem bifurcação nos chamadores.

**Alternativas.**
- *Ramificar em cada chamador*: rejeitada. Duplica a regra em três lugares.
- *Converter sempre para array e validar também a string*: rejeitada. Mudaria o erro de `""` e de senha curta com string, o que quebra RF-04.

### D-03 — Validação estrita da lista, com comprimento mínimo

**Escolha.** Uma lista é inválida se estiver vazia, se tiver item que não seja `string`, se tiver string vazia, ou se tiver item menor que o `minPasswordlength` efetivo (`config.seal?.encryption.minPasswordlength ?? defaults.encryption.minPasswordlength`, com `defaults` de `src/utils/internal/iron-crypto.ts`). A mensagem é `"Invalid session password list: ..."`, sem mostrar o conteúdo de nenhuma senha (RF-05 e risco de vazamento do PRD).

**Por quê.** Sem a checagem de tamanho, uma senha curta na posição 2 só falharia quando o laço chegasse nela. Esse erro cairia no `.catch` de `getSession` (D-04) e a sessão seria perdida em silêncio. Validar tudo antes do laço torna o erro previsível.

**Alternativas.**
- *Deixar o `iron` lançar `"Password string too short"`*: rejeitada pelo motivo acima.
- *Tipar como tupla `[string, ...string[]]`*: rejeitada. O pedido fixa `string | string[]` (RF-08), e a validação de lista não vazia precisa ser em tempo de execução de qualquer forma, porque JavaScript não passa pelo tipo.

### D-04 — A validação roda antes do `.catch` de `getSession`

**Escolha.** Chamar `sessionPasswords(config)` no início de `getSession`, antes de qualquer alteração em `context.sessions`, com um comentário explicando que o `.catch` abaixo engoliria o erro.

**Por quê.** RF-05 exige que o erro seja lançado. Sem essa chamada, a validação dentro de `unsealSession` só aconteceria quando há cookie, e o erro seria engolido pelo `.catch` em `src/utils/session.ts:197`. Com a chamada no início, `useSession`, `getSession` e `updateSession` lançam o erro mesmo sem cookie.

**Alternativas.**
- *Validar só em `unsealSession` e `sealSession`*: rejeitada. `getSession` engole o erro de abertura, então RF-05 não seria cumprido na leitura.

### D-05 — Falha com todas as senhas mantém a mesma mensagem de hoje

**Escolha.** O laço continua só quando o erro é `"Bad hmac value"`. Qualquer outro erro é relançado na hora. Se nenhuma senha abrir, relança o último erro `"Bad hmac value"`. Isso mantém o resultado de hoje para cookie com senha errada (RF-06): `getSession` cria sessão nova.

**Por quê.** Qualquer outro erro (token malformado, expiração do selo, fallback desligado) não depende da senha. Continuar tentando seria trabalho à toa e poderia mascarar o erro.

**Alternativas.**
- *Erro próprio para "nenhuma senha abre"*: rejeitada. RF-06 pede o mesmo resultado de hoje e não vazar qual senha falhou.

### D-06 — Fallback legado é aplicado por senha, e a expiração é checada uma vez, depois do laço

**Escolha.**
- O bloco `try/catch` atual de `src/utils/session.ts:322-348` vai para uma função `unsealWithPassword(sealed, password, sealOptions, config)`. Ela recebe a senha como parâmetro no lugar de `config.password` e mantém a lógica do fallback, sem mudança.
- O laço chama `unsealWithPassword` para cada senha.
- As checagens de `maxAge` e `idleTimeout` (`src/utils/session.ts:350-365`) continuam depois do laço, uma vez só, sobre o resultado já aberto.

**Por quê.** RF-07 exige que o fallback valha para cada senha. Deixar a expiração depois do laço garante que uma sessão expirada não seja aceita por nenhuma das senhas.

**Alternativas.**
- *Checar expiração dentro do laço*: rejeitada. Repetiria a checagem sem ganho.

**Custo do fallback (correção ao PRD).** O PRD diz que o fallback "pode dobrar" o custo. Pelo código, o fallback repete a verificação com 1 iteração (`src/utils/session.ts:342-343`), e essa tentativa é barata. O custo por senha errada fica perto de 1 PBKDF2 de 8192 iterações mais 1 de 1 iteração, e não o dobro. Isso é uma dedução do código e deve ser confirmado com o benchmark (seção 6).

### D-07 — Gatilhos de reselagem não mudam

**Escolha.** `getSession` continua resselando só nos casos atuais: legado (`src/utils/session.ts:214`, com `legacySeal`) ou deslizamento de `idleTimeout`. A reselagem usa `sealSession`, que já sela com a primeira senha da lista (`src/utils/session.ts:300`).

**Por quê.** O PRD (RF e "Fora de escopo") exclui novo gatilho de regravação. Não há mudança de código extra para isso.

**Consequência.** Uma sessão aberta com uma senha antiga só é regravada com a senha nova quando for legada, quando o `idleTimeout` deslizar, ou quando houver escrita. Sem isso, ela continua com a senha antiga até `maxAge` expirar. Isso precisa estar na documentação (seção 5).

### D-08 — Sem teto de tamanho da lista nesta entrega

**Escolha.** Não impor limite no código. A documentação do JSDoc diz que o custo de abertura cresce com o número de senhas. A medição fica no benchmark (seção 6).

**Por quê.** Um teto seria uma restrição nova não pedida no contrato. O PRD sugere "limitar o tamanho da lista e documentar o custo; medir antes de liberar". A escolha de medir antes permanece com você (ver seção 8).

### D-09 — Organização dos helpers

**Escolha.**
- `sessionPasswords` (validação e normalização, sem dependência de runtime além de `defaults` do iron) vai para `src/utils/internal/session.ts`, no fim do arquivo, conforme a convenção de helpers internos do `AGENTS.md`.
- O laço e `unsealWithPassword` ficam em `src/utils/session.ts`, junto do fallback legado que reutilizam (`kLegacySeal`, `src/utils/session.ts:346`).

**Por quê.** `src/utils/session.ts` já tem 465 linhas, acima da meta de 200 do `AGENTS.md`. Esta entrega não divide o arquivo, para manter o diff revisável. A divisão fica como dívida anotada.

### D-10 — Tipo público

**Escolha.** `password: string | string[]`, exatamente como o pedido (RF-08). O JSDoc de `src/utils/session.ts:40-47` ganha um parágrafo com: a primeira senha sela, as demais só abrem; sessões seladas com uma senha retirada da lista deixam de abrir; o custo cresce com o número de senhas; e a senha antiga continua válida enquanto estiver na lista.

## 3. Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/session.ts:39-48` | Tipo de `password` para `string \| string[]` e JSDoc novo (D-10). |
| `src/utils/session.ts:149-153` | Chamar `sessionPasswords(config)` no início de `getSession`, antes da linha 155 (D-04). |
| `src/utils/session.ts:300` | `seal(session, sessionPasswords(config)[0], …)` (D-01, D-02). |
| `src/utils/session.ts:312-367` | `unsealSession`: laço sobre as senhas, `unsealWithPassword` com o `try/catch` atual, expiração depois do laço (D-05, D-06). |
| `src/utils/internal/session.ts` | Nova função `sessionPasswords` no fim do arquivo, com import de `defaults` de `./iron-crypto.ts` (D-02, D-03, D-09). |
| `test/session.test.ts:23` | Extrair `const password = "1234567…"` para uma constante string, e usar `password` nas chamadas de `seal`/`unseal` do iron (linhas `137`, `157`, `164`), que não aceitam `string[]`. Os demais usos (`sessionConfig.password`) continuam compilando. |
| `test/unit/types.test-d.ts` | Teste de tipo para `SessionConfig["password"]` (ver seção 6). |
| `test/session-password-list.test.ts` | **Novo.** Testes de comportamento com `describeMatrix` (seção 6). |
| `test/bench/session.ts` | Opcional: cenário com lista de 1 e de 3 senhas, cookie inválido (seção 6). |

Não mudam: `src/utils/internal/iron-crypto.ts`, `src/index.ts`, `package.json`, `docs/`.

## 4. Contratos e assinaturas

```ts
// src/utils/session.ts
export interface SessionConfig {
  /**
   * Private key(s) used to seal session tokens. Each must be at least 32 characters.
   *
   * A list is tried in order. The first password seals new sessions; the others
   * only open sessions sealed before a rotation. A session sealed only with a
   * password removed from the list stops opening. Opening costs one PBKDF2 pass
   * per password tried, so keep the list short. An old password stays valid while
   * it is in the list; remove it once no live session needs it.
   * …(texto atual sobre entropia, mantido)
   */
  password: string | string[];
  // demais campos inalterados
}

// src/utils/internal/session.ts
/**
 * Passwords to try, in order: the first seals, the rest only open.
 * A string is returned as-is (no extra validation). A list is validated:
 * non-empty, every item a non-empty string of at least `minPasswordlength`.
 * @throws Error "Invalid session password list: …" when a list is invalid
 */
export function sessionPasswords(config: SessionConfig): string[];

// src/utils/session.ts (não exportadas)
async function unsealSession(_event: HTTPEvent, config: SessionConfig, sealed: string): Promise<Partial<Session>>;
// — laço: for (const password of sessionPasswords(config)) { try { return await unsealWithPassword(…) } catch (e) { if (!isBadHmac(e)) throw e; last = e } }; throw last;
async function unsealWithPassword(sealed: string, password: string, sealOptions: SealOptions, config: SessionConfig): Promise<Partial<Session>>;
```

Notas sobre os contratos:
- Nenhum nome público novo. `sessionPasswords` é interna, não entra em `src/index.ts`. `test/unit/package.test.ts` lista exports e não deve mudar.
- `unsealSession` e `sealSession` seguem exportadas com a mesma assinatura. Só o tipo de `config.password` muda.
- Os tipos de retorno explícitos são exigidos por `isolatedDeclarations` para exportados. Os helpers acima não são exportados, exceto `sessionPasswords`, que recebe retorno explícito.

## 5. Documentação

- Só o JSDoc (`src/utils/session.ts:40-47`), conforme o PRD. Não há mudança em `docs/`.
- O JSDoc precisa dizer, em linguagem direta: qual senha sela, que as demais só abrem, que remover uma senha invalida as sessões que ela selou, e que senha antiga na lista continua aceitando sessões até ser removida.

## 6. Estratégia de testes

Ordem, conforme o fluxo de correção do `AGENTS.md` (teste antes da implementação):

1. Escrever `test/session-password-list.test.ts` e o teste de tipo. Rodar e confirmar que os cenários de lista falham antes da mudança. Os cenários de senha única devem passar desde já (eles são a regressão de RF-04).
2. Fazer as mudanças de `src` e a alteração em `test/session.test.ts`.
3. Rodar até passar.

**Arquivo `test/session-password-list.test.ts`**, com `describeMatrix` (roda em `web` e `node`, `test/_setup.ts:11`). Cenários:

| Cenário | Requisito |
| --- | --- |
| Aceita `password` como lista na criação e na leitura. | RF-01 |
| Sessão selada com `[A, B]` abre com `[A]` e não abre com `[B]` (cookie resultante lido por cada configuração). | RF-02 |
| Cookie selado só com `B` (config `[B]`) é lido com `[A, B]`: dados carregados e cookie regravado. Verificar com `unseal(regravado, A)` que a regravação usa `A`. | RF-03 |
| Senha única como string e lista de um item geram token com id vazio e são lidos igual a hoje. | RF-04 |
| `[]`, `["", A]`, `[A, 1]` e `[A, "curta"]` lançam `Invalid session password list` em `useSession`, `getSession` e `updateSession`, mesmo sem cookie. | RF-05 |
| Cookie selado com `C` é lido com `[A, B]` e produz o mesmo resultado que cookie selado com outra senha lido com senha única (sessão vazia, id novo). | RF-06 |
| Cookie legado (1 iteração) selado com `B` é lido com `[A, B]`, é regravado com `A`. Com `legacySealFallback: false`, não é aberto. | RF-07 |
| Sessão selada com `B` e expirada por `maxAge` não é aberta por nenhuma senha. | D-06 |
| Sessão selada com `A` é aberta quando `A` aparece em segundo lugar (`[B, A]`). | D-01 |

**Teste de tipo em `test/unit/types.test-d.ts`.** `expectTypeOf<SessionConfig["password"]>().toEqualTypeOf<string | string[]>()`. Também `useSession(event, { password: ["…", "…"] })` deve compilar.

**Suíte existente.** `test/session.test.ts` deve passar sem mudança de comportamento. A única mudança é a de tipo nas linhas `137`, `157` e `164`. Os testes de legado (linhas `~133-170`) são a regressão do fallback de senha única.

**Benchmark (opcional, mas recomendado antes de liberar).** Em `test/bench/session.ts`, medir a leitura de cookie inválido com 1, 2 e 3 senhas. Serve para confirmar a estimativa da seção 2 (D-06) e para decidir sobre o teto (seção 8).

**Comandos.**
- `pnpm vitest run test/session-password-list.test.ts`
- `pnpm vitest run test/session.test.ts test/unit/`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm vitest run` (suíte completa)

## 7. Riscos

Os riscos do PRD continuam válidos. Acrescentados por esta análise:

- **Erro engolido na leitura.** Sem D-04, uma lista inválida viraria sessão nova sem aviso. A chamada antecipada e os testes da tabela cobrem isso.
- **Rotação só termina com escrita ou com `idleTimeout`.** Sessão só lida, com `maxAge` e sem `idleTimeout`, mantém a senha antiga até expirar. Para remover uma senha com segurança, é preciso esperar o `maxAge`. Vale documentar.
- **Vazamento por posição (baixo).** O laço para na primeira senha que abre, então o tempo de resposta indica em que posição da lista o cookie foi selado. Isso revela o estado da rotação, não o conteúdo nem a senha. Impacto baixo; aceito.
- **Custo de CPU.** Linear no número de senhas (D-06). Cookie inválido custa até N PBKDF2 de 8192 iterações. O teto (D-08) não foi imposto.
- **Lint sobre `await` em laço.** O laço é intencionalmente sequencial. Se `oxlint` reclamar, a correção preferida é reescrever de forma que não exija supressão, e só suprimir se não houver alternativa limpa. Confirmar ao rodar `pnpm lint`.
- **Tamanho de `src/utils/session.ts`.** Já acima de 200 linhas antes desta mudança (D-09). Dívida conhecida, fora desta entrega.
- **Quebra de tipagem para quem lê `config.password`.** Código externo que atribui o campo a `string` deixa de compilar. Já listado no PRD.

## 8. Pontos para você confirmar

1. **Teto de tamanho da lista (D-08).** Sem teto no código, só documentação. Quer um teto explícito, e qual? Ou medir primeiro com o benchmark?
2. **Mínimo de comprimento dos itens (D-03).** Proposta: validar já na lista, com o `minPasswordlength` efetivo. Confirmar.
3. **Regravação com senha antiga (D-07).** Mantido o escopo do PRD. Se quiser que uma sessão aberta com senha antiga seja regravada na hora, é um novo gatilho em `src/utils/session.ts:214`, o que contraria o "Fora de escopo" do PRD.
