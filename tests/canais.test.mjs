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
import { deveAtender, normalizar, soDigitos, ehLid, pareceTelefone } from '../engine/canais/whatsapp-web/normalizar.mjs';
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

/* ---- a cara do numero (so existe no canal por WhatsApp Web) ---- */

test('personalizar exige canal conectado — e diz o estado, nao um erro seco', async () => {
  const p = criarWhatsAppWebProvider({ criarSessao: libFalsa().criar });
  const r = await p.personalizar({ nome: 'Micaela' });
  assert.equal(r.ok, false);
  assert.match(r.erro, /desconectado/);
});

test('aplica foto, nome e recado no perfil do numero', async () => {
  const lib = libFalsa();
  const chamadas = [];
  const criar = async (cfg) => {
    const c = await lib.criar(cfg);
    c.setProfilePic = async (x) => { chamadas.push(['foto', x]); return true; };
    c.setProfileName = async (x) => { chamadas.push(['nome', x]); return true; };
    c.setProfileStatus = async (x) => { chamadas.push(['recado', x]); };
    return c;
  };
  const p = criarWhatsAppWebProvider({ criarSessao: criar });
  await p.conectar();
  const r = await p.personalizar({ foto: 'data:image/png;base64,AAA', nome: 'Micaela', recado: 'Assistente virtual' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.feito, ['foto', 'nome', 'recado']);
  assert.equal(chamadas.length, 3);
});

test('sucesso PARCIAL e relatado — foto recusada nao pode virar "tudo certo"', async () => {
  const lib = libFalsa();
  const criar = async (cfg) => {
    const c = await lib.criar(cfg);
    c.setProfilePic = async () => { throw new Error('imagem fora do formato aceito'); };
    c.setProfileName = async () => true;
    return c;
  };
  const p = criarWhatsAppWebProvider({ criarSessao: criar });
  await p.conectar();
  const r = await p.personalizar({ foto: 'x', nome: 'Micaela' });
  /* A regra mudou, e a mudanca veio de campo: `ok` agora responde "mudou algo
     no numero?" e `completo` responde "entrou tudo?". Eram a mesma coisa, e com
     `ok:false` no parcial o tradutor generico do servidor transformava a
     resposta inteira em "nao foi possivel concluir" — o dono lia fracasso
     depois de a foto ja estar trocada no celular dele. */
  assert.equal(r.ok, true, 'o nome entrou: algo mudou no numero');
  assert.equal(r.completo, false, 'mas a foto nao entrou, e isso tem de aparecer');
  assert.deepEqual(r.feito, ['nome'], 'o que funcionou tem de aparecer');
  assert.match(r.falhas[0], /foto.*fora do formato/);
});

/* ---- LID: o que quebrou no primeiro teste com telefone de verdade ----
   O WhatsApp entregou o remetente como `...@lid` (identidade que preserva o
   numero, comum em conta Business). O LID PARECE telefone — 15 digitos, so
   numero — e nao e: o bot respondeu pra ele e o cliente nunca recebeu nada. */

test('LID e reconhecido como identificador, nao como telefone', () => {
  assert.equal(ehLid('173916127502499@lid'), true);
  assert.equal(ehLid('5531975127978@c.us'), false);
  assert.equal(pareceTelefone('173916127502499'), false, '15 digitos nao e telefone BR');
  assert.equal(pareceTelefone('5531975127978'), true);
  assert.equal(pareceTelefone('31975127978'), true);
});

test('mensagem com LID: o telefone real e descoberto pelo tradutor da lib', async () => {
  const lib = libFalsa();
  const criar = async (cfg) => {
    const c = await lib.criar(cfg);
    c.getPnLidEntry = async (jid) => {
      assert.equal(jid, '173916127502499@lid');
      return { lid: jid, phoneNumber: '5531975127978@c.us' };
    };
    return c;
  };
  const p = criarWhatsAppWebProvider({ criarSessao: criar });
  const recebidas = [];
  p.aoReceber((m) => recebidas.push(m));
  await p.conectar();
  lib.cbs.onMessage({ id: { id: 'M1' }, from: '173916127502499@lid', type: 'chat', body: 'oi' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(recebidas.length, 1);
  assert.equal(recebidas[0].de, '5531975127978', 'tinha de virar o telefone de verdade');
});

/* A regra mudou, e a mudanca e o conserto:

   ANTES: sem telefone, descarta. Parecia prudente. Na conta nova do WhatsApp o
   remetente vem SO como LID e telefone nao existe em campo nenhum — entao
   "prudente" virou "nao atende ninguem", com cliente esperando do outro lado.

   AGORA: sem telefone, atende do mesmo jeito e responde no endereco de onde a
   mensagem veio. Perde-se a identidade no CRM, nao o atendimento. Calar o
   cliente por falta de um dado de CADASTRO e trocar problema nosso por
   problema dele. */
test('sem telefone, a mensagem VIRA atendimento e a resposta vai pro endereco de origem', async () => {
  const lib = libFalsa();
  const criar = async (cfg) => {
    const c = await lib.criar(cfg);
    c.getPnLidEntry = async () => { throw new Error('nao sei'); };
    return c;
  };
  const p = criarWhatsAppWebProvider({ criarSessao: criar });
  const recebidas = [];
  p.aoReceber((m) => recebidas.push(m));
  await p.conectar();
  lib.cbs.onMessage({ id: { id: 'M2' }, from: '173916127502499@lid', type: 'chat', body: 'oi' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(recebidas.length, 1, 'cliente sem telefone visivel continua sendo cliente');
  assert.equal(recebidas[0].endereco, '173916127502499@lid', 'e pra ELE que se responde');

  const env = await p.enviarTexto({ para: recebidas[0].endereco, texto: 'oi!' });
  assert.equal(env.ok, true);
  assert.equal(lib.enviadas[0].para, '173916127502499@lid', 'jid pronto vai como veio, sem virar @c.us');
});

test('o telefone tambem e achado no contato que veio junto da mensagem', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  const recebidas = [];
  p.aoReceber((m) => recebidas.push(m));
  await p.conectar();
  lib.cbs.onMessage({ id: { id: 'M3' }, from: '999@lid', type: 'chat', body: 'oi', sender: { id: { user: '5531988887777' } } });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(recebidas[0].de, '5531988887777');
});

test('numero solto invalido continua recusado — iniciar conversa exige telefone de verdade', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  await p.conectar();
  // Sem "@": isto e alguem tentando INICIAR conversa por um numero digitado.
  const r = await p.enviarTexto({ para: '173916127502499', texto: 'oi' });
  assert.equal(r.ok, false);
  assert.match(r.erro, /não é um telefone válido/);
  assert.equal(lib.enviadas.length, 0, 'nao podia ter tentado enviar');
});

/* ---- o remetente NUNCA pode ser a gente ----

   Bug de campo, encontrado no log de producao: chegou mensagem de um contato
   real e o sistema registrou "chegou de 553175127978", que e o numero DA
   PROPRIA CONTA conectada. A resposta saiu completa e educada — pra nossa
   propria conversa. Quem escreveu ficou esperando, e o log dizia "respondi".

   A causa era `m.to` na lista de candidatos a remetente: `to` e o
   DESTINATARIO. Quando o remetente vinha como LID e nada mais resolvia, a
   lista caia nele e devolvia a gente mesmo. */

test('LID sem telefone resolvivel NAO vira o nosso proprio numero', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  await p.conectar();

  const recebidas = [];
  p.aoReceber((m) => recebidas.push(m));
  await lib.cbs.onMessage({
    id: 'msg-lid-1',
    from: '173916127502499@lid',
    to: '5531999990000@c.us', // nos
    body: 'oi',
    type: 'chat',
  });

  assert.equal(recebidas.length, 1, 'a conversa acontece pelo endereco, nao pelo telefone');
  assert.notEqual(recebidas[0].de, '5531999990000', 'o NOSSO numero nunca pode virar a identidade do cliente');
  assert.equal(recebidas[0].endereco, '173916127502499@lid', 'responde na conversa de origem');
});

test('mensagem que aponta pra nossa propria conta e descartada', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  await p.conectar();

  const recebidas = [];
  p.aoReceber((m) => recebidas.push(m));
  await lib.cbs.onMessage({
    id: 'msg-lid-2',
    from: '173916127502499@lid',
    chatId: { user: '5531999990000' }, // de novo nos, por outro caminho
    body: 'oi',
    type: 'chat',
  });

  assert.equal(recebidas.length, 1);
  assert.notEqual(recebidas[0].de, '5531999990000', 'cliente nunca escreve do numero que atende');
});

test('LID COM telefone resolvivel passa normal — o conserto nao pode calar quem existe', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  await p.conectar();

  const recebidas = [];
  p.aoReceber((m) => recebidas.push(m));
  await lib.cbs.onMessage({
    id: 'msg-lid-3',
    from: '173916127502499@lid',
    sender: { id: { user: '5531975127978' } },
    to: '5531999990000@c.us',
    body: 'meu boleto venceu',
    type: 'chat',
  });

  assert.equal(recebidas.length, 1);
  assert.equal(recebidas[0].de, '5531975127978');
});

