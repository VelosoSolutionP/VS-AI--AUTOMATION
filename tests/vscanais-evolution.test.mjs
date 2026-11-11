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
process.env.CANAIS_ESPERA_APAGAR_MS ||= '1';
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
const pareadas = new Set();  // instancias que já leram o QR
function resposta(status, corpo) { return { ok: status < 400, status, json: async () => corpo, text: async () => JSON.stringify(corpo), headers: { get: () => null } }; }
async function fetchFalso(url, opts = {}) {
  const u = new URL(url);
  const corpo = opts.body ? JSON.parse(opts.body) : null;
  chamadas.push({ metodo: opts.method || 'GET', host: u.host, caminho: u.pathname, corpo, apikey: opts.headers?.apikey, auth: opts.headers?.authorization });
  if (u.host === '127.0.0.1:11434') {
    const sistema = corpo.messages[0].content;
    const nome = /Você é ([^,\n]+)/.exec(sistema)?.[1];
    if (/desconhecida/.test(corpo.messages.at(-1).content)) return resposta(200, { message: { content: 'Vou chamar a equipe.' } });
    return resposta(200, { message: { content: `[${nome}] resposta com base no conhecimento` } });
  }
  if (u.host.startsWith('agenda')) return resposta(200, { cadevc: { nome: 'Studio' }, regras: {}, servicos: [{ id: 's1', nome: 'Manicure', duracao: 30, preco: 50 }], horarios: [], profissionais: [] });
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
  if (grupo === 'instance' && acao === 'fetchInstances') {
    /* Dono só existe depois de ler o QR (aberta agora ou pareada antes). */
    const nome = u.searchParams.get('instanceName');
    const dono = !nome || estados.get(nome) === 'open' || pareadas.has(nome);
    if (nome && estados.get(nome) === 'open') pareadas.add(nome);
    return resposta(200, [{ ownerJid: dono ? '5531911112222@s.whatsapp.net' : null }]);
  }
  if (grupo === 'instance' && acao === 'logout') { estados.set(decodeURIComponent(inst), 'close'); return resposta(200, {}); }
  if (grupo === 'instance' && acao === 'delete') {
    pareadas.delete(decodeURIComponent(inst));
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
  iaHomologada({ id: 'ia-faxina', nome: 'Clara', especialidade: 'Faxina', conhecimento: 'Faxina completa leva 4 horas', foto: 'data:image/jpeg;base64,QUJD' });
  iaHomologada({ id: 'ia-pizza', nome: 'Beppe', especialidade: 'Pizzaria', conhecimento: 'Entrega até 40 minutos' });
});
comEmpresa(EMPRESA_B, () => iaHomologada({ id: 'ia-b', nome: 'Bia', especialidade: 'Oficina', conhecimento: 'Revisão em 1 dia' }));

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
    const fotos = () => chamadas.filter((x) => x.caminho.startsWith('/chat/updateProfilePicture/')).length;
    const antes = fotos();
    const denovo = await canais.sincronizarIdentidade({ id: pedidos.id });
    assert.equal(denovo.identidade.campos.foto.ok, true);
    assert.equal(fotos(), antes, 'mesma foto não é enviada de novo');
    await canais.sincronizarIdentidade({ id: pedidos.id, forcar: true });
    assert.equal(fotos(), antes + 1, 'botão Sincronizar manda a foto mesmo igual');
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

