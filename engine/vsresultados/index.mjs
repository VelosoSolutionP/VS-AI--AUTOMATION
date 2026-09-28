/**
 * VSresultados — o que cada canal colocou no bolso do cliente.
 *
 * Consumo diz quanto se conversou. Resultado diz quanto isso virou dinheiro. E
 * dinheiro atribuído a um canal só entra aqui com VÍNCULO RASTREÁVEL: um pedido
 * que o bot gerou dentro de uma conversa, com o número do pedido, a identidade
 * de quem pediu e o canal gravados NO MOMENTO da cobrança — e um pagamento
 * confirmado no gateway pra esse mesmo pedido. Sem os dois, não é receita do
 * canal. Mostrar ao comerciante um faturamento que ele não consegue comprovar é
 * o jeito mais rápido de perder a confiança dele no resto da tela.
 *
 * Três coisas moram aqui:
 *  - PEDIDOS: o elo conversa -> cobrança (quem, canal, valor, campanha).
 *  - ORIGENS: de qual campanha a pessoa chegou (link rastreável do canal).
 *  - CAMPANHAS: os links que o dono divulga, cada um com um código.
 *
 * O estado do pagamento NÃO é copiado pra cá: é lido do gateway (vspagamentos)
 * na hora do resumo. Cópia de estado envelhece; o gateway é a fonte.
 */
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { dentroDaCasa } from '../casa.mjs';

const arq = () => (process.env.VSRESULTADOS_DIR ? join(process.env.VSRESULTADOS_DIR, 'resultados.json') : dentroDaCasa('vsresultados', 'resultados.json'));
const ler = () => { try { return { pedidos: [], origens: {}, campanhas: [], ...JSON.parse(readFileSync(arq(), 'utf8')) }; } catch { return { pedidos: [], origens: {}, campanhas: [] }; } };
function gravar(d) {
  mkdirSync(dirname(arq()), { recursive: true, mode: 0o700 });
  writeFileSync(arq(), JSON.stringify(d, null, 2), { mode: 0o600 });
  try { chmodSync(arq(), 0o600); } catch { /* FS sem modo */ }
  return d;
}
const agoraIso = () => new Date().toISOString();

/** Pago de verdade: dinheiro confirmado. CRIADO/PENDENTE/VENCIDO não é receita; estorno e chargeback também não. */
export const PAGO = ['CONFIRMADO', 'DISPONIVEL'];
const MORTO = ['CANCELADO', 'ESTORNADO', 'ESTORNADO_PARCIAL', 'CHARGEBACK', 'CHARGEBACK_DISPUTA'];

/** Janela da atribuição por campanha: quem chegou por um link e pediu em até 30 dias. */
export const JANELA_CAMPANHA_DIAS = 30;
/** Pedido parado há mais que isto, sem pagar, vira oportunidade de retomada. */
export const MIN_PARA_OPORTUNIDADE = 30;
/** Oportunidade mais velha que isto já esfriou: não se incomoda quem desistiu há dias. */
export const DIAS_OPORTUNIDADE = 7;

/* ── campanhas ──────────────────────────────────────────────────────────── */

/**
 * Código da campanha, no formato que o Telegram aceita no `?start=` (letras,
 * números, _ e -, até 64). Sai do nome, sem acento, e ganha sufixo se repetir.
 */
export function codigoDe(nome, existentes = []) {
  const base = String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'campanha';
  let c = base; let n = 2;
  while (existentes.includes(c)) { c = `${base}-${n++}`; }
  return c;
}

/**
 * `codigo` vem pronto quando a campanha foi montada e aprovada no `vscampanhas`
 * (o dono já viu o link na prévia) — aí ele é usado como está, ou recusado.
 */
export function criarCampanha({ nome, canal = 'telegram', codigo: pedido } = {}) {
  const n = String(nome || '').trim();
  if (!n) { return { ok: false, erro: 'dê um nome pra campanha (ex.: "Promo de sexta")' }; }
  if (n.length > 80) { return { ok: false, erro: 'nome longo demais (até 80 caracteres)' }; }
  const d = ler();
  const existentes = d.campanhas.map((c) => c.codigo);
  if (pedido != null) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(pedido))) { return { ok: false, erro: 'código do link fora do formato do Telegram' }; }
    if (existentes.includes(String(pedido))) { return { ok: false, erro: `já existe campanha com o código "${pedido}"` }; }
  }
  const codigo = pedido != null ? String(pedido) : codigoDe(n, existentes);
  const campanha = { codigo, nome: n, canal, criadaEm: agoraIso(), arquivada: false };
  d.campanhas.push(campanha);
  gravar(d);
  return { ok: true, campanha };
}

