# Manual de implantação (3º artefato de cada estudo)

Todo estudo entrega três peças: artigo técnico, guia simples e **manual de implantação** (este). O manual é para quem não montou o experimento e quer usar o método que mais deu certo na própria máquina. Fica em `docs/metodo/` e entra na página do manual (artefato) com uma seção nova.

## O que o manual responde
- **Qual método venceu e por quanto** (números do `claims.json`, sem número novo).
- **Quando não usar** (onde o método falhou ou não foi testado).
- **Pré-requisitos**: sistema, versões, bibliotecas externas e como instalar cada uma.
- **Passo a passo** para montar (por exemplo, o data lake), com os parâmetros exatos usados no estudo e o que cada um controla.
- **Como virar skill**: um `SKILL.md` em `docs/metodo/skills/<nome>/` com `name`, `description` (quando acionar), passos, dependências e limites. Deixe explícito que a skill é derivada do método; o que foi testado foi o método, não a skill.
- **Como medir na sua máquina**: comandos, custo esperado e o que registrar.
- **Limites herdados do estudo.**

## Regras
- Só parâmetros e comandos que existem no estudo ou no código do repositório. O que for sugestão sua vai marcado como "sugestão, não testada".
- Mesmos números do artigo e do `claims.json`.
- Status `review` até o autor aprovar, como os demais artefatos.
