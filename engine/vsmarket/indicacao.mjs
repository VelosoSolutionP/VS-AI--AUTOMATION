/**
 * VSmarket — indicação / referral (§32).
 *
 * O §32 é explícito: **não definir recompensa financeira antes da regra comercial e
 * jurídica**. Por isso este módulo registra o vínculo e a conversão, e deixa a
 * recompensa num estado (`PENDENTE_DE_REGRA`) que a tela mostra como tal. Inventar
 * "R$ 50 por indicação" aqui viraria promessa que alguém teria de honrar.
 */
import { randomBytes } from 'node:crypto';

export const STATUS_RECOMPENSA = ['PENDENTE_DE_REGRA', 'APURADA', 'PAGA', 'CANCELADA'];

/** O que conta como conversão — decidido por quem chama, não presumido aqui. */
export const CONVERSOES = ['cadastro', 'primeiro_pedido', 'primeiro_servico_concluido'];

const slug = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12);

/**
 * Código de indicação legível, único na lista dada. Legível importa: o indicador vai
 * ditar isso por telefone.
 */
export function gerarCodigo(nome, existentes = []) {
  const base = slug(nome) || 'vs';
  if (!existentes.includes(base)) { return base; }
  for (let i = 2; i < 100; i++) {
    const c = `${base}${i}`;
    if (!existentes.includes(c)) { return c; }
  }
  return `${base}${randomBytes(2).toString('hex')}`;
}

/**
 * Registra a indicação. Recusa auto-indicação — é o abuso mais óbvio (§38).
 */
export function registrarIndicacao(e = {}, existentes = []) {
  const erros = [];
  const codigo = String(e.codigo || '').trim().toLowerCase();
  const indicadoId = String(e.indicadoId || '').trim();

  if (!codigo) { erros.push('código de indicação é obrigatório'); }
  if (!indicadoId) { erros.push('quem foi indicado é obrigatório'); }
  if (!e.indicadorId) { erros.push('código não corresponde a nenhum indicador'); }
  if (e.indicadorId && e.indicadorId === indicadoId) { erros.push('não dá pra indicar a si mesmo'); }
  if (existentes.some((i) => i.indicadoId === indicadoId)) {
    // Primeira indicação vence: senão dava pra "roubar" indicado de outro.
    erros.push('esta pessoa já foi indicada por alguém');
  }
  if (erros.length) { return { indicacao: null, erros }; }

  return {
    indicacao: {
      id: 'ind_' + randomBytes(6).toString('hex'),
      codigo,
      indicadorId: e.indicadorId,
      indicadoId,
      indicadoPapel: e.indicadoPapel || null,
      conversao: null,
      convertidaEm: null,
      // §32: o valor não existe até a regra existir.
      recompensaStatus: 'PENDENTE_DE_REGRA',
      recompensaCentavos: null,
      criadaEm: e.quando || new Date().toISOString(),
    },
    erros: [],
  };
}

/** Marca a conversão. Converter duas vezes não duplica recompensa. */
export function converter(indicacao, tipo, quando = new Date().toISOString()) {
  if (!indicacao) { return { indicacao: null, erro: 'indicação não encontrada' }; }
  if (!CONVERSOES.includes(tipo)) {
    return { indicacao: null, erro: `conversão desconhecida: "${tipo}" (use ${CONVERSOES.join(', ')})` };
  }
  if (indicacao.conversao) {
    return { indicacao, jaConvertida: true, erro: null };
  }
  return { indicacao: { ...indicacao, conversao: tipo, convertidaEm: quando }, erro: null };
}

/**
 * Painel de indicação: quem indicou quantos e quanto converteu.
 * Recompensa aparece como pendente de regra — nunca como valor.
 */
export function painel(indicacoes = []) {
  const porIndicador = new Map();
  for (const i of indicacoes) {
    if (!porIndicador.has(i.indicadorId)) { porIndicador.set(i.indicadorId, []); }
    porIndicador.get(i.indicadorId).push(i);
  }
  const linhas = [...porIndicador.entries()].map(([indicadorId, lista]) => ({
    indicadorId,
    indicados: lista.length,
    convertidas: lista.filter((i) => i.conversao).length,
    taxa: lista.length ? Number((lista.filter((i) => i.conversao).length / lista.length).toFixed(4)) : null,
    codigo: lista[0]?.codigo || null,
  })).sort((a, b) => b.convertidas - a.convertidas);

  return {
    total: indicacoes.length,
    convertidas: indicacoes.filter((i) => i.conversao).length,
    linhas,
    // O painel diz por que não há valor — silêncio pareceria bug.
    recompensa: {
      definida: false,
      motivo: 'a recompensa por indicação depende de regra comercial e jurídica (§32) — nada é prometido até lá',
    },
  };
}
