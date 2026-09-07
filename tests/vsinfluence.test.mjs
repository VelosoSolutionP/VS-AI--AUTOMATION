import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// store isolado ANTES de importar o index (o caminho é lido do ambiente)
process.env.VSINFLUENCE_DIR = mkdtempSync(join(tmpdir(), 'vsinfluence-'));

import { normalizarSlot, montarAgenda, vencidosDesde, proximaDe, emMinutos } from '../engine/vsinfluence/agenda.mjs';
import { ehVideo, listarVideos, naoPublicados, marcarPublicado, chave } from '../engine/vsinfluence/biblioteca.mjs';
import { varrer, resumo } from '../engine/vsinfluence/varredura.mjs';
import { paraSegundos, paraHms, validarCorte, planejarCortes, nomeSaida } from '../engine/vsinfluence/corte.mjs';
import { normalizar, agregar, engajamento, delta, somar } from '../engine/vsinfluence/metricas.mjs';
import { paraCentavos, formatarBRL, normalizarGanho, fechamento, rpm } from '../engine/vsinfluence/ganhos.mjs';
import { normalizarCampanha, situacao, desempenho } from '../engine/vsinfluence/campanhas.mjs';
import { normalizarLive, situacaoPor, proximas, fechamentoLive } from '../engine/vsinfluence/lives.mjs';
import { cronLine, schtasksArgs, saneiaIntervalo } from '../engine/vsinfluence/cron.mjs';
import { cadastrarAgenda, getAgenda, registrarPublicacao, lancarGanho, criarCampanha, agendarLive, dashboard } from '../engine/vsinfluence/index.mjs';

/* ---------------- agenda ---------------- */

test('normalizarSlot: aceita cadastro válido e ordena horários', () => {
  const { slot, erros } = normalizarSlot({ rede: 'YouTube', dir: '/v/yt', horarios: ['18:00', '09:30'] });
  assert.deepEqual(erros, []);
  assert.equal(slot.rede, 'youtube');
  assert.deepEqual(slot.horarios, ['09:30', '18:00']);
  assert.equal(slot.dias.length, 7); // sem dias = todos
});

test('normalizarSlot: descarta cadastro inválido com o motivo', () => {
  const { slot, erros } = normalizarSlot({ rede: 'orkut', dir: '', horarios: ['25:00'] });
  assert.equal(slot, null);
  assert.ok(erros.some((e) => /rede desconhecida/.test(e)));
  assert.ok(erros.some((e) => /diretório/.test(e)));
  assert.ok(erros.some((e) => /horário inválido/.test(e)));
});

test('montarAgenda: cadastrar a mesma rede duas vezes substitui, não duplica', () => {
  const { agenda } = montarAgenda([
    { rede: 'tiktok', dir: '/a', horarios: ['08:00'] },
    { rede: 'tiktok', dir: '/b', horarios: ['20:00'] },
  ]);
  assert.equal(Object.keys(agenda.slots).length, 1);
  assert.equal(agenda.slots.tiktok.dir, '/b');
});

test('emMinutos: converte HH:MM e rejeita inválido', () => {
  assert.equal(emMinutos('09:30'), 570);
  assert.equal(emMinutos('24:00'), null);
});

test('vencidosDesde: recupera horário perdido com a máquina desligada', () => {
  const { slot } = normalizarSlot({ rede: 'youtube', dir: '/v', horarios: ['09:00', '18:00'] });
  // desligada das 08:00 de segunda até as 20:00 — os dois horários venceram
  const v = vencidosDesde(slot, new Date(2026, 7, 17, 8, 0), new Date(2026, 7, 17, 20, 0));
  assert.equal(v.length, 2);
  assert.deepEqual(v.map((x) => x.horario), ['09:00', '18:00']);
});

