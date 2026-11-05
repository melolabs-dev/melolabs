#!/usr/bin/env python3
"""Estado do plano: marca etapas concluídas e grava onde estamos.

  python tools/plan/plano.py done f1-dev-key f1-gh-cli     # marca etapas como feitas (com a data de hoje)
  python tools/plan/plano.py now "Criando o repositório privado"   # define o passo atual
  python tools/plan/plano.py show                          # mostra o estado

Grava docs/plano-estado.json (fonte de verdade) e reescreve o bloco de estado dentro de
docs/plano-de-publicacao.html. Depois é só republicar o artefato com o mesmo caminho.
"""
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / "docs" / "plano-estado.json"
HTML = ROOT / "docs" / "plano-de-publicacao.html"
MARK = re.compile(r"/\*STATE-START\*/.*?/\*STATE-END\*/", re.S)

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def load():
    if STATE.exists():
        return json.loads(STATE.read_text(encoding="utf-8"))
    return {"updated": "", "now": "", "done": {}}


def save(st):
    st["updated"] = datetime.now().strftime("%Y-%m-%d %H:%M")
    STATE.write_text(json.dumps(st, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    html = HTML.read_text(encoding="utf-8")
    blob = json.dumps(st, ensure_ascii=False)
    if not MARK.search(html):
        sys.exit("marcadores /*STATE-START*/ não encontrados no HTML")
    HTML.write_text(MARK.sub(lambda _: f"/*STATE-START*/{blob}/*STATE-END*/", html), encoding="utf-8")
    ids = set(re.findall(r'data-k="([^"]+)"', html))
    unknown = [k for k in st["done"] if k not in ids]
    if unknown:
        print("aviso: ids que não existem no plano:", ", ".join(unknown))
    print(f"estado salvo: {len(st['done'])} etapa(s) concluída(s) · agora: {st['now'] or '(nada)'}")


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cmd, args, st = sys.argv[1], sys.argv[2:], load()
    if cmd == "done":
        for k in args:
            st["done"].setdefault(k, date.today().isoformat())
        save(st)
    elif cmd == "now":
        st["now"] = " ".join(args)
        save(st)
    elif cmd == "show":
        print(json.dumps(st, ensure_ascii=False, indent=2))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
