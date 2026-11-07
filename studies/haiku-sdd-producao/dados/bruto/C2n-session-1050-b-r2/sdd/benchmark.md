# Linha de base de desempenho: extraUnsealPasswords

Referências: `sdd/tasks.md` (T-02, T-11), `sdd/techspec.md` (risco 1).

## Ambiente e base

- Commit de base: `d5baeed` (branch `master`), medido antes de qualquer alteração em `src/`.
- Máquina: 12th Gen Intel Core i7-12700H, ~2.98 GHz (`pnpm bench:node`) e ~1.71 GHz (`test/bench/session.ts`), Windows 11.
- Runtime: Node 24.18.0 (x64).
- Data: 2026-11-06.

## Caso de leitura de cookie inválido: ausente

T-02 pede o caso "de leitura de cookie inválido" em `test/bench/session.ts`. Esse caso **não existe** no arquivo. O arquivo só mede uma requisição com cookie válido (leitura e `update`) e não tem caso de cookie inválido.

Consequência: o caso que o risco 1 da techspec precisa medir (custo de `1 + N` aberturas para cookies que não abrem com `password`) não tem linha de base. Com cookie válido, a senha atual abre primeiro e as extras não são tentadas, então o benchmark atual não detecta esse custo. A criação do caso fica pendente (ver "Pendências").

## Linha de base medida

`node --expose-gc --allow-natives-syntax ./test/bench/session.ts`, sem alteração de código:

| Caso                                        | Média         | p75      | Intervalo           |
| ------------------------------------------- | ------------- | -------- | ------------------- |
| `h3` (leitura com cookie válido + `update`) | 41.14 ms/iter | 43.55 ms | 35.59 ms … 47.07 ms |

Também foi executado `pnpm bench:node` (`test/bench/bench.ts`, sem sessão). Resultado para registro: `h3` 35.65 µs/iter, `h3-compiled` 31.19 µs/iter.

## Limite de aceitação

Definido antes de T-06, conforme a proposta da tarefa:

- Com N senhas extras, o custo de leitura de cookie inválido (que não abre com `password`) deve ficar em no máximo `(1 + N) × 1,2` do valor de base.
- Para N = 2, o limite é `3,6×` o custo de base de um cookie inválido.
- Cookie válido com a senha atual não deve ficar mais lento que a linha de base acima, dentro do ruído do benchmark.

Este limite só pode ser conferido quando existir o caso de cookie inválido. Ele não foi alterado depois da medição.

## Pendências

1. Criar em `test/bench/session.ts` o caso de leitura de cookie inválido, com `extraUnsealPasswords` de 0 e de 2 senhas, e medir a linha de base dele. Isso exige alterar `test/bench/session.ts`, que está fora do escopo de T-02.
2. Medir o caso com N = 2 em T-11 e registrar a razão contra a base aqui.

## Verificação (T-11): resultado parcial

- `pnpm typecheck`: passa.
- `pnpm vitest --run --coverage` (suíte completa): 72 arquivos passam e 1 é pulado; 3124 testes passam e 69 são pulados (web e node).
- `oxlint .` e `oxfmt --check` nos arquivos alterados: passam. `pnpm lint` completo falha só por `sdd/pedido.md` e `sdd/tasks.md`, que são arquivos de entrada do usuário, não formatados. Não foram alterados.
- Benchmark de cookie inválido: **não executado**, porque o caso não existe (ver Pendências). O limite acima continua sem medição.
- Checklist RF-01 a RF-10: cobertos por testes ou JSDoc, conforme `sdd/tasks.md`. Pendente apenas a medição de desempenho.
