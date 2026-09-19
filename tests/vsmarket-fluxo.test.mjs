import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizarPedido, podeIr, ROTULO } from '../engine/vsmarket/pedido.mjs';
import {
  normalizarProposta, ranquear, segundaSugestao, selecionar, aceitar,
  segundosRestantes, expirouAceite, expirar, valida, montarCard, ACEITE_SEG,
} from '../engine/vsmarket/proposta.mjs';
import {
  congelarEscopo, aceitarEscopo, criarOrdem, moverOrdem, osPodeIr, timeline,
  normalizarAvaliacao, media, abrirDisputa, resolverDisputa, OS_ROTULO,
} from '../engine/vsmarket/ordem.mjs';
import { criarSimulado } from '../marketplace/gateway-simulado.mjs';

const dir = mkdtempSync(join(tmpdir(), 'qg-'));
process.env.VSMARKET_DIR = dir;
const vs = await import('../engine/vsmarket/index.mjs');
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

/* ── pedido ── */

test('pedido exige descricao com conteudo — "quebrou" nao da pra orcar', () => {
  const r = normalizarPedido({ categoria: 'eletrica', descricao: 'quebrou', lat: -19.92, lng: -43.93, cidade: 'BH' });
  assert.ok(r.erros.some((e) => /mínimo 15 caracteres/.test(e)));
});

test('pedido sem localizacao valida é recusado', () => {
  const r = normalizarPedido({ categoria: 'eletrica', descricao: 'A tomada do quarto parou de funcionar', cidade: 'BH' });
  assert.ok(r.erros.some((e) => /localização/.test(e)));
});

test('sem foto é AVISO, nao erro', () => {
  const r = normalizarPedido({ categoria: 'eletrica', descricao: 'A tomada do quarto parou de funcionar', lat: -19.92, lng: -43.93, cidade: 'BH' });
  assert.deepEqual(r.erros, []);
  assert.ok(r.avisos.some((a) => /sem fotos/.test(a)));
});

test('pedido nao pula de rascunho direto para contratado', () => {
  assert.equal(podeIr('DRAFT', 'CONVERTED').ok, false);
  assert.equal(podeIr('DRAFT', 'OPEN').ok, true);
});

test('o estado tem rotulo que o cliente entende', () => {
  assert.equal(ROTULO.RECEIVING_QUOTES, 'Recebendo propostas');
});

/* ── proposta ── */

const prop = (extra = {}) => normalizarProposta({
  pedidoId: 'p1', prestadorId: 'x1', valorCentavos: 20000, prazoDias: 1,
  escopo: 'Troca da tomada e teste', ...extra,
}).proposta;

test('proposta exige valor, prazo e escopo', () => {
  const r = normalizarProposta({ pedidoId: 'p1', prestadorId: 'x1' });
  assert.ok(r.erros.some((e) => /valor inválido/.test(e)));
  assert.ok(r.erros.some((e) => /quantos dias/.test(e)));
  assert.ok(r.erros.some((e) => /o que está incluído/.test(e)));
});

test('proposta vencida deixa de ser valida', () => {
  const p = prop({ validadeHoras: 1, quando: '2026-01-01T00:00:00.000Z' });
  assert.equal(valida(p, Date.parse('2026-01-01T00:30:00Z')), true);
  assert.equal(valida(p, Date.parse('2026-01-01T02:00:00Z')), false);
});

const card = (o) => ({ id: o.id, nome: o.nome, nota: o.nota, servicos: o.servicos ?? 10, distanciaKm: o.d ?? 2, valorCentavos: o.v, prazoDias: 1, status: 'ENVIADA' });

test('o ranking NAO é so preco — nota e distancia pesam', () => {
  const r = ranquear([
    card({ id: 'barato', nome: 'Barato', nota: 2.0, v: 10000, d: 9 }),
    card({ id: 'bom', nome: 'Bom', nota: 5.0, v: 12000, d: 1, servicos: 100 }),
  ]);
  assert.equal(r[0].id, 'bom', 'o mais barato com nota 2 nao pode liderar');
});

