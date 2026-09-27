/**
 * Central de integrações (Configurações).
 *
 * O que estes testes seguram: só entram integrações reais do Bolso Cheio (nada
 * de Jira/Redmine/Slack do QA-Gate); cada estado vem com o motivo em
 * português; pagamento em modo teste aparece como tal; o que já funcionou e
 * parou vira "caída" até voltar ou ser dispensado.
 */
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const casa = mkdtempSync(join(tmpdir(), 'integ-iso-'));
process.env.VS_HOME = casa;
process.on('exit', () => { try { rmSync(casa, { recursive: true, force: true }); } catch { /* ja foi */ } });

import assert from 'node:assert/strict';
const I = await import('../engine/vsintegracoes/index.mjs');

const tudoOk = {
  whatsapp: { estado: 'conectado', numero: '553175536010' },
  telegram: { estado: 'conectado', temToken: true, numero: '@loja_bot' },
  pagamento: { nome: 'mercadopago', rotulo: 'Mercado Pago', pronto: true, faltando: [], emProducao: true },
  tiktok: { familias: { open: { autorizado: true, appConfigurado: true }, shop: { autorizado: false, appConfigurado: true } } },
  loja: { publicados: 12 },
  quebragalho: { disponivel: true },
  email: { configurado: true },
  alertas: { responsaveis: 2 },
};

test('só integrações do produto, com estado e motivo', () => {
  const l = I.montar(tudoOk);
  assert.deepEqual(l.map((i) => i.id), ['whatsapp', 'telegram', 'pagamento', 'tiktok', 'instagram', 'loja', 'quebragalho', 'email', 'alertas']);
  assert.ok(!l.some((i) => /jira|redmine|azure|slack|prompt/i.test(i.id + i.nome)), 'nada do QA-Gate');
  assert.equal(l.find((i) => i.id === 'whatsapp').estado, 'ok');
  assert.match(l.find((i) => i.id === 'whatsapp').detalhe, /\+553175536010/);
  const tk = l.find((i) => i.id === 'tiktok');
  assert.equal(tk.estado, 'incompleta');
  assert.match(tk.detalhe, /autorizado: publicar · falta: loja/);
  assert.match(l.find((i) => i.id === 'loja').detalhe, /12 produto/);
});

test('o que falta aparece em português, e modo teste do pagamento é sinalizado', () => {
  const l = I.montar({ whatsapp: { estado: 'aguardando_qr' }, telegram: { temToken: false }, pagamento: { rotulo: 'Mercado Pago', pronto: true, faltando: ['segredo de assinatura do webhook'], emProducao: false }, email: { configurado: false }, alertas: { responsaveis: 1 } });
  assert.match(l.find((i) => i.id === 'whatsapp').detalhe, /QR Code/);
  assert.match(l.find((i) => i.id === 'telegram').detalhe, /@BotFather/);
  const p = l.find((i) => i.id === 'pagamento');
  assert.equal(p.estado, 'incompleta'); assert.equal(p.emTeste, true); assert.match(p.detalhe, /teste \(não move dinheiro\)/);
  assert.match(l.find((i) => i.id === 'email').detalhe, /SMTP_USER/);
  const a = l.find((i) => i.id === 'alertas');
  assert.equal(a.estado, 'incompleta', 'tem responsável mas o WhatsApp não está conectado');
  assert.match(a.detalhe, /o alerta não sai/);
});

test('caída: funcionou, parou → aviso; dispensar cala até voltar', () => {
  const r1 = I.comHistorico(I.montar(tudoOk));
  assert.equal(r1.caidas.length, 0);
  assert.equal(r1.resumo.ok, 7);
  const r2 = I.comHistorico(I.montar({ ...tudoOk, whatsapp: { estado: 'caido', ultimoErro: 'sessão expirou' } }));
  assert.deepEqual(r2.caidas.map((c) => c.id), ['whatsapp', 'alertas'], 'sem WhatsApp o alerta de segurança também não sai');
  assert.equal(r2.itens.find((i) => i.id === 'whatsapp').caiu, true);
  assert.equal(r2.caidas.some((c) => c.id === 'instagram'), false, 'o que nunca funcionou não é "caída"');
  I.dispensar('whatsapp');
  assert.deepEqual(I.comHistorico(I.montar({ ...tudoOk, whatsapp: { estado: 'caido' } })).caidas.map((c) => c.id), ['alertas'], 'dispensar cala só aquela');
  I.comHistorico(I.montar(tudoOk)); // voltou: dispensa sai
  assert.ok(I.comHistorico(I.montar({ ...tudoOk, whatsapp: { estado: 'caido' } })).caidas.some((c) => c.id === 'whatsapp'), 'caiu de novo: avisa de novo');
});
