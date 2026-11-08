/**
 * Canais universais (Evolution): vários números, cada um com sua IA-ZEST
 * homologada; troca de IA preserva histórico; webhook isolado por empresa;
 * identidade do WhatsApp vinda do Hotel. E a regra do salão (Cadê Você).
 * Evolution e Ollama são dublês aqui; o teste real é feito contra o servidor.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const casaTeste = mkdtempSync(join(tmpdir(), 'canais-evo-'));
process.env.VS_HOME = casaTeste;
delete process.env.VSCRM_DIR;
mkdirSync(join(casaTeste, 'console'), { recursive: true });
writeFileSync(join(casaTeste, 'console', 'canais.json'), JSON.stringify({ evolutionUrl: 'http://evo.teste', evolutionKey: 'chave-canais', webhookSegredo: 'segredo-123' }));
process.on('exit', () => { try { rmSync(casaTeste, { recursive: true, force: true }); } catch { /* ok */ } });

const { comEmpresa } = await import('../engine/casa.mjs');
const { save, load } = await import('../engine/vscrm/store.mjs');
const hotel = await import('../engine/vs0007/bots.mjs');
const mapa = await import('../engine/vs0007/mapa.mjs');
const canais = await import('../engine/vscanais/evolution.mjs');
const salao = await import('../engine/vssalao/ias.mjs');

/* ── dublês ── */
const chamadas = [];
const estados = new Map();   // instancia -> 'open' | 'close'
function resposta(status, corpo) { return { ok: status < 400, status, json: async () => corpo, text: async () => JSON.stringify(corpo), headers: { get: () => null } }; }
async function fetchFalso(url, opts = {}) {
  const u = new URL(url);
  const corpo = opts.body ? JSON.parse(opts.body) : null;
  chamadas.push({ metodo: opts.method || 'GET', caminho: u.pathname, corpo, apikey: opts.headers?.apikey });
  if (u.host === '127.0.0.1:11434') {
    const sistema = corpo.messages[0].content;
    const nome = /Você é ([^,\n]+)/.exec(sistema)?.[1];
    return resposta(200, { message: { content: `[${nome}] resposta com base no conhecimento` } });
  }
  if (opts.headers?.apikey !== 'chave-canais') return resposta(401, { message: 'apikey errada' });
  const [, grupo, acao, inst] = u.pathname.split('/');
  if (grupo === 'instance' && acao === 'create') {
    if (estados.has(corpo.instanceName)) return resposta(403, { response: { message: [`This name "${corpo.instanceName}" is already in use.`] } });
    estados.set(corpo.instanceName, 'connecting'); return resposta(201, { instance: { instanceName: corpo.instanceName }, qrcode: { base64: 'data:image/png;base64,QRREAL' } });
  }
  if (grupo === 'instance' && acao === 'connect') return resposta(200, { base64: 'data:image/png;base64,QRREAL' });
  if (grupo === 'instance' && acao === 'connectionState') {
    const nome = decodeURIComponent(inst);
    if (!estados.has(nome)) return resposta(404, { status: 404, error: 'Not Found', response: { message: [`The "${nome}" instance does not exist`] } });
    return resposta(200, { instance: { state: estados.get(nome) } });
  }
  if (grupo === 'instance' && acao === 'fetchInstances') return resposta(200, [{ ownerJid: '5531911112222@s.whatsapp.net' }]);
  if (grupo === 'instance' && acao === 'logout') { estados.set(decodeURIComponent(inst), 'close'); return resposta(200, {}); }
  if (grupo === 'instance' && acao === 'delete') {
    /* Igual à v2.3.7 real: com a sessão aberta o delete responde 400. */
    if (estados.get(decodeURIComponent(inst)) === 'open') return resposta(400, { status: 400, error: 'Bad Request', response: { message: ['[object Object]'] } });
    estados.delete(decodeURIComponent(inst)); return resposta(200, {});
  }
  if (grupo === 'webhook' && acao === 'set') return resposta(201, {});
  if (grupo === 'message' && acao === 'sendText') return resposta(201, { key: { id: `env-${chamadas.length}` } });
  if (grupo === 'chat' && ['updateProfileName', 'updateProfileStatus', 'updateProfilePicture'].includes(acao)) return resposta(200, { ok: true });
  return resposta(404, { message: `Cannot ${opts.method} ${u.pathname}` });
}
canais._usarFetch(fetchFalso);
let reinicios = 0;
canais._usarReinicio(async () => { reinicios++; });
process.env.CANAIS_ESPERA_REINICIO_MS = '0';

