# Especificação técnica — Várias senhas de unseal nas sessões (#1050-b)

Base: `sdd/pedido.md` (contrato enxuto) e `sdd/prd.md` (RF-01 a RF-09, premissas P1–P5, riscos R1–R5). Esta spec decide como implementar esses requisitos no código atual; não os redefine.

**Baseline conferida:** `pnpm vitest run test/session.test.ts test/unit/package.test.ts` passa com 59 testes; `tsc` sem erros de tipo.

## 1. Estado atual

- `SessionConfig.password` é a única chave de unseal. `unsealSession` chama `unseal` uma vez, com `config.password` (`src/utils/session.ts:324`).
- O fallback de selo legado (1 iteração) fica no `catch` da mesma função, só para erro `"Bad hmac value"` (`src/utils/session.ts:326-346`).
- Expiração por `maxAge` e `idleTimeout` é checada depois do unseal (`src/utils/session.ts:350-365`), então já é independente da senha.
- `getSession` lê o selo tanto do header quanto do cookie (`src/utils/session.ts:178-193`) e chama `unsealSession` (`src/utils/session.ts:196`). Reselagem só ocorre para cookie: `session.id && sessionFromCookie && (legacySeal || shouldSlide(...))` (`src/utils/session.ts:214-216`).
- O marcador `kLegacySeal` é lido e removido antes do `Object.assign` (`src/utils/session.ts:199-208`). O `Object.assign` copia símbolos enumeráveis, então qualquer novo marcador precisa ser removido no mesmo lugar.
- `sealSession` sela sempre com `config.password` (`src/utils/session.ts:300-304`). Essa linha não muda.
- `iron-crypto.ts` aceita senha por id (`PasswordHash`), mas a senha sem id vira `"default"` na leitura (`src/utils/internal/iron-crypto.ts:120-128`). O id fica dentro do selo, por isso não é usado aqui (ver D-06).
- Há verificação de tamanho mínimo de 32 caracteres dentro de `generateKey` (`src/utils/internal/iron-crypto.ts:191-196`). Ela vale para qualquer senha que passe por `unseal`.
- A expiração do selo (`expiration`) é checada antes do HMAC (`src/utils/internal/iron-crypto.ts:110-118`), e o HMAC é verificado em `src/utils/internal/iron-crypto.ts:133-137`.
- `unsealSession` e `sealSession` são exportadas publicamente (`src/index.ts:208-209`), e o snapshot de exports está em `test/unit/package.test.ts:125` e `:149`. **Nenhum símbolo novo pode ser exportado** por `src/index.ts`, ou o snapshot quebra e o pedido é violado.
- `setCookie` deduplica `Set-Cookie` com o mesmo nome (`src/utils/cookie.ts:93-108`). Isso cobre a reselagem de leitura seguida de escrita no handler (R4).

## 2. Decisões de arquitetura

### D-01 — Tentativas de unseal ficam dentro de `unsealSession`

**Escolha:** a lista de senhas (`[config.password, ...(config.extraUnsealPasswords ?? [])]`) e o laço de tentativas ficam em `unsealSession` (`src/utils/session.ts:312`).

**Por quê:** `getSession` (cookie e header) e o `unsealSession` público passam por essa função (`src/utils/session.ts:196`). Uma única mudança cobre RF-03, RF-08 e RF-09 e evita duplicar lógica (P5). Quem chama `unsealSession` diretamente também passa a aceitar as senhas extras, o que é coerente com o contrato da função.

**Alternativas:**
- Fazer o laço em `getSession`. Descartada: duplica o fallback legado e deixa o `unsealSession` público com comportamento diferente do que `getSession` faz.
- Criar uma nova função pública `unsealSessionWithPasswords`. Descartada: viola "nenhum outro nome público novo".

### D-02 — Duas passadas: senhas no selo atual, depois no legado