/* ---- desligar e uma ORDEM ----

   Bug de campo: o dono desativou o servico e, 44 segundos depois, a Micaela
   atendeu um cliente real. Fechar a sessao faz a lib emitir o mesmo evento de
   uma queda, e o reconector religava em dois segundos — contra a vontade de
   quem desligou. Nao existe erro mais grave neste modulo: o produto operando
   no numero de alguem que mandou parar. */

test('desconectar NAO pode ser desfeito pelo reconector automatico', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  await p.conectar();
  assert.equal(p.status().estado, ESTADOS.CONECTADO);

  await p.desconectar();
  // A lib avisa a queda DEPOIS do close — foi assim que ele religava sozinho.
  lib.cbs.onStateChange?.('UNPAIRED');
  await new Promise((r) => setTimeout(r, 40));

  assert.equal(p.status().estado, ESTADOS.DESCONECTADO, 'desligado tem de continuar desligado');
});

test('mandar conectar DEPOIS de desligar volta a valer — a ultima ordem manda', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  await p.conectar();
  await p.desconectar();
  await p.conectar();
  assert.equal(p.status().estado, ESTADOS.CONECTADO);
});

test('queda de verdade continua reconectando — o conserto nao pode matar a recuperacao', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar, maxTentativas: 1 });
  await p.conectar();
  lib.cbs.onStateChange?.('CONFLICT');
  assert.equal(p.status().estado, ESTADOS.CAIDO, 'caiu sozinho: aqui o reconector TEM de agir');
  await new Promise((r) => setTimeout(r, 2200));
  assert.equal(p.status().estado, ESTADOS.CONECTADO, 'voltou sozinho');
});