test('vencidosDesde: respeita os dias da semana cadastrados', () => {
  const { slot } = normalizarSlot({ rede: 'youtube', dir: '/v', horarios: ['09:00'], dias: ['seg'] });
  // 2026-08-18 é terça — não publica
  const v = vencidosDesde(slot, new Date(2026, 7, 18, 0, 0), new Date(2026, 7, 18, 23, 0));
  assert.equal(v.length, 0);
});

test('vencidosDesde: slot inativo não vence nada', () => {
  const { slot } = normalizarSlot({ rede: 'youtube', dir: '/v', horarios: ['09:00'], ativo: false });
  assert.equal(vencidosDesde(slot, new Date(2026, 7, 17, 0, 0), new Date(2026, 7, 17, 23, 0)).length, 0);
});

test('proximaDe: acha a próxima publicação futura', () => {
  const { slot } = normalizarSlot({ rede: 'kwai', dir: '/v', horarios: ['09:00', '18:00'] });
  const p = proximaDe(slot, new Date(2026, 7, 17, 10, 0));
  assert.equal(p.horario, '18:00');
});

/* ---------------- biblioteca ---------------- */

const fakeIO = (nomes) => ({
  readdirImpl: () => nomes,
  statImpl: (c) => ({ size: 1000, mtimeMs: nomes.indexOf(c.split('/').pop()) * 1000, isFile: () => true }),
});

test('ehVideo: reconhece extensão de vídeo', () => {
  assert.equal(ehVideo('a.mp4'), true);
  assert.equal(ehVideo('a.MOV'), true);
  assert.equal(ehVideo('a.txt'), false);
});

test('listarVideos: filtra não-vídeo e devolve erro legível se a pasta não existe', () => {
  const { videos } = listarVideos('/v', fakeIO(['a.mp4', 'nota.txt', 'b.mov']));
  assert.deepEqual(videos.map((v) => v.arquivo).sort(), ['a.mp4', 'b.mov']);
  const r = listarVideos('/nao/existe');
  assert.deepEqual(r.videos, []);
  assert.match(r.erro, /não consegui ler/);
});

test('naoPublicados: fila do mais antigo pro mais novo, por rede', () => {
  const { videos } = listarVideos('/v', fakeIO(['a.mp4', 'b.mp4', 'c.mp4']));
  const pub = marcarPublicado({}, 'youtube', 'a.mp4');
  assert.deepEqual(naoPublicados('youtube', videos, pub).map((v) => v.arquivo), ['b.mp4', 'c.mp4']);
  // publicado no YouTube não bloqueia o mesmo arquivo no Instagram
  assert.equal(naoPublicados('instagram', videos, pub).length, 3);
});

test('chave: separa por rede + arquivo', () => {
  assert.equal(chave('youtube', '/pasta/a.mp4'), 'youtube::a.mp4');
});

/* ---------------- varredura (cron) ---------------- */

test('varrer: horário vencido com vídeo vira pendente; sem vídeo vira cobrança', () => {
  const { agenda } = montarAgenda([{ rede: 'youtube', dir: '/v', horarios: ['09:00', '18:00'] }]);
  const io = { listarImpl: () => listarVideos('/v', fakeIO(['so-um.mp4'])) };
  const r = varrer(agenda, {}, new Date(2026, 7, 17, 8, 0), new Date(2026, 7, 17, 20, 0), io);
  assert.equal(r.pendentes.length, 1);
  assert.equal(r.pendentes[0].video.arquivo, 'so-um.mp4');
  assert.equal(r.semVideo.length, 1); // dois horários, um vídeo só
  assert.match(resumo(r), /SEM VÍDEO/);
});

test('varrer: pasta ilegível vira erro sem derrubar a varredura', () => {
  const { agenda } = montarAgenda([{ rede: 'tiktok', dir: '/sumiu', horarios: ['09:00'] }]);
  const r = varrer(agenda, {}, new Date(2026, 7, 17, 8, 0), new Date(2026, 7, 17, 10, 0));
  assert.equal(r.erros.length, 1);
  assert.equal(r.pendentes.length, 0);
});

