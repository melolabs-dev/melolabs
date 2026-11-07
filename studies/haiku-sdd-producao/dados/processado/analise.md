# Resultado da análise pré-registrada
Gerado em 2026-11-07T15:23:52 (commit do script: 9c7e7d5). 138 execuções.

| Condição | n | núcleo 100% | frac. de testes | tokens totais | tokens novos | custo lista (US$) | suspeitas |
|---|---|---|---|---|---|---|---|
| C0 | 36 | 32 | 0.9058 | 2,387,880 | 196,068 | 1.2348 | 0 |
| C1 | 18 | 10 | 0.8494 | 3,941,036 | 300,643 | 0.2622 | 0 |
| C10 | 6 | 6 | 0.9675 | 3,166,262 | 335,830 | 0.2142 | 0 |
| C11 | 6 | 5 | 0.9675 | 3,621,625 | 315,308 | 0.2348 | 0 |
| C12 | 6 | 6 | 0.9709 | 3,720,739 | 358,725 | 0.2762 | 0 |
| C13 | 6 | 5 | 0.8477 | 3,342,673 | 304,576 | 0.2149 | 0 |
| C2 | 6 | 5 | 0.8721 | 3,011,834 | 291,080 | 0.1817 | 0 |
| C2n | 6 | 6 | 0.9453 | 6,365,546 | 551,516 | 0.4813 | 1 |
| C4 | 36 | 26 | 0.8998 | 3,647,273 | 302,987 | 0.2205 | 0 |
| C5 | 6 | 6 | 0.9325 | 2,956,483 | 298,179 | 0.1805 | 0 |
| C6 | 6 | 6 | 0.95 | 3,396,528 | 287,489 | 0.5951 | 0 |

