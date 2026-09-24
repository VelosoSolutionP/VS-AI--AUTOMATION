/**
 * Segurança de quem atende e de quem é atendido.
 * O que protege: o bot só diz "estou avisando a equipe" quando existe quem
 * avisar; o alerta sai pra cada responsável e o resultado de CADA envio fica
 * na auditoria; tipo desligado não dispara; expressão extra da empresa dispara;
 * telefone configurado vale; moderação respeita as chaves da empresa.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'seguranca-'));
process.env.VSSEGURANCA_DIR = join(dir, 'seg');
process.env.VSBOT_DIR = join(dir, 'bot');
process.env.VSPROTOCOLO_DIR = join(dir, 'proto');
const seg = await import('../engine/vsseguranca/index.mjs');
const emergencia = await import('../engine/vsbot/emergencia.mjs');
const moderacao = await import('../engine/vsbot/moderacao.mjs');
const bot = await import('../engine/vsbot/index.mjs');
const atendimento = await import('../backend/atendimento.mjs');
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('responsavel sem DDD e recusado; com DDD ganha o 55', () => {
  assert.equal(seg.salvarResponsaveis([{ nome: 'Ana', whatsapp: '99999-9999' }]).ok, false);
  assert.match(seg.salvarResponsaveis([{ nome: '', whatsapp: '31999999999' }]).erros[0], /falta o nome/);
  const r = seg.salvarResponsaveis([{ nome: 'Ana', whatsapp: '(31) 99999-9999' }]);
  assert.equal(r.ok, true);
  assert.equal(seg.responsaveis()[0].whatsapp, '5531999999999');
});

test('sem responsavel, ninguem e avisado — e a auditoria diz isso', async () => {
  seg.salvarResponsaveis([]);
  const r = await seg.alertar({ tipo: 'sos', por: 'dono' }, { enviar: async () => ({ ok: true }) });
  assert.equal(r.ok, false);
  assert.equal(seg.auditoria(1)[0].resultado, 'falhou');
  assert.match(seg.auditoria(1)[0].detalhe, /ninguém foi avisado/);
});

test('alerta sai pra cada responsavel; falha de um vira "parcial", com o nome', async () => {
  seg.salvarResponsaveis([{ nome: 'Ana', whatsapp: '31911111111' }, { nome: 'Beto', whatsapp: '31922222222' }]);
  const enviados = [];
  const r = await seg.alertar({ tipo: 'violencia', cliente: 'Maria', trecho: 'socorro' }, {
    enviar: async ({ para, texto }) => { enviados.push({ para, texto }); return para.endsWith('2222') ? { ok: false, erro: 'numero invalido' } : { ok: true }; },
  });
  assert.deepEqual(r.avisados, ['Ana']);
  assert.equal(r.falhas[0].nome, 'Beto');
  assert.match(enviados[0].texto, /PEDIDO DE SOCORRO/);
  assert.match(enviados[0].texto, /Cliente: Maria/);
  const a = seg.auditoria(1)[0];
  assert.equal(a.resultado, 'parcial');
  assert.match(a.detalhe, /NÃO avisado\(s\): Beto \(numero invalido\)/);
});

test('canal fora do ar: falha registrada, nunca "avisei"', async () => {
  const r = await seg.alertar({ tipo: 'teste' }, { enviar: null });
  assert.equal(r.ok, false);
  assert.match(r.falhas[0].erro, /fora do ar/);
});

test('deteccao respeita a empresa: tipo desligado nao dispara, expressao extra dispara, telefone proprio vale', () => {
  assert.equal(emergencia.detectar('socorro', { tipos: { violencia: { ativo: false } } }).emergencia, false);
  const extra = emergencia.detectar('me tira daqui por favor', { termosExtras: { violencia: ['me tira daqui'] } });
  assert.equal(extra.tipo, 'violencia');
  assert.equal(emergencia.detectar('desmaiou aqui', { tipos: { saude: { fone: '193' } } }).fone, '193');
});

test('resposta so promete aviso quando existe quem avisar', () => {
  const s = { tipo: 'violencia' };
  assert.doesNotMatch(emergencia.resposta(s, { avisando: false }), /avisando|avisei/i);
  assert.match(emergencia.resposta(s, { avisando: true, nomeEscritorio: 'Juarez' }), /Estou avisando a equipe da Juarez agora/);
  assert.match(emergencia.resposta(s, { cfg: { tipos: { violencia: { fone: '112' } } } }), /LIGUE 112/);
});

test('bot: socorro com responsavel pede o alerta e registra; sem responsavel nao promete', async () => {
  seg.salvarResponsaveis([{ nome: 'Ana', whatsapp: '31911111111' }]);
  const r = await bot.atender('socorro estão me agredindo', { de: '5531900000001', nome: 'Maria', empresa: 'Juarez' });
  assert.equal(r.tipo, 'emergencia');
  assert.equal(r.alerta.tipo, 'violencia');
  assert.match(r.texto, /Estou avisando a equipe/);
  assert.equal(seg.auditoria(1)[0].tipo, 'emergencia:violencia');
  seg.salvarResponsaveis([]);
  const r2 = await bot.atender('socorro', { de: '5531900000002', nome: 'João' });
  assert.equal(r2.alerta, undefined);
  assert.doesNotMatch(r2.texto, /avisando|avisei/i);
});

test('atendimento manda o alerta com cliente e telefone, junto da resposta', async () => {
  seg.salvarResponsaveis([{ nome: 'Ana', whatsapp: '31911111111' }]);
  bot.salvarConfig({ ativo: true });
  const alertas = [];
  const respostas = [];
  await atendimento.receberMensagem({ id: 'm' + Math.random(), de: '5531900000003', nome: 'Carla', texto: 'vão me matar', tipo: 'texto' },
    { enviar: async ({ texto }) => { respostas.push(texto); return { ok: true }; }, alertar: async (e) => { alertas.push(e); return { ok: true }; } });
  assert.equal(alertas.length, 1);
  assert.equal(alertas[0].cliente, 'Carla');
  assert.equal(alertas[0].telefone, '5531900000003');
  assert.match(respostas[0], /LIGUE 190/);
});

test('moderacao respeita as chaves: assedio desligado segue; texto nao fala de escritorio em outro negocio', () => {
  const cantada = 'me manda uma foto sua';
  assert.equal(moderacao.ehAssedio(cantada), true);
  assert.equal(moderacao.avaliar(cantada, {}, { assedio: false, ofensa: false }).acao, 'segue');
  const r = moderacao.avaliar(cantada, {}, { empresa: 'Juarez Tele-Entrega' });
  assert.match(r.texto, /atendimento da Juarez Tele-Entrega/);
  assert.doesNotMatch(r.texto, /jurídica|escritório/);
  assert.equal(moderacao.avaliar('seu idiota', {}, { ofensa: false }).acao, 'segue');
});

test('sirene: socorro, SOS e URGENTE ficam pendentes ate alguem ver; config e teste nao tocam', () => {
  const a = seg.auditar({ tipo: 'emergencia:saude', detalhe: 'desmaiou' });
  const b = seg.auditar({ tipo: 'sos', detalhe: 'balcao' });
  seg.auditar({ tipo: 'config', detalhe: 'x' });
  seg.auditar({ tipo: 'alerta:teste', detalhe: 'x' });
  const ids = seg.pendentes().map((x) => x.id);
  assert.ok(ids.includes(a.id) && ids.includes(b.id));
  assert.equal(seg.pendentes().some((x) => x.tipo === 'config' || x.tipo === 'alerta:teste'), false);
  const r = seg.reconhecer([a.id, b.id], 'dono@x');
  assert.equal(r.reconhecidos, 2);
  assert.equal(seg.pendentes().some((x) => x.id === a.id || x.id === b.id), false);
  assert.match(seg.auditoria(1)[0].detalhe, /dono@x viu 2 alerta/);
  assert.equal(seg.reconhecer([a.id], 'outro').reconhecidos, 0, 'ver de novo nao registra de novo');
});

test('sirene: ocorrencia de mais de 2h nao toca mais', () => {
  const velho = seg.auditar({ tipo: 'sos', detalhe: 'madrugada' });
  assert.equal(seg.pendentes(Date.now() + 3 * 3600000).some((x) => x.id === velho.id), false);
});
