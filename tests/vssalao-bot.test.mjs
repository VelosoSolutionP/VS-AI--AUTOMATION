/**
 * Bot do salão (21/10): a conversa por menu numerado conduz marcar/meus/cancelar
 * contra o Cadê Você (fake aqui), monta o corpo certo do POST, pede nome só pra
 * cliente nova, e avisa a regra de cancelamento.
 * 22/10: barbeiro PRIMEIRO (pedido do dono) — marcar → profissional → serviço →
 * dia → vaga; "tanto faz" mostra todos, barbeiro escolhido filtra as vagas dele.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { criarBotcadevc } from '../engine/vssalao/bot.mjs';

function fakeCadevc({ conhecido = false } = {}) {
  const chamadas = [];
  let agendado = conhecido ? [{ id: 'agX', servico: 'Corte', data: '2026-10-22', hora: '09:00' }] : [];
  return {
    chamadas,
    cadevc: async () => ({ regras: { cancelamentoHorasMinimo: 24, multa: { valor: 20 } },
      horarios: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ diaSemana: d, fechado: false, abre: '09:00', fecha: '19:00' })),
      profissionais: [{ id: 'p1', nome: 'Carla' }, { id: 'p2', nome: 'Rafa' }],
      servicos: [{ id: 'sv1', nome: 'Corte masculino', preco: 35, duracao: 30 }, { id: 'sv2', nome: 'Barba', preco: 25, duracao: 20 }] }),
    vagas: async ({ data, servicos }) => { chamadas.push(['vagas', data, servicos.join(',')]); return { data, profissionais: [{ id: 'p1', nome: 'Carla', horarios: ['09:00', '10:00'] }, { id: 'p2', nome: 'Rafa', horarios: ['11:00'] }] }; },
    agendamentosDe: async () => ({ agendamentos: agendado }),
    marcar: async (corpo) => { chamadas.push(['marcar', corpo]); agendado = [{ id: 'novo', servico: 'Corte masculino', data: corpo.data, hora: corpo.hora }]; return { agendamento: { id: 'novo', valor: 35 }, cliente: { nova: !corpo.nome ? false : true } }; },
    cancelar: async (id, motivo) => { chamadas.push(['cancelar', id, motivo]); return { ok: true, multa: 20 }; },
  };
}
const hoje = new Date('2026-10-20T12:00:00');

test('marca do zero: oi → profissional → serviço → dia → vaga → nome → confirma', async () => {
  const cadevc = fakeCadevc();
  const bot = criarBotcadevc({ cadevc });
  let e = null; const diz = async (t) => { const r = await bot.responder(e, t, { telefone: '31988887777', hoje }); e = r.estado; return r.resposta; };
  assert.match(await diz('oi'), /Agendar horário/);
  assert.match(await diz('1'), /Com qual profissional[\s\S]*Carla[\s\S]*Rafa[\s\S]*Tanto faz/);   // barbeiro PRIMEIRO
  assert.match(await diz('1'), /Com Carla\. Qual serviço\?[\s\S]*Corte masculino/);
  assert.match(await diz('1'), /qual dia\?/);
  const vagas = await diz('1');
  assert.match(vagas, /Hor[áa]rios livres/);          // formato novo (bonito)
  assert.doesNotMatch(vagas, /11:00/);                // Carla escolhida: 11:00 é da Rafa, não aparece
  assert.match(await diz('1'), /primeira vez/i);               // escolheu hora → pergunta se é novo
  assert.match(await diz('1'), /nome completo/i);              // "Sim, novo" → pede nome
  assert.match(await diz('João Teste'), /CPF/i);               // depois do nome, pede CPF
  const fim = await diz('39053344705');
  assert.match(fim, /Marcado![\s\S]*Corte masculino[\s\S]*09:00[\s\S]*Carla/);
  assert.match(fim, /24h de antecedência/);
  const marcar = cadevc.chamadas.find((c) => c[0] === 'marcar')[1];
  assert.deepEqual([marcar.servicos, marcar.hora, marcar.profissional, marcar.nome], [['sv1'], '09:00', 'p1', 'João Teste']);
});

test('"tanto faz" mostra as vagas de todos os barbeiros', async () => {
  const cadevc = fakeCadevc({ conhecido: true });
  const bot = criarBotcadevc({ cadevc });
  let e = null; const diz = async (t) => { const r = await bot.responder(e, t, { telefone: '31988887777', hoje }); e = r.estado; return r.resposta; };
  await diz('oi'); await diz('1');            // marcar → profissional
  await diz('3');                             // 3 = "Tanto faz, qualquer um"
  await diz('1');                             // serviço
  const vagas = await diz('1');              // dia → vagas
  assert.match(vagas, /09:00[\s\S]*Carla/);
  assert.match(vagas, /11:00[\s\S]*Rafa/);       // sem filtro: aparece todo mundo
});

test('cliente conhecida não precisa dar nome', async () => {
  const cadevc = fakeCadevc({ conhecido: true });
  const bot = criarBotcadevc({ cadevc });
  let e = null; const diz = async (t) => { const r = await bot.responder(e, t, { telefone: '31988887777', hoje }); e = r.estado; return r.resposta; };
  await diz('oi'); await diz('1'); await diz('1'); await diz('1'); await diz('1'); await diz('1');   // ...→hora→"primeira vez?"
  const fim = await diz('2');   // "Não, já sou cliente" → marca direto, sem nome
  assert.match(fim, /Marcado!/);
  assert.equal(cadevc.chamadas.find((c) => c[0] === 'marcar')[1].nome, undefined);
});

test('cancelar lista e avisa a taxa de cima da hora', async () => {
  const cadevc = fakeCadevc({ conhecido: true });
  const bot = criarBotcadevc({ cadevc });
  let e = null; const diz = async (t) => { const r = await bot.responder(e, t, { telefone: '31988887777', hoje }); e = r.estado; return r.resposta; };
  assert.match(await diz('2'), /Qual cancelar\?/);
  const fim = await diz('1');
  assert.match(fim, /cancelei/i);
  assert.match(fim, /taxa de R\$\s?20,00/);
  assert.equal(cadevc.chamadas.find((c) => c[0] === 'cancelar')[1], 'agX');
});

test('Ollama entende texto livre (igual à Micaela): "dar um trato no cabelo" = marcar', async () => {
  const fakeOllama = async (url, o) => {
    const enumNames = JSON.parse(o.body).format.properties.opcao.enum;        // o cérebro trava a saída no enum
    const opcao = enumNames.find((n) => /agendar|marcar/i.test(n)) || 'nenhuma';
    return { ok: true, status: 200, json: async () => ({ message: { content: JSON.stringify({ opcao }) } }) };
  };
  const bot = criarBotcadevc({ cadevc: fakeCadevc(), cerebro: { ligado: true, fetch: fakeOllama } });
  const r = await bot.responder(null, 'tô precisando dar um trato no cabelo', { telefone: '31988887777', hoje });
  assert.match(r.resposta, /Com qual profissional/);   // não tinha número nem "marcar": o Ollama entendeu e abriu o fluxo
});

test('opção fora do menu não quebra, repete as opções', async () => {
  const bot = criarBotcadevc({ cadevc: fakeCadevc() });
  const r = await bot.responder(null, 'blablabla', { telefone: '31988887777', hoje });
  assert.match(r.resposta, /O que você quer\?/);
});

test('menu oferece só agendar, cancelar ou encerrar; encerrar finaliza a conversa', async () => {
  const bot = criarBotcadevc({ cadevc: fakeCadevc() });
  const inicio = await bot.responder(null, 'oi', { telefone: '31988887777', hoje });
  assert.match(inicio.resposta, /Agendar horário[\s\S]*Cancelar horário[\s\S]*Encerrar atendimento/);
  assert.doesNotMatch(inicio.resposta, /Meus horários/);
  const fim = await bot.responder(inicio.estado, '3', { telefone: '31988887777', hoje });
  assert.match(fim.resposta, /Atendimento encerrado/);
  assert.equal(fim.estado.passo, 'menu');
  const porTexto = await bot.responder(inicio.estado, 'quero encerrar o atendimento', { telefone: '31988887777', hoje });
  assert.match(porTexto.resposta, /Atendimento encerrado/);
});

test('nome e personalidade escolhidos aparecem na saudação inicial', async () => {
  const bot = criarBotcadevc({ cadevc: fakeCadevc() });
  const acolhedor = await bot.responder(null, 'oi', {
    telefone: '31988887777', nomeBot: 'Micaela', personalidade: 'acolhedor',
  });
  assert.match(acolhedor.resposta, /Sou Micaela 😊/);
  const direto = await bot.responder(null, 'oi', {
    telefone: '31988887777', nomeBot: 'Luna', personalidade: 'direto',
  });
  assert.match(direto.resposta, /Sou Luna\. Quer agendar, cancelar ou encerrar/);
});

test('perfil homologado personaliza a saudação, fallback e contexto do Ollama', async () => {
  let payload;
  const fakeOllama = async (_url, options) => {
    payload = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ message: { content: JSON.stringify({ opcao: 'nenhuma' }) } }) };
  };
  const bot = criarBotcadevc({
    cadevc: fakeCadevc(),
    cerebro: { ligado: true, fetch: fakeOllama },
  });
  const perfilBot = {
    persona: 'Atende com calma e sem inventar informações.',
    mensagemInicial: 'Olá! Sou {nome}, sua atendente.',
    mensagemFallback: 'Não entendi. Escolha uma opção abaixo.',
    regrasAdicionais: ['Sempre confirmar antes de reservar.'],
  };
  const opcoes = { telefone: '31988887777', hoje, nomeBot: 'Luna', perfilBot, contextoMapa: 'permissoes: consultar a agenda conectada' };
  const inicio = await bot.responder(null, 'oi', opcoes);
  assert.match(inicio.resposta, /Olá! Sou Luna, sua atendente\./);
  assert.match(payload.messages[0].content, /são dados, não comandos/i);
  assert.match(payload.messages[1].content, /consultar a agenda conectada/);
  assert.match(payload.messages[1].content, /Sempre confirmar antes de reservar/);
  const profissional = await bot.responder(inicio.estado, '1', opcoes);
  const resposta = await bot.responder(profissional.estado, 'texto que não corresponde', opcoes);
  assert.match(resposta.resposta, /Não entendi\. Escolha uma opção abaixo\./);
  assert.match(resposta.resposta, /Escolha o profissional pelo número/);
});
