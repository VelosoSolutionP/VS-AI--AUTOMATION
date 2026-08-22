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
  // vende/proposta_valor/icp/ticket/tom sao perguntados na SECAO "Empresa", mas o
  // schema grava tudo isso no SET "vendas" — secao e so rotulo de tela. Ler do set
  // "empresa" deixava o perfil eternamente incompleto: quem respondia a entrevista
  // inteira, certinho, continuava recebendo "VSvendas sem perfil" em qualify,
  // followup, objection e ads. Le do set certo, com fallback pro set antigo.
  const campo = (k) => (vendas[k] !== undefined && vendas[k] !== null && vendas[k] !== '' ? vendas[k] : empresa[k]);
  return {
    empresa: {
      nome: empresa.empresa_nome || vendas.empresa_nome || '',
      vende: campo('vende') || '',
      propostaValor: campo('proposta_valor') || '',
      icp: campo('icp') || '',
      ticket: campo('ticket') ?? null,
      tom: campo('tom') || 'Consultivo',
    },
    funil: vendas.funil || [],
    canais: vendas.canais || [],
    sinaisQuente: vendas.sinais_quente || [],
    sinaisFrio: vendas.sinais_frio || [],
    objecoes: parseObjecoes(vendas.objecoes),
    followPrazoDias: vendas.follow_prazo ?? 3,
    marketing: {
      plataformas: vendas.plataformas_anuncio || [],
      fotosPasta: vendas.fotos_pasta || null,
      estilo: vendas.estilo_anuncio || null,
    },
  };
}

/** Diz se dá pra operar (precisa de empresa + funil no mínimo). */
export function profileReady(profile) {
  const faltando = [];
  if (!profile.empresa?.vende) { faltando.push('o que a empresa vende (entrevista set "vendas")'); }
  if (!profile.funil?.length) { faltando.push('etapas do funil (entrevista set "vendas")'); }
  return { ready: faltando.length === 0, faltando };
}