/* ── IAs homologadas no Hotel (só montagem de dados de teste) ── */
function iaHomologada({ id, nome, especialidade, profissao = 'atendente', conhecimento, foto = '' }) {
  const bots = load(hotel.DATASET_BOTS, []);
  bots.push({
    agenteId: id, nome, especialidade, finalidade: `Atender clientes de ${especialidade}`, profissao, estado: 'homologado',
    perfil: { foto, funcao: `Atendente de ${especialidade}`, persona: 'Cordial', mensagemInicial: `Olá! Sou ${nome}.`, mensagemFallback: 'Vou chamar a equipe.', regrasAdicionais: [] },
  });
  save(hotel.DATASET_BOTS, bots);
  const no = mapa.adicionarNo({ agenteId: id, categoria: 'conhecimento', conteudo: conhecimento, estado: 'descoberto', origem: 'teste', evidencia: '{}' });
  mapa.transicionarNo(no.no.id, 'homologado', { autorizado: true });
}
const evento = (instancia, de, texto, id) => ({ event: 'messages.upsert', instance: instancia, data: { key: { id, remoteJid: `${de}@s.whatsapp.net`, fromMe: false }, message: { conversation: texto }, messageTimestamp: Math.floor(Date.now() / 1000) } });

const EMPRESA_A = '11222333000181';
const EMPRESA_B = '44555666000199';
comEmpresa(EMPRESA_A, () => {
  iaHomologada({ id: 'ia-faxina', nome: 'Clara', especialidade: 'Manicure', conhecimento: 'Faxina completa leva 4 horas', foto: 'data:image/jpeg;base64,QUJD' });
  iaHomologada({ id: 'ia-pizza', nome: 'Beppe', especialidade: 'Barbearia', conhecimento: 'Entrega até 40 minutos' });
});
comEmpresa(EMPRESA_B, () => iaHomologada({ id: 'ia-b', nome: 'Bia', especialidade: 'Sobrancelhas', conhecimento: 'Revisão em 1 dia' }));

test('cadastra vários números, vincula IAs diferentes e gera o QR de cada um pela Evolution', async () => {
  await comEmpresa(EMPRESA_A, async () => {
    const vendas = canais.cadastrar({ rotulo: 'Vendas', numeroPrevisto: '5531911112222' });
    const pedidos = canais.cadastrar({ rotulo: 'Pedidos' });
    assert.equal(vendas.ok, true); assert.equal(pedidos.ok, true);
    assert.match(canais.cadastrar({ rotulo: 'vendas' }).erro, /já existe/);
    assert.equal(canais.vincularIA({ id: vendas.numero.id, agenteId: 'ia-faxina' }).ok, true);
    assert.equal(canais.vincularIA({ id: pedidos.numero.id, agenteId: 'ia-pizza' }).ok, true);
    assert.match(canais.vincularIA({ id: pedidos.numero.id, agenteId: 'ia-b' }).erro, /não encontrada/, 'IA de outra empresa não aparece');
    const r = await canais.conectar({ id: vendas.numero.id });
    assert.equal(r.qr, 'data:image/png;base64,QRREAL');
    assert.equal(r.webhook.ok, true);
    /* Uma sessão só: instância nova não recebe connect depois do create. */
    assert.equal(chamadas.filter((c) => c.caminho === `/instance/connect/${vendas.numero.instancia}`).length, 0);
    /* Conectar de novo com a instância já aberta não abre outra sessão. */
    estados.set(vendas.numero.instancia, 'open');
    const deNovo = await canais.conectar({ id: vendas.numero.id });
    assert.equal(deNovo.estado, 'conectado');
    assert.equal(chamadas.filter((c) => c.caminho === `/instance/connect/${vendas.numero.instancia}`).length, 0);
    estados.set(vendas.numero.instancia, 'connecting');
    const hook = chamadas.find((c) => c.caminho === `/webhook/set/${vendas.numero.instancia}`);
    assert.match(hook.corpo.webhook.url, /\/webhook\/canais\?k=segredo-123$/);
    assert.deepEqual(hook.corpo.webhook.events, ['MESSAGES_UPSERT', 'QRCODE_UPDATED']);
    assert.equal(canais.listar().length, 2);
    assert.notEqual(vendas.numero.instancia, pedidos.numero.instancia);
    assert.ok(vendas.numero.instancia.startsWith(`zest-${EMPRESA_A}-`));
  });
});

