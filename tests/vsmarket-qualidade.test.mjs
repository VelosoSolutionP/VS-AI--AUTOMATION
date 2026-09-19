import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  abrirIncidente, mover, podeIr, viraStrike, strikesDe, avaliarPolitica,
  reputacaoCliente, POLITICA_PADRAO, SEVERIDADES, ORIGENS,
} from '../engine/vsmarket/qualidade.mjs';

const dir = mkdtempSync(join(tmpdir(), 'qg-qua-'));
process.env.VSMARKET_DIR = dir;
const vs = await import('../engine/vsmarket/index.mjs');
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

const base = { alvoTipo: 'prestador', alvoId: 'p1', severidade: 'HIGH', origem: 'NO_SHOW',
  descricao: 'Combinou às 9h e não apareceu, sem avisar o cliente.' };

test('incidente exige severidade, origem, alvo e descricao com conteudo', () => {
  assert.ok(abrirIncidente({}).erros.length >= 3);
  assert.ok(abrirIncidente({ ...base, severidade: 'GRAVISSIMO' }).erros.some((e) => /severidade inválida/.test(e)));
  assert.ok(abrirIncidente({ ...base, origem: 'CHATICE' }).erros.some((e) => /origem desconhecida/.test(e)));
  assert.ok(abrirIncidente({ ...base, descricao: 'ruim' }).erros.some((e) => /detalhe/.test(e)));
  assert.deepEqual(abrirIncidente(base).erros, []);
});

test('incidente NASCE aberto — quem reclama nao confirma nada', () => {
  assert.equal(abrirIncidente(base).incidente.estado, 'INCIDENT_OPEN');
});

test('o CLIENTE tambem pode ser alvo (§23) — nao se assume que ele sempre tem razao', () => {
  const r = abrirIncidente({ ...base, alvoTipo: 'cliente', origem: 'FRAUD' });
  assert.deepEqual(r.erros, []);
  assert.equal(r.incidente.alvoTipo, 'cliente');
  assert.ok(abrirIncidente({ ...base, alvoTipo: 'gato' }).erros.some((e) => /prestador ou cliente/.test(e)));
});

test('nao da pra pular direto de ABERTO para FINAL', () => {
  assert.equal(podeIr('INCIDENT_OPEN', 'FINAL').ok, false);
  assert.equal(podeIr('INCIDENT_OPEN', 'UNDER_ANALYSIS').ok, true);
  assert.equal(podeIr('CONFIRMED', 'FINAL').ok, true);
});

test('confirmar, descartar ou finalizar EXIGE justificativa', () => {
  const i = abrirIncidente(base).incidente;
  const analise = mover(i, 'UNDER_ANALYSIS').incidente;
  assert.match(mover(analise, 'CONFIRMED', {}).erro, /exige justificativa/);
  const conf = mover(analise, 'CONFIRMED', { justificativa: 'Cliente enviou print da conversa.' });
  assert.equal(conf.erro, null);
  assert.equal(conf.incidente.historico.at(-1).justificativa, 'Cliente enviou print da conversa.');
});

test('so incidente FINAL e GRAVE vira strike', () => {
  const i = abrirIncidente(base).incidente;
  assert.equal(viraStrike(i), false, 'aberto nao é strike');
  assert.equal(viraStrike({ ...i, estado: 'CONFIRMED' }), false, 'confirmado ainda cabe recurso');
  assert.equal(viraStrike({ ...i, estado: 'FINAL' }), true);
  assert.equal(viraStrike({ ...i, estado: 'FINAL', severidade: 'LOW' }), false, 'leve nao vira strike');
});

test('strike velho sai da janela — punicao nao é eterna', () => {
  const agora = Date.parse('2026-09-19T12:00:00Z');
  const antigo = { alvoId: 'p1', estado: 'FINAL', severidade: 'HIGH', criadoEm: '2025-01-01T00:00:00Z' };
  const novo = { alvoId: 'p1', estado: 'FINAL', severidade: 'HIGH', criadoEm: '2026-09-01T00:00:00Z' };
  assert.equal(strikesDe([antigo, novo], 'p1', POLITICA_PADRAO, agora).length, 1);
});