test('quem é novo nao é premiado nem punido — entra no meio', () => {
  const r = ranquear([
    card({ id: 'ruim', nome: 'Ruim', nota: 2.0, v: 10000 }),
    card({ id: 'novo', nome: 'Novo', nota: null, v: 10000 }),
    card({ id: 'otimo', nome: 'Otimo', nota: 5.0, v: 10000, servicos: 100 }),
  ]);
  assert.deepEqual(r.map((x) => x.id), ['otimo', 'novo', 'ruim']);
});

test('apresenta no maximo 5 propostas', () => {
  const muitos = Array.from({ length: 12 }, (_, i) => card({ id: 'c' + i, nome: 'C' + i, nota: 4, v: 10000 + i }));
  assert.equal(ranquear(muitos).length, 5);
});

test('card do cliente traz nota, servicos e distancia — nunca so preco', () => {
  const c = montarCard(prop(), { id: 'x1', nome: 'Carlos', reputacao: 4.9, servicosConcluidos: 127, categorias: ['eletrica'] }, 2.3);
  for (const k of ['nome', 'nota', 'servicos', 'distanciaKm', 'valorCentavos', 'prazoDias', 'escopo']) {
    assert.ok(c[k] !== undefined, 'faltou ' + k);
  }
});

test('prestador sem avaliacao aparece como NOVO, nao como nota zero', () => {
  const c = montarCard(prop(), { id: 'x', nome: 'Novo', reputacao: null, servicosConcluidos: 0 }, 1);
  assert.equal(c.nota, null);
  assert.equal(c.novo, true);
});

/* ── proteção do cliente ── */

test('escolha de nota baixa dispara a segunda sugestao, com alternativa concreta', () => {
  const todos = [
    card({ id: 'ruim', nome: 'Rafa', nota: 3.6, v: 17000, servicos: 19 }),
    card({ id: 'bom', nome: 'Carlos', nota: 4.9, v: 22000, servicos: 127 }),
  ];
  const s = segundaSugestao(todos[0], todos);
  assert.ok(s, 'deveria avisar');
  assert.equal(s.alternativa.nome, 'Carlos');
  assert.equal(s.diferencaCentavos, 5000);
  assert.match(s.texto, /R\$\s*50,00 a mais, Carlos tem nota 4\.9 e 127 serviços/);
});

test('nota boa NAO gera aviso — aviso generico vira ruido', () => {
  const todos = [card({ id: 'a', nome: 'A', nota: 4.5, v: 10000 }), card({ id: 'b', nome: 'B', nota: 5, v: 20000 })];
  assert.equal(segundaSugestao(todos[0], todos), null);
});

test('prestador NOVO nao leva aviso: ausencia de historico nao é historico ruim', () => {
  const todos = [card({ id: 'novo', nome: 'Novo', nota: null, v: 10000 }), card({ id: 'b', nome: 'B', nota: 5, v: 20000 })];
  assert.equal(segundaSugestao(todos[0], todos), null);
});

test('sem alternativa melhor, nao inventa aviso', () => {
  const todos = [card({ id: 'a', nome: 'A', nota: 2, v: 10000 })];
  assert.equal(segundaSugestao(todos[0], todos), null);
});

/* ── janela de aceite ── */

test('janela de aceite é de 5 minutos e o contador decresce', () => {
  const t0 = Date.parse('2026-09-19T12:00:00Z');
  const r = selecionar(prop(), t0);
  assert.equal(segundosRestantes(r.proposta, t0), ACEITE_SEG);
  assert.equal(segundosRestantes(r.proposta, t0 + 120000), 180);
  assert.equal(segundosRestantes(r.proposta, t0 + 400000), 0);
});

test('aceite dentro da janela vale; fora, nao', () => {
  const t0 = Date.parse('2026-09-19T12:00:00Z');
  const sel = selecionar(prop(), t0).proposta;
  assert.equal(aceitar(sel, t0 + 60000).proposta.status, 'ACEITA');
  const tarde = aceitar(sel, t0 + 400000);
  assert.equal(tarde.proposta.status, 'EXPIRADA_ACEITE');
  assert.match(tarde.erro, /prazo de confirmação acabou/);
});

