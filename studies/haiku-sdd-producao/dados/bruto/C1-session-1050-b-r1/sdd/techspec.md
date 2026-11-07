# Especificação técnica — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

Referências: `sdd/pedido.md` (contrato enxuto), `sdd/prd.md` (RF-01 a RF-08). Esta especificação não altera código do projeto; as citações `arquivo:linha` foram conferidas na árvore atual.

## 1. Resumo

`useSession`/`getSession` passam a tentar abrir o cookie com `password` e, em seguida, com cada senha de `extraUnsealPasswords`, nessa ordem. Selagem continua sempre com `password`. A mudança fica concentrada em `unsealSession`, com um único campo público novo em `SessionConfig`. Nenhum outro nome é exportado.

## 2. Estado atual (conferido)

- `SessionConfig.password: string` — `src/utils/session.ts:48`, com JSDoc sobre entropia em `:40-47`.
- `getSession` chama `unsealSession(event, config, sealedSession)` — `src/utils/session.ts:196`. Erros do unseal são engolidos por `.catch(() => {})` em `src/utils/session.ts:197`, então uma sessão inválida vira sessão nova sem sinal para o desenvolvedor.
- Reselagem legada e por `idleTimeout` ocorre em `src/utils/session.ts:214-216`; ela chama `updateSession`, que sela com `config.password` via `sealSession` (`src/utils/session.ts:300`). **RF-02 já é satisfeito pela própria estrutura**, desde que `sealSession` não mude.
- `unsealSession` — `src/utils/session.ts:312-367`:
  - opções de selo montadas em `:317-321`;
  - `unseal(sealed, config.password, sealOptions)` em `:324`;
  - fallback legado em `:325-348`, ativado só com `legacySealFallback !== false`, `integrity.iterations !== 1` e erro `"Bad hmac value"` (`:332-337`);
  - checagem de `maxAge` em `:350-355` e de `idleTimeout` em `:359-365`, ambas sobre a sessão já aberta.
- `unseal` em `src/utils/internal/iron-crypto.ts:87`:
  - a expiração do próprio selo (`ttl`) é checada antes do HMAC (`:110-118`);
  - a senha é resolvida em `:120-128`; para string, `password` é usada direto;
  - a verificação de integridade lança `"Bad hmac value"` em `:135-137`, **antes** de derivar a chave de cifra. Uma senha errada custa um PBKDF2 de integridade;
  - `generateKey` valida tamanho mínimo para senhas string em `:191-196`, e `unseal` passa por ele via `hmacWithPassword` (`:133`). Logo, `minPasswordlength` (32, `:22` e `:28`) **também vale para as senhas extras**, respondendo à premissa de `prd.md:109`.
- `sealSession` — `src/utils/session.ts:282-307`, usa `seal(session, config.password, ...)` em `:300`.
- Exports: `sealSession` e `unsealSession` estão em `src/index.ts:208-209`, e a lista de exports é verificada por snapshot em `test/unit/package.test.ts:125-149`. Adicionar um helper **não exportado** não altera essa lista.

## 3. Decisões de arquitetura

### D-01 — Onde fica o laço de tentativas: `unsealSession`

**Escolha:** o laço sobre `[config.password, ...extraUnsealPasswords]` vai dentro de `unsealSession` (`src/utils/session.ts:312`), por meio de um helper privado.

**Motivo:** `unsealSession` é o único ponto de abertura. Ele atende os dois caminhos de leitura (cookie e header `x-{name}-session`, `src/utils/session.ts:178-193`) e `getSession` continua sem saber de senhas. `sealSession` e `updateSession` ficam intocados, o que sustenta RF-02.

**Alternativas consideradas:**
- *Passar um `PasswordHash` ao `unseal` do iron* (`src/utils/internal/iron-crypto.ts:427`). Descartado: `seal` grava `passwordId` vazio (`iron-crypto.ts:68`, `:79`) e o `unseal` procura `"default"` (`:121`). O token não carrega identificação da senha, então o iron não sabe qual chave usar e não há como indexar as extras. Seria preciso tentar todas de qualquer forma.
- *Laço em `getSession`.* Descartado: duplicaria a lógica de legado e de expiração no caminho de header e de cookie, e espalharia mudança em uma função que o PRD pede para preservar (`prd.md:101`).