export function arquivarCampanha(codigo, arquivada = true) {
  const d = ler();
  const c = d.campanhas.find((x) => x.codigo === codigo);
  if (!c) { return { ok: false, erro: 'campanha não encontrada' }; }
  c.arquivada = !!arquivada;
  gravar(d);
  return { ok: true, campanha: c };
}

export const campanhas = () => ler().campanhas;

/* ── origem (de onde a pessoa chegou) ───────────────────────────────────── */

/**
 * Registra que a pessoa chegou por uma campanha. Último toque vale: quem clicou
 * na promo de sexta depois de ter vindo pela de segunda está respondendo à de
 * sexta. Código que não é de campanha cadastrada é ignorado — link inventado
 * não vira linha no relatório.
 */
export function registrarOrigem(telefone, { canal, campanha, quando = agoraIso() } = {}) {
  const tel = String(telefone || '').replace(/\D/g, '');
  const cod = String(campanha || '').trim();
  if (!tel || !cod) { return { ok: false }; }
  const d = ler();
  const c = d.campanhas.find((x) => x.codigo === cod);
  if (!c) { return { ok: false, motivo: 'campanha desconhecida' }; }
  /* Entrada = cada /start com o código, repetido ou não. Não é "clique": o
     Telegram só avisa quem abriu o bot, não quem viu o link e desistiu. */
  const dia = String(quando).slice(0, 10);
  c.entradas = { ...(c.entradas || {}), [dia]: ((c.entradas || {})[dia] || 0) + 1 };
  d.origens[tel] = { canal: canal || null, campanha: cod, quando };
  gravar(d);
  return { ok: true };
}

function campanhaVigente(origem, quando) {
  if (!origem?.campanha) { return null; }
  const dias = (new Date(quando) - new Date(origem.quando)) / 86400000;
  return dias >= 0 && dias <= JANELA_CAMPANHA_DIAS ? origem.campanha : null;
}

/* ── pedidos (o elo conversa -> cobrança) ───────────────────────────────── */

/**
 * O bot gerou uma cobrança dentro de uma conversa. É AQUI que nasce o vínculo:
 * depois, olhando só o pagamento, não dá mais pra saber de qual conversa ele
 * veio. Idempotente pela referência — reentrega da mesma mensagem não duplica.
 */
export function registrarPedido({ referencia, pagamentoId, telefone, endereco, canal, valorCentavos, nome, itens, quando = agoraIso() } = {}) {
  const ref = String(referencia || '').trim();
  const tel = String(telefone || '').replace(/\D/g, '');
  if (!ref || !tel) { return { ok: false, erro: 'pedido sem referência ou sem cliente' }; }
  const d = ler();
  if (d.pedidos.some((p) => p.referencia === ref)) { return { ok: true, repetido: true }; }
  const pedido = {
    referencia: ref,
    pagamentoId: pagamentoId ? String(pagamentoId) : null,
    telefone: tel,
    endereco: endereco || null,
    canal: canal || 'whatsapp',
    valorCentavos: Number(valorCentavos) || 0,
    nome: nome || null,
    itens: (itens || []).slice(0, 30),
    campanha: campanhaVigente(d.origens[tel], quando),
    criadoEm: quando,
    retomadaEm: null,
  };
  d.pedidos.push(pedido);
  gravar(d);
  return { ok: true, pedido };
}

/** Todos os pedidos (o CRM confere quais já foram pagos). */
export const pedidos = () => ler().pedidos;

export function obterPedido(referencia) {
  return ler().pedidos.find((p) => p.referencia === String(referencia || '')) || null;
}

/**
 * O pedido mais recente desta pessoa, com o estado do pagamento lido do
 * gateway — é o que o vendedor vê no topo da conversa ("pedido em aberto").
 */
