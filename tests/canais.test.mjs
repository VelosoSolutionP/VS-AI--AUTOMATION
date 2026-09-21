/**
 * Canais: contrato, normalização, sessão e gateway.
 *
 * Nada aqui abre navegador, escaneia QR ou toca a rede — a sessão do WPPConnect
 * é injetada. É isso que permite rodar no CI e é o mesmo padrão do `fetchImpl`
 * usado no resto do repo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validarProvider, ESTADOS, mensagem } from '../engine/canais/provider.mjs';
import { deveAtender, normalizar, soDigitos } from '../engine/canais/whatsapp-web/normalizar.mjs';
import { criarWhatsAppWebProvider, matarNavegadorOrfao, ehErroDeAmbiente } from '../engine/canais/whatsapp-web/index.mjs';
import { criarGateway } from '../engine/canais/gateway.mjs';

/* ---- contrato ---- */

test('provider sem um metodo do contrato e RECUSADO no registro', () => {
  const capenga = { nome: 'meia-boca', oficial: false, conectar() {}, status() {} };
  const v = validarProvider(capenga);
  assert.equal(v.ok, false);
  assert.match(v.erro, /falta/);
});

test('provider sem dizer se e oficial e recusado — a tela precisa avisar', () => {
  const p = { nome: 'x', conectar() {}, desconectar() {}, status() {}, saude() {}, enviarTexto() {}, aoReceber() {}, aoMudarStatus() {} };
  assert.match(validarProvider(p).erro, /oficial/);
});

test('o WhatsAppWebProvider cumpre o contrato inteiro', () => {
  assert.equal(validarProvider(criarWhatsAppWebProvider()).ok, true);
});

/* ---- normalizacao ---- */

test('tira o sufixo do jid', () => {
  assert.equal(soDigitos('5531975127978@c.us'), '5531975127978');
});

test('mensagem de texto vira formato canonico', () => {
  const c = normalizar({ id: { id: 'ABC' }, from: '5531975127978@c.us', type: 'chat', body: 'quanto custa?', notifyName: 'Fabiano', timestamp: 1758300000 });
  assert.equal(c.id, 'ABC');
  assert.equal(c.de, '5531975127978');
  assert.equal(c.nome, 'Fabiano');
  assert.equal(c.tipo, 'text');
  assert.equal(c.texto, 'quanto custa?');
  assert.equal(c.canal, 'whatsapp-web');
});

test('legenda de foto entra como texto — e a unica parte respondivel', () => {
  const c = normalizar({ id: { id: 'IMG1' }, from: '5531975127978@c.us', type: 'image', caption: 'quanto custa esse?' });
  assert.equal(c.tipo, 'image');
  assert.equal(c.texto, 'quanto custa esse?');
});

test('audio entra sem texto, mas entra', () => {
  const c = normalizar({ id: { id: 'A1' }, from: '5531975127978@c.us', type: 'ptt' });
  assert.equal(c.tipo, 'audio');
  assert.equal(c.texto, '');
});

/* ---- o que NAO pode virar conversa ---- */

test('a propria resposta voltando (fromMe) e ignorada — senao o bot conversa sozinho', () => {
  const r = deveAtender({ fromMe: true, from: '5531975127978@c.us', type: 'chat', body: 'oi' });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /eco/);
});

test('grupo nao vira atendimento', () => {
  assert.equal(deveAtender({ from: '1234-5678@g.us', type: 'chat', body: 'oi' }).ok, false);
});

test('status/broadcast nao vira atendimento', () => {
  assert.equal(deveAtender({ from: 'status@broadcast', type: 'chat' }).ok, false);
});

test('notificacao de sistema nao vira atendimento', () => {
  assert.equal(deveAtender({ from: '5531975127978@c.us', type: 'e2e_notification' }).ok, false);
});

test('mensagem normal de pessoa passa', () => {
  assert.equal(deveAtender({ from: '5531975127978@c.us', type: 'chat', body: 'oi' }).ok, true);
});

/* ---- sessao, com a lib injetada ---- */

/** Dublê do WPPConnect: guarda os callbacks pra eu disparar quando quiser. */
function libFalsa({ conectaDireto = true } = {}) {
  // `conectado` acompanha a realidade: sessao que mostrou QR NAO esta logada.
  // Com isso sempre true, o duble mentia e escondia o bug do falso CONECTADO.
  const espiao = { enviadas: [], fechada: false, conectado: conectaDireto, cbs: {} };
  espiao.criar = async (cfg) => {
    espiao.cbs.catchQR = cfg.catchQR;
    espiao.cbs.statusFind = cfg.statusFind;
    if (!conectaDireto) { cfg.catchQR('data:image/png;base64,FAKEQR'); }
    return {
      onMessage: (fn) => { espiao.cbs.onMessage = fn; },
      onStateChange: (fn) => { espiao.cbs.onStateChange = fn; },
      getWid: async () => '5531999990000@c.us',
      isConnected: async () => espiao.conectado,
      sendText: async (para, texto) => { espiao.enviadas.push({ para, texto }); return { id: { id: 'OUT1' } }; },
      close: async () => { espiao.fechada = true; },
    };
  };
  return espiao;
}