### D-02 — Quais erros autorizam a próxima senha

**Escolha:** só o erro `"Bad hmac value"` faz o laço passar para a próxima senha. Qualquer outro erro é relançado de imediato.

**Motivo:** os demais erros não dependem da senha:
- `"Expired seal"` (`iron-crypto.ts:117`) vem do `ttl`, antes do HMAC;
- `"Incorrect number of sealed components"`, `"Wrong mac prefix"`, `"Invalid expiration"` são formato do token;
- `"Password string too short"` e `"Empty password"` (`iron-crypto.ts:172`, `:192`) são configuração.

Tentar as demais senhas nesses casos gastaria PBKDF2 sem chance de sucesso e mascararia erro de configuração.

**Alternativa considerada:** continuar em qualquer erro. Descartada pelos motivos acima.

### D-03 — Fallback legado por senha, na ordem atual→legado

**Escolha:** para cada senha, primeiro o selo atual; se der `"Bad hmac value"` e o fallback estiver ativo, tenta o legado com a mesma senha; só então passa para a próxima. Isso é exatamente a ordem de RF-06 (`prd.md:63`).

**Motivo:** mantém a semântica atual de `legacySealFallback` (`src/utils/session.ts:332-337`) e o custo de cada tentativa legada é baixo (1 iteração).

**Alternativa considerada:** tentar todos os selos atuais e só depois os legados. Descartada: não segue RF-06 e não traz ganho de custo relevante.

### D-04 — Não ressellar sessões abertas por senha extra (escopo do PRD)

**Escolha:** abrir com uma senha extra **não** dispara reselagem por si só. A sessão migra para `password` quando for escrita (`updateSession`), quando o `idleTimeout` deslizar (`src/utils/session.ts:214`) ou quando for legada (`:214`, `legacySeal`).

**Motivo:** `prd.md:101` limita mudanças em `getSession` ao necessário para passar as senhas. Sem reselagem extra, nenhuma requisição de leitura ganha `Set-Cookie` novo, o que mantém o comportamento simples.

**Consequência:** a lista `extraUnsealPasswords` precisa ficar até que as sessões antigas sejam escritas, expirem por `maxAge`/`idleTimeout` ou sejam legadas. Sessões sem `maxAge` nem `idleTimeout` nunca expiram, então a senha antiga não pode ser removida (ver riscos).

**Alternativa considerada (recomendada como follow-up):** resselar ao abrir com senha extra, o que completa a rotação de forma automática e de uma vez por sessão. Fica fora deste escopo porque adiciona escrita em leituras e pede confirmação de que você quer essa mudança agora.

### D-05 — Expiração verificada uma vez, sobre a sessão aberta

**Escolha:** `maxAge` e `idleTimeout` continuam em `src/utils/session.ts:350-365`, depois do laço, sem alteração. Assim a expiração não depende de qual senha abriu a sessão (RF-07).

**Motivo:** é o comportamento já existente; mover a checagem para dentro do laço complicaria sem ganho.

### D-06 — Validar as senhas extras cedo, fora do `.catch` silencioso

**Escolha (recomendada):** antes de tentar o cookie, em `getSession`, lançar erro explícito se alguma entrada de `extraUnsealPasswords` for string vazia ou menor que `minPasswordlength` (`sealOptions.encryption.minPasswordlength`, herdado de `sealDefaults` ou de `config.seal`).

**Motivo:** sem isso, uma senha extra inválida só aparece quando o laço chega até ela, e então o erro é engolido em `src/utils/session.ts:197`. O efeito seria sessões inexplicavelmente inválidas, sem mensagem.

**Alternativa considerada:** deixar a validação só para o iron, como hoje para `password`. Descartada por ser silenciosa.

**Ponto a confirmar:** é uma mudança pequena em `getSession`, além do estritamente necessário para passar as senhas. Se preferir a versão mínima, a validação pode ficar para uma issue futura.

### D-07 — Forma do campo público e do JSDoc

**Escolha:** `extraUnsealPasswords?: string[]` em `SessionConfig`, logo após `password` (`src/utils/session.ts:48`). Tipo exatamente como em `prd.md:27` e `pedido.md:27`.

