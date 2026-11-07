# Especificação técnica — Várias senhas de unseal nas sessões

Referências: `sdd/pedido.md` (contrato enxuto #1050-a), `sdd/prd.md` (RF-01 a RF-07), issue h3js/h3#1050 (segunda alternativa).

## Visão geral

`SessionConfig.password` passa a aceitar `string | string[]`. A primeira senha sela; as demais só abrem. A mudança fica concentrada em `src/utils/session.ts`: a selagem usa a primeira senha, e a abertura (`unsealSession`) tenta cada senha em ordem, com o fallback de selo legado aplicado a cada uma. `src/utils/internal/iron-crypto.ts` não muda: ele continua recebendo uma senha por vez.

Contagem de derivações PBKDF2 hoje (conferida em `src/utils/internal/iron-crypto.ts:87-150` e `:171-218`): selar custa 2 derivações (cifra e integridade); abrir com a senha certa custa 2; abrir com senha errada custa 1, porque `unseal` verifica o HMAC (`src/utils/internal/iron-crypto.ts:135-137`) antes de decifrar. Com a lista, uma sessão selada com a última de N senhas custa N-1 derivações falhas mais 2.

---

## Decisões de arquitetura

### D-01 — Lista em `password` em vez de um campo novo

**Alternativas consideradas**

1. Novo campo público, como `extraUnsealPasswords` (primeira alternativa da issue).
2. `password` aceita `string | string[]` (segunda alternativa da issue).

**Escolha: 2.** O pedido proíbe nomes públicos novos. Com a lista, o contrato público cresce em uma única união de tipos, e uma configuração com uma string continua idêntica à de hoje.

### D-02 — Selar com a primeira, abrir tentando em ordem

**Alternativas consideradas**

1. Selar com a primeira senha e abrir tentando todas em ordem (PRD, RF-02 e RF-03).
2. Selar com todas, gravando o `id` da senha no selo (ver D-03).
3. Abrir em paralelo com `Promise.any`.

**Escolha: 1.** É a regra do PRD. A opção 3 dispara N derivações PBKDF2 de uma vez, o que piora o pico de CPU sem reduzir o custo total. Uma sessão antiga é resselada com a primeira senha na próxima gravação natural, incluindo o reselo do `idleTimeout` (`src/utils/session.ts:214-216`) e o reselo de legado; não há migração em massa (PRD, fora de escopo).

### D-03 — Não usar os `id`s de senha do iron

**Contexto.** `iron-crypto` já aceita um objeto `{ [id]: senha }` (`src/utils/internal/iron-crypto.ts:122-128`) e grava o `id` no selo (`src/utils/internal/iron-crypto.ts:68-79`). Isso permitiria uma única derivação por leitura.

**Alternativas consideradas**

1. Mapear a lista para ids (`"0"`, `"1"`, ...) e selar com o `id` da primeira.
2. Tentar as senhas em ordem, sem ids (D-02).

**Escolha: 2.** Sessões já seladas com senha única têm `id` vazio, que vira `"default"` (`src/utils/internal/iron-crypto.ts:121`). Para lê-las, seria preciso mapear a senha atual para `"default"` e, ao selar, o selo passaria a ter um `id` diferente, o que muda o formato do selo (proibido pelo PRD, fora de escopo). A diferença de custo é pequena para listas curtas, que é o caso de uso.

### D-04 — Quem decide se a senha foi rejeitada: só `Bad hmac value` avança

**Contexto.** `unseal` lança erros de três tipos: estruturais e de expiração, antes de qualquer derivação (`src/utils/internal/iron-crypto.ts:99-118`); `Bad hmac value` (`:137`), quando a senha não bate; e validação de senha (`Password string too short`, `src/utils/internal/iron-crypto.ts:192-196`, e `Empty password`, `:172-174`).

**Escolha.** No laço, só `Bad hmac value` faz a leitura passar para a próxima senha. Qualquer outro erro é relançado na hora. Assim:

- um selo malformado ou expirado não gasta derivações com as demais senhas;
- uma senha inválida na lista aparece como erro de configuração, e não como sessão inválida;
- quando nenhuma senha abre, o erro lançado é `Bad hmac value`, idêntico ao de hoje para uma senha única (RF-03). A mensagem não diz qual posição da lista falhou, o que atende à restrição de não vazar a senha que falhou.

### D-05 — Fallback de selo legado por senha (password-major)

**Alternativas consideradas**

1. Para cada senha: tentar o selo normal e, se `Bad hmac value`, o legado com 1 iteração (RF-07 literal).
2. Primeiro tentar todas as senhas com o selo normal; só depois, todas com o legado.

**Escolha: 1.** Mantém a estrutura atual de `unsealSession` (`src/utils/session.ts:324-347`) dentro do laço. A opção 2 ganha em um caso raro (sessão legada selada com a última senha) e perde em clareza. O custo extra é desprezível: o legado usa 1 iteração, e o custo do legado com senha errada é 1 derivação de 1 iteração (cerca de 1/8192 do custo normal). Também se preserva a condição atual de não tentar o legado quando `sealOptions.integrity.iterations === 1` (`src/utils/session.ts:334`) nem quando `legacySealFallback === false` (`src/utils/session.ts:333`).

### D-06 — Validação: lista vazia é eager; senha individual segue o caminho atual

**Contexto.** Hoje a validação de tamanho ocorre tarde, dentro de `generateKey` (`src/utils/internal/iron-crypto.ts:192-196`), e o mínimo vem de `seal.encryption.minPasswordlength` e `seal.integrity.minPasswordlength` (padrão 32, `src/utils/internal/iron-crypto.ts:22` e `:28`). Além disso, `getSession` engole qualquer erro de `unsealSession` (`src/utils/session.ts:196-198`).

**Alternativas consideradas**

1. Validar cada item da lista com antecedência, com uma função própria.
2. Validar só a lista não vazia, com antecedência, e deixar cada senha para `generateKey` (como hoje).
3. Não validar nada antecipadamente.

**Escolha: 2.** `generateKey` já produz as mensagens que o PRD pede (RF-05, segundo critério), e isso é o mesmo caminho da senha única. Mas o caso de lista vazia precisa de um erro explícito: sem a checagem, `seal` lançaria `Empty password` (`src/utils/internal/iron-crypto.ts:65-66`), e a leitura engoliria o erro. A checagem vai no topo de `getSession` (fora do `.catch`) e em `sealSession`, para que ler ou gravar com lista vazia falhe com a mesma mensagem. Para string, nada muda (RF-04).

### D-07 — Tipo público exatamente `string | string[]`

**Alternativas consideradas**

1. `string | string[]`, como o contrato pede.
2. `string | readonly string[]`, que também aceita tuplas `as const`.

**Escolha: 1.** O contrato usa o tipo literal. A alternativa 2 é mais permissiva e compatível, mas é uma decisão de API que o pedido não pediu. Fica registrado como risco (ver Riscos), e pode ser trocada depois sem quebra, já que `readonly string[]` aceita `string[]`.

### D-08 — Onde ficam os helpers

**Escolha.** Helpers privados no fim de `src/utils/session.ts`, junto de `shouldSlide`, `stageSessionErrCookies` e `sessionExpires` (convenção dos arquivos, `AGENTS.md`, "Internal helpers go at the end of files"). Nenhum helper novo vai para `iron-crypto.ts`, e nenhum símbolo novo é exportado, o que mantém `test/unit/package.test.ts` válido.

---

## Arquivos a alterar

### `src/utils/session.ts`

| Local | Mudança |
| --- | --- |
| `src/utils/session.ts:39-48` | `SessionConfig.password` vira `string \| string[]`; atualizar o JSDoc (ordem, primeira sela, lista não vazia, custo de N derivações, remover senha antiga após a transição). |
| `src/utils/session.ts:153` (início de `getSession`) | Chamar `unsealPasswords(config)` ou um validador de lista vazia antes de mexer no contexto, para que lista vazia falhe também na leitura. |
| `src/utils/session.ts:300` | `seal(session, config.password, ...)` passa a usar `sealPassword(config)`. |
| `src/utils/session.ts:312-348` | `unsealSession` deixa de chamar `unseal` diretamente; delega a `unsealWithPasswords(sealed, unsealPasswords(config), sealOptions)`. As checagens de expiração (`src/utils/session.ts:350-365`) ficam como estão. |
| `src/utils/session.ts:324` e `:340` | Substituídos pelo laço (D-04, D-05). |
| fim do arquivo (após `src/utils/session.ts:464`) | Novos helpers `sealPassword`, `unsealPasswords` e `unsealWithPasswords`. |

### `test/session.test.ts`

| Local | Motivo |
| --- | --- |
| `test/session.test.ts:23` | `password` é uma constante `password`, usada também nas chamadas diretas de `seal`/`unseal`. |
| `test/session.test.ts:137`, `:157`, `:164` | Chamadas diretas de `seal`/`unseal` (iron-crypto) com `sessionConfig.password`. Com o tipo `string \| string[]`, elas não compilam (inferência a partir do tipo; não executei o `typecheck`). Trocar por uma constante `string`. |
| Antes de `test/session.test.ts:692` (dentro do `describeMatrix`) | Novo `describe("multiple passwords", ...)`, ver Estratégia de testes. |

### `docs/4.examples/handle-session.md`

- `docs/4.examples/handle-session.md:143`: "Every option is optional except `password`" continua verdadeiro, mas convém acrescentar um parágrafo sobre listas.
- `docs/4.examples/handle-session.md:37`: o aviso de entropia é o lugar natural para dizer que a senha antiga deve sair da lista.

### Sem alterações

- `src/utils/internal/iron-crypto.ts`: `seal` e `unseal` seguem recebendo uma senha.
- `src/index.ts:199-212`: nenhum símbolo novo.
- `src/utils/cookie.ts`, `src/utils/proxy.ts`, `src/utils/auth.ts`: nada lê `config.password` (busca em `src/`: só `src/utils/session.ts` usa `config.password`). `src/utils/auth.ts` tem um `password` próprio de basic auth, sem relação.
- `CHANGELOG.md`: gerado pelo `changelogen`.

---

## Contratos e assinaturas

```ts
// src/utils/session.ts

export interface SessionConfig {
  /**
   * Private key(s) used to seal session tokens. A single string behaves as before.
   * A list is tried in order when opening: the first password seals new sessions,
   * the rest only open sessions sealed before a rotation. Must not be empty.
   * ...
   */
  password: string | string[];
  // ...demais campos inalterados
}

/** Senha usada para selar: a primeira da lista. Lança se a lista estiver vazia. */
function sealPassword(config: SessionConfig): string;

/** Senhas tentadas ao abrir, em ordem. Lança se a lista estiver vazia. */
function unsealPasswords(config: SessionConfig): string[];

/**
 * Tenta cada senha em ordem. Só `Bad hmac value` avança para a próxima; qualquer
 * outro erro é relançado. Aplica o fallback de selo legado a cada senha e marca
 * o resultado com `kLegacySeal`. Se nenhuma abrir, relança o último `Bad hmac value`.
 */
async function unsealWithPasswords(
  sealed: string,
  passwords: string[],
  sealOptions: SealOptions,
): Promise<Partial<Session>>;
```

Mensagem de lista vazia: `"Session password list is empty: at least one password is required"`. Nenhum símbolo novo é exportado. As assinaturas públicas de `useSession`, `getSession`, `sealSession`, `unsealSession`, `updateSession` e `clearSession` não mudam, exceto pelo tipo de `config.password`.

Esboço do laço (para o implementador; não é código final):

```ts
let lastError: unknown;
for (const password of passwords) {
  try {
    return (await unseal(sealed, password, sealOptions)) as Partial<Session>;
  } catch (error) {
    if (!isBadHmac(error)) throw error;
    lastError = error;
  }
  if (config.legacySealFallback === false || sealOptions.integrity.iterations === 1) continue;
  try {
    const legacy = await unseal(sealed, password, legacyOptions);
    if (legacy) (legacy as any)[kLegacySeal] = true;
    return legacy as Partial<Session>;
  } catch (error) {
    if (!isBadHmac(error)) throw error;
    lastError = error;
  }
}
throw lastError;
```

`legacySealFallback` e `sealOptions` precisam ser passados ao helper (o helper não recebe `config`). A forma final fica a critério do implementador, desde que siga D-04 e D-05.

---

## Estratégia de testes

Seguir o padrão de `test/session.test.ts`: `describeMatrix` (web e node), `t.fetch`, `t.app`, `seal`/`unseal` diretos para montar selos. Nenhum teste novo precisa de mocks, exceto quando contar derivações.

Testes novos em `describe("multiple passwords", ...)`. Cada um cobre um requisito:

1. **Sela com a primeira (RF-02):** `useSession` com `[A, B]` gera cookie que abre com `A` e não abre com `B` (`unseal(cookie, B)` rejeita com `Bad hmac value`).
2. **Abre sessão antiga (RF-03):** cookie selado com `B` lido com `[A, B]` retorna os dados e mantém o `id`.
3. **Resela com a primeira (RF-02, RF-03):** após uma gravação, o novo cookie abre com `A`.
4. **Senha fora da lista (RF-03):** selo com `C` lido com `[A, B]` gera sessão nova, sem dados; `unsealSession` diretamente rejeita com `Bad hmac value`.
5. **Header de sessão (RF-06):** sessão selada com `B` enviada pelo header `x-h3-test-session` é aberta, igual a um cookie.
6. **Legado com senha antiga (RF-07):** selo de 1 iteração com `B` lido com `[A, B]` abre, é marcado como legado e é resselado com `A`.
7. **Legado desabilitado (RF-07):** o mesmo com `legacySealFallback: false` não abre.
8. **Lista vazia (RF-05):** `sealSession` e `getSession` com `password: []` lançam `Session password list is empty...`. Para capturar a mensagem, a rota devolve `e.message` no corpo.
9. **Lista de um item equivale a string (RF-04):** cookie selado com `"senha"` abre com `["senha"]`, e vice-versa.
10. **Validação de tamanho (RF-05):** `sealSession` com `password: ["curta", B]` lança `Password string too short` (a primeira senha sela, então a validação dela é exercitada). Com `password: [A, "curta"]`, sessões seladas com `A` continuam abrindo; tentar abrir um selo de `"curta"` falha com o mesmo erro, que é o comportamento de senha única.
11. **Contagem de derivações (D-04, D-05):** sessão selada com a última de três senhas gera três tentativas de HMAC. Usar `vi.spyOn(crypto.subtle, "deriveBits")` no modelo de `test/session.test.ts:722-735`, verificando o total esperado (N-1 falhas de 1 derivação com 8192 iterações, mais o acerto).

Testes existentes que não devem mudar de comportamento: todos de `test/session.test.ts`, exceto a troca do acesso a `sessionConfig.password` nas linhas 137, 157 e 164.

Verificação: `pnpm vitest run test/session.test.ts`, depois `pnpm typecheck`, `pnpm lint` e `pnpm test` completo. Os testes devem falhar antes da implementação, como exige o fluxo do `AGENTS.md` (escrever o teste de regressão antes).

---

## Riscos

1. **Custo de leitura.** Sessão inválida ou selada com a última senha custa N derivações (e N-1 legadas no pior caso). Mitigação: documentar; listas de 2 a 3 senhas. Decisão D-03 evita o custo maior.
2. **Senha antiga esquecida.** Quem tiver a senha antiga continua forjando sessões enquanto ela estiver na lista. Mitigação: documentar que a senha antiga deve sair da lista após o período de transição (JSDoc e `docs/4.examples/handle-session.md`).
3. **Tipo público mais largo.** Código de terceiros que lê `config.password` como `string` deixa de compilar. Mitigação: nenhum código interno faz isso (busca em `src/`); ver D-07 para `readonly string[]`.
4. **Tuplas `as const` não compilam** com `string[]` (`['a', 'b'] as const` é `readonly`). Mitigação: D-07; trocar por `readonly string[]` se algum usuário reclamar.
5. **Erro engolido na leitura.** `getSession` ignora erros de `unsealSession` (`src/utils/session.ts:196-198`). Uma senha inválida na lista, na posição 2 ou depois, faz a leitura de sessões antigas virar sessão nova sem aviso. Mitigação: validação de lista vazia no topo de `getSession` (D-06). Senha individual inválida segue o comportamento atual; não é um erro novo.
6. **Regressão silenciosa no legado.** O fallback de legado com a lista pode dobrar o número de tentativas. Mitigação: testes 6, 7 e 11.
7. **Tempo de resposta vaza a posição da senha.** Quem mede o tempo de resposta descobre se a sessão foi selada com a primeira ou com uma antiga. Isso não revela a senha, e a sessão já é identificável pelo cookie. Risco baixo, aceito.
8. **Mensagens de erro.** A mensagem de lista vazia é distinta de `Bad hmac value`, mas não cita índices nem senhas.
9. **Build de docs e CHANGELOG.** Nada gerado é editado à mão.
