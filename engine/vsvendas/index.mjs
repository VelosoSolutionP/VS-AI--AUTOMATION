/**
 * VSvendas — orquestrador. Carrega o perfil da entrevista (empresa + vendas) e
 * expõe qualificar / follow-up / objeção. Sem perfil, aponta o que falta entrevistar.
 */
import { loadProfile } from '../interview/index.mjs';
import { mapProfile, profileReady } from './profile.mjs';
import { qualifyLead } from './qualify.mjs';
import { draftFollowup } from './followup.mjs';
import { handleObjection } from './objection.mjs';
import { listProducts, buildAds } from './ads.mjs';

/** Monta o perfil a partir dos perfis salvos pela entrevista. */
export function getProfile() {
  return mapProfile(loadProfile('empresa'), loadProfile('vendas'));
}

function ensure(profile) {
  const r = profileReady(profile);
  if (!r.ready) {
    const e = new Error('VSvendas sem perfil. Rode a entrevista antes. Falta: ' + r.faltando.join('; '));
    e.needInterview = true;
    throw e;
  }
}

export function qualificar(leadTexto, profile = getProfile()) {
  ensure(profile);
  return { ...qualifyLead(leadTexto, profile), empresa: profile.empresa.nome };
}

export function followup(ctx, profile = getProfile()) {
  ensure(profile);
  return draftFollowup(profile, ctx);
}

export function objecao(fala, profile = getProfile()) {
  ensure(profile);
  return handleObjection(fala, profile);
}

/** Lista os produtos de uma pasta de fotos (não exige perfil). */
export function listarProdutos(dir) {
  return listProducts(dir);
}

/** Gera os anúncios de um produto (exige perfil — usa tom/proposta e, por padrão,
 *  as plataformas que a empresa cadastrou na entrevista de marketing). */
export function anunciar(produto, plataformas, profile = getProfile()) {
  ensure(profile);
  const alvos = (plataformas && plataformas.length) ? plataformas : (profile.marketing?.plataformas || []);
  return buildAds(produto, profile, alvos.map(mapPlataforma));
}

/** Nome amigável da plataforma (entrevista) -> chave do formatter. */
function mapPlataforma(p) {
  const s = String(p).toLowerCase();
  if (s.includes('marketplace') || s.includes('facebook')) { return 'marketplace'; }
  if (s.includes('mercado')) { return 'mercadolivre'; }
  if (s.includes('insta')) { return 'instagram'; }
  if (s.includes('whats')) { return 'whatsapp'; }
  if (s.includes('olx')) { return 'olx'; }
  return s;
}

export { mapProfile, profileReady };
