/**
 * VSvendas — orquestrador. Carrega o perfil da entrevista (empresa + vendas) e
 * expõe qualificar / follow-up / objeção. Sem perfil, aponta o que falta entrevistar.
 */
import { loadProfile } from '../interview/index.mjs';
import { mapProfile, profileReady } from './profile.mjs';
import { qualifyLead } from './qualify.mjs';
import { draftFollowup } from './followup.mjs';
import { handleObjection } from './objection.mjs';

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

export { mapProfile, profileReady };
