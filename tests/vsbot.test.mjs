/**
 * Motor do bot. O ponto do módulo é funcionar SEM canal: se estes testes passam,
 * o WhatsApp só troca por onde a mensagem entra e sai.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import * as R from '../engine/vsbot/regras.mjs';

const dir = mkdtempSync(join(tmpdir(), 'vsbot-'));
process.env.VSBOT_DIR = dir;
/* O bot abre PROTOCOLO a cada mensagem. Sem apontar o armazem pra ca, o teste
   escreveria na casa de quem roda — e, pior, um caso comecaria "retomando" o
   protocolo que o caso anterior deixou aberto. */
const dirProto = mkdtempSync(join(tmpdir(), 'vsbot-proto-'));
process.env.VSPROTOCOLO_DIR = dirProto;
const bot = await import('../engine/vsbot/index.mjs');
test.after(() => { rmSync(dir, { recursive: true, force: true }); rmSync(dirProto, { recursive: true, force: true }); });

/* ---- casamento ---- */

test('acento e caixa nao atrapalham', () => {
  const r = { termos: ['preco'] };
  assert.equal(R.casa(r, 'Qual o PREÇO?'), true);
  assert.equal(R.casa(r, 'preço'), true);
  assert.equal(R.casa(r, '  Preco  '), true);
});

test('termo curto NAO casa dentro de outra palavra', () => {
  const r = { termos: ['oi'] };
  assert.equal(R.casa(r, 'oi, tudo bem?'), true);
  assert.equal(R.casa(r, 'moita'), false, '"oi" dentro de "moita" nao pode disparar');
  assert.equal(R.casa(r, 'foi voce?'), false);
});

test('gatilho exato e comeca fazem o que dizem', () => {
  assert.equal(R.casa({ termos: ['oi'], gatilho: 'exato' }, 'oi'), true);
  assert.equal(R.casa({ termos: ['oi'], gatilho: 'exato' }, 'oi tudo bem'), false);
  assert.equal(R.casa({ termos: ['quero'], gatilho: 'comeca' }, 'quero dois'), true);
  assert.equal(R.casa({ termos: ['quero'], gatilho: 'comeca' }, 'eu quero dois'), false);
});

test('mensagem vazia nao casa com nada', () => {
  assert.equal(R.casa({ termos: ['oi'] }, ''), false);
  assert.equal(R.casa({ termos: ['oi'] }, null), false);
});

/* ---- escolha ---- */

test('prioridade decide, e empate fica com a primeira cadastrada', () => {
  const regras = [
    { id: 'a', termos: ['entrega'], resposta: 'A', prioridade: 0 },
    { id: 'b', termos: ['entrega'], resposta: 'B', prioridade: 5 },
    { id: 'c', termos: ['entrega'], resposta: 'C', prioridade: 5 },
  ];
  assert.equal(R.escolher(regras, 'como e a entrega?').id, 'b');
  assert.equal(R.escolher([regras[0]], 'entrega').id, 'a');
});

test('regra desativada nao responde', () => {
  const regras = [{ id: 'x', termos: ['oi'], resposta: 'oi!', ativa: false }];
  assert.equal(R.escolher(regras, 'oi'), null);
});

/* ---- resposta ---- */

test('pedir gente GANHA de qualquer regra', () => {
  const cfg = { regras: [{ id: 'x', termos: ['atendente'], resposta: 'resposta automatica', prioridade: 99 }] };
  const r = R.responder('quero falar com um atendente', cfg);
  assert.equal(r.tipo, 'humano');
  assert.equal(r.handoff, true);
});

test('variavel sem valor fica VISIVEL em vez de virar vazio', () => {
  assert.equal(R.preencher('Olá {nome}!', { nome: 'Ana' }), 'Olá Ana!');
  assert.equal(R.preencher('Olá {nome}!', {}), 'Olá {nome}!', '"Olá !" esconde o erro');
  assert.equal(R.preencher('Olá {nome}!', { nome: '' }), 'Olá {nome}!');
});

