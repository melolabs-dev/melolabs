#!/usr/bin/env python3
"""Monta o pacote de dados aberto (passo F8.2) em dados/pacote/: CSVs derivados dos dados brutos, dicionário, licença e README.

Uso: python -I analise/pacote.py
Não inclui transcrições nem prompts (estão em dados/bruto/), nem o gabarito de testes (cifrado no repositório).
"""
import csv
import json
import shutil
from collections import defaultdict
from pathlib import Path

ESTUDO = Path(__file__).resolve().parents[1]
BRUTO = ESTUDO / "dados" / "bruto"
PAC = ESTUDO / "dados" / "pacote"
PAC.mkdir(parents=True, exist_ok=True)

plano = json.loads((BRUTO / "plano-execucoes.json").read_text(encoding="utf-8")) + json.loads((BRUTO / "plano-extensao.json").read_text(encoding="utf-8"))
fase = {p["id"]: p["fase"] for p in plano}
ids = [p["id"] for p in plano]

etapas = [json.loads(l) for l in open(BRUTO / "execucoes.jsonl", encoding="utf-8")]
etapas = [e for e in etapas if e["id"] in fase]
campos_etapa = ["id", "etapa", "tentativa", "modelo", "modelo_efetivo", "inicio", "duracao_s", "chamadas_ferramenta", "turnos", "tokens_entrada", "tokens_saida",
                "tokens_cache_criado", "tokens_cache_lido", "tokens_totais", "tokens_novos", "maior_prompt", "custo_usd_lista", "acessos_suspeitos", "falha_infra"]
with open(PAC / "etapas.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=campos_etapa, extrasaction="ignore")
    w.writeheader()
    for e in etapas:
        e = dict(e)
        e["acessos_suspeitos"] = len(e.get("acessos_suspeitos") or [])
        w.writerow(e)

soma = defaultdict(lambda: defaultdict(float))
for e in etapas:
    for k in ("tokens_totais", "tokens_novos", "custo_usd_lista", "duracao_s"):
        soma[e["id"]][k] += e.get(k) or 0
    soma[e["id"]]["maior_prompt"] = max(soma[e["id"]]["maior_prompt"], e.get("maior_prompt") or 0)

with open(PAC / "execucoes.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["id", "fase_plano", "condicao", "variante", "repeticao", "nucleo_passaram", "nucleo_total", "nucleo_esperado", "nucleo_100", "typecheck_ok", "lint_ok",
                "testes_passaram", "testes_total", "gate_primeira_tentativa_prd", "gate_primeira_tentativa_techspec", "gate_primeira_tentativa_tasks", "escalonou",
                "auditoria_limpa", "tokens_totais", "tokens_novos", "maior_prompt", "custo_usd_lista", "duracao_s"])
    for i in ids:
        m = json.loads((BRUTO / i / "concluida.json").read_text(encoding="utf-8"))
        s = json.loads((BRUTO / i / "score.json").read_text(encoding="utf-8"))
        d = m["documentos"]
        g = lambda k: d.get(k, {}).get("gate_primeira_tentativa") if isinstance(d.get(k), dict) else None
        esc = bool(d.get("escalonou_codigo")) or any(isinstance(x, dict) and x.get("escalonou") for x in d.values())
        w.writerow([i, fase[i], m["condicao"], m["variante"], int(i.rsplit("-r", 1)[1]), s["nucleo_passaram"], s["nucleo_total"], s["nucleo_esperado"], int(bool(s["nucleo_100"])),
                    int(bool(s["typecheck_ok"])), int(bool(s["lint_ok"])), s["passaram"], s["total"], g("prd"), g("techspec"), g("tasks"), int(esc), int(bool(m.get("auditoria_limpa"))),
                    int(soma[i]["tokens_totais"]), int(soma[i]["tokens_novos"]), int(soma[i]["maior_prompt"]), round(soma[i]["custo_usd_lista"], 4), round(soma[i]["duracao_s"], 1)])

mapa = json.loads((BRUTO / "mapa-cego.json").read_text(encoding="utf-8"))
with open(PAC / "julgamentos.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["codigo_artefato", "id_execucao", "condicao", "variante", "tipo", "juiz", "criterio", "nota", "alucinacoes"])
    for l in open(BRUTO / "juizes.jsonl", encoding="utf-8"):
        r = json.loads(l)
        if "criterios" not in r:
            continue
        v = mapa[r["codigo"]]
        for k, nota in r["criterios"].items():
            w.writerow([r["codigo"], v["id"], v["condicao"], v["variante"], r["tipo"], r["juiz"], k, nota, r["alucinacoes"]])

shutil.copy(ESTUDO / "dicionario.md", PAC / "dicionario.md")
(PAC / "LICENSE").write_text("""Dados (CSV e dicionario): Creative Commons Attribution 4.0 International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/
Codigo (pasta analise/ e tools/): licenca MIT.
Atribuicao sugerida: Melo, C. (2026). Melo Labs, estudo "SDD so com Haiku". https://github.com/melolabs-dev/melolabs
(licenca proposta em 07/11/2026; o autor confirma antes da publicacao)
""", encoding="utf-8")
(PAC / "README.md").write_text("""# Pacote de dados: SDD só com Haiku

Estudo do Melo Labs, 198 execuções (138 do plano principal e 60 da extensão) e 579 julgamentos de rubrica. Coleta em 06 e 07/11/2026.

| Arquivo | Conteúdo |
|---|---|
| `execucoes.csv` | uma linha por execução: condição, variante, núcleo de testes, typecheck, lint, gates, tokens e custo de lista somados |
| `etapas.csv` | uma linha por etapa de cada execução (PRD, TechSpec, Tasks, código), com tokens (entrada, saída, cache), custo, tempo e acessos suspeitos |
| `julgamentos.csv` | uma linha por juiz, artefato e critério da rubrica (3 juízes por artefato; TechSpec C1 a C7, Tasks T1 a T5) |
| `dicionario.md` | dicionário de dados |
| `LICENSE` | licença dos dados e do código |

Reprodução: `python tools/harness/reproduzir.py` (clone limpo) regenera `dados/processado/` a partir de `dados/bruto/`. O texto completo, as transcrições e os prompts de cada execução estão em `dados/bruto/`. O gabarito de testes ocultos está cifrado no repositório.

Limites: um projeto (h3, TypeScript); modelos e preços de 04/11/2026; juízes são amostras do mesmo modelo (alfa de Krippendorff 0,61).
""", encoding="utf-8")
print("pacote em", PAC, [p.name for p in PAC.iterdir()])
