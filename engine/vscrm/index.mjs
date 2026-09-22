/**
 * VScrm — orquestrador. Junta store + leads e resolve o FUNIL.
 *
 * Ordem do funil: config própria do CRM (~/.qa-gate/vscrm/config.json) -> entrevista
 * (set "vendas"). Nessa máquina a entrevista ainda não rodou, então o CRM aceita o
 * funil direto — mas ele continua EXPLÍCITO: sem etapas cadastradas o painel diz o
 * que falta em vez de inventar um funil genérico.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { load, save } from './store.mjs';
import {
  novoLead, moverEtapa, fechar, aplicarQualificacao, registrarInteracao,
  upsert, resumoFunil,
} from './leads.mjs';
import { normalizarTelefone } from './leads.mjs';
import { normalizarRegra, novoParceiro, resumoParceiros, linkDe, comissao } from './parceiros.mjs';

import { dentroDaCasa } from '../casa.mjs';
/** Etapas do funil, com a origem (pra tela poder dizer de onde veio). */
export function getFunil() {
  const cfg = load('config', null);
  if (cfg?.funil?.length) { return { funil: cfg.funil, origem: 'config do CRM' }; }
  try {
    // Lê o arquivo da entrevista direto: `require` não funciona em ESM e um import()
    // deixaria getFunil() assíncrona só por causa do fallback.
    const perfis = JSON.parse(readFileSync(dentroDaCasa('vs-profiles.json'), 'utf8'));
    const v = perfis?.vendas;
    if (v?.funil?.length) { return { funil: v.funil, origem: 'entrevista' }; }
  } catch {}
  return { funil: [], origem: null };
}

/** Define o funil do CRM (lista ordenada de etapas). */
export function setFunil(etapas) {
  const funil = (etapas || []).map((e) => String(e).trim()).filter(Boolean);
  if (!funil.length) { return { erro: 'informe ao menos uma etapa' }; }
  const cfg = load('config', {}) || {};
  save('config', { ...cfg, funil });
  return { funil };
}

export function listar() {
  return load('leads', []) || [];
}

function gravar(leads) {
  save('leads', leads);
  return leads;
}

export function criar(dados) {
  const { funil } = getFunil();
  const r = novoLead(dados, funil);
  if (r.erro) { return r; }
  const leads = listar();
  if (leads.some((l) => l.id === r.lead.id)) { return { erro: 'ja existe lead com esse telefone' }; }
  gravar(upsert(leads, r.lead));
  return { lead: r.lead };
}

function comLead(id, fn) {
  const leads = listar();
  const lead = leads.find((l) => l.id === id);
  if (!lead) { return { erro: 'lead nao encontrado: ' + id }; }
  const r = fn(lead);
  if (r.erro) { return r; }
  gravar(upsert(leads, r.lead));
  return { lead: r.lead };
}

export function mover(id, etapa) {
  const { funil } = getFunil();
  return comLead(id, (lead) => moverEtapa(lead, etapa, funil));
}

export function encerrar(id, status, motivo) {
  return comLead(id, (lead) => fechar(lead, status, motivo));
}

export function qualificar(id, q) {
  return comLead(id, (lead) => ({ lead: aplicarQualificacao(lead, q) }));
}

export function interagir(id, interacao) {
  return comLead(id, (lead) => ({ lead: registrarInteracao(lead, interacao) }));
}

/** Tudo que o painel precisa numa chamada só. */
export function painel() {
  const { funil, origem } = getFunil();
  const leads = listar();
  return { funil, funilOrigem: origem, leads, resumo: resumoFunil(leads, funil) };
}

/**
 * Estado REAL de cada integração, pro painel parar de fingir que está tudo certo.
 * Só booleano e nome de provider — token e apikey nunca saem daqui.
 */
export function statusIntegracoes() {
  const env = process.env;
  let notify = { enabled: false, phone: false, apikey: false };
  try {
    const cfg = JSON.parse(readFileSync(dentroDaCasa('company.json'), 'utf8'));
    const wa = cfg?.notify?.whatsapp || {};
    notify = { enabled: !!wa.enabled, phone: !!(wa.phone && wa.phone !== 'xxx'), apikey: !!(wa.apikey && wa.apikey !== 'xxx') };
  } catch {}
  const { funil, origem } = getFunil();
  const leads = listar();
  return {
    whatsapp: {
      provider: env.WHATSAPP_PROVIDER || 'log',
      waToken: !!env.WA_TOKEN,
      waPhoneId: !!env.WA_PHONE_ID,
      template: !!env.WA_TEMPLATE,
      // 'log' não envia nada: só imprime o link wa.me no console.
      envia: (env.WHATSAPP_PROVIDER || 'log') === 'cloud' && !!env.WA_TOKEN && !!env.WA_PHONE_ID,
    },
    notify,
    crm: { funil: funil.length, funilOrigem: origem, leads: leads.length },
    /* O webhook de entrada passou a existir (POST /webhook/whatsapp). Ele so
       funciona com WA_VERIFY_TOKEN no ambiente — e a Meta so registra a URL
       depois de conferir esse token. Sem WA_APP_SECRET a rota atende, mas sem
       conferir assinatura: a tela precisa dizer isso, nao mostrar "pronto". */
    bot: {
      webhook: !!env.WA_VERIFY_TOKEN,
      assinado: !!env.WA_APP_SECRET,
      motivo: env.WA_VERIFY_TOKEN
        ? (env.WA_APP_SECRET ? null : 'sem WA_APP_SECRET: a rota nao confere a assinatura da Meta')
        : 'falta WA_VERIFY_TOKEN no ambiente — a Meta nao consegue registrar a URL',
    },
  };
}

/* ---------------- indicação e parceiros ---------------- */

/** Regra de comissão gravada (ou null — o painel mostra "não definida"). */
export function getRegraIndicacao() {
  return load('indicacao', null);
}

export function setRegraIndicacao(dados) {
  const r = normalizarRegra(dados);
  if (r.erro) { return r; }
  save('indicacao', r.regra);
  return { regra: r.regra };
}

export function listarParceiros() {
  return load('parceiros', []) || [];
}

export function criarParceiro(dados) {
  const atuais = listarParceiros();
  const r = novoParceiro(dados, atuais, normalizarTelefone);
  if (r.erro) { return r; }
  save('parceiros', [...atuais, r.parceiro]);
  return { parceiro: r.parceiro };
}

export function removerParceiro(id) {
  const atuais = listarParceiros();
  if (!atuais.some((p) => p.id === id)) { return { erro: 'parceiro nao encontrado' }; }
  save('parceiros', atuais.filter((p) => p.id !== id));
  return { ok: true };
}

/** Tudo da tela de indicação numa chamada. */
export function painelIndicacao() {
  const regra = getRegraIndicacao();
  const parceiros = listarParceiros().map((p) => ({ ...p, ...linkDe(p, regra) }));
  // Exemplo de quanto sai numa venda de R$ 1.000 — ajuda a conferir a regra antes de valer.
  const exemplo = comissao(1000, regra, 1);
  return { regra, parceiros, resumo: resumoParceiros(parceiros), exemplo };
}