test('catalogo so responde se houver produto', () => {
  const cfg = { usarCatalogo: true, regras: [] };
  const semProduto = R.responder('qual o preco?', cfg, { produtos: [] });
  assert.equal(semProduto.tipo, 'fallback', 'catalogo vazio e pior que nao responder');
  const comProduto = R.responder('qual o preco?', cfg, { produtos: [{ nome: 'Camiseta' }] });
  assert.equal(comProduto.tipo, 'catalogo');
  assert.equal(comProduto.produtos.length, 1);
});

test('fallback repetido chama gente — bot perdido nao segura cliente', () => {
  const cfg = { regras: [], falhasAteHumano: 2 };
  assert.equal(R.responder('xyz', cfg, { falhasSeguidas: 0 }).handoff, false);
  assert.equal(R.responder('xyz', cfg, { falhasSeguidas: 1 }).handoff, true);
});

test('conversa inteira para no handoff', () => {
  const cfg = { regras: [{ id: 'oi', termos: ['oi'], resposta: 'Olá!' }], falhasAteHumano: 2 };
  const t = R.conversar(['oi', 'abacaxi', 'banana', 'melancia'], cfg);
  assert.equal(t[0].tipo, 'regra');
  assert.equal(t.at(-1).handoff, true);
  assert.equal(t.length, 3, 'parou assim que chamou gente');
});

/* ---- persistencia ---- */

test('regra sem termo ou sem resposta e recusada', () => {
  assert.equal(bot.salvarRegra({ resposta: 'oi' }).ok, false);
  assert.equal(bot.salvarRegra({ termos: ['oi'] }).ok, false);
  assert.equal(bot.salvarRegra({ termos: ['oi'], resposta: 'x', gatilho: 'voar' }).ok, false);
});

test('salvar, editar e excluir regra', () => {
  const a = bot.salvarRegra({ termos: ['horario', 'aberto'], resposta: 'Das 9h às 18h.' });
  assert.equal(a.ok, true);
  assert.equal(a.novo, true);
  const b = bot.salvarRegra({ id: a.regra.id, termos: ['horario'], resposta: 'Das 8h às 18h.' });
  assert.equal(b.novo, false);
  assert.equal(bot.regras().length, 1);
  assert.equal(bot.regras()[0].resposta, 'Das 8h às 18h.');
  assert.equal(bot.excluirRegra('nao-existe').ok, false);
  assert.equal(bot.excluirRegra(a.regra.id).ok, true);
  assert.equal(bot.regras().length, 0);
});

test('o simulador responde com as regras gravadas, sem canal nenhum', () => {
  bot.salvarRegra({ termos: ['horario'], resposta: 'Das 9h às 18h, {nome}.' });
  const s = bot.simular(['qual o horario?'], { nome: 'Ana' });
  assert.equal(s.turnos[0].tipo, 'regra');
  assert.equal(s.turnos[0].texto, 'Das 9h às 18h, Ana.');
});

test('bot ligado e sem regra ativa e denunciado no painel', () => {
  bot.regras().forEach((r) => bot.excluirRegra(r.id));
  bot.salvarConfig({ ativo: true });
  const p = bot.painel();
  assert.equal(p.pronto, false);
  assert.match(p.aviso, /nenhuma regra ativa/);
  bot.salvarRegra({ termos: ['oi'], resposta: 'Olá!' });
  assert.equal(bot.painel().pronto, true);
  assert.equal(bot.painel().aviso, null);
});

test('config recusa numero sem sentido', () => {
  assert.equal(bot.salvarConfig({ falhasAteHumano: 0 }).ok, false);
  assert.equal(bot.salvarConfig({ falhasAteHumano: 3 }).ok, true);
});

/* ---- conversa que esfriou ----

   Quem volta no dia seguinte esta comecando assunto, nao continuando o de
   ontem. Sem corte de tempo, a mensagem nova era lida como resposta a um menu
   que ja saiu da tela dele — e o fluxo respondia sobre outra coisa. */

