import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Spec §6: "Não fazer fallback silencioso Meta → Mock. Credencial Meta ausente deve
 * gerar erro explícito."
 *
 * Regressão real: com WHATSAPP_PROVIDER=log o sendLicense devolvia ok:true e o /trial
 * respondia entregue:true — sem nada ter saído. O cliente esperava uma chave no
 * WhatsApp que nunca ia chegar.
 *
 * O provider é lido do ambiente na carga do módulo, então cada caso importa com
 * cache-buster na URL pra reler o env.
 */
const carregar = async (provider, extra = {}) => {
  process.env.WHATSAPP_PROVIDER = provider;
  for (const [k, v] of Object.entries(extra)) {
    if (v == null) { delete process.env[k]; } else { process.env[k] = v; }
  }
  return import('../backend/whatsapp.mjs?v=' + Math.random());
};

const LEAD = { phone: '5531975127978', key: 'CHAVE.ASSINADA', name: 'Fabiano', plan: 'trial' };

test('provider log NAO diz que entregou — fica pendente com link manual', async () => {
  const { sendLicense } = await carregar('log');
  const r = await sendLicense(LEAD);
  assert.equal(r.ok, false, 'log nao pode devolver ok:true — nada saiu pela rede');
  assert.equal(r.pendente, true);
  assert.equal(r.provider, 'log');
  assert.match(r.error, /nada foi enviado/);
  assert.match(r.link, /^https:\/\/wa\.me\/5531975127978\?text=/);
});

test('provider ausente cai no log e tambem fica pendente', async () => {
  const { sendLicense } = await carregar(undefined);
  delete process.env.WHATSAPP_PROVIDER;
  const { sendLicense: s2 } = await import('../backend/whatsapp.mjs?v=' + Math.random());
  const r = await s2(LEAD);
  assert.equal(r.ok, false);
  assert.equal(r.pendente, true);
});

test('cloud SEM credencial falha explicito — nao cai pra log fingindo sucesso', async () => {
  const { sendLicense } = await carregar('cloud', { WA_TOKEN: null, WA_PHONE_ID: null });
  const r = await sendLicense(LEAD);
  assert.equal(r.ok, false);
  assert.equal(r.provider, 'cloud', 'nao pode ter virado provider log no meio do caminho');
  assert.match(r.error, /WA_TOKEN\/WA_PHONE_ID ausentes/);
  assert.equal(r.pendente, true);
  assert.ok(r.link, 'ainda devolve o link pro envio manual');
});

test('a chave entra na mensagem do link manual', async () => {
  const { sendLicense } = await carregar('log');
  const r = await sendLicense(LEAD);
  assert.ok(decodeURIComponent(r.link).includes('CHAVE.ASSINADA'));
});

test('telefone com mascara vira so digitos no link', async () => {
  const { sendLicense } = await carregar('log');
  const r = await sendLicense({ ...LEAD, phone: '+55 (31) 97512-7978' });
  assert.match(r.link, /wa\.me\/5531975127978\?/);
});

test('telefone SEM DDI ganha o 55 — era por isso que nao chegava em numero nenhum', async () => {
  const { sendLicense } = await carregar('log');
  const r = await sendLicense({ ...LEAD, phone: '31975127978' });
  assert.match(r.link, /wa\.me\/5531975127978\?/, 'link sem DDI nao abre conversa');
});

/* ---- quem clica durante a reconexao nao pode ouvir "nao esta conectado" ---- */

test('personalizar espera o canal voltar em vez de recusar na cara', async () => {
  const { criarWhatsAppWebProvider } = await import('../engine/canais/whatsapp-web/index.mjs');
  const p = criarWhatsAppWebProvider();
  // Sem sessao aberta o canal esta DESCONECTADO: ai nao ha o que esperar, e a
  // resposta tem de ser a de sempre — pedir pra conectar.
  const r = await p.personalizar({ nome: 'Mica' });
  assert.equal(r.ok, false);
  assert.match(r.erro, /conecte antes|reconectando/);
  assert.notEqual(r.reconectando, true, 'desconectado nao e reconectando — a saida de cada um e outra');
});
