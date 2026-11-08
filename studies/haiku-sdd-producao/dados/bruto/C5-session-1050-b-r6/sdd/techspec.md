# Especificação técnica — Múltiplas senhas de unseal nas sessões

Referências: `sdd/pedido.md` (contrato #1050-b), `sdd/prd.md` (RF-01 a RF-10) e issue h3js/h3#1050.
Linha de base: `pnpm vitest run test/session.test.ts test/cookies.test.ts` passa com 194 testes e sem erros de tipo.

## Resumo

Adicionar `extraUnsealPasswords?: string[]` a `SessionConfig`. `unsealSession` passa a tentar `password` e depois cada extra, na ordem, até uma abrir a selagem. Toda selagem continua usando `password`. Nenhum outro nome público é criado. O resto do fluxo (expiração, cookie, header, reselagem) já passa por `unsealSession`, então não precisa de mudança.

## Decisões de arquitetura

### D-01 — Tentativa em sequência dentro de `unsealSession`

**Contexto.** Hoje `unsealSession` chama `unseal(sealed, config.password, ...)` em duas linhas (`src/utils/session.ts:324` e `src/utils/session.ts:340`). Precisamos repetir a chamada para cada senha.

**Alternativas consideradas.**

1. **Passar um `PasswordHash` ao iron.** O iron já aceita um objeto `{ id: senha }` e escolhe a senha pelo `id` do payload (`src/utils/internal/iron-crypto.ts:124-125`). Descartado: esse mecanismo foi feito para identificadores de chave (`kid`), que estão fora de escopo. Senhas string usam o id `"default"` (`src/utils/internal/iron-crypto.ts:121`), então as sessões atuais não teriam id gravado. Além disso, o iron não tenta a próxima entrada depois de um HMAC inválido. Seria preciso mudar o payload selado, o que o PRD proíbe.
2. **Lista de senhas dentro do `iron-crypto.ts`** (`unseal` aceitando `string[]`). Descartado: mexe num módulo vendorizado, aumenta a superfície de teste e não traz nada que o loop na sessão não faça.
3. **Loop em `src/utils/session.ts`, com um helper interno não exportado.**

**Escolha: 3.** A mudança fica no módulo que já cuida da sessão, e o helper não entra em `src/index.ts`.

Forma esperada:

```ts
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>> {
  const sealOptions = { ...sealDefaults, ttl: (config.maxAge || config.idleTimeout || 0) * 1000, ...config.seal };
  const passwords = new Set([config.password, ...(config.extraUnsealPasswords ?? [])]);
  let unsealed: Partial<Session> = {};
  let found = false;
  let lastError: unknown;
  for (const password of passwords) {
    try {
      unsealed = await unsealWithPassword(sealed, password, sealOptions, config);
      found = true;
      break;
    } catch (error) {
      if (!isBadHmac(error)) throw error;
      lastError = error;
    }
  }
  if (!found) throw lastError;
  // ... maxAge e idleTimeout inalterados
}
```

**Nota.** Use uma flag `found` em vez de testar `unsealed` por verdade. `unseal` tem um ramo que retorna `null` (`src/utils/internal/iron-crypto.ts:149`), e a checagem por verdade trataria esse caso como "nenhuma senha abriu". A flag `kLegacySeal` é marcada dentro do helper, como hoje (`src/utils/session.ts:345-347`).

### D-02 — Quais erros passam para a próxima senha

**Alternativas.**

1. **Continuar só no erro `"Bad hmac value"`.** Este é o único erro que depende da senha.
2. **Continuar em qualquer erro.** Descartado: erros como `"Expired seal"` (`src/utils/internal/iron-crypto.ts:110-118`) e `"Wrong mac prefix"` (`src/utils/internal/iron-crypto.ts:106-108`) não dependem da senha. Tentar as extras só gastaria PBKDF2 para o mesmo resultado.

**Escolha: 1.** O comportamento para `password` sozinha não muda: qualquer outro erro sai na hora, como hoje.

**Consequência.** Uma extra malformada (vazia ou curta demais) lança erro do iron (`src/utils/internal/iron-crypto.ts:172-174` e `src/utils/internal/iron-crypto.ts:191-196`). Esse erro não é `"Bad hmac value"`, então interrompe a lista e impede as extras seguintes. Como `getSession` engole erros de `unsealSession` (`src/utils/session.ts:197`), o efeito é uma sessão nova, sem aviso. Ver risco R-02.

### D-03 — Ordem e duplicatas

`new Set([config.password, ...extras])` mantém a ordem de declaração, com `password` primeiro, e remove repetições. Se a mesma senha aparecer duas vezes, ela não custa outra derivação.

**Alternativas.** Não remover duplicatas (mais simples, mas gasta CPU à toa). Validar a lista ao criar a configuração (descartado: mudaria a superfície de erros e exigiria um ponto de validação que hoje não existe).

### D-04 — Selagem sempre com `password`

Nenhuma mudança em `sealSession`. Ela continua selando com `config.password` (`src/utils/session.ts:300-304`). `updateSession` (`src/utils/session.ts:267`) também não muda. Isso atende RF-03: uma sessão aberta por extra é regravada com `password` na próxima escrita ou reselagem.

**Alternativa descartada.** Selar com a primeira senha que abriu a sessão. Violaria RF-03 e criaria sessões cujo selo depende da história da requisição.

### D-05 — Expiração independe da senha que abriu

`maxAge` e `idleTimeout` são verificados depois da abertura, sobre o payload (`src/utils/session.ts:350-365`). O `ttl` do selo vem de `sealOptions` (`src/utils/session.ts:317-321`), que não depende de senha. Nenhuma mudança é necessária. Isso atende RF-08.

### D-06 — Cookie e header passam pelo mesmo caminho

`getSession` lê o header `x-{name}-session` ou `sessionHeader` (`src/utils/session.ts:178-187`) e o cookie (`src/utils/session.ts:190-193`), e os envia ao mesmo `unsealSession` (`src/utils/session.ts:196`). Nenhuma mudança é necessária. Isso atende RF-05, mas precisa de teste, porque é o que garante a cobertura do header.

### D-07 — Reselagem de sessões abertas por extra

Não há migração proativa. As regras atuais continuam:
- Sessão de legado (`legacySeal`) lida do cookie é regravada (`src/utils/session.ts:214-216`).
- Sessão com `idleTimeout` que passou de metade da janela é regravada, só pelo cookie (`src/utils/session.ts:414-421`).
- Qualquer outra sessão continua selada com a senha antiga até a próxima escrita ou expiração. Isso está em conformidade com o PRD (fora de escopo: migração proativa).

### D-08 — Validação de tamanho das extras

O PRD diz que "hoje não há validação em runtime do tamanho mínimo de `password`". **Isso está incorreto.** O iron rejeita senhas string menores que `minPasswordlength` em `generateKey` (`src/utils/internal/iron-crypto.ts:191-196`), e o padrão é 32 (`src/utils/internal/iron-crypto.ts:22` e `src/utils/internal/iron-crypto.ts:28`). Essa validação vale para seal e unseal, e para qualquer valor configurado em `seal`.

**Escolha.** Não adicionar validação própria. As extras passam pela mesma verificação do iron, então o limite é o mesmo de `password`. O JSDoc deve dizer isso. Ver R-02 para o efeito de uma extra curta.

### D-09 — Limite no número de extras

**Alternativas.** Impor um teto fixo (por exemplo, 4) com erro de configuração. Não impor nada e documentar o custo.

**Escolha: não impor limite nesta entrega.** O custo é linear e fica documentado (ver R-01). O PRD deixa essa decisão como pendente; se o time quiser um teto, é uma mudança pequena em `unsealSession` antes do loop.

### D-10 — Local dos testes

Um arquivo novo, `test/session-unseal-passwords.test.ts`, em vez de adicionar a `test/session.test.ts`. Esse arquivo já tem 777 linhas e a convenção do repositório pede arquivos curtos. O novo arquivo usa `describeMatrix` (`test/_setup.ts:11`) e reaproveita o padrão de `test/session.test.ts:21-25` e `test/session.test.ts:15-37`.

### D-11 — Idioma da documentação

O JSDoc de `src/utils/session.ts` está em inglês (`src/utils/session.ts:40-48`). O novo JSDoc de `extraUnsealPasswords` segue o mesmo idioma. O PRD está em português, mas o texto do código não.

**Documentação adicional recomendada (fora do critério de RF-09).** Uma seção curta em `docs/4.examples/handle-session.md`, perto de "Use Multiple Sessions" (`docs/4.examples/handle-session.md:190`), sobre rotação de senha. O AGENTS.md pede que a documentação acompanhe as mudanças de arquitetura. Não alterar `CHANGELOG.md`.

## Contratos e assinaturas

### `SessionConfig` (`src/utils/session.ts:39`)

Campo novo, depois de `password` (`src/utils/session.ts:48`):

```ts
/**
 * Previous passwords that still open sessions sealed before a rotation. They are
 * tried only when `password` cannot open a session, in declaration order, and are
 * never used to seal: sealing always uses `password`.
 *
 * Each entry needs the same entropy as `password`, and is subject to the same
 * minimum length. Remove an entry once the longest `maxAge` (or `idleTimeout`)
 * of the sessions it sealed has passed. Every entry adds one PBKDF2 derivation
 * per request that carries an invalid session cookie.
 */
extraUnsealPasswords?: string[];
```

O JSDoc cobre os quatro pontos de RF-09 e não contradiz o de `password` (`src/utils/session.ts:40-47`).

### Funções públicas

- `useSession`, `getSession`, `updateSession`, `clearSession`, `sealSession`: assinaturas inalteradas.
- `unsealSession(event, config, sealed)`: assinatura inalterada (`src/utils/session.ts:312-316`). O comportamento muda apenas quando há extras.
- `src/index.ts:208-209` continua exportando os mesmos nomes. Nenhuma exportação nova.

### Helper interno (não exportado)

```ts
async function unsealWithPassword(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
  config: SessionConfig,
): Promise<Partial<Session>>
// Tenta unseal com as opções normais. Se falhar com "Bad hmac value" e o fallback
// legado estiver ativo (config.legacySealFallback !== false, iterations !== 1),
// tenta de novo com 1 iteração e marca kLegacySeal. Outros erros são relançados.
```

```ts
function isBadHmac(error: unknown): boolean
// error instanceof Error && error.message === "Bad hmac value"
```

Este helper extrai a lógica atual de `src/utils/session.ts:323-348` sem mudar a condição de fallback. O único ajuste é que a flag `kLegacySeal` passa a ser marcada dentro do helper.

Nenhuma mudança em `src/utils/internal/iron-crypto.ts`, `src/utils/internal/session.ts` ou `src/index.ts`.

## Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/session.ts:48` | Adicionar o campo `extraUnsealPasswords` com JSDoc (D-11). |
| `src/utils/session.ts:312-348` | Trocar as duas chamadas diretas a `unseal` pelo loop e pelo helper `unsealWithPassword` (D-01, D-02, D-03). |
| `test/session-unseal-passwords.test.ts` | Arquivo novo com os testes da seção seguinte (D-10). |
| `docs/4.examples/handle-session.md:190` | Seção curta sobre rotação de senha (D-11, recomendado). |

Não alterar: `sealSession` (`src/utils/session.ts:282-307`), `getSession` (`src/utils/session.ts:149-232`), `updateSession`, `clearSession`, `src/utils/internal/iron-crypto.ts`, `src/index.ts`, `src/_deprecated.ts`, `CHANGELOG.md`.

## Estratégia de testes

Todos os testes novos usam `describeMatrix` (web e node). Usam `sessionConfig` com `generateId` previsível, como em `test/session.test.ts:21-25`, e `seal`/`unseal` de `src/utils/internal/iron-crypto.ts`, como em `test/session.test.ts:12` e `test/session.test.ts:134-159`.

| Caso | RF | Como verificar |
| --- | --- | --- |
| Abre sessão selada com extra e preserva o `id` e os dados | RF-02 | Selar com `"antiga"`, ler com `password: "nova"` e `extraUnsealPasswords: ["antiga"]`. Esperar o mesmo `id`. |
| Abre com a segunda extra | RF-02 | Lista `["x…", "antiga"]`. Esperar sucesso. |
| Senha desconhecida vira sessão nova, sem exceção | RF-04 | Selar com `"outra"`. Esperar `id` novo, `data` vazio e resposta 200. |
| Escrita regrava com `password` | RF-03 | Ler com extra, chamar `update`. `unseal` com `"nova"` abre; `unseal` só com `"antiga"` rejeita com `"Bad hmac value"`. |
| Header de sessão aberto por extra | RF-05 | Enviar a sessão selada com `"antiga"` no header `x-h3-test-session`. Esperar o `id` original. |
| Fallback legado sob extra | RF-06 | Selar com 1 iteração sob `"antiga"`. Com fallback padrão, esperar reselagem com `"nova"`. Com `legacySealFallback: false`, esperar sessão nova. |
| `maxAge` vale para sessão aberta por extra | RF-08 | `createdAt` antigo com `maxAge` curto. Esperar sessão nova. |
| `[]` e ausência do campo são iguais | RF-07 | Repetir o caso base com `extraUnsealPasswords: []`. Os testes existentes de `test/session.test.ts` continuam sem mudança. |
| Extra que não abre não lança erro | RF-04 | Cookie selado com senha fora da lista, extras com uma senha válida e não relacionada. Esperar sessão nova. |
| Extra curta é tratada como erro de configuração | R-02 | Extra com menos de 32 caracteres, cookie selado por `password` inválida. Esperar sessão nova e nenhum erro propagado para o handler. Documenta o comportamento. |
| Ordem: `password` antes das extras | D-03 | Sessão selada com `password` abre mesmo com extras que não batem, e o resultado é o da senha atual. Cobre o resultado, não a contagem de derivações. |

**Regressão.** Rodar `pnpm vitest run test/session.test.ts test/cookies.test.ts`. Deve continuar em 194 testes passando.

**Tipos.** `pnpm typecheck` (`package.json:54`), que cobre o campo novo e o teste que o usa. RF-01 é verificado pelo typecheck, sem arquivo `types.test-d.ts` novo.

**Lint e formato.** `pnpm lint` (`package.json:46`) e `pnpm fmt` se algo sair do padrão. O loop com `await` dentro de `for` pode ser sinalizado por alguma regra do oxlint. Se for, a correção é a regra mais estreita possível, não desligar a regra globalmente.

**Suíte completa.** `pnpm test` (`package.json:53`) antes de abrir a entrega.

**Ordem de trabalho (correção de bug, conforme AGENTS.md).** Primeiro escrever os testes novos e ver que falham onde deveriam (RF-02, RF-05, RF-06). Depois mudar `unsealSession`. Depois confirmar que todos passam e rodar a suíte completa.

## Riscos

**R-01 — Custo de CPU amplificado (PRD).** Um cookie com HMAC inválido custa uma derivação de 8192 iterações por senha tentada (`src/utils/internal/iron-crypto.ts:133`, usando `opts.integrity.iterations`). Com o fallback legado ativo, cada senha pode custar mais uma derivação de 1 iteração (`src/utils/session.ts:340-344`). Ou seja, o custo sobe linearmente com o número de senhas. Medida: documentação no JSDoc e decisão D-09 em aberto. Recomendação: manter sem teto, com a documentação, e reavaliar se a lista crescer.

**R-02 — Extra malformada bloqueia as seguintes e falha em silêncio.** Uma extra vazia ou curta lança erro que não é `"Bad hmac value"` (D-02). A lista para ali, e `getSession` transforma o erro em sessão nova (`src/utils/session.ts:197`). Mitigação: JSDoc (D-11) e teste de caso curto. Não há log, porque a biblioteca não tem logger.

**R-03 — Depender do texto `"Bad hmac value"`.** O loop e o fallback legado comparam a mensagem de erro (`src/utils/session.ts:336`). A mensagem vem de `src/utils/internal/iron-crypto.ts:136`. Esse arquivo é vendorizado no próprio repositório, então uma mudança ali é visível aqui e o teste de fallback legado pega. Mesmo assim, o acoplamento a uma string é frágil. Não é bloqueio para esta entrega.

**R-04 — Premissa do PRD sobre tamanho mínimo.** O PRD diz que não há validação em runtime. Na prática, o iron valida (D-08). Recomendação: corrigir essa frase no PRD antes de fechar a entrega, para que a documentação não diga o contrário do código.

**R-05 — Vazamento de temporização (baixo).** Um cookie selado por uma extra leva mais tempo para ser aberto do que um selado por `password`, porque a tentativa com `password` falha antes. Um atacante que mede tempo consegue saber qual versão de senha selou um cookie. Isso não permite forjar sessão, porque o HMAC continua sendo verificado. Risco baixo, aceito.

**R-06 — Senha antiga vazada (PRD).** Enquanto a extra estiver na configuração, quem a tiver pode forjar sessões válidas. A rotação não revoga sessões. Mitigação: RF-09 e a orientação de remover a extra depois da janela.

**R-07 — Rotação sem prazo (PRD).** Esquecer a extra depois da janela mantém a porta aberta. Mitigação: documentação. Não há mecanismo de expiração das extras nesta entrega (fora de escopo).

**R-08 — Deploy misto (PRD).** Instâncias antigas não abrem sessões seladas com a nova `password`. Ordem recomendada: implantar com `password` antiga e `extraUnsealPasswords: [nova]`; depois trocar `password` para a nova. Documentar essa ordem na seção de docs (D-11).

**R-09 — Sessões sem escrita e sem expiração (PRD).** Continuam seladas com a senha antiga. Remover a extra antes disso as desloga. Coberto pela documentação.

**R-10 — Sessões lidas por extra via header não são regravadas (D-07).** Continuam seladas com a senha antiga até expirar. Comportamento igual ao atual para header (`src/utils/session.ts:178-187` e a nota de `idleTimeout` em `src/utils/session.ts:64-65`).