test('conversa parada ha mais de 12h recomeca do inicio', () => {
  bot.apagarFluxo();
  bot.salvarConfig({ ativo: true });
  bot.salvarFluxo([
    { id: 'inicio', mensagem: 'Oi! Sou a Micaela.', opcoes: [
      { tecla: '1', texto: 'Suporte', vaiPara: 'sup' },
      { tecla: '2', texto: 'Comercial', vaiPara: 'com' },
    ] },
    { id: 'sup', mensagem: 'Me conta o problema.', acao: 'coletar', vaiPara: 'com' },
    { id: 'com', mensagem: 'Passando pro comercial.', acao: 'encaminhar', departamento: 'comercial' },
  ]);

  // Ontem ele parou no passo de suporte, esperando a descricao do problema.
  bot.atender('1', { de: '5531900000001' });
  const conversas = bot.emAtendimento;               // so pra garantir que o modulo esta vivo
  assert.ok(typeof conversas === 'function');

  // Envelhece a conversa na marra e manda "2" hoje.
  const arq = join(dir, 'conversas.json');
  const d = JSON.parse(readFileSync(arq, 'utf8'));
  d['5531900000001'].em = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
  writeFileSync(arq, JSON.stringify(d));

  const r = bot.atender('2', { de: '5531900000001' });
  assert.match(r.texto, /Sou a Micaela|Suporte/, 'tem de voltar ao menu inicial, nao seguir de onde parou');
});

test('conversa RECENTE segue de onde parou', () => {
  bot.atender('oi', { de: '5531900000002' });
  const r = bot.atender('2', { de: '5531900000002' });
  assert.match(r.texto, /comercial/i, 'menos de 12h: continua a mesma conversa');
});

/* ---- o simulador tem de testar a Micaela QUE EXISTE ----

   Ele passava so pelas regras por palavra e nunca pela arvore. Quem abria a
   tela pra conferir via uma Micaela que nao era a do WhatsApp — e so descobria
   o comportamento real com um cliente do outro lado, que e exatamente o lugar
   onde nao se descobre nada de graca. */

test('com fluxo cadastrado, o simulador passa pela ARVORE', () => {
  bot.apagarFluxo();
  bot.salvarConfig({ ativo: true });
  bot.salvarFluxo([
    { id: 'inicio', mensagem: 'Oi! Sou a Micaela.', opcoes: [
      { tecla: '1', texto: 'Financeiro', vaiPara: 'fin' },
      { tecla: '2', texto: 'Suporte', vaiPara: 'sup' },
    ] },
    { id: 'fin', mensagem: 'Passando pro financeiro.', acao: 'encaminhar', departamento: 'financeiro' },
    { id: 'sup', mensagem: 'Passando pro suporte.', acao: 'encaminhar', departamento: 'suporte' },
  ]);

  const r = bot.simular(['oi', 'meu boleto venceu']);
  assert.equal(r.comFluxo, true);
  assert.match(r.turnos[0].texto, /Sou a Micaela/);
  assert.equal(r.turnos[1].departamento, 'financeiro', 'a frase solta tem de achar o caminho, igual no WhatsApp');
});

test('a simulacao NAO deixa rastro em conversa nenhuma', () => {
  const antes = JSON.stringify(bot.emAtendimento());
  bot.simular(['oi', 'meu boleto venceu']);
  assert.equal(JSON.stringify(bot.emAtendimento()), antes, 'testar nao pode mexer no atendimento real');
});

test('duas simulacoes seguidas comecam do zero — a segunda nao herda a primeira', () => {
  const a = bot.simular(['oi']);
  const b = bot.simular(['oi']);
  assert.equal(a.turnos[0].texto, b.turnos[0].texto, 'senao a segunda responderia no meio do assunto da primeira');
});

/* ---- assinatura: quem esta falando, no numero compartilhado ----

   Enquanto a Micaela mora no numero pessoal do dono, o WhatsApp mostra a foto
   e o nome DELE em tudo que ela escreve. O cliente acha que e ele digitando.
   Assinar e o que empresa seria faz quando gente e robo dividem a linha. */