/* ---- quando o dono entra na conversa ----

   Incidente real: o dono estava conversando com um cliente — a pessoa mandando
   telefone, nome, "Mercado pago" — e a Micaela cortou TRES vezes com o menu.
   O cliente viu dois interlocutores falando ao mesmo tempo sobre coisas
   diferentes, e um deles era um robo. Nao ha jeito mais rapido de queimar a
   confianca de quem esta do outro lado. */

test('mensagem que o DONO digita avisa o dominio — nao e mais jogada fora como eco', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  await p.conectar();

  const assumidas = [];
  p.aoDonoEscrever((x) => assumidas.push(x));
  await lib.cbs.onMessage({ id: { id: 'MANUAL1' }, fromMe: true, from: '5531999990000@c.us',
    to: '5531977776666@c.us', body: 'oi, aqui e o Fabiano', type: 'chat' });

  assert.equal(assumidas.length, 1);
  assert.equal(assumidas[0].endereco, '5531977776666@c.us', 'a conversa e com o CLIENTE, nao com a gente');
  assert.equal(assumidas[0].de, '5531977776666');
});

test('o eco da PROPRIA resposta nao conta como o dono digitando', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  await p.conectar();

  const assumidas = [];
  p.aoDonoEscrever((x) => assumidas.push(x));
  const env = await p.enviarTexto({ para: '5531977776666', texto: 'resposta da Micaela' });
  // O WhatsApp devolve o que a gente mesmo mandou, com o mesmo id.
  await lib.cbs.onMessage({ id: { id: env.id }, fromMe: true, from: '5531999990000@c.us',
    to: '5531977776666@c.us', body: 'resposta da Micaela', type: 'chat' });

  assert.equal(assumidas.length, 0, 'senao ela se calaria sozinha a cada resposta que desse');
});