test('cada número responde com a sua IA; trocar a IA preserva o histórico', async () => {
  await comEmpresa(EMPRESA_A, async () => {
    const [vendas, pedidos] = canais.listar();
    estados.set(vendas.instancia, 'open'); estados.set(pedidos.instancia, 'open');
    const r1 = await canais.receberWebhook(evento(vendas.instancia, '5531999990001', 'quanto tempo leva a faxina?', 'm1'), { segredo: 'segredo-123' });
    assert.equal(r1.ok, true); assert.equal(r1.mensagens, 1);
    assert.equal(r1.resultados[0].ia, 'ia-faxina');
    assert.deepEqual(r1.resultados[0].envios.map((e) => e.origem), ['mensagem-inicial', 'ia']);
    assert.match(r1.resultados[0].envios[1].texto, /\[Clara\]/);
    const r2 = await canais.receberWebhook(evento(pedidos.instancia, '5531999990001', 'demora a entrega?', 'm2'), { segredo: 'segredo-123' });
    assert.equal(r2.resultados[0].ia, 'ia-pizza');
    assert.match(r2.resultados[0].envios.at(-1).texto, /\[Beppe\]/);
    /* O prompt da IA leva o conhecimento homologado dela, não o da outra. */
    const prompts = chamadas.filter((c) => c.caminho === '/api/chat').map((c) => c.corpo.messages[0].content);
    assert.ok(prompts[0].includes('Faxina completa leva 4 horas') && !prompts[0].includes('Entrega até 40'));
    assert.ok(prompts[1].includes('Entrega até 40 minutos') && !prompts[1].includes('Faxina completa'));

    assert.equal(canais.vincularIA({ id: vendas.id, agenteId: 'ia-pizza' }).alterado, true);
    const r3 = await canais.receberWebhook(evento(vendas.instancia, '5531999990001', 'e agora?', 'm3'), { segredo: 'segredo-123' });
    assert.equal(r3.resultados[0].ia, 'ia-pizza');
    assert.deepEqual(r3.resultados[0].envios.map((e) => e.origem), ['mensagem-inicial', 'ia'], 'IA nova se apresenta');
    const promptTroca = chamadas.filter((c) => c.caminho === '/api/chat').at(-1).corpo.messages;
    assert.equal(promptTroca.some((x) => /faxina\?/.test(x.content)), false, 'não herda a conversa da IA anterior');
    const conversa = canais.conversas({ id: vendas.id })[0];
    assert.equal(conversa.mensagens.length, 6, 'histórico da IA anterior continua');
    assert.deepEqual([...new Set(conversa.mensagens.map((m) => m.iaId))], ['ia-faxina', 'ia-pizza']);
    assert.equal(canais.listar()[0].vinculos.length, 2);
    /* Mensagem repetida (mesmo id) não gera segunda resposta. */
    const rep = await canais.receberWebhook(evento(vendas.instancia, '5531999990001', 'e agora?', 'm3'), { segredo: 'segredo-123' });
    assert.equal(rep.mensagens, 0);
  });
});

