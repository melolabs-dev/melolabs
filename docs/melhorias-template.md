# Melhorias do template de artigo e sugestões para o site

Data: 10/11/2026. Base: comparação do `templates/artigo.md` antigo com os quatro posts publicados (`haiku-sdd-producao`, `haiku-sdd-guia`, `rag-data-lake-haiku`, `rag-data-lake-haiku-guia`), com `site/src/content.config.ts`, `site/src/layouts/Base.astro` e `tools/publish/publish.py`.

## O que o template antigo não refletia
O template tinha oito seções genéricas (problema, hipótese, como testei, resultados, na prática, limitações, conclusão, referências). Os artigos que funcionaram têm outra espinha: resumo com o número e o link do guia, material, condições com controles, escolhas fixadas antes da rodada, hipóteses uma a uma com critério e p corrigido, como o modelo erra, custo, o que não funcionou, ameaças à validade e reprodutibilidade com tags e DOI. O guia simples e o texto de canal nem tinham template. Também faltava o campo `translation_of` e a regra de claims do CLAUDE.md.

## O que mudou nos templates
- `templates/artigo.md` reescrito: 11 seções numeradas na ordem dos artigos publicados, com comentários de instrução, tabela de condições, tabela de hipóteses (métrica, critério, IC, p corrigido, veredito), subseções de acertos, erros, custo e negativos, e frontmatter completo (title, lang, date, tags, sources, summary, status, study, translation_of) com o que o portão e o site exigem.
- `templates/guia.md` (novo): estrutura do guia simples que vai para os canais.
- `templates/linkedin.md` (novo): texto de canal em pt e en, com o link apontando para o guia.
- `templates/checklist-publicacao.md` (novo): conferência antes de aprovar (claims, TODO zero, pt/en idênticos, ameaças, negativos, links, figuras nos dois idiomas, aprovação só do autor).
- `templates/estudo.md` e `templates/experimento.md` ficaram como estavam; sugestões abaixo.

## Pequenos ajustes sugeridos nos outros templates (não aplicados)
1. `estudo.md`: acrescentar campos `prereg` (tag git), `dados` (tag), `doi` e uma seção "Desvios do pré-registro" com data. Hoje esse registro vive em arquivos soltos.
2. `estudo.md`: trocar "Hipótese nula" por uma tabela de hipóteses com métrica, margem e critério de refutação, como o protocolo exige.
3. `experimento.md`: incluir esforço do modelo, nº de chamadas, preço de lista usado (com data) e hash do arquivo de dados.

## Sugestões para o site (nada foi alterado em `site/` nem em `tools/`)
Prioridade alta
1. **Aceitar os campos já usados no frontmatter.** `content.config.ts` não declara `study` nem `translation_of`; o zod do Astro, por padrão, ignora o que não está no esquema, mas declarar permite ligar post a estudo e ao espelho no outro idioma.
2. **Índice (TOC) fixo ou no topo.** Os artigos têm 11 seções e várias subseções; um índice gerado dos `h2` e `h3` ajuda a navegar. Sem JavaScript, com âncoras.
3. **Link do guia ao lado do artigo.** O artigo e o guia se apontam por texto manual. Um bloco no topo ("Versão simples" / "Technical version") a partir de um campo `guide` ou `technical` no frontmatter evita link quebrado e vale para os dois idiomas.
4. **Seletor de idioma que leve ao espelho do mesmo post.** `altHref` já existe no layout; garantir que seja derivado de `translation_of`.

Prioridade média
5. **Tabela de hipóteses como componente.** Hoje é tabela Markdown. Um componente com selo por veredito (apoiada, não apoiada, refutada, equivalente), cor e símbolo, não só cor, facilita a leitura rápida.
6. **Caixa de aviso para ameaças à validade e para resultados negativos.** Um estilo `aside` ou `blockquote` com marca visual deixa a honestidade do estudo à vista, sem esconder no fim.
7. **Selo de pré-registro.** Mostrar no topo "pré-registrado em <tag> (data)" e "dados congelados em <tag>", com link para o commit; reforça a proposta do blog (estudo reproduzível).
8. **Bloco de dados e reprodução.** Campos `prereg`, `dados` e `doi` no frontmatter renderizados como uma caixa "Dados e código" no fim, em vez de texto solto na seção 11.
9. **Tabelas largas.** Já há rolagem horizontal; adicionar primeira coluna fixa e legenda por tabela melhora tabelas de 5+ colunas no celular.

Prioridade baixa
10. **Tempo de leitura e data de atualização** no cabeçalho do post, com link para a errata/changelog do estudo quando houver.
11. **Figuras com legenda e link para o SVG/PNG**, e `loading="lazy"`; a largura já é limitada por `max-width:100%`.
12. **Cartão de compartilhamento (Open Graph)** com título e o número principal; hoje o layout só tem `description`.
13. **Tema:** o CSS já cobre claro, escuro e `data-theme`; faltaria um alternador explícito.

## Como aplicar
Os templates já valem para o próximo artigo. As sugestões de site e de `estudo.md`/`experimento.md` dependem da sua decisão; marcar quais aprova e eu aplico em um commit separado.
