# Especificação técnica — várias senhas de unseal nas sessões (h3js/h3#1050)

Base: `sdd/pedido.md` (contrato enxuto #1050-b) e `sdd/prd.md` (RF-01 a RF-09, premissas P1–P5, riscos R1–R5).
Todas as referências `arquivo:linha` foram conferidas no código atual (branch `master`, commit `7383bb5`).

## 1. Resumo

`SessionConfig` ganha `extraUnsealPasswords?: string[]`. `unsealSession` passa a tentar `password` e depois cada senha extra, na ordem dada, e usa a primeira que abre o token. Uma sessão aberta por senha extra (ou pelo fallback legado) é regravada com `password` na mesma leitura, pelo mecanismo que já existe para sessões legadas. Nenhuma mudança no formato do token, na selagem ou em `cookie.ts`.

## 2. Verificações feitas antes do desenho

- **P1 (validação de tamanho):** a checagem de 32 caracteres não está em `SessionConfig`. Ela é feita pela biblioteca de selagem, de forma preguiçosa, a cada tentativa: `src/utils/internal/iron-crypto.ts:191-196` (`generateKey`, só para senha do tipo `string`) com `minPasswordlength: 32` em `src/utils/internal/iron-crypto.ts:22` e `:28`. Consequência: uma senha extra curta não causa erro na configuração; ela simplesmente nunca abre token (ver D-06).
- **Erro de HMAC é o único erro que depende da senha:** `src/utils/internal/iron-crypto.ts:135-137` lança `Bad hmac value`. Erros de formato (`:99-101`, `:106-108`, `:111-117`) acontecem antes de qualquer derivação PBKDF2 e não dependem da senha.
- **Expiração não depende da senha:** o `Expired seal` do token (`src/utils/internal/iron-crypto.ts:110-118`) e as checagens de `maxAge`/`idleTimeout` (`src/utils/session.ts:350-365`) rodam sobre o conteúdo já aberto.
- **Formato do token:** o iron suporta mapa de senhas por `id` (`src/utils/internal/iron-crypto.ts:124-127`), mas isso altera o segundo segmento do token. O PRD proíbe essa mudança.
- **Superfície pública:** `unsealSession` é exportada (`src/index.ts:208-212`) e a lista de exports é um snapshot (`test/unit/package.test.ts:149`). Adicionar só um campo de tipo não muda essa lista.
- **Sessões de header nunca são regravadas:** `src/utils/session.ts:214` só regrava quando `sessionFromCookie`, e `test/session.test.ts:311-342` trava isso. Isso afeta RF-08 e RF-09 (ver D-05).

## 3. Decisões de arquitetura

### D-01 — Campo público único: `extraUnsealPasswords` em `SessionConfig`

**Escolha:** adicionar `extraUnsealPasswords?: string[]` logo após `password` em `src/utils/session.ts:48`, com JSDoc dizendo que são usadas só para abrir e nunca para selar. `password` continua `string`.

**Alternativas consideradas:**
- *`password: string | string[]`* (a segunda alternativa da issue). Rejeitada: muda o tipo de `password`, quebra P5 e exige checar o tipo em todo lugar que a senha é usada.
- *Mapa de ids do iron* (`PasswordHash`). Rejeitada: muda o formato do token (ver seção 2) e exige um id por senha no selo, o que é uma mudança de contrato maior que a necessária.

**Justificativa:** é o menor contrato que atende RF-01 e P5, sem nome público novo além do campo.

### D-02 — O loop de tentativas fica dentro de `unsealSession`

**Escolha:** `unsealSession` (`src/utils/session.ts:312-367`) monta a lista `[config.password, ...(config.extraUnsealPasswords || [])]` e tenta uma senha de cada vez, na ordem. Se nenhuma abrir, relança o **primeiro** erro, que é o da senha atual. Isso mantém o erro final igual ao de hoje quando nenhuma senha extra ajuda (RF-04, P3). Um erro de uma tentativa não interrompe o loop (P3).

**Alternativas consideradas:**
- *Loop em `getSession`* (`src/utils/session.ts:149-232`). Rejeitada: `unsealSession` é pública e já contém as checagens de expiração e o fallback legado. Colocar o loop fora duplicaria a lógica ou deixaria `unsealSession` sem as extras.
- *Parar no primeiro erro que não seja HMAC*. Rejeitada: P3 pede que o loop não pare, e erros de formato já aparecem na primeira tentativa, então o custo é o mesmo.

**Justificativa:** uma única fonte de verdade para tentativas, expiração e erro. A ordem é fixa (P2), então sessões com a senha atual não pagam nada extra.

### D-03 — Fallback legado tentado por senha, na mesma ordem

**Escolha:** para cada senha, primeiro a tentativa com as iterações atuais e depois, se `legacySealFallback !== false` e as iterações não forem 1, a tentativa com 1 iteração. Essa lógica sai do bloco `catch` atual (`src/utils/session.ts:325-347`) para um helper interno que recebe uma senha e devolve o resultado.

**Alternativas consideradas:**
- *Todas as senhas com iterações atuais, depois todas com 1 iteração.* Descartada: exige dois laços e não atende o texto de RF-07 ("tentado para cada senha da lista"). No pior caso (token que nenhuma senha abre) o custo é igual nas duas ordens; a ordem por senha é mais barata quando um token legado é aberto por uma senha no início da lista.

**Justificativa:** reaproveita o código atual sem mudar a semântica do fallback e mantém RF-07 literal.

### D-04 — Marcador de regravação generalizado: `kLegacySeal` vira `kReseal`

**Escolha:** renomear o símbolo interno `kLegacySeal` (`src/utils/internal/session.ts:7-8`, valor `Symbol.for("h3.internal.session.legacy-seal")`) para `kReseal` (`Symbol.for("h3.internal.session.reseal")`). O marcador é posto quando a senha aberta é extra **ou** quando o token é legado. Uso em `src/utils/session.ts:5`, `:199-201` e `:346`.

**Restrição importante:** em `getSession` o marcador precisa ser lido e apagado **antes** de `Object.assign(session, unsealed)` (`src/utils/session.ts:208`), porque `Object.assign` copia símbolos enumeráveis e o marcador não pode vazar para a sessão.

**Alternativas consideradas:**
- *Manter `kLegacySeal` e criar um segundo símbolo.* Rejeitada: duas marcas com a mesma consequência (regravar) duplicariam a condição em `:214`.
- *Mudar o retorno de `unsealSession` para uma tupla.* Rejeitada: `unsealSession` é pública (`src/index.ts:208-212`).

**Justificativa:** o símbolo é interno (não está em `src/index.ts`), então a renomeação não muda a API.

### D-05 — Sessões de header não são regravadas

**Escolha:** a regravação de RF-08 vale só para sessões lidas do cookie, o que já é a regra de `src/utils/session.ts:214` (`sessionFromCookie`). Uma sessão de header aberta com senha extra continua sendo aberta com as extras a cada requisição até expirar; ela não recebe um novo token.

**Alternativas consideradas:**
- *Emitir `Set-Cookie` também para sessões de header.* Rejeitada: o cliente de header não usa cookie, então o `Set-Cookie` não completa a rotação, e isso contraria `test/session.test.ts:311-342` e a regra atual de `:214`.
- *Devolver o novo token no corpo ou em um header de resposta.* Rejeitada: cria superfície de API nova, fora do escopo do PRD.

**Justificativa:** segue o comportamento que já existe para sessões legadas de header. **Isto contradiz RF-08 e RF-09 do PRD para o caso de header** e precisa de decisão do time (ver seção 8, item R-A). O teste novo em `test/session.test.ts` trava esta decisão.

### D-06 — Nenhuma validação nova de tamanho ou duplicata nas senhas extras

**Escolha:** não validar `extraUnsealPasswords` em `getSession` nem em `unsealSession`. A biblioteca já valida o tamanho na hora de usar, e o PRD exclui validação de duplicatas.

**Alternativas consideradas:**
- *Lançar erro em `unsealSession` quando uma extra for curta.* Rejeitada: `getSession` engole qualquer erro de `unsealSession` (`src/utils/session.ts:198`, `.catch(() => {})`). O erro não chegaria ao dev, e pior: como a validação rodaria a cada requisição, afetaria também sessões que a senha atual abre, se a validação fosse feita antes do loop.
- *Validar no `useSession`.* Rejeitada: é a mesma coisa, sem a parte de engolir erro, e exige mudança em outra função pública.

**Justificativa:** a única consequência é que uma extra curta nunca abre token, sem erro visível. Isso vai para a documentação (R-B).

### D-07 — Expiração continua depois do loop

**Escolha:** as checagens de `maxAge` e `idleTimeout` (`src/utils/session.ts:350-365`) continuam **depois** do loop e sobre o resultado, sem alteração. Assim RF-06 vale para qualquer senha sem código novo.

**Alternativas consideradas:** checar expiração dentro de cada tentativa. Rejeitada: duplicaria a lógica e não traria ganho, porque o resultado da expiração é o mesmo para qualquer senha.

## 4. Arquivos a alterar

| Arquivo | Linhas | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `:5` | trocar o import `kLegacySeal` por `kReseal` (D-04). |
| `src/utils/session.ts` | `:48` | inserir o campo `extraUnsealPasswords?: string[]` com JSDoc logo após `password` (D-01). |
| `src/utils/session.ts` | `:196-216` | renomear `legacySeal` para `reseal`, ler e apagar o marcador antes de `Object.assign` (`:199-208`), e estender a condição de regravação em `:214` para `(reseal || shouldSlide(session, config))` (D-04, D-05). |
| `src/utils/session.ts` | `:312-347` | substituir o `try`/`catch` único por um loop sobre as senhas, chamando um helper interno com fallback legado (D-02, D-03). |
| `src/utils/session.ts` | `:350-365` | sem mudança; checagens de expiração continuam depois do loop (D-07). |
| `src/utils/internal/session.ts` | `:7-8` | renomear `kLegacySeal` para `kReseal` e trocar a string do `Symbol.for` (D-04). |
| `test/session.test.ts` | após `:186` | adicionar os testes novos (seção 6). Os testes existentes não mudam (RF-04). |

Não há mudança previsível em `src/utils/cookie.ts`, `src/utils/internal/iron-crypto.ts`, `src/index.ts` ou `test/unit/package.test.ts`.

## 5. Contratos e assinaturas

```ts
// src/utils/session.ts — campo novo em SessionConfig (após password, linha 48)
export interface SessionConfig {
  password: string;
  /**
   * Previous passwords, used only to open sessions and never to seal them. Tried
   * in order after `password`. Remove an entry to revoke it: anyone holding it
   * can keep forging sessions while it stays in this list.
   */
  extraUnsealPasswords?: string[];
  // ... demais campos inalterados
}

// Assinatura pública inalterada
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;

// Helper interno (não exportado)
async function unsealWithPassword(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
  allowLegacy: boolean, // config.legacySealFallback !== false
): Promise<{ unsealed: Partial<Session>; legacy: boolean }>;
```

Esboço do corpo de `unsealSession` (contrato, não implementação final):

```ts
const passwords = [config.password, ...(config.extraUnsealPasswords || [])];
let opened = false;
let unsealed: Partial<Session> | undefined;
let firstError: unknown;
for (const [index, password] of passwords.entries()) {
  try {
    const result = await unsealWithPassword(sealed, password, sealOptions, config.legacySealFallback !== false);
    unsealed = result.unsealed;
    if (result.legacy || index > 0) (unsealed as any)[kReseal] = true;
    opened = true;
    break;
  } catch (error) {
    firstError ??= error; // erro da senha atual, como hoje
  }
}
if (!opened) throw firstError;
// checagens de maxAge e idleTimeout, inalteradas
```

Pontos do contrato:

- `opened` é uma flag, não `if (!unsealed)`, porque `unseal` pode devolver `null` (`src/utils/internal/iron-crypto.ts:149`), e o comportamento atual nesse caso deve continuar o mesmo.
- `sealOptions` é o mesmo para todas as senhas, então `config.seal` (iterações, algoritmos, `ttl`) vale também para as extras.
- `sealSession` (`src/utils/session.ts:282-307`) e `updateSession` não mudam: selam sempre com `config.password` (RF-03).
- `getSession` continua chamando `unsealSession` no mesmo lugar (`src/utils/session.ts:196`); a única diferença é o nome do marcador.

## 6. Estratégia de testes

Todos os testes novos usam `describeMatrix` (rodam em `web` e `node`), no mesmo padrão de `test/session.test.ts:134-186`. Senhas de teste com 32+ caracteres, como a de `test/session.test.ts:23`.

Testes existentes: **nenhum precisa mudar** se a implementação seguir este desenho. Se algum falhar, a falha é um sinal de regressão de RF-04, não um motivo para ajustar expectativa. Qualquer ajuste precisa ser justificado no PR (R5).

Testes novos, por requisito:

| Teste | Requisito | Como verificar |
| --- | --- | --- |
| Tipo do campo | RF-01 | `expectTypeOf<SessionConfig["extraUnsealPasswords"]>().toEqualTypeOf<string[] \| undefined>()`, em arquivo de tipo de `test/unit/` ou coberto por `pnpm typecheck` (confirmar qual dos dois). |
| Abre com senha extra (cookie) | RF-02 | token com `A`, config `B` + `[A]`: `id`, `createdAt` e `data` iguais aos originais. |
| Ordem: senha atual primeiro | P2 | token com `B`, config `B` + `[A]`: número de `deriveBits` igual ao de config sem extras (`vi.spyOn(crypto.subtle, "deriveBits")`, mesmo padrão de `test/session.test.ts:722-735`). |
| `update()` sela só com a atual | RF-03 | após `update()` com config `B` + `[A]`, o cookie abre com `B` e não abre com `A` (`unseal`, como em `:157`). |
| Lista vazia = sem extras | RF-04 | `extraUnsealPasswords: []` produz o mesmo resultado que ausente. |
| Token de senha desconhecida | RF-05 | token com `C`: `getSession` retorna `id` novo e não lança. |
| Expiração com senha extra | RF-06 | token com `A` vencido por `maxAge`, config `B` + `[A]`: sessão nova. |
| Legado com senha extra | RF-07 | token legado (1 iteração) com `A`: regravado com `B` e iterações atuais (`unseal` com `sealDefaults`, como em `:157`); a leitura seguinte não gera `Set-Cookie`. |
| `legacySealFallback: false` | RF-07 | token legado com `A` e `legacySealFallback: false`: sessão nova. |
| Regravação ao abrir com extra | RF-08 | leitura com token `A` gera `Set-Cookie` que abre com `B` e não com `A`; `id` e `createdAt` mantidos; segunda leitura sem `Set-Cookie`. |
| Header com senha extra | RF-09 | token com `A` no header `x-{name}-session`: dados carregados. Também trava D-05: nenhum `Set-Cookie` nessa leitura. |
| Contagem de tentativas | R1 | token que nenhuma senha abre, com 3 extras e fallback ligado: `deriveBits` = 2 × 4 (uma tentativa completa e uma legada por senha). Documenta o custo. |
| Extra curta não derruba a atual | D-06 | config com `password` válida e extra de 5 caracteres: sessões com a senha atual continuam abrindo. |

Comandos: `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/`, depois `pnpm lint`, `pnpm typecheck` e `pnpm test`.

Ordem de trabalho (AGENTS.md, "Bug Fix Workflow" adaptado): escrever primeiro os testes de RF-02, RF-08 e R1 e vê-los falhar; depois implementar.

## 7. Riscos

- **R-A — Rotação incompleta para clientes de header (conflito com RF-08/RF-09).** Um cliente que usa `x-{name}-session` nunca recebe o token novo. Ele continua usando a senha antiga até a sessão expirar. Se o time precisa de rotação completa também para header, esta especificação não atende e é preciso um mecanismo de entrega de token novo (fora de escopo). **Pendência de decisão de produto**; recomendação: aceitar a limitação, documentar, e revisar RF-08 e RF-09 no PRD.
- **R-B — Falha silenciosa de senha extra curta ou vazia.** Uma extra com menos de 32 caracteres (ou `""`) gera erro na biblioteca, que é engolido em `src/utils/session.ts:198`. Os tokens dessa senha viram sessões anônimas sem nenhum aviso. Mitigação: documentação do campo (D-01) e teste de D-06. Não há validação em código (D-06).
- **R-C — CPU por requisição (R1 do PRD).** Cada senha extra que não abre custa 2 derivações PBKDF2 (completa e legada) por leitura. O pior caso é um token que nenhuma senha abre (cookie antigo ou adulterado): `2 × (1 + N)` derivações, com N extras. Mitigação: ordem fixa (P2), documentação pedindo poucas extras, e o teste de contagem da seção 6. Cada derivação usa 8192 iterações (`src/utils/internal/iron-crypto.ts:21`, `:27`), então com N grande o impacto é real.
- **R-D — Marcador vazando para a sessão.** Se `kReseal` não for apagado antes de `Object.assign` (`src/utils/session.ts:208`), ele entra na sessão e pode ir para `updateSession`. Mitigação: ordem da seção 3 (D-04) e um teste que verifique que `session[kReseal]` não existe depois de uma leitura. Se preferir, o teste pode checar que a leitura seguinte não gera `Set-Cookie`, que já cobre o caso.
- **R-E — Senha antiga válida enquanto estiver na lista (R2 do PRD).** Um token aberto por senha extra é regravado com `password` na mesma leitura (cookie), então a dependência da extra acaba ali. O risco que sobra é o de quem tem a senha antiga conseguir forjar tokens enquanto ela estiver em `extraUnsealPasswords`. A documentação do campo (seção 5) diz que remover a entrada é a única forma de revogar.
- **R-F — Mudança de nome do símbolo.** `kReseal` troca a chave `Symbol.for`. Como o símbolo é interno e não exportado, não há efeito em consumidores. Se alguma sessão antiga em memória (em processo de deploy) carregar o marcador antigo, ele é ignorado; isso só afeta uma sessão regravada uma vez a mais, o que é inofensivo.
- **R-G — Documentação e changelog.** O PRD deixa `docs/2.utils/4.security.md:60` e `CHANGELOG.md` para depois. Esta especificação mantém isso fora do escopo, mas o JSDoc do campo (D-01) é obrigatório, porque R-B e R2 dependem dele.

## 8. Pendências

1. **Decisão de produto sobre RF-08/RF-09 para header (R-A).** Recomendação: aceitar a limitação e ajustar o PRD. Enquanto não houver decisão, a implementação segue D-05.
2. Confirmar onde ficam os testes de tipo (`test/unit/` ou `pnpm typecheck` direto), porque o repositório tem `types.test-d.ts` em `test/unit/` (AGENTS.md).
3. Documentação de `extraUnsealPasswords` em `docs/` e entrada no `CHANGELOG.md`, quando o time quiser (fora de escopo do PRD).
