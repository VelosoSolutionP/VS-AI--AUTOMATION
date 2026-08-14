/**
 * Gate de INSTALAÇÃO. Os acessos de ANALISTA (tracker onde cria sprints) e QA
 * (sistema + chave onde gera a doc) são OBRIGATÓRIOS. Sem esses dados a suite NÃO
 * opera — nada de rodar com padrão default silencioso.
 */

const vazio = (v) => v == null || v === '' || v === 'xxx';

/** Lista o que falta pra suite estar instalada (padrão dev + acessos analista + qa). */
export function requiredMissing(company) {
  const miss = [];

  // Padrão de branch/commit: é de CADA EMPRESA, tem que vir da entrevista.
  if (vazio(company?.branchPattern)) { miss.push('dev: padrão do nome de branch (vs_interview set "dev" -> branch_pattern)'); }
  if (!Array.isArray(company?.tipos) || !company.tipos.length) { miss.push('dev: tipos aceitos de branch/commit (branch_tipos)'); }
  if (/<autor>/.test(String(company?.branchPattern || '')) && company?.autor == null) {
    miss.push('dev: segmento de autor da branch (branch_autor) — o padrão usa <autor>');
  }

  const r = (company?.integrations?.redmine) || {};
  if (!r.enabled || vazio(r.baseUrl)) { miss.push('analista: URL do tracker (vs_interview set "analista" -> tracker_url)'); }
  if (vazio(r.apiKey)) { miss.push('analista: chave de API do tracker (tracker_apikey)'); }
  if (r.projectId == null || vazio(r.projectId)) { miss.push('analista: projeto onde as sprints são criadas (tracker_projeto)'); }

  const q = (company?.integrations?.qa) || {};
  if (vazio(q.sistema)) { miss.push('qa: sistema onde o QA gera a doc (vs_interview set "qa" -> qa_sistema)'); }
  if (vazio(q.apiKey)) { miss.push('qa: chave de API do QA pra conectar e adotar o padrão (qa_apikey)'); }
  return miss;
}

export function isInstalled(company) {
  return requiredMissing(company).length === 0;
}

/** Lança se a suite não está instalada. Erro carrega `.notInstalled` + `.missing`. */
export function assertInstalled(company) {
  const missing = requiredMissing(company);
  if (missing.length) {
    const e = new Error(
      'Suite NÃO instalada — faltam itens OBRIGATÓRIOS (padrão dev + acessos de analista e QA):\n- '
      + missing.join('\n- ')
      + '\n\nRode a entrevista (vs_interview: dev, analista e qa) e depois vs_apply_config. '
      + 'Sem esses dados a suite não roda com padrão default.',
    );
    e.notInstalled = true;
    e.missing = missing;
    throw e;
  }
  return true;
}