test('mensagem do dono NAO entra como mensagem de cliente', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  await p.conectar();
  const recebidas = [];
  p.aoReceber((m) => recebidas.push(m));
  await lib.cbs.onMessage({ id: { id: 'MANUAL2' }, fromMe: true, from: '5531999990000@c.us',
    to: '5531977776666@c.us', body: 'oi', type: 'chat' });
  assert.equal(recebidas.length, 0);
});

/* ---- a enxurrada da reconexao ----

   Incidente em campo: o canal reconectou e, SETE SEGUNDOS depois, sairam 21
   respostas no mesmo segundo para duas pessoas — 16 para uma delas. O WhatsApp
   entrega todo o historico pendente de uma vez quando a sessao volta, e o bot
   respondeu cada mensagem antiga como se fosse nova. Alem de constrangedor para
   o dono, e o caminho curto pro numero ser bloqueado por spam. */

const agoraSeg = () => Math.floor(Date.now() / 1000);

test('mensagem VELHA nao e respondida — quem escreveu ha uma hora ja seguiu a vida', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  await p.conectar();
  const recebidas = [];
  p.aoReceber((m) => recebidas.push(m));

  await lib.cbs.onMessage({ id: { id: 'VELHA' }, from: '5531977776666@c.us',
    t: agoraSeg() - 3600, body: 'oi', type: 'chat' });

  assert.equal(recebidas.length, 0, 'uma hora atras nao e conversa viva');
});

test('mensagem de agora passa normal — o corte nao pode matar o atendimento', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  await p.conectar();
  const recebidas = [];
  p.aoReceber((m) => recebidas.push(m));

  await lib.cbs.onMessage({ id: { id: 'NOVA' }, from: '5531977776666@c.us',
    t: agoraSeg() - 30, body: 'oi', type: 'chat' });

  assert.equal(recebidas.length, 1);
});

test('mensagem SEM data passa — nao se descarta por falta de informacao nossa', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  await p.conectar();
  const recebidas = [];
  p.aoReceber((m) => recebidas.push(m));

  await lib.cbs.onMessage({ id: { id: 'SEMDATA' }, from: '5531977776666@c.us', body: 'oi', type: 'chat' });
  assert.equal(recebidas.length, 1, 'na duvida, atende: calar cliente por falta de um campo e pior');
});

test('a janela e configuravel — operacao lenta pode querer outra', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar, janelaMinutos: 120 });
  await p.conectar();
  const recebidas = [];
  p.aoReceber((m) => recebidas.push(m));
  await lib.cbs.onMessage({ id: { id: 'UMAHORA' }, from: '5531977776666@c.us',
    t: agoraSeg() - 3600, body: 'oi', type: 'chat' });
  assert.equal(recebidas.length, 1);
});

test('a enxurrada inteira da reconexao e barrada de uma vez', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  await p.conectar();
  const recebidas = [];
  p.aoReceber((m) => recebidas.push(m));

  // Como o WhatsApp entrega: 16 mensagens pendentes de horas atras, de uma vez.
  for (let i = 0; i < 16; i += 1) {
    await lib.cbs.onMessage({ id: { id: `PEND${i}` }, from: '5531977776666@c.us',
      t: agoraSeg() - (600 + i * 60), body: `mensagem ${i}`, type: 'chat' });
  }
  assert.equal(recebidas.length, 0, '16 respostas num segundo e spam, nao atendimento');
});

/* ---- mensagem sem id ----

   Incidente em campo, no teste do proprio cliente com um amigo: as mensagens
   CHEGARAM, o telefone foi resolvido, e o log parou ali. Nenhum "chegou de",
   nenhuma resposta. O WhatsApp entregou as mensagens SEM o campo `id` — visto
   com audio e com encaminhada — e o gateway descartava calado toda mensagem
   sem id, porque usava ele pra evitar responder duas vezes.

   Cliente ignorado por falta de um numero de controle NOSSO e o pior tipo de
   silencio: ele escreveu, chegou, e ninguem respondeu. */

test('mensagem SEM id ainda vira atendimento', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  await p.conectar();
  const recebidas = [];
  p.aoReceber((m) => recebidas.push(m));

  await lib.cbs.onMessage({ from: '5531977776666@c.us', t: Math.floor(Date.now() / 1000),
    body: 'meu boleto venceu', type: 'chat' });

  assert.equal(recebidas.length, 1, 'faltou um campo NOSSO, nao a mensagem do cliente');
  assert.ok(recebidas[0].id, 'tem de sair com alguma identidade');
});