/* ---------------- corte ---------------- */

test('paraSegundos: aceita HH:MM:SS, MM:SS e número', () => {
  assert.equal(paraSegundos('1:02:03'), 3723);
  assert.equal(paraSegundos('02:03'), 123);
  assert.equal(paraSegundos(45), 45);
  assert.equal(paraSegundos('abc'), null);
});

test('paraHms: formata pro ffmpeg', () => {
  assert.equal(paraHms(3723.5), '01:02:03.500');
});

test('validarCorte: fim antes do início é erro', () => {
  assert.ok(validarCorte({ inicio: '10', fim: '5' }).erros.length);
  assert.equal(validarCorte({ inicio: '10', fim: '40' }).duracao, 30);
});

test('planejarCortes: monta ffmpeg com enquadramento e avisa se excede o limite da rede', () => {
  const { plano, erros } = planejarCortes({
    entrada: '/v/aula.mp4', saidaDir: '/v/cortes', rede: 'instagram',
    cortes: [{ inicio: '0', fim: '120', titulo: 'Melhor parte' }],
  });
  assert.deepEqual(erros, []);
  assert.equal(plano.length, 1);
  assert.ok(plano[0].args.includes('-filter_complex'));
  assert.ok(plano[0].args.join(' ').includes('1080:1920')); // vertical
  assert.match(plano[0].avisos[0], /excede o limite de 90s/);
});

test('planejarCortes: sem melhorar usa cópia de stream', () => {
  const { plano } = planejarCortes({ entrada: '/v/a.mp4', rede: 'youtube', melhorar: false, cortes: [{ inicio: 0, fim: 10 }] });
  assert.ok(plano[0].args.includes('-c'));
  assert.ok(plano[0].args.includes('copy'));
});

test('nomeSaida: usa slug do título sem acento', () => {
  assert.equal(nomeSaida('/v/aula.mp4', 0, 'Ação Rápida!'), 'aula-acao-rapida.mp4');
});

/* ---------------- métricas ---------------- */

test('normalizar youtube: dislike é INDISPONÍVEL (null), nunca 0', () => {
  const m = normalizar('youtube', { statistics: { viewCount: '1000', likeCount: '50', commentCount: '7' } }, 'v1', '2026-08-18T00:00:00Z');
  assert.equal(m.views, 1000);
  assert.equal(m.likes, 50);
  assert.equal(m.dislikes, null); // a API pública removeu em dez/2021
  assert.equal(m.comentarios, 7);
});

test('normalizar: rede sem normalizador devolve erro, não explode', () => {
  assert.match(normalizar('orkut', {}, 'x').erro, /sem normalizador/);
});

test('somar/agregar: tudo null continua null (não vira 0)', () => {
  assert.equal(somar([null, null]), null);
  assert.equal(somar([null, 3]), 3);
  const a = agregar([normalizar('youtube', { statistics: { viewCount: '10' } }, 'a')]);
  assert.equal(a.totais.views, 10);
  assert.ok(a.indisponiveis.includes('dislikes'));
});

test('engajamento: sem views devolve null em vez de dividir por zero', () => {
  assert.equal(engajamento({ views: 0, likes: 5 }), null);
  assert.equal(engajamento({ views: 100, likes: 8, comentarios: 2, compartilhamentos: null }), 0.1);
});

test('delta: campo indisponível de um dos lados vira null', () => {
  const d = delta({ views: 100, likes: null }, { views: 150, likes: 10 });
  assert.equal(d.views, 50);
  assert.equal(d.likes, null);
});

/* ---------------- ganhos ---------------- */

test('paraCentavos: entende formato brasileiro', () => {
  assert.equal(paraCentavos('R$ 1.234,56'), 123456);
  assert.equal(paraCentavos('89,90'), 8990);
  assert.equal(paraCentavos(10.5), 1050);
  assert.equal(paraCentavos('abc'), null);
});

