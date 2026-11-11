"""Gera docs/metodo/manual.html a partir de manual_tpl.html e dos SKILL.md (texto escapado, com botão de copiar)."""
import html
from pathlib import Path
D = Path(__file__).resolve().parent
t = (D / "manual_tpl.html").read_text(encoding="utf-8")
for marca, nome in (("__SKILL_LAKE__", "data-lake-curado"), ("__SKILL_UX__", "kit-ux-haiku"), ("__SKILL_SDD__", "sdd-haiku-c4")):
    sk = (D / "skills" / nome / "SKILL.md").read_text(encoding="utf-8")
    t = t.replace(marca, "<pre><code>" + html.escape(sk) + "</code></pre>")
(D / "manual.html").write_text(t, encoding="utf-8")
print(len(t))
