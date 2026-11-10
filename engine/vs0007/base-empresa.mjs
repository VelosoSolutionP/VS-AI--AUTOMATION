/**
 * Base de conhecimento curada por empresa.
 *
 * O 0007 continua pesquisando a web, mas quando existe uma base revisada da
 * empresa/produto ela vem primeiro: fatos com fonte, sem trecho de blog
 * aleatório, sem texto de outro segmento e sem CNPJ trocado.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DIR_BASES = join(AQUI, 'bases');

const digitos = (valor) => String(valor || '').replace(/\D/g, '');
const host = (valor) => {
  const texto = String(valor || '').trim();
  if (!texto) return '';
  try {
    return new URL(/^https?:\/\//i.test(texto) ? texto : `https://${texto}`).hostname.toLowerCase();
  } catch {
    return '';
  }
};
const termos = (valor) => String(valor || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .split(/[^a-z0-9]+/).filter((termo) => termo.length > 2);

function hostDaBase(base) {
  return [...new Set([host(base?.empresa?.site), ...(base?.empresa?.dominios || []).map(host)].filter(Boolean))];
}

function hostCombina(alvo, base) {
  if (!alvo) return false;
  return hostDaBase(base).some((dominio) => alvo === dominio || alvo.endsWith(`.${dominio}`));
}

function nomeCombina(alvo, base) {
  const procurado = new Set(termos(alvo));
  if (!procurado.size) return false;
  return [...termos(base?.nome), ...termos(base?.empresa?.nomeFantasia)]
    .some((termo) => procurado.has(termo));
}

function lerBases(dir = DIR_BASES) {
  try {
    return readdirSync(dir)
      .filter((arquivo) => arquivo.endsWith('.json'))
      .map((arquivo) => {
        try { return JSON.parse(readFileSync(join(dir, arquivo), 'utf8')); } catch { return null; }
      })
      .filter((base) => base && base.id && Array.isArray(base.fatos));
  } catch {
    return [];
  }
}

export function selecionarBase({ cnpj = '', site = '', nome = '', nicho = '', especialidade = '', dir = DIR_BASES } = {}) {
  const alvoCnpj = digitos(cnpj);
  const alvoHost = host(site);
  const contexto = `${nome} ${nicho} ${especialidade} ${site}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const ehRango = /to-?no-?rango|cardapio|aliment|bebida|distribui|delivery|restaurante|lanchonete|acai|pizzaria|hamburgueria/.test(contexto);
  let melhor = null;
  let melhorPonto = 0;
  for (const base of lerBases(dir)) {
    let ponto = 0;
    if (alvoCnpj && digitos(base?.empresa?.cnpj) === alvoCnpj) ponto += 100;
    if (hostCombina(alvoHost, base)) ponto += 100;
    if (alvoHost && host(base?.empresa?.site) === alvoHost) ponto += 25;
    if (nome && nomeCombina(nome, base)) ponto += 40;
    if (ponto > 0 && base.id === 'to-no-rango' && ehRango) ponto += 35;
    if (ponto > 0 && base.id === 'veloso-solution' && !ehRango) ponto += 15;
    if (ponto > melhorPonto) { melhor = base; melhorPonto = ponto; }
  }
  return melhor;
}

export function validarIdentidadeBase(base, { cnpj = '', site = '', nome = '' } = {}) {
  if (!base) return { ok: false, motivo: 'base de conhecimento não encontrada' };
  const alvoCnpj = digitos(cnpj);
  const baseCnpj = digitos(base?.empresa?.cnpj);
  if (alvoCnpj && baseCnpj && alvoCnpj !== baseCnpj) {
    return {
      ok: false,
      motivo: `o CNPJ informado (${alvoCnpj}) não corresponde à empresa da base ${base.nome} (${base.empresa.nomeFantasia}, ${baseCnpj}); confirme o CNPJ antes de criar a IA`,
    };
  }
  const alvoHost = host(site);
  if (alvoHost && !hostCombina(alvoHost, base)) {
    return {
      ok: false,
      motivo: `o site informado (${alvoHost}) não corresponde à base ${base.nome} (${hostDaBase(base).join(', ')}); confirme o site antes de criar a IA`,
    };
  }
  if (nome && !nomeCombina(nome, base) && !alvoCnpj && !alvoHost) {
    return {
      ok: false,
      motivo: `o nome informado (${nome}) não corresponde à base ${base.nome}; confirme a empresa antes de criar a IA`,
    };
  }
  return { ok: true };
}

export function baseParaPesquisa(base) {
  const fontes = (base.fontes || []).map((fonte) => ({
    tipo: fonte.tipo,
    escopo: 'empresa',
    titulo: fonte.titulo,
    url: fonte.url,
    resumo: fonte.resumo,
    origem: 'base-curada',
    verificacao: 'base-curada',
  }));
  const conhecimentos = base.fatos.map((fato) => ({
    categoria: fato.categoria,
    conteudo: fato.conteudo,
    fonteUrl: fato.fonteUrl,
    origemTipo: 'base-curada',
    validado: true,
    verificacao: 'base-curada',
  }));
  return {
    empresa: { ...base.empresa, fontesDigitaisConsultadas: fontes.length },
    fontes,
    conhecimentos,
    baseConhecimento: {
      id: base.id,
      versao: base.versao,
      nome: base.nome,
      empresa: base.empresa.nomeFantasia,
      fonte: base.empresa.site,
      fontes: fontes.map((fonte) => fonte.url),
      lacunas: [...(base.lacunas || [])],
    },
    limitacoes: [...(base.lacunas || [])],
  };
}

export function basesConhecidas(dir = DIR_BASES) {
  return lerBases(dir).map((base) => ({
    id: base.id,
    versao: base.versao,
    nome: base.nome,
    cnpj: base.empresa?.cnpj || '',
    site: base.empresa?.site || '',
  }));
}