test('a chave inventada REPETE para a mesma mensagem — reentrega nao vira resposta dobrada', async () => {
  const { chaveSintetica } = await import('../engine/canais/whatsapp-web/normalizar.mjs');
  const m = { from: '5531977776666@c.us', t: 1790000000, body: 'oi', type: 'chat' };
  assert.equal(chaveSintetica(m), chaveSintetica({ ...m }));
});

test('mensagens diferentes geram chaves diferentes', async () => {
  const { chaveSintetica } = await import('../engine/canais/whatsapp-web/normalizar.mjs');
  const base = { from: '5531977776666@c.us', t: 1790000000, type: 'chat' };
  assert.notEqual(chaveSintetica({ ...base, body: 'oi' }), chaveSintetica({ ...base, body: 'tchau' }));
  assert.notEqual(chaveSintetica({ ...base, body: 'oi' }), chaveSintetica({ ...base, body: 'oi', t: 1790000001 }));
  assert.notEqual(chaveSintetica({ ...base, body: 'oi' }), chaveSintetica({ ...base, body: 'oi', from: '5531900000000@c.us' }));
});

test('audio sem id e sem corpo tambem passa — e o caso que apareceu em campo', async () => {
  const lib = libFalsa();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  await p.conectar();
  const recebidas = [];
  p.aoReceber((m) => recebidas.push(m));

  await lib.cbs.onMessage({ from: '5531977776666@c.us', t: Math.floor(Date.now() / 1000), type: 'ptt' });
  assert.equal(recebidas.length, 1);
  assert.equal(recebidas[0].tipo, 'audio');
});

/* ---- voltar a cara anterior ----

   "Essa foto vai pro meu perfil ou e so pra mostrar?" — a pergunta do dono
   depois de clicar. Aplicar era automatico e desfazer era tarefa manual no
   celular: meio caminho, e meio caminho deixa a pessoa com medo de clicar nos
   dois. O WhatsApp nao guarda a foto anterior, entao quem tem de guardar somos
   nos, ANTES de escrever por cima. */

function libComPerfil({ conectaDireto = true } = {}) {
  const espiao = libFalsa({ conectaDireto });
  const criarBase = espiao.criar;
  /* Data URI de proposito: depois que o backup passou a guardar BYTES, url
     crua nao e mais o que sai de la — e o duble tem de refletir a realidade,
     senao trava um comportamento que nao existe mais. */
  espiao.perfil = { foto: 'data:image/jpeg;base64,FOTOANTIGA', nome: 'Fabiano', recado: 'no ar' };
  espiao.criar = async (cfg) => {
    const c = await criarBase(cfg);
    c.getProfilePicFromServer = async () => espiao.perfil.foto;
    c.getProfileName = async () => espiao.perfil.nome;
    c.getProfileStatus = async () => espiao.perfil.recado;
    c.setProfilePic = async (v) => { espiao.perfil.foto = v; };
    c.setProfileName = async (v) => { espiao.perfil.nome = v; };
    c.setProfileStatus = async (v) => { espiao.perfil.recado = v; };
    return c;
  };
  return espiao;
}

test('personalizar devolve a cara ANTERIOR junto — e o que permite voltar', async () => {
  const lib = libComPerfil();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  await p.conectar();

  const r = await p.personalizar({ foto: 'data:image/jpeg;base64,MICAELA', nome: 'Micaela' });
  assert.equal(r.ok, true);
  assert.equal(r.completo, true, 'tudo entrou');
  assert.equal(r.anterior.foto, 'data:image/jpeg;base64,FOTOANTIGA');
  assert.equal(r.anterior.nome, 'Fabiano');
  assert.equal(lib.perfil.nome, 'Micaela', 'e a troca aconteceu de verdade');
});

test('a leitura do perfil anterior NAO pode impedir a troca', async () => {
  const lib = libComPerfil();
  const criarBase = lib.criar;
  lib.criar = async (cfg) => {
    const c = await criarBase(cfg);
    c.getProfilePicFromServer = async () => { throw new Error('WhatsApp recusou ler a foto'); };
    return c;
  };
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  await p.conectar();
  const r = await p.personalizar({ nome: 'Micaela' });
  assert.equal(r.ok, true, 'perder o backup e chato; nao poder trocar seria pior');
  assert.equal(lib.perfil.nome, 'Micaela');
});