**Escolha:** o laço roda em duas fases.
1. Passada 1: tenta cada senha (`password`, depois as extras, na ordem) com as iterações atuais.
2. Passada 2 (só se `legacySealFallback !== false`, `sealOptions.integrity.iterations !== 1` e pelo menos um erro da passada 1 foi `"Bad hmac value"`): tenta cada senha de novo com 1 iteração.

Se nenhuma abre, relança o **primeiro** erro da passada 1.

**Por quê:** RF-06 pede que o legado valha para cada senha candidata, e a passada 2 cobre isso. Na passada única por candidato (alternativa), toda sessão atual aberta com senha extra pagaria uma derivação de 1 iteração extra por candidato antes de tentar a próxima, sem nenhum ganho. Com duas passadas, uma sessão atual aberta pela senha extra custa exatamente 2 derivações de 8192 iterações (`password` falha, extra abre), sem legado.

**Alternativas:**
- Por candidato: `password` (atual → legado), depois extra (atual → legado). Descartada pelo custo descrito acima.
- Só legado na senha principal. Descartada: não atende RF-06.

**Preservação:** com uma única senha, a sequência de tentativas é idêntica à de hoje (atual, depois legado se `"Bad hmac value"`), e o erro relançado é o mesmo.

### D-03 — Marcadores internos para reselagem após senha extra

**Escolha:** novo símbolo em `src/utils/internal/session.ts`, ao lado de `kLegacySeal` (`src/utils/internal/session.ts:7-9`):

```ts
export const kPreviousPasswordSeal: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.previous-password-seal",
);
```

`unsealSession` marca o resultado quando a senha que abriu não é a primeira da lista (índice > 0). `getSession` lê o marcador junto com `kLegacySeal`, remove os dois antes do `Object.assign`, e reseleja se qualquer um estiver presente (`src/utils/session.ts:214-216`).

**Por quê:** o padrão já existe (`kLegacySeal`), é interno, não aparece em exports e é o único jeito de `getSession` saber a origem do unseal sem mudar o retorno público. Reselar a cada leitura com extras configuradas (alternativa) ia gastar uma derivação de selo em toda requisição e mudaria `Set-Cookie` mesmo quando não há migração necessária.

**Alternativa descartada:** comparar o selo com o selo que o `seal()` produziria com `password`. Exigiria selar, ou seja, o mesmo custo.

### D-04 — Expiração é checada depois de escolher a senha vencedora

**Escolha:** `maxAge` e `idleTimeout` (`src/utils/session.ts:350-365`) continuam depois do laço, uma única vez, sobre o objeto desselado por qualquer senha.

**Por quê:** RF-08 pede que a regra valha qualquer que seja a senha. Checar por candidato faria o laço continuar tentando outras senhas numa sessão já expirada. Além disso, `Expired seal` (expiração do próprio selo) é checada antes do HMAC (`src/utils/internal/iron-crypto.ts:110-118`), então para essa causa todas as senhas falham igual e o laço termina rápido.

### D-05 — Erro quando nenhuma senha abre: relançar o primeiro

**Escolha:** o erro relançado é o da primeira tentativa da passada 1. `getSession` continua engolindo o erro (`src/utils/session.ts:197`) e devolve uma sessão nova (RF-05).

**Por quê:** com uma senha só, a mensagem é a mesma de hoje (`"Bad hmac value"`, ou a do legado quando ele é o único caminho). A API pública `unsealSession` mantém o mesmo tipo de erro. Relançar o último erro misturaria falhas de senha curta de uma extra com a falha real da senha principal.

### D-06 — Não usar `kid`/`PasswordHash` do iron

**Escolha:** o selo continua com a mesma forma (`src/utils/internal/iron-crypto.ts:58-84`). Nenhum id de senha é gravado.

**Por quê:** P1 e o escopo proíbem mudar o formato do cookie e incluir `kid`. Usar `PasswordHash` (`src/utils/internal/iron-crypto.ts:427`) exigiria gravar um id no selo, o que é exatamente o `kid` fora de escopo.