test('trocar a IA de número conectado manda a nova identidade na hora, mesmo no meio de outra', async () => {
  process.env.CANAIS_ESPERA_IDENTIDADE_MS = '0';
  await comEmpresa(EMPRESA_B, async () => {
    const r = canais.cadastrar({ rotulo: 'Troca', agenteId: 'ia-b' });
    await canais.conectar({ id: r.numero.id });
    estados.set(r.numero.instancia, 'open');
    await canais.estado({ id: r.numero.id });
    await new Promise((ok) => { setTimeout(ok, 50); });
    const bots = load(hotel.DATASET_BOTS, []);
    const outra = { ...structuredClone(bots.find((b) => b.agenteId === 'ia-b')), agenteId: 'ia-b2', nome: 'Duda' };
    save(hotel.DATASET_BOTS, [...bots.filter((b) => b.agenteId !== 'ia-b2'), outra]);
    const nomes = () => chamadas.filter((c) => c.caminho === `/chat/updateProfileName/${r.numero.instancia}`).map((c) => c.corpo.name);
    const v1 = canais.vincularIA({ id: r.numero.id, agenteId: 'ia-b2' });
    assert.equal(v1.erro, undefined, v1.erro);
    const v2 = canais.vincularIA({ id: r.numero.id, agenteId: 'ia-b' });
    assert.equal(v2.alterado, true);
    await new Promise((ok) => { setTimeout(ok, 100); });
    const final = canais.listar().find((x) => x.id === r.numero.id);
    assert.equal(final.ia.agenteId, 'ia-b', 'a sincronização não desfaz a troca');
    assert.equal(nomes().at(-1), 'Bia', 'o WhatsApp fica com a IA escolhida por último');
    assert.equal(final.identidade.iaId, 'ia-b');
    assert.equal(final.identidade.pendente, false);
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
  for (const n of ['Salao', 'salão de beleza', 'manicurista', 'Cabeleireira', 'barbeiro', 'design de sobrancelha', 'alongamento de unhas', 'esmalteria', 'bronzeamento natural']) assert.equal(salao.exigeDadosSalao(n), true, n);
  for (const n of ['padaria', 'clínica médica', 'faxina', 'salão de festas']) assert.equal(salao.exigeDadosSalao(n), false, n);
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

test('módulo salão: vários números, só IA dos 7 nichos e bot de agendamento com a agenda da IA de cada número', async () => {
  process.env.CANAIS_SALAO_CEREBRO = '0';
  await comEmpresa('55666777000188', async () => {
    iaHomologada({ id: 'ia-mani', nome: 'Nina', especialidade: 'Manicure', conhecimento: 'x' });
    iaHomologada({ id: 'ia-barba', nome: 'Rui', especialidade: 'Barbearia', conhecimento: 'y' });
    iaHomologada({ id: 'ia-doc', nome: 'Dra', especialidade: 'Clínica médica', conhecimento: 'z' });
    iaHomologada({ id: 'ia-sem', nome: 'Sem', especialidade: 'Pedicure', conhecimento: 'w' });
    salao.salvarDadosSistema('ia-mani', { url: 'http://agenda1.teste/api', token: 'tok-1' });
    salao.salvarDadosSistema('ia-barba', { url: 'http://agenda2.teste/api', token: 'tok-2' });
    assert.deepEqual(canais.iasDisponiveis('salao').map((x) => x.agenteId), ['ia-mani', 'ia-barba']);
    assert.deepEqual(canais.iasDisponiveis('canais').map((x) => x.agenteId), ['ia-doc'], 'salão e afins não aparecem em Canais');
    assert.match(canais.cadastrar({ rotulo: 'W', agenteId: 'ia-mani' }).erro, /use o menu Salão/);
    assert.match(canais.cadastrar({ rotulo: 'X', agenteId: 'ia-doc', modulo: 'salao' }).erro, /não pode atender o salão/);
    assert.match(canais.cadastrar({ rotulo: 'Y', agenteId: 'ia-sem', modulo: 'salao' }).erro, /sem os dados do Cadê Você/);
    assert.match(canais.cadastrar({ rotulo: 'Z', agenteId: 'ia-mani', modulo: 'salao', nicho: 'barbearia' }).erro, /não é do nicho/);
    const a = canais.cadastrar({ rotulo: 'Unhas', agenteId: 'ia-mani', modulo: 'salao', nicho: 'manicure' }).numero;
    const b = canais.cadastrar({ rotulo: 'Barba', agenteId: 'ia-barba', modulo: 'salao', nicho: 'barbearia' }).numero;
    assert.deepEqual(canais.listar('salao').map((x) => x.rotulo), ['Unhas', 'Barba']);
    assert.equal(canais.listar('canais').length, 0, 'números do salão não aparecem em Canais');
    for (const n of [a, b]) { await canais.conectar({ id: n.id }); estados.set(n.instancia, 'open'); }
    const antes = chamadas.length;
    const r1 = await canais.receberWebhook(evento(a.instancia, '5531999990020', 'oi', 'sa1'), { segredo: 'segredo-123' });
    const r2 = await canais.receberWebhook(evento(b.instancia, '5531999990021', 'oi', 'sa2'), { segredo: 'segredo-123' });
    assert.equal(r1.resultados[0].ok, true, JSON.stringify(r1)); assert.equal(r1.resultados[0].envios[0].origem, 'bot-agendamento');
    assert.equal(r2.resultados[0].ia, 'ia-barba');
    assert.match(r1.resultados[0].envios[0].texto, /Nina[\s\S]*Agendar horário/);
    await canais.receberWebhook(evento(a.instancia, '5531999990020', '1', 'sa3'), { segredo: 'segredo-123' });
    await canais.receberWebhook(evento(b.instancia, '5531999990021', '1', 'sa4'), { segredo: 'segredo-123' });
    const agendas = chamadas.slice(antes).filter((c) => c.host.startsWith('agenda'));
    assert.deepEqual([...new Set(agendas.map((c) => `${c.host} ${c.auth}`))].sort(), ['agenda1.teste Bearer tok-1', 'agenda2.teste Bearer tok-2'], 'cada número usa a agenda da sua IA');
    assert.deepEqual([...new Set(chamadas.slice(antes).filter((c) => c.caminho.startsWith('/message/sendText/')).map((c) => c.caminho))].length, 2);
    assert.equal(chamadas.slice(antes).some((c) => c.caminho === '/api/chat'), false, 'salão usa o bot de agendamento, não a resposta livre');
  });
});

test('nome vazio usa o da IA e nome repetido só vale dentro do mesmo módulo', () => {
  comEmpresa('66777888000177', () => {
    iaHomologada({ id: 'ia-nome', nome: 'Nina', especialidade: 'Manicure', conhecimento: 'x' });
    iaHomologada({ id: 'ia-nome2', nome: 'Nina', especialidade: 'Faxina', conhecimento: 'x' });
    salao.salvarDadosSistema('ia-nome', { url: 'http://agenda.teste/api', token: 't' });
    assert.equal(canais.cadastrar({ rotulo: '', agenteId: 'ia-nome', modulo: 'salao' }).numero.rotulo, 'Nina');
    assert.equal(canais.cadastrar({ rotulo: 'Nina', agenteId: 'ia-nome2' }).ok, true, 'mesmo nome em Canais é permitido');
    assert.match(canais.cadastrar({ rotulo: 'nina', agenteId: 'ia-nome', modulo: 'salao' }).erro, /já existe/);
    assert.match(canais.cadastrar({ rotulo: '' }).erro, /dê um nome/);
  });
});

test('o 404 de antes de criar a instância não apaga o QR depois', async () => {
  await comEmpresa('88999000000166', async () => {
    const n = canais.cadastrar({ rotulo: 'Antes' }).numero;
    assert.equal((await canais.estado({ id: n.id })).estado, 'desconectado');
    assert.ok((await canais.conectar({ id: n.id })).qr);
    const st = await canais.estado({ id: n.id });
    assert.equal(st.estado, 'aguardando_qr');
    assert.equal(st.qr, 'data:image/png;base64,QRREAL');
    assert.equal(st.ultimoErro, null);
  });
});

test('saudação do salão sai com o cumprimento preenchido', async () => {
  process.env.CANAIS_SALAO_CEREBRO = '0';
  await comEmpresa('77111222000133', async () => {
    iaHomologada({ id: 'ia-oi', nome: 'Ale', especialidade: 'Manicure', conhecimento: 'x' });
    const bots = load(hotel.DATASET_BOTS, []);
    bots.find((b) => b.agenteId === 'ia-oi').perfil.mensagemInicial = '{cumprimento}! Eu sou {nome}.';
    save(hotel.DATASET_BOTS, bots);
    salao.salvarDadosSistema('ia-oi', { url: 'http://agenda9.teste/api', token: 't9' });
    const n = canais.cadastrar({ rotulo: 'Oi', agenteId: 'ia-oi', modulo: 'salao' }).numero;
    await canais.conectar({ id: n.id }); estados.set(n.instancia, 'open');
    const r = await canais.receberWebhook(evento(n.instancia, '5531999990030', 'oi', 'c1'), { segredo: 'segredo-123' });
    assert.equal(r.resultados[0].envios[0].texto.includes('{cumprimento}'), false, r.resultados[0].envios[0].texto);
    assert.match(r.resultados[0].envios[0].texto, /(Bom dia|Boa tarde|Boa noite)! Eu sou Ale/);
  });
});

test('o que a IA não soube vira aprendizado pendente e só vale depois de auditado', async () => {
  await comEmpresa('12312312000199', async () => {
    iaHomologada({ id: 'ia-apr', nome: 'Duda', especialidade: 'Faxina', conhecimento: 'Faxina leva 4 horas' });
    const n = canais.cadastrar({ rotulo: 'Duda', agenteId: 'ia-apr' }).numero;
    await canais.conectar({ id: n.id }); estados.set(n.instancia, 'open');
    await canais.receberWebhook(evento(n.instancia, '5531999990040', 'pergunta desconhecida, meu fone 31 99999-8888', 'ap1'), { segredo: 'segredo-123' });
    await canais.receberWebhook(evento(n.instancia, '5531999990040', 'pergunta desconhecida, meu fone 31 99999-8888', 'ap2'), { segredo: 'segredo-123' });
    await canais.receberWebhook(evento(n.instancia, '5531999990041', 'quanto tempo leva?', 'ap3'), { segredo: 'segredo-123' });
    const est = canais.estadoAuditoria();
    assert.equal(est.pendentes.length, 1, 'repetida não duplica; o que ela soube não entra');
    assert.equal(est.pendentes[0].pergunta.includes('99999'), false, 'não guarda telefone');
    assert.equal(est.vencida, false);
    assert.equal(canais.estadoAuditoria({ agora: new Date(Date.now() + 16 * 864e5) }).vencida, true, 'vence em 15 dias');
    const homologados = () => mapa.obterNos('ia-apr').nos.filter((x) => x.estado === 'homologado').map((x) => x.conteudo).join('|');
    assert.equal(homologados().includes('desconhecida'), false, 'pendente não é usado nas respostas');
    assert.match(canais.validarAprendizado({ id: est.pendentes[0].id, resposta: '' }).erro, /resposta correta/);
    assert.equal(canais.validarAprendizado({ id: est.pendentes[0].id, resposta: 'Atendemos de segunda a sexta.', por: 'dono@x' }).ok, true);
    assert.match(homologados(), /desconhecida.*segunda a sexta/);
    const depois = canais.estadoAuditoria();
    assert.equal(depois.pendentes.length, 0); assert.ok(depois.ultimaEm);
    await canais.receberWebhook(evento(n.instancia, '5531999990042', 'outra desconhecida aqui', 'ap4'), { segredo: 'segredo-123' });
    const r = canais.estadoAuditoria().pendentes[0];
    assert.equal(canais.recusarAprendizado({ id: r.id }).ok, true);
    assert.equal(homologados().includes('outra desconhecida'), false);
    assert.match(canais.recusarAprendizado({ id: r.id }).erro, /já auditado/);
  });
});

test('o 0007 opina, o dono decide e o que ele aprova vale mesmo com base curada', async () => {
  await comEmpresa('12312312000188', async () => {
    iaHomologada({ id: 'ia-par', nome: 'Duda', especialidade: 'Faxina', conhecimento: 'Faxina leva 4 horas' });
    const curada = mapa.adicionarNo({ agenteId: 'ia-par', categoria: 'produto', conteudo: 'Faxina completa', estado: 'homologado', autorizado: true, qualidade: 'curada' });
    assert.ok(curada.no);
    const n = canais.cadastrar({ rotulo: 'Par', agenteId: 'ia-par' }).numero;
    await canais.conectar({ id: n.id }); estados.set(n.instancia, 'open');
    await canais.receberWebhook(evento(n.instancia, '5531999990050', 'pergunta desconhecida sobre frete', 'pa1'), { segredo: 'segredo-123' });
    await canais.receberWebhook(evento(n.instancia, '5531999990051', 'pergunta desconhecida sobre frete', 'pa2'), { segredo: 'segredo-123' });
    const [p] = canais.estadoAuditoria().pendentes;
    assert.equal(p.vezes, 2, 'repetida conta');
    assert.equal(p.parecer.voto, 'aprovar');
    assert.equal(canais.avisoDeAuditoria(), null, 'antes dos 15 dias não avisa');
    const depois = new Date(Date.now() + 16 * 864e5);
    assert.match(canais.avisoDeAuditoria({ agora: depois }), /sugiro aprovar 1/);
    canais.marcarAvisoDeAuditoria();
    assert.equal(canais.avisoDeAuditoria({ agora: depois }), null, 'avisa uma vez por ciclo');
    assert.equal(mapa.obterNos('ia-par').nos.find((x) => x.id === p.id).estado, 'descoberto', 'parecer não aplica nada');
    assert.equal(canais.validarAprendizado({ id: p.id, resposta: 'Frete grátis em BH.' }).ok, true);
    assert.equal(mapa.obterNos('ia-par').nos.find((x) => x.categoria === 'aprendizado-validado').qualidade, 'dono');
    assert.deepEqual(canais.treinoDasIAs().find((x) => x.agenteId === 'ia-par').faltam.map((f) => f.chave), ['precos', 'horario', 'contato', 'como-funciona']);
    assert.match(canais.ensinarIA({ agenteId: 'ia-par', requisito: 'xx', texto: 'abc' }).erro, /escolha/);
    assert.equal(canais.ensinarIA({ agenteId: 'ia-par', requisito: 'precos', texto: 'Faxina custa R$ 150' }).ok, true);
    assert.equal(canais.treinoDasIAs().find((x) => x.agenteId === 'ia-par').faltam.some((f) => f.chave === 'precos'), false);
  });
});

test('número conectado com IA conta como bot no ar; desconectado não', async () => {
  await comEmpresa('12312312000166', async () => {
    iaHomologada({ id: 'ia-ar', nome: 'Lia', especialidade: 'Faxina', conhecimento: 'x' });
    const n = canais.cadastrar({ rotulo: 'Vendas', agenteId: 'ia-ar' }).numero;
    assert.deepEqual((await canais.noAr()).canais, []);
  });
  await comEmpresa('12312312000155', async () => {
    iaHomologada({ id: 'ia-ar2', nome: 'Lia', especialidade: 'Faxina', conhecimento: 'x' });
    const n = canais.cadastrar({ rotulo: 'Vendas', agenteId: 'ia-ar2' }).numero;
    await canais.conectar({ id: n.id }); estados.set(n.instancia, 'open');
    assert.deepEqual((await canais.noAr()).canais, [{ rotulo: 'Vendas', ia: 'Lia' }]);
  });
});

test('sem base sobre o tema ela não inventa, e nunca nega ser robô', async () => {
  await comEmpresa('12312312000177', async () => {
    iaHomologada({ id: 'ia-trava', nome: 'Duda', especialidade: 'Faxina', conhecimento: 'Faxina leva 4 horas' });
    const n = canais.cadastrar({ rotulo: 'Trava', agenteId: 'ia-trava' }).numero;
    await canais.conectar({ id: n.id }); estados.set(n.instancia, 'open');
    const manda = async (texto, id, de = '5531999990060') => (await canais.receberWebhook(evento(n.instancia, de, texto, id), { segredo: 'segredo-123' })).resultados[0].envios.at(-1);
    assert.equal((await manda('vocês entregam em Contagem?', 'tr1')).origem, 'sem-base');
    assert.equal(canais.estadoAuditoria().pendentes.length, 1, 'virou pendente');
    const robo = await manda('vc é robo?', 'tr2');
    assert.equal(robo.origem, 'identidade');
    assert.match(robo.texto, /assistente virtual/);
    assert.equal((await manda('é uma ia?', 'tr3', '5531999990061')).origem, 'identidade');
    assert.equal((await manda('quanto tempo leva?', 'tr4')).origem, 'ia');
  });
});

test('o que ela sabe da empresa chega na resposta, sem os itens internos do modelo', () => {
  const linhas = ['fluxos: endereco: Me passa o endereço', 'lacunas: Produtos e preços', 'responsabilidades: resolver problemas', 'o-que-a-empresa-faz: A Veloso desenvolve sistemas e plataformas', 'conhecimento-básico: suporte técnico resolve chamados'];
  const r = canais.conhecimentoRelevante(linhas, 'oi, tudo bem?');
  assert.equal(r[0], 'o-que-a-empresa-faz: A Veloso desenvolve sistemas e plataformas');
  assert.equal(r.some((l) => /^(fluxos|lacunas|responsabilidades):/.test(l)), false);
  assert.equal(canais.conhecimentoRelevante(linhas, 'como resolve chamados de suporte?')[0], 'conhecimento-básico: suporte técnico resolve chamados');
});

test('IA de vendas recebe roteiro; conversa de robô é pausada e frase repetida não sai', async () => {
  await comEmpresa('44111222000155', async () => {
    iaHomologada({ id: 'ia-venda', nome: 'Ivi', especialidade: 'Vendedora', conhecimento: 'produto: Dobrão vende pelo WhatsApp' });
    const n = canais.cadastrar({ rotulo: 'Ivi', agenteId: 'ia-venda' }).numero;
    await canais.conectar({ id: n.id }); estados.set(n.instancia, 'open');
    await canais.receberWebhook(evento(n.instancia, '5531999990050', 'quero comprar', 'v0'), { segredo: 'segredo-123' });
    const prompt = chamadas.filter((c) => c.caminho === '/api/chat').at(-1).corpo.messages[0].content;
    assert.match(prompt, /recomende um produto/);
    const envios = () => chamadas.filter((c) => c.caminho === `/message/sendText/${n.instancia}`).length;
    const antes = envios();
    const r2 = await canais.receberWebhook(evento(n.instancia, '5531999990050', 'de novo', 'v1'), { segredo: 'segredo-123' });
    assert.equal(r2.resultados[0].envios.length, 0, 'mesma resposta não é enviada de novo');
    assert.equal(envios(), antes);
    for (let i = 2; i < 10; i++) await canais.receberWebhook(evento(n.instancia, '5531999990050', `msg ${i}`, `v${i}`), { segredo: 'segredo-123' });
    const r = await canais.receberWebhook(evento(n.instancia, '5531999990050', 'mais uma', 'v99'), { segredo: 'segredo-123' });
    assert.match(r.resultados[0].motivo, /possível robô/);
  });
});

test('sessão pareada reiniciando (troca de IA) não é apagada por "Gerar QR novo"', async () => {
  await comEmpresa(EMPRESA_B, async () => {
    const n = canais.cadastrar({ rotulo: 'Reinicia', agenteId: 'ia-b' }).numero;
    await canais.conectar({ id: n.id });
    estados.set(n.instancia, 'open');
    assert.equal((await canais.estado({ id: n.id })).estado, 'conectado');
    /* nome/foto foram pro WhatsApp e a conexão reinicia */
    estados.set(n.instancia, 'connecting');
    const antes = chamadas.length;
    const r = await canais.conectar({ id: n.id });
    const depois = chamadas.slice(antes).map((c) => c.caminho);
    assert.ok(!depois.some((c) => c.startsWith('/instance/delete/') || c.startsWith('/instance/logout/')), 'não apaga nem desloga a sessão pareada');
    assert.equal(estados.get(n.instancia), 'connecting');
    assert.match(r.aviso, /reconectando/);
  });
});

test('QR novo depois de apagar a sessão manda a foto de novo', async () => {
  await comEmpresa(EMPRESA_B, async () => {
    const n = canais.cadastrar({ rotulo: 'Foto volta', agenteId: 'ia-b' }).numero;
    await canais.conectar({ id: n.id }); estados.set(n.instancia, 'open');
    await canais.sincronizarIdentidade({ id: n.id });
    assert.ok(canais.listar().find((x) => x.id === n.id).identidade.marcaFoto !== undefined);
    assert.equal((await canais.apagarSessao({ id: n.id })).ok, true);
    const id = canais.listar().find((x) => x.id === n.id).identidade;
    assert.equal(id.pendente, true); assert.equal(id.marcaFoto, null);
  });
});

test('regra do 0007: número de teste encerra sem rastro; número de cliente guarda tudo', async () => {
  assert.equal(canais.ehNumeroTeste('553175127978@s.whatsapp.net'), true, 'JID sem o 9 também é o de teste');
  assert.equal(canais.ehNumeroTeste('5531975127978'), true);
  assert.equal(canais.ehNumeroTeste('5531911112222'), false);
  const antes = process.env.CANAIS_NUMEROS_TESTE;
  await comEmpresa(EMPRESA_B, async () => {
    const conversar = async (n, id) => {
      await canais.conectar({ id: n.id }); estados.set(n.instancia, 'open');
      await canais.estado({ id: n.id });
      await canais.receberWebhook(evento(n.instancia, '5531999990088', 'pergunta desconhecida de teste', id), { segredo: 'segredo-123' });
      assert.ok(canais.conversas({ id: n.id }).length);
    };
    process.env.CANAIS_NUMEROS_TESTE = '31911112222';
    const t = canais.cadastrar({ rotulo: 'Teste sem rastro', agenteId: 'ia-b' }).numero;
    await conversar(t, 'z1');
    const doTeste = () => mapa.lerMapa().nos.filter((no) => no.estado === 'descoberto' && String(no.evidencia).includes(`"numero":"${t.id}"`)).length;
    assert.ok(doTeste() > 0, 'a conversa de teste gerou aprendizado pendente');
    assert.equal((await canais.apagarSessao({ id: t.id })).ok, true);
    assert.equal(canais.conversas({ id: t.id }).length, 0, 'conversa do teste foi embora');
    assert.equal(doTeste(), 0, 'aprendizado pendente do teste foi embora');
    process.env.CANAIS_NUMEROS_TESTE = '31900000000';
    const c = canais.cadastrar({ rotulo: 'Cliente guarda', agenteId: 'ia-b' }).numero;
    await conversar(c, 'z2');
    await canais.desconectar({ id: c.id });
    assert.ok(canais.conversas({ id: c.id }).length, 'número de cliente mantém o histórico');
  });
  if (antes === undefined) delete process.env.CANAIS_NUMEROS_TESTE; else process.env.CANAIS_NUMEROS_TESTE = antes;
});
