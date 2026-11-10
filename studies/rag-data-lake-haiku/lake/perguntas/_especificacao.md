# Especificação do banco de perguntas (estudo 2)

Banco de 120 perguntas de decisão de projeto com opções fechadas: 60 comuns, 30 de conflito (decisão antiga contra decisão vigente), 30 sem resposta no lake. Rascunho feito por IA; o gabarito é conferido depois por revisão cega (ver `plano.md`).

## O que cada pergunta é
Uma pergunta que uma pessoa do projeto faria ao decidir algo (como fazer, o que vale, o que mudou, qual regra se aplica), respondida por **três opções substantivas** escritas por você. O programa que monta o banco acrescenta depois a quarta opção, "Informação insuficiente no material", e embaralha as letras A a D com semente fixa. Por isso **você não escreve a opção "insuficiente" nem escolhe letras**.

## Formato de saída (array JSON)
```json
{
  "id": "q-comum-docs-01",
  "bloco": "comum | conflito | sem_resposta",
  "pergunta": "texto autocontido, em português do Brasil",
  "opcoes": ["opção 1", "opção 2", "opção 3"],
  "correta": 0,
  "alt_tipo": ["", "substituida", ""],
  "fontes": [{"doc": "doc-NNNN", "trecho": "cópia literal de até 250 caracteres"}],
  "cartoes": ["c-docs-01"],
  "justificativa": "por que a opção correta é a correta, com base só nas fontes",
  "n_fontes": 1
}
```
- `correta` é o índice (0, 1 ou 2) da opção correta. Nas perguntas **sem resposta** use `null` (a resposta certa é "Informação insuficiente") e deixe `fontes` e `cartoes` vazios; preencha `justificativa` com o que você procurou e por que o lake não responde.
- `alt_tipo` tem um item por opção: `"substituida"` se a opção é a decisão antiga já substituída (só nas perguntas de conflito), vazio nas demais.
- `trecho`: cópia literal que exista no arquivo da zona bruta (será conferida por programa). Os ids de documento vêm de `lake/manifesto-bruto.json`; confira o id pelo `path` e **não conte posições de cabeça** (um agente anterior errou os ids por uma posição).

## Regras de qualidade (a conferência automática e a revisão cega verificam)
1. **Uma única opção correta**, sustentada pelas fontes. As outras duas são plausíveis para quem conhece o assunto em geral, mas **erradas dentro deste projeto** ou não sustentadas pelas fontes. Nunca deixe duas opções corretas.
2. **A pergunta deve exigir o material do projeto.** Se um engenheiro acertaria só com conhecimento geral de HTTP ou TypeScript, reescreva ou descarte.
3. **Sem vazamento:** nenhuma opção indica a correta por ser a única longa, a única detalhada, a única com termo técnico específico, ou a única com "sempre"/"nunca". As três opções têm comprimento parecido (a mais longa não passa de 1,4 vez a mais curta) e mesmo estilo gramatical.
4. **Sem cópia:** a pergunta e a opção correta não devem repetir mais de 6 palavras seguidas de um trecho-fonte. Reformule com outras palavras; os nomes próprios de API e de arquivo podem ficar.
5. **Autocontida:** a pergunta nomeia o contexto ("No h3...", "No estudo 1 do Melo Labs...") e não diz "segundo o documento", "no texto acima" nem cita ids de issue ou de cartão.
6. **Data e vigência:** quando a resposta depende de versão ou de emenda, a pergunta diz qual ("na versão 2", "no protocolo final, depois dos adendos").
7. Uma pergunta de múltiplas fontes (`n_fontes` 2) só vale se a resposta correta exige combinar as duas fontes.
8. Não use trechos de documentos terminados em corte (por exemplo PR #1608, doc-0056) nem cartões cujo motivo diga "inferido".
9. Português do Brasil com acentos; nomes de API como no original. Sem dados de empresa.

## Cartões
`lake/curado/cartoes.json` (152 cartões conferidos). Cartões "vigente" têm decisão atual; "substituida" têm a decisão antiga e o campo `substitui` do cartão novo aponta para eles. Os cartões ajudam a achar o assunto, mas **cada pergunta tem de ser verificável nos trechos do documento**, não no texto do cartão.
