/**
 * VSpainel — relatórios. Cruza o que a suíte tem de real: funil do CRM, catálogo do
 * VSestoque e conteúdo do VSinfluence.
 *
 * A tela dizia "Sem base para relatar — o único dado real hoje é o funil do CRM". Isso
 * era verdade antes do VSestoque existir. Agora dá pra cruzar.
 *
 * Regra que atravessa o arquivo: divisão sem denominador devolve `null`, nunca 0 ou
 * 100%. Taxa de conversão de uma origem que nunca fechou nada é "não dá pra saber" —
 * escrever 0% mandaria o vendedor matar um canal por causa de amostra vazia.
 */

const DIA = 86400000;

function taxa(parte, total) {
  return total ? Number((parte / total).toFixed(4)) : null;
}

/**
 * Desempenho por origem do lead. É o relatório que responde "de onde vem quem
 * compra" — e é o que decide onde gastar em anúncio.
 */
export function porOrigem(leads = []) {
  const grupos = new Map();
  for (const l of leads) {
    const k = l.origem || 'sem origem';
    if (!grupos.has(k)) { grupos.set(k, []); }
    grupos.get(k).push(l);
  }

  const linhas = [...grupos.entries()].map(([origem, doGrupo]) => {
    const ganhos = doGrupo.filter((l) => l.status === 'ganho');
    const perdidos = doGrupo.filter((l) => l.status === 'perdido');
    const fechados = ganhos.length + perdidos.length;
    const valores = ganhos.map((l) => l.valor).filter((v) => v != null);
    return {
      origem,
      leads: doGrupo.length,
      abertos: doGrupo.filter((l) => l.status === 'aberto').length,
      ganhos: ganhos.length,
      perdidos: perdidos.length,
      conversao: taxa(ganhos.length, fechados),
      receita: valores.length ? valores.reduce((a, b) => a + b, 0) : null,
      // Sem nada fechado a origem não é "ruim", é desconhecida.
      amostraSuficiente: fechados >= 3,
    };
  });

  return linhas.sort((a, b) => b.leads - a.leads);
}

/**
 * Onde o funil perde gente. Só olha quem já passou por cada etapa segundo o
 * histórico — contar só quem está parado ali agora esconderia quem já avançou.
 */
export function funilConversao(leads = [], funil = []) {
  const passou = (lead, etapa) => (lead.historico || []).some((h) => h.etapa === etapa) || lead.etapa === etapa;

  return funil.map((etapa, i) => {
    const chegaram = leads.filter((l) => passou(l, etapa));
    const proxima = funil[i + 1];
    const avancaram = proxima ? chegaram.filter((l) => passou(l, proxima)) : [];
    return {
      etapa,
      chegaram: chegaram.length,
      parados: chegaram.filter((l) => l.etapa === etapa && l.status === 'aberto').length,
      avancaram: proxima ? avancaram.length : null,
      passagem: proxima ? taxa(avancaram.length, chegaram.length) : null,
    };
  });
}

/** Dias entre criar e fechar, só de quem fechou. Sem fechamento não há ciclo. */
export function cicloMedioDias(leads = []) {
  const fechados = leads.filter((l) => l.status !== 'aberto' && l.criadoEm && l.atualizadoEm);
  if (!fechados.length) { return null; }
  const dias = fechados.map((l) => (new Date(l.atualizadoEm) - new Date(l.criadoEm)) / DIA);
  return Number((dias.reduce((a, b) => a + b, 0) / dias.length).toFixed(1));
}

/** Leads abertos parados há mais de N dias — é onde o dinheiro esfria. */
export function esquecidos(leads = [], dias = 7, agora = Date.now()) {
  return leads
    .filter((l) => l.status === 'aberto' && l.atualizadoEm)
    .map((l) => ({ ...l, paradoDias: Math.floor((agora - new Date(l.atualizadoEm)) / DIA) }))
    .filter((l) => l.paradoDias >= dias)
    .sort((a, b) => b.paradoDias - a.paradoDias)
    .map((l) => ({ id: l.id, nome: l.nome, etapa: l.etapa, valor: l.valor, paradoDias: l.paradoDias }));
}

/**
 * Monta o relatório inteiro. Declara o que NÃO entrou, pra tela não dar a impressão
 * de que isto cobre o negócio todo.
 */
export function montar(dados = {}, agora = Date.now()) {
  const leads = dados.leads || [];
  const funil = dados.funil || [];
  const estoque = dados.estoque || null;

  const naoEntrou = [];
  if (!leads.length) { naoEntrou.push('nenhum lead no CRM'); }
  if (!estoque || !estoque.total) { naoEntrou.push('catálogo vazio no VSestoque'); }
  if (!(dados.medicoes || []).length) { naoEntrou.push('sem métrica de conteúdo coletada'); }
  naoEntrou.push('atendimento do bot não é medido (o canal ainda não existe)');

  return {
    periodo: dados.periodo || 'tudo que existe',
    origens: porOrigem(leads),
    funil: funilConversao(leads, funil),
    cicloMedioDias: cicloMedioDias(leads),
    esquecidos: esquecidos(leads, dados.diasEsquecido ?? 7, agora),
    catalogo: estoque ? {
      produtos: estoque.total,
      ativos: estoque.ativos,
      semSaldo: estoque.semEstoque,
      valorFormatado: estoque.valorFormatado,
      // O gargalo de anúncio é "quantos estão prontos pra cada canal".
      canais: estoque.canais,
    } : null,
    naoEntrou,
  };
}
