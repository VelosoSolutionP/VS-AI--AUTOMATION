/**
 * VSmarket — cadastro de cliente e prestador (§3 e §4).
 *
 * Funções PURAS. O status do prestador é máquina de estados fechada porque só
 * `ACTIVE` participa de matching (§4) — deixar o status ser atribuído livremente
 * significaria colocar em produção alguém que ninguém revisou.
 */
import { randomBytes } from 'node:crypto';
import { validarDocumento, normalizarTelefone, mascarar } from './documento.mjs';
import { validarCoordenada, foraDaRegiao } from './geo.mjs';

export const STATUS_PRESTADOR = ['PENDING', 'UNDER_REVIEW', 'ACTIVE', 'SUSPENDED', 'BLOCKED'];

/** Só ACTIVE entra no matching. Está aqui, num lugar só, pra não se espalhar. */
export const PARTICIPA_MATCHING = ['ACTIVE'];

/** Quem pode virar o quê. BLOCKED é final: reverter exige decisão de gente. */
export const TRANSICOES_PRESTADOR = {
  PENDING: ['UNDER_REVIEW', 'BLOCKED'],
  UNDER_REVIEW: ['ACTIVE', 'PENDING', 'BLOCKED'],
  ACTIVE: ['SUSPENDED', 'BLOCKED'],
  SUSPENDED: ['ACTIVE', 'BLOCKED'],
  BLOCKED: [],
};

export function podeMudarStatus(de, para) {
  if (!STATUS_PRESTADOR.includes(de)) { return { ok: false, motivo: `status atual desconhecido: "${de}"` }; }
  if (!STATUS_PRESTADOR.includes(para)) { return { ok: false, motivo: `status desconhecido: "${para}"` }; }
  if (de === para) { return { ok: true, repetido: true }; }
  if (!TRANSICOES_PRESTADOR[de].includes(para)) {
    return { ok: false, motivo: `não dá pra ir de ${de} para ${para} (permitidos: ${TRANSICOES_PRESTADOR[de].join(', ') || 'nenhum'})` };
  }
  return { ok: true };
}

const txt = (v) => String(v ?? '').trim();
const id = (p) => `${p}_${randomBytes(8).toString('hex')}`;

/** Endereço com coordenada — é o que o mapa mostra e o matching usa. */
export function normalizarEndereco(e = {}, opts = {}) {
  const erros = [];
  const logradouro = txt(e.logradouro);
  const cidade = txt(e.cidade);
  if (!logradouro) { erros.push('logradouro é obrigatório'); }
  if (!cidade) { erros.push('cidade é obrigatória'); }

  const coord = validarCoordenada({ lat: e.lat, lng: e.lng });
  if (!coord.ok) { erros.push(coord.motivo); }

  if (erros.length) { return { endereco: null, erros, avisos: [] }; }

  const avisos = [];
  const fora = foraDaRegiao(coord.coordenada);
  if (fora.fora && !opts.permitirForaDaRegiao) { avisos.push(fora.motivo); }

  return {
    endereco: {
      id: e.id || id('end'),
      apelido: txt(e.apelido) || null,
      logradouro,
      numero: txt(e.numero) || null,
      complemento: txt(e.complemento) || null,
      bairro: txt(e.bairro) || null,
      cidade,
      uf: txt(e.uf).toUpperCase() || null,
      cep: txt(e.cep).replace(/\D/g, '') || null,
      lat: coord.coordenada.lat,
      lng: coord.coordenada.lng,
      distanciaDoCentroKm: fora.distanciaKm ?? null,
    },
    erros: [],
    avisos,
  };
}

/**
 * Cliente (§3). Coleta mínima de propósito — o §3 diz "evitar coleta excessiva",
 * então documento NÃO é obrigatório aqui: só vira necessário no pagamento, e lá
 * quem guarda é o gateway.
 */
export function normalizarCliente(e = {}, opts = {}) {
  const erros = [];
  const avisos = [];

  const nome = txt(e.nome);
  if (!nome) { erros.push('nome é obrigatório'); }

  const tel = normalizarTelefone(e.telefone);
  if (!tel.ok) { erros.push(tel.motivo); }

  const mail = txt(e.email).toLowerCase();
  if (mail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) { erros.push(`e-mail inválido: "${e.email}"`); }

  // Aceite dos termos é requisito do §3 e prova de base legal do §39.
  if (!e.aceitouTermos) { erros.push('o aceite dos termos é obrigatório'); }

  const enderecos = [];
  for (const [i, end] of (e.enderecos || []).entries()) {
    const r = normalizarEndereco(end, opts);
    if (r.erros.length) { erros.push(`endereço ${i + 1}: ${r.erros.join('; ')}`); }
    else { enderecos.push(r.endereco); avisos.push(...r.avisos); }
  }

  if (erros.length) { return { cliente: null, erros, avisos }; }

  return {
    cliente: {
      id: e.id || id('cli'),
      usuarioId: e.usuarioId || null,
      nome,
      telefone: tel.telefone,
      email: mail || null,
      enderecos,
      aceitouTermos: true,
      aceiteEm: e.aceiteEm || new Date().toISOString(),
      favoritos: e.favoritos || [],
      // §23: o cliente também tem reputação operacional. Começa limpa.
      incidentesConfirmados: e.incidentesConfirmados || 0,
      criadoEm: e.criadoEm || new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
    },
    erros: [],
    avisos,
  };
}