test('ao expirar, a PROXIMA melhor ja vem junto — o cliente nao recomeca', () => {
  const t0 = Date.parse('2026-09-19T12:00:00Z');
  const sel = selecionar(prop({ prestadorId: 'a' }), t0).proposta;
  const outras = [
    { ...card({ id: sel.id, nome: 'Escolhido', nota: 3, v: 20000 }), status: 'ENVIADA' },
    { ...card({ id: 'outra', nome: 'Outro', nota: 4.8, v: 21000, servicos: 90 }), status: 'ENVIADA' },
  ];
  const r = expirar(sel, outras, t0 + 400000);
  assert.equal(r.proposta.status, 'EXPIRADA_ACEITE');
  assert.equal(r.proxima.id, 'outra');
});

/* ── escopo ── */

test('escopo congelado tem hash e versao', () => {
  const r = congelarEscopo({ pedidoId: 'p', propostaId: 'q', valorCentavos: 20000, incluido: 'Troca da tomada' });
  assert.deepEqual(r.erros, []);
  assert.equal(r.escopo.versao, 1);
  assert.match(r.escopo.hash, /^[a-f0-9]{64}$/);
});

test('mudar QUALQUER campo muda o hash — é o que prova adulteracao', () => {
  const a = congelarEscopo({ pedidoId: 'p', propostaId: 'q', valorCentavos: 20000, incluido: 'Troca da tomada' }).escopo;
  const b = congelarEscopo({ pedidoId: 'p', propostaId: 'q', valorCentavos: 20001, incluido: 'Troca da tomada' }).escopo;
  assert.notEqual(a.hash, b.hash);
});

test('o escopo so fecha com o aceite das DUAS partes', () => {
  const e = congelarEscopo({ pedidoId: 'p', propostaId: 'q', valorCentavos: 100, incluido: 'x' }).escopo;
  const a = aceitarEscopo(e, 'cliente');
  assert.equal(a.fechado, false, 'um aceite so nao fecha contrato');
  const b = aceitarEscopo(a.escopo, 'prestador');
  assert.equal(b.fechado, true);
});

/* ── ordem de serviço ── */

test('OS nao pula estado critico', () => {
  assert.equal(osPodeIr('CREATED', 'COMPLETED').ok, false);
  assert.equal(osPodeIr('CREATED', 'PAID').ok, true);
  assert.match(osPodeIr('PAID', 'COMPLETED').motivo, /não dá pra ir de "Pago" para "Concluído"/);
});

test('timeline separa o que passou, o agora e o que falta', () => {
  let o = criarOrdem({ pedidoId: 'p', escopoId: 'e' }).ordem;
  o = moverOrdem(o, 'PAID').ordem;
  const t = timeline(o);
  assert.equal(t.passos[0].feito, true);
  assert.equal(t.passos[1].atual, true);
  assert.equal(t.passos[2].feito, false);
  assert.equal(t.desvio, null);
});

test('contestacao aparece como DESVIO, nao como passo do trilho', () => {
  let o = criarOrdem({ pedidoId: 'p', escopoId: 'e' }).ordem;
  for (const s of ['PAID', 'SCHEDULED', 'IN_PROGRESS', 'AWAITING_CUSTOMER_ACCEPTANCE', 'DISPUTED']) {
    o = moverOrdem(o, s).ordem;
  }
  assert.equal(timeline(o).desvio.rotulo, OS_ROTULO.DISPUTED);
});

/* ── avaliação ── */

test('avaliacao aceita so de 1 a 5', () => {
  assert.ok(normalizarAvaliacao({ ordemId: 'o', estrelas: 0 }).erros.length);
  assert.ok(normalizarAvaliacao({ ordemId: 'o', estrelas: 6 }).erros.length);
  assert.deepEqual(normalizarAvaliacao({ ordemId: 'o', estrelas: 5 }).erros, []);
});

test('sem avaliacao a media é null, nunca 0 — zero esconderia o novato pra sempre', () => {
  assert.equal(media([]), null);
  assert.equal(media([{ estrelas: 5 }, { estrelas: 4 }]), 4.5);
});

/* ── contestação ── */

test('contestacao exige motivo do catalogo e descricao com conteudo', () => {
  assert.ok(abrirDisputa({ ordemId: 'o', motivo: 'sei_la', descricao: 'x'.repeat(30) }).erros.some((e) => /motivo/.test(e)));
  assert.ok(abrirDisputa({ ordemId: 'o', motivo: 'dano', descricao: 'quebrou' }).erros.some((e) => /detalhe/.test(e)));
});

