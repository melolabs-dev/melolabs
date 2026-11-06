# Especificação técnica: várias senhas de unseal em sessões (h3js/h3#1050, variante b)

Base: `sdd/pedido.md` (contrato) e `sdd/prd.md` (RF-01 a RF-08). Esta especificação não repete os requisitos; ela decide como implementá-los no código atual. Todas as citações `arquivo:linha` foram conferidas nos arquivos da pasta do projeto.

## 1. Visão geral

Hoje `unsealSession` (`src/utils/session.ts:312`) abre a sessão com uma única senha, `config.password`. A mudança:

- `SessionConfig` ganha `extraUnsealPasswords?: string[]`.
- `unsealSession` passa a tentar, em sequência, `[password, ...extras]`. Cada tentativa mantém o fallback legado de 1 iteração PBKDF2 já existente.
- Sessões abertas por uma senha extra são re-seladas com `password` pelo mesmo caminho que hoje re-sela sessões legadas (`getSession`).
- Toda selagem continua usando só `password`. Uma validação central rejeita senhas inválidas antes de selar.

Nenhuma mudança é necessária em `clearSession`, nos cookies em pedaços ou no cabeçalho de sessão. O motivo está em D-07.

## 2. Decisões de arquitetura

### D-01 — Abertura sequencial por candidatos dentro de `unsealSession`

**Contexto.** O contrato exige tentativas em sequência: `password` primeiro, depois as extras na ordem da lista, parando na primeira que abrir (pedido.md, item 3; RF-03). Também precisa valer o fallback legado para cada senha (RF-08).

**Alternativas consideradas.**

1. Usar a forma de múltiplas senhas do próprio iron (`PasswordHash`, `iron-crypto.ts:427`). Descartada: o iron escolhe a senha pelo `passwordId` gravado no token selado. Os tokens atuais são selados com id vazio (`iron-crypto.ts:68`, `_passwordId = "default"` em `:121`). Usar essa forma exigiria ids nos tokens e quebraria a compatibilidade com sessões existentes, o que o contrato proíbe.
2. Tentar todos os candidatos com as opções atuais e só depois com o fallback legado. Descartada: em sessões legadas, custa uma passada extra de PBKDF2 de 8192 iterações por candidato antes de chegar ao fallback.
3. Tentar candidatos em paralelo (`Promise.any`). Descartada: contradiz "uma de cada vez, em sequência" e multiplica o custo de CPU.

**Escolha.** Loop sequencial. Para cada candidato: uma chamada `unseal` com as opções atuais e, se a regra de fallback valer para ele, uma segunda chamada com 1 iteração. Só depois passa-se ao próximo candidato. Esta ordem coincide com a de custo mínimo para sessões legadas: `password` (atual, depois legado), extra 1 (atual, depois legado) e assim por diante.

**Custo medido por candidato errado.** O HMAC é verificado antes da decifragem (`iron-crypto.ts:133-137`), então uma senha errada custa uma derivação `deriveBits` (integridade, `iron-crypto.ts:155-166`, `:249`). Com fallback legado, custa mais uma derivação de 1 iteração. Uma senha correta custa duas derivações (integridade e decifragem), como hoje.

### D-02 — Critério de avanço entre candidatos

**Contexto.** `unseal` lança erros diferentes conforme a causa. Só "senha errada" deve levar à próxima tentativa.

**Regras.**

- Avança-se para o próximo candidato apenas no erro `"Bad hmac value"` (`iron-crypto.ts:135-137`) do candidato atual.
- Erros de formato, `"Expired seal"` (`iron-crypto.ts:115-117`, lançado antes do HMAC e igual para qualquer senha), erro de decifragem e expiração por `maxAge`/`idleTimeout` (`session.ts:350-365`) são propagados imediatamente.
- Na leitura, um candidato inválido (vazio ou curto, conforme D-04) é pulado sem erro. Assim, uma extra inválida na posição 1 não impede a abertura por uma extra válida na posição 2. Se nenhum candidato for válido, a leitura lança erro e `getSession` o trata como sessão inexistente (`session.ts:196-198`, o `.catch(() => {})`).

**Alternativas.** Parar no primeiro erro qualquer: descartada, porque bloquearia a extra válida por causa de uma extra inválida na frente. Tratar a validação só na selagem e deixar a leitura falhar: descartada, porque o contrato só exige rejeição nas operações que selam.

### D-03 — Marcador interno `kExtraSeal` para a rotação progressiva