export function ultimoPedido(telefone, pagamentos = []) {
  const tel = String(telefone || '').replace(/\D/g, '');
  const p = ler().pedidos.filter((x) => x.telefone === tel).sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)))[0];
  if (!p) { return null; }
  const pg = p.pagamentoId ? (pagamentos || []).find((x) => String(x.id) === p.pagamentoId) : null;
  const estado = !p.pagamentoId ? 'sem-pagamento' : PAGO.includes(pg?.estado) ? 'pago' : MORTO.includes(pg?.estado) ? 'cancelado' : 'pendente';
  return { referencia: p.referencia, valorCentavos: p.valorCentavos, itens: p.itens, criadoEm: p.criadoEm, estado };
}

/** Retomada é UMA por pedido: insistir com quem não respondeu vira incômodo, não venda. */
export function marcarRetomada(referencia, quando = agoraIso()) {
  const d = ler();
  const p = d.pedidos.find((x) => x.referencia === String(referencia || ''));
  if (!p) { return { ok: false, erro: 'pedido não encontrado' }; }
  if (p.retomadaEm) { return { ok: false, erro: 'este pedido já foi retomado em ' + p.retomadaEm.slice(0, 16).replace('T', ' ') }; }
  p.retomadaEm = quando;
  gravar(d);
  return { ok: true, pedido: p };
}

/** Quando o pagamento virou pago: o primeiro registro de estado pago no histórico, senão a última atualização. */
function pagoEm(pg) {
  const h = (pg?.historico || []).find((x) => PAGO.includes(x.para || x.estado));
  return h?.quando || h?.em || pg?.atualizadoEm || pg?.criadoEm || null;
}

/**
 * O painel de resultados de um canal num período.
 *
 * @param {object} o
 * @param {string} o.canal            'telegram' | 'whatsapp'
 * @param {number} [o.dias=30]        tamanho do período
 * @param {string} [o.agora]          ISO — pra teste
 * @param {Array}  o.pagamentos       lista do gateway (vspagamentos.listar())
 * @param {object} [o.leads]          { atendidos, peloBot } do período, vindos do CRM
 */
