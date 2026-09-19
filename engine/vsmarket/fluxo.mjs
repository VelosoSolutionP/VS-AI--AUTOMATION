/**
 * Quebra-Galho — o fluxo completo, de ponta a ponta.
 *
 * Pedido → propostas → escolha → aceite (com prazo) → escopo congelado → pagamento
 * → ordem de serviço → conclusão → avaliação, com desvio para contestação.
 *
 * Só I/O e composição: as regras vivem em pedido.mjs, proposta.mjs e ordem.mjs.
 */
import { load, save } from './store.mjs';
import * as ped from './pedido.mjs';
import * as prp from './proposta.mjs';
import * as ord from './ordem.mjs';
import { atende, distanciaKm } from './geo.mjs';
import * as pag from './pagamento.mjs';
import * as qua from './qualidade.mjs';
import { PARTICIPA_MATCHING, prestadorPublico } from './cadastro.mjs';

const PEDIDOS = 'pedidos';
const PROPOSTAS = 'propostas';
const ESCOPOS = 'escopos';
const ORDENS = 'ordens';
const AVALIACOES = 'avaliacoes';
const DISPUTAS = 'disputas';
const PAGAMENTOS = 'pagamentos';
const INCIDENTES = 'incidentes';
const POLITICA = 'politica';

export { ped, prp, ord, pag, qua };

export const pedidos = () => load(PEDIDOS, []);
export const propostas = () => load(PROPOSTAS, []);
export const escopos = () => load(ESCOPOS, []);
export const ordens = () => load(ORDENS, []);
export const avaliacoes = () => load(AVALIACOES, []);
export const disputas = () => load(DISPUTAS, []);
export const pagamentos = () => load(PAGAMENTOS, []);
export const incidentes = () => load(INCIDENTES, []);
export const politica = () => load(POLITICA, qua.POLITICA_PADRAO);

const acharPedido = (id) => pedidos().find((p) => p.id === String(id)) || null;
const gravarPedido = (p) => { const t = pedidos(); const i = t.findIndex((x) => x.id === p.id); if (i < 0) { t.push(p); } else { t[i] = p; } save(PEDIDOS, t); return p; };
const gravarProposta = (p) => { const t = propostas(); const i = t.findIndex((x) => x.id === p.id); if (i < 0) { t.push(p); } else { t[i] = p; } save(PROPOSTAS, t); return p; };
const gravarOrdem = (o) => { const t = ordens(); const i = t.findIndex((x) => x.id === o.id); if (i < 0) { t.push(o); } else { t[i] = o; } save(ORDENS, t); return o; };

/* ---------------- 0. quem está pedindo ---------------- */

/**
 * Identifica o cliente NO MOMENTO do pedido, não antes.
 *
 * Pedir cadastro na entrada mata a conversão: a pessoa está com um problema, não
 * querendo criar conta. Mas publicar o pedido sem contato é pior — chegam três
 * propostas e não há como avisar ninguém. Então o contato é pedido no fim, quando a
 * pessoa já descreveu o problema e tem motivo para terminar.
 *
 * Coleta mínima (§3): nome e telefone. Sem documento, sem e-mail obrigatório.
 * Telefone repetido REUSA o cliente em vez de duplicar — é a mesma pessoa pedindo
 * de novo, e o histórico dela importa.
 */
export function identificarCliente(e = {}, criarClienteFn) {
  const tel = String(e.telefone || '').replace(/\D/g, '');
  if (!tel) { return { ok: false, erros: ['informe um telefone para receber as propostas'] }; }

  const { clientes } = e;
  const existente = (clientes || []).find((c) => String(c.telefone).replace(/\D/g, '').endsWith(tel.slice(-11)));
  if (existente) { return { ok: true, cliente: existente, reusado: true }; }

  const r = criarClienteFn({
    nome: e.nome, telefone: e.telefone, email: e.email,
    aceitouTermos: e.aceitouTermos,
    enderecos: e.endereco ? [e.endereco] : [],
  });
  if (!r.ok) { return { ok: false, erros: r.erros }; }
  return { ok: true, cliente: r.cliente, reusado: false };
}

/* ---------------- 1. pedido ---------------- */

/**
 * Cria e JÁ PUBLICA o pedido, convidando quem atende. Deixar em rascunho faria o
 * cliente terminar o cadastro e ficar sem nada acontecendo.
 */