test('AVALIACAO RUIM NAO É INFRACAO — nota baixa nao vira strike', () => {
  const r = avaliarPolitica({
    incidentes: [],
    avaliacoes: Array.from({ length: 12 }, () => ({ prestadorId: 'p1', estrelas: 1 })),
    alvoId: 'p1',
  });
  assert.equal(r.strikes, 0, 'nota baixa nao pode virar strike');
  assert.ok(r.gatilhos.every((g) => g.sugestao !== 'desativacao'), 'nota baixa nao desativa');
});

test('a politica SINALIZA mas NAO aplica enquanto nao houver aprovacao juridica', () => {
  const graves = [1, 2].map((n) => ({ alvoId: 'p1', estado: 'FINAL', severidade: 'HIGH', criadoEm: new Date().toISOString(), id: 'i' + n }));
  const r = avaliarPolitica({ incidentes: graves, avaliacoes: [], alvoId: 'p1' });
  assert.equal(r.disparou, true);
  assert.equal(r.aplicavel, false, 'a politica padrao NAO é aprovada');
  assert.match(r.recomendacao, /não foi aprovada juridicamente/);
});

test('com aprovacao registrada, a recomendacao passa a existir', () => {
  const graves = [1, 2].map((n) => ({ alvoId: 'p1', estado: 'FINAL', severidade: 'HIGH', criadoEm: new Date().toISOString(), id: 'i' + n }));
  const r = avaliarPolitica({
    incidentes: graves, avaliacoes: [], alvoId: 'p1',
    politica: { ...POLITICA_PADRAO, aprovadaPorJuridico: true },
  });
  assert.equal(r.aplicavel, true);
  assert.equal(r.recomendacao, 'desativacao');
});

test('marcar a politica como aprovada exige registrar QUEM aprovou', () => {
  assert.match(vs.fluxo.definirPolitica({ aprovadaPorJuridico: true }).erro, /registre QUEM aprovou/);
  assert.equal(vs.fluxo.definirPolitica({ aprovadaPorJuridico: true, aprovadoPor: 'dra. fulana' }).ok, true);
  assert.equal(vs.fluxo.politica().aprovadaPorJuridico, true);
});

test('reputacao do cliente conta so o que foi APURADO — reclamar nao é infracao', () => {
  const inc = [
    { alvoTipo: 'cliente', alvoId: 'c1', estado: 'FINAL', origem: 'FRAUD' },
    { alvoTipo: 'cliente', alvoId: 'c1', estado: 'INCIDENT_OPEN', origem: 'FRAUD' },
    { alvoTipo: 'prestador', alvoId: 'c1', estado: 'FINAL', origem: 'NO_SHOW' },
  ];
  const r = reputacaoCliente(inc, 'c1');
  assert.equal(r.incidentesConfirmados, 1, 'so o FINAL do cliente conta');
});

test('resultado de contestacao SUGERE incidente, nao abre sozinho', () => {
  const s = vs.fluxo.sugerirIncidenteDaDisputa('inexistente');
  assert.equal(s.ok, false);
});

test('o fluxo grava e move incidente pelo caminho validado', () => {
  const a = vs.fluxo.abrirIncidente(base);
  assert.equal(a.ok, true);
  assert.match(vs.fluxo.moverIncidente(a.incidente.id, 'FINAL', { justificativa: 'x' }).erro, /não dá pra ir/);
  vs.fluxo.moverIncidente(a.incidente.id, 'UNDER_ANALYSIS', {});
  vs.fluxo.moverIncidente(a.incidente.id, 'CONFIRMED', { justificativa: 'Evidências conferem.' });
  const f = vs.fluxo.moverIncidente(a.incidente.id, 'FINAL', { justificativa: 'Recurso não apresentado.' });
  assert.equal(f.ok, true);
  assert.equal(f.virouStrike, true);
});

test('todas as severidades e origens do catalogo sao aceitas', () => {
  for (const sev of SEVERIDADES) { assert.deepEqual(abrirIncidente({ ...base, severidade: sev }).erros, []); }
  for (const o of ORIGENS) { assert.deepEqual(abrirIncidente({ ...base, origem: o }).erros, []); }
});