**Alternativa descartada:** passar `{ default: password, ...extras }` como `PasswordHash`. Descartada por mudar o formato do selo.

### D-07 — Sem validação das senhas extras

**Escolha:** nenhuma validação extra além do que `generateKey` já faz (`src/utils/internal/iron-crypto.ts:191-196`). Uma senha extra curta (< 32) ou vazia falha dentro do laço como qualquer candidata, e o laço segue para a próxima.

**Por quê:** P4 e o escopo dizem que a implementação não precisa validar. Validar no início fariam uma configuração errada derrubar todas as sessões, e não só as que usam a senha ruim.

**Consequência a documentar:** uma senha extra inválida nunca abre sessão, e o erro é silencioso (R6).

## 3. Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/session.ts` | Novo campo `extraUnsealPasswords?: string[]` em `SessionConfig` (após `password`, `src/utils/session.ts:48`). Reescrever o corpo de `unsealSession` (`src/utils/session.ts:312-367`) com as duas passadas (D-01, D-02, D-04). Em `getSession`, ler e remover `kPreviousPasswordSeal` (`src/utils/session.ts:199-201`) e incluí-lo na condição de reselagem (`src/utils/session.ts:214`). Helper interno novo no fim do arquivo (`src/utils/session.ts:464`, depois de `sessionExpires`). |
| `src/utils/internal/session.ts` | Novo símbolo `kPreviousPasswordSeal` (após `src/utils/internal/session.ts:9`). |
| `test/session.test.ts` | Novo `describe` com os testes da seção 5, depois de `test/session.test.ts:186` (bloco de legado). Imports: nenhum novo se `seal`/`unseal` já estiverem em `test/session.test.ts:12`. |
| `test/unit/package.test.ts` | **Sem mudança.** Serve como verificação de que nenhum export foi adicionado. |
| `docs/2.utils/4.security.md` | **Sem edição manual.** O bloco é gerado por automd a partir do JSDoc das funções (`docs/2.utils/4.security.md:44-74`). O JSDoc de `SessionConfig` não entra nesse bloco; a documentação do novo campo fica no próprio JSDoc (seção 4). `pnpm fmt` regenera o que for necessário. |
| `CHANGELOG.md` | Sem edição manual (gerado por `changelogen` no release). |

## 4. Contratos e assinaturas

### Campo novo em `SessionConfig`

```ts
export interface SessionConfig {
  /** ...documentação atual... */
  password: string;
  /**
   * Previous passwords that can still open sessions sealed before a rotation.
   * Sessions are always sealed with `password`; these are tried in order after
   * it when unsealing, and a session opened with one of them is resealed with
   * `password` on the same read. Each entry must meet the same entropy
   * requirements as `password` (at least 32 characters, cryptographically random).
   * Remove an entry once sessions sealed with it have expired or been migrated,
   * since every extra password is tried on each unseal of an older session.
   */
  extraUnsealPasswords?: string[];
  // ...restante inalterado
}
```

Sem mudança em `useSession`, `getSession`, `updateSession`, `sealSession` ou `clearSession`. Assinatura pública de `unsealSession` inalterada:

```ts
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;
```

### Helper interno (não exportado, `src/utils/session.ts`, no fim do arquivo)

```ts
/** Result of trying each candidate password against one sealed string. */
type OpenedSeal = { unsealed: Partial<Session>; index: number; legacy: boolean };

/**
 * Tries `passwords` in order at the current PBKDF2 iterations, then (if allowed)
 * again at the legacy count. Throws the first error when none opens.
 */
async function openSeal(
  sealed: string,
  passwords: string[],
  sealOptions: SealOptions,
  legacyAllowed: boolean,
): Promise<OpenedSeal>;
```

Esboço de `unsealSession` (só a forma; a expiração segue igual):