export function criarPedido(entrada, listaPrestadores = []) {
  const r = ped.normalizarPedido(entrada);
  if (r.erros.length) { return { ok: false, erros: r.erros, avisos: r.avisos }; }

  let p = r.pedido;
  for (const alvo of ['OPEN', 'MATCHING']) {
    const t = ped.transitar(p, alvo);
    if (t.erro) { return { ok: false, erros: [t.erro] }; }
    p = t.pedido;
  }

  const destino = { lat: p.lat, lng: p.lng, cidade: p.cidade, bairro: p.bairro };
  const convidados = listaPrestadores
    .filter((x) => PARTICIPA_MATCHING.includes(x.status))
    .filter((x) => x.categorias.includes(p.categoria))
    .map((x) => ({ ...x, cobertura: atende(x, destino) }))
    .filter((x) => x.cobertura.atende)
    .map((x) => ({ prestadorId: x.id, nome: x.nome, motivo: x.cobertura.motivo, distanciaKm: distanciaKm(x.base, destino) }))
    .sort((a, b) => (a.distanciaKm ?? 999) - (b.distanciaKm ?? 999))
    .slice(0, 10);

  p.convidados = convidados;
  gravarPedido(p);
  return { ok: true, pedido: p, convidados, avisos: r.avisos };
}

/**
 * DEMONSTRAÇÃO: faz os convidados responderem na hora.
 *
 * Um pedido recém-criado legitimamente tem zero propostas — profissional de verdade
 * leva minutos ou horas para responder. Isso está certo no domínio e deixa o fluxo
 * impossível de percorrer numa demo. Então a simulação é EXPLÍCITA: passa pelo mesmo
 * `enviarProposta` (com validação e regra de convite), e cada proposta nasce marcada
 * como simulada. Nada aqui contorna regra — só encurta o tempo.
 */
export function simularPropostas(pedidoId, listaPrestadores = [], categorias = []) {
  const pedido = acharPedido(pedidoId);
  if (!pedido) { return { ok: false, erro: 'pedido não encontrado' }; }
  // O nome da categoria, não o id: "elétrica" é o que o cliente lê, "eletrica" não.
  const nomeCat = (categorias.find((c) => c.id === pedido.categoria)?.nome || pedido.categoria).toLowerCase();

  /** Faixa por categoria, em centavos. Base do orçamento simulado. */
  const BASE = { eletrica: 20000, hidraulica: 23000, pintura: 65000, montagem: 15000, manutencao: 28000, reparos: 18000 };
  const base = BASE[pedido.categoria] ?? 20000;
  const criadas = [];

  for (const [i, c] of pedido.convidados.slice(0, 3).entries()) {
    const pr = listaPrestadores.find((x) => x.id === c.prestadorId);
    if (!pr) { continue; }
    // Quem tem nota melhor cobra um pouco mais — é o que torna a comparação real.
    const fator = pr.reputacao == null ? 0.92 : 0.82 + (pr.reputacao / 5) * 0.3;
    const valor = Math.round((base * fator) / 500) * 500;
    // Escopos diferentes de propósito: três propostas iguais não dão o que comparar,
    // e comparar é justamente o que a tela precisa provar.
    const ESCOPOS = [
      `Visita, diagnóstico e execução do serviço de ${nomeCat}, com teste final e garantia de 90 dias.`,
      `Execução do serviço de ${nomeCat} conforme descrito no pedido. Limpeza do local incluída.`,
      `Avaliação no local e execução do serviço de ${nomeCat}. Eventuais peças extras orçadas à parte.`,
    ];
    const comMaterial = i % 2 === 0;
    const r = enviarProposta({
      pedidoId, prestadorId: pr.id,
      valorCentavos: valor,
      prazoDias: i === 0 ? 1 : i + 1,
      escopo: ESCOPOS[i] || ESCOPOS[0],
      materiaisInclusos: comMaterial,
      materiais: comMaterial ? 'Material básico incluído no valor' : null,
      // Nao repetir o que a linha de material ja diz — a tela ficava com o texto duplicado.
      naoIncluso: comMaterial ? null : 'Não inclui remoção de entulho',
      disponibilidade: ['Disponível hoje', 'Amanhã pela manhã', 'Esta semana'][i] || 'A combinar',
      simulada: true,
    });
    if (r.ok) { criadas.push(r.proposta.id); }
  }
  return { ok: true, criadas: criadas.length };
}

