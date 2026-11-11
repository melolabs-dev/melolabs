// Utilitários comuns do estudo 3b. Dependências (playwright-core, axe-core) vêm do kit do estudo 3.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const req = createRequire(new URL('../../haiku-ui-design/kit/', import.meta.url));
export const { chromium } = req('playwright-core');
export const AXE_SRC = fs.readFileSync(req.resolve('axe-core/axe.min.js'), 'utf8');

export function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export const pick = (R, a) => a[Math.floor(R() * a.length)];
export function embaralhar(R, a) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export const LAKE = JSON.parse(fs.readFileSync(new URL('../lake/lake-ref-v2.json', import.meta.url), 'utf8'));
export const REGRA = Object.fromEntries(LAKE.map(r => [r.id, r]));

// Abre o navegador uma vez; devolve {pagina(html, largura, altura), fechar}.
export async function navegador() {
  const b = await chromium.launch({ channel: 'chrome' });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const pg = await ctx.newPage();
  return {
    async abrir(html, largura = 1280, altura = 800) { await pg.setViewportSize({ width: largura, height: altura }); await pg.setContent(html, { waitUntil: 'load' }); return pg; },
    async axe(regras) { await pg.evaluate(AXE_SRC); return pg.evaluate(async r => (await axe.run(document, r ? { runOnly: { type: 'rule', values: r } } : undefined)).violations.map(v => ({ id: v.id, nos: v.nodes.length })), regras || null); },
    async fechar() { await b.close(); },
  };
}
