// Gera os estímulos do estudo 3b (determinístico). Uso: node gerador/estimulos3b.mjs [itens_por_familia=8] [pasta=dados/estimulos]
// T2 (melhorar, defeitos graduados): k = 3, 6 ou 9 regras violadas (mistura de regras vistas e retidas).
// T4 (revisão aberta para produção): rascunho com TODAS as regras da família violadas; o lake aparece em níveis de completude.
// Regras retidas (H): 25% das regras de cada família, sorteadas com semente fixa; nunca aparecem no lake, nos relatórios nem nos prompts.
import fs from 'node:fs';
import { rng, embaralhar, REGRA } from './comum.mjs';

const FAMILIAS = ['painel', 'listagem', 'formulario', 'checkout', 'configuracoes', 'navegacao'];
const N = +(process.argv[2] || 8);
const OUT = new URL('../' + (process.argv[3] || 'dados/estimulos') + '/', import.meta.url);
fs.mkdirSync(OUT, { recursive: true });

const mods = {};
for (const f of FAMILIAS) mods[f] = await import(`./familias/${f}.mjs`);

const retidas = {}; const R0 = rng(20261111);
for (const f of FAMILIAS) {
  const regs = [...mods[f].REGRAS];
  const k = Math.max(3, Math.round(regs.length * 0.25));
  retidas[f] = embaralhar(R0, regs).slice(0, k).sort();
}
fs.writeFileSync(new URL('retidas.json', OUT), JSON.stringify(retidas, null, 1));

const t2 = [], t4 = [];
for (const f of FAMILIAS) {
  const m = mods[f];
  for (let i = 0; i < N; i++) {
    const seed = (+(process.argv[4] || 0)) + 3000 + FAMILIAS.indexOf(f) * 100 + i;
    const v = m.variante(seed);
    const k = [3, 6, 9][i % 3];
    const R = rng(seed * 7 + 1);
    const H = retidas[f], V = m.REGRAS.filter(r => !H.includes(r));
    // T2: k violadas, ao menos 1 retida e 1 vista
    const kh = Math.max(1, Math.round(k * 0.25));
    const viol = [...embaralhar(R, H).slice(0, kh), ...embaralhar(R, V).slice(0, k - kh)].sort();
    t2.push({ id: `T2-${f}-${i + 1}`, familia: f, seed, k, violar: viol, retidas_violadas: viol.filter(r => H.includes(r)), html: m.construir(v, new Set(viol)), regras_familia: m.REGRAS });
    // T4: rascunho com todas violadas
    t4.push({ id: `T4-${f}-${i + 1}`, familia: f, seed, violar: [...m.REGRAS], retidas: H, html: m.construir(v, new Set(m.REGRAS)), regras_familia: m.REGRAS });
  }
}
fs.writeFileSync(new URL('t2.json', OUT), JSON.stringify(t2));
fs.writeFileSync(new URL('t4.json', OUT), JSON.stringify(t4));
const med = a => Math.round(a.reduce((s, x) => s + x.html.length, 0) / a.length);
console.log('T2', t2.length, 'T4', t4.length, 'tamanho médio (caracteres) T2', med(t2), 'T4', med(t4));
console.log('retidas', Object.fromEntries(Object.entries(retidas).map(([k, v]) => [k, v.length])));
