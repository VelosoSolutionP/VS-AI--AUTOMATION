/**
 * Cliente da API do Cadê Você (cadevc.velososolution.com.br) — o sistema de
 * agenda de salão/barbearia do dono. O CRM é o CONTROLLER: o bot do salão lê e
 * grava a agenda AQUI, por esta API, logando como usuário de serviço (Bearer).
 * A agenda NÃO é duplicada no CRM — a fonte da verdade é o Cadê Você.
 *
 * Contrato descoberto em 21/10 (base `/api/integracao/v1`, header
 * `Authorization: Bearer <token do salão>`):
 *   GET  /cadevc                                   -> { cadevc, regras, horarios[], servicos[] }
 *   GET  /horarios?data=YYYY-MM-DD&servicos=a,b    -> { data, duracao, valor, profissionais[] }
 *   GET  /agendamentos?telefone=<DDD+numero>       -> { agendamentos[] }
 *   POST /agendamentos        (corpo do bot)       -> marca
 *   POST /agendamentos/{id}   (corpo do bot)       -> ação no agendamento (cancelar/confirmar)
 *
 * O token é por SALÃO (cada salão tem o seu) e mora em variável de ambiente /
 * na casa da empresa — nunca no git. Nada de regra de negócio aqui: só HTTP.
 */
const soDigitos = (s) => String(s || '').replace(/\D/g, '');

export function criarCadevcClient(opcoes = {}) {
  const ctx = () => (typeof opcoes.credenciais === 'function' ? opcoes.credenciais() : null);
  const base = () => String(ctx()?.baseUrl || opcoes.baseUrl || process.env.CADEVC_URL || '').replace(/\/$/, '');
  const token = () => ctx()?.token || opcoes.token || process.env.CADEVC_TOKEN || '';
  const fetchImpl = opcoes.fetchImpl || globalThis.fetch;

  async function api(caminho, { method = 'GET', body, query } = {}) {
    if (!base() || !token()) { throw new Error('CADEVC_URL/CADEVC_TOKEN ausentes'); }
    const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '')).toString() : '';
    /* Trilha (dono 22/10): cada ida à API do salão vira linha no log, com status.
       É aqui que se vê se "o bot consegue enviar os dados" pro Cadê Você. */
    const t0 = Date.now();
    let r;
    try {
      r = await fetchImpl(`${base()}/${caminho}${qs}`, {
        method,
        headers: { authorization: `Bearer ${token()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      console.error(`[cadevc] ${method} /${caminho}${qs} FALHOU DE REDE em ${Date.now() - t0}ms: ${e.message} (não alcançou a API do salão)`);
      throw e;
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error(`[cadevc] ${method} /${caminho}${qs} → HTTP ${r.status} em ${Date.now() - t0}ms: ${j?.error || j?.message || '(sem detalhe)'}`);
      throw new Error(j?.error || j?.message || `HTTP ${r.status}`);
    }
    console.log(`[cadevc] ${method} /${caminho}${qs} → ok (${r.status}) em ${Date.now() - t0}ms`);
    return j;
  }

  return {
    /** Config do salão: dados, regras (cancelamento/multa/tolerância), horários, serviços. */
    /* A rota real da API é /salao, com os dados no campo `salao`. Quem chama
       lê `cadevc`, então normaliza aqui. /cadevc fica como reserva. */
    cadevc: async () => {
      const j = await api('salao').catch((e) => { if (/404/.test(e.message)) { return api('cadevc'); } throw e; });
      return j?.salao && !j.cadevc ? { ...j, cadevc: j.salao } : j;
    },
    /** Vagas de um dia para um ou mais serviços (ids). */
    vagas: ({ data, servicos }) => api('horarios', { query: { data, servicos: Array.isArray(servicos) ? servicos.join(',') : servicos } }),
    /** Agendamentos de um cliente pelo telefone (só dígitos, com DDD). */
    agendamentosDe: (telefone) => api('agendamentos', { query: { telefone: soDigitos(telefone) } }),
    /** Marca. Campos: telefone (com DDD), servicos[ids], data (AAAA-MM-DD), hora (HH:mm)
       obrigatórios; nome (só cliente nova, senão 422), profissional (id; sem ele pega o
       primeiro livre — atenção: é "profissional", não "profissionalId"), observacoes.
       201 → { agendamento:{id,inicio,fim,status,valor,profissional,servicos}, cliente:{nome,nova}, multasColetadas }. */
    marcar: (corpo) => api('agendamentos', { method: 'POST', body: corpo }),
    /** Confirma presença. → { ok:true, jaConfirmado }. */
    confirmar: (id) => api(`agendamentos/${encodeURIComponent(id)}`, { method: 'POST', body: { acao: 'confirmar' } }),
    /** Cancela. Fora do prazo do salão, a multa volta e é cobrada no PRÓXIMO agendamento
       (multasColetadas no marcar). → { ok:true, multa }. */
    cancelar: (id, motivo) => api(`agendamentos/${encodeURIComponent(id)}`, { method: 'POST', body: { acao: 'cancelar', ...(motivo ? { motivo } : {}) } }),
    /** Ação crua num agendamento, se precisar de algo além de confirmar/cancelar. */
    acao: (id, corpo) => api(`agendamentos/${encodeURIComponent(id)}`, { method: 'POST', body: corpo }),
    /** Acesso cru, pra quando surgir um endpoint novo. */
    api,
  };
}
