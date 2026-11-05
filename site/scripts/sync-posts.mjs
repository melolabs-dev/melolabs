// Copia os posts de ../posts/published/<slug>/{pt,en}.md para src/content/posts/<lang>/<slug>.md.
// Com INCLUDE_DRAFTS=1 inclui também ../posts/drafts (útil para ver o rascunho no `npm run dev`).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const out = resolve(here, '..', 'src', 'content', 'posts');
const sources = [join(root, 'posts', 'published')];
if (process.env.INCLUDE_DRAFTS === '1') sources.push(join(root, 'posts', 'drafts'));

rmSync(out, { recursive: true, force: true });
for (const lang of ['pt', 'en']) mkdirSync(join(out, lang), { recursive: true });

let count = 0;
for (const base of sources) {
  if (!existsSync(base)) continue;
  for (const slug of readdirSync(base)) {
    if (slug.startsWith('_')) continue;
    for (const lang of ['pt', 'en']) {
      const file = join(base, slug, `${lang}.md`);
      if (!existsSync(file)) continue;
      writeFileSync(join(out, lang, `${slug}.md`), readFileSync(file, 'utf8'));
      count++;
    }
  }
}
console.log(`sync-posts: ${count} arquivo(s) copiado(s)`);