/* ---------------- 2. proposta ---------------- */

export function enviarProposta(entrada) {
  const pedido = acharPedido(entrada.pedidoId);
  if (!pedido) { return { ok: false, erros: ['pedido não encontrado'] }; }
  if (!['MATCHING', 'RECEIVING_QUOTES'].includes(pedido.status)) {
    return { ok: false, erros: [`este pedido não está recebendo propostas (${ped.ROTULO[pedido.status]})`] };
  }
  // Só quem foi convidado propõe: senão qualquer prestador varre a base.
  if (pedido.convidados.length && !pedido.convidados.some((c) => c.prestadorId === entrada.prestadorId)) {
    return { ok: false, erros: ['você não foi convidado para este pedido'] };
  }
  if (propostas().some((x) => x.pedidoId === pedido.id && x.prestadorId === entrada.prestadorId && x.status === 'ENVIADA')) {
    return { ok: false, erros: ['você já enviou uma proposta para este pedido'] };
  }

  const r = prp.normalizarProposta(entrada);
  if (r.erros.length) { return { ok: false, erros: r.erros }; }
  gravarProposta(r.proposta);

  if (pedido.status === 'MATCHING') { gravarPedido(ped.transitar(pedido, 'RECEIVING_QUOTES').pedido); }
  return { ok: true, proposta: r.proposta };
}

/** As melhores propostas, já no formato do card e ranqueadas. */
export function propostasDoPedido(pedidoId, listaPrestadores = [], agora = Date.now()) {
  const pedido = acharPedido(pedidoId);
  if (!pedido) { return { ok: false, erro: 'pedido não encontrado' }; }
  const destino = { lat: pedido.lat, lng: pedido.lng };

  const validas = propostas()
    .filter((x) => x.pedidoId === pedido.id && prp.valida(x, agora))
    .map((x) => {
      const pr = listaPrestadores.find((y) => y.id === x.prestadorId);
      if (!pr) { return null; }
      return prp.montarCard(x, pr, distanciaKm(pr.base, destino));
    })
    .filter(Boolean);

  return { ok: true, pedido, cards: prp.ranquear(validas), total: validas.length };
}

/** Escolha do cliente: abre a janela de aceite e devolve a segunda sugestão. */
export function escolherProposta(propostaId, listaPrestadores = [], agora = Date.now()) {
  const todas = propostas();
  const i = todas.findIndex((x) => x.id === String(propostaId));
  if (i < 0) { return { ok: false, erro: 'proposta não encontrada' }; }

  const r = prp.selecionar(todas[i], agora);
  if (r.erro) { return { ok: false, erro: r.erro }; }
  todas[i] = r.proposta;
  // As outras do mesmo pedido saem da disputa, mas continuam legíveis no histórico.
  for (const [j, x] of todas.entries()) {
    if (x.pedidoId === r.proposta.pedidoId && x.id !== r.proposta.id && x.status === 'ENVIADA') {
      todas[j] = { ...x, status: 'NAO_ESCOLHIDA' };
    }
  }
  save(PROPOSTAS, todas);

  const pedido = acharPedido(r.proposta.pedidoId);
  if (pedido && pedido.status === 'RECEIVING_QUOTES') { gravarPedido(ped.transitar(pedido, 'SELECTING').pedido); }

  return { ok: true, proposta: r.proposta, segundosRestantes: prp.segundosRestantes(r.proposta, agora) };
}

/** Aviso ANTES de confirmar — informa, não bloqueia. */
export function avisoDaEscolha(pedidoId, propostaId, listaPrestadores = []) {
  const r = propostasDoPedido(pedidoId, listaPrestadores);
  if (!r.ok) { return null; }
  const escolhido = r.cards.find((c) => c.id === String(propostaId));
  return prp.segundaSugestao(escolhido, r.cards);
}

