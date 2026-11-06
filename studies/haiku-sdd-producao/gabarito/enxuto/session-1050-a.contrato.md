# Contrato enxuto #1050-a: várias senhas de unseal nas sessões

## Objetivo
Ao trocar a senha das sessões (`src/utils/session.ts`), continuar aceitando as sessões seladas com senhas anteriores, como pede a issue h3js/h3#1050. Nesta variante, a rotação é configurada no próprio campo `password`.

## Referência
Issue h3js/h3#1050 (segunda alternativa proposta nela).

## Nomes públicos
- `SessionConfig.password` passa a aceitar `string | string[]`, lista não vazia. Na lista, a primeira senha sela; as demais só abrem sessões. Uma string continua valendo como hoje.

## Restrições
- Nenhum outro nome público novo.
- Não quebrar o que já existe: com uma senha só, as sessões se comportam como hoje.
- A suíte existente continua passando; ajuste só o código e os testes existentes que dependem do que a sua mudança altera, sem perder o que eles verificam.
- `pnpm lint` e `pnpm typecheck` passam.
