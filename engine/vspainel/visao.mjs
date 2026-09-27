/**
 * Visão geral: o painel do negócio num período (7/30/90 dias), todos os canais.
 *
 * Não calcula nada que outro módulo já calcula: receita e pedidos vêm do
 * vsresultados (só pagamento confirmado), atendimento do vsauditoria (TPR,
 * bot × equipe). Aqui só se junta, e se tira do CRM o que é do funil: leads
 * novos por dia e por canal, e conversão do período. Número sem base é null
 * — a tela escreve "—", nunca zero.
 */
const DIA = 86400000;

const noPer = (iso, a, b) => { const t = Date.parse(iso); return t >= a && t < b; };
const variacao = (atual, ant) => (atual == null || ant == null || ant === 0 ? null : (atual - ant) / Math.abs(ant));

/** Quando o lead foi fechado (ganho/perdido): o último evento "fechado" do histórico. */
function fechadoEm(l) {
  const h = (l.historico || []).filter((x) => x.tipo === 'fechado');
  return h.length ? h[h.length - 1].quando : null;
}

/** Conversão do período: ganhos ÷ fechados, pelo dia em que fechou. */
function conversao(leads, a, b) {
  const f = leads.filter((l) => l.status !== 'aberto' && noPer(fechadoEm(l), a, b));
  return f.length ? f.filter((l) => l.status === 'ganho').length / f.length : null;
}

/**
 * @param {object} o
 * @param {Array}  o.leads          crm.listar() (com diasParado, se vier do painel)
 * @param {object} o.funil          { etapas:[{etapa,leads,valor}] } — resumo do CRM
 * @param {object} o.auditoria      montarAuditoria de todos os canais
 * @param {Array}  o.resultados     resultados.resumo de cada canal
 * @param {Function} o.ehTelegram   telefone → boolean
 * @param {object} [o.atencao]      contagens já prontas { filaSemDono:{whatsapp,telegram}, esfriando, integracoesCaidas }
 */
export function montarVisao({ leads = [], funil = { etapas: [] }, auditoria = null, resultados = [], ehTelegram = () => false, atencao = {}, dias = 30, agora } = {}) {
  const fim = agora ? Date.parse(agora) : Date.now();
  const ini = fim - dias * DIA;
  const iniAnt = ini - dias * DIA;
  const canal = (l) => (ehTelegram(l.telefone) ? 'telegram' : 'whatsapp');

  // Leads novos por dia, por canal (dia sem lead aparece como zero, não some).
  const serieLeads = [];
  for (let t = ini; t <= fim; t += DIA) {
    serieLeads.push({ dia: new Date(t).toISOString().slice(0, 10), whatsapp: 0, telegram: 0 });
  }
  const porDia = new Map(serieLeads.map((x) => [x.dia, x]));
  for (const l of leads) {
    if (!noPer(l.criadoEm, ini, fim + 1)) { continue; }
    const d = porDia.get(String(l.criadoEm).slice(0, 10));
    if (d) { d[canal(l)]++; }
  }
  const novos = leads.filter((l) => noPer(l.criadoEm, ini, fim + 1)).length;
  const novosAnt = leads.filter((l) => noPer(l.criadoEm, iniAnt, ini)).length;

  // Receita: soma dos canais, dia a dia.
  const receita = resultados.reduce((s, r) => s + (r?.receitaCentavos || 0), 0);
  const temAnterior = resultados.some((r) => r && r.receitaAnteriorCentavos != null);
  const receitaAnt = temAnterior ? resultados.reduce((s, r) => s + (r?.receitaAnteriorCentavos || 0), 0) : null;
  const serieReceita = new Map();
  for (const r of resultados) {
    for (const p of r?.serie || []) { serieReceita.set(p.dia, (serieReceita.get(p.dia) || 0) + p.centavos); }
  }
  const porCanal = Object.fromEntries(resultados.filter(Boolean).map((r) => [r.canal, { receitaCentavos: r.receitaCentavos, pedidos: r.pedidos, pedidosConcluidos: r.pedidosConcluidos }]));
  const oportunidades = resultados.flatMap((r) => (r?.oportunidades || []).map((o) => ({ ...o, canal: r.canal })));

  const K = auditoria?.kpis || {};
  const conv = conversao(leads, ini, fim + 1);
  const convAnt = conversao(leads, iniAnt, ini);

  return {
    dias, de: new Date(ini).toISOString(), ate: new Date(fim).toISOString(),
    kpis: {
      receitaCentavos: receita,
      pedidos: resultados.reduce((s, r) => s + (r?.pedidos || 0), 0),
      pedidosPagos: resultados.reduce((s, r) => s + (r?.pedidosConcluidos || 0), 0),
      leadsNovos: novos,
      conversao: conv,
      tprMedio: K.tprMedio ?? null,
      conversas: K.conversas ?? null,
      taxaBot: K.taxaBot ?? null,
    },
    variacao: {
      receitaCentavos: variacao(receita, receitaAnt),
      leadsNovos: variacao(novos, novosAnt),
      conversao: variacao(conv, convAnt),
      tprMedio: auditoria?.variacao?.tprMedio ?? null,
    },
    serieLeads,
    serieReceita: serieLeads.map((x) => ({ dia: x.dia, centavos: serieReceita.get(x.dia) || 0 })),
    serieAtendimento: auditoria?.serie || [],
    funil: (funil.etapas || []).map((e) => ({ etapa: e.etapa, leads: e.leads, valor: e.valor })),
    porCanal,
    atencao: {
      filaSemDono: atencao.filaSemDono || { whatsapp: 0, telegram: 0 },
      esfriando: atencao.esfriando ?? 0,
      aguardandoPagamento: oportunidades.length,
      aguardandoCentavos: oportunidades.reduce((s, o) => s + (o.valorCentavos || 0), 0),
      integracoesCaidas: atencao.integracoesCaidas || [],
    },
  };
}