**Alternativa considerada:** `readonly string[]`. Aceitaria também `as const`. Descartada para seguir o contrato literal. Se o usuário preferir, a troca é compatível.

**JSDoc** (RF-08): o JSDoc de `password` (`src/utils/session.ts:40-47`) passa a dizer que é a única senha usada para selar. O novo campo descreve que serve só para abrir sessões, que a ordem de tentativa é `password` e depois as extras na ordem declarada, e que a lista deve ser removida depois que as sessões antigas expirarem.

## 4. Contratos e assinaturas

### 4.1 Público: `SessionConfig` (`src/utils/session.ts:39`)

```ts
export interface SessionConfig {
  /** ...existente; passa a dizer que é a única senha que sela. */
  password: string;
  /**
   * Senhas anteriores, usadas apenas para abrir sessões seladas antes de uma
   * rotação. `password` continua sendo a única que sela. Tentadas depois de
   * `password`, na ordem declarada. Remova a entrada quando as sessões
   * antigas tiverem expirado (`maxAge`/`idleTimeout`).
   */
  extraUnsealPasswords?: string[];
  // ...demais campos inalterados
}
```

Nenhuma outra assinatura pública muda: `useSession`, `getSession`, `updateSession`, `sealSession` e `unsealSession` mantêm os parâmetros. `unsealSession` passa a usar `config.extraUnsealPasswords` sem mudança de assinatura.

### 4.2 Privado (não exportado) em `src/utils/session.ts`

```ts
/** Erro de HMAC: a senha não é a que selou o token. Só este erro passa para a próxima senha. */
function isBadHmac(error: unknown): boolean {
  return error instanceof Error && error.message === "Bad hmac value";
}

/**
 * Tenta abrir o selo com `password` e depois com cada `extraUnsealPasswords`,
 * na ordem declarada. Para cada senha, tenta o selo atual e depois o legado
 * (se permitido). Relança o primeiro erro que não seja de HMAC.
 */
async function unsealWithPasswords(
  sealed: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<{ unsealed: Partial<Session>; legacySeal: boolean }>;
```

Esboço do corpo (a implementar com o estilo do arquivo):

```ts
let mismatch: unknown;
for (const password of [config.password, ...(config.extraUnsealPasswords || [])]) {
  try {
    const unsealed = (await unseal(sealed, password, sealOptions)) as Partial<Session>;
    return { unsealed, legacySeal: false };
  } catch (error) {
    if (!isBadHmac(error)) throw error;
    mismatch = error;
  }
  if (config.legacySealFallback !== false && sealOptions.integrity.iterations !== 1) {
    try {
      const unsealed = (await unseal(sealed, password, {
        ...sealOptions,
        encryption: { ...sealOptions.encryption, iterations: 1 },
        integrity: { ...sealOptions.integrity, iterations: 1 },
      })) as Partial<Session>;
      return { unsealed, legacySeal: true };
    } catch (error) {
      if (!isBadHmac(error)) throw error;
      mismatch = error;
    }
  }
}
throw mismatch;
```

### 4.3 Mudança em `unsealSession` (`src/utils/session.ts:312`)

Substitui `:322-348` por:

```ts
const { unsealed, legacySeal } = await unsealWithPasswords(sealed, config, sealOptions);
if (legacySeal) {
  (unsealed as any)[kLegacySeal] = true;
}
```

`:350-366` (expiração e retorno) permanecem.

### 4.4 Validação (D-06) em `getSession` (`src/utils/session.ts:149`)

Antes de `if (sealedSession)` (`:194`), ou no início da função, lança `Error` se houver entrada inválida. Esboço:

```ts
for (const extra of config.extraUnsealPasswords || []) {
  if (extra.length < (config.seal?.encryption.minPasswordlength ?? sealDefaults.encryption.minPasswordlength)) {
    throw new Error("extraUnsealPasswords: each password must meet the minimum length of the seal options");
  }
}
```

Observação: `config.seal` é `SealOptions` completo (`src/utils/session.ts:88`), então `config.seal?.encryption.minPasswordlength` é suficiente. Só vale a checagem se `extraUnsealPasswords` estiver preenchido.

### 4.5 Tipos

