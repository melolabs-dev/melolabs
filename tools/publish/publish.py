#!/usr/bin/env python3
"""Publica um post aprovado: portão de qualidade -> git (site) -> DEV -> Hashnode -> texto do LinkedIn.

Uso:
  python tools/publish/publish.py <slug>                 # simulação (padrão): só mostra o que seria feito
  python tools/publish/publish.py <slug> --lang pt --yes # publica de verdade, só o português
  python tools/publish/publish.py <slug> --lang en --yes # depois, o inglês

Segredos ficam só em .env (veja .env.example). Nunca cole tokens no chat.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "rag"))
from rag import NOTES, parse_note  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

DISCLOSURE = {
    "pt": "\n\n---\n*Os experimentos, os dados e as conclusões são meus. A redação foi assistida por IA e revisada por mim.*\n",
    "en": "\n\n---\n*The experiments, data and conclusions are mine. The writing was AI-assisted and reviewed by me.*\n",
}


def load_env():
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"'))


def gate(meta, body, lang):
    """Portão de qualidade: devolve a lista de problemas (vazia = pode publicar)."""
    errs = []
    if meta.get("status") != "approved":
        errs.append("status não é 'approved' (só você aprova)")
    if meta.get("lang") != lang:
        errs.append(f"frontmatter lang deve ser '{lang}'")
    if not meta.get("title"):
        errs.append("sem title")
    sources = meta.get("sources") or []
    if not sources:
        errs.append("sem 'sources' (ids das notas do RAG que sustentam o post)")
    for sid in sources:
        note = NOTES / f"{sid}.md"
        if not note.exists():
            errs.append(f"nota '{sid}' não existe")
            continue
        nm, _ = parse_note(note)
        if not nm.get("validated_by_author"):
            errs.append(f"nota '{sid}' não está validada por você")
        if not nm.get("publishable"):
            errs.append(f"nota '{sid}' não está publicável (anonimizar e marcar publishable: true)")
    if "TODO" in body:
        errs.append("há 'TODO' no texto (número sem medição)")
    return errs


def post_json(url, payload, headers):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "melo-labs-publisher", **headers})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:300]}")


def to_devto(title, body, tags, canonical):
    key = os.environ.get("DEVTO_API_KEY")
    if not key:
        return None, "DEVTO_API_KEY ausente no .env"
    clean = [re.sub(r"[^a-z0-9]", "", t.lower()) for t in tags][:4]
    res = post_json("https://dev.to/api/articles",
                    {"article": {"title": title, "body_markdown": body, "published": True,
                                 "tags": [t for t in clean if t], "canonical_url": canonical}},
                    {"api-key": key})
    return res.get("url"), None


def to_hashnode(title, body, tags, canonical):
    token, pub = os.environ.get("HASHNODE_TOKEN"), os.environ.get("HASHNODE_PUBLICATION_ID")
    if not (token and pub):
        return None, "HASHNODE_TOKEN ou HASHNODE_PUBLICATION_ID ausente no .env"
    q = "mutation Publish($input: PublishPostInput!){ publishPost(input:$input){ post{ id url } } }"
    inp = {"title": title, "contentMarkdown": body, "publicationId": pub, "originalArticleURL": canonical,
           "tags": [{"slug": re.sub(r"[^a-z0-9-]", "", t.lower()), "name": t} for t in tags][:5]}
    res = post_json("https://gql.hashnode.com", {"query": q, "variables": {"input": inp}}, {"Authorization": token})
    if res.get("errors"):
        raise RuntimeError(str(res["errors"])[:300])
    return res["data"]["publishPost"]["post"]["url"], None


def git(*args):
    return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("slug")
    ap.add_argument("--lang", choices=["pt", "en", "both"], default="pt")
    ap.add_argument("--yes", action="store_true", help="publica de verdade (sem isso é simulação)")
    a = ap.parse_args()
    load_env()
    site = os.environ.get("SITE_URL", "").rstrip("/")
    folder = ROOT / "posts" / "drafts" / a.slug
    if not folder.exists():
        sys.exit(f"não achei {folder.relative_to(ROOT)}")
    state_file = folder / "publish.json"
    state = json.loads(state_file.read_text(encoding="utf-8")) if state_file.exists() else {}
    langs = ["pt", "en"] if a.lang == "both" else [a.lang]

    jobs, blocked = [], False
    for lang in langs:
        path = folder / f"{lang}.md"
        if not path.exists():
            print(f"[{lang}] arquivo {path.name} não existe"); blocked = True; continue
        meta, body = parse_note(path)
        errs = gate(meta, body, lang)
        if errs:
            blocked = True
            print(f"[{lang}] BLOQUEADO pelo portão:"); [print("   -", e) for e in errs]
        else:
            print(f"[{lang}] portão OK: {meta['title']}")
            jobs.append((lang, meta, body.strip() + DISCLOSURE[lang]))
    if blocked:
        sys.exit("nada foi publicado.")
    if not a.yes:
        for lang, meta, body in jobs:
            print(f"[{lang}] SIMULAÇÃO: publicaria '{meta['title']}' ({len(body)} caracteres) no site, DEV e Hashnode.")
        print("\nPara publicar de verdade, rode de novo com --yes.")
        return

    if not site:
        print("aviso: SITE_URL ausente; o canonical_url ficará vazio.")
    for lang, meta, body in jobs:
        canonical = f"{site}/{lang}/{a.slug}/" if site else None
        tags = meta.get("tags") or []
        done = state.setdefault(lang, {})
        for name, fn in (("devto", to_devto), ("hashnode", to_hashnode)):
            if name in done:
                print(f"[{lang}] {name}: já publicado ({done[name]})"); continue
            try:
                url, why = fn(meta["title"], body, tags, canonical)
            except RuntimeError as e:
                print(f"[{lang}] {name}: FALHOU {e}"); continue
            if why:
                print(f"[{lang}] {name}: pulado ({why})")
            else:
                done[name] = url; print(f"[{lang}] {name}: publicado {url}")
        (folder / f"linkedin-{lang}.txt").write_text(f"{meta['title']}\n\n{canonical or '(sem SITE_URL)'}\n", encoding="utf-8")
        state_file.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")

    if git("remote").stdout.strip():
        git("add", "-A", "posts")
        git("commit", "-m", f"post: {a.slug} ({', '.join(langs)})")
        r = git("push")
        print("git push:", "ok" if r.returncode == 0 else "falhou: " + r.stderr.strip()[:200])
    else:
        print("git: sem remote configurado; o site ainda não foi atualizado.")

    if all(l in state and state[l] for l in ("pt", "en")):
        dest = ROOT / "posts" / "published" / a.slug
        shutil.move(str(folder), str(dest))
        print("post movido para posts/published/")


if __name__ == "__main__":
    main()