```ts
const passwords = [config.password, ...(config.extraUnsealPasswords ?? [])];
const { unsealed, index, legacy } = await openSeal(
  sealed,
  passwords,
  sealOptions,
  config.legacySealFallback !== false && sealOptions.integrity.iterations !== 1,
);
if (legacy) (unsealed as any)[kLegacySeal] = true;
if (index > 0) (unsealed as any)[kPreviousPasswordSeal] = true;
// maxAge e idleTimeout: inalterados (src/utils/session.ts:350-365)
return unsealed;
```

Observações:
- `openSeal` decide a passada 2 por "algum erro da passada 1 foi `Bad hmac value`". Isso reproduz a condição atual, que só retenta por esse erro (`src/utils/session.ts:336`).
- `legacy` e `index` são independentes: uma sessão pode ser aberta por senha extra e pelo legado ao mesmo tempo, e as duas marcas são setadas.
- `unsealed` pode ser `null` se o JSON descriptografado for nulo (`src/utils/internal/iron-crypto.ts:149`). O comportamento atual já lida com isso, e a expiração precisa continuar protegida (`unsealed.createdAt` hoje assume objeto; manter a mesma semântica).

### Mudança em `getSession`

```ts
const legacySeal = unsealed && (unsealed as any)[kLegacySeal];
const previousSeal = unsealed && (unsealed as any)[kPreviousPasswordSeal];
if (legacySeal) delete (unsealed as any)[kLegacySeal];
if (previousSeal) delete (unsealed as any)[kPreviousPasswordSeal];
// ...
if (session.id && sessionFromCookie && (legacySeal || previousSeal || shouldSlide(session, config))) {
  await updateSession(event, config);
}
```

Como a remoção acontece antes de `Object.assign(session, unsealed)` (`src/utils/session.ts:208`), o símbolo não vaza para `session`.

## 5. Estratégia de testes

Seguindo `AGENTS.md`: `describeMatrix` (web e node), regressão antes da correção, e `pnpm test` completo no fim.

**Ordem (Bug Fix Workflow adaptado a feature):**
1. Escrever os testes novos primeiro. Eles devem falhar com o código atual, porque o campo ainda é ignorado.
2. Implementar.
3. Confirmar que os testes novos passam e que os 59 da baseline continuam passando sem alteração de asserção (RF-04).

**Casos (um `it` por critério de aceite):**

| Caso | Requisito | Verificação |
| --- | --- | --- |
| Sela só com a senha atual | RF-02 | `updateSession` com `password: "nova"`, `extraUnsealPasswords: ["antiga"]`. `unseal(cookie, "nova")` abre; `unseal(cookie, "antiga")` falha. |
| Abre com senha extra | RF-03 | Cookie selado com `"antiga"`; `getSession` retorna `id` e `data` originais. |
| Ordem de tentativa com várias extras | RF-03 | Duas extras, cookie selado com a segunda; abre. Mais uma: cookie selado com a primeira extra e a segunda não abre, mas a primeira sim (ordem não quebra). |
| Migração | RF-07 | Mesmo cenário do RF-03; a resposta tem um `Set-Cookie` que abre com `"nova"` e não abre com `"antiga"`. |
| Sem extras é idêntico | RF-04 | Nenhum teste existente muda. Adicionar: `extraUnsealPasswords: []` gera cookie que abre com a senha e tem o mesmo comportamento de leitura (sem `Set-Cookie` em leitura de sessão atual). |
| Nenhuma senha abre | RF-05 | Cookie com `"desconhecida"`; `getSession` retorna sessão nova com `id` diferente. Nenhum erro chega ao handler. |
| Legado com senha extra, fallback ligado | RF-06 | Cookie com `"antiga"` e 1 iteração; abre e é resselado com `"nova"`. |
| Legado com senha extra, fallback desligado | RF-06 | Mesmo cookie com `legacySealFallback: false`; rejeitado (nova sessão). |
| Expiração por `maxAge` com senha extra | RF-08 | `createdAt` vencido com `"antiga"`; sessão não carregada. Usar `vi.useFakeTimers({ toFake: ["Date"] })` como os testes de `idleTimeout` (`test/session.test.ts:188-229`). |
| Expiração por `idleTimeout` com senha extra | RF-08 | Mesmo padrão; `lastSeenAt` antigo com `"antiga"`. |
| Header com senha extra não migra | RF-09 | Selo com `"antiga"` no header `x-h3-session` (nome do cookie por `sessionName`, como em `test/session.test.ts:336`); sessão carregada e nenhum `Set-Cookie` de migração. |
| Expiração não depende de qual senha abriu | D-04, RF-08 | Coberto pelo caso de `maxAge` acima: sessão expirada com `"antiga"` não é carregada. A ordem (expirar depois de escolher a senha) é verificada pelo mesmo teste. |
| Reselagem não duplica `Set-Cookie` | R4 | Handler que lê e escreve (`session.update`) na mesma requisição com cookie de senha extra; `getSetCookie()` tem exatamente um cookie da sessão. |
| Export público inalterado | §3 | `test/unit/package.test.ts` passa sem mudança. |