test('webhook exige segredo e não cruza empresas', async () => {
  const instA = comEmpresa(EMPRESA_A, () => canais.listar()[0].instancia);
  assert.equal((await canais.receberWebhook(evento(instA, '5531999990002', 'oi', 'x1'), { segredo: 'errado' })).ok, false);
  /* Instância forjada com o id do número da empresa A, mas o CNPJ da B. */
  const forjada = instA.replace(EMPRESA_A, EMPRESA_B);
  const r = await canais.receberWebhook(evento(forjada, '5531999990002', 'oi', 'x2'), { segredo: 'segredo-123' });
  assert.equal(r.ok, false); assert.match(r.motivo, /não pertence/);
  assert.equal(comEmpresa(EMPRESA_B, () => canais.listar()).length, 0);
  assert.equal((await canais.receberWebhook(evento('salao-teste', '5531999990002', 'oi', 'x3'), { segredo: 'segredo-123' })).ok, false, 'instância do salão não entra nos Canais');
});

test('identidade do WhatsApp vem do Hotel e informa o que a API não altera', async () => {
  await comEmpresa(EMPRESA_A, async () => {
    const pedidos = canais.listar()[1];
    canais.vincularIA({ id: pedidos.id, agenteId: 'ia-faxina' });
    const r = await canais.sincronizarIdentidade({ id: pedidos.id });
    assert.equal(r.ok, true);
    const c = r.identidade.campos;
    assert.equal(c.nome.ok, true); assert.equal(c.recado.ok, true); assert.equal(c.foto.ok, true);
    assert.equal(chamadas.findLast((x) => x.caminho.startsWith('/chat/updateProfilePicture/')).corpo.picture, 'QUJD');
    assert.equal(reinicios, 1, 'foto trocada: reinicia para matar a conexão duplicada');
    const denovo = await canais.sincronizarIdentidade({ id: pedidos.id });
    assert.equal(denovo.identidade.campos.foto.ok, true);
    assert.equal(reinicios, 1, 'mesma foto não reinicia de novo');
    assert.equal(c.descricaoComercial.ok, false);
    const nome = chamadas.findLast((x) => x.caminho.startsWith('/chat/updateProfileName/'));
    assert.equal(nome.corpo.name, 'Clara');
    const semConexao = canais.listar()[0];
    estados.set(semConexao.instancia, 'close');
    canais._usarFetch(fetchFalso);   // providers novos: estado lido de novo da Evolution
    assert.match((await canais.sincronizarIdentidade({ id: semConexao.id })).erro, /conecte o número/);
  });
});

test('remover número apaga a instância na Evolution e guarda as conversas', async () => {
  await comEmpresa(EMPRESA_A, async () => {
    const vendas = canais.listar()[0];
    const r = await canais.remover({ id: vendas.id });
    assert.equal(r.ok, true);
    assert.ok(chamadas.some((c) => c.metodo === 'DELETE' && c.caminho === `/instance/delete/${vendas.instancia}`));
    assert.equal(canais.listar().length, 1);
    assert.equal(canais.conversas({ id: vendas.id }).length, 1);
  });
});

test('salão aceita só IA própria, homologada, de agenda e dos serviços do salão', () => {
  const base = { estado: 'homologado', profissao: 'agenda' };
  assert.equal(salao.avaliarIA({ ...base, nome: 'Lu', especialidade: 'Manicure e pedicure' }).ok, true);
  assert.deepEqual(salao.avaliarIA({ ...base, nome: 'Sol', especialidade: 'Bronzeamento natural' }).servicos, ['bronzeamento']);
  assert.equal(salao.avaliarIA({ ...base, nome: 'Gel', especialidade: 'Unhas de gel' }).ok, true);
  assert.equal(salao.avaliarIA({ ...base, nome: 'Si', especialidade: 'Design de sobrancelhas' }).ok, true);
  assert.match(salao.avaliarIA({ ...base, nome: 'Beppe', especialidade: 'Pizzaria' }).motivo, /outro nicho/);
  assert.deepEqual(salao.avaliarIA({ ...base, nome: 'Bia', especialidade: 'Barbearia' }).servicos, ['barbearia']);
  assert.deepEqual(salao.avaliarIA({ ...base, nome: 'Lia', especialidade: 'Cabeleireiro' }).servicos, ['cabelo']);
  assert.equal(salao.SERVICOS_SALAO.length, 7);
  assert.match(salao.avaliarIA({ ...base, estado: 'em_validacao', nome: 'Lu', especialidade: 'Manicure' }).motivo, /homologada/);
  assert.equal(salao.avaliarIA({ ...base, profissao: 'atendente', nome: 'Lu', especialidade: 'Manicure' }).ok, true, 'IA de manicure do Hotel nasce como atendente');
  assert.match(salao.avaliarIA({ ...base, nome: 'Lu', especialidade: 'Manicure', derivadoDe: { deusaId: 'hera' } }).motivo, /própria/);
  assert.equal(salao.avaliarIA(null).ok, false);
});

