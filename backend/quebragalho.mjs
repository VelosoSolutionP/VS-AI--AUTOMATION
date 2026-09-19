/**
 * Ponte do painel para o Quebra-Galho.
 *
 * O marketplace roda em processo e porta próprios. Este arquivo fala com ele por
 * HTTP e NÃO importa nada de `engine/vsmarket/`: é o que permite o produto aparecer
 * dentro do painel sem virar dependência de compilação — um fora do ar não impede o
 * outro de subir.
 *
 * Fora do ar não é erro de tela: volta um estado "indisponível" com o motivo, e o
 * painel mostra isso em vez de quebrar.
 */
export const QG_URL = process.env.QG_URL || 'http://127.0.0.1:8900';

/** Token compartilhado entre os dois serviços. Sem ele a integração fica desligada. */
export const QG_TOKEN = process.env.QG_TOKEN || '';

const TIMEOUT = 4000;

async function buscar(caminho, fetchImpl = globalThis.fetch) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetchImpl(QG_URL + caminho, {
      signal: ctrl.signal,
      headers: QG_TOKEN ? { 'x-qg-token': QG_TOKEN } : {},
    });
    if (res.status === 401) { return { ok: false, motivo: 'token de integração recusado pelo Quebra-Galho' }; }
    if (res.status === 503) { return { ok: false, motivo: 'a integração está desligada no Quebra-Galho (QG_INTEGRACAO_TOKEN)' }; }
    if (!res.ok) { return { ok: false, motivo: `o Quebra-Galho respondeu HTTP ${res.status}` }; }
    return { ok: true, dados: await res.json() };
  } catch (e) {
    const abortou = e?.name === 'AbortError';
    return {
      ok: false,
      motivo: abortou ? `sem resposta em ${TIMEOUT / 1000}s` : 'não consegui falar com o Quebra-Galho',
    };
  } finally {
    clearTimeout(t);
  }
}

/** Números do marketplace para o painel. Nunca lança. */
export async function painelQuebraGalho(fetchImpl) {
  const saude = await buscar('/api/saude', fetchImpl);
  if (!saude.ok) {
    return {
      disponivel: false,
      url: QG_URL,
      motivo: saude.motivo,
      // Instrução concreta em vez de "erro": quem lê precisa saber o que fazer.
      comoResolver: `suba o marketplace com \`node marketplace/server.mjs\` ou aponte QG_URL para onde ele está`,
    };
  }
  if (!QG_TOKEN) {
    return {
      disponivel: false, url: QG_URL,
      motivo: 'QG_TOKEN não está configurado neste painel',
      comoResolver: 'defina o MESMO segredo em QG_TOKEN aqui e em QG_INTEGRACAO_TOKEN no marketplace',
    };
  }
  // Uma chamada só, e ela devolve SÓ agregado: nome, telefone e endereço de cliente
  // não atravessam a fronteira entre produtos (§31, §39).
  const r = await buscar('/api/integracao/resumo', fetchImpl);
  if (!r.ok) {
    return { disponivel: false, url: QG_URL, motivo: r.motivo,
      comoResolver: 'confira se QG_TOKEN aqui é igual a QG_INTEGRACAO_TOKEN no marketplace' };
  }
  return { disponivel: true, url: QG_URL, ...r.dados };
}
