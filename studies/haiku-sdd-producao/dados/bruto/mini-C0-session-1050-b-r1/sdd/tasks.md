# Tarefas — Várias senhas de unseal nas sessões (h3js/h3#1050-b)

Base: `sdd/prd.md` (RF-01 a RF-09) e `sdd/techspec.md`. A ordem segue o fluxo de correção de bug do `AGENTS.md`: testes primeiro, falha confirmada, implementação mínima, regressão.

### T-01 — Escrever os testes novos de sessão (devem falhar)

Adicionar, em `test/session.test.ts`, dentro do `describeMatrix("session", ...)` existente, os casos da seção 6 da techspec. Usar senhas de 32+ caracteres (ex.: `"antiga-" + "a".repeat(40)`) e `name`/config próprios por caso, para não colidir com o cookie compartilhado do bloco. Casos:

- selo de `sealSession`/cookie de `updateSession` abre só com `password` e rejeita com `"antiga"` (`Bad hmac value`);
- cookie selado com a antiga é lido, com `id` e `data` originais;
- senha extra na segunda posição da lista é encontrada;
- selo com senha desconhecida cria sessão nova (`id` diferente, `data` vazio);
- cookie aberto com extra gera exatamente 1 `Set-Cookie` que abre com `password` e mantém o `id`;
- sessão por cabeçalho (`x-h3-test-session`) aberta com extra não emite cookie;
- sessão expirada (`maxAge`, fake timers só de `Date`) selada com extra é rejeitada e gera `id` novo;
- selo com `ttl` vencido resulta em sessão nova;
- selo legado (1 iteração) com a antiga em `extraUnsealPasswords` restaura a sessão e re-sela com `password` e `sealDefaults`;
- o mesmo selo legado com `legacySealFallback: false` é rejeitado (`id` novo);
- `extraUnsealPasswords: []` e ausente se comportam igual (selo de `password` abre sem reseal; senha desconhecida não restaura).

Cobre: RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09
Depende de: nenhuma
Aceite: `pnpm vitest run test/session.test.ts` roda e os testes novos que exercitam senhas extras falham (registrar a falha observada antes de seguir para T-02). Os testes já existentes continuam passando. Os casos RF-02 e RF-08 podem já passar, pois descrevem comportamento atual; isso é esperado.
Arquivos: `test/session.test.ts`

### T-02 — Criar o símbolo interno `kExtraSeal`

Exportar `kExtraSeal = Symbol.for("h3.internal.session.extra-seal")` logo após `kLegacySeal`, no mesmo padrão do arquivo. Não reexportar em `src/index.ts`.

Cobre: RF-05
Depende de: T-01
Aceite: `pnpm typecheck` passa; `test/unit/package.test.ts` continua passando (nenhum export público novo).
Arquivos: `src/utils/internal/session.ts`

### T-03 — Adicionar `extraUnsealPasswords` a `SessionConfig`

Adicionar `extraUnsealPasswords?: string[]` após `password`, com JSDoc: só abre sessões, nunca sela; lista curta; remover quando as sessões antigas expirarem; cada tentativa falha custa um PBKDF2; sessão vinda de cabeçalho não é re-selada. `password` continua `string`. Nenhum outro nome público novo.

Cobre: RF-01
Depende de: nenhuma
Aceite: `pnpm typecheck` aceita uma config com `password` e `extraUnsealPasswords: ["antiga"]`, `password` segue tipado como `string`, e `vitest run test/unit/package.test.ts` confirma que não há exports novos.
Arquivos: `src/utils/session.ts`

### T-04 — Tentar senhas extras em `unsealSession`

Extrair o `try/catch` atual (com o fallback legado de 1 iteração e a marca `kLegacySeal`) para o helper interno `unsealWithPassword(sealed, password, config, sealOptions)`. Em `unsealSession`, iterar `[config.password, ...(config.extraUnsealPasswords ?? [])]` na ordem:

- só `"Bad hmac value"` avança para a próxima senha; qualquer outro erro é lançado na hora;
- sucesso com índice > 0 marca `kExtraSeal`; o laço não pode depender de o valor ser truthy (usar flag `opened`);
- esgotadas as senhas, lançar o erro da primeira tentativa (`password`);
- `legacySealFallback: false` desliga o legado para todas as senhas;
- manter `maxAge` e `idleTimeout` intactos, depois do laço, para que valham para qualquer senha e não provoquem novas tentativas.

Sem extras (ausente ou `[]`), o resultado e os erros devem ser idênticos aos de hoje.

Cobre: RF-03, RF-04, RF-06, RF-07, RF-08
Depende de: T-02, T-03
Aceite: `pnpm vitest run test/session.test.ts` — passam os testes de T-01 sobre abertura com extra (primeira e segunda posição), senha desconhecida, expiração e legado (com e sem `legacySealFallback: false`); os testes existentes seguem verdes.
Arquivos: `src/utils/session.ts`

### T-05 — Re-selar em `getSession` sessões abertas com senha extra

Em `getSession`, importar `kExtraSeal`, ler e apagar o marcador junto com `kLegacySeal` antes do `Object.assign(session, unsealed)` (para nunca ser selado de volta) e incluir `extraSeal` na condição do reseal: `session.id && sessionFromCookie && (legacySeal || extraSeal || shouldSlide(...))`. Sessão vinda de cabeçalho continua sem reseal. `id` e `createdAt` não mudam.

Cobre: RF-05, RF-07
Depende de: T-04
Aceite: `pnpm vitest run test/session.test.ts` — cookie aberto com extra devolve 1 `Set-Cookie` que abre com `password` e `sealDefaults` com o mesmo `id`; sessão por cabeçalho não emite cookie; o selo legado com extra é re-selado com as opções atuais; uma leitura seguinte já com `password` não re-sela.
Arquivos: `src/utils/session.ts`

### T-06 — Verificação final e regressão

Rodar a verificação completa e conferir que nenhum teste existente precisou mudar de significado.

Cobre: RF-08, RF-09
Depende de: T-01, T-02, T-03, T-04, T-05
Aceite: passam sem erros `pnpm vitest run test/session.test.ts`, `pnpm vitest run test/unit/package.test.ts`, `pnpm lint`, `pnpm typecheck` e `pnpm test` completo. O diff não toca `src/utils/internal/iron-crypto.ts`, `src/index.ts`, `test/unit/package.test.ts` nem `docs/`.
Arquivos: nenhum (somente verificação)
