# Especificação técnica — Várias senhas de unseal nas sessões (h3js/h3#1050)

Base: `sdd/pedido.md` (contrato #1050-b) e `sdd/prd.md` (RF-01 a RF-09, P-01 a P-05, R-01 a R-06). Todas as referências `arquivo:linha` foram conferidas no código em `master` (commit `5aa6662`).

## Resumo

`SessionConfig` ganha `extraUnsealPasswords?: string[]`. A abertura do cookie passa a tentar, em ordem, `password` e depois cada senha extra; a primeira que passa na verificação de HMAC vence. A selagem continua sempre com `password`. Se a sessão foi aberta com uma senha extra, `getSession` regrava o cookie com `password` na mesma resposta. A verificação de expiração (`maxAge`/`idleTimeout`) continua depois da abertura, uma única vez, sobre a sessão já aberta.

A mudança fica concentrada em `src/utils/session.ts` (`unsealSession` e o trecho de `getSession` que reselá), com um símbolo interno novo em `src/utils/internal/session.ts`. Nenhum export público novo, nenhuma mudança em `iron-crypto.ts`.

---

## Decisões de arquitetura

### D-01 — Onde ficar o laço de tentativas: só na abertura, antes da expiração

**Decisão:** o laço sobre as senhas envolve apenas a chamada de decifragem/HMAC. As checagens de `maxAge` e `idleTimeout` (`src/utils/session.ts:350-365`) continuam depois do laço, executadas uma única vez sobre o resultado.

**Alternativas consideradas:**
- *Laço completo em volta de `unsealSession`, incluindo expiração:* expiraria uma sessão antiga e tentaria a próxima senha, o que viola RF-05 e gasta CPU à toa.
- *Checar expiração dentro do laço a cada senha:* mesmo problema, com código duplicado.

**Escolha:** laço só na abertura. Como a expiração não depende da senha (depende de `createdAt`/`lastSeenAt` dentro do payload já aberto), ela só precisa rodar uma vez, depois que alguma senha abriu o cookie. Satisfaz RF-05 por construção.

### D-02 — Ordem de tentativa e formato legado por senha

**Decisão:** as senhas são deduplicadas preservando a ordem (`[config.password, ...extras]` passado por `new Set`). Para cada senha, primeiro se tenta o formato atual e, se `legacySealFallback` permitir, o formato legado de 1 iteração. Só então passa-se para a próxima senha.

**Alternativas consideradas:**
- *Duas passagens (todas as senhas no formato atual, depois todas no legado):* mesmo custo de pior caso e mesma contagem para cookies modernos e legados com a senha atual. Mais difícil de ler e não resolve nada que a ordem por senha não resolva.

**Escolha:** ordem por senha. Mantém a leitura literal de RF-04 ("password primeiro, depois cada extra na ordem em que aparecem") e a lógica de fallback existente (`src/utils/session.ts:332-347`) passa a ser aplicada a cada senha sem alteração.

Deduplicação: `password` repetido ou extras iguais a `password` são removidos antes do laço (RF-04: não alteram o resultado nem geram tentativas extras).

### D-03 — Quais erros continuam a tentativa e quais propagam

**Decisão:** o laço só avança para a próxima senha quando o erro é `Bad hmac value` (senha errada). Qualquer outro erro (`Expired seal`, `Empty password`, `Password string too short`, erro de JSON, erro de formato) propaga imediatamente, exatamente como hoje para `password`.

**Premissa P-04 resolvida:** a regra de validação de senha não está em `session.ts`. Está em `src/utils/internal/iron-crypto.ts:65` e `:94` (`Empty password`) e em `:191-196` (tamanho mínimo `minPasswordlength`, 32 por padrão em `:22`/`:28`). Essa validação roda tanto em `seal` quanto em `unseal`. Logo, uma senha extra recebe o mesmo tratamento de `password` sem código novo (RF-08), desde que o erro não seja engolido por um `catch` indevido.

**Alternativas consideradas:**
- *Pular qualquer erro e tentar a próxima senha:* esconderia configuração errada, e uma senha curta não é um "não bate", é um erro de configuração.
- *Validar `extraUnsealPasswords` antecipadamente em `useSession`:* criaria um tratamento diferente do de `password`, que só erra no primeiro `seal`. Violaria RF-08.

**Consequência a registrar:** uma senha extra curta, colocada antes da senha que de fato selou o cookie, faz a leitura falhar para esse cookie (`getSession` engole o erro e cria sessão nova). Isso é o mesmo efeito que uma `password` curta já produz hoje na leitura. Documentar em R-07 (seção de riscos).

### D-04 — Sinalizar "aberto com senha extra" com símbolo interno, seguindo `kLegacySeal`

**Decisão:** `unsealSession` marca o objeto retornado com um símbolo interno `kExtraSeal` quando a senha que abriu não é a primeira da lista. `getSession` usa essa marca junto com `legacySeal` na condição de regravação e a apaga antes de copiar o payload para a sessão.

**Alternativas consideradas:**
- *Retornar um tipo novo ou um segundo valor de `unsealSession`:* quebraria a assinatura exportada (P-05, R-06).
- *Comparar a senha usada com `config.password` em `getSession`:* `getSession` não sabe qual senha abriu. Exigiria passar a informação por fora.
- *Campo string no payload (ex.: `sealedWith: "extra"`):* gravaria metadado no payload selado e ficaria visível para o código do usuário em `session.data`/`session`.

**Escolha:** símbolo, no mesmo padrão de `kLegacySeal` (`src/utils/internal/session.ts:7-9`, usado em `src/utils/session.ts:199-201` e `:346`). Símbolo não entra em `JSON.stringify`, então não vai para o cookie, e não aparece em `session.data`.

### D-05 — Manter a assinatura de `unsealSession` e isolar o laço num helper interno

**Decisão:** `unsealSession(_event, config, sealed)` mantém assinatura e tipo de retorno (P-05). O trecho try/catch atual (`src/utils/session.ts:323-348`) vira um helper interno `openWithPassword(sealed, password, sealOptions)`, e um novo helper `openWithPasswords(sealed, config, sealOptions)` faz o laço. Os helpers ficam no fim de `session.ts`, conforme a convenção do AGENTS.md ("internal helpers at end of files").

**Alternativas consideradas:**
- *Colocar o laço inline em `unsealSession`:* funciona, mas mistura três níveis (laço, fallback legado, expiração) em uma função de ~60 linhas. Aumenta o risco de a checagem de expiração ficar dentro do laço por engano (D-01).

**Escolha:** helpers internos. `unsealSession` continua sendo a única função pública envolvida e fica com a mesma ordem de leitura: abrir, checar `maxAge`, checar `idleTimeout`.

### D-06 — Não usar o mecanismo de `password id` do iron nem adicionar `kid` ao token

**Decisão:** não mudar o formato do token. As senhas extras são tentadas por tentativa e erro (P-02).

**Fatos verificados:**
- O token já tem um campo de identificador de senha: `passwordId` em `src/utils/internal/iron-crypto.ts:99-103`. Hoje ele é sempre vazio, porque `seal` usa `normalizePassword` sobre uma string, que não tem `id` (`:68`, `:304-306`). Ou seja, P-02 está correta para os tokens atuais, mas o formato permite um `kid` futuro sem mudar o envelope.
- `unseal` aceita um objeto de senhas indexado por id (`PasswordHash`, `:121-128`, `:427`). Esse caminho escolhe **uma** chave pelo `passwordId` do token. Como todos os tokens atuais têm id `""` (que vira `"default"` em `:121`), o objeto só tentaria uma chave e não daria fallback.

**Alternativas consideradas:**
- *Usar `PasswordHash` do iron com id `default` para a senha atual e ids novos para as antigas:* exigiria que o selo gravasse `kid`. Mudaria o formato de todo cookie emitido, o que é "Mudanças em ... formato do seal" (fora de escopo do PRD) e deixaria as sessões já existentes sem id, sem como saber qual chave usar.
- *Gravar `kid` no payload selado:* o mesmo problema de formato, e o metadado ficaria dentro do payload.

**Escolha:** tentativa e erro. É a única opção que não muda o formato e respeita o escopo. Fica registrada como evolução possível (`kid` em v3), não como trabalho desta entrega.

### D-07 — Custo de CPU sem limite rígido na lista

**Decisão:** não impor limite de tamanho à lista de senhas extras. Documentar que cada senha extra custa uma abertura por requisição com cookie que não abre com as anteriores, e que o `legacySealFallback` dobra esse custo por senha (R-03).

**Alternativas consideradas:**
- *Limite fixo (ex.: 3 extras) validado em `useSession`:* arbitrário, e o PRD diz que a mitigação de R-03 "não está no escopo deste PRD".

**Escolha:** sem limite no código, documentação em `docs/4.examples/handle-session.md` (seção de opções, perto de `password`, linha 37, e de `legacySealFallback`). A documentação é recomendada, não obrigatória para o aceite do PRD.

### D-08 — Regravação somente para cookie, sem tocar em sessões de header

**Decisão:** a condição de regravação em `getSession` continua exigindo `sessionFromCookie` (`src/utils/session.ts:214`). Com isso, sessões lidas pelo header `x-{name}-session` aceitam senhas extras (RF-09) e não geram `Set-Cookie`, sem código extra.

**Escolha:** nenhuma mudança além de incluir `extraSeal` na condição já existente.

---

## Arquivos a alterar

| Arquivo | Mudança |
| --- | --- |
| `src/utils/session.ts` | Campo `extraUnsealPasswords` em `SessionConfig` (após `password`, linha 48). `getSession`: extrair a marca `kExtraSeal` na linha 199-201, apagá-la e incluí-la na condição da linha 214. `unsealSession` (linhas 312-367): trocar o try/catch das linhas 323-348 pelo laço via helpers. Helpers novos no fim do arquivo. |
| `src/utils/internal/session.ts` | Novo símbolo `kExtraSeal`, após `kLegacySeal` (linhas 7-9). |
| `test/session.test.ts` | Novos testes dentro de `describeMatrix("session", ...)`, após os testes de legado (linha 186) e antes de `idleTimeout` (linha 188). |
| `docs/4.examples/handle-session.md` | Opcional, recomendado: nota sobre rotação de senha perto da linha 37 e nas opções. |

**Não alterar:** `src/utils/internal/iron-crypto.ts` (nenhuma mudança de comportamento é necessária), `src/index.ts` (nenhum export novo, `unsealSession` e `sealSession` continuam em `src/index.ts:208-209`), `test/unit/package.test.ts` (a lista de exports em `:125` e `:149` não muda).

---

## Contratos e assinaturas

```ts
// src/utils/session.ts — SessionConfig (após `password`, linha 48)
/**
 * Previous passwords that still open sessions, tried after `password`, in order.
 * Sessions opened with one of them are resealed with `password` on the same
 * request. Never used to seal.
 */
extraUnsealPasswords?: string[];
```

```ts
// src/utils/internal/session.ts
export const kExtraSeal: unique symbol = /* @__PURE__ */ Symbol.for(
  "h3.internal.session.extra-seal",
);
```

```ts
// src/utils/session.ts — assinatura pública, inalterada (P-05)
export async function unsealSession(
  _event: HTTPEvent,
  config: SessionConfig,
  sealed: string,
): Promise<Partial<Session>>;
```

```ts
// src/utils/session.ts — helpers internos (fim do arquivo)

/** Tries `password` then each extra. Returns the first that opens, with `kExtraSeal` set if it was not `password`. */
async function openWithPasswords(
  sealed: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<Partial<Session>> {
  const passwords = [...new Set([config.password, ...(config.extraUnsealPasswords ?? [])])];
  let lastError: unknown;
  for (const [index, password] of passwords.entries()) {
    try {
      const unsealed = await openWithPassword(sealed, password, config, sealOptions);
      if (unsealed && index > 0) {
        (unsealed as any)[kExtraSeal] = true;
      }
      return unsealed;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "Bad hmac value") {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError;
}

/** The current try/catch from `unsealSession`, with the legacy fallback, for one password. */
async function openWithPassword(
  sealed: string,
  password: string,
  config: SessionConfig,
  sealOptions: SealOptions,
): Promise<Partial<Session>>;
```

Observações sobre o contrato:
- `throw lastError` nunca é alcançado com lista não vazia, porque a lista sempre tem `password`. Se o TypeScript reclamar do tipo, usar `throw lastError` com `lastError` tipado como `Error`.
- A condição `error.message !== "Bad hmac value"` é a mesma que já existe em `src/utils/session.ts:336`. A decisão de quando retornar a erro do legado fica dentro de `openWithPassword`, sem mudança de regra.
- `unsealSession` passa a ser:
  ```ts
  const unsealed = await openWithPasswords(sealed, config, sealOptions);
  // expiração inalterada, src/utils/session.ts:350-365
  return unsealed;
  ```

```ts
// src/utils/session.ts — getSession (trecho das linhas 198-216)
const legacySeal = unsealed && (unsealed as any)[kLegacySeal];
const extraSeal = unsealed && (unsealed as any)[kExtraSeal];
if (legacySeal) delete (unsealed as any)[kLegacySeal];
if (extraSeal) delete (unsealed as any)[kExtraSeal];
// ...
if (session.id && sessionFromCookie && (legacySeal || extraSeal || shouldSlide(session, config))) {
  await updateSession(event, config);
}
```

Compatibilidade:
- Sem `extraUnsealPasswords` (ou com `[]`): `passwords` tem um elemento, o laço faz uma iteração, `index > 0` nunca acontece, e a única diferença de comportamento é o `try/catch` que relança erros não-HMAC. Como o `catch` atual já faz exatamente isso (`:332-339`), o resultado é idêntico (RF-06).
- `sealSession` (`src/utils/session.ts:282-307`) e `updateSession` não mudam.

---

## Estratégia de testes

Os testes ficam em `test/session.test.ts`, dentro de `describeMatrix`, para rodar nos modos `web` e `node` (`test/_setup.ts:11`). Reaproveitar o padrão dos testes de legado (`test/session.test.ts:134-186`): gerar o cookie com `seal`/`iron-crypto` diretamente e enviá-lo pelo header `Cookie`.

Seguir o fluxo do AGENTS.md: escrever os testes primeiro, rodar e ver as falhas (exceto os de RF-06, que devem passar antes e depois), depois implementar.

| RF | Teste | Como verificar |
| --- | --- | --- |
| RF-01 | Cookie selado com `OLD`, config `{ password: NEW, extraUnsealPasswords: [OLD] }` | `session.id`, `createdAt` e `data` iguais aos da sessão original |
| RF-02 | Criar e atualizar com config com extras | `unseal(cookie, NEW, defaults)` abre; `unseal(cookie, OLD, defaults)` lança `Bad hmac value` |
| RF-03 | Ler cookie `OLD`; depois usar o `Set-Cookie` resultante sem extras | Primeira resposta tem exatamente um `Set-Cookie`; segunda requisição sem extras mantém o mesmo `id` |
| RF-04 | (a) `extraUnsealPasswords: [WRONG, OLD]` e `[OLD, OLD, NEW]`: mesmo resultado. (b) Contagem de tentativas com `legacySealFallback: false`, `vi.spyOn(crypto.subtle, "deriveBits")`: cada senha errada custa 1 chamada; a senha que abre custa 2 (chave de integridade e de cifra) | Tentativas com `[WRONG, OLD]` = 1 + 1 + 2 = 4 chamadas; com `password` igual a `OLD` e extras `[OLD]`, = 2 |
| RF-05 | Cookie `OLD` com `maxAge` vencido, e segundo teste com `idleTimeout` vencido; `vi.useFakeTimers({ toFake: ["Date"] })` como em `test/session.test.ts:189-190` | Sessão nova (`id` diferente, `data` vazio). Verificar que a contagem de `deriveBits` é a de uma única abertura |
| RF-06 | Suíte existente sem alterações; teste novo com `extraUnsealPasswords: []` idêntico ao padrão | Mesmo `Set-Cookie` e mesmo corpo que a configuração sem o campo |
| RF-07 | (a) Cookie legado de 1 iteração selado com `OLD`, config com extras e fallback padrão: aberto, regravado com `NEW` nas opções atuais. (b) Mesmo cookie com `legacySealFallback: false`: rejeitado | (a) `unseal(resealed, NEW, sealDefaults)` abre. (b) `id` diferente do original |
| RF-08 | Extra com menos de 32 caracteres: um cookie selado com a senha válida, colocada depois do extra curto, falha na leitura; uma senha curta como `password` falha da mesma forma | Os dois casos produzem sessão nova. Teste documenta o comportamento de D-03 |
| RF-09 | Sessão selada com `OLD` enviada pelo header `x-h3-test-session` (nome do teste: `h3-test`) | Aceita (`id` original), sem `Set-Cookie` na resposta |

Testes de regressão de D-04: verificar que `kExtraSeal` não aparece em `session.data` nem no cookie (`unseal` do cookie regravado não contém a chave).

Gates:
- `pnpm vitest run test/session.test.ts` (verde antes e depois, com os novos testes vermelhos antes da implementação)
- `pnpm vitest run test/unit` (inclui `test/unit/package.test.ts`, que trava a lista de exports)
- `pnpm lint` (oxlint + oxfmt)
- `pnpm typecheck`
- `pnpm test` (lint, typecheck e cobertura completa)

Tipo: `extraUnsealPasswords` é `string[]` opcional; nenhum teste de tipo é obrigatório. Se houver `test/unit/types.test-d.ts` que cubra `SessionConfig`, adicionar um caso de tipo.

---

## Riscos

| ID | Risco | Impacto | Mitigação |
| --- | --- | --- | --- |
| R-01 | Senha antiga vazada abre sessões até expirarem | Sessão de quem já é usuário pode ser aberta | Documentar; remover a senha da lista quando `maxAge`/`idleTimeout` tiverem passado (PRD R-01, R-02) |
| R-03 | Amplificação de CPU: cada senha extra é uma abertura PBKDF2 por requisição com cookie inválido; `legacySealFallback` dobra por senha | Negação de serviço com cookies forjados | D-07: documentação. Medir com `pnpm bench:node` antes do merge se houver tempo |
| R-07 (novo) | Senha extra curta ou vazia, posicionada antes da senha que selou o cookie, quebra a leitura desse cookie (D-03) | Usuários perdem a sessão sem erro visível | Testes de RF-08 documentam o comportamento. Considerar validação antecipada em evolução futura, junto com a decisão de tratamento de `password` |
| R-08 (novo) | Ordem de tentativa e o `catch` de `getSession` (`src/utils/session.ts:197`) esconderem um erro não-HMAC de uma extra | Diagnóstico difícil | D-03: erros não-HMAC propagam para o `catch` de `getSession`, que os trata como sessão inválida, igual a hoje. Sem log novo nesta entrega |
| R-09 (novo) | Esquecer de apagar `kExtraSeal` antes de `Object.assign` (`src/utils/session.ts:208`) | Símbolo vazaria para `session` e para o próximo `sealSession` | Apagar junto com `kLegacySeal` (D-04). Coberto pelo teste de regressão |
| R-10 (novo) | `unseal` retornar `null` (`src/utils/internal/iron-crypto.ts:149`) | Acesso a propriedade de `null` | Guardar com `unsealed &&` antes de marcar, como já é feito com `kLegacySeal` (`src/utils/session.ts:345`) |
| R-04 | Sessões de header não se renovam com a senha antiga | Sessão aceita com senha antiga até expirar | Aceito, RF-09 |
| R-05 | Senhas antigas ficam em código ou config | Superfície de vazamento | Recomendar variáveis de ambiente na documentação; fora de escopo gerenciar segredos |
| R-06 | Mudança de comportamento em `unsealSession`, que é exportada | Quem chama diretamente passa a aceitar senhas extras | D-05: assinatura inalterada; efeito só ocorre quando `extraUnsealPasswords` está configurado |

**Pendências de decisão para o usuário (não bloqueiam a implementação):**
1. Confirmar o tratamento de D-03 para senhas curtas (propagar erro, como `password`). A alternativa seria validar a lista antecipadamente, mas isso mudaria o tratamento de RF-08.
2. Confirmar D-07 (sem limite na lista). Se preferir limite, o valor precisa ser definido pelo usuário.
</content>
</invoke>