/**
 * Prestador (§4). Nasce sempre PENDING: quem cadastra não se aprova.
 */
export function normalizarPrestador(e = {}, opts = {}) {
  const erros = [];
  const avisos = [];

  const nome = txt(e.nome);
  if (!nome) { erros.push('nome é obrigatório'); }

  const doc = validarDocumento(e.documento);
  if (!doc.ok) { erros.push(doc.motivo); }

  const tel = normalizarTelefone(e.telefone);
  if (!tel.ok) { erros.push(tel.motivo); }

  const categorias = (e.categorias || []).map(txt).filter(Boolean);
  if (!categorias.length) { erros.push('informe ao menos uma categoria de atuação'); }

  const base = validarCoordenada({ lat: e.lat, lng: e.lng });
  if (!base.ok) { erros.push('base operacional: ' + base.motivo); }

  const raio = Number(e.raioKm);
  if (!Number.isFinite(raio) || raio <= 0) { erros.push(`raio de atendimento inválido: "${e.raioKm}" (km, maior que zero)`); }
  else if (raio > 100) { avisos.push(`raio de ${raio} km é maior que a própria região do MVP — confira se é isso mesmo`); }

  const status = txt(e.status).toUpperCase() || 'PENDING';
  if (!STATUS_PRESTADOR.includes(status)) { erros.push(`status desconhecido: "${e.status}"`); }
  // Cadastro não se auto-aprova: só a transição de status leva a ACTIVE.
  if (!e.id && status !== 'PENDING') { erros.push('prestador novo nasce PENDING — use a mudança de status para aprovar'); }

  if (erros.length) { return { prestador: null, erros, avisos }; }

  const fora = foraDaRegiao(base.coordenada);
  if (fora.fora) { avisos.push('base operacional ' + fora.motivo); }
  if (!(e.documentos || []).length) { avisos.push('sem documentos anexados — a revisão vai pedir antes de ativar'); }
  if (!e.walletId) { avisos.push('sem conta de recebimento — não dá pra repassar pagamento a este prestador'); }

  return {
    prestador: {
      id: e.id || id('prs'),
      usuarioId: e.usuarioId || null,
      nome,
      documento: doc.numero,
      documentoTipo: doc.tipo,
      documentoMascarado: mascarar(doc.numero),
      telefone: tel.telefone,
      email: txt(e.email).toLowerCase() || null,
      descricao: txt(e.descricao) || null,
      experienciaAnos: Number.isFinite(Number(e.experienciaAnos)) ? Number(e.experienciaAnos) : null,
      categorias,
      especialidades: (e.especialidades || []).map(txt).filter(Boolean),
      base: { lat: base.coordenada.lat, lng: base.coordenada.lng },
      endereco: txt(e.endereco) || null,
      raioKm: raio,
      cidades: (e.cidades || []).map(txt).filter(Boolean),
      bairros: (e.bairros || []).map(txt).filter(Boolean),
      disponibilidade: e.disponibilidade || null,
      documentos: e.documentos || [],
      walletId: txt(e.walletId) || null,
      status,
      // §8: o ranking olha isso. Começa nulo — prestador novo não é "nota zero".
      reputacao: e.reputacao ?? null,
      servicosConcluidos: e.servicosConcluidos ?? 0,
      criadoEm: e.criadoEm || new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
      historicoStatus: e.historicoStatus || [],
    },
    erros: [],
    avisos,
  };
}

/** Muda o status guardando quem mudou e por quê — entra na auditoria do §37. */
export function mudarStatus(prestador, para, opts = {}) {
  const r = podeMudarStatus(prestador?.status, para);
  if (!r.ok) { return { prestador: null, erro: r.motivo }; }
  if (r.repetido) { return { prestador, repetido: true, erro: null }; }

  const motivo = txt(opts.motivo);
  // Tirar do ar sem motivo registrado é o tipo de decisão que ninguém consegue
  // explicar depois — e o prestador tem direito de saber.
  if (['SUSPENDED', 'BLOCKED'].includes(para) && !motivo) {
    return { prestador: null, erro: `mudar para ${para} exige motivo registrado` };
  }

  const evento = { de: prestador.status, para, motivo: motivo || null, por: opts.por || null, em: opts.quando || new Date().toISOString() };
  return {
    prestador: { ...prestador, status: para, atualizadoEm: evento.em, historicoStatus: [...(prestador.historicoStatus || []), evento] },
    evento,
    erro: null,
  };
}

/** Forma pública: documento mascarado, sem dado que a tela não precisa. */
export function prestadorPublico(p) {
  if (!p) { return null; }
  const { documento, ...resto } = p;
  return resto;
}
