import { navegador, rng, embaralhar } from '../comum.mjs';
import * as F from './listagem.mjs';

const SEMENTES = Array.from({ length: +(process.env.N||15) }, (_, i) => i + 1);
const nav = await navegador();
let total = 0, certos = 0;
const falhas = {};
const porRegra = Object.fromEntries(F.REGRAS.map(r => [r, { t: 0, c: 0 }]));
const linhas = [];
const reg = (rotulo, regra, esperado, obtido, nota) => {
  total++; porRegra[regra].t++;
  if (esperado === obtido) { certos++; porRegra[regra].c++; }
  else { const k = rotulo; (falhas[k] ||= []).push(`${regra} esperado=${esperado} obtido=${obtido} (${nota})`); }
};
const rodar = async (html) => F.checar(await nav.abrir(html));

for (const seed of SEMENTES) {
  const v = F.variante(seed);
  const base = F.construir(v, new Set());
  linhas.push(base.split('\n').length);
  if (F.construir(v, new Set()) !== base) console.log('NAO DETERMINISTICO seed', seed);
  const r0 = await rodar(base);
  for (const r of F.REGRAS) reg(`s${seed} base`, r, true, r0[r].ok, r0[r].nota);
  for (const alvo of F.REGRAS) {
    const res = await rodar(F.construir(v, new Set([alvo])));
    for (const r of F.REGRAS) reg(`s${seed} viola ${alvo}`, r, r !== alvo, res[r].ok, res[r].nota);
  }
  const R = rng(seed * 101 + 3);
  const cinco = embaralhar(R, F.REGRAS).slice(0, 5);
  const rc = await rodar(F.construir(v, new Set(cinco)));
  for (const r of F.REGRAS) reg(`s${seed} cinco[${cinco}]`, r, !cinco.includes(r), rc[r].ok, rc[r].nota);
  // ruído não pode alterar resultado
  const rn = await rodar(F.ruido(base, seed));
  for (const r of F.REGRAS) reg(`s${seed} ruido-base`, r, r0[r].ok, rn[r].ok, rn[r].nota);
  const rn2 = await rodar(F.ruido(F.construir(v, new Set(cinco)), seed + 100));
  for (const r of F.REGRAS) reg(`s${seed} ruido-cinco`, r, rc[r].ok, rn2[r].ok, rn2[r].nota);
}
await nav.fechar();
console.log(`Concordância total: ${certos}/${total} = ${(100 * certos / total).toFixed(2)}%`);
console.log('Por regra (<100%):');
for (const [r, x] of Object.entries(porRegra)) if (x.c !== x.t) console.log(`  ${r}: ${x.c}/${x.t} = ${(100 * x.c / x.t).toFixed(1)}%`);
console.log(`Linhas da tela: mín ${Math.min(...linhas)} máx ${Math.max(...linhas)}`);
const ks = Object.keys(falhas);
console.log(`Casos com falha: ${ks.length}`);
for (const k of ks.slice(0, 40)) console.log(' ', k, '->', falhas[k].slice(0, 3).join(' | '));
