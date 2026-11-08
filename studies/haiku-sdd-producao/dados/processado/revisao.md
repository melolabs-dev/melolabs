# Respostas à revisão adversarial (F7.4)

```json
{
 "rotulo": "EXPLORATÓRIO — respostas à revisão adversarial (F7.4); não substitui a análise pré-registrada",
 "conferencia_recontagem_igual_ao_oficial": true,
 "testes_que_falham_por_condicao": {
  "C0": {
   "problem-1384:P1": 5,
   "problem-1384:P3": 5
  },
  "C1": {
   "problem-1384:P1": 10,
   "range-1267:R2": 4,
   "range-1267:R3": 4,
   "range-1267:R4": 4,
   "range-1267:R5": 4,
   "range-1267:R6": 4,
   "range-1267:R10": 4,
   "range-1267:R11": 4,
   "range-1267:E5": 2,
   "problem-1384:P3": 1,
   "range-1267:R1": 1,
   "range-1267:R7": 1,
   "range-1267:R8": 1
  },
  "C4": {
   "problem-1384:P1": 12,
   "range-1267:R2": 2,
   "range-1267:R3": 2,
   "range-1267:R4": 2,
   "range-1267:R5": 2,
   "range-1267:R6": 2,
   "range-1267:R10": 2,
   "range-1267:R11": 2,
   "range-1267:R1": 1,
   "range-1267:R7": 1,
   "range-1267:R8": 1,
   "range-1267:E5": 1
  }
 },
 "nucleo_sem_P1_como_observacao": {
  "contagens": {
   "C0": [
    49,
    54
   ],
   "C1": [
    30,
    36
   ],
   "C4": [
    51,
    54
   ]
  },
  "diferenca_C4_menos_C0": 0.03703703703703698,
  "newcombe_bilateral_95": [
   -0.07190697840892701,
   0.14962070373806277
  ],
  "nota": "P1 (rota inexistente responde 404 em problem+json) não é pedido pelo contrato enxuto de 1384-a e 1384-c; classificação nucleo/observacao foi do autor (adendo 1)"
 },
 "diferenca_C4_menos_C0_por_variante_pp": {
  "problem-1384-a": -44.4,
  "problem-1384-b": 11.1,
  "problem-1384-c": -44.4,
  "range-1267": -33.3,
  "session-1050-a": 0,
  "session-1050-b": 0
 },
 "IC_t95_nivel_variante_pp": {
  "media": -18.5,
  "ic": [
   -44.7,
   7.7
  ],
  "gl": 5
 },
 "diferenca_C4_menos_C0_por_feature_pp": {
  "problem-1384": -25.9,
  "range-1267": -33.3,
  "session-1050": 0
 },
 "IC_t95_nivel_feature_pp": {
  "media": -19.7,
  "ic": [
   -63.2,
   23.7
  ],
  "gl": 2
 },
 "custo_por_nucleo_aceito": {
  "C0": 1.357,
  "C4": 0.311,
  "C1": 0.448,
  "razao_C4_C0": 0.23
 },
 "razao_custo_C4_C0_por_variante": {
  "problem-1384-a": 0.176,
  "problem-1384-b": 0.233,
  "problem-1384-c": 0.158,
  "range-1267": 0.135,
  "session-1050-a": 0.203,
  "session-1050-b": 0.188
 },
 "C12_pareado": {
  "techspec_C12_menos_C1": {
   "variantes": [
    "range-1267",
    "session-1050-b"
   ],
   "diferenca": 0.89,
   "p_unilateral_permutacao": 0.0608,
   "n": {
    "range-1267": [
     3,
     3
    ],
    "session-1050-b": [
     3,
     3
    ]
   }
  },
  "techspec_C12_menos_C13": {
   "variantes": [
    "range-1267",
    "session-1050-b"
   ],
   "diferenca": 1.33,
   "p_unilateral_permutacao": 0.0427,
   "n": {
    "range-1267": [
     3,
     3
    ],
    "session-1050-b": [
     3,
     3
    ]
   }
  },
  "tasks_C12_menos_C1": {
   "variantes": [
    "range-1267",
    "session-1050-b"
   ],
   "diferenca": 1.11,
   "p_unilateral_permutacao": 0.0297,
   "n": {
    "range-1267": [
     3,
     3
    ],
    "session-1050-b": [
     3,
     3
    ]
   }
  },
  "tasks_C12_menos_C13": {
   "variantes": [
    "range-1267",
    "session-1050-b"
   ],
   "diferenca": 0.89,
   "p_unilateral_permutacao": 0.1121,
   "n": {
    "session-1050-b": [
     3,
     3
    ],
    "range-1267": [
     3,
     3
    ]
   }
  }
 },
 "confiabilidade": {
  "techspec": {
   "alfa_soma": 0.459,
   "confiabilidade_media_3_juizes_spearman_brown": 0.718,
   "artefatos": 96
  },
  "tasks": {
   "alfa_soma": 0.624,
   "confiabilidade_media_3_juizes_spearman_brown": 0.833,
   "artefatos": 96
  }
 },
 "alucinacoes_por_julgamento_pareadas": {
  "C0": [
   0,
   18
  ],
  "C1": [
   0.22,
   18
  ],
  "C4": [
   0.67,
   18
  ],
  "C5": [
   0.39,
   18
  ]
 },
 "gate_documentos_por_condicao": {
  "C2": [
   0,
   18
  ],
  "C4": [
   3,
   162
  ],
  "C5": [
   0,
   36
  ],
  "C6": [
   0,
   18
  ],
  "C0": [
   1,
   162
  ],
  "C1": [
   4,
   108
  ]
 },
 "typecheck_ou_lint_falhou_em_alguma_execucao": false
}
```