test('contato LID: usa o telefone do remoteJidAlt; sem ele responde ao próprio @lid', async () => {
  const { criarWhatsAppEvolutionProvider } = await import('../engine/canais/whatsapp-evolution/index.mjs');
  const enviados = [];
  const prov = criarWhatsAppEvolutionProvider({ baseUrl: 'http://evo.teste', apiKey: 'k', instance: 'i1', fetchImpl: async (url, o) => {
    if (url.includes('connectionState')) return resposta(200, { instance: { state: 'open' } });
    if (url.includes('fetchInstances')) return resposta(200, []);
    if (url.includes('sendText')) { enviados.push(JSON.parse(o.body).number); return resposta(201, { key: { id: 'e' } }); }
    return resposta(404, {});
  } });
  const recebidas = []; prov.aoReceber((m) => recebidas.push(m));
  const ts = Math.floor(Date.now() / 1000);
  prov.receberEvento({ event: 'messages.upsert', instance: 'i1', data: { key: { id: 'l1', remoteJid: '130894144782430@lid', remoteJidAlt: '5531988887777@s.whatsapp.net', fromMe: false }, message: { conversation: 'oi' }, messageTimestamp: ts } });
  prov.receberEvento({ event: 'messages.upsert', instance: 'i1', data: { key: { id: 'l2', remoteJid: '179340671226006@lid', fromMe: false }, message: { conversation: 'oi' }, messageTimestamp: ts } });
  assert.deepEqual(recebidas.map((m) => m.de), ['5531988887777', '179340671226006']);
  assert.deepEqual(recebidas.map((m) => m.endereco), ['5531988887777', '179340671226006@lid']);
  await prov.sincronizar();
  for (const m of recebidas) assert.equal((await prov.enviarTexto({ para: m.endereco, texto: 'olá' })).ok, true);
  assert.deepEqual(enviados, ['5531988887777', '179340671226006@lid']);
});

test('número recém-cadastrado (sem instância na Evolution) aparece desconectado, sem erro', async () => {
  await comEmpresa(EMPRESA_B, async () => {
    const novo = canais.cadastrar({ rotulo: 'Novo' });
    const st = await canais.estado({ id: novo.numero.id });
    assert.equal(st.ok, true);
    assert.equal(st.estado, 'desconectado');
    assert.equal(st.ultimoErro, null);
  });
});

test('cadastro já escolhe a IA; número repetido diz onde vincular', async () => {
  await comEmpresa(EMPRESA_B, async () => {
    const r = canais.cadastrar({ rotulo: 'Oficina', numeroPrevisto: '5531977776666', agenteId: 'ia-b' });
    assert.equal(r.ok, true); assert.equal(r.numero.ia.agenteId, 'ia-b');
    assert.match(canais.cadastrar({ rotulo: 'Outro', numeroPrevisto: '5531977776666' }).erro, /já está cadastrado como "Oficina"/);
    assert.match(canais.cadastrar({ rotulo: 'X', agenteId: 'ia-faxina' }).erro, /não encontrada/);
  });
});