export function resumo({ canal, dias = 30, agora, pagamentos = [], leads = {} } = {}) {
  const fim = agora ? new Date(agora) : new Date();
  const ini = new Date(fim.getTime() - dias * 86400000);
  const iniAnterior = new Date(ini.getTime() - dias * 86400000);
  const d = ler();
  const porId = new Map((pagamentos || []).map((p) => [String(p.id), p]));
  const doCanal = d.pedidos.filter((p) => p.canal === canal);

  const comEstado = doCanal.map((p) => {
    const pg = p.pagamentoId ? porId.get(p.pagamentoId) : null;
    const estado = pg?.estado || null;
    const pago = PAGO.includes(estado);
    return { ...p, estado, pago, pagoEm: pago ? pagoEm(pg) : null, morto: MORTO.includes(estado) };
  });
  const noPeriodo = (x, a, b) => { const t = new Date(x); return t >= a && t < b; };

  const atual = comEstado.filter((p) => noPeriodo(p.criadoEm, ini, fim));
  const anterior = comEstado.filter((p) => noPeriodo(p.criadoEm, iniAnterior, ini));
  const receita = (lista) => lista.filter((p) => p.pago).reduce((s, p) => s + p.valorCentavos, 0);
  const concluidos = atual.filter((p) => p.pago);
  const receitaCentavos = receita(atual);
  const receitaAnterior = receita(anterior);

  /* Recuperada = foi retomada e SÓ DEPOIS pagou. Pagar antes da retomada não é
     mérito da retomada, e contar assim inflaria o número que vende o recurso. */
  const recuperados = concluidos.filter((p) => p.retomadaEm && p.pagoEm && new Date(p.pagoEm) > new Date(p.retomadaEm));

  const limiteNovo = new Date(fim.getTime() - MIN_PARA_OPORTUNIDADE * 60000);
  const limiteVelho = new Date(fim.getTime() - DIAS_OPORTUNIDADE * 86400000);
  const oportunidades = comEstado
    .filter((p) => !p.pago && !p.morto && new Date(p.criadoEm) <= limiteNovo && new Date(p.criadoEm) >= limiteVelho)
    .sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)))
    .map((p) => ({ referencia: p.referencia, nome: p.nome, telefone: p.telefone, valorCentavos: p.valorCentavos, criadoEm: p.criadoEm, retomadaEm: p.retomadaEm, estado: p.estado, itens: p.itens }));

  // Série diária de receita confirmada, dia a dia (dia sem venda aparece como zero, não some).
  const serie = [];
  for (let t = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate()); t <= fim; t = new Date(t.getTime() + 86400000)) {
    const dia = t.toISOString().slice(0, 10);
    serie.push({ dia, centavos: concluidos.filter((p) => String(p.criadoEm).slice(0, 10) === dia).reduce((s, p) => s + p.valorCentavos, 0) });
  }

  const cams = d.campanhas.filter((c) => c.canal === canal);
  const conversasPorCampanha = {};
  for (const o of Object.values(d.origens)) {
    if (o.canal === canal && noPeriodo(o.quando, ini, fim)) { conversasPorCampanha[o.campanha] = (conversasPorCampanha[o.campanha] || 0) + 1; }
  }
  const porCampanha = cams.map((c) => {
    const ps = atual.filter((p) => p.campanha === c.codigo);
    const entradas = Object.entries(c.entradas || {}).filter(([dia]) => dia >= ini.toISOString().slice(0, 10) && dia <= fim.toISOString().slice(0, 10)).reduce((s, [, n]) => s + n, 0);
    return { codigo: c.codigo, nome: c.nome, arquivada: c.arquivada, criadaEm: c.criadaEm, entradas,
      conversas: conversasPorCampanha[c.codigo] || 0, pedidos: ps.length, concluidos: ps.filter((p) => p.pago).length, receitaCentavos: receita(ps) };
  });

  const atendidos = Number(leads.atendidos) || 0;
  return {
    canal, dias, de: ini.toISOString(), ate: fim.toISOString(),
    receitaCentavos,
    receitaAnteriorCentavos: receitaAnterior,
    // Variação só existe quando há base: "+∞%" sobre zero não informa nada.
    variacao: receitaAnterior > 0 ? (receitaCentavos - receitaAnterior) / receitaAnterior : null,
    pedidos: atual.length,
    pedidosConcluidos: concluidos.length,
    pedidosSemPagamento: atual.filter((p) => !p.pagamentoId).length,
    leadsAtendidos: atendidos,
    leadsPeloBot: Number(leads.peloBot) || 0,
    // Conversão = leads que viraram pedido pago ÷ leads atendidos. Sem lead, não existe taxa.
    conversao: atendidos ? new Set(concluidos.map((p) => p.telefone)).size / atendidos : null,
    recuperados: recuperados.length,
    receitaRecuperadaCentavos: receita(recuperados),
    oportunidades,
    serie,
    porCampanha,
    regra: 'Entra como receita do canal só o pedido que o bot gerou numa conversa deste canal e cujo pagamento o gateway confirmou.',
  };
}

/* ── o dia (tela "Vendas do dia", por canal) ────────────────────────────── */

/* Dia e hora de BRASÍLIA. Cortar o ISO (UTC) jogava a venda das 22h no dia
   seguinte — justo a hora de pico de delivery. */
const FMT_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
const FMT_HORA = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' });
export const diaBr = (quando = new Date()) => FMT_DIA.format(new Date(quando));
export const horaBr = (quando) => Number(FMT_HORA.format(new Date(quando))) % 24;
/** 00:00 de Brasília de um dia AAAA-MM-DD (UTC-3 o ano todo desde 2019). */
const inicioDoDiaBr = (dia) => new Date(`${dia}T00:00:00-03:00`);

/**
 * Tudo o que um canal vendeu entre dois instantes: o que o dono quer ver no
 * fim do dia e o que o caixa confere no fechamento.
 *
 *  - VENDIDO: pagamento confirmado no gateway (a mesma regra da receita).
 *  - NA ENTREGA: pedido sem cobrança ("pago na entrega") — é pedido e é
 *    dinheiro/maquininha que entra na mão, não no banco; fica à parte.
 *  - AGUARDANDO: cobrança gerada e ainda não paga. Cancelado/estornado some.
 * Pico e mais vendidos contam o que é venda de fato (vendido + na entrega).
 */
