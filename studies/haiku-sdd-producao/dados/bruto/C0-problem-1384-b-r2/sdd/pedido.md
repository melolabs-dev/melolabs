# Issue h3js/h3#1384: Add support for RFC 9457 (problem json)

### Describe the feature

There's a [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) for sending errors to the client

Having this inside h3/nitro will be good addition

### Additional information

- [ ] Would you be willing to help implement this feature?


---

# Contrato enxuto #1384-B: problem details (RFC 9457) como formato padrão de erro

## Objetivo
Permitir que o h3 responda erros no formato "problem details", como pede a issue h3js/h3#1384. Nesta variante, o formato passa a ser o padrão de todas as respostas de erro, sem configuração.

## Norma
RFC 9457 (Problem Details for HTTP APIs), representação JSON.

## Nomes públicos
- Gatilho: nenhum; o novo formato substitui o formato de erro atual, sem opção nova.
- `HTTPError` aceita, no objeto de entrada do construtor, os campos opcionais `type` e `instance` da RFC 9457, expostos na instância.

## Restrições
- Nenhum outro nome público novo.
- Não quebrar o que já existe.
- A suíte existente continua passando; ajuste só os testes existentes que dependem do que a sua mudança altera, sem perder o que eles verificam.
- `pnpm lint` e `pnpm typecheck` passam.