test('formatarBRL: null vira travessão, não R$ 0,00', () => {
  assert.equal(formatarBRL(null), '—');
  assert.match(formatarBRL(123456), /1\.234,56/);
});

test('normalizarGanho: valida fonte e data', () => {
  assert.ok(normalizarGanho({ data: '2026-08-01', fonte: 'bitcoin', valor: '10' }).erros.length);
  const { ganho } = normalizarGanho({ data: '2026-08-01', fonte: 'publi', valor: 'R$ 500,00', rede: 'YouTube' });
  assert.equal(ganho.centavos, 50000);
  assert.equal(ganho.rede, 'youtube');
});

test('fechamento: agrupa por fonte e calcula RPM; sem views RPM é null', () => {
  const gs = [
    { data: '2026-08-01', fonte: 'plataforma', centavos: 10000, rede: 'youtube' },
    { data: '2026-08-15', fonte: 'publi', centavos: 50000, rede: 'youtube' },
    { data: '2026-07-01', fonte: 'publi', centavos: 99900, rede: 'youtube' },
  ];
  const f = fechamento(gs, '2026-08', 100000);
  assert.equal(f.lancamentos, 2);
  assert.equal(f.centavos, 60000);
  assert.equal(f.porFonte.publi, 50000);
  assert.equal(f.rpm, 600); // R$ 6,00 por mil views
  assert.equal(rpm(60000, 0), null);
});

/* ---------------- campanhas ---------------- */

test('normalizarCampanha: valida objetivo, datas e gera id', () => {
  assert.ok(normalizarCampanha({ nome: 'X', objetivo: 'viralizar', inicio: '2026-08-01', fim: '2026-08-31' }).erros.length);
  const { campanha } = normalizarCampanha({ nome: 'Lançamento Verão', objetivo: 'vendas', inicio: '2026-08-01', fim: '2026-08-31', orcamento: 'R$ 300,00' });
  assert.equal(campanha.id, 'lancamento-verao');
  assert.equal(campanha.orcamentoCentavos, 30000);
});

test('situacao: agendada / ativa / encerrada', () => {
  const c = { inicio: '2026-08-10', fim: '2026-08-20' };
  assert.equal(situacao(c, '2026-08-01'), 'agendada');
  assert.equal(situacao(c, '2026-08-15'), 'ativa');
  assert.equal(situacao(c, '2026-08-25'), 'encerrada');
});

test('desempenho: ROI só existe com orçamento; sem custo é null', () => {
  const base = { id: 'c', nome: 'C', objetivo: 'vendas', inicio: '2026-08-01', fim: '2026-08-31', videos: ['v1'], meta: 1000 };
  const med = [normalizar('youtube', { statistics: { viewCount: '2000' } }, 'v1')];
  const ganhosC = [{ centavos: 40000 }];

  const semCusto = desempenho({ ...base, orcamentoCentavos: null }, med, ganhosC, '2026-08-15');
  assert.equal(semCusto.roi, null);
  assert.equal(semCusto.metaAtingida, true);

  const comCusto = desempenho({ ...base, orcamentoCentavos: 20000 }, med, ganhosC, '2026-08-15');
  assert.equal(comCusto.roi, 1); // (400-200)/200
  assert.equal(comCusto.situacao, 'ativa');
});

/* ---------------- lives ---------------- */

test('normalizarLive: exige início ISO válido', () => {
  assert.ok(normalizarLive({ titulo: 'X', rede: 'youtube', inicio: 'ontem' }).erros.length);
  const { live } = normalizarLive({ titulo: 'Live de sexta', rede: 'YouTube', inicio: '2026-08-21T20:00', duracaoMin: 90 });
  assert.equal(live.situacao, 'agendada');
  assert.equal(live.rede, 'youtube');
});

