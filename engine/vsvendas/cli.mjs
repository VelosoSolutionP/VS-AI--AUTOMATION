#!/usr/bin/env node
/**
 * VSvendas — CLI. Onboarding (entrevista) + copiloto de vendas.
 *
 *   vsvendas interview empresa         # entrevista interativa (ou --answers file.json)
 *   vsvendas interview vendas
 *   vsvendas qualify "texto do lead"
 *   vsvendas followup --nome Joao --etapa "Proposta enviada" --dor "planilha manual"
 *   vsvendas objection "tá caro"
 */
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseArgs } from '../vsqa/cli.mjs';
import { createState, answer, nextQuestion, progress } from '../interview/engine.mjs';
import { saveProfile, loadProfile } from '../interview/index.mjs';
import { qualificar, followup, objecao, listarProdutos, anunciar } from './index.mjs';

const ask = (rl, q) => new Promise((res) => rl.question(q, res));

async function interview(setId, args) {
  if (args.answers) {
    const map = JSON.parse(readFileSync(args.answers, 'utf8'));
    let s = { setId, answers: loadProfile(setId) };
    for (const [id, val] of Object.entries(map)) {
      const r = answer(s, id, val);
      if (!r.ok) { console.error(`  ✖ ${id}: ${r.error}`); } else { s = r.state; }
    }
    saveProfile(setId, s.answers);
    const p = progress(s);
    console.log(`✔ entrevista "${setId}" ${p.pct}% (${p.respondidas}/${p.total})${p.completa ? ' — completa' : ' — faltam obrigatórias'}`);
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let s = { setId, answers: loadProfile(setId) };
  console.log(`\n== Entrevista: ${setId} == (enter vazio pula opcional)\n`);
  for (let q = nextQuestion(s); q; q = nextQuestion(s)) {
    const opc = q.opcoes ? ` [${q.opcoes.join(' | ')}]` : '';
    const req = q.required ? '*' : '';
    if (q.help) { console.log(`  (${q.help})`); }
    const raw = (await ask(rl, `${q.pergunta}${opc}${req}\n> `)).trim();
    if (!raw && !q.required) { s = answer(s, q.id, q.tipo === 'list' || q.tipo === 'multichoice' ? [] : '').state || s; break; }
    const r = answer(s, q.id, raw);
    if (!r.ok) { console.log('  ✖ ' + r.error); continue; }
    s = r.state; saveProfile(setId, s.answers);
  }
  rl.close();
  console.log(`\n✔ salvo. ${JSON.stringify(progress(s))}`);
}

function out(obj) { console.log(JSON.stringify(obj, null, 2)); }

async function ads(dir, args) {
  const produtos = listarProdutos(dir);
  if (!produtos.length) { console.log('nenhuma imagem de produto em ' + dir); return; }
  const plataformas = args.plataformas ? String(args.plataformas).split(',') : [];
  const precos = args.precos ? JSON.parse(readFileSync(args.precos, 'utf8')) : null;
  console.log(`\n${produtos.length} produto(s) em ${dir}:`);
  produtos.forEach((p) => console.log(`  - ${p.produto} (${p.imagens.length} foto[s])`));

  const rl = precos ? null : createInterface({ input: process.stdin, output: process.stdout });
  const results = [];
  for (const p of produtos) {
    let preco; let descricao;
    if (precos) {
      const rec = precos[p.produto] || precos[p.produto.toLowerCase()] || {};
      preco = rec.preco; descricao = rec.descricao;
    } else {
      const raw = (await ask(rl, `\n${p.produto} — preço (R$)? `)).trim();
      preco = parseFloat(raw.replace(',', '.').replace(/[^\d.]/g, ''));
      descricao = (await ask(rl, 'texto/descrição (enter pula)? ')).trim() || undefined;
    }
    if (!Number.isFinite(preco)) { console.log(`  ⚠ ${p.produto}: sem preço, pulei`); continue; }
    results.push(anunciar({ produto: p.produto, preco, descricao, imagens: p.imagens }, plataformas));
  }
  if (rl) { rl.close(); }
  out(results);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  try {
    if (cmd === 'interview') { return await interview(args._[1] || 'empresa', args); }
    if (cmd === 'qualify') { return out(qualificar(args._.slice(1).join(' '))); }
    if (cmd === 'followup') { return out(followup({ nome: args.nome, etapa: args.etapa, dor: args.dor })); }
    if (cmd === 'objection') { return out(objecao(args._.slice(1).join(' '))); }
    if (cmd === 'ads') { return await ads(args._[1] || '.', args); }
    console.log('VSvendas — comandos: interview <set> [--answers f.json] | qualify "<lead>" | followup --nome --etapa --dor | objection "<fala>" | ads <pasta> [--plataformas a,b] [--precos f.json]');
  } catch (e) {
    console.error('✖ ' + (e?.message || e));
    process.exit(1);
  }
}

if (/vsvendas[\\/]cli\.mjs$/.test(process.argv[1] || '')) {
  main();
}
