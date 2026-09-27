/**
 * VSauditoria — o Auditor de um canal, do jeito que o mercado mostra.
 *
 * Duas camadas, como nos sistemas de atendimento (Zendesk, Intercom, Blip…):
 *  1. DESEMPENHO: métricas padrão do setor — TPR (tempo da primeira resposta
 *     humana), TMA (tempo médio de atendimento), SLA (% atendido no prazo),
 *     CSAT (satisfação pelas notas) e taxa de resolução pelo bot —, cada uma
 *     comparada com o período anterior; série por dia, mapa de calor por dia da
 *     semana × hora, funil, desfechos e desempenho por atendente.
 *  2. LOG DE AUDITORIA: tudo o que aconteceu (quem, o quê, quando, protocolo),
 *     gravado no momento — é a evidência de cada número.
 *
 * Função pura: recebe os dados (leads, protocolos, campanhas, segurança) e
 * devolve o painel. Nada é estimado: sem dado, a métrica sai `null` ("—").
 */

const TZ = 'America/Sao_Paulo';
const dia = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));
const hora = (iso) => Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso)));
const semana = (iso) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date(iso)));
const min = (a, b) => (new Date(b) - new Date(a)) / 60000;
const media = (v) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : null);
const quantil = (v, q) => { if (!v.length) { return null; } const o = [...v].sort((a, b) => a - b); return o[Math.min(o.length - 1, Math.floor(q * o.length))]; };
const arred = (x, c = 1) => (x == null ? null : Math.round(x * 10 ** c) / 10 ** c);

export const SLA_MIN_PADRAO = 5;
export const TIPOS_LOG = {
  mensagem_cliente: 'Mensagem do cliente', mensagem_bot: 'Resposta do bot', mensagem_equipe: 'Resposta da equipe',
  aberto: 'Atendimento aberto', transferido: 'Transferido para a equipe', assumido: 'Assumido', responsavel: 'Responsável definido',
  encaminhado: 'Encaminhado (qualificação)', finalizado: 'Finalizado', encerrado: 'Encerrado à força', silencio: 'Encerrado por silêncio',
  moderacao: 'Moderação', avaliacao: 'Avaliação do cliente', lead: 'Lead criado', etapa: 'Mudança de etapa', seguranca: 'Segurança', campanha: 'Campanha',
};

/**
 * @param {object} o
 * @param {'telegram'|'whatsapp'} o.canal
 * @param {(id:string)=>boolean} o.doCanal   o identificador (telefone/lead) é deste canal?
 * @param {Array} o.leads       crm.listar()
 * @param {Array} o.protocolos  proto.listar()
 * @param {Array} [o.campanhas] vscampanhas.listar() (só Telegram)
 * @param {Array} [o.seguranca] vsseguranca.auditoria()
 * @param {number} [o.dias=30]
 * @param {number} [o.slaMin=5]
 * @param {string} [o.agora]
 */
