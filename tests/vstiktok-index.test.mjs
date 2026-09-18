import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// O store le a env na hora da chamada — precisa apontar pro temp ANTES do import.
const dir = mkdtempSync(join(tmpdir(), 'vstiktok-'));
process.env.VSTIKTOK_DIR = dir;

const vs = await import('../engine/vstiktok/index.mjs');
const { filePath } = await import('../engine/vstiktok/store.mjs');

process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

const fake = (corpo, cap = {}) => async (url, opts) => {
  cap.url = url; cap.opts = opts; cap.chamadas = (cap.chamadas || 0) + 1;
  return { status: 200, json: async () => corpo };
};

test('credencial incompleta nao é gravada — evita "configurado" mentiroso na tela', () => {
  const r = vs.salvarCredencial('open', { clientKey: 'ck' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.faltando, ['clientSecret']);
});

test('familia desconhecida é recusada', () => {
  assert.equal(vs.salvarCredencial('orkut', {}).ok, false);
});

test('credencial completa grava e o arquivo nasce com permissao restrita', () => {
  const r = vs.salvarCredencial('open', { clientKey: 'ck', clientSecret: 'cs', redirectUri: 'https://x.com/cb' });
  assert.equal(r.ok, true);
  if (process.platform !== 'win32') {
    assert.equal(statSync(filePath('credenciais')).mode & 0o777, 0o600, 'token/segredo nao pode nascer legivel pra todo mundo');
  }
});

test('diagnostico diz o que falta em vez de so falhar depois', () => {
  const d = vs.diagnostico();
  assert.equal(d.familias.open.appConfigurado, true);
  assert.equal(d.familias.open.autorizado, false);
  assert.deepEqual(d.familias.shop.faltando, ['appKey', 'appSecret']);
  assert.equal(d.pronto.publicar, false);
});

test('autorizacao gera e guarda o state', () => {
  const r = vs.iniciarAutorizacao('open');
  assert.equal(r.ok, true);
  assert.match(r.url, /client_key=ck/);
  assert.equal(vs.getConfig().state_open, r.state);
});

test('callback com state diferente é recusado (pode ser forjado)', async () => {
  const r = await vs.concluirAutorizacao('open', 'CODE', { state: 'outro', fetchImpl: fake({}) });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /state nao confere/);
});

test('callback bom guarda o token e devolve mascarado', async () => {
  const state = vs.getConfig().state_open;
  const r = await vs.concluirAutorizacao('open', 'CODE', {
    state,
    agora: () => Date.parse('2026-09-17T00:00:00.000Z'),
    fetchImpl: fake({ access_token: 'AT-super-secreto-123', refresh_token: 'RT1', expires_in: 86400, open_id: 'OID' }),
  });
  assert.equal(r.ok, true);
  assert.ok(!r.token.accessToken.includes('super-secreto'), 'token nao pode voltar inteiro pra tela');
  assert.equal(vs.getTokens().open.accessToken, 'AT-super-secreto-123');
});

test('diagnostico passa a mostrar autorizado, com prazo em minutos', () => {
  const d = vs.diagnostico(Date.parse('2026-09-17T00:00:00.000Z'));
  assert.equal(d.familias.open.autorizado, true);
  assert.equal(d.familias.open.venceEmMin, 1440);
  assert.equal(d.familias.open.conta, 'OID');
  assert.equal(d.pronto.publicar, true);
});

test('contexto com token valido nao renova nem chama a TikTok', async () => {
  const cap = {};
  const c = await vs.contexto('open', { agora: () => Date.parse('2026-09-17T00:00:00.000Z'), fetchImpl: fake({}, cap) });
  assert.equal(c.ok, true);
  assert.equal(c.renovado, false);
  assert.equal(cap.chamadas, undefined);
  assert.equal(c.ctx.token, 'AT-super-secreto-123');
});

test('token vencido é renovado E REGRAVADO — senao renova a cada chamada', async () => {
  const depois = Date.parse('2026-09-18T00:00:00.000Z');
  const c = await vs.contexto('open', {
    agora: () => depois,
    fetchImpl: fake({ access_token: 'AT-NOVO', refresh_token: 'RT2', expires_in: 86400 }),
  });
  assert.equal(c.ok, true);
  assert.equal(c.renovado, true);
  assert.equal(c.ctx.token, 'AT-NOVO');
  assert.equal(vs.getTokens().open.accessToken, 'AT-NOVO', 'o token novo tem que ficar gravado');
});

test('familia sem credencial do app nao monta contexto', async () => {
  const c = await vs.contexto('shop');
  assert.equal(c.ok, false);
  assert.match(c.motivo, /falta preencher a credencial do app/);
});

test('familia configurada mas nao autorizada manda autorizar', async () => {
  vs.salvarCredencial('business', { appId: '1', secret: 's' });
  const c = await vs.contexto('business');
  assert.equal(c.ok, false);
  assert.equal(c.reautorizar, true);
});
