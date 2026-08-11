/**
 * VSvendas — perfil. Converte as respostas da entrevista (sets empresa + vendas)
 * no perfil estruturado que qualify/followup/objection consomem.
 */

const parseObjecoes = (arr) => (arr || []).map((linha) => {
  const [obj, resp] = String(linha).split(/=>|->|:/, 2).map((s) => (s || '').trim());
  return { objecao: obj, resposta: resp || null };
}).filter((o) => o.objecao);

/**
 * @param {object} empresa  respostas do set "empresa"
 * @param {object} vendas   respostas do set "vendas"
 */
export function mapProfile(empresa = {}, vendas = {}) {
  return {
    empresa: {
      nome: empresa.empresa_nome || '',
      vende: empresa.vende || '',
      propostaValor: empresa.proposta_valor || '',
      icp: empresa.icp || '',
      ticket: empresa.ticket ?? null,
      tom: empresa.tom || 'Consultivo',
    },
    funil: vendas.funil || [],
    canais: vendas.canais || [],
    sinaisQuente: vendas.sinais_quente || [],
    sinaisFrio: vendas.sinais_frio || [],
    objecoes: parseObjecoes(vendas.objecoes),
    followPrazoDias: vendas.follow_prazo ?? 3,
  };
}

/** Diz se dá pra operar (precisa de empresa + funil no mínimo). */
export function profileReady(profile) {
  const faltando = [];
  if (!profile.empresa?.vende) { faltando.push('o que a empresa vende (entrevista set "empresa")'); }
  if (!profile.funil?.length) { faltando.push('etapas do funil (entrevista set "vendas")'); }
  return { ready: faltando.length === 0, faltando };
}
