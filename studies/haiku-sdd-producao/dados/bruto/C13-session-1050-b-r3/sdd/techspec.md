# Especificação técnica: várias senhas de unseal nas sessões (h3js/h3#1050)

Base: `sdd/pedido.md` (contrato #1050-b) e `sdd/prd.md` (RF-01 a RF-07). Esta especificação foi escrita a partir da leitura do código em `master` (commit `039870e`). Nada foi executado ainda.

## Resumo

`SessionConfig` ganha `extraUnsealPasswords?: string[]`. `password` continua selando. Na leitura, `unsealSession` tenta `password` e depois cada senha extra, na ordem, e aceita a primeira que abre o selo. Quando a abertura usa uma senha extra, `getSession` regrava o cookie com `password`. Sem senhas extras, o caminho de código e os erros são os de hoje.

## Premissas corrigidas

- **RF-07 não tem validação existente para reutilizar.** `src/utils/session.ts` não valida `password`. O tamanho mínimo é imposto pela biblioteca de selo, em `src/utils/internal/iron-crypto.ts:191-196` (`Password string too short`) e `:94-96` (`Empty password`). Além disso, `getSession` engole qualquer erro de `unsealSession` em `src/utils/session.ts:197` (`.catch(() => {})`). Se a validação não for feita explicitamente, uma senha extra curta falha em silêncio, que é o que o RF-07 proíbe. A validação será nova, em H3, e roda antes do `.catch`.
- **`password` continua sem validação própria.** Uma senha curta na configuração atual já falha em silêncio na leitura e lança na escrita. Corrigir isso muda o comportamento de quem já usa a biblioteca, então fica fora desta entrega (RF-04). Ver D-04.

## Decisões de arquitetura

### D-01 — Rotação por campo extra no `SessionConfig`

**Escolha:** campo opcional `extraUnsealPasswords?: string[]` em `SessionConfig`. `password` continua `string`.

**Alternativas consideradas:**
- `password: string | string[]` (segunda alternativa da issue). Descartada: fora de escopo no PRD, e muda o tipo de um campo público já existente.
- Senhas com id no formato do iron (`{ [id]: senha }`, lido por `iron-crypto.ts:122-128`). Descartada: o id entra no segmento `passwordId` do selo (`iron-crypto.ts:79`), o que muda o formato do cookie, fora de escopo. Também exige um mapa de ids que a aplicação teria de manter.

**Justificativa:** é a forma pedida no contrato. Não exige mudança de tipo em código existente.

### D-02 — Tentativas em ordem dentro de `unsealSession`

**Escolha:** `unsealSession` percorre `[config.password, ...extraUnsealPasswords]` em sequência. Cada tentativa usa o mesmo caminho de hoje, incluindo o fallback de 1 iteração PBKDF2 (`src/utils/session.ts:332-347`), que passa a ser aplicado por senha (RF-05). Só `Bad hmac value` (`iron-crypto.ts:136`) faz a próxima senha ser tentada. Qualquer outro erro é relançado na hora. A checagem de `maxAge` e `idleTimeout` (`src/utils/session.ts:349-365`) continua depois do laço, porque a expiração não depende da senha.

**Alternativas consideradas:**
- Tentar todas em paralelo com `Promise.any`. Descartada: RF-03 exige ordem, e o paralelismo gasta a mesma CPU de uma vez só, o que piora a carga em ataque.
- Um único `unseal` que aceita lista. Descartada: a biblioteca não tem essa API.

**Assinatura preservada:** `unsealSession(_event, config, sealed): Promise<Partial<Session>>` (`src/utils/session.ts:312-316`). É exportada em `src/index.ts:209`.

### D-03 — Marcador interno para a regravação (RF-06)

**Escolha:** `unsealSession` marca o resultado com um símbolo interno `kRotatedSeal` quando a senha que abriu não é `password`. Esse é o mesmo padrão de `kLegacySeal` (`src/utils/internal/session.ts:7-9`, usado em `src/utils/session.ts:199-201`). `getSession` lê o marcador, apaga-o antes de copiar os campos (como faz com `kLegacySeal`) e regrava.

**Alternativas consideradas:**
- Retornar `{ unsealed, passwordIndex }` de `unsealSession`. Descartada: muda a assinatura exportada.
- Regravar sempre que houver senhas extras configuradas. Descartada: cada regravação custa uma derivação PBKDF2 de 8192 iterações (`iron-crypto.ts:14-21`). Faria toda requisição pagar isso, inclusive as de sessões já com a senha nova.

**Convergência:** depois da regravação, o cookie é selado com `password`. A requisição seguinte o abre na primeira tentativa, sem marcador, e a regravação não se repete.

### D-04 — Validação das senhas extras (RF-07)

**Escolha:** função interna `assertExtraUnsealPasswords(config)` chamada no início de `getSession`, antes de qualquer leitura de cookie e antes do `.catch`. Ela lança `Error` se algum item for vazio, ou menor que o mínimo, e a mensagem cita `extraUnsealPasswords`.

- Mínimo: `Math.max(sealOptions.encryption.minPasswordlength, sealOptions.integrity.minPasswordlength)`, usando `{ ...sealDefaults, ...config.seal }`. Os dois valores são 32 por padrão (`iron-crypto.ts:22` e `:28`). Assim, se `config.seal` mudar o mínimo, a validação acompanha.
- Limite de quantidade: `MAX_EXTRA_UNSEAL_PASSWORDS = 4` (constante interna, sem exportar). O PRD pede um limite, mas não diz o valor. **Decisão a confirmar com o usuário.** Com 4, uma sessão inválida custa no máximo 5 derivações de 8192 iterações.

**Por que não dentro de `unsealSession`:** a validação lá cairia no `.catch` de `getSession` e viraria sessão inválida silenciosa.

**Escopo:** só as senhas extras são validadas. A validação de `password` seguiria o mesmo caminho, mas muda comportamento de quem já usa a lib. Fica para uma tarefa separada.

### D-05 — Sessões do header não são regravadas

**Escolha:** a regravação de RF-06 só acontece quando `sessionFromCookie` é verdadeiro, a mesma condição usada hoje para o selo legado (`src/utils/session.ts:189-193` e `:214`).

**Justificativa:** sessões do header não recebem `Set-Cookie`. Uma sessão do header aberta com senha extra continua válida com o selo antigo até expirar por `maxAge` ou `idleTimeout`. Isso precisa aparecer na documentação de `extraUnsealPasswords`.

## Arquivos a alterar

| Arquivo | Mudança | Referência atual |
| --- | --- | --- |
| `src/utils/session.ts` | Campo novo em `SessionConfig`, após `password` (com doc). Chamada de `assertExtraUnsealPasswords` no início de `getSession`. Marcador `kRotatedSeal` em `getSession`. Condição de regravação passa a incluir o marcador. `unsealSession` vira laço sobre as senhas. Helpers novos no fim do arquivo. | `src/utils/session.ts:48` (password), `:149-165` (início de getSession), `:196-201` (catch e legacySeal), `:214-216` (regravação), `:312-348` (unsealSession atual), `:414` e `:455` (helpers existentes) |
| `src/utils/internal/session.ts` | Símbolo `kRotatedSeal`, no mesmo formato de `kLegacySeal`. | `src/utils/internal/session.ts:7-9` |
| `test/session.test.ts` | Bloco novo de testes (ver Estratégia de testes). Nenhum assert existente é alterado. | `test/session.test.ts:15-23` (configuração base), `:134-159` (teste de legado), `:692-696` (bloco `lazy creation`, usado de modelo) |
| `test/unit/types.test-d.ts` | Teste de tipo para `extraUnsealPasswords` (RF-01). Hoje o arquivo não tem nada sobre `SessionConfig`. | `test/unit/types.test-d.ts` (sem ocorrências de `SessionConfig`) |

Nenhuma alteração em `src/index.ts`, `src/_entries/*`, `src/rules/*` ou `src/utils/internal/iron-crypto.ts`.

`src/utils/session.ts` já passa de 460 linhas, acima do alvo de 200 do `AGENTS.md`. Os helpers novos vão para o fim do arquivo, conforme a convenção do guia. Separar em um arquivo novo não se justifica nesta entrega.

## Contratos e assinaturas

```ts
// src/utils/session.ts: SessionConfig (novo campo)
/**
 * Previous passwords that can still open sessions sealed before a rotation.
 * They are never used to seal. Tried in order after `password`. Each one must
 * meet the same minimum length as `password`. Sessions opened with one of
 * them are resealed with `password`. Remove an entry once every session sealed
 * with it has expired.
 */
extraUnsealPasswords?: string[];

// src/utils/internal/session.ts
export const kRotatedSeal: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.rotated-seal",
);

// src/utils/session.ts: internos, sem export
const MAX_EXTRA_UNSEAL_PASSWORDS = 4;

/** Lança Error citando `extraUnsealPasswords` se a lista for inválida. */
function assertExtraUnsealPasswords(config: SessionConfig): void;

/** Uma tentativa com uma senha. Mantém o fallback legado de hoje. */
function unsealWithPassword(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
  config: SessionConfig,
): Promise<Partial<Session>>;
```

Assinaturas que não mudam: `useSession`, `getSession`, `updateSession`, `sealSession`, `clearSession`, `unsealSession`.

Esboço de `unsealSession` (apenas a parte do laço; `maxAge` e `idleTimeout` seguem como estão):

```ts
const passwords = [config.password, ...(config.extraUnsealPasswords || [])];
let unsealed: Partial<Session> | undefined;
let lastError: unknown;
for (const [index, password] of passwords.entries()) {
  try {
    unsealed = await unsealWithPassword(sealed, password, sealOptions, config);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "Bad hmac value") throw error;
    lastError = error;
    continue;
  }
  if (index > 0 && unsealed) (unsealed as any)[kRotatedSeal] = true;
  break;
}
if (!unsealed) throw lastError;
```

`getSession`: depois de `kRotatedSeal` ser lido e apagado, a condição de regravação fica:

```ts
if (session.id && sessionFromCookie && (legacySeal || rotatedSeal || shouldSlide(session, config))) {
```

`sealSession` não muda: usa só `config.password`.

## Estratégia de testes

Seguindo o `AGENTS.md`, cada teste roda em `web` e `node` pelo `describeMatrix`. Os testes novos vão em um `describe("extraUnsealPasswords")` dentro de `test/session.test.ts`. Antes de implementar, escrever os testes e confirmar que falham.

Casos, ligados aos RFs:

1. **RF-01 (tipo):** `expectTypeOf` em `test/unit/types.test-d.ts` aceita `extraUnsealPasswords: string[]` e aceita a ausência do campo.
2. **RF-02:** sessão selada com `password` nova não abre com a senha antiga (usar `unseal` direto, como em `test/session.test.ts:157`).
3. **RF-03 (ordem):** com `extraUnsealPasswords: ["senha-antiga-2", "senha-antiga"]`, a sessão sela com `"senha-antiga"` e é lida. Para provar a ordem, contar as chamadas a `crypto.subtle.deriveBits` com `vi.spyOn` (`iron-crypto.ts:249`). Com `legacySealFallback: false`, para que o fallback de 1 iteração não some na contagem. Cada tentativa que falha custa uma chamada (a da integridade). A que abre custa duas (integridade e decriptação). Esperado: 4 chamadas, na ordem `password`, `"senha-antiga-2"`, `"senha-antiga"`. Confirmar o número na implementação.
4. **RF-03 (sem senha válida):** cookie selado com senha fora da configuração. `getSession` retorna sessão vazia, sem lançar.
5. **RF-04:** a suíte existente passa sem alteração. Sem `extraUnsealPasswords`, o número de derivações é o mesmo.
6. **RF-05:** sessão no formato legado (1 iteração) com senha antiga. Os dados voltam, e o cookie é regravado com `password` e as opções atuais.
7. **RF-06:** cookie de resposta abre com `password` nova e não com a antiga. Uma segunda requisição com esse cookie não gera `Set-Cookie`, o que mostra a convergência.
8. **RF-06 (limite):** sessão do header aberta com senha extra não gera `Set-Cookie` (D-05).
9. **Expiração:** sessão aberta com senha extra e `maxAge` vencido é tratada como inválida.
10. **RF-07:** `[""]`, item com 31 caracteres e lista com 5 itens lançam erro na configuração. A mensagem cita `extraUnsealPasswords`. Lista vazia e ausente funcionam.
11. **Cookie em partes:** sessão grande, selada com senha antiga e gravada em partes (`stores large data in chunks`, `test/session.test.ts:656`), é lida e regravada corretamente.

Comandos:

```bash
pnpm vitest run test/session.test.ts
pnpm vitest run test/unit/types.test-d.ts
pnpm vitest run test/unit/iron-crypto.test.ts
pnpm typecheck
pnpm lint
pnpm test
```

Medição de custo: rodar `pnpm bench:node` antes e depois, ou comparar a contagem de derivações nos casos 3 e 4. Não há benchmark de sessão com senhas extras hoje (`test/bench/session.ts:20`).

## Riscos

- **Custo de CPU por cookie inválido:** cada senha configurada custa uma derivação PBKDF2 de 8192 iterações (`iron-crypto.ts:191-206` e `:249`). Cada uma com falha de HMAC custa também uma derivação de 1 iteração do fallback legado. Com o limite de 4, o pior caso é de 5 derivações pesadas por requisição com cookie inválido. Cookies inválidos são baratos de enviar, então o limite é a principal defesa. Medir antes de liberar.
- **Senha antiga esquecida:** manter uma senha antiga indefinidamente mantém as sessões dela vulneráveis, se ela vazar. Documentar que a lista deve ser esvaziada depois de `maxAge` ou `idleTimeout`.
- **Regravação em rotação:** cada sessão antiga é regravada uma vez na primeira leitura. É um custo único por sessão, mas aparece em tráfego alto durante a troca. Cobrir no teste 7.
- **Sessões do header não convergem (D-05):** elas continuam com o selo antigo até expirar. Documentar.
- **Erro de configuração em `password`:** uma senha curta na configuração continua falhando em silêncio na leitura (premissa corrigida). Esta entrega não muda isso.
- **Tempo de resposta por posição da senha:** a resposta de um cookie aberto com senha extra é um pouco mais lenta que com `password`. A posição não é segredo, porque quem tem o cookie já pode testar as senhas. O risco é pequeno, mas não deve ser usado como sinal de configuração.
- **Ordem de tentativas:** se a senha atual estiver errada e uma extra for igual a ela, a sessão abre com a extra sem aviso. O PRD já aceita isso.
- **Limite de 4 (D-04):** é uma escolha minha, não do PRD. Confirmar com o usuário antes da implementação.
