#!/usr/bin/env python3
"""Julga em fila, um juiz por vez, enquanto a extensao ainda roda (adendo 2). Uma execucao e um juiz no maximo ao mesmo tempo.

Repete: monta o pacote cego das execucoes novas de C0, C1, C4 e C5, julga o que falta (5 juizes por artefato) e espera.
Para quando a extensao terminou e nao ha mais nada a julgar.
"""
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import juizes as J  # noqa: E402
import orquestrador as O  # noqa: E402

BRUTO = J.BRUTO


def pendentes():
    mapa = json.loads(J.MAPA.read_text(encoding="utf-8")) if J.MAPA.exists() else {}
    permitidos = set((BRUTO / "ids-julgar-total.txt").read_text(encoding="utf-8").split())
    feitos = set()
    if J.NOTAS.exists():
        for l in open(J.NOTAS, encoding="utf-8"):
            r = json.loads(l)
            if "criterios" in r:
                feitos.add((r["codigo"], r["juiz"]))
    return sum(1 for c, v in mapa.items() if v["id"] in permitidos for j in range(1, J.NJ + 1) if (c, j) not in feitos)


def main():
    alvo = (BRUTO / "ids-julgar-extensao.txt").read_text(encoding="utf-8").split()
    while True:
        J.montar([i for i in alvo if (BRUTO / i / "concluida.json").exists()])
        n = pendentes()
        fim = "fim do lote" in (BRUTO / "extensao.log").read_text(encoding="utf-8", errors="replace")
        if n == 0:
            if fim:
                print("fim dos julgamentos", flush=True)
                return
            time.sleep(120)
            continue
        O.espera_memoria(2.0)
        J.julgar(10)


if __name__ == "__main__":
    main()
