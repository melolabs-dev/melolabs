# Contrato enxuto #1050-b: várias senhas de unseal nas sessões

## Objetivo
Ao trocar a senha das sessões (`src/utils/session.ts`), continuar aceitando as sessões seladas com senhas anteriores, como pede a issue h3js/h3#1050. Nesta variante, a rotação é configurada num campo novo.

## Referência
Issue h3js/h3#1050 (primeira alternativa proposta nela).

## Nomes públicos
- `SessionConfig` ganha o campo opcional `extraUnsealPasswords: string[]`, com senhas anteriores que só abrem sessões. `password` continua string e continua sendo a senha que sela.

## Restrições
- Nenhum outro nome público novo.
- Não quebrar o que já existe: sem senhas extras, as sessões se comportam como hoje.
- A suíte existente continua passando; ajuste só o código e os testes existentes que dependem do que a sua mudança altera, sem perder o que eles verificam.
- `pnpm lint` e `pnpm typecheck` passam.
