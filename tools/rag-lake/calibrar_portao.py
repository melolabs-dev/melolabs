#!/usr/bin/env python3
"""Calibra o limiar do portão de abstenção (braço A6) só com as 20 perguntas de calibração.

Sinal: nota máxima do cross-encoder entre os 30 candidatos do híbrido RRF. Regra: abster se sinal < tau.
tau = ponto médio entre duas notas vizinhas que maximiza a acurácia de classificação (respondível contra
sem resposta) nas 20 perguntas; em empate, escolhe o maior tau (mais cauteloso). Grava lake/indice/gate.json.
"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import indice as ix


def main():
    cal = json.load(open(ix.LAKE / "perguntas" / "calibracao" / "cal.json", encoding="utf-8"))
    idx = ix.Indice()
    pts = []
    for q in cal:
        _, sc = idx.pontuar(q["pergunta"])
        pts.append((max(sc), q["bloco"] != "sem_resposta", q["id"]))
        print(f"{q['id']:10s} {q['bloco']:13s} sinal {max(sc):7.3f}")
    notas = sorted(p[0] for p in pts)
    cands = [(notas[i] + notas[i + 1]) / 2 for i in range(len(notas) - 1)]
    def acc(t):
        return sum((s < t) == (not resp) for s, resp, _ in pts) / len(pts)
    melhor = max(cands, key=lambda t: (acc(t), t))
    resp = [s for s, r, _ in pts if r]; sem = [s for s, r, _ in pts if not r]
    print(f"respondíveis: min {min(resp):.3f} média {sum(resp)/len(resp):.3f}; sem resposta: máx {max(sem):.3f} média {sum(sem)/len(sem):.3f}")
    print(f"tau = {melhor:.4f}  acurácia de classificação nas 20 = {acc(melhor):.2f}")
    (ix.LAKE / "indice" / "gate.json").write_text(json.dumps({"tau": melhor, "sinal": "max rerank bge-reranker-v2-m3-int8 sobre top-30 RRF", "n_calibracao": len(pts), "acuracia_calibracao": acc(melhor)}, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