test('restaurar devolve exatamente o que estava guardado', async () => {
  const lib = libComPerfil();
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  await p.conectar();
  const r = await p.personalizar({ foto: 'data:image/jpeg;base64,MICAELA', nome: 'Micaela', recado: 'assistente' });

  await p.personalizar({ foto: r.anterior.foto, nome: r.anterior.nome, recado: r.anterior.recado });
  assert.equal(lib.perfil.nome, 'Fabiano');
  assert.equal(lib.perfil.foto, 'data:image/jpeg;base64,FOTOANTIGA');
  assert.equal(lib.perfil.recado, 'no ar');
});

test('perfilAtual sem sessao devolve null em vez de estourar', async () => {
  const p = criarWhatsAppWebProvider({ criarSessao: libComPerfil().criar });
  assert.equal(await p.perfilAtual(), null);
});

test('deu certo em PARTE continua sendo ok — o numero mudou', async () => {
  const lib = libComPerfil();
  const criarBase = lib.criar;
  lib.criar = async (cfg) => {
    const c = await criarBase(cfg);
    // Exatamente o que o WhatsApp Web faz hoje: aceita foto, recusa o nome.
    c.setProfileName = async () => { throw new Error('n.functions.setPushname is not a function'); };
    return c;
  };
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  await p.conectar();

  const r = await p.personalizar({ foto: 'data:image/jpeg;base64,MICAELA', nome: 'Micaela' });
  assert.equal(r.ok, true, 'a foto ENTROU: dizer que falhou seria mentir em cima de sucesso');
  assert.equal(r.completo, false, 'mas nem tudo entrou, e isso precisa aparecer');
  assert.deepEqual(r.feito, ['foto']);
  assert.match(r.falhas.join(' '), /nome/);
});

test('quando NADA entra, ok e false de verdade', async () => {
  const lib = libComPerfil();
  const criarBase = lib.criar;
  lib.criar = async (cfg) => {
    const c = await criarBase(cfg);
    c.setProfilePic = async () => { throw new Error('foto invalida'); };
    return c;
  };
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  await p.conectar();
  const r = await p.personalizar({ foto: 'data:image/jpeg;base64,X' });
  assert.equal(r.ok, false);
  assert.equal(r.completo, false);
});

test('a foto do backup e guardada como IMAGEM, nao como url', async () => {
  const lib = libComPerfil();
  const criarBase = lib.criar;
  lib.criar = async (cfg) => {
    const c = await criarBase(cfg);
    // E assim que a lib devolve de verdade: um objeto com a url.
    c.getProfilePicFromServer = async () => ({ eurl: 'https://pps.whatsapp.net/v/t61/foto.jpg' });
    return c;
  };
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  await p.conectar();

  const antesFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => 'image/jpeg' },
    arrayBuffer: async () => new TextEncoder().encode('BYTESDAFOTO').buffer,
  });
  try {
    const r = await p.personalizar({ nome: 'Micaela' });
    assert.match(r.anterior.foto, /^data:image\/jpeg;base64,/,
      'guardar a url daria um backup que nao restaura — e a url da Meta ainda expira');
  } finally { globalThis.fetch = antesFetch; }
});

test('se a foto nao baixar, o backup guarda o resto em vez de nada', async () => {
  const lib = libComPerfil();
  const criarBase = lib.criar;
  lib.criar = async (cfg) => {
    const c = await criarBase(cfg);
    c.getProfilePicFromServer = async () => ({ eurl: 'https://pps.whatsapp.net/v/t61/foto.jpg' });
    return c;
  };
  const p = criarWhatsAppWebProvider({ criarSessao: lib.criar });
  await p.conectar();

  const antesFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('rede caiu'); };
  try {
    const r = await p.personalizar({ nome: 'Micaela' });
    assert.equal(r.anterior.foto, null);
    assert.equal(r.anterior.nome, 'Fabiano', 'nome e recado continuam salvos');
  } finally { globalThis.fetch = antesFetch; }
});