test('situacaoPor: agendada -> ao_vivo -> encerrada pelo relógio', () => {
  const { live } = normalizarLive({ titulo: 'L', rede: 'youtube', inicio: '2026-08-21T20:00', duracaoMin: 60 });
  assert.equal(situacaoPor(live, new Date('2026-08-21T19:00')), 'agendada');
  assert.equal(situacaoPor(live, new Date('2026-08-21T20:30')), 'ao_vivo');
  assert.equal(situacaoPor(live, new Date('2026-08-21T22:00')), 'encerrada');
});

test('proximas: só as agendadas, mais próxima primeiro', () => {
  const a = normalizarLive({ titulo: 'A', rede: 'youtube', inicio: '2026-08-25T20:00' }).live;
  const b = normalizarLive({ titulo: 'B', rede: 'tiktok', inicio: '2026-08-22T20:00' }).live;
  assert.deepEqual(proximas([a, b], new Date('2026-08-20T00:00')).map((l) => l.titulo), ['B', 'A']);
});

test('fechamentoLive: retenção e ganho por hora; sem pico retenção é null', () => {
  const { live } = normalizarLive({ titulo: 'L', rede: 'youtube', inicio: '2026-08-21T20:00', duracaoMin: 120, picoEspectadores: 500, espectadoresMedio: 200, minutosNoAr: 120, doacoes: 'R$ 240,00' });
  const f = fechamentoLive(live);
  assert.equal(f.retencao, 0.4);
  assert.equal(f.ganhoPorHoraCentavos, 12000);
  assert.equal(fechamentoLive({ ...live, picoEspectadores: null }).retencao, null);
});

/* ---------------- cron ---------------- */

test('saneiaIntervalo: limita a faixa útil', () => {
  assert.equal(saneiaIntervalo(0), 15);
  assert.equal(saneiaIntervalo('abc'), 15);
  assert.equal(saneiaIntervalo(5000), 1440);
  assert.equal(saneiaIntervalo(30), 30);
});

test('cronLine: usa */n em minutos e 0 */h quando é hora cheia', () => {
  assert.match(cronLine(15), /^\*\/15 \* \* \* \*/);
  assert.match(cronLine(120), /^0 \*\/2 \* \* \*/);
  assert.match(cronLine(15), /VSinfluenceVarredura/); // marca pra não duplicar ao reagendar
});

test('schtasksArgs: tarefa MINUTE com o intervalo', () => {
  const a = schtasksArgs(20);
  assert.ok(a.includes('/SC') && a.includes('MINUTE'));
  assert.equal(a[a.indexOf('/MO') + 1], '20');
});

/* ---------------- index (store real, diretório temporário) ---------------- */

test('index: cadastra agenda, publica, lança ganho e monta o dashboard', () => {
  const r = cadastrarAgenda([{ rede: 'youtube', dir: process.env.VSINFLUENCE_DIR, horarios: ['09:00'] }]);
  assert.equal(r.ok, true);
  assert.equal(getAgenda().slots.youtube.horarios[0], '09:00');

  registrarPublicacao('youtube', 'antigo.mp4', { ts: 1 });
  assert.equal(lancarGanho({ data: '2026-08-05', fonte: 'publi', valor: 'R$ 100,00' }).ok, true);
  assert.equal(criarCampanha({ nome: 'Agosto', objetivo: 'alcance', inicio: '2026-08-01', fim: '2026-08-31' }).ok, true);
  assert.equal(agendarLive({ titulo: 'Live', rede: 'youtube', inicio: '2026-08-30T20:00' }).ok, true);

  const d = dashboard(new Date(2026, 7, 18, 12, 0));
  assert.equal(d.proximasPublicacoes[0].rede, 'youtube');
  assert.equal(d.ganhosDoMes.centavos, 10000);
  assert.equal(d.campanhasAtivas.length, 1);
  assert.equal(d.proximasLives.length, 1);
});

test('index: agenda inválida não grava nada', () => {
  const antes = JSON.stringify(getAgenda());
  const r = cadastrarAgenda([{ rede: 'orkut', dir: '/x', horarios: ['09:00'] }]);
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(getAgenda()), antes);
});
