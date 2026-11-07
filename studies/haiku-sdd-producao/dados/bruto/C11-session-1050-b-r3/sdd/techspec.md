# Especificação técnica — Múltiplas senhas de unseal nas sessões

Referências: `sdd/pedido.md` (contrato #1050-b), `sdd/prd.md` (RF-01 a RF-06) e issue h3js/h3#1050.

Esta especificação não altera código. Todas as citações `arquivo:linha` foram conferidas na árvore atual do repositório.

## Visão geral

O mecanismo de abertura de sessão hoje tem um único ponto de decisão: `unsealSession` tenta abrir o selo com `config.password` e, se a falha for `Bad hmac value`, tenta de novo com a contagem legada de iterações PBKDF2. A mudança acrescenta uma lista de senhas anteriores que só são tentadas depois de `password`, marca a sessão quando ela foi aberta por uma dessas senhas e reselha a sessão com `password` quando ela chega por cookie. Não há mudança de formato do selo, nem de assinatura de função pública.

Fluxo resultante em `getSession`:

1. Valida `extraUnsealPasswords` (RF-06), antes de qualquer mutação do contexto.
2. Lê o cookie. Se houver, `unsealSession` tenta `password` e depois cada extra.
3. Se a sessão foi aberta por uma extra, ou é legada, ou precisa deslizar a janela, reselha com `password` (RF-03).
4. Os prazos `maxAge` e `idleTimeout` são checados uma vez, depois da abertura, sem depender da senha usada (RF-05).

---

### D-01 — Tentativas de senha dentro de `unsealSession`, não em `iron-crypto`

**Decisão.** O laço sobre `[config.password, ...extraUnsealPasswords]` fica em `unsealSession` (`src/utils/session.ts:312`). `unseal` em `src/utils/internal/iron-crypto.ts:87` continua recebendo uma senha por chamada.

**Alternativas consideradas.**

- Passar um objeto `{ [id]: password }` para `unseal`. A função já suporta isso (`iron-crypto.ts:121-127`), mas a seleção depende do `passwordId` gravado no token. Como o selo atual sempre usa id vazio (`defaults` e `normalizePassword`), seria preciso gravar um id no token: mudança de formato, excluída pelo PRD.
- Laço em `getSession`. Misturaria a lógica de abertura com a de carregamento e duplicaria a regra do fallback legado.

**Justificativa.** `unsealSession` já é o ponto que a premissa do PRD aponta e já concentra o fallback legado. Manter a regra ali torna a ordem `password` → extras → legado por senha uma propriedade de um único lugar.

### D-02 — Tentar a próxima senha só em `Bad hmac value`

**Decisão.** O laço só avança para a próxima senha quando o erro é exatamente `Bad hmac value` (a mesma condição que o fallback legado já usa, `session.ts:336`). Qualquer outro erro é relançado de imediato.

**Alternativas consideradas.**

- Tentar a próxima senha em qualquer erro. Faria um cookie malformado ou expirado gastar derivações PBKDF2 à toa, e esconderia erros como `Password string too short`.

**Justificativa.** Os erros que não são de HMAC (`Wrong mac prefix`, `Incorrect number of sealed components`, `Expired seal`) são verificados em `iron-crypto.ts:98-118`, antes de qualquer derivação. Relançá-los de imediato mantém o custo e as mensagens iguais aos de hoje. Com a lista vazia, o caminho é idêntico ao atual.

### D-03 — Sinalizar a abertura por senha extra com um símbolo interno

**Decisão.** `unsealSession` marca o objeto devolvido com `kExtraUnsealPassword` (novo símbolo em `src/utils/internal/session.ts`, no mesmo padrão de `kLegacySeal`, `internal/session.ts:7-9`). `getSession` lê e apaga a marca antes de `Object.assign(session, unsealed)` (hoje `session.ts:199-208`), exatamente como faz com `kLegacySeal`.

**Alternativas consideradas.**

- Devolver uma tupla `[session, passwordIndex]`. Mudaria o tipo de retorno de `unsealSession`, que é exportada publicamente (`src/index.ts:209`). Quebraria quem a usa diretamente.
- Comparar o cookie com o resultado de `sealSession` para descobrir a senha. Custa uma derivação extra e não é confiável.

**Justificativa.** Preserva a assinatura pública e reaproveita um padrão já validado. O `delete` antes do `Object.assign` é o que impede a marca de vazar para `session` e, portanto, para o payload selado, porque `sealSession` serializa o objeto de sessão inteiro (`session.ts:300`).

### D-04 — Validar `extraUnsealPasswords` no início de `getSession`

**Decisão.** Uma função de validação em `src/utils/internal/session.ts` é chamada logo no começo de `getSession` (`session.ts:149`), antes de `context.sessions` ser tocado. Ela checa cada entrada: deve ser `string` e ter pelo menos `Math.max(encryption.minPasswordlength, integrity.minPasswordlength)` caracteres, com os mesmos valores de `iron-crypto.ts:22` e `:28` (ou os sobrescritos em `config.seal`). A mensagem cita o índice (`extraUnsealPasswords[0]`) e nunca o valor.

**Alternativas consideradas.**

- Deixar o erro de `generateKey` (`iron-crypto.ts:192-195`) aparecer durante a abertura. Ele é lançado dentro de `unsealSession` e engolido por `.catch(() => {})` em `session.ts:197`, que trata a sessão como nova. É exatamente o erro silencioso que RF-06 proíbe.
- Validar dentro de `unsealSession`. Também seria engolido pelo mesmo `.catch`.

**Justificativa.** `getSession` é o único ponto de entrada de leitura comum a `useSession`, `getSession` e `updateSession` (que chama `getSession` quando o contexto está vazio). Validar antes do `try` garante que a configuração inválida apareça para o desenvolvedor mesmo quando não há cookie. `updateSession` com contexto já carregado não revalida, o que é aceitável porque a sessão já passou por `getSession`.

Não validamos `password` aqui. Esse comportamento não muda, e o PRD não pede.

### D-05 — Fallback legado por senha, não depois de todas as senhas

**Decisão.** Para cada senha, a ordem é: abertura estrita e, se der `Bad hmac value` e `legacySealFallback !== false`, abertura com 1 iteração. Só então a próxima senha. Isso segue a premissa do PRD (`prd.md:76`).

**Alternativas consideradas.**

- Todas as senhas estritas primeiro, depois o legado de todas. Reduziria o custo para sessões modernas seladas com uma extra em cenários de fallback, mas contraria a premissa do PRD e complica a lógica.

**Justificativa.** Segue o PRD e mantém a regra local a uma senha. O custo extra está registrado nos riscos.

### D-06 — Migração de sessão pela mesma condição de reselagem

**Decisão.** Em `getSession`, a condição de reselagem (`session.ts:214`) vira `legacySeal || extraSeal || shouldSlide(session, config)`. Vale apenas para `sessionFromCookie`, como hoje. Sessões lidas pelo header não são resseladas e continuam abertas pela extra enquanto ela existir (PRD, fora de escopo).

**Justificativa.** Reutiliza `updateSession`, que já sela com `config.password` (D-02 do PRD: escrita sempre com `password`) e já emite o `Set-Cookie` com `expires` correto (`session.ts:266-272`). Não cria caminho novo de escrita.

### D-07 — Prazos conferidos uma única vez, depois da abertura

**Decisão.** As verificações de `maxAge` (`session.ts:350-355`) e de `idleTimeout` (`session.ts:359-365`) ficam depois do laço, sem alteração. Elas usam `createdAt` e `lastSeenAt` do payload, que não dependem da senha.

**Justificativa.** Atende RF-05 sem código novo. Como a expiração é checada antes da reselagem, a migração não renova `createdAt`, e `sessionExpires` (`session.ts:455-464`) continua calculando o cookie a partir dele.

### D-08 — Tipo público: campo opcional `extraUnsealPasswords?: string[]`

**Decisão.** O campo é acrescentado a `SessionConfig` logo após `password` (`session.ts:48`), com JSDoc que diz: sela nunca; abre depois de `password`; cada uma com pelo menos 32 caracteres; sessões abertas por ela são resseladas por cookie; a janela deve ser maior que `maxAge` ou `idleTimeout`; custo de PBKDF2 por entrada.

**Alternativas consideradas.**

- Aceitar `password: string | string[]`. Excluída pelo PRD (fora de escopo, alternativa 2 da issue).
- Tipo `readonly string[]`. Mais restritivo que o restante da configuração, que usa tipos mutáveis, e não traz ganho aqui.

**Justificativa.** O PRD exige que nenhum outro nome público novo seja criado (`pedido.md`, Restrições).

---

## Arquivos a alterar

| Arquivo | Onde | Mudança |
| --- | --- | --- |
| `src/utils/session.ts` | `session.ts:48` | Acrescentar `extraUnsealPasswords?: string[]` com JSDoc (D-08). |
| `src/utils/session.ts` | `session.ts:149-153` | Chamar a validação antes de `context.sessions` (D-04). |
| `src/utils/session.ts` | `session.ts:197-201` | Ler e apagar `kExtraUnsealPassword`, ao lado de `kLegacySeal` (D-03). |
| `src/utils/session.ts` | `session.ts:214-216` | Acrescentar `extraSeal` à condição de reselagem (D-06). |
| `src/utils/session.ts` | `session.ts:312-348` | Laço sobre as senhas, com o corpo atual de `try/catch` movido para um helper por senha (D-01, D-02, D-05). |
| `src/utils/session.ts` | `session.ts:350-365` | Sem mudança; os prazos continuam depois da abertura (D-07). |
| `src/utils/internal/session.ts` | `internal/session.ts:7-9` | Novo símbolo `kExtraUnsealPassword`, com `Symbol.for` no mesmo padrão. |
| `src/utils/internal/session.ts` | fim do arquivo | Função `assertExtraUnsealPasswords` (D-04). |
| `test/session-unseal-passwords.test.ts` | arquivo novo | Testes de RF-01 a RF-06 com `describeMatrix` (ver Estratégia de testes). |
| `docs/4.examples/handle-session.md` | após `handle-session.md:183` | Seção sobre rotação de senha, janela, custo e limite com header. |

Não alterar `src/index.ts`, que já exporta `SessionConfig` (`src/index.ts:203`) e `unsealSession` (`src/index.ts:209`). Não alterar `iron-crypto.ts`. Não editar `CHANGELOG.md` à mão, pois as entradas seguem o formato gerado no release (ex.: `CHANGELOG.md:374`).

`docs/2.utils/4.security.md:56-62` documenta `unsealSession` sem os detalhes de assinatura. Confirmar se o arquivo é gerado pelo automd antes de editá-lo (`pnpm fmt` roda automd).

**Tamanho de arquivo.** `session.ts` já tem 464 linhas, acima da meta de `AGENTS.md` (< 200). Esta mudança acrescenta cerca de 40 linhas. Para não piorar o caso, o helper por senha pode ir para `src/utils/internal/session.ts`, junto da validação. `unsealSession` continua em `session.ts`, porque precisa ser exportada de lá.

---

## Contratos e assinaturas

### Tipo público

```ts
// src/utils/session.ts — dentro de SessionConfig, logo após `password`
/**
 * Previous passwords still accepted to unseal sessions, tried in order after
 * `password`. They never seal: every write uses `password`, and a session
 * opened with one of them is resealed with `password` on the same request
 * when it is read from a cookie. Each must be at least 32 characters.
 *
 * Keep the window longer than `maxAge` or `idleTimeout`, then remove the
 * entries. Each entry adds one PBKDF2 derivation to every request that
 * presents an invalid cookie.
 */
extraUnsealPasswords?: string[];
```

Nenhuma outra assinatura pública muda. `useSession`, `getSession`, `updateSession`, `sealSession` e `unsealSession` mantêm os parâmetros e os tipos de retorno.

### Interno

```ts
// src/utils/internal/session.ts
export const kExtraUnsealPassword: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.extra-unseal-password",
);

/**
 * Throws if an extra unseal password is not a string of at least the seal's
 * minimum length. The error names the index, never the value.
 */
export function assertExtraUnsealPasswords(config: SessionConfig): void;
```

Mensagem de erro: `Invalid extraUnsealPasswords[${index}]: must be a string of at least ${min} characters`. Sem o valor.

### Esboço de `unsealSession` (assinatura inalterada)

```ts
// Esboço, não é código final
export async function unsealSession(_event, config, sealed): Promise<Partial<Session>> {
  const sealOptions = { ...sealDefaults, ttl: (config.maxAge || config.idleTimeout || 0) * 1000, ...config.seal };
  const passwords = [config.password, ...(config.extraUnsealPasswords || [])];
  let unsealed: Partial<Session> | undefined;
  for (const [index, password] of passwords.entries()) {
    try {
      unsealed = await unsealWithPassword(sealed, password, sealOptions, config.legacySealFallback);
      if (index > 0) (unsealed as any)[kExtraUnsealPassword] = true;
      break;
    } catch (error) {
      const retry = error instanceof Error && error.message === "Bad hmac value";
      if (!retry || index === passwords.length - 1) throw error;
    }
  }
  // maxAge e idleTimeout, inalterados (session.ts:350-365)
  return unsealed!;
}
```

`unsealWithPassword` recebe a senha como argumento e contém o corpo atual do `try/catch` de `session.ts:324-347`, incluindo a marca `kLegacySeal`. `legacySealFallback === false` continua relançando `Bad hmac value`, e o laço então tenta a próxima senha.

### Esboço de `getSession` (trechos alterados)

```ts
// Esboço, não é código final
assertExtraUnsealPasswords(config); // antes de context.sessions
// ...
const extraSeal = unsealed && (unsealed as any)[kExtraUnsealPassword];
if (extraSeal) delete (unsealed as any)[kExtraUnsealPassword];
// ...
if (session.id && sessionFromCookie && (legacySeal || extraSeal || shouldSlide(session, config))) {
  await updateSession(event, config);
}
```

---

## Estratégia de testes

Seguir o fluxo de bug fix do `AGENTS.md`: escrever os testes de regressão primeiro e confirmar que os de comportamento novo falham antes da mudança.

Arquivo novo `test/session-unseal-passwords.test.ts`, com `describeMatrix` (`test/_setup.ts:11`), no mesmo padrão de `test/session.test.ts:15-37`. O arquivo existente tem 777 linhas, e a regra de tamanho do `AGENTS.md` favorece um arquivo novo. Usar `seal`/`unseal` de `src/utils/internal/iron-crypto.ts` e `defaults as sealDefaults`, como `test/session.test.ts:12` faz, para gerar cookies com a senha B.

| Teste | RF | Esperado antes da mudança | Esperado depois |
| --- | --- | --- | --- |
| Cookie selado com B (`password: A`, extras `[B]`) mantém `id`, `createdAt` e `data` | RF-01 | Falha: sessão nova, `id` diferente | Passa |
| `updateSession` e `useSession.update` gravam cookie que abre só com A | RF-02 | Passa (não há extra) | Passa; `unseal` com B lança |
| Leitura de cookie com B devolve `Set-Cookie` com selo que abre com A e não com B; dados iguais | RF-03 | Falha: sem `Set-Cookie` | Passa |
| Sem `extraUnsealPasswords`, cookie com outra senha vira sessão nova; cookie legado ainda é resselado | RF-04 | Passa | Passa (regressão) |
| Cookie com B e `maxAge` expirado: sessão descartada, nenhum dado herdado; idem com `idleTimeout` | RF-05 | Falha: se a extra não existe, sessão nova (passa por acidente) | Passa; usar `vi.useFakeTimers({ toFake: ["Date"] })` como em `test/session.test.ts:313` |
| `extraUnsealPasswords: ["curta"]` causa erro nomeando o índice, em `getSession` e `useSession`, mesmo sem cookie | RF-06 | Falha: erro engolido, sessão nova | Passa |
| Uma senha extra inválida não vaza o valor na mensagem | RF-06 | Não aplicável | Passa |
| Cookie sealed com B com `legacySealFallback: false` e cookie legado com B | D-05 | Não aplicável | Passa: legado com B é rejeitado sem fallback |
| Cookie com `id` de B não vaza `kExtraUnsealPassword` para o payload selado | D-03 | Não aplicável | Passa: `unseal` do `Set-Cookie` não contém a marca |
| Cookie inválido com `N` extras faz `1 + N` derivações (strict) | Risco de custo | Não aplicável | Passa; espionar `crypto.subtle.deriveBits` como em `test/session.test.ts:722-735` |
| Sessão aberta por B via header não é resselada | PRD, fora de escopo | Não aplicável | Passa: sem `Set-Cookie` |

Para RF-06 é preciso capturar o erro dentro de uma rota (`try/catch` no handler), porque erros não tratados contam como falha do `ctx.errors` (`AGENTS.md`).

Não alterar os testes existentes, exceto se algum depender de comportamento que mudou. Nenhum deve mudar: sem extras, o caminho é o mesmo. Conferir em particular `test/session.test.ts:134-159` (legado), `:722-735` (contagem de derivações) e `:410-476` (throttle).

**Comandos de verificação.**

```bash
pnpm vitest run test/session-unseal-passwords.test.ts
pnpm vitest run test/session.test.ts test/unit/iron-crypto.test.ts
pnpm lint          # oxlint, oxfmt --check e typecheck
pnpm test          # suíte completa com cobertura
```

---

## Riscos

1. **Vazamento da marca interna.** Se `kExtraUnsealPassword` não for apagado antes de `Object.assign`, ele entra em `session` e, depois, no payload. Mitigação: D-03 e o teste de payload selado acima.
2. **Custo por cookie inválido.** Com `N` extras, cada cookie inválido custa até `1 + N` derivações estritas, e o dobro com fallback legado. Mitigação: validação de tamanho, documentação do custo e recomendação de lista curta (PRD, Riscos).
3. **Custo para sessões das extras.** Por D-05, uma sessão aberta pela segunda senha gasta duas derivações a mais que a primeira. Aceitável para uma janela de rotação. Se virar problema, a ordem alternativa de D-05 é a saída.
4. **Janela de rotação esquecida.** A senha antiga continua valendo enquanto estiver na lista. Mitigação: documentação; não há mecanismo automático, por escolha do PRD.
5. **Escrita perdida com requisições concorrentes.** A reselagem de migração escreve `Set-Cookie` em uma requisição de leitura, e a última resposta aplicada pelo navegador vence. O mesmo aviso já existe em `docs/4.examples/handle-session.md:183` para `idleTimeout`. A migração acontece uma vez por sessão, então a exposição é menor, mas o aviso precisa ser repetido.
6. **Sessões por header.** Continuam dependendo da extra até ela sair da lista. Mitigação: documentação (PRD).
7. **Entradas repetidas ou iguais a `password`.** Não são deduplicadas. Custam derivações sem benefício. Mitigação: documentar; deduplicar seria um passo a mais de código sem ganho real de segurança.
8. **Métodos públicos de baixo nível.** `unsealSession` pode ser chamada diretamente (`src/index.ts:209`). Com a lista vazia, o comportamento é idêntico. Com a lista preenchida, ela passa a tentar as extras, o que é o comportamento desejado. A validação de RF-06 não roda nesse caminho, porque o escopo do RF-06 é `useSession`/`getSession`. Um erro de senha curta, nesse caso, aparece como erro de unseal.
9. **Recolocar a senha antiga como `password`.** Não há mecanismo para isso, e não é necessário. Se alguém trocar `password` pela senha antiga, sessões seladas com a nova senha deixam de abrir até que ela volte para a lista. Documentar.
10. **Regressão do `.catch(() => {})`.** Qualquer erro novo lançado dentro de `unsealSession` continua sendo engolido por `getSession`. O teste de RF-06 cobre o caso da validação; erros de outra natureza não têm cobertura nova. Aceitável, porque é o comportamento atual.