export function vendasEntre({ canal, de, ate, pagamentos = [] } = {}) {
  const a = new Date(de); const b = new Date(ate);
  const porId = new Map((pagamentos || []).map((p) => [String(p.id), p]));
  const lista = ler().pedidos
    .filter((p) => p.canal === canal && new Date(p.criadoEm) >= a && new Date(p.criadoEm) < b)
    .map((p) => {
      const pg = p.pagamentoId ? porId.get(p.pagamentoId) : null;
      const situacao = !p.pagamentoId ? 'entrega' : PAGO.includes(pg?.estado) ? 'pago' : MORTO.includes(pg?.estado) ? 'cancelado' : 'aguardando';
      return { ...p, situacao, metodo: pg?.metodo || null };
    })
    .sort((x, y) => String(x.criadoEm).localeCompare(String(y.criadoEm)));
  const soma = (s) => lista.filter((p) => p.situacao === s).reduce((t, p) => t + p.valorCentavos, 0);
  const vendas = lista.filter((p) => p.situacao === 'pago' || p.situacao === 'entrega');

  const porHora = Array.from({ length: 24 }, (_, h) => ({ hora: h, pedidos: 0, centavos: 0 }));
  for (const p of vendas) { const h = porHora[horaBr(p.criadoEm)]; h.pedidos += 1; h.centavos += p.valorCentavos; }
  /* Pico = a hora com MAIS pedidos (é gente pra atender); empate, a de mais dinheiro. */
  const pico = vendas.length ? porHora.reduce((m, h) => (h.pedidos > m.pedidos || (h.pedidos === m.pedidos && h.centavos > m.centavos) ? h : m)) : null;

  const itens = new Map();
  for (const p of vendas) {
    for (const i of p.itens || []) {
      if (i.taxa || !i.nome) { continue; } // taxa de entrega não é produto
      const g = itens.get(i.nome) || { nome: i.nome, qtd: 0, centavos: 0 };
      g.qtd += 1; g.centavos += Number(i.valorCentavos) || 0;
      itens.set(i.nome, g);
    }
  }
  const vendidoCentavos = soma('pago');
  const naEntregaCentavos = soma('entrega');
  return {
    canal, de: a.toISOString(), ate: b.toISOString(),
    vendidoCentavos,
    naEntregaCentavos,
    aguardandoCentavos: soma('aguardando'),
    pedidos: vendas.length,
    pedidosAguardando: lista.filter((p) => p.situacao === 'aguardando').length,
    ticketMedioCentavos: vendas.length ? Math.round((vendidoCentavos + naEntregaCentavos) / vendas.length) : 0,
    porHora,
    pico: pico && { hora: pico.hora, pedidos: pico.pedidos, centavos: pico.centavos },
    maisVendidos: [...itens.values()].sort((x, y) => y.qtd - x.qtd || y.centavos - x.centavos).slice(0, 5),
    lista: lista.map((p) => ({ referencia: p.referencia, criadoEm: p.criadoEm, hora: horaBr(p.criadoEm), nome: p.nome, telefone: p.telefone,
      valorCentavos: p.valorCentavos, situacao: p.situacao, metodo: p.metodo, itens: (p.itens || []).filter((i) => !i.taxa).map((i) => i.nome) })),
  };
}

/** Um dia de calendário de Brasília (padrão: hoje), com o mesmo dia da semana passada pra comparar. */
export function doDia({ canal, dia, pagamentos = [], agora = new Date() } = {}) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(dia || '')) ? dia : diaBr(agora);
  const ini = inicioDoDiaBr(d);
  const fim = new Date(ini.getTime() + 86400000);
  const semIni = new Date(ini.getTime() - 7 * 86400000);
  const sem = vendasEntre({ canal, de: semIni, ate: new Date(fim.getTime() - 7 * 86400000), pagamentos });
  return {
    ...vendasEntre({ canal, de: ini, ate: fim, pagamentos }),
    dia: d,
    hoje: d === diaBr(agora),
    semanaPassada: { dia: diaBr(new Date(semIni.getTime() + 43200000)), vendidoCentavos: sem.vendidoCentavos, naEntregaCentavos: sem.naEntregaCentavos, pedidos: sem.pedidos },
  };
}