Nenhuma mudança em `updateSession`, `sealSession` ou tipos de `Session`. `kLegacySeal` continua em `src/utils/internal/session.ts:7`.

## 5. Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/session.ts:40-48` | JSDoc de `password` (única que sela) e novo campo `extraUnsealPasswords` em `SessionConfig`. |
| `src/utils/session.ts:149-194` | Validação D-06 em `getSession`. |
| `src/utils/session.ts:312-348` | `unsealSession` passa a usar `unsealWithPasswords`. |
| `src/utils/session.ts` (fim do arquivo, após `:464`) | Helpers privados `isBadHmac` e `unsealWithPasswords`. O arquivo tem 465 linhas hoje e ficará em torno de 510 com a mudança. AGENTS pede < 200 linhas por arquivo, então o ideal é mover `unsealWithPasswords` e `isBadHmac` para `src/utils/internal/session.ts` (já existe e hoje só tem constantes). |
| `test/session.test.ts` | Novos casos após `:186` (ver §6). |
| `test/unit/types.test-d.ts` | Teste de tipo para RF-01 (ver §6). Confirmar os imports do arquivo, já que o trecho lido (`:520-535`) usa `expectTypeOf` mas não mostra o import de `SessionConfig`. |
| `docs/4.examples/handle-session.md:37` e `:143` | Aviso sobre `password` e nota sobre rotação com `extraUnsealPasswords`. A frase "Every option is optional except `password`" continua verdadeira. |
| `docs/2.utils/4.security.md:68` | Seção `useSession` gerada por automd a partir do JSDoc; regenerar com `pnpm fmt`, não editar à mão. |

Não alterar: `src/utils/internal/iron-crypto.ts`, `src/index.ts`, `test/unit/package.test.ts`, `sealSession`, `updateSession`, `clearSession`.

## 6. Estratégia de testes

Seguir o workflow do AGENTS.md: escrever os testes primeiro, confirmar que falham, depois implementar.

**Testes de integração** em `test/session.test.ts`, dentro de `describeMatrix` (cada teste roda em `web` e `node`). Usar `sessionConfig` (`:21-25`) como base e o padrão de `vi.useFakeTimers({ toFake: ["Date"] })` de `:188` e `:375`.

| Caso | Requisito | Como verificar |
| --- | --- | --- |
| Abre cookie selado com a extra e preserva `id` e `data` | RF-03 | `unseal`-ar o cookie com `"antiga"` no setup; `t.fetch` com config `{password:"nova", extraUnsealPasswords:["antiga"]}`; asserir `id` e `data` iguais e que não há `Set-Cookie`. |
| Senha desconhecida cria sessão nova selada com `password` | RF-04 | Cookie com `"desconhecida"`; asserir `id` diferente e que o `Set-Cookie` abre com `"nova"`. |
| Reselagem por `idleTimeout` após abrir com extra usa `password` | RF-02 | Config com `idleTimeout`, cookie `"antiga"`, avançar relógio além de `idleTimeout/2`; `unseal(resealed, "nova")` funciona e `unseal(resealed, "antiga")` lança. |
| Legado com 1 iteração sob extra, fallback ligado | RF-06 | `seal` com iterações 1 usando `"antiga"`; sessão aberta e resselada com `"nova"` (padrão de `:134-159`). |
| Legado com extra e `legacySealFallback: false` | RF-06 | Mesmo cookie; sessão rejeitada, nova criada (padrão de `:161-186`). |
| `maxAge` expirado em sessão de senha antiga | RF-07 | Fake timers como em `:375-408`; cookie `"antiga"` com `createdAt` além de `maxAge`; sessão nova. |
| Segunda extra é tentada quando a primeira falha | RF-03 | `extraUnsealPasswords: ["x-errada...", "antiga"]`; sessão aberta. |
| `extraUnsealPasswords: []` igual a ausente | RF-05 | Repetir um caso existente (ex.: "unseals and reseals legacy sessions") com `[]`. |
| Validação D-06 | D-06 | `extraUnsealPasswords: ["curta"]` faz `getSession`/`useSession` lançar com a mensagem esperada. |

**Teste de tipo** em `test/unit/types.test-d.ts` (RF-01):