test('a disputa NAO acusa ninguem ao abrir', () => {
  const d = abrirDisputa({ ordemId: 'o', motivo: 'dano', descricao: 'Quebraram o azulejo do banheiro durante o serviço' }).disputa;
  assert.equal(d.resultado, null);
  assert.equal(d.status, 'ABERTA');
});

test('resolver exige laudo, e a consequencia financeira fica PENDENTE de politica', () => {
  const d = abrirDisputa({ ordemId: 'o', motivo: 'dano', descricao: 'Quebraram o azulejo do banheiro durante o serviço' }).disputa;
  assert.match(resolverDisputa(d, { resultado: 'PARTIAL' }).erro, /laudo é obrigatório/);
  const r = resolverDisputa(d, { resultado: 'PARTIAL', laudo: 'Dano confirmado pelas fotos.' });
  assert.equal(r.disputa.resultado, 'PARTIAL');
  assert.equal(r.disputa.consequenciaFinanceira, null);
  assert.equal(r.disputa.pendenteDePolitica, true, 'o valor depende de politica juridica (BDR-05)');
});

/* ── fluxo ponta a ponta, pela orquestração real ── */

test('ponta a ponta: pedido -> proposta -> escolha -> aceite -> escopo -> pagamento -> OS -> avaliacao', async () => {
  vs.semear();
  const prestadores = vs.prestadores();

  const p = vs.fluxo.criarPedido({
    categoria: 'eletrica', descricao: 'A tomada do quarto parou de funcionar e o disjuntor cai.',
    lat: -19.9245, lng: -43.9352, cidade: 'Belo Horizonte', bairro: 'Centro',
  }, prestadores);
  assert.equal(p.ok, true);
  assert.ok(p.convidados.length > 0, 'ninguem foi convidado');

  const sim = vs.fluxo.simularPropostas(p.pedido.id, prestadores, vs.categorias());
  assert.ok(sim.criadas >= 2);

  const lista = vs.fluxo.propostasDoPedido(p.pedido.id, prestadores);
  assert.ok(lista.cards.length >= 2);

  const escolha = vs.fluxo.escolherProposta(lista.cards[0].id, prestadores);
  assert.equal(escolha.ok, true);
  assert.equal(escolha.segundosRestantes, ACEITE_SEG);

  assert.equal(vs.fluxo.aceitarProposta(lista.cards[0].id).ok, true);

  const esc = vs.fluxo.congelarEscopo(lista.cards[0].id);
  assert.equal(esc.ok, true);

  // pagar ANTES dos dois aceites tem que ser recusado
  const cedo = await vs.fluxo.pagar(esc.escopo.id, { metodo: 'PIX', percentualPrestador: 80 }, criarSimulado());
  assert.match(cedo.erro, /aceite das duas partes/);

  vs.fluxo.aceitarEscopo(esc.escopo.id, 'cliente');
  vs.fluxo.aceitarEscopo(esc.escopo.id, 'prestador');

  const pag = await vs.fluxo.pagar(esc.escopo.id, { metodo: 'PIX', percentualPrestador: 80 }, criarSimulado());
  assert.equal(pag.ok, true);
  assert.equal(pag.pagamento.prestadorCentavos + pag.pagamento.plataformaCentavos, pag.pagamento.valorCentavos,
    'o split precisa fechar exatamente — nao pode sobrar nem sumir centavo');
  assert.equal(pag.ordem.status, 'PAID');

  let os = pag.ordem.id;
  for (const s of ['SCHEDULED', 'PROVIDER_ON_THE_WAY', 'IN_PROGRESS', 'AWAITING_CUSTOMER_ACCEPTANCE']) {
    assert.equal(vs.fluxo.moverOrdem(os, s).ok, true, 'falhou em ' + s);
  }
  // avaliar antes de concluir nao pode
  assert.ok(vs.fluxo.avaliar({ ordemId: os, estrelas: 5 }).erros.some((e) => /depois que o serviço é concluído/.test(e)));

  assert.equal(vs.fluxo.moverOrdem(os, 'COMPLETED').ok, true);
  assert.equal(vs.fluxo.avaliar({ ordemId: os, estrelas: 5, comentario: 'Resolveu rápido' }).ok, true);
  assert.ok(vs.fluxo.avaliar({ ordemId: os, estrelas: 4 }).erros.some((e) => /já foi avaliada/.test(e)));

  const n = vs.fluxo.numeros();
  assert.ok(n.gmvCentavos > 0 && n.receitaCentavos > 0);
  assert.equal(n.concluidos, 1);
});

