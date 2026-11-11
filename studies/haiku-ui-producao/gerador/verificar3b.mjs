// Verificador do estudo 3b (navegador real). Dois modos:
//  node verificar3b.mjs rel     (stdin: {"familia","html","mostrar":[ids]})  -> relatório de texto só com as regras mostradas que falham
//  node verificar3b.mjs pontuar entrada.jsonl saida.jsonl                    -> acrescenta "ok": {regra: bool} a cada registro com html_final
import fs from 'node:fs';
import { navegador, REGRA } from './comum.mjs';

const mods = {};
const mod = async f => mods[f] ??= await import(`./familias/${f}.mjs`);
const [modo, ent, sai] = process.argv.slice(2);
const nav = await navegador();
async function checar(f, html) { const m = await mod(f); const pg = await nav.abrir(html, 1280, 800); const r = await m.checar(pg); await pg.setViewportSize({ width: 1280, height: 800 }); return r; }

if (modo === 'rel') {
  const e = JSON.parse(fs.readFileSync(0, 'utf8'));
  const r = await checar(e.familia, e.html);
  const mostrar = new Set(e.mostrar);
  const falhas = Object.entries(r).filter(([id, v]) => mostrar.has(id) && !v.ok);
  const txt = falhas.length
    ? 'Relatório da checagem automática (navegador real). Regras que a tela atual NÃO cumpre:\n' + falhas.map(([id, v]) => `- ${id}: ${REGRA[id].regra_final} (observado: ${v.nota})`).join('\n')
    : 'Relatório da checagem automática (navegador real): nenhuma das regras verificadas falhou.';
  process.stdout.write(txt);
} else {
  const out = [];
  for (const l of fs.readFileSync(ent, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(l);
    if (r.erro || !r.html_final) { out.push(r); continue; }
    try { const c = await checar(r.familia, r.html_final); r.ok = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, !!v.ok])); }
    catch (e) { r.erro_pontuacao = String(e).slice(0, 160); }
    out.push(r);
  }
  fs.writeFileSync(sai, out.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log('pontuadas', out.length, 'com erro', out.filter(r => r.erro_pontuacao).length);
}
await nav.fechar();
