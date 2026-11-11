import fs from 'node:fs'; import { BASE, tela, DEFEITOS } from './gerar.mjs';
const itens = [{ chave: 'ref', html: tela(BASE) }];
for (const d of ['D01','D02','D03','D04','D05','D06','D10','D14','D15','D17','D18','D19','D20','D24','D25']) itens.push({ chave: 'A_' + d, html: tela(DEFEITOS[d].f({ ...BASE })) });
const S = {
  contraste_rotulo: [['labelColor', ['#1f2937','#4b5563','#6b7280','#9ca3af','#d1d5db']]],
  contraste_botao: [['accent', ['#1d4ed8','#3b6fe0','#6b93ea','#93b4f0','#c3d4f7']]],
  fonte_campos: [['inputFont', [16,14,12,10,8]]],
  espaco_campos: [['gap', [16,12,8,4,0]]],
  altura_botao: [['btnPadY', [16,12,8,4,0]]],
};
for (const [nome, [[k, vals]]] of Object.entries(S)) vals.forEach((v, i) => itens.push({ chave: `B_${nome}_${i}`, html: tela({ ...BASE, [k]: v }) }));
fs.mkdirSync(new URL('../dados/estetica/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../dados/estetica/validacao.json', import.meta.url), JSON.stringify(itens));
console.log('itens', itens.length);