export function montarAuditoria({ canal, doCanal, leads = [], protocolos = [], campanhas = [], seguranca = [], dias = 30, slaMin = SLA_MIN_PADRAO, agora } = {}) {
  const fim = agora ? new Date(agora) : new Date();
  const ini = new Date(fim.getTime() - dias * 86400000);
  const iniAnt = new Date(ini.getTime() - dias * 86400000);
  const noPer = (iso, a, b) => { const t = new Date(iso); return t >= a && t < b; };
  const leadPorTel = new Map(leads.filter((l) => doCanal(l.telefone)).map((l) => [l.telefone, l]));
  const protos = protocolos.filter((p) => doCanal(p.de));

  const comGente = (p) => !!(p.atendidoPor || p.filaDesde || ['na_fila', 'com_humano'].includes(p.estadoAntes) || ['na_fila', 'com_humano'].includes(p.estado));
  /** Primeira resposta da EQUIPE depois de o cliente ir para a fila. */
  function tpr(p) {
    const l = leadPorTel.get(p.de); if (!l) { return null; }
    const t0 = p.filaDesde || p.abertoEm;
    const limite = p.encerradoEm ? new Date(new Date(p.encerradoEm).getTime() + 60000).toISOString() : fim.toISOString();
    const r = (l.historico || []).find((h) => h.tipo === 'interacao' && h.direcao === 'saida' && h.autor === 'atendente' && h.quando >= t0 && h.quando <= limite);
    return r ? Math.max(0, min(t0, r.quando)) : null;
  }

  function metricas(a, b) {
    const ps = protos.filter((p) => noPer(p.abertoEm, a, b));
    const gente = ps.filter(comGente);
    const tprs = gente.map(tpr).filter((x) => x != null);
    const tmas = gente.filter((p) => p.encerradoEm).map((p) => min(p.abertoEm, p.encerradoEm));
    const notas = ps.map((p) => p.avaliacao?.nota).filter((n) => n != null);
    return {
      conversas: ps.length,
      pelaEquipe: gente.length,
      pelaBot: ps.length - gente.length,
      taxaBot: ps.length ? (ps.length - gente.length) / ps.length : null,
      tprMedio: arred(media(tprs)), tprMediana: arred(quantil(tprs, 0.5)), tprP90: arred(quantil(tprs, 0.9)),
      tmaMedio: arred(media(tmas)),
      sla: tprs.length ? tprs.filter((x) => x <= slaMin).length / tprs.length : null,
      csat: notas.length ? notas.filter((n) => n >= 4).length / notas.length : null,
      notaMedia: arred(media(notas)), avaliacoes: notas.length, pedidasAvaliacao: ps.filter((p) => p.avaliacao).length,
      finalizados: ps.filter((p) => p.desfecho === 'finalizado').length,
      encerradosAForca: ps.filter((p) => p.desfecho === 'encerrado').length,
      porSilencio: ps.filter((p) => p.desfecho === 'inatividade' || p.motivoEncerramento === 'inatividade').length,
      moderacao: ps.filter((p) => p.desfecho === 'moderacao' || p.motivoEncerramento === 'moderacao').length,
      _ps: ps, _gente: gente,
    };
  }
  const atual = metricas(ini, fim);
  const anterior = metricas(iniAnt, ini);
  const variacao = (k) => (atual[k] == null || anterior[k] == null || anterior[k] === 0 ? null : (atual[k] - anterior[k]) / Math.abs(anterior[k]));

  // Série por dia (dia sem atendimento aparece zerado — não some).
  const serie = [];
  // Do 1º ao ÚLTIMO dia, inclusive hoje (parar em `< fim` deixava hoje de fora).
  const hoje = dia(fim.toISOString());
  for (let t = new Date(ini); ; t = new Date(t.getTime() + 86400000)) {
    const d = dia(t.toISOString());
    if (serie.at(-1)?.dia !== d) { serie.push({ dia: d, bot: 0, equipe: 0 }); }
    if (d >= hoje) { break; }
  }
  const porDia = new Map(serie.map((x) => [x.dia, x]));
  for (const p of atual._ps) { const x = porDia.get(dia(p.abertoEm)); if (x) { x[comGente(p) ? 'equipe' : 'bot'] += 1; } }

  // Mapa de calor: mensagens de CLIENTE por dia da semana × hora.
  const calor = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const l of leadPorTel.values()) {
    for (const h of l.historico || []) {
      if (h.tipo === 'interacao' && h.direcao === 'entrada' && noPer(h.quando, ini, fim)) { calor[semana(h.quando)][hora(h.quando)] += 1; }
    }
  }

  // Funil do atendimento.
  const funil = [
    { etapa: 'Chegaram', n: atual.conversas },
    { etapa: 'Foram para a equipe', n: atual.pelaEquipe },
    { etapa: 'Assumidos', n: atual._gente.filter((p) => p.atendidoPor).length },
    { etapa: 'Finalizados', n: atual._gente.filter((p) => p.desfecho === 'finalizado').length },
    { etapa: 'Avaliados', n: atual._gente.filter((p) => p.avaliacao?.nota != null).length },
  ];

  // Motivos de encerramento à força.
  const motivos = {};
  for (const p of atual._ps.filter((x) => x.desfecho === 'encerrado')) { const m = p.motivoTexto || 'sem motivo'; motivos[m] = (motivos[m] || 0) + 1; }

  // Notas 1..5.
  const notas = [1, 2, 3, 4, 5].map((n) => ({ nota: n, n: atual._ps.filter((p) => p.avaliacao?.nota === n).length }));

  // Por atendente.
  const porAt = {};
  for (const p of atual._gente) {
    const nome = p.atendidoPor?.nome; if (!nome) { continue; }
    const a = porAt[nome] || (porAt[nome] = { nome, atendimentos: 0, tprs: [], tmas: [], notas: [], aForca: 0 });
    a.atendimentos += 1;
    const t = tpr(p); if (t != null) { a.tprs.push(t); }
    if (p.encerradoEm) { a.tmas.push(min(p.abertoEm, p.encerradoEm)); }
    if (p.avaliacao?.nota != null) { a.notas.push(p.avaliacao.nota); }
    if (p.desfecho === 'encerrado') { a.aForca += 1; }
  }
  const atendentes = Object.values(porAt).map((a) => ({ nome: a.nome, atendimentos: a.atendimentos, tprMedio: arred(media(a.tprs)), tmaMedio: arred(media(a.tmas)), notaMedia: arred(media(a.notas)), avaliacoes: a.notas.length, encerradosAForca: a.aForca }))
    .sort((x, y) => y.atendimentos - x.atendimentos);

  // ── LOG DE AUDITORIA ──
  const log = [];
  const ev = (quando, tipo, quem, detalhe, protocolo = null, cliente = null) => { if (quando && noPer(quando, ini, fim)) { log.push({ quando, tipo, quem, detalhe, protocolo, cliente }); } };
  for (const l of leadPorTel.values()) {
    const cli = l.nome || l.telefone;
    for (const h of l.historico || []) {
      if (h.tipo === 'interacao') {
        const t = String(h.texto || '').replace(/\s+/g, ' ').slice(0, 140);
        if (h.direcao === 'entrada') { ev(h.quando, 'mensagem_cliente', cli, t, null, cli); }
        else if (h.autor === 'atendente') { ev(h.quando, 'mensagem_equipe', 'Equipe', t, null, cli); }
        else { ev(h.quando, 'mensagem_bot', 'Bot', t, null, cli); }
      } else if (h.tipo === 'criado') { ev(h.quando, 'lead', 'Sistema', `lead criado na etapa “${h.etapa}”`, null, cli); }
      else if (h.tipo === 'etapa') { ev(h.quando, 'etapa', 'Sistema', `${h.de || '—'} → ${h.para || '—'}`, null, cli); }
      else if (h.tipo === 'roteamento') { ev(h.quando, 'encaminhado', 'Sistema', `${h.equipe ? `para ${h.equipe} · ` : ''}${h.motivo || ''}`, null, cli); }
      else if (h.tipo === 'responsavel') { ev(h.quando, 'responsavel', 'Sistema', `${h.para || 'ninguém'}${h.de ? ` (antes: ${h.de})` : ''}${h.motivo ? ` · ${h.motivo}` : ''}`, null, cli); }
    }
  }
  for (const p of protos) {
    const cli = leadPorTel.get(p.de)?.nome || p.de;
    ev(p.abertoEm, 'aberto', 'Sistema', 'atendimento aberto', p.numero, cli);
    if (p.filaDesde) { ev(p.filaDesde, 'transferido', 'Bot', `foi para a fila${p.departamento && p.departamento !== 'humano' ? ` (${p.departamento})` : ''}`, p.numero, cli); }
    if (p.encerradoEm) {
      const quem = p.encerradoPor?.tipo === 'cliente' ? 'Cliente' : p.encerradoPor?.nome || (p.desfecho === 'inatividade' ? 'Sistema' : 'Equipe');
      const tipo = p.desfecho === 'finalizado' ? 'finalizado' : p.desfecho === 'encerrado' ? 'encerrado' : p.desfecho === 'moderacao' || p.motivoEncerramento === 'moderacao' ? 'moderacao' : 'silencio';
      ev(p.encerradoEm, tipo, quem, [p.atendidoPor?.nome ? `atendido por ${p.atendidoPor.nome}` : null, p.motivoTexto].filter(Boolean).join(' · ') || TIPOS_LOG[tipo].toLowerCase(), p.numero, cli);
    }
    const a = p.avaliacao;
    if (a?.nota != null) { ev(a.comentarioEm || a.notaEm || p.encerradoEm, 'avaliacao', cli, `nota ${a.nota}/5${a.comentario ? ` — “${String(a.comentario).slice(0, 120)}”` : ''}`, p.numero, cli); }
  }
  const numeros = new Set(protos.map((p) => p.numero));
  for (const s of seguranca) {
    if ((s.protocolo && numeros.has(s.protocolo)) || (s.cliente && doCanal(s.cliente))) { ev(s.em, 'seguranca', 'Sistema', `${s.tipo}: ${s.detalhe || ''}`.slice(0, 180), s.protocolo || null, s.cliente || null); }
  }
  for (const c of campanhas) {
    for (const h of c.historico || []) { ev(h.em, 'campanha', 'Sistema', `“${c.nome}”: ${h.evento}`); }
  }
  log.sort((a, b) => String(b.quando).localeCompare(String(a.quando)));

  const { _ps, _gente, ...kpis } = atual;
  const { _ps: _a, _gente: _b, ...kpisAnt } = anterior;
  return {
    canal, dias, slaMin, de: ini.toISOString(), ate: fim.toISOString(),
    kpis, anterior: kpisAnt,
    variacao: { conversas: variacao('conversas'), taxaBot: variacao('taxaBot'), tprMedio: variacao('tprMedio'), tmaMedio: variacao('tmaMedio'), sla: variacao('sla'), csat: variacao('csat'), notaMedia: variacao('notaMedia') },
    serie, calor, funil, notas, atendentes,
    motivos: Object.entries(motivos).map(([motivo, n]) => ({ motivo, n })).sort((a, b) => b.n - a.n),
    log: log.slice(0, 3000), totalLog: log.length,
    tipos: TIPOS_LOG,
  };
}