**Contexto.** RF-05 exige re-selar com `password` quando a sessão foi aberta por uma extra. O mecanismo atual para sessões legadas usa o símbolo `kLegacySeal` colado no objeto retornado por `unsealSession` (`session.ts:346`, lido em `session.ts:199-202`).

**Escolha.** Criar `kExtraSeal` em `src/utils/internal/session.ts`, com o mesmo padrão de `kLegacySeal` (`Symbol.for`). `unsealSession` marca o resultado quando o candidato vencedor não é `password`. `getSession` lê o marcador, apaga-o antes do `Object.assign` e acrescenta a condição à re-selagem.

**Obrigatório.** Apagar o marcador antes de `Object.assign(session, unsealed)` (`session.ts:208`). `Object.assign` copia símbolos próprios enumeráveis, então um marcador esquecido vazaria para o objeto da sessão.

**Alternativa descartada.** Mudar o tipo de retorno de `unsealSession` para uma tupla `{ session, sealedWith }`. Descartada: `unsealSession` é exportada (`src/index.ts:209`), e mudar o retorno quebraria a API pública. O contrato exige "nenhum nome público novo".

### D-04 — Validação centralizada, executada em `sealSession`

**Contexto.** RF-06 exige rejeitar com erro cuja mensagem contém "password" nas operações que selam, mesmo sem sessão.

**Escolha.** Uma função interna `assertSessionPasswords(config, sealOptions)` valida `password` e cada item de `extraUnsealPasswords`. A função é chamada no início de `sealSession` (`session.ts:282`). Esse ponto cobre todos os caminhos que selam:

- `useSession` ao criar a sessão: `useSession` chama `updateSession` quando há `kSessionNew` (`session.ts:116-118`), e `updateSession` chama `sealSession` (`session.ts:267`).
- `updateSession` com cookie habilitado e `res` presente (`session.ts:266`).
- `sealSession` chamado diretamente.

Com `cookie: false`, nada é selado e nada é validado, o que é coerente com o contrato ("operação que sela").

**Regra de validação.** Uma senha é inválida se não for string, se for vazia ou se tiver comprimento menor que `max(encryption.minPasswordlength, integrity.minPasswordlength)` do `sealOptions` resolvido. Os padrões são 32 (`iron-crypto.ts:22` e `:28`). A mensagem usa "password" em minúsculas, indica o índice e nunca inclui o valor, por exemplo `Invalid session password: extraUnsealPasswords[1] must be a non-empty string with at least 32 characters`. Nota: a mensagem atual do iron começa com "Password" maiúsculo (`iron-crypto.ts:194`), então não serve como referência para o teste de regex.

**Atomicidade em `updateSession`.** `updateSession` altera `session.data` e apaga `kSessionNew` (`session.ts:258-263`) antes de selar. Se a validação só ocorrer dentro de `sealSession`, uma configuração inválida deixa a sessão em memória alterada. Recomendação: chamar `assertSessionPasswords` no início de `updateSession`, dentro do mesmo `if` do cookie (`session.ts:266`), antes de qualquer mutação. Isso não muda o comportamento para `password` válida.

**Re-selagem em `getSession`.** Não pode disparar validação com configuração inválida, porque uma senha inválida nunca abre a sessão (D-02 e `iron-crypto.ts:192-196`). Por isso a re-selagem da leitura nunca cai na validação.

### D-05 — Resolução única das opções de selo

**Contexto.** O mesmo objeto de opções é montado três vezes: em `sealSession` (`session.ts:300-304`), em `unsealSession` (`session.ts:317-321`) e, agora, na validação. As três fórmulas são idênticas: `ttl` a partir de `maxAge`/`idleTimeout` e depois `...config.seal`.

**Escolha.** Função interna `resolveSealOptions(config)` usada pelas três. A mudança é de refatoração, sem efeito de comportamento, e evita divergência entre validação e abertura.

### D-06 — Campo de configuração

**Escolha.** Em `SessionConfig` (`src/utils/session.ts:39`), logo após `password` (`:48`), adicionar `extraUnsealPasswords?: string[]` com comentário de tipo que diga: senhas anteriores, só para abrir, nunca selam, e a validação segue `password`. Nenhum outro export novo. `password` continua `string`.

### D-07 — Sem mudança em `clearSession`, cookies em pedaços e cabeçalho

