---
id: estudo-haiku-sdd-producao
title: "Estudo: SDD só com Haiku, o que sobra de qualidade quando o custo cai"
source_url: https://github.com/melolabs-dev/melolabs/tree/main/studies/haiku-sdd-producao
kind: experimento
evidence: experimento-proprio
validated_by_author: false
publishable: true
fidelity: resultado-medido
date: 2026-11-08
tags: [sdd, haiku, sonnet, custo, agentes, estudo]
---

# Estudo: SDD só com Haiku (resultados medidos)

Experimento do Melo Labs no projeto aberto h3 (TypeScript): 198 execuções isoladas de Sonnet 5.5 e Haiku 5.5 em PRD, TechSpec, Tasks e código, 579 julgamentos de rubrica por Opus, pré-registro com tags git. Dados, código, prompts e transcrições em `studies/haiku-sdd-producao`. Sem dados de empresa.

Resultados (análise estendida, `dados/processado/analise-estendida.json`):
- Núcleo de testes 100%: Sonnet 49/54 (91%), Haiku simples 21/36 (58%), Haiku com testes primeiro e loop 39/54 (72%). Diferença C4 menos Sonnet de −18,5 pontos (Newcombe unilateral 97,5%: −32,6 a −3,8). H4 subpotente. O déficit está em #1384-a, #1384-c e #1267; em #1050 todos chegam a 100%. Revisão adversarial: 12 das 15 falhas do C4 são só o teste P1 (rota inexistente responde 404 em problem+json), que o contrato enxuto não pede de forma explícita; sem ele, C4 51/54 (94%) contra Sonnet 49/54 (91%), +3,7 (IC −7,2 a +15,0). Por variante, IC t de 95% de −45 a +8 (inclui zero). Não se conclui que o Haiku perde em código no geral.
- Custo de lista do C4 sobre o Sonnet: 0,18 (IC 0,16 a 0,20); por núcleo aceito, 0,23; tokens totais 1,5 vez. Cascata a 0,15 do custo e nunca escalou (por construção: o gatilho era só falha de typecheck, que nunca ocorreu), então a cascata não foi testada de fato.
- Documentos: Haiku simples a +0,7 (TechSpec, de 35) e −0,2 (Tasks, de 25) do Sonnet; alfa de Krippendorff dos juízes 0,61 por critério, abaixo do 0,67 pré-registrado, então hipóteses de rubrica subpotentes (a média de 3 juízes tem confiabilidade estimada de 0,72 e 0,83, exploratório; os juízes não veem o PRD).
- Híbrido (TechSpec pelo Sonnet): 3,1 vezes o custo da cascata, sem ganho de nota (refutada pelo custo).
- Persona e contexto (C12), pareado por variante: +0,9 em TechSpec e +1,1 em Tasks (p ≈ 0,06 e 0,03), exploratório, n=3 por célula.
- Fase C (H2, H7, H8, H9) adiada para um paper futuro.

Limites: um projeto; modelos e preços de 04/11/2026; juízes são amostras do mesmo modelo; testes e núcleo definidos pelo autor do estudo; extensão disparada pelo resultado parcial; sem réplica externa (só clone limpo na mesma máquina).
