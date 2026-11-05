/**
 * Canal do salão pela Evolution API (NÃO oficial, 20/10): cumpre o contrato,
 * conecta por QR e vira 'open', entra pelo webhook (messages.upsert) como
 * mensagem canônica, responde por sendText, e ignora grupo/eco/reentrega/velha.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validarProvider } from '../engine/canais/provider.mjs';
import { criarWhatsAppEvolutionProvider } from '../engine/canais/whatsapp-evolution/index.mjs';

function fakeEvolution() {
  const chamadas = [];
  const estado = { state: 'connecting' };          // o teste vira pra 'open' quando quiser
  const fetchImpl = async (url, o = {}) => {
    chamadas.push({ url, method: o.method || 'GET', body: o.body });
    const ok = (j) => ({ ok: true, status: 200, json: async () => j });
    if (url.endsWith('/instance/create')) { return ok({ instance: { instanceName: 'cadevc-x' } }); }
    if (url.includes('/instance/connect/')) { return ok({ base64: 'iVBORw0KGgo=', code: 'QRCODE' }); }
    if (url.includes('/instance/connectionState/')) { return ok({ instance: { state: estado.state } }); }
    if (url.includes('/instance/fetchInstances')) { return ok([{ instance: { owner: '5531975127978@s.whatsapp.net' } }]); }
    if (url.includes('/message/sendText/')) { return ok({ key: { id: 'EVO1' } }); }
    if (url.includes('/message/sendMedia/')) { return ok({ key: { id: 'EVO2' } }); }
    if (url.includes('/chat/updateProfilePicture/')) { return ok({}); }
    return { ok: false, status: 400, json: async () => ({ message: 'rota falsa' }) };
  };
  return { fetchImpl, chamadas, estado };
}

const base = { baseUrl: 'http://evo.local', apiKey: 'k', instance: 'cadevc-x' };
const upsert = (msg, inst = 'cadevc-x') => ({ event: 'messages.upsert', instance: inst, data: msg });
const msgTexto = (id, texto, ts, extra = {}) => ({ key: { remoteJid: '5531975127978@s.whatsapp.net', fromMe: false, id }, pushName: 'Ana', messageTimestamp: ts, message: { conversation: texto }, ...extra });

test('cumpre o contrato e avisa que NÃO é oficial', () => {
  const p = criarWhatsAppEvolutionProvider({ ...base, fetchImpl: fakeEvolution().fetchImpl });
  assert.equal(validarProvider(p).ok, true);
  assert.equal(p.nome, 'whatsapp-web');
  assert.equal(p.status().provider, 'whatsapp-evolution');
  assert.equal(p.oficial, false);
});

test('conecta por QR, vira open e pega o número; só manda conectado', async () => {
  const g = fakeEvolution();
  const p = criarWhatsAppEvolutionProvider({ ...base, fetchImpl: g.fetchImpl });
  assert.equal((await p.enviarTexto({ para: '5531975127978', texto: 'oi' })).ok, false); // desconectado não manda
  const c = await p.conectar();
  assert.equal(c.ok, true);
  assert.equal(c.qr, 'data:image/png;base64,iVBORw0KGgo='); // ainda não leu o QR
  assert.equal(p.status().estado, 'aguardando_qr');
  g.estado.state = 'open';                          // aparelho leu o QR
  await p.sincronizar();
  assert.equal(p.status().estado, 'conectado');
  assert.equal(p.status().numero, '5531975127978');
  assert.equal(p.status().qr, null);
});

test('recebe pelo webhook e responde; ignora eco, grupo, reentrega e velha', async () => {
  const g = fakeEvolution(); g.estado.state = 'open';
  const p = criarWhatsAppEvolutionProvider({ ...base, fetchImpl: g.fetchImpl });
  await p.conectar();
  const recebidas = []; p.aoReceber((m) => recebidas.push(m));
  const ts = Math.floor(Date.now() / 1000);
  assert.equal(p.receberEvento(upsert(msgTexto('m1', 'quero marcar corte', ts))), 1);
  assert.equal(p.receberEvento(upsert(msgTexto('m1', 'quero marcar corte', ts))), 0);                  // reentrega
  assert.equal(p.receberEvento(upsert(msgTexto('m2', 'velha', ts - 3600))), 0);                        // fora da janela
  assert.equal(p.receberEvento(upsert({ key: { remoteJid: '123@g.us', id: 'g1' }, message: { conversation: 'grupo' } })), 0); // grupo
  assert.equal(p.receberEvento(upsert({ key: { remoteJid: '55@s.whatsapp.net', fromMe: true, id: 'e1' }, message: { conversation: 'eco' } })), 0); // fromMe
  assert.equal(p.receberEvento(upsert(msgTexto('m3', 'x', ts), 'OUTRA')), 0);                           // outra instância
  // botão (desmarcar) também vira texto
  assert.equal(p.receberEvento(upsert({ key: { remoteJid: '5531975127978@s.whatsapp.net', id: 'm4' }, messageTimestamp: ts, message: { buttonsResponseMessage: { selectedDisplayText: 'Confirmo' } } })), 1);
  assert.equal(recebidas.length, 2);
  assert.deepEqual([recebidas[0].de, recebidas[0].nome, recebidas[0].texto, recebidas[0].canal], ['5531975127978', 'Ana', 'quero marcar corte', 'whatsapp-web']);
  assert.equal(recebidas[1].texto, 'Confirmo');
  const r = await p.enviarTexto({ para: '5531975127978', texto: 'Marcado!' });
  assert.equal(r.ok, true); assert.equal(r.id, 'EVO1');
  const corpo = JSON.parse(g.chamadas.at(-1).body);
  assert.equal(corpo.number, '5531975127978'); assert.equal(corpo.text, 'Marcado!');
});

test('aceita nome de evento Evolution em maiúsculas com underscore', () => {
  const p = criarWhatsAppEvolutionProvider({ ...base, fetchImpl: fakeEvolution().fetchImpl });
  const recebidas = [];
  p.aoReceber((m) => recebidas.push(m));
  const evento = upsert(msgTexto('m-uppercase', 'quero agendar', Math.floor(Date.now() / 1000)));
  evento.event = 'MESSAGES_UPSERT';
  assert.equal(p.receberEvento(evento), 1);
  assert.equal(recebidas[0].texto, 'quero agendar');
});

test('imagem vai por sendMedia com base64 e legenda', async () => {
  const g = fakeEvolution(); g.estado.state = 'open';
  const p = criarWhatsAppEvolutionProvider({ ...base, fetchImpl: g.fetchImpl });
  await p.conectar();
  const r = await p.enviarImagem({ para: '5531975127978', dataUri: 'data:image/png;base64,iVBORw0KGgo=', legenda: 'Sua agenda' });
  assert.equal(r.ok, true); assert.equal(r.id, 'EVO2');
  const env = JSON.parse(g.chamadas.at(-1).body);
  assert.equal(env.mediatype, 'image'); assert.equal(env.media, 'iVBORw0KGgo='); assert.equal(env.caption, 'Sua agenda');
});

test('troca foto do perfil conectado pela rota oficial da Evolution', async () => {
  const g = fakeEvolution(); g.estado.state = 'open';
  const p = criarWhatsAppEvolutionProvider({ ...base, fetchImpl: g.fetchImpl });
  await p.sincronizar();
  const r = await p.atualizarFotoPerfil('data:image/jpeg;base64,aGVsbG8=');
  assert.deepEqual(r, { ok: true });
  const req = g.chamadas.at(-1);
  assert.equal(req.url, 'http://evo.local/chat/updateProfilePicture/cadevc-x');
  assert.equal(req.method, 'POST');
  assert.deepEqual(JSON.parse(req.body), { picture: 'aGVsbG8=' });
});

test('recusa trocar foto desconectado ou com conteúdo inválido', async () => {
  const p = criarWhatsAppEvolutionProvider({ ...base, fetchImpl: fakeEvolution().fetchImpl });
  await assert.rejects(() => p.atualizarFotoPerfil('data:image/jpeg;base64,aGVsbG8='), /conecte antes/);
  const g = fakeEvolution(); g.estado.state = 'open';
  const conectado = criarWhatsAppEvolutionProvider({ ...base, fetchImpl: g.fetchImpl });
  await conectado.sincronizar();
  await assert.rejects(() => conectado.atualizarFotoPerfil('texto'), /foto JPG, PNG ou WEBP válida/);
});

test('sem baseUrl/apiKey/instance cai com aviso claro', async () => {
  const p = criarWhatsAppEvolutionProvider({ fetchImpl: fakeEvolution().fetchImpl });
  const c = await p.conectar();
  assert.equal(c.ok, false);
  assert.match(c.erro, /ausentes/);
});

test('erro de rede identifica quando o servidor do CRM não alcança o Evolution', async () => {
  const fetchImpl = async () => {
    throw Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' });
  };
  const p = criarWhatsAppEvolutionProvider({ ...base, fetchImpl });
  const c = await p.conectar();
  assert.equal(c.ok, false);
  assert.match(c.erro, /Evolution inacessível \(ECONNREFUSED\)/);
});

test('404 na criação da instância explica que URL ou instância não foi encontrada', async () => {
  const chamadas = [];
  const fetchImpl = async (url) => {
    chamadas.push(url);
    return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
  };
  const p = criarWhatsAppEvolutionProvider({ ...base, fetchImpl });
  const c = await p.conectar();
  assert.equal(c.ok, false);
  assert.match(c.erro, /Evolution POST \/instance\/create: HTTP 404 — Not Found/);
  assert.match(c.erro, /confira a URL base e o nome da instância/);
  assert.equal(chamadas.length, 1, 'não tenta conectar se a criação falhou por erro inesperado');
});

test('não usa o código textual de pareamento como URL de imagem do QR', async () => {
  const fetchImpl = async (url) => {
    const ok = (j) => ({ ok: true, status: 200, json: async () => j });
    if (url.endsWith('/instance/create')) { return ok({}); }
    if (url.includes('/instance/connect/')) { return ok({ code: '2@pairing-code' }); }
    if (url.includes('/instance/connectionState/')) { return ok({ instance: { state: 'connecting' } }); }
    return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
  };
  const p = criarWhatsAppEvolutionProvider({ ...base, fetchImpl });
  const c = await p.conectar();
  assert.equal(c.ok, false);
  assert.equal(c.qr, null);
  assert.match(c.erro, /não retornou a imagem do QR/);
});