- `clearSession` (`src/utils/session.ts:372-386`) não lê nem abre a sessão. Ele apaga o contexto e grava `Max-Age=0` no cookie. O RF-07 é atendido sem código novo.
- Cookies em pedaços: a leitura junta os pedaços em `getChunkedCookie` (`src/utils/cookie.ts:154-176`), e `unsealSession` recebe a string inteira. Quando a re-selagem muda o número de pedaços, `setChunkedCookie` já remove os pedaços antigos que sobram (`src/utils/cookie.ts:215-225`), com base no cookie da requisição. Nenhuma mudança é necessária, mas há teste (seção 5).
- Cabeçalho de sessão: `sessionFromCookie` é `false` (`src/utils/session.ts:189-193`) e a condição de re-selagem o exclui (`session.ts:214`). Nenhuma mudança.

### D-08 — Sem limite no número de extras

**Escolha.** Não impor limite no código. O custo por requisição é de até N+1 derivações por candidato mais o fallback (D-01). Esse custo deve ser documentado em comentário de tipo, e o limite fica como decisão em aberto (seção 6).

## 3. Arquivos a alterar

| Arquivo | Trecho atual | Alteração |
|---|---|---|
| `src/utils/session.ts` | `SessionConfig.password` em `:48` | Adicionar `extraUnsealPasswords?: string[]` (D-06). |
| `src/utils/session.ts` | `getSession`, bloco de tratamento do resultado em `:199-202` | Ler e apagar o marcador `kExtraSeal` antes do `Object.assign` (`:208`) (D-03). |
| `src/utils/session.ts` | Condição de re-selagem em `:214-216` | Acrescentar `extraSeal` à condição (D-03). |
| `src/utils/session.ts` | `updateSession` em `:241-277` | Chamar `assertSessionPasswords` antes da mutação, dentro do ramo do cookie (`:266`) (D-04). |
| `src/utils/session.ts` | `sealSession` em `:282-307` | Chamar `assertSessionPasswords` no início e usar `resolveSealOptions` na chamada `seal` em `:300-304` (D-04, D-05). |
| `src/utils/session.ts` | `unsealSession` em `:312-367` | Substituir o `try/catch` de `:323-348` pelo loop de candidatos (D-01, D-02) e marcar `kExtraSeal` (D-03). Usar `resolveSealOptions` em `:317-321` (D-05). |
| `src/utils/session.ts` | Novas funções internas | `resolveSealOptions`, `assertSessionPasswords`, `unsealWithPassword` (D-01, D-04, D-05). |
| `src/utils/internal/session.ts` | Símbolos em `:3-9` | Adicionar `kExtraSeal` (D-03). |
| `test/session.test.ts` | Testes de legado em `:134` e `:161`, teste de deriveBits em `:722` | Acrescentar os testes da seção 5. Não alterar os existentes (`pedido.md`, "O que não pode mudar"). |

Não alterar: `src/index.ts` (exports, `:200-212`), `src/utils/cookie.ts`, `src/utils/internal/iron-crypto.ts` (o contrato de `unseal` é usado como está), `src/types/context.ts:21`.

## 4. Contratos e assinaturas

```ts
// src/utils/session.ts — API pública (única mudança de tipo)
export interface SessionConfig {
  /** Senha atual: sela sempre e também abre. Tipo inalterado. */
  password: string;
  /**
   * Senhas anteriores, usadas só para abrir sessões. Nunca selam.
   * Tentadas em ordem após `password`. Ausente e [] são equivalentes.
   * Cada item segue a mesma regra de `password` (não vazio, tamanho mínimo).
   * Custo: uma derivação PBKDF2 por senha tentada que não abre a sessão.
   */
  extraUnsealPasswords?: string[];
  // ... demais campos inalterados
}

// Assinaturas públicas inalteradas
export function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;

export function sealSession<T>(event: HTTPEvent, config: SessionConfig): Promise<string>;
export function updateSession<T>(event: HTTPEvent, config: SessionConfig, update?: SessionUpdate<T>): Promise<Session<T>>;
export function getSession<T>(event: HTTPEvent, config: SessionConfig): Promise<Session<T>>;
export function useSession<T>(event: HTTPEvent, config: SessionConfig): Promise<SessionManager<T>>;
export function clearSession(event: HTTPEvent, config: Partial<SessionConfig>): Promise<void>;
```

Internas (não exportadas):