test('ganhos do prestador MOSTRAM a taxa — nunca escondida', () => {
  const comOrdem = vs.fluxo.ordens()[0];
  const g = vs.fluxo.ganhosDoPrestador(comOrdem.prestadorId);
  assert.ok(g.linhas.length > 0);
  const l = g.linhas[0];
  assert.ok(l.taxaCentavos > 0, 'a taxa precisa aparecer');
  assert.equal(l.brutoCentavos - l.taxaCentavos, l.recebeCentavos);
});

test('prestador nao convidado nao consegue propor', () => {
  const p = vs.fluxo.pedidos()[0];
  const r = vs.fluxo.enviarProposta({ pedidoId: p.id, prestadorId: 'prs_intruso', valorCentavos: 100, prazoDias: 1, escopo: 'qualquer coisa' });
  assert.equal(r.ok, false);
  assert.ok(r.erros.some((e) => /não foi convidado/.test(e)));
});

/* ── identificação do cliente: contato no FIM, e privacidade ── */

test('pedido SEM telefone é recusado — sem contato nao ha como avisar das propostas', () => {
  const r = vs.fluxo.identificarCliente({ nome: 'Maria', clientes: [] }, () => ({ ok: true }));
  assert.equal(r.ok, false);
  assert.ok(r.erros.some((e) => /telefone/.test(e)));
});

test('telefone repetido REUSA o cliente, em qualquer formato', () => {
  const existentes = [{ id: 'c1', nome: 'Maria', telefone: '5531999990000' }];
  for (const t of ['31999990000', '(31) 99999-0000', '+55 31 99999-0000']) {
    const r = vs.fluxo.identificarCliente({ nome: 'Maria', telefone: t, clientes: existentes }, () => {
      throw new Error('nao deveria criar outro cliente');
    });
    assert.equal(r.reusado, true, 'falhou com ' + t);
    assert.equal(r.cliente.id, 'c1');
  }
});

test('telefone novo cria cliente, passando pela validacao real', () => {
  let recebido = null;
  const r = vs.fluxo.identificarCliente(
    { nome: 'Joana', telefone: '31988887777', aceitouTermos: true, clientes: [] },
    (x) => { recebido = x; return { ok: true, cliente: { id: 'novo', nome: 'Joana' } }; },
  );
  assert.equal(r.ok, true);
  assert.equal(r.reusado, false);
  assert.equal(recebido.aceitouTermos, true, 'o aceite dos termos tem que chegar no cadastro');
});

test('o pedido guarda SO o primeiro nome — sobrenome e telefone ficam no cadastro', () => {
  const { pedido } = vs.fluxo.ped.normalizarPedido({
    categoria: 'eletrica', descricao: 'A tomada do quarto parou de funcionar de vez',
    lat: -19.92, lng: -43.93, cidade: 'BH', clienteNome: 'Maria Souza Oliveira',
  });
  assert.equal(pedido.clienteNome, 'Maria');
});

test('o resumo que o PRESTADOR ve nao carrega contato — o negocio nao sai da plataforma', () => {
  const { pedido } = vs.fluxo.ped.normalizarPedido({
    categoria: 'eletrica', descricao: 'A tomada do quarto parou de funcionar de vez',
    lat: -19.92, lng: -43.93, cidade: 'BH', bairro: 'Centro', clienteNome: 'Maria Souza',
  });
  const r = vs.fluxo.ped.resumo({ ...pedido, clienteId: 'c1' });
  const txt = JSON.stringify(r).toLowerCase();
  assert.ok(!/telefone|whats|\d{10,}/.test(txt), 'vazou contato no resumo');
  assert.ok(!txt.includes('souza'), 'vazou sobrenome');
  // mas o que ele PRECISA para orcar continua ali
  assert.equal(r.bairro, 'Centro');
  assert.ok(r.descricao.length > 10);
});
