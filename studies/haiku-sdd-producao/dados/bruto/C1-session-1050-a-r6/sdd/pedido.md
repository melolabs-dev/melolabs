# Issue h3js/h3#1050: FR: Allow multiple unseal passwords for sessions

### Describe the feature

When rotating secrets for use as session passwords, we'd want to continue honoring prior sealed sessions.

For the `useSession` api, can we have an additional parameter: `extraUnsealPasswords` or something similar. Passwords to attempt are the default `password` and this `extraUnsealPasswords`.

Alternatively, we can have `password` as potentially being a non empty string array, with the first `password` being used for sealing, and the rest just for unsealing.

### Additional information

- [ ] Would you be willing to help implement this feature?


---

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