```ts
// src/utils/session.ts
function resolveSealOptions(config: Pick<SessionConfig, "maxAge" | "idleTimeout" | "seal">): SealOptions;
// Mesma fórmula atual: ttl = (maxAge || idleTimeout || 0) * 1000, depois ...config.seal.

function assertSessionPasswords(config: SessionConfig, sealOptions: SealOptions): void;
// Lança Error cuja mensagem contém "password" e nunca o valor da senha.

function unsealWithPassword(
  sealed: string,
  password: string,
  sealOptions: SealOptions,
  legacySealFallback: boolean,
): Promise<Partial<Session>>;
// Conteúdo do try/catch atual (session.ts:323-348) para uma senha.
// Marca kLegacySeal quando abre pelo fallback. Lança "Bad hmac value" se a senha não abre.
```

Esboço de `unsealSession` (ilustrativo; a forma final de TypeScript fica a cargo de quem implementar):

```ts
export async function unsealSession(_event, config, sealed) {
  const sealOptions = resolveSealOptions(config);
  const legacy = config.legacySealFallback !== false;
  const candidates = [config.password, ...(config.extraUnsealPasswords ?? [])];

  let unsealed: Partial<Session> | undefined;
  let openedByExtra = false;
  let lastError: unknown;
  for (const [index, password] of candidates.entries()) {
    if (!isValidPassword(password, sealOptions)) continue;  // D-02: pula inválida na leitura
    try {
      unsealed = await unsealWithPassword(sealed, password, sealOptions, legacy);
      openedByExtra = index > 0;
      break;
    } catch (error) {
      if (!isBadHmac(error)) throw error;                   // D-02: só senha errada avança
      lastError = error;
    }
  }
  if (!unsealed) throw lastError ?? new Error("No valid session password");
  if (openedByExtra) (unsealed as any)[kExtraSeal] = true; // D-03
  // ... checagens de maxAge e idleTimeout inalteradas (session.ts:350-365)
  return unsealed;
}
```

Esboço da condição em `getSession`:

```ts
const extraSeal = unsealed && (unsealed as any)[kExtraSeal];
if (extraSeal) delete (unsealed as any)[kExtraSeal];
// ...
if (session.id && sessionFromCookie && (legacySeal || extraSeal || shouldSlide(session, config))) {
  await updateSession(event, config);
}
```

Nota sobre o esboço: `unsealed` pode ficar `undefined` em um erro de validação de todos os candidatos. Isso é tratado pelo `.catch` de `getSession`, que é o comportamento esperado para senha desconhecida (RF-04).

Mensagem de erro, exemplo: `Invalid session password: extraUnsealPasswords[1] must be a non-empty string with at least 32 characters.`

## 5. Estratégia de testes

Seguir `AGENTS.md`: testes com `describeMatrix` (web e node), arquivo `test/session.test.ts`. Para cada teste novo, confirmar que falha antes da mudança (fluxo de correção de bug do AGENTS.md, aplicado aqui como teste de regressão para cada RF).

Helper de teste: `seal(...)` de `src/utils/internal/iron-crypto.ts` com `sealDefaults` para gerar cookies com P0 (extra), P1 (password) e com 1 iteração (legado), como já faz `test/session.test.ts:134`.

Casos:

1. **RF-01.** Com `extraUnsealPasswords: []`, `getSession` de sessão selada com `password` retorna o mesmo que sem o campo (sem `Set-Cookie`).
2. **RF-02.** `updateSession` e `sealSession` com `password = P1` e extras `[P0]`: o cookie gravado abre com P1 e não abre com P0 (`unseal` direto).
3. **RF-03, ordem.** Espiar `crypto.subtle.deriveBits` (como em `test/session.test.ts:722`), descontando a re-selagem da leitura. Cada senha errada custa 2 derivações (atual e legado, `iron-crypto.ts:249`); a senha certa custa 2 (integridade e decifragem). Sessão selada com `password`: 2, igual a uma configuração sem extras, e nenhuma extra é tentada. Sessão selada com a primeira extra: 2 (password, errada) + 2 (extra 0, certa) = 4. Sessão selada com a segunda extra: 2 + 2 (extra 0, errada) + 2 (extra 1, certa) = 6. Os números devem ser confirmados ao rodar o teste.
4. **RF-04.** Sessão selada com senha fora da lista: `useSession` retorna sessão nova e vazia, sem erro.
5. **RF-05.** Sessão em cookie selada com extra: `useSession` sem escrita devolve `Set-Cookie` re-selado com `password`, mesmo `id` e dados; descriptografar com `password` e `sealDefaults` funciona. Sessão com `password`: sem `Set-Cookie`. Sessão no cabeçalho com extra: sem `Set-Cookie`.
6. **RF-06.** Extra curta na posição 1 e extra vazia: `updateSession` e `sealSession` rejeitam com `/password/`. `useSession` sem cookie com extra vazia rejeita. Com configuração válida, nenhum erro. Senha `password` inválida continua rejeitando.
7. **D-02, leitura.** Extra inválida na posição 0 e válida na posição 1: sessão selada com a posição 1 abre normalmente.
8. **RF-07, chunks.** Sessão grande (dados que passem de 4000 caracteres selados, `CHUNKS_MAX_LENGTH` em `src/utils/cookie.ts:13`) selada com extra: `getSession` devolve os dados e a re-selagem grava pedaços. Verificar que pedaços antigos são removidos quando a re-selagem produz menos pedaços.
9. **RF-07, cabeçalho e clear.** Sessão enviada pelo cabeçalho selada com extra: leitura funciona, sem re-selagem. `clearSession` com essa sessão limpa o cookie com `Max-Age=0`.
10. **RF-07, `unsealSession` direto.** Chamada exportada com extras devolve a sessão correta.
11. **RF-08.** Sessão legada (1 iteração) selada com extra e `legacySealFallback` ativo: `useSession` abre e re-sela com `password` e opções atuais. Com `legacySealFallback: false`: tratada como inexistente.
12. **Regressão de expiração.** Sessão selada com extra e `maxAge` vencido: vira sessão nova e não há re-selagem.
13. **Regressão existente.** Os testes atuais de `test/session.test.ts` passam sem mudança. O teste de `seals once` (`:722`) continua com 2 derivações. `test/unit/package.test.ts:149` continua listando os mesmos exports.

