#!/usr/bin/env python3
"""Monta o conteúdo do módulo Blog do Jornada a partir do estudo, sem tocar em XP, sequência ou hábitos.

  python tools/jornada/sync.py <slug> <core.json lido do Jornada> <saida.json> [--agora "texto"]

Quem grava no Jornada é o Claude, com a ferramenta ArtifactData (update do campo `blog` do doc jornada/core,
fixado na versão lida). Este script só prepara o JSON e preserva tudo o que o autor escreveu.
Regras: só marca como feito o que está objetivamente pronto e não depende de decisão do autor;
passos de decisão aparecem como rascunho nas notas até o autor aprovar.
"""
import json
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "research"))
sys.path.insert(0, str(ROOT / "tools" / "rag"))
import pesquisa as P  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

MARK = re.compile(r"\[\[sync\]\].*?\[\[/sync\]\]", re.S)


def week_key(d):
    return (d - timedelta(days=d.weekday())).isoformat()


def main():
    a = sys.argv[1:]
    if len(a) < 3:
        sys.exit(__doc__)
    slug, core_path, out_path = a[0], Path(a[1]), Path(a[2])
    agora = a[a.index("--agora") + 1] if "--agora" in a else ""
    core = json.loads(core_path.read_text(encoding="utf-8"))
    st, rows, done, total = P.summary(slug)
    hs = P.hipoteses(slug)
    estado = P.load_state(slug)

    blog = core.get("blog") or {}
    blog.setdefault("queue", [])
    blog.setdefault("arts", {})
    criado = date.fromisoformat(estado["criado"])
    key = week_key(criado)

    # tema na fila editorial
    item = next((q for q in blog["queue"] if q.get("base") == f"studies/{slug}"), None)
    if not item:
        item = {"id": "estudo-" + slug, "t": estado["titulo"], "base": f"studies/{slug}",
                "falta": "Decisões do autor: projeto-alvo, limiares, hipóteses e título", "used": key}
        blog["queue"].append(item)
    item["used"] = key

    art = blog["arts"].setdefault(key, {})
    base = {"theme": "", "title": "", "slug": "", "start": "", "q": "", "metric": "", "notes": "", "steps": {}, "ev": {},
            "hyp": [], "gate": {}, "xtra": [], "links": {"site": "", "en": "", "dev": "", "hash": "", "li": ""},
            "res": {"reads": "", "subs": "", "note": ""}, "pub": None}
    for k, v in base.items():
        if art.get(k) is None:
            art[k] = v
    art["theme"] = item["id"]
    if not art["title"]:
        art["title"] = estado["titulo"]
    art["slug"] = slug
    art["start"] = estado["criado"]
    prem = (ROOT / "studies" / slug / "premissa.md").read_text(encoding="utf-8")
    if not art["q"]:
        art["q"] = "[rascunho, aguardando a sua aprovação] Um pipeline de SDD só com Haiku 5.5, com mitigações de engenharia, produz artefatos prontos para produção com qualidade equivalente à do Sonnet 5.5 padrão e custo total por artefato aceito pelo menos 50% menor?"
    if not art["metric"]:
        art["metric"] = "[rascunho] Se vale adotar o Haiku como modelo padrão de SDD no trabalho e na mentoria, e quais mitigações pagam seu custo."

    # passos objetivamente feitos (sem decisão do autor pendente)
    hoje = date.today().isoformat()
    auto = estado.setdefault("auto_feito", {})
    feitos = {}
    for ph, steps, k, n in rows:
        for s, ok, why in steps:
            if not ok:
                continue
            sid = s["id"]
            if s["verifica"]["tipo"] == "manual":
                feitos[sid] = estado["etapas"][sid]["feito"]
            elif s.get("autor"):
                feitos[sid] = estado.get("aprovacoes", {})[sid]["feito"]
            else:
                feitos[sid] = auto.setdefault(sid, hoje)
    for sid, d in feitos.items():
        art["steps"].setdefault(sid, d)  # nunca sobrescreve o que o autor marcou
    P.save_state(slug, estado)

    # hipóteses (preserva as do autor; atualiza as do estudo)
    ids = {h["id"]: h for h in art["hyp"]}
    for h in hs:
        hid = f"{slug}:{h['id']}"
        t = f"{h['id']} (rascunho): {h['enunciado']}"
        if hid in ids:
            ids[hid]["st"] = h["status"]
            ids[hid]["t"] = t
        else:
            art["hyp"].append({"id": hid, "t": t, "st": h["status"]})

    # bloco gerenciado nas notas (o resto das notas é do autor)
    pend = [s["id"] for ph, steps, k, n in rows for s, ok, why in steps if s.get("autor") and not ok and "aprovação" in why]
    linhas = [
        "[[sync]]",
        f"Atualizado pelo Claude em {datetime.now().strftime('%d/%m/%Y %H:%M')}.",
        f"Agora: {agora}" if agora else "Agora: aguardando as suas decisões.",
        f"Progresso: {done} de {total} passos do protocolo; {len(feitos)} marcados aqui.",
        "Feito hoje: estudo criado; busca definida; 30 fontes abertas, conferidas e classificadas; premissa, síntese, 6 hipóteses e 12 candidatas escritas como rascunho.",
        "Descobertas: o Agentless tem números diferentes entre versões (32,00% e US$ 0,70 contra 27,33% e US$ 0,34); a razão de preço do Haiku 5.5 é 1/20 só até 100 mil tokens (acima, 1/4); o estudo de Rosa et al. (2026) é um Registered Report sem resultados.",
        f"Esperando a sua aprovação: {', '.join(pend) or 'nada'}.",
        "Decidido pelo autor em 05/11: projeto TypeScript/Node de porte médio; qualidade >= 0,90 e custo <= 0,50; pelo menos 10 hipóteses; título 'SDD só com Haiku: o que sobra de qualidade quando o custo cai'; juízes Opus até US$ 50; dados congelados em 13/11.",
        "Aprovados pelo autor em 05/11: F0.1, F1.5, F2.1, F2.2. Ainda falta decidir: qual projeto TypeScript (h3, Hono ou Zod) e quais 3 features; passos manuais F0.2 e F0.3.",
        "Artefato do estudo: https://claude.ai/artifact/Rh9dceNqp8djrseMUdiX99",
        "[[/sync]]",
    ]
    bloco = "\n".join(linhas)
    notes = art.get("notes") or ""
    art["notes"] = MARK.sub(lambda _: bloco, notes) if MARK.search(notes) else (notes.rstrip() + ("\n\n" if notes.strip() else "") + bloco)

    out_path.write_text(json.dumps({"blog": blog}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"semana {key}: {len(art['steps'])} passos, {len(art['hyp'])} hipóteses, notas {len(art['notes'])} caracteres")


if __name__ == "__main__":
    main()
