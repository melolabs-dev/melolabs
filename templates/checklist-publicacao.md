# Checklist antes de aprovar um post

Use para o artigo técnico e para o guia, nos dois idiomas. Só o autor muda `status: approved`.

## Números e fontes
- [ ] Todo número do texto tem linha em `studies/<slug>/claims.json` (dado bruto, análise ou fonte verificada).
- [ ] Nenhum `TODO` no texto (o portão bloqueia).
- [ ] Fontes com `verificada: true` (URL ou DOI aberto). Nenhuma fonte, DOI ou URL inventado.
- [ ] Números de tabela e de texto batem com `dados/analise.txt` (ou equivalente); IC e p com a correção de múltiplos testes.
- [ ] `sources:` no frontmatter só com notas do RAG `validated_by_author` e `publishable`.

## Honestidade do estudo
- [ ] Pré-registro congelado antes da rodada (tag ou hashes), e desvios listados com data.
- [ ] Resultados negativos e não apoiados incluídos com o mesmo destaque dos positivos.
- [ ] Nenhuma hipótese pendente ou subpotente (CLAUDE.md): decidida ou amostra estendida.
- [ ] Ameaças à validade declaradas (circularidade, autoria por IA, uma só base, poder, parâmetros do piloto, instrumento não validado).
- [ ] O que o estudo NÃO prova está escrito, e a conclusão não passa disso.
- [ ] Custo: preço de lista e data, custo real à parte, custo de montar o material tratado como estimado.

## Idiomas
- [ ] `pt.md` e `en.md` com os mesmos números, tabelas e links de dados.
- [ ] `lang` do frontmatter igual ao arquivo; `en.md` com `translation_of`.
- [ ] Figuras nas duas línguas (`-pt` e `-en`, svg e png) com texto alternativo.
- [ ] Guia simples escrito nos dois idiomas, com os mesmos números do técnico.

## Links e reprodução
- [ ] Links internos (`/pt/<slug>/`, `/pt/<slug>-guia/`) e externos abrem.
- [ ] Reprodutibilidade: caminhos do código, dados brutos com manifesto de hashes, tags `prereg-<slug>` e `dados-<slug>`, DOI.
- [ ] Nada de material do trabalho (nomes, clientes, URLs internas) fora das regras de anonimização.
- [ ] Nenhum segredo, token ou cookie no texto ou nos dados.
- [ ] Nota de autoria no fim ("assistida por IA e revisada por mim").

## Publicação
- [ ] Simulação do portão rodada (`python tools/publish/publish.py <slug> --lang pt`) e resultado mostrado ao autor.
- [ ] Autor leu e disse "aprovado" para aquele post e idioma; só então `status: approved` e `--yes`.
- [ ] Texto dos canais (LinkedIn e DEV, pt e en) mostrado ao autor antes de postar; link aponta para o guia.
- [ ] pt-BR primeiro; inglês em até 3 dias.
- [ ] Errata e changelog do estudo atualizados se algo mudou depois.