test('mensagem do fluxo sai assinada', () => {
  bot.apagarFluxo();
  bot.salvarConfig({ ativo: true, nome: 'Micaela', assinarMensagens: true });
  bot.salvarFluxo([
    { id: 'inicio', mensagem: 'Qual assunto?', opcoes: [{ tecla: '1', texto: 'Financeiro', vaiPara: 'fin' }] },
    { id: 'fin', mensagem: 'Passando pro financeiro.', acao: 'encaminhar', departamento: 'financeiro' },
  ]);
  const r = bot.atender('1', { de: '5531900000010' });
  assert.match(r.texto, /^\*Micaela:\* /, 'o cliente precisa saber com quem fala');
});

test('quando o texto JA se apresenta, nao assina — "Micaela: Sou a Micaela" e bobo', () => {
  bot.salvarFluxo([
    { id: 'inicio', mensagem: 'Olá! Sou a Micaela, da Veloso Solution.', opcoes: [
      { tecla: '1', texto: 'Financeiro', vaiPara: 'fin' }] },
    { id: 'fin', mensagem: 'Passando pro financeiro.', acao: 'encaminhar', departamento: 'financeiro' },
  ]);
  const r = bot.atender('oi', { de: '5531900000011' });
  assert.doesNotMatch(r.texto, /^\*Micaela:\*/);
  assert.match(r.texto, /Sou a Micaela/);
});

test('com numero proprio a assinatura se desliga', () => {
  bot.salvarConfig({ assinarMensagens: false });
  bot.salvarFluxo([
    { id: 'inicio', mensagem: 'Qual assunto?', opcoes: [{ tecla: '1', texto: 'Financeiro', vaiPara: 'fin' }] },
    { id: 'fin', mensagem: 'Passando pro financeiro.', acao: 'encaminhar', departamento: 'financeiro' },
  ]);
  const r = bot.atender('1', { de: '5531900000012' });
  assert.doesNotMatch(r.texto, /^\*Micaela:\*/);
  bot.salvarConfig({ assinarMensagens: true });
});

/* ---- protocolo e retomada, ponta a ponta no bot ----

   A promessa: "continua de onde paramos". Quebrar isso e pior do que nunca ter
   prometido — e e o comportamento padrao de quase todo atendimento automatico,
   que manda voce repetir tudo desde o "digite 1". */

const proto = await import('../engine/vsprotocolo/index.mjs');

test('a primeira resposta ja vem com protocolo', () => {
  bot.apagarFluxo();
  bot.salvarConfig({ ativo: true, nome: 'Micaela' });
  bot.salvarFluxo([
    { id: 'inicio', mensagem: 'Oi! Sou a Micaela.', opcoes: [
      { tecla: '1', texto: 'Financeiro', vaiPara: 'fin' },
      { tecla: '2', texto: 'Suporte', vaiPara: 'sup' } ] },
    { id: 'fin', mensagem: 'Qual o assunto?', acao: 'coletar', vaiPara: 'fila_fin' },
    { id: 'fila_fin', mensagem: 'Passando pro financeiro.', acao: 'encaminhar', departamento: 'financeiro' },
    { id: 'sup', mensagem: 'Passando pro suporte.', acao: 'encaminhar', departamento: 'suporte' },
  ]);
  const r = bot.atender('oi', { de: '5531900100' });
  assert.match(r.protocolo, /^VS-\d{6}-[0-9A-Z]{4}$/);
});

test('encerrado por silencio, voltar retoma o MESMO protocolo no passo certo', () => {
  bot.atender('1', { de: '5531900100' });            // entrou no financeiro
  const numero = proto.aberto('5531900100').numero;
  proto.varrerInativos({ quando: new Date(Date.now() + 10 * 60000).toISOString() });
  assert.equal(proto.aberto('5531900100'), null, 'encerrou');

  const volta = bot.atender('oi de novo', { de: '5531900100' });
  assert.equal(volta.protocolo, numero, 'mesmo problema, mesmo protocolo');
  assert.match(volta.texto, /continuar de onde paramos/i);
});

