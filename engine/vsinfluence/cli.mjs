#!/usr/bin/env node
/**
 * VSinfluence — CLI. É o que o cron chama (`varrer`) e o que o criador usa no
 * terminal pra ver o painel, a fila e planejar cortes.
 */
import { dashboard, rodarVarredura, fila, planejarCorte, listarCampanhas, fechamentoMes, listarLives } from './index.mjs';
import { agendarVarredura, removerVarredura } from './cron.mjs';
import { formatarBRL } from './ganhos.mjs';

const [cmd, ...args] = process.argv.slice(2);
const agora = new Date();
const hora = (d) => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function painel() {
  const d = dashboard(agora);
  console.log('\n  VSinfluence — painel\n');
  console.log('  Próximas publicações:');
  if (!d.proximasPublicacoes.length) { console.log('    (agenda vazia — cadastre com `vsinfluence agenda`)'); }
  for (const p of d.proximasPublicacoes) { console.log(`    ${p.rede.padEnd(11)} ${hora(p.quando)}`); }

  if (d.pendentes.length) {
    console.log('\n  Prontos pra subir:');
    for (const p of d.pendentes) { console.log(`    ${p.rede.padEnd(11)} ${p.video.arquivo}`); }
  }
  if (d.semVideo.length) {
    console.log('\n  SEM VÍDEO (horário passou e a pasta estava vazia):');
    for (const s of d.semVideo) { console.log(`    ${s.rede.padEnd(11)} ${hora(s.quando)}  ${s.dir}`); }
  }
  const t = d.metricas.totais;
  console.log('\n  Métricas:', `views ${t.views ?? '—'} · likes ${t.likes ?? '—'} · dislikes ${t.dislikes ?? '—'} · comentários ${t.comentarios ?? '—'}`);
  if (d.metricas.indisponiveis.length) { console.log('    (indisponível na API:', d.metricas.indisponiveis.join(', ') + ')'); }
  console.log('  Ganhos do mês:', d.ganhosDoMes.formatado, '| RPM:', d.ganhosDoMes.rpmFormatado);
  if (d.campanhasAtivas.length) { console.log('  Campanhas ativas:', d.campanhasAtivas.map((c) => c.nome).join(', ')); }
  if (d.proximasLives.length) { console.log('  Próxima live:', d.proximasLives[0].titulo, '—', hora(d.proximasLives[0].inicio)); }
  for (const a of d.alertas) { console.log('  ⚠ ', a); }
  console.log('');
}

switch (cmd) {
  case 'varrer': {
    const r = rodarVarredura(agora);
    console.log(`[vsinfluence] ${r.resumo}`);
    for (const p of r.pendentes) { console.log(`  SUBIR  ${p.rede}  ${p.video.arquivo}`); }
    for (const s of r.semVideo) { console.log(`  FALTOU ${s.rede}  ${hora(s.quando)}`); }
    for (const e of r.erros) { console.log(`  ERRO   ${e}`); }
    break;
  }
  case 'fila': {
    const r = fila(args[0]);
    if (r.erro) { console.error('  ✖', r.erro); process.exit(1); }
    r.fila.forEach((v, i) => console.log(`  ${i + 1}. ${v.arquivo}  (${(v.bytes / 1e6).toFixed(1)} MB)`));
    if (!r.fila.length) { console.log('  (fila vazia)'); }
    break;
  }
  case 'cortar': {
    const [entrada, rede, ...pares] = args;
    const cortes = pares.map((p) => { const [inicio, fim, ...t] = p.split(','); return { inicio, fim, titulo: t.join(',') }; });
    const r = planejarCorte({ entrada, rede, cortes });
    if (r.erros.length) { r.erros.forEach((e) => console.error('  ✖', e)); process.exit(1); }
    console.log('\n  Plano (nada foi executado):\n');
    r.plano.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.titulo} — ${p.duracao.toFixed(1)}s -> ${p.saida}`);
      p.avisos.forEach((a) => console.log(`     ⚠ ${a}`));
      console.log(`     ${r.comandos[i]}\n`);
    });
    break;
  }
  case 'campanhas':
    for (const c of listarCampanhas(agora.toISOString().slice(0, 10))) { console.log(`  [${c.situacao}] ${c.nome} — ${c.objetivo} (${c.inicio} a ${c.fim})`); }
    break;
  case 'ganhos': {
    const f = fechamentoMes(args[0] || agora.toISOString().slice(0, 7));
    console.log(`  ${f.mes}: ${f.formatado} em ${f.lancamentos} lançamento(s) | RPM ${f.rpmFormatado}`);
    for (const [k, v] of Object.entries(f.porFonte)) { console.log(`    ${k.padEnd(12)} ${formatarBRL(v)}`); }
    break;
  }
  case 'lives':
    for (const l of listarLives(agora)) { console.log(`  [${l.situacao}] ${l.titulo} — ${l.rede} — ${hora(l.inicio)}`); }
    break;
  case 'cron': {
    const r = args[0] === 'off' ? removerVarredura() : agendarVarredura({ everyMin: Number(args[0]) || 15 });
    console.log(' ', JSON.stringify(r));
    break;
  }
  default:
    painel();
}