/** Estado da janela de aceite, com a próxima opção já pronta. */
export function estadoAceite(propostaId, listaPrestadores = [], agora = Date.now()) {
  const p = propostas().find((x) => x.id === String(propostaId));
  if (!p) { return { ok: false, erro: 'proposta não encontrada' }; }
  const restante = prp.segundosRestantes(p, agora);

  if (prp.expirouAceite(p, agora)) {
    const outras = propostas().filter((x) => x.pedidoId === p.pedidoId);
    const cards = propostasDoPedido(p.pedidoId, listaPrestadores, agora);
    const { proposta, proxima } = prp.expirar(p, cards.ok ? cards.cards : [], agora);
    gravarProposta(proposta);
    // O cliente NÃO recomeça: devolvemos a próxima já escolhida.
    return { ok: true, status: 'EXPIRADA_ACEITE', segundosRestantes: 0, proxima, expirou: true };
  }
  return { ok: true, status: p.status, segundosRestantes: restante, proposta: p };
}

export function aceitarProposta(propostaId, agora = Date.now()) {
  const todas = propostas();
  const i = todas.findIndex((x) => x.id === String(propostaId));
  if (i < 0) { return { ok: false, erro: 'proposta não encontrada' }; }
  const r = prp.aceitar(todas[i], agora);
  todas[i] = r.proposta;
  save(PROPOSTAS, todas);
  if (r.erro) { return { ok: false, erro: r.erro }; }
  return { ok: true, proposta: r.proposta };
}

/* ---------------- 3. escopo ---------------- */

/** Congela o escopo a partir da proposta aceita. É o documento da contratação. */
export function congelarEscopo(propostaId) {
  const proposta = propostas().find((x) => x.id === String(propostaId));
  if (!proposta) { return { ok: false, erros: ['proposta não encontrada'] }; }
  if (proposta.status !== 'ACEITA') { return { ok: false, erros: ['o escopo só congela depois do aceite do profissional'] }; }
  if (escopos().some((e) => e.propostaId === proposta.id)) {
    return { ok: false, erros: ['o escopo desta contratação já foi congelado'] };
  }
  const pedido = acharPedido(proposta.pedidoId);

  const r = ord.congelarEscopo({
    pedidoId: proposta.pedidoId, propostaId: proposta.id, prestadorId: proposta.prestadorId,
    clienteId: pedido?.clienteId, incluido: proposta.escopo, naoIncluido: proposta.naoIncluso,
    materiais: proposta.materiais, materiaisInclusos: proposta.materiaisInclusos,
    valorCentavos: proposta.valorCentavos, prazoDias: proposta.prazoDias,
    endereco: pedido?.endereco, dataDesejada: pedido?.dataDesejada, observacoes: proposta.observacoes,
  });
  if (r.erros.length) { return { ok: false, erros: r.erros }; }
  save(ESCOPOS, [...escopos(), r.escopo]);
  return { ok: true, escopo: r.escopo };
}

export function aceitarEscopo(escopoId, quem) {
  const todos = escopos();
  const i = todos.findIndex((e) => e.id === String(escopoId));
  if (i < 0) { return { ok: false, erro: 'escopo não encontrado' }; }
  const r = ord.aceitarEscopo(todos[i], quem);
  if (r.erro) { return { ok: false, erro: r.erro }; }
  todos[i] = r.escopo;
  save(ESCOPOS, todos);
  return { ok: true, escopo: r.escopo, fechado: r.fechado };
}

/* ---------------- 4. pagamento ---------------- */

const EVENTOS_PAG = 'eventos-pagamento';

/**
 * Cobra pelo provedor INJETADO. O fluxo não conhece Asaas nem simulador: recebe algo
 * que cumpre o contrato de `pagamento.mjs` e conversa por ele.
 *
 * O percentual da comissão vem de fora e não tem default — 80/20 é hipótese
 * comercial. E o split que VALEU fica gravado no pagamento: mudar a política em
 * março não pode reescrever o que foi combinado em janeiro.
 */
