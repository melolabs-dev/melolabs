import { navegador, rng, embaralhar } from '../comum.mjs';
import * as F from './checkout.mjs';

const SEMENTES = Array.from({ length: 15 }, (_, i) => i + 1);
const nav = await navegador();
let total = 0, certos = 0; const falhas = []; const porRegra = {}; const linhas = [];
const cont = (seed, cenario, res, esperado) => {
  for (const id of F.REGRAS) {
    const ok = res[id] ? res[id].ok : undefined;
    const exp = esperado.has(id) ? false : true;
    total++; porRegra[id] ??= { t: 0, c: 0 }; porRegra[id].t++;
    if (ok === exp) { certos++; porRegra[id].c++; } else falhas.push(`seed ${seed} | ${cenario} | ${id}: esperado ${exp ? 'ok' : 'falha'}, obtido ${ok} (${res[id]?.nota})`);
  }
};
const rodar = async (html) => { const pg = await nav.abrir(html); return F.checar(pg); };
for (const seed of SEMENTES) {
  const v = F.variante(seed);
  const html0 = F.construir(v, new Set());
  if (F.construir(v, new Set()) !== html0) falhas.push(`seed ${seed}: construir nao deterministico`);
  linhas.push(html0.split('\n').length);
  cont(seed, 'limpo', await rodar(html0), new Set());
  for (const r of F.REGRAS) { const s = new Set([r]); cont(seed, 'viola ' + r, await rodar(F.construir(v, s)), s); }
  const R = rng(seed * 977);
  const cinco = new Set(embaralhar(R, F.REGRAS).slice(0, 5));
  const hc = F.construir(v, cinco);
  const rc = await rodar(hc);
  cont(seed, 'cinco ' + [...cinco].join(','), rc, cinco);
  // ruido nao pode mudar o resultado
  for (const [nome, h, ref] of [['limpo', html0, null], ['cinco', hc, rc]]) {
    const rr = await rodar(F.ruido(h, seed));
    const base = ref || await rodar(h);
    for (const id of F.REGRAS) if (rr[id].ok !== base[id].ok) falhas.push(`seed ${seed} | ruido ${nome} | ${id} mudou`);
  }
}
await nav.fechar();
console.log(`Concordancia total: ${certos}/${total} = ${(100 * certos / total).toFixed(2)}%`);
console.log('Por regra:', Object.entries(porRegra).map(([k, x]) => `${k} ${(100 * x.c / x.t).toFixed(0)}%`).join(' '));
console.log(`Linhas da tela: min ${Math.min(...linhas)} max ${Math.max(...linhas)}`);
console.log(`Falhas (${falhas.length}):`); for (const f of falhas.slice(0, 60)) console.log('  ' + f);