test('apagar sessão apaga a instância na Evolution e mantém cadastro e IA', async () => {
  await comEmpresa(EMPRESA_B, async () => {
    const n = canais.listar().find((x) => x.rotulo === 'Oficina');
    await canais.conectar({ id: n.id });
    estados.set(n.instancia, 'open');
    const r = await canais.apagarSessao({ id: n.id });
    assert.equal(r.ok, true);
    assert.ok(chamadas.some((c) => c.metodo === 'DELETE' && c.caminho === `/instance/delete/${n.instancia}`));
    const depois = canais.listar().find((x) => x.id === n.id);
    assert.equal(depois.ia.agenteId, 'ia-b');
  });
});

test('número conectado com IA recebe a identidade dela sozinho, uma vez', async () => {
  process.env.CANAIS_ESPERA_IDENTIDADE_MS = '0';
  await comEmpresa(EMPRESA_B, async () => {
    const r = canais.cadastrar({ rotulo: 'Auto', agenteId: 'ia-b' });
    await canais.conectar({ id: r.numero.id });
    estados.set(r.numero.instancia, 'open');
    await canais.estado({ id: r.numero.id });
    await new Promise((ok) => { setTimeout(ok, 50); });
    const nomes = () => chamadas.filter((c) => c.caminho === `/chat/updateProfileName/${r.numero.instancia}`);
    assert.equal(nomes().length, 1);
    assert.equal(nomes()[0].corpo.name, 'Bia');
    assert.equal(canais.listar().find((x) => x.id === r.numero.id).identidade.pendente, false);
    await canais.estado({ id: r.numero.id });
    await new Promise((ok) => { setTimeout(ok, 50); });
    assert.equal(nomes().length, 1, 'não repete a cada consulta');
  });
});

test('saudação sai preenchida e só o conhecimento relevante vai ao modelo', async () => {
  const lista = Array.from({ length: 60 }, (_, i) => `assunto-${i}: ${'texto genérico sem relação '.repeat(4)}`);
  lista.push('prazo: a entrega de marmita leva 40 minutos');
  const r = canais.conhecimentoRelevante(lista, 'quanto tempo demora a entrega da marmita?');
  assert.equal(r[0], 'prazo: a entrega de marmita leva 40 minutos');
  assert.ok(r.join('\n').length <= 700);
  await comEmpresa(EMPRESA_B, async () => {
    const bots = load(hotel.DATASET_BOTS, []);
    bots.find((b) => b.agenteId === 'ia-b').perfil.mensagemInicial = '{cumprimento}! Eu sou {nome}.';
    save(hotel.DATASET_BOTS, bots);
    const n = canais.cadastrar({ rotulo: 'Saudacao', agenteId: 'ia-b' }).numero;
    await canais.conectar({ id: n.id });
    estados.set(n.instancia, 'open');
    const rw = await canais.receberWebhook(evento(n.instancia, '5531999990009', 'oi', 's1'), { segredo: 'segredo-123' });
    assert.match(rw.resultados[0].envios[0].texto, /^(Bom dia|Boa tarde|Boa noite)! Eu sou Bia\.$/);
  });
});

test('enquanto aguarda a leitura, a consulta de estado mantém o QR na tela', async () => {
  await comEmpresa(EMPRESA_B, async () => {
    const n = canais.cadastrar({ rotulo: 'QR fixo', agenteId: 'ia-b' }).numero;
    assert.ok((await canais.conectar({ id: n.id })).qr);
    const st = await canais.estado({ id: n.id });
    assert.equal(st.estado, 'aguardando_qr');
    assert.equal(st.qr, 'data:image/png;base64,QRREAL');
    assert.equal(chamadas.filter((c) => c.caminho === `/instance/connect/${n.instancia}`).length, 0, 'consulta de estado nunca abre conexão');
    await canais.receberWebhook({ event: 'qrcode.updated', instance: n.instancia, data: { qrcode: { base64: 'data:image/png;base64,QRNOVO' } } }, { segredo: 'segredo-123' });
    assert.equal((await canais.estado({ id: n.id })).qr, 'data:image/png;base64,QRNOVO');
    /* Instância fechada que sobrou: recria, não usa connect. */
    estados.set(n.instancia, 'close');
    const r = await canais.conectar({ id: n.id });
    assert.equal(r.estado, 'aguardando_qr');
    assert.equal(chamadas.filter((c) => c.caminho === `/instance/connect/${n.instancia}`).length, 0);
  });
});

