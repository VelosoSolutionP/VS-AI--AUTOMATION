/**
 * Quais IA-ZEST podem atender o WhatsApp do salão (Cadê Você).
 *
 * Regra do dono: só IA PRÓPRIA e HOMOLOGADA destes 7 nichos — cabelo, barbearia,
 * bronzeamento, manicure, pedicure, sobrancelhas e unhas de gel. IA de outro
 * nicho não entra, mesmo homologada. "Própria" = está no Hotel desta empresa e
 * não foi derivada de uma deusa. Quem marca na agenda é o próprio bot do salão
 * (Cadê Você): a IA entra com persona e conhecimento, então a profissão que o
 * Hotel atribuiu (agenda ou atendente) não decide — decidem os serviços.
 *
 * Só LÊ o Hotel. A mesma regra vale na tela, na rota que conecta e na hora de
 * responder (hub), para uma IA alterada depois não continuar atendendo.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as hotel from '../vs0007/bots.mjs';
import { criarCadevcClient } from './cadevc.mjs';
import { dentroDaCasa } from '../casa.mjs';

export const SERVICOS_SALAO = Object.freeze([
  { id: 'cabelo', nome: 'Cabelo / Cabeleireiro', padrao: /cabel(o|os|eir)|hair ?stylist/ },
  { id: 'barbearia', nome: 'Barbearia / Barba', padrao: /barbe(ar|ir)|\bbarba\b/ },
  { id: 'bronzeamento', nome: 'Bronzeamento', padrao: /bronze/ },
  { id: 'manicure', nome: 'Manicure', padrao: /manicur/ },
  { id: 'pedicure', nome: 'Pedicure', padrao: /pedicur/ },
  { id: 'sobrancelhas', nome: 'Sobrancelhas', padrao: /sobrancelh|design de sobrancelh|micropigmenta/ },
  { id: 'unhas-de-gel', nome: 'Unhas de gel', padrao: /\bunhas?\b|esmalter|\bnail/ },
]);

const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Avalia uma IA do Hotel. Devolve { ok, servicos, motivo }. */
export function avaliarIA(bot) {
  if (!bot) return { ok: false, servicos: [], motivo: 'IA-ZEST não encontrada no Hotel desta empresa' };
  const texto = normalizar([
    bot.nome, bot.especialidade, bot.finalidade, bot.preparacao?.nicho,
    bot.perfil?.funcao, bot.perfil?.objetivoPrincipal,
  ].join(' '));
  const servicos = SERVICOS_SALAO.filter((s) => s.padrao.test(texto)).map((s) => s.id);
  const base = { servicos };
  if (bot.derivadoDe?.deusaId) return { ...base, ok: false, motivo: 'IA derivada de deusa não é própria do salão' };
  if (bot.estado !== 'homologado') return { ...base, ok: false, motivo: `IA ainda não homologada (${bot.estado})` };
  if (!servicos.length) return { ...base, ok: false, motivo: 'IA de outro nicho: só entram cabelo, barbearia, bronzeamento, manicure, pedicure, sobrancelhas e unhas de gel' };
  return { ...base, ok: true, motivo: null };
}

/** O nicho digitado é um dos 7, ou nome parecido? Então a IA precisa dos dados do Cadê Você. */
export const PADRAO_SALAO_GERAL = /\bsalao\b(?! de (festa|jogo|evento))|\bbeleza\b/;
export function exigeDadosSalao(texto) {
  const t = normalizar(texto);
  return PADRAO_SALAO_GERAL.test(t) || SERVICOS_SALAO.some((s) => s.padrao.test(t));
}

/* Credenciais do Cadê Você de cada IA: arquivo próprio, nunca no registro da IA,
   que o Hotel devolve inteiro para a tela. */
const arqDados = () => join(dentroDaCasa('vscadevc'), 'ias.json');
const lerDados = () => { try { return JSON.parse(readFileSync(arqDados(), 'utf8')); } catch { return {}; } };
function gravarDados(d) { mkdirSync(dentroDaCasa('vscadevc'), { recursive: true, mode: 0o700 }); writeFileSync(arqDados(), JSON.stringify(d, null, 2), { mode: 0o600 }); }
export const dadosSistema = (agenteId) => lerDados()[agenteId] || null;
export function salvarDadosSistema(agenteId, { url, token, salao = null }) {
  gravarDados({ ...lerDados(), [agenteId]: { url: String(url).trim().replace(/\/$/, ''), token: String(token).trim(), salao, validadoEm: new Date().toISOString() } });
}
export function apagarDadosSistema(agenteId) { const d = lerDados(); if (d[agenteId]) { delete d[agenteId]; gravarDados(d); } }

/** Bate e volta: só passa se o Cadê Você responder com esses dados. */
export async function validarDadosSistema({ url, token, fetchImpl } = {}) {
  const u = String(url || '').trim(); const t = String(token || '').trim();
  if (!u || !t) return { erro: 'IA de salão precisa da URL da API e do token do Cadê Você' };
  if (!/^https?:\/\//i.test(u)) return { erro: 'a URL da API do Cadê Você precisa começar com http:// ou https://' };
  try {
    const sal = await criarCadevcClient({ baseUrl: u, token: t, ...(fetchImpl ? { fetchImpl } : {}) }).cadevc();
    return { ok: true, salao: sal?.cadevc?.nome || null };
  } catch (e) { return { erro: `o Cadê Você não confirmou esses dados: ${e.message}` }; }
}

/** Regra completa de uso: a IA é do salão E tem os dados validados do Cadê Você. */
export function avaliarParaUso(bot) {
  const a = avaliarIA(bot);
  if (a.ok && !dadosSistema(bot.agenteId)) return { ...a, ok: false, motivo: 'IA sem os dados do Cadê Você: crie a IA de novo no Hotel informando URL e token' };
  return a;
}

/** Todas as IAs do Hotel desta empresa, com o veredito para o salão. */
export function listarParaSalao() {
  return hotel.listarBots().map((b) => {
    const a = avaliarParaUso(b);
    return { agenteId: b.agenteId, nome: b.nome, especialidade: b.especialidade, funcao: b.perfil?.funcao || '', foto: b.perfil?.foto || '', estado: b.estado, elegivel: a.ok, motivo: a.motivo, servicos: a.servicos };
  });
}
