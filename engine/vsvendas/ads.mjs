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
const hashtags = (produto, vende) => [produto, ...String(vende || '').split(/\s+/).slice(0, 3)]
  .map((w) => '#' + String(w).replace(/[^a-z0-9]/gi, '').toLowerCase()).filter((h) => h.length > 2).slice(0, 6).join(' ');
const corta = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).trim() + '…');

const CTA = { Formal: 'Entre em contato para mais informações.', Consultivo: 'Me chama que te ajudo a escolher.', Amigável: 'Chama no direct! 😄', Direto: 'Chama agora.' };

export const PLATAFORMAS = {
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

/** Gera os anúncios de UM produto pras plataformas escolhidas. */
export function buildAds(produto, profile, plataformas) {
  const alvos = (plataformas && plataformas.length ? plataformas : Object.keys(PLATAFORMAS))
    .map((k) => String(k).toLowerCase()).filter((k) => PLATAFORMAS[k]);
  if (produto.preco == null) {
    return { produto: produto.produto, faltando: 'preço', anuncios: [] };
  }
  return {
    produto: produto.produto,
    imagens: produto.imagens || [],
    anuncios: alvos.map((k) => ({ ...PLATAFORMAS[k](produto, profile), imagens: produto.imagens || [] })),
  };
}