Comandos:

```bash
pnpm vitest run test/session.test.ts
pnpm vitest run test/unit/
pnpm lint          # oxlint + oxfmt --check (package.json:46)
pnpm typecheck     # tsc --noEmit (package.json:54)
pnpm test          # lint + typecheck + cobertura completa (package.json:53)
```

## 6. Riscos e pendências

1. **Custo de CPU.** Cada extra tentada custa uma derivação PBKDF2 de 8192 iterações (`iron-crypto.ts:21`, `:27`, com SHA-1 em `:206`). Requisições com sessão de senha desconhecida pagam até 2 derivações por candidato (uma com as opções atuais e uma com o fallback legado, se ativo), ou seja, até 2(N+1). Sem limite no código (D-08), isso precisa ser documentado. **Pendência:** o usuário decide se há um limite máximo de extras.
2. **Set-Cookie em leituras.** A rotação progressiva faz handlers que só leem devolverem `Set-Cookie`. Pode afetar caches intermediários. Testar com e sem cache.
3. **Rotação incompleta para cabeçalho de sessão.** Sessões vindas do cabeçalho não são re-seladas (RF-05). A senha antiga precisa continuar configurada enquanto houver tokens de cabeçalho válidos. Isso é consequência do contrato e deve ser comunicado.
4. **Erros de validação só em operações que selam.** `getSession` e `unsealSession` não lançam erro com configuração inválida. Um operador não vê o problema até a primeira selagem. Isso é coerente com o contrato, mas é uma diferença a comunicar.
5. **Mudança de comportamento só em configuração inválida.** Com `password` válida e extras vazias ou válidas, nada muda. Com `cookie: false`, a validação não roda (D-04), igual a hoje para `password`.
6. **Fallback legado combinado.** Por D-01, uma sessão legada selada com a extra 1 custa a tentativa com a senha principal (atual e legado) antes de chegar à extra. Os testes da seção 5 (item 11) cobrem a combinação.
7. **Vazamento de senha.** Mensagens de erro e logs nunca incluem o valor (D-04). Revisar que `unsealSession` e `getSession` não passam o valor para `HTTPError` nem para mensagens.
8. **Símbolo copiado por `Object.assign`.** Apagar `kExtraSeal` antes de `session.ts:208` (D-03). Teste: a sessão final não tem símbolo `kExtraSeal`.
9. **Concorrência.** Duas requisições com a mesma sessão antiga geram dois `Set-Cookie` com tokens diferentes. O último vence (aceitável, conforme PRD). Testar com requisições paralelas se possível.
10. **Tamanho do cookie.** A re-selagem pode mudar o número de pedaços. Coberto pelo item 8 da seção 5.
11. **Decisões em aberto para o usuário.**
    - Limite máximo de `extraUnsealPasswords` (item 1).
    - Validação antecipada em `updateSession` antes da mutação (D-04). Recomendado.
    - Nenhuma alteração de documentação pública além do comentário do campo (pedido.md, "Fora de escopo").
