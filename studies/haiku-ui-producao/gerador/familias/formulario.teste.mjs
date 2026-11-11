import { navegador, rng, embaralhar } from '../comum.mjs';
import * as F from './formulario.mjs';

const SEMENTES = Array.from({ length: 15 }, (_, i) => i + 1);
const nav = await navegador();
const stat = Object.fromEntries(F.REGRAS.map(r => [r, { ok: 0, n: 0, falhas: [] }]));
const linhas = [];
let tot = 0, certos = 0;
const reg = (regra, esperado, obtido, ctx) => { const s = stat[regra]; s.n++; tot++; if (esperado === obtido.ok) { s.ok++; certos++; } else s.falhas.push(`${ctx}: esperado ${esperado}, nota="${obtido.nota}"`); };
const rodar = async (html) => F.checar(await nav.abrir(html));

for (const seed of SEMENTES) {
  const v = F.variante(seed);
  const base = F.construir(v, new Set());
  if (seed === 1) linhas.push(base.split('\n').length);
  linhas.push(F.construir(v, new Set()).split('\n').length);
  if (base !== F.construir(v, new Set())) console.log('NÃO DETERMINÍSTICO', seed);
  // (1) sem violações
  const r0 = await rodar(base);
  for (const id of F.REGRAS) reg(id, true, r0[id], `seed ${seed} base`);
  // (2) uma violação por vez
  for (const alvo of F.REGRAS) {
    const r = await rodar(F.construir(v, new Set([alvo])));
    for (const id of F.REGRAS) reg(id, id !== alvo, r[id], `seed ${seed} viola ${alvo}`);
    linhas.push(F.construir(v, new Set([alvo])).split('\n').length);
  }
  // (3) 5 violações juntas
  const R = rng(seed * 101);
  const cinco = new Set(embaralhar(R, F.REGRAS).slice(0, 5));
  const r5 = await rodar(F.construir(v, cinco));
  for (const id of F.REGRAS) reg(id, !cinco.has(id), r5[id], `seed ${seed} viola5 ${[...cinco]}`);
  // (4) ruído não altera o resultado (3 sementes)
  if (seed <= 3) {
    const rr = await rodar(F.ruido(base, seed));
    for (const id of F.REGRAS) if (rr[id].ok !== r0[id].ok) { stat[id].falhas.push(`seed ${seed} ruído alterou`); stat[id].ok--; certos--; }
    const alvo = F.REGRAS[(seed * 7) % F.REGRAS.length];
    const rv = await rodar(F.construir(v, new Set([alvo])));
    const rvr = await rodar(F.ruido(F.construir(v, new Set([alvo])), seed));
    for (const id of F.REGRAS) if (rv[id].ok !== rvr[id].ok) { stat[id].falhas.push(`seed ${seed} ruído (viola ${alvo}) alterou`); stat[id].ok--; certos--; }
  }
}
await nav.fechar();
console.log(`Concordância total: ${(100 * certos / tot).toFixed(2)}% (${certos}/${tot})`);
for (const [id, s] of Object.entries(stat)) {
  const p = 100 * s.ok / s.n;
  console.log(`${id} ${p.toFixed(1)}%${p < 97 ? ' <<< ABAIXO' : ''}`);
  s.falhas.slice(0, 3).forEach(f => console.log('   ', f));
}
console.log(`Linhas: min ${Math.min(...linhas)} máx ${Math.max(...linhas)}`);