test('conectar sem sessao salva expoe o QR Code e fica AGUARDANDO_QR', async () => {
  const lib = libFalsa({ conectaDireto: false });
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  let qrRecebido = null;
  await p.conectar({ aoQr: (q) => { qrRecebido = q; } });
  assert.equal(p.status().estado, ESTADOS.AGUARDANDO_QR);
  assert.equal(qrRecebido, 'data:image/png;base64,FAKEQR');
  assert.equal(p.status().qr, 'data:image/png;base64,FAKEQR');
});

test('depois de ler o QR o estado vira CONECTADO e o QR some', async () => {
  const lib = libFalsa({ conectaDireto: false });
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  await p.conectar();
  lib.conectado = true; // a pessoa leu o QR
  lib.cbs.statusFind('qrReadSuccess');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(p.status().estado, ESTADOS.CONECTADO);
  assert.equal(p.status().qr, null, 'QR usado nao pode continuar exposto');
  assert.ok(p.status().desde);
});

test('REGRESSAO: a sequencia real da lib nao pode dar falso CONECTADO', async () => {
  // Observado na sessao de verdade: a lib emite `inChat` ANTES do login. Tratar
  // isso como conectado fazia a tela anunciar CONECTADO com ninguem pareado.
  const lib = libFalsa({ conectaDireto: false });
  lib.conectado = false; // a sessao ainda NAO esta logada
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar, maxTentativas: 0 });
  await p.conectar();
  lib.cbs.statusFind('disconnectedMobile');
  lib.cbs.statusFind('inChat');
  await new Promise((r) => setTimeout(r, 20));
  assert.notEqual(p.status().estado, ESTADOS.CONECTADO, 'inChat antes do login NAO e conexao');
  lib.cbs.statusFind('notLogged');
  assert.equal(p.status().qr, 'data:image/png;base64,FAKEQR', 'o QR tem de continuar valendo');

  // Agora sim: a pessoa leu o QR e a sessao confirma.
  lib.conectado = true;
  lib.cbs.statusFind('qrReadSuccess');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(p.status().estado, ESTADOS.CONECTADO);
  assert.equal(p.status().numero, '5531999990000');
});

test('sessao ja salva conecta direto, sem QR', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  await p.conectar();
  assert.equal(p.status().estado, ESTADOS.CONECTADO);
  assert.equal(p.status().numero, '5531999990000');
});

test('nao envia com o canal desconectado — e diz o motivo', async () => {
  const p = criarWhatsAppWebProvider({ criarSessao: libFalsa().criar });
  const r = await p.enviarTexto({ para: '5531975127978', texto: 'oi' });
  assert.equal(r.ok, false);
  assert.match(r.erro, /desconectado/);
});

test('envia pro jid certo quando conectado', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  await p.conectar();
  const r = await p.enviarTexto({ para: '+55 (31) 97512-7978', texto: 'oi' });
  assert.equal(r.ok, true);
  assert.equal(lib.enviadas[0].para, '5531975127978@c.us', 'telefone tem de sair so com digitos + @c.us');
});

test('queda da sessao vira CAIDO e avisa quem escuta', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar, maxTentativas: 0 });
  const estados = [];
  p.aoMudarStatus((s) => estados.push(s.estado));
  await p.conectar();
  lib.cbs.statusFind('browserClose');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(p.status().estado, ESTADOS.CAIDO);
  assert.ok(estados.includes(ESTADOS.CAIDO));
});

test('health check pergunta pra sessao, nao confia no estado interno', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar, maxTentativas: 0 });
  await p.conectar();
  assert.equal((await p.saude()).ok, true);
  lib.conectado = false; // caiu do lado do celular, ninguem avisou
  const s = await p.saude();
  assert.equal(s.ok, false);
  assert.equal(p.status().estado, ESTADOS.CAIDO, 'o health tem de corrigir o estado mentiroso');
});

test('desconectar fecha a sessao e zera o numero', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  await p.conectar();
  await p.desconectar();
  assert.equal(lib.fechada, true);
  assert.equal(p.status().estado, ESTADOS.DESCONECTADO);
  assert.equal(p.status().numero, null);
});

/* ---- gateway ---- */

test('gateway sem `entregar` nao sobe — canal sem destino e bug silencioso', () => {
  assert.throws(() => criarGateway({}), /entregar/);
});