```ts
expectTypeOf<SessionConfig["password"]>().toEqualTypeOf<string>();
expectTypeOf<SessionConfig["extraUnsealPasswords"]>().toEqualTypeOf<string[] | undefined>();
```

**Regressão:** a suíte atual de `test/session.test.ts` deve passar sem alteração de asserção (RF-05). `test/unit/package.test.ts` (snapshot de exports) também deve passar sem mudança, o que confirma que nenhum nome público novo foi exportado.

**Comandos de verificação:**

```bash
pnpm vitest run test/session.test.ts         # antes: novos casos falham; depois: passam
pnpm vitest run test/unit/                   # inclui package.test.ts e types.test-d.ts
pnpm typecheck                               # RF-01
pnpm lint                                    # oxlint + oxfmt --check
pnpm test                                    # suíte completa com cobertura, antes de fechar
```

Os casos de expiração e de fallback legado dependem de relógio falso (`vi.useFakeTimers`), então usar `vi.useRealTimers()` no `finally`, como os testes atuais.

## 7. Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| **Lista de senhas nunca removida** | Senha comprometida continua aceita. | JSDoc de `extraUnsealPasswords` (§3, D-07) manda remover após expiração. |
| **Sessões sem `maxAge` nem `idleTimeout` nunca expiram** | Sessões antigas nunca migram nem saem, então a lista de senhas não pode ser removida. | Documentar no JSDoc e no guia que a rotação exige `maxAge` ou `idleTimeout`. Considerar o follow-up de D-04. |
| **Sessões de header (`sessionHeader`) nunca são resseladas** | Sessões de header sob senha antiga não migram, mesmo com `idleTimeout` (`src/utils/session.ts:64-65`, doc do próprio campo). | Documentar. Expiram pelo `idleTimeout` contado da emissão do selo. |
| **Erro de configuração engolido** | Senha extra vazia ou curta faz sessões legítimas falharem em silêncio (`src/utils/session.ts:197`). | D-06 (validação antecipada em `getSession`). |
| **Custo de CPU** | Cada senha tentada que falha custa um PBKDF2 de integridade, e o legado acrescenta outro com 1 iteração. Para requisições com cookie de senha desconhecida, o custo é multiplicado pelo número de senhas. | Documentar que a lista deve ser curta. Abrir com a senha atual continua custando uma tentativa. |
| **Fallback legado × várias senhas** | Até duas tentativas por senha. | Casos de RF-06 em §6. |
| **Resselagem com senha antiga por engano** | Rotação não se completa. | `sealSession` não muda e sempre usa `config.password` (`src/utils/session.ts:300`). Caso de teste de RF-02 em §6. |
| **Erros de HMAC encadeados como "próxima senha"** | Se algum erro não-HMAC fosse tratado como mismatch, o laço daria uma tentativa a mais e mascararia expiração. | D-02 e um teste que garanta `"Expired seal"` não tentar outras senhas (pode ser verificado indiretamente pelo contador de chamadas ao `unseal` com spy, se quiser). |
| **Mudança de API pública** | Quem implementa `SessionConfig` por tipo ou herança precisa ver o campo novo. | Campo opcional, sem quebra para quem já usa a interface. |

## 8. Ordem de implementação

1. Escrever os casos de §6 em `test/session.test.ts` e o teste de tipo; rodar e confirmar que falham.
2. Adicionar o campo e o JSDoc em `SessionConfig` (`src/utils/session.ts:39-99`).
3. Implementar `isBadHmac` e `unsealWithPasswords`; trocar o corpo de `unsealSession`.
4. Implementar a validação D-06, se aprovada.
5. Rodar `pnpm vitest run test/session.test.ts`, `pnpm typecheck` e `pnpm lint`; depois `pnpm test`.
6. Atualizar `docs/4.examples/handle-session.md` e regenerar a seção automd de `docs/2.utils/4.security.md` com `pnpm fmt`.

## 9. Pontos a confirmar com você

1. **D-04:** manter a versão conservadora (sem reselagem na leitura por senha extra) ou já incluir a reselagem para completar a rotação?
2. **D-06:** aceitar a validação antecipada em `getSession`, que é uma mudança a mais além do que o PRD pede?
3. **D-07:** `string[]` (como no contrato) ou `readonly string[]`?