export async function pagar(escopoId, e = {}, gateway = null) {
  const escopo = escopos().find((x) => x.id === String(escopoId));
  if (!escopo) { return { ok: false, erro: 'escopo não encontrado' }; }
  if (!escopo.aceiteCliente || !escopo.aceitePrestador) {
    return { ok: false, erro: 'o escopo precisa do aceite das duas partes antes do pagamento' };
  }
  const metodo = String(e.metodo || '').toUpperCase();
  if (!pag.METODOS.includes(metodo)) { return { ok: false, erro: `escolha ${pag.METODOS.join(' ou ')}` }; }

  const g = validarProvedor(gateway);
  if (!g.ok) { return { ok: false, erro: g.motivo }; }

  const divisao = pag.dividir(escopo.valorCentavos, e.percentualPrestador ?? 80);
  if (!divisao.ok) { return { ok: false, erro: divisao.motivo }; }

  const r = await gateway.criarCobranca({
    metodo,
    valorCentavos: escopo.valorCentavos,
    prestadorCentavos: divisao.split.prestadorCentavos,
    walletIdPrestador: e.walletIdPrestador || null,
    clienteExternoId: e.clienteExternoId || null,
    referencia: escopo.pedidoId,
    descricao: 'Quebra-Galho — ' + (escopo.incluido || '').slice(0, 60),
    vencimento: e.vencimento || new Date().toISOString().slice(0, 10),
  });
  if (!r.ok) { return { ok: false, erro: r.motivo }; }

  // Quando o provedor informa o líquido, o split é refeito sobre ele: é o que existe
  // de verdade para dividir depois da taxa.
  const final = r.cobranca.liquidoCentavos != null && r.cobranca.liquidoCentavos !== escopo.valorCentavos
    ? pag.dividir(escopo.valorCentavos, e.percentualPrestador ?? 80, r.cobranca.liquidoCentavos)
    : divisao;

  const pagamento = {
    id: 'pag_' + Math.random().toString(36).slice(2, 10),
    externoId: r.cobranca.id,
    provedor: gateway.nome,
    simulado: Boolean(gateway.simulado),
    escopoId: escopo.id, pedidoId: escopo.pedidoId,
    metodo, valorCentavos: escopo.valorCentavos,
    split: final.split,
    // atalhos que a tela usa, sem ela precisar entender o split
    prestadorCentavos: final.split.prestadorCentavos,
    plataformaCentavos: final.split.plataformaCentavos,
    percentualPrestador: final.split.percentualPrestador,
    estado: r.cobranca.estado || 'PENDENTE',
    link: r.cobranca.link || null,
    repassado: false,
    criadoEm: new Date().toISOString(),
    historico: [{ estado: r.cobranca.estado || 'PENDENTE', em: new Date().toISOString() }],
  };
  save(PAGAMENTOS, [...pagamentos(), pagamento]);

  const o = ord.criarOrdem({
    pedidoId: escopo.pedidoId, propostaId: escopo.propostaId, escopoId: escopo.id,
    clienteId: escopo.clienteId, prestadorId: escopo.prestadorId, valorCentavos: escopo.valorCentavos,
  });
  if (o.erros.length) { return { ok: false, erro: o.erros.join('; ') }; }
  let ordem = { ...o.ordem, pagamentoId: pagamento.id };

  // A OS só avança para PAGO quando o pagamento está CONFIRMADO. Em Pix com
  // pendência, ela fica em CREATED esperando o webhook — que é a verdade.
  if (pagamento.estado === 'CONFIRMADO' || pagamento.estado === 'DISPONIVEL') {
    ordem = ord.moverOrdem(ordem, 'PAID', { nota: `Pago por ${metodo === 'PIX' ? 'Pix' : 'cartão'}` }).ordem;
    const pedido = acharPedido(escopo.pedidoId);
    if (pedido) { gravarPedido({ ...ped.transitar(pedido, 'CONVERTED').pedido, escolhidaId: escopo.propostaId }); }
  }
  gravarOrdem(ordem);

  return { ok: true, pagamento, ordem, aguardandoPagamento: pagamento.estado !== 'CONFIRMADO' && pagamento.estado !== 'DISPONIVEL' };
}

function validarProvedor(g) {
  const v = pag.validarGateway(g);
  return v.ok ? { ok: true } : { ok: false, motivo: v.motivo };
}

/**
 * Aplica um evento do provedor. Idempotente pelo id do evento: a entrega é
 * at-least-once e a reentrega é rotina, não erro.
 */
