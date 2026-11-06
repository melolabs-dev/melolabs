# Contrato enxuto #1384-C: problem details (RFC 9457) por utilitário explícito

## Objetivo
Permitir que o h3 responda erros no formato "problem details", como pede a issue h3js/h3#1384. Nesta variante, o formato vem de um utilitário chamado pelo handler; só as respostas que usam o utilitário mudam.

## Norma
RFC 9457 (Problem Details for HTTP APIs), representação JSON.

## Nomes públicos
- Gatilho: nova função `problem(input)`, exportada pelo pacote `h3`, que devolve um `HTTPError`.
- `input` aceita os campos do objeto de entrada de `HTTPError` e mais os campos opcionais `type` e `instance` da RFC 9457.

## Restrições
- Nenhum outro nome público novo além de `problem` e do tipo da sua entrada.
- Não quebrar o que já existe.
- A suíte existente continua passando; ajuste só os testes existentes que dependem do que a sua mudança altera, sem perder o que eles verificam.
- `pnpm lint` e `pnpm typecheck` passam.