**Testes existentes que podem mudar:** nenhum teste da baseline asserta a mensagem `"Bad hmac value"` (`grep` em `test/session.test.ts`: zero ocorrências). Os de legado (`test/session.test.ts:134-186`) só mudam se a nova ordem das passadas alterar algo observável, e a spec exige que não mude. Se algum falhar, a causa é a passada 2 e deve ser corrigida no código, não na asserção.

**Verificação final:** `pnpm lint`, `pnpm typecheck`, `pnpm vitest run test/session.test.ts test/unit/package.test.ts`, e `pnpm test` completo (lint + typecheck + coverage).

## 6. Riscos

- **R1 — Custo de PBKDF2 (ampliado).** Cada senha tentada é uma derivação completa de 8192 iterações, e sessões legadas dobram isso. Com N extras, uma sessão aberta pela última senha custa `N+1` derivações; **um cookie inválido (que nunca abre) custa `N+1` derivações na passada 1 e outras `N+1` na passada 2 quando há erro de HMAC**. Isso é amplificação de custo que um cliente pode provocar com cookies forjados. Mitigação: a lista deve ser curta, e a documentação (seção 4) avisa. Não há mitigação barata sem `kid` (D-06).
- **R2 — Senhas antigas esquecidas.** Já previsto no PRD. A documentação do campo pede remoção quando as sessões migrarem.
- **R3 — Testes acoplados.** Baixo: não há asserção de `"Bad hmac value"` na suíte (ver seção 5). Os testes de legado validam o comportamento que a passada 2 preserva.
- **R4 — `Set-Cookie` duplicado.** A reselagem em `getSession` pode gerar um segundo `Set-Cookie` se o handler também escrever. `setCookie` deduplica (`src/utils/cookie.ts:93-108`); o teste da seção 5 cobre isso.
- **R5 — Sessões que não são lidas.** Sessões antigas que ninguém lê depois da troca continuam com a senha antiga até expirar, ou para sempre sem `maxAge`/`idleTimeout`. Documentar.
- **R6 — Senha extra inválida é silenciosa.** Senha curta (< 32) ou vazia nunca abre, e o erro é engolido em `getSession` (`src/utils/session.ts:197`). Quem rotaciona pode achar que a migração funcionou e perder sessões só ao remover a senha antiga. Mitigação: documentação; a validação foi descartada em D-07.
- **R7 — Header não migra.** Clientes que mandam a sessão pelo header continuam usando o selo antigo até expirar (RF-09). Comportamento pedido, mas precisa estar documentado para quem usa `sessionHeader`.
- **R8 — `unsealSession` público muda de comportamento com a config.** Só quando `extraUnsealPasswords` está setado; sem o campo, o resultado é igual. Chamadores que passam `config` completo passam a aceitar as senhas extras automaticamente, o que é o esperado.