export function aplicarEventoPagamento(traduzido = {}) {
  if (!traduzido.eventoId) { return { ok: false, http: 400, motivo: 'evento sem id — sem ele não há idempotência' }; }
  const vistos = load(EVENTOS_PAG, {});
  if (vistos[traduzido.eventoId]) { return { ok: true, http: 200, duplicado: true }; }

  const registrar = (extra) => save(EVENTOS_PAG, { ...vistos, [traduzido.eventoId]: { em: new Date().toISOString(), ...extra } });

  if (!traduzido.conhecido || !traduzido.estado) {
    registrar({ ignorado: true, evento: traduzido.evento });
    return { ok: true, http: 200, ignorado: true, motivo: `evento não tratado: "${traduzido.evento}"` };
  }

  const todos = pagamentos();
  const i = todos.findIndex((x) => x.externoId === traduzido.cobrancaId || x.id === traduzido.cobrancaId);
  if (i < 0) {
    registrar({ orfao: true });
    return { ok: true, http: 200, orfao: true, motivo: 'cobrança não é nossa' };
  }

  const t = pag.podeIr(todos[i].estado, traduzido.estado);
  if (!t.ok) { registrar({ recusado: t.motivo }); return { ok: false, http: 200, motivo: t.motivo }; }

  if (!t.repetido) {
    todos[i] = {
      ...todos[i], estado: traduzido.estado,
      historico: [...todos[i].historico, { estado: traduzido.estado, em: new Date().toISOString() }],
    };
    if (traduzido.liquidoCentavos != null && todos[i].split?.liquidoCentavos == null) {
      const refeito = pag.dividir(todos[i].valorCentavos, todos[i].percentualPrestador, traduzido.liquidoCentavos);
      if (refeito.ok) {
        todos[i].split = refeito.split;
        todos[i].prestadorCentavos = refeito.split.prestadorCentavos;
        todos[i].plataformaCentavos = refeito.split.plataformaCentavos;
      }
    }
    save(PAGAMENTOS, todos);

    // Pagamento confirmado move a OS — é o gatilho da contratação virar serviço.
    if (traduzido.estado === 'CONFIRMADO') {
      const o = ordens().find((x) => x.pagamentoId === todos[i].id);
      if (o && o.status === 'CREATED') { gravarOrdem(ord.moverOrdem(o, 'PAID', { nota: 'Pagamento confirmado' }).ordem); }
    }
  }

  registrar({ cobranca: traduzido.cobrancaId, estado: traduzido.estado });
  return { ok: true, http: 200, pagamento: todos[i], estado: traduzido.estado };
}

/** Repasse: só com dinheiro liquidado e sem contestação aberta. */
export function repassar(pagamentoId) {
  const todos = pagamentos();
  const i = todos.findIndex((x) => x.id === String(pagamentoId));
  if (i < 0) { return { ok: false, erro: 'pagamento não encontrado' }; }
  const o = ordens().find((x) => x.pagamentoId === todos[i].id);
  const disputaAberta = disputas().some((d) => d.ordemId === o?.id && d.status !== 'RESOLVIDA');

  const pode = pag.podeRepassar(todos[i], { disputaAberta });
  if (!pode.ok) { return { ok: false, erro: pode.motivo }; }

  todos[i] = { ...todos[i], repassado: true, repassadoEm: new Date().toISOString() };
  save(PAGAMENTOS, todos);
  return { ok: true, pagamento: todos[i], valorCentavos: pode.valorCentavos };
}

/* ---------------- 5. ordem de serviço ---------------- */

export function moverOrdem(ordemId, para, opts = {}) {
  const todas = ordens();
  const i = todas.findIndex((o) => o.id === String(ordemId));
  if (i < 0) { return { ok: false, erro: 'ordem de serviço não encontrada' }; }
  const r = ord.moverOrdem(todas[i], String(para).toUpperCase(), opts);
  if (r.erro) { return { ok: false, erro: r.erro }; }
  todas[i] = r.ordem;
  save(ORDENS, todas);
  return { ok: true, ordem: r.ordem, timeline: ord.timeline(r.ordem) };
}

export function ordemCompleta(ordemId) {
  const o = ordens().find((x) => x.id === String(ordemId));
  if (!o) { return { ok: false, erro: 'ordem não encontrada' }; }
  return {
    ok: true,
    ordem: o,
    timeline: ord.timeline(o),
    escopo: escopos().find((e) => e.id === o.escopoId) || null,
    pedido: acharPedido(o.pedidoId),
    pagamento: pagamentos().find((p) => p.id === o.pagamentoId) || null,
    avaliacao: avaliacoes().find((a) => a.ordemId === o.id) || null,
    disputa: disputas().find((d) => d.ordemId === o.id) || null,
  };
}

/* ---------------- 6. avaliação e contestação ---------------- */