test('quem ja estava na FILA volta pra fila — nao passa pela Micaela de novo', () => {
  bot.atender('oi', { de: '5531900200' });  // a primeira mensagem sempre abre o menu
  bot.atender('2', { de: '5531900200' });  // suporte: encaminha na hora
  const numero = proto.aberto('5531900200').numero;
  assert.equal(proto.aberto('5531900200').estado, proto.ESTADOS.NA_FILA);

  proto.varrerInativos({ quando: new Date(Date.now() + 10 * 60000).toISOString() });
  const volta = bot.atender('oi', { de: '5531900200' });
  assert.equal(volta.handoff, true, 'nao pode cair no menu de novo');
  assert.equal(volta.departamento, 'suporte');
  assert.equal(volta.protocolo, numero);
  assert.match(volta.texto, /guardei seu lugar|de volta na fila/i);
});

test('o simulador NAO deixa protocolo de mentira no historico', () => {
  const antes = proto.listar().length;
  bot.simular(['oi', '1']);
  assert.equal(proto.listar().length, antes, 'testar nao pode encher o historico');
});

test('o dono assumindo a conversa CALA a Micaela naquela conversa', () => {
  bot.apagarFluxo();
  bot.salvarConfig({ ativo: true, nome: 'Micaela' });
  bot.salvarFluxo([
    { id: 'inicio', mensagem: 'Oi! Sou a Micaela.', opcoes: [{ tecla: '1', texto: 'Suporte', vaiPara: 'sup' }] },
    { id: 'sup', mensagem: 'Passando pro suporte.', acao: 'encaminhar', departamento: 'suporte' },
  ]);
  const cliente = '5531900300';
  assert.match(bot.atender('oi', { de: cliente }).texto, /Sou a Micaela/);

  const r = bot.assumirConversa(cliente);
  assert.equal(r.ok, true);
  assert.equal(r.novo, true);

  const depois = bot.atender('me ajuda ai', { de: cliente });
  assert.equal(depois.calado, true, 'ela nao pode falar por cima de quem esta atendendo');
  assert.equal(depois.texto, '');
});

test('assumir de novo renova o silencio — enquanto o dono digita, ela fica fora', () => {
  const cliente = '5531900300';
  const r = bot.assumirConversa(cliente);
  assert.equal(r.ok, true);
  assert.equal(r.novo, false, 'ja estava assumida: nao precisa avisar de novo no log');
  assert.equal(bot.atender('e ai?', { de: cliente }).calado, true);
});

test('devolver pra Micaela faz ela voltar a atender', () => {
  const cliente = '5531900300';
  bot.devolverAoBot(cliente);
  assert.match(bot.atender('oi', { de: cliente }).texto, /Sou a Micaela/);
});

/* ---- mudar de assunto no meio do menu ----

   Em campo, no teste do cliente: a pessoa estava no menu do financeiro e
   escreveu "o sistema travou e nao consigo entrar". Ouviu "nao achei isso nas
   opcoes". Ela tinha MUDADO DE ASSUNTO — e mudar de assunto e direito de quem
   esta conversando, nao erro de digitacao. */

test('mudar de assunto dentro de um menu leva pro galho novo', () => {
  bot.apagarFluxo();
  bot.salvarConfig({ ativo: true, nome: 'Micaela' });
  bot.salvarFluxo([
    { id: 'inicio', mensagem: 'Oi!', opcoes: [
      { tecla: '1', texto: 'Financeiro', vaiPara: 'financeiro' },
      { tecla: '2', texto: 'Suporte', vaiPara: 'suporte' } ] },
    { id: 'financeiro', mensagem: 'Qual o assunto financeiro?', opcoes: [
      { tecla: '1', texto: 'Boleto', acao: 'encaminhar', departamento: 'financeiro' } ] },
    { id: 'suporte', mensagem: 'Qual situação descreve o problema?', opcoes: [
      { tecla: '1', texto: 'Não abre', acao: 'encaminhar', departamento: 'suporte' } ] },
  ]);
  const de = '5531901000';
  bot.atender('oi', { de });
  bot.atender('1', { de });                       // entrou no financeiro
  const r = bot.atender('o sistema travou e nao consigo entrar', { de });
  assert.match(r.texto, /Qual situação descreve/, 'mudou de assunto: vai pro suporte');
});

