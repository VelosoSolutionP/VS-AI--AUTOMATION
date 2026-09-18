/**
 * VScrm — leads e funil. Funções PURAS: recebem o lead/lista e devolvem o novo
 * estado. Quem grava é o store — assim dá pra testar sem tocar em disco.
 *
 * O funil NÃO tem default: as etapas vêm do que a empresa cadastrou na entrevista
 * (set "vendas"). Inventar "Novo lead > Proposta > Fechado" faria o CRM mentir sobre
 * o processo do cliente — mesma regra do métrica-null-nunca-zero do VSinfluence.
 */

/** Telefone em E.164 do Brasil. Sem DDI, a Cloud API e o CallMeBot descartam o envio. */
export function normalizarTelefone(bruto) {
  const d = String(bruto || '').replace(/\D/g, '');
  if (!d) { return { telefone: null, erro: 'telefone vazio' }; }
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) { return { telefone: d }; }
  // 10 = DDD + fixo/celular antigo; 11 = DDD + celular com o 9.
  if (d.length === 10 || d.length === 11) { return { telefone: '55' + d }; }
  return { telefone: d, erro: `telefone com ${d.length} digitos — fora do padrao BR (10, 11 ou com DDI 55)` };
}

const agora = () => new Date().toISOString();

/** Id curto e estável: telefone normalizado é a chave natural do lead no WhatsApp. */
export function leadId(telefone) {
  return 'l_' + String(telefone || '').replace(/\D/g, '');
}

/**
 * Cria um lead. `funil` são as etapas da empresa (em ordem); a primeira é a entrada.
 * @returns {{lead?:object, erro?:string}}
 */
export function novoLead({ nome, telefone, origem, interesse, valor }, funil, quando = agora()) {
  if (!funil?.length) { return { erro: 'sem funil cadastrado (entrevista set "vendas")' }; }
  const t = normalizarTelefone(telefone);
  if (!t.telefone) { return { erro: t.erro }; }
  return {
    lead: {
      id: leadId(t.telefone),
      nome: String(nome || '').trim() || null,
      telefone: t.telefone,
      telefoneAviso: t.erro || null,
      origem: origem || 'manual',
      interesse: interesse || null,
      valor: valor == null ? null : Number(valor),
      etapa: funil[0],
      score: null,
      faixa: null,
      status: 'aberto',
      criadoEm: quando,
      atualizadoEm: quando,
      historico: [{ tipo: 'criado', etapa: funil[0], quando }],
    },
  };
}

/** Move o lead de etapa. Etapa fora do funil é recusada — não inventa coluna. */
export function moverEtapa(lead, etapa, funil, quando = agora()) {
  if (!funil?.includes(etapa)) { return { erro: `etapa "${etapa}" nao esta no funil` }; }
  return {
    lead: {
      ...lead,
      etapa,
      atualizadoEm: quando,
      historico: [...lead.historico, { tipo: 'etapa', de: lead.etapa, para: etapa, quando }],
    },
  };
}

/** Fecha o lead como ganho ou perdido (sai do funil ativo, fica no histórico). */
export function fechar(lead, status, motivo = null, quando = agora()) {
  if (status !== 'ganho' && status !== 'perdido') { return { erro: 'status deve ser ganho ou perdido' }; }
  return {
    lead: {
      ...lead,
      status,
      atualizadoEm: quando,
      historico: [...lead.historico, { tipo: 'fechado', status, motivo, quando }],
    },
  };
}

/** Anexa o resultado do qualifyLead (VSvendas) ao lead — score fica auditável. */
export function aplicarQualificacao(lead, q, quando = agora()) {
  return {
    ...lead,
    score: q?.score ?? null,
    faixa: q?.faixa ?? null,
    atualizadoEm: quando,
    historico: [...lead.historico, { tipo: 'qualificado', score: q?.score ?? null, faixa: q?.faixa ?? null, motivos: q?.motivos || [], quando }],
  };
}

/** Registra uma interação (mensagem do bot ou do vendedor). */
export function registrarInteracao(lead, { canal, direcao, texto }, quando = agora()) {
  return {
    ...lead,
    atualizadoEm: quando,
    historico: [...lead.historico, { tipo: 'interacao', canal: canal || 'whatsapp', direcao: direcao || 'saida', texto: String(texto || '').slice(0, 2000), quando }],
  };
}

/** Insere ou substitui o lead na lista (chave = id). */
export function upsert(leads, lead) {
  const i = (leads || []).findIndex((l) => l.id === lead.id);
  if (i < 0) { return [...(leads || []), lead]; }
  const out = [...leads];
  out[i] = lead;
  return out;
}

/**
 * Resumo do funil pro painel: quantos e quanto em cada etapa, só dos leads ABERTOS.
 * Valor ausente NÃO vira 0 — soma null quando ninguém tem valor, pra tela escrever "—".
 */
export function resumoFunil(leads, funil) {
  const abertos = (leads || []).filter((l) => l.status === 'aberto');
  const etapas = (funil || []).map((etapa) => {
    const doGrupo = abertos.filter((l) => l.etapa === etapa);
    const valores = doGrupo.map((l) => l.valor).filter((v) => v != null);
    return { etapa, leads: doGrupo.length, valor: valores.length ? valores.reduce((a, b) => a + b, 0) : null };
  });
  const ganhos = (leads || []).filter((l) => l.status === 'ganho').length;
  const perdidos = (leads || []).filter((l) => l.status === 'perdido').length;
  const fechados = ganhos + perdidos;
  return {
    etapas,
    abertos: abertos.length,
    ganhos,
    perdidos,
    // Sem nenhum lead fechado não existe taxa — null, não 0%.
    conversao: fechados ? ganhos / fechados : null,
  };
}