test('mensagem atravessa o gateway no formato canonico e a resposta volta pelo canal', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  const recebidas = [];
  const g = criarGateway({ entregar: async (m) => { recebidas.push(m); return { responder: 'oi, tudo bem?' }; } });
  g.registrar(p);
  await p.conectar();

  p._receberDireto({ id: { id: 'M1' }, from: '5531975127978@c.us', type: 'chat', body: 'oi', notifyName: 'Fab' });
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(recebidas.length, 1);
  assert.equal(recebidas[0].de, '5531975127978');
  assert.equal(recebidas[0].canal, 'whatsapp-web');
  assert.equal(lib.enviadas.at(-1).texto, 'oi, tudo bem?');
});

test('a MESMA mensagem entregue duas vezes so chega uma vez no dominio', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  let n = 0;
  const g = criarGateway({ entregar: async () => { n += 1; } });
  g.registrar(p);
  await p.conectar();
  const m = { id: { id: 'REPETIDA' }, from: '5531975127978@c.us', type: 'chat', body: 'oi' };
  p._receberDireto(m);
  p._receberDireto(m);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(n, 1);
});

test('dominio que quebra nao derruba o canal', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  const g = criarGateway({ entregar: async () => { throw new Error('dominio explodiu'); } });
  g.registrar(p);
  await p.conectar();
  p._receberDireto({ id: { id: 'M9' }, from: '5531975127978@c.us', type: 'chat', body: 'oi' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(p.status().estado, ESTADOS.CONECTADO, 'o canal tem de continuar de pe');
});

test('nao envia por canal que nao esta registrado', async () => {
  const g = criarGateway({ entregar: async () => {} });
  const r = await g.enviarPor('instagram', { para: '5531975127978', texto: 'oi' });
  assert.equal(r.ok, false);
  assert.match(r.erro, /não registrado/);
});

test('saudeGeral responde por todos os canais registrados', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  const g = criarGateway({ entregar: async () => {} });
  g.registrar(p);
  await p.conectar();
  const s = await g.saudeGeral();
  assert.equal(s.length, 1);
  assert.equal(s[0].nome, 'whatsapp-web');
  assert.equal(s[0].oficial, false, 'a tela precisa poder avisar que nao e API oficial');
  assert.equal(s[0].ok, true);
});

test('o molde canonico so aceita digitos no remetente', () => {
  assert.equal(mensagem({ id: 'x', de: '+55 (31) 97512-7978' }).de, '5531975127978');
});

/* ---- o que quebrou no uso real ----
   Painel derrubado no -9 deixa o Chrome vivo segurando o perfil da sessao. Na
   proxima conexao o WPPConnect recusa e nenhuma reconexao resolve. */

test('navegador orfao da sessao e removido — e so o da pasta certa', () => {
  const chamadas = [];
  const exec = (cmd, args) => {
    chamadas.push([cmd, ...args].join(' '));
    if (cmd === 'pgrep') { return '747287\n747301\n'; }
    return '';
  };
  const r = matarNavegadorOrfao('/app/tokens/veloso', exec);
  assert.equal(r.mortos, 2);
  // sem os dois tracos: com eles o pgrep trata o padrao como opcao dele
  assert.match(chamadas[0], /^pgrep -f user-data-dir=\/app\/tokens\/veloso$/);
  assert.ok(chamadas.includes('kill -9 747287'));
});

test('sem orfao, nao mata ninguem (pgrep sai 1 quando nao acha)', () => {
  const exec = () => { const e = new Error('exit 1'); throw e; };
  assert.equal(matarNavegadorOrfao('/app/tokens/veloso', exec).mortos, 0);
});

test('erro de ambiente NAO entra em laco de reconexao', () => {
  assert.equal(ehErroDeAmbiente('The browser is already running for /app/tokens/veloso'), true);
  assert.equal(ehErroDeAmbiente('Failed to launch the browser process'), true);
  assert.equal(ehErroDeAmbiente('socket hang up'), false, 'queda de rede DEVE reconectar');
});

test('falha de ambiente para quieta, com o motivo na tela, sem gastar tentativa', async () => {
  const p = criarWhatsAppWebProvider({
    criarSessao: async () => { throw new Error('The browser is already running for /app/tokens/veloso'); },
    exec: () => { throw new Error('sem orfao'); },
  });
  await p.conectar();
  const s = p.status();
  assert.equal(s.estado, ESTADOS.CAIDO);
  assert.equal(s.tentativas, 0, 'nao podia ter gastado tentativa de reconexao');
  assert.match(s.ultimoErro, /already running/);
});

test('status NAO usa o campo `erro` — senao o servidor devolve 400 pra um simples status', async () => {
  const p = criarWhatsAppWebProvider({ criarSessao: libFalsa().criar });
  await p.conectar();
  assert.equal('erro' in p.status(), false);
  assert.ok('ultimoErro' in p.status());
});