test('o cadastro assume o número do celular que leu o QR', async () => {
  await comEmpresa(EMPRESA_A, async () => {
    const n = canais.cadastrar({ rotulo: 'Qualquer', numeroPrevisto: '5531900001111' }).numero;
    await canais.conectar({ id: n.id });
    estados.set(n.instancia, 'open');
    await canais.estado({ id: n.id });
    assert.equal(canais.listar().find((x) => x.id === n.id).numeroPrevisto, '5531911112222');
  });
});

test('o número mostrado vem do QR e some ao apagar a sessão', async () => {
  await comEmpresa(EMPRESA_B, async () => {
    const n = canais.cadastrar({ rotulo: 'Sem numero' }).numero;
    await canais.conectar({ id: n.id });
    assert.equal((await canais.estado({ id: n.id })).numero, null);
    estados.set(n.instancia, 'open');
    assert.equal((await canais.estado({ id: n.id })).numero, '5531911112222');
    await canais.apagarSessao({ id: n.id });
    assert.equal(canais.listar().find((x) => x.id === n.id).numeroPrevisto, null);
  });
});

test('Canais é de todo mundo: IA homologada de qualquer nicho entra', () => {
  comEmpresa('99000111000122', () => {
    iaHomologada({ id: 'ia-medica', nome: 'Dra', especialidade: 'Clínica médica', conhecimento: 'x' });
    assert.deepEqual(canais.iasDisponiveis().map((x) => x.agenteId), ['ia-medica']);
    assert.equal(canais.cadastrar({ rotulo: 'Consultório', agenteId: 'ia-medica' }).ok, true);
    assert.equal(salao.avaliarIA(hotel.obterBot('ia-medica')).ok, false, 'no salão essa IA não entra');
  });
});

test('IA de salão precisa dos dados confirmados do Cadê Você', async () => {
  for (const n of ['manicurista', 'Cabeleireira', 'barbeiro', 'design de sobrancelha', 'alongamento de unhas', 'esmalteria', 'bronzeamento natural']) assert.equal(salao.exigeDadosSalao(n), true, n);
  for (const n of ['padaria', 'clínica médica', 'faxina']) assert.equal(salao.exigeDadosSalao(n), false, n);
  assert.match((await salao.validarDadosSistema({ url: '', token: '' })).erro, /URL da API e do token/);
  const ok = async () => ({ ok: true, status: 200, json: async () => ({ cadevc: { nome: 'Studio Lu' } }) });
  assert.deepEqual(await salao.validarDadosSistema({ url: 'https://x/api', token: 'bom', fetchImpl: ok }), { ok: true, salao: 'Studio Lu' });
  const recusa = async () => ({ ok: false, status: 401, json: async () => ({ error: 'token inválido' }) });
  assert.match((await salao.validarDadosSistema({ url: 'https://x/api', token: 'ruim', fetchImpl: recusa })).erro, /não confirmou.*token inválido/);
  comEmpresa('12345678000195', () => {
    iaHomologada({ id: 'ia-lu', nome: 'Lu', especialidade: 'Manicure', conhecimento: 'x' });
    assert.match(salao.avaliarParaUso(hotel.obterBot('ia-lu')).motivo, /sem os dados do Cadê Você/);
    salao.salvarDadosSistema('ia-lu', { url: 'https://x/api/', token: 'segredo-do-salao' });
    assert.equal(salao.avaliarParaUso(hotel.obterBot('ia-lu')).ok, true);
    assert.equal(salao.dadosSistema('ia-lu').url, 'https://x/api');
    assert.equal(JSON.stringify(salao.listarParaSalao()).includes('segredo-do-salao'), false, 'token não vai à tela');
    assert.equal(JSON.stringify(hotel.painel()).includes('segredo-do-salao'), false);
  });
});