export function avaliar(entrada) {
  const o = ordens().find((x) => x.id === String(entrada.ordemId));
  if (!o) { return { ok: false, erros: ['ordem não encontrada'] }; }
  if (o.status !== 'COMPLETED') { return { ok: false, erros: ['só dá pra avaliar depois que o serviço é concluído'] }; }
  if (avaliacoes().some((a) => a.ordemId === o.id)) { return { ok: false, erros: ['esta ordem já foi avaliada'] }; }

  const r = ord.normalizarAvaliacao({ ...entrada, prestadorId: o.prestadorId, clienteId: o.clienteId });
  if (r.erros.length) { return { ok: false, erros: r.erros }; }
  save(AVALIACOES, [...avaliacoes(), r.avaliacao]);
  return { ok: true, avaliacao: r.avaliacao };
}

/** Nota do prestador a partir das avaliações reais. */
export function reputacaoDe(prestadorId) {
  const minhas = avaliacoes().filter((a) => a.prestadorId === prestadorId);
  return { media: ord.media(minhas), total: minhas.length };
}

export function contestar(entrada) {
  const todas = ordens();
  const i = todas.findIndex((x) => x.id === String(entrada.ordemId));
  if (i < 0) { return { ok: false, erros: ['ordem não encontrada'] }; }
  if (todas[i].status !== 'AWAITING_CUSTOMER_ACCEPTANCE') {
    return { ok: false, erros: ['a contestação só abre quando o profissional informa que terminou'] };
  }
  const r = ord.abrirDisputa({ ...entrada, escopoId: todas[i].escopoId });
  if (r.erros.length) { return { ok: false, erros: r.erros }; }

  save(DISPUTAS, [...disputas(), r.disputa]);
  todas[i] = ord.moverOrdem(todas[i], 'DISPUTED', { nota: r.disputa.rotuloMotivo }).ordem;
  save(ORDENS, todas);
  return { ok: true, disputa: r.disputa, ordem: todas[i] };
}

export function resolverDisputa(disputaId, e = {}) {
  const todas = disputas();
  const i = todas.findIndex((d) => d.id === String(disputaId));
  if (i < 0) { return { ok: false, erro: 'contestação não encontrada' }; }
  const r = ord.resolverDisputa(todas[i], e);
  if (r.erro) { return { ok: false, erro: r.erro }; }
  todas[i] = r.disputa;
  save(DISPUTAS, todas);
  return { ok: true, disputa: r.disputa };
}

/* ---------------- painéis ---------------- */

/** GMV e receita: só o que virou ordem de serviço paga. */
export function numeros() {
  const os = ordens();
  const pags = pagamentos();
  const gmv = pags.reduce((a, p) => a + p.valorCentavos, 0);
  const receita = pags.reduce((a, p) => a + p.plataformaCentavos, 0);
  const hoje = new Date().toISOString().slice(0, 10);
  return {
    pedidosHoje: pedidos().filter((p) => p.criadoEm.slice(0, 10) === hoje).length,
    pedidosTotal: pedidos().length,
    propostas: propostas().length,
    emAndamento: os.filter((o) => !['COMPLETED', 'CANCELLED', 'REFUNDED'].includes(o.status)).length,
    concluidos: os.filter((o) => o.status === 'COMPLETED').length,
    gmvCentavos: gmv,
    receitaCentavos: receita,
    contestacoesAbertas: disputas().filter((d) => d.status !== 'RESOLVIDA').length,
    cancelados: os.filter((o) => o.status === 'CANCELLED').length,
    avaliacoes: avaliacoes().length,
  };
}

/** Ganhos do prestador, com a taxa MOSTRADA — nunca escondida. */
export function ganhosDoPrestador(prestadorId) {
  const minhas = ordens().filter((o) => o.prestadorId === prestadorId);
  const linhas = minhas.map((o) => {
    const pg = pagamentos().find((p) => p.id === o.pagamentoId);
    return {
      ordemId: o.id,
      status: o.status,
      rotulo: ord.OS_ROTULO[o.status],
      brutoCentavos: pg?.valorCentavos ?? o.valorCentavos ?? 0,
      taxaCentavos: pg?.plataformaCentavos ?? 0,
      recebeCentavos: pg?.prestadorCentavos ?? 0,
      // Concluído não é o mesmo que disponível: o repasse tem regra própria.
      liberado: o.status === 'COMPLETED',
    };
  });
  return {
    linhas,
    totalBruto: linhas.reduce((a, l) => a + l.brutoCentavos, 0),
    totalTaxa: linhas.reduce((a, l) => a + l.taxaCentavos, 0),
    totalRecebe: linhas.reduce((a, l) => a + l.recebeCentavos, 0),
    aguardando: linhas.filter((l) => !l.liberado).reduce((a, l) => a + l.recebeCentavos, 0),
  };
}