test('o que NAO casa com nada continua devolvendo o menu do lugar onde esta', () => {
  const de = '5531901001';
  bot.atender('oi', { de });
  bot.atender('1', { de });
  const r = bot.atender('xpto banana 42', { de });
  assert.equal(r.erroDeEscolha, true);
  assert.match(r.texto, /Qual o assunto financeiro/, 'nao pode jogar a pessoa de volta pro inicio');
});

/* ---- audio depois do handoff ----

   Em campo: a pessoa pediu para falar com gente, foi encaminhada, mandou um
   audio em seguida — e o bot respondeu por cima do atendente com "nao consigo
   ouvir audio". Quem assumiu a conversa CONSEGUE ouvir. */

test('depois do handoff, estaComGente diz que o bot tem de ficar fora', () => {
  const de = '5531901002';
  bot.atender('oi', { de });
  assert.equal(bot.estaComGente(de), false);
  bot.assumirConversa(de);
  assert.equal(bot.estaComGente(de), true);
});

test('devolver pra Micaela libera o caminho de novo', () => {
  const de = '5531901002';
  bot.devolverAoBot(de);
  assert.equal(bot.estaComGente(de), false);
});

test('quem nunca conversou nao esta com gente', () => {
  assert.equal(bot.estaComGente('5531909999'), false);
});

/* ---- quem fica esperando na fila ----

   "Depois que passa pra fila ja era, morre." E era verdade: o silencio
   pos-handoff existe pro bot nao falar por cima do atendente, mas SEM atendente
   ele virava abandono — a pessoa escrevia, era encaminhada, e sumia todo mundo
   por quatro horas. Do lado dela, o atendimento morreu. */

test('quem acabou de entrar na fila NAO e resgatado — o atendente merece uns minutos', () => {
  bot.apagarFluxo();
  bot.salvarConfig({ ativo: true, nome: 'Micaela' });
  bot.salvarFluxo([
    { id: 'inicio', mensagem: 'Oi!', opcoes: [{ tecla: '1', texto: 'Falar com uma pessoa', acao: 'encaminhar', departamento: 'humano' }] },
  ]);
  const de = '5531902000';
  bot.atender('oi', { de });
  bot.atender('1', { de });
  assert.equal(bot.aguardandoHaMais(10).some((x) => x.de === de), false);
});

test('passados os minutos, ele aparece na lista de quem precisa ser resgatado', () => {
  const de = '5531902000';
  const daqui = Date.now() + 11 * 60000;
  const espera = bot.aguardandoHaMais(10, daqui).find((x) => x.de === de);
  assert.ok(espera, 'quem esperou 11 minutos sem resposta nao pode ficar invisivel');
  assert.equal(espera.departamento, 'humano');
  assert.ok(espera.minutos >= 10);
});

test('resgatado UMA vez — aviso repetido de espera vira alarme, e o cliente bloqueia', () => {
  const de = '5531902000';
  bot.marcarResgatada(de);
  assert.equal(bot.aguardandoHaMais(10, Date.now() + 60 * 60000).some((x) => x.de === de), false);
});

test('se alguem de casa escreve, o relogio reinicia — nao se resgata quem ja esta sendo atendido', () => {
  const de = '5531902001';
  bot.atender('oi', { de });
  bot.atender('1', { de });
  const daqui = Date.now() + 11 * 60000;
  assert.ok(bot.aguardandoHaMais(10, daqui).some((x) => x.de === de), 'esperando');

  bot.assumirConversa(de);   // o dono entrou na conversa
  assert.equal(bot.aguardandoHaMais(10, daqui).some((x) => x.de === de), false,
    'com gente atendendo, resgatar seria falar por cima do atendente');
});

test('conversa que nunca foi pra fila nao entra na varredura', () => {
  const de = '5531902002';
  bot.atender('oi', { de });
  assert.equal(bot.aguardandoHaMais(0, Date.now() + 999999).some((x) => x.de === de), false);
});

test('marcar resgate de conversa inexistente devolve erro em vez de fingir', () => {
  assert.equal(bot.marcarResgatada('5531999999').ok, false);
});
