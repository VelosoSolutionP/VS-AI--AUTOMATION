/**
 * VSvendas — anúncios. Fluxo assistido (sem credencial de plataforma):
 * lê a pasta das fotos -> lista os produtos -> pede preço/texto -> gera o anúncio
 * pronto por plataforma, no tom da empresa. Postar automático = roadmap (adapter por
 * plataforma com a chave do cliente, igual ao tracker).
 */
import { readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const IMG = /\.(jpe?g|png|webp|gif|bmp)$/i;

const titulize = (s) => s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Lista os produtos de uma pasta de imagens. Agrupa variantes pelo nome base
 * (ex.: sofa-1.jpg, sofa-2.jpg -> produto "Sofa"). Retorna o que falta preencher.
 */
export function listProducts(dir) {
  const arquivos = readdirSync(dir).filter((f) => IMG.test(f) && statSync(join(dir, f)).isFile());
  const grupos = new Map();
  for (const f of arquivos) {
    const base = basename(f, extname(f)).replace(/[-_ ]?\d+$/,'').trim() || basename(f, extname(f));
    const key = base.toLowerCase();
    if (!grupos.has(key)) { grupos.set(key, { produto: titulize(base), imagens: [] }); }
    grupos.get(key).imagens.push(f);
  }
  return [...grupos.values()].map((p) => ({ ...p, precisa: ['preco', 'descricao (opcional)'] }));
}

/* ---- plataformas: cada uma formata do seu jeito (limites, hashtags, CTA) ---- */

const brl = (v) => (v == null ? '' : `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
const hashtags = (produto, vende) => [...new Set(
  [produto, ...String(vende || '').split(/\s+/).slice(0, 4)]
    // NFD antes de limpar: sem isso o acento era APAGADO junto com a pontuacao e a
    // hashtag saia escrita errada em publico ("governança" -> "#governana").
    .map((w) => '#' + String(w).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase())
    .filter((h) => h.length > 2),
)].slice(0, 6).join(' ');
const hashtagsCurtas = (produto, vende) => hashtags(produto, vende).split(' ').slice(0, 2).join(' ');
const corta = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).trim() + '…');

const CTA = { Formal: 'Entre em contato para mais informações.', Consultivo: 'Me chama que te ajudo a escolher.', Amigável: 'Chama no direct! 😄', Direto: 'Chama agora.' };

export const PLATAFORMAS = {
  /**
   * Feed do Facebook (post organico) — regras diferentes do Marketplace:
   * o "ver mais" corta por volta de 125 caracteres, entao a PRIMEIRA linha tem que
   * segurar sozinha; hashtag rende pouco (2 no maximo, nao 6 como no Instagram);
   * e preco nao e obrigatorio, porque post de feed vende ideia, nao classificado.
   */
  facebook: (p, prof) => {
    const gancho = corta(p.gancho || `${p.produto}: ${prof.empresa.propostaValor || ''}`.trim(), 120);
    const corpo = [
      p.descricao || prof.empresa.propostaValor,
      p.prova,
      p.preco != null && `${brl(p.preco)}`,
      (CTA[prof.empresa.tom] || CTA.Consultivo),
      p.link,
    ].filter(Boolean).join('\n\n');
    return {
      plataforma: 'Facebook (feed)',
      // join('\n\n') em vez de separador '' no array: filter(Boolean) descartava a
      // string vazia e os blocos saiam colados, sem respiro nenhum no post.
      texto: [gancho, corpo, hashtagsCurtas(p.produto, prof.empresa.vende)].filter(Boolean).join('\n\n'),
    };
  },
  instagram: (p, prof) => ({
    plataforma: 'Instagram',
    texto: [`${p.produto} ✨`, p.descricao || prof.empresa.propostaValor, brl(p.preco) && `💰 ${brl(p.preco)}`, (CTA[prof.empresa.tom] || CTA.Consultivo), hashtags(p.produto, prof.empresa.vende)].filter(Boolean).join('\n'),
  }),
  marketplace: (p, prof) => ({
    plataforma: 'Facebook Marketplace',
    titulo: corta(p.produto, 100),
    preco: brl(p.preco),
    texto: [p.descricao || prof.empresa.propostaValor, '', prof.empresa.nome].filter(Boolean).join('\n'),
  }),
  mercadolivre: (p, prof) => ({
    plataforma: 'Mercado Livre',
    titulo: corta(`${p.produto} ${String(prof.empresa.vende || '').split(/\s+/)[0] || ''}`.trim(), 60),
    preco: brl(p.preco),
    texto: [`- ${p.produto}`, p.descricao && `- ${p.descricao}`, prof.empresa.propostaValor && `- ${prof.empresa.propostaValor}`].filter(Boolean).join('\n'),
  }),
  olx: (p, prof) => ({
    plataforma: 'OLX',
    titulo: corta(p.produto, 70),
    preco: brl(p.preco),
    texto: [p.descricao || prof.empresa.propostaValor, prof.empresa.nome].filter(Boolean).join('\n'),
  }),
  whatsapp: (p, prof) => ({
    plataforma: 'WhatsApp',
    texto: [`*${p.produto}*`, p.descricao || prof.empresa.propostaValor, brl(p.preco), (CTA[prof.empresa.tom] || CTA.Consultivo)].filter(Boolean).join('\n'),
  }),
};

/**
 * Plataformas de classificado exigem preço; feed/direct (facebook, instagram, whatsapp)
 * não. Antes um post de feed sem preço era recusado junto com o resto — e post de feed
 * quase nunca leva preço.
 */
export const PRECO_OBRIGATORIO = new Set(['marketplace', 'mercadolivre', 'olx']);

/** Gera os anúncios de UM produto pras plataformas escolhidas. */
export function buildAds(produto, profile, plataformas) {
  const alvos = (plataformas && plataformas.length ? plataformas : Object.keys(PLATAFORMAS))
    .map((k) => String(k).toLowerCase()).filter((k) => PLATAFORMAS[k]);
  const semPreco = produto.preco == null;
  const bloqueadas = semPreco ? alvos.filter((k) => PRECO_OBRIGATORIO.has(k)) : [];
  const geraveis = alvos.filter((k) => !bloqueadas.includes(k));
  if (!geraveis.length) {
    return { produto: produto.produto, faltando: 'preço', anuncios: [] };
  }
  return {
    produto: produto.produto,
    imagens: produto.imagens || [],
    ...(bloqueadas.length ? { faltando: `preço (para ${bloqueadas.join(', ')})` } : {}),
    anuncios: geraveis.map((k) => ({ ...PLATAFORMAS[k](produto, profile), imagens: produto.imagens || [] })),
  };
}