```json
{
 "gate": {
  "documentos": 162,
  "reprovados_1o_gate": 2,
  "taxa": 0.0123,
  "regra_testabilidade_H3": "taxa >= 10%"
 },
 "hipoteses": {
  "H4": {
   "C0": [
    32,
    36
   ],
   "C4": [
    26,
    36
   ],
   "C1": [
    10,
    18
   ],
   "diferenca": -0.16666666666666663,
   "newcombe_unilateral_97_5": [
    -0.342131147068426,
    0.01882448291485575
   ],
   "newcombe_unilateral_95": [
    -0.31447153086661994,
    -0.011968957209813225
   ],
   "instrumento_sensivel": true,
   "status": "subpotente",
   "sensibilidade_fracao_de_testes": {
    "C0": 0.9058,
    "C1": 0.8494,
    "C4": 0.8998
   }
  },
  "H6": {
   "status": "descritiva",
   "custo_lista": {
    "razao_C4_sobre_C0": 0.1785722033519197,
    "ic95": [
     0.1559390247301026,
     0.2040517734974975
    ]
   },
   "tokens_totais": {
    "razao_C4_sobre_C0": 1.5274106992887242,
    "ic95": [
     1.3784762512234268,
     1.6985500492187913
    ]
   },
   "tokens_novos": {
    "razao_C4_sobre_C0": 1.5453162455160065,
    "ic95": [
     1.4747396438202554,
     1.6215743495011141
    ]
   },
   "razao_C1_sobre_C0": {
    "custo_lista": 0.21230758067647343,
    "tokens_totais": 1.6504330078854121,
    "tokens_novos": 1.533364596143057
   }
  },
  "H1": {
   "techspec": {
    "diferenca": 0.11111111111110894,
    "ic95": [
     -0.8333333333333286,
     1.0555555555555554
    ],
    "lim_inf_97_5": -0.8333333333333286,
    "lim_inf_95": -0.6666666666666661,
    "p_unilateral": 0.44985501449855014,
    "n": {
     "range-1267": [
      3,
      3
     ],
     "session-1050": [
      3,
      3
     ]
    },
    "limiar_pontos": 3,
    "status": "não confirmada"
   },
   "tasks": {
    "diferenca": 1.1111111111111125,
    "ic95": [
     0.0,
     2.166666666666668
    ],
    "lim_inf_97_5": 0.0,
    "lim_inf_95": 0.16666666666666607,
    "p_unilateral": 0.0741925807419258,
    "n": {
     "range-1267": [
      3,
      3
     ],
     "session-1050": [
      3,
      3
     ]
    },
    "limiar_pontos": 3,
    "status": "não confirmada"
   }
  },
  "H3": {
   "status": "não testável neste desenho",
   "motivo": "taxa de reprovação no primeiro gate < 10%",
   "taxa": 0.0123
  },
  "H11": {
   "C10": {
    "techspec": {
     "diferenca": 0.11111111111111249,
     "ic95": [
      -0.6666666666666661,
      0.9444444444444446
     ],
     "lim_inf_97_5": -0.6666666666666661,
     "lim_inf_95": -0.5555555555555536,
     "p_unilateral": 0.44595540445955406,
     "n": {
      "range-1267": [
       3,
       3
      ],
      "session-1050": [
       3,
       3
      ]
     },
     "limiar_pontos": 3,
     "status": "não confirmada"
    },
    "tasks": {
     "diferenca": 0.6111111111111107,
     "ic95": [
      -0.6111111111111107,
      1.7222222222222232
     ],
     "lim_inf_97_5": -0.6111111111111107,
     "lim_inf_95": -0.44444444444444287,
     "p_unilateral": 0.22857714228577142,
     "n": {
      "session-1050": [
       3,
       3
      ],
      "range-1267": [
       3,
       3
      ]
     },
     "limiar_pontos": 3,
     "status": "não confirmada"
    }
   },
   "C11": {
    "techspec": {
     "diferenca": 0.33333333333333215,
     "ic95": [
      -0.5555555555555554,
      1.222222222222225
     ],
     "lim_inf_97_5": -0.5555555555555554,
     "lim_inf_95": -0.3888888888888893,
     "p_unilateral": 0.2960703929607039,
     "n": {
      "session-1050": [
       3,
       3
      ],
      "range-1267": [
       3,
       3
      ]
     },
     "limiar_pontos": 3,
     "status": "não confirmada"
    },
    "tasks": {
     "diferenca": 0.16666666666666607,
     "ic95": [
      -0.7777777777777768,
      1.1111111111111107
     ],
     "lim_inf_97_5": -0.7777777777777768,
     "lim_inf_95": -0.6111111111111125,
     "p_unilateral": 0.41225877412258777,
     "n": {
      "session-1050": [
       3,
       3
      ],
      "range-1267": [
       3,
       3
      ]
     },
     "limiar_pontos": 3,
     "status": "não confirmada"
    }
   },
   "C12": {
    "techspec": {
     "diferenca": 0.8888888888888911,
     "ic95": [
      0.11111111111111072,
      1.6666666666666679
     ],
     "lim_inf_97_5": 0.11111111111111072,
     "lim_inf_95": 0.22222222222222499,
     "p_unilateral": 0.061193880611938804,
     "n": {
      "range-1267": [
       3,
       3
      ],
      "session-1050": [
       3,
       3
      ]
     },
     "limiar_pontos": 3,
     "status": "não confirmada"
    },
    "tasks": {
     "diferenca": 1.1111111111111107,
     "ic95": [
      0.3888888888888893,
      1.7777777777777768
     ],
     "lim_inf_97_5": 0.3888888888888893,
     "lim_inf_95": 0.5,
     "p_unilateral": 0.031196880311968805,
     "n": {
      "session-1050": [
       3,
       3
      ],
      "range-1267": [
       3,
       3
      ]
     },
     "limiar_pontos": 3,
     "status": "não confirmada"
    }
   },
   "controle_C13": {
    "techspec": {
     "diferenca": -0.44444444444444464,
     "ic95": [
      -1.4444444444444446,
      0.6111111111111107
     ],
     "lim_inf_97_5": -1.4444444444444446,
     "lim_inf_95": -1.3333333333333304,
     "p_unilateral": 0.7642235776422358,
     "n": {
      "range-1267": [
       3,
       3
      ],
      "session-1050": [
       3,
       3
      ]
     },
     "limiar_pontos": 2,
     "status": "não confirmada"
    },
    "tasks": {
     "diferenca": 0.2222222222222232,
     "ic95": [
      -0.8333333333333339,
      1.333333333333334
     ],
     "lim_inf_97_5": -0.8333333333333339,
     "lim_inf_95": -0.6666666666666661,
     "p_unilateral": 0.40045995400459955,
     "n": {
      "session-1050": [
       3,
       3
      ],
      "range-1267": [
       3,
       3
      ]
     },
     "limiar_pontos": 2,
     "status": "não confirmada"
    }
   }
  },
  "H5": {
   "qualidade_techspec": {
    "razao": 0.9704347826086956,
    "ic95": [
     0.9414802065404475,
     0.9982300884955752
    ],
    "lim_inf_97_5": 0.9414802065404475
   },
   "qualidade_tasks": {
    "razao": 0.9583333333333333,
    "ic95": [
     0.9154228855721391,
     1.008108108108108
    ],
    "lim_inf_97_5": 0.9154228855721391
   },
   "custo_lista": {
    "razao_C5_sobre_C0": 0.14619863532527239,
    "ic95": [
     0.09098133852255218,
     0.19966774313609797
    ]
   },
   "taxa_escalonamento": 0.0,
   "status": "confirmada",
   "observacao": "a cascata não escalou nenhuma vez: C5 equivale a C1 e o escalonamento não foi testado (não testável neste desenho)"
  },
  "H10": {
   "qualidade_techspec": {
    "razao_C6_sobre_C5": 1.053763440860215,
    "ic95": [
     1.0301953818827707,
     1.0784671532846712
    ]
   },
   "qualidade_tasks": {
    "razao_C6_sobre_C5": 0.9755434782608695,
    "ic95": [
     0.9521276595744681,
     1.0000000000000002
    ]
   },
   "custo_lista": {
    "razao_C6_sobre_C5": 3.2964620088922945,
    "ic95": [
     2.3619428792846637,
     5.21256656040302
    ]
   }
  },
  "H2": {
   "status": "não testada",
   "motivo": "fase C adiada para um paper futuro (decisão do autor, 06/11/2026)"
  },
  "H7": {
   "status": "não testada",
   "motivo": "fase C adiada para um paper futuro (decisão do autor, 06/11/2026)"
  },
  "H8": {
   "status": "não testada",
   "motivo": "fase C adiada para um paper futuro (decisão do autor, 06/11/2026)"
  },
  "H9": {
   "status": "não testada",
   "motivo": "fase C adiada para um paper futuro (decisão do autor, 06/11/2026)"
  }
 },
 "rubrica": {
  "artefatos_julgados": {
   "C0/tasks": 6,
   "C0/techspec": 6,
   "C1/tasks": 6,
   "C1/techspec": 6,
   "C10/tasks": 6,
   "C10/techspec": 6,
   "C11/tasks": 6,
   "C11/techspec": 6,
   "C12/tasks": 6,
   "C12/techspec": 6,
   "C13/tasks": 6,
   "C13/techspec": 6,
   "C2/tasks": 6,
   "C2/techspec": 6,
   "C2n/tasks": 6,
   "C2n/techspec": 6,
   "C4/tasks": 6,
   "C4/techspec": 6,
   "C5/tasks": 6,
   "C5/techspec": 6,
   "C6/tasks": 6,
   "C6/techspec": 6
  },
  "krippendorff_alfa_intervalo": 0.6199948397823262,
  "alucinacoes_media": {
   "C0": 0,
   "C1": 0.194,
   "C10": 0.278,
   "C11": 0.028,
   "C12": 0.056,
   "C13": 0.139,
   "C2": 0.056,
   "C2n": 0.194,
   "C4": 0.417,
   "C5": 0.25,
   "C6": 0.111
  }
 }
}
```