/* ---------------- 7. qualidade: incidentes, strikes e política ---------------- */

export function definirPolitica(mudancas = {}) {
  const atual = politica();
  const nova = { ...atual, ...mudancas };
  if (nova.gravesParaDesativar != null && !(Number(nova.gravesParaDesativar) > 0)) {
    return { ok: false, erro: 'o número de ocorrências graves precisa ser maior que zero' };
  }
  // Ligar a aplicação automática é uma decisão que precisa estar registrada.
  if (nova.aprovadaPorJuridico && !String(nova.aprovadoPor || '').trim()) {
    return { ok: false, erro: 'para marcar a política como aprovada, registre QUEM aprovou' };
  }
  save(POLITICA, nova);
  return { ok: true, politica: nova };
}

export function abrirIncidente(e = {}) {
  const r = qua.abrirIncidente(e);
  if (r.erros.length) { return { ok: false, erros: r.erros }; }
  save(INCIDENTES, [...incidentes(), r.incidente]);
  return { ok: true, incidente: r.incidente };
}

export function moverIncidente(id, para, opts = {}) {
  const todos = incidentes();
  const i = todos.findIndex((x) => x.id === String(id));
  if (i < 0) { return { ok: false, erro: 'incidente não encontrado' }; }
  const r = qua.mover(todos[i], String(para).toUpperCase(), opts);
  if (r.erro) { return { ok: false, erro: r.erro }; }
  todos[i] = r.incidente;
  save(INCIDENTES, todos);
  return { ok: true, incidente: r.incidente, virouStrike: qua.viraStrike(r.incidente) };
}

/** O que a política DIRIA sobre este profissional — recomendação, não punição. */
export function situacaoQualidade(prestadorId, agora = Date.now()) {
  return qua.avaliarPolitica({
    incidentes: incidentes(), avaliacoes: avaliacoes(),
    alvoId: prestadorId, politica: politica(), agora,
  });
}

/**
 * Resultado de contestação pode gerar incidente — mas NÃO automaticamente. Resultado
 * a favor do cliente não prova má-fé do profissional: pode ter sido mal-entendido de
 * escopo. Quem abre o incidente é gente, e este método só prepara a sugestão.
 */
export function sugerirIncidenteDaDisputa(disputaId) {
  const d = disputas().find((x) => x.id === String(disputaId));
  if (!d) { return { ok: false, erro: 'contestação não encontrada' }; }
  if (d.status !== 'RESOLVIDA') { return { ok: false, erro: 'a contestação ainda não foi resolvida' }; }
  const o = ordens().find((x) => x.id === d.ordemId);

  const sugere = ['CUSTOMER_FAVOR', 'REWORK'].includes(d.resultado);
  return {
    ok: true,
    sugere,
    motivo: sugere
      ? 'o resultado foi a favor do cliente — vale avaliar se houve descumprimento'
      : 'o resultado não indica falha do profissional',
    rascunho: sugere ? {
      alvoTipo: 'prestador', alvoId: o?.prestadorId || null,
      origem: 'DISPUTE_RESULT', severidade: 'MEDIUM',
      descricao: `Contestação ${d.id} resolvida como ${d.resultado}. ${d.laudo || ''}`.trim(),
      ordemId: d.ordemId, disputaId: d.id,
    } : null,
  };
}

/** Painel de qualidade do admin. */
export function painelQualidade() {
  const todos = incidentes();
  const pol = politica();
  return {
    politica: pol,
    total: todos.length,
    porEstado: qua.ESTADOS.reduce((a, e) => ({ ...a, [e]: todos.filter((i) => i.estado === e).length }), {}),
    abertos: todos.filter((i) => !['FINAL', 'DISMISSED'].includes(i.estado)),
    incidentes: todos,
    // Quem a política sinalizaria HOJE, se estivesse valendo.
    sinalizados: [...new Set(todos.filter((i) => i.alvoTipo === 'prestador').map((i) => i.alvoId))]
      .map((id) => situacaoQualidade(id))
      .filter((s) => s.disparou),
  };
}
