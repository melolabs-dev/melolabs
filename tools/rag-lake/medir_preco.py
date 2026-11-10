#!/usr/bin/env python3
"""Mede o preço efetivo por token do `claude -p` com chamadas a frio (prefixo único, sem cache).

Para cada modelo e tamanho, envia um texto do lake precedido de um sal aleatório (para nunca bater no cache),
pede só a letra A e registra tokens de entrada (escrita de cache, leitura, comum), saída e custo.
Serve para definir o custo nominal (preço de lista sem cache) usado na comparação entre braços.
"""
import json, random, shutil, subprocess, sys
from pathlib import Path

LIMPO = Path.home() / "AppData" / "Local" / "Temp" / "estudo2-limpo"
LAKE = (LIMPO / "lake_inteiro.txt").read_text(encoding="utf-8")
SISTEMA = "Você responde perguntas de múltipla escolha sobre decisões de projeto."


def chamar(modelo, chars):
    sal = "".join(random.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(24))
    texto = f"[{sal}]\nMaterial do projeto:\n{LAKE[:chars]}\n\nPergunta: qual é a letra A? Responda apenas com a letra A."
    cmd = [shutil.which("claude.cmd") or shutil.which("claude"), "-p", "--model", modelo, "--output-format", "json",
           "--setting-sources", "project", "--strict-mcp-config", "--no-session-persistence", "--tools", "",
           "--system-prompt", SISTEMA]
    r = subprocess.run(cmd, input=texto, capture_output=True, text=True, encoding="utf-8", cwd=LIMPO, timeout=900)
    d = json.loads(r.stdout)
    u = d["usage"]
    return {"modelo": modelo, "chars": chars, "in": u["input_tokens"], "escrita": u["cache_creation_input_tokens"],
            "leitura": u["cache_read_input_tokens"], "out": u["output_tokens"], "custo": d["total_cost_usd"]}


if __name__ == "__main__":
    modelo = sys.argv[1]
    tamanhos = [int(x) for x in sys.argv[2:]]
    for c in tamanhos:
        print(json.dumps(chamar(modelo, c)), flush=True)
