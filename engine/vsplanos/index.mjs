/**
 * VSplanos — o catálogo comercial, gravado como DADO.
 *
 * Preço e limite vivem em disco, não em `if` espalhado pelo código. Trocar a
 * tabela é editar dado; criar Bronze V2 é gravar outro registro. O código só
 * lê — e é isso que permite mexer em preço sem mexer em sistema.
 *
 * A tabela de LANÇAMENTO entra como semente na primeira leitura. Ela não é
 * verdade eterna: é ponto de partida declarado, pra trocar quando os 30 dias de
 * operação mostrarem o custo real por cliente.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { validarPlano, novaVersao, precoDoCiclo, limitesDe, cabeMais, uso, MODULOS, CICLOS } from './catalogo.mjs';

import { dentroDaCasa } from '../casa.mjs';
export { precoDoCiclo, limitesDe, cabeMais, uso, MODULOS, CICLOS };

const dir = () => process.env.VSPLANOS_DIR || dentroDaCasa('vsplanos');
const arq = (n) => join(dir(), `${n}.json`);
const load = (n, p = null) => { try { return JSON.parse(readFileSync(arq(n), 'utf8')); } catch { return p; } };
const save = (n, d) => { mkdirSync(dir(), { recursive: true, mode: 0o700 }); writeFileSync(arq(n), JSON.stringify(d, null, 2)); };

const R$ = (reais) => Math.round(reais * 100); // preço em centavos, sempre

/** Tabela de lançamento. Semente — não é para ser lida como verdade eterna. */
export const SEMENTE = [
  // ---- Módulo A: Redes Sociais ----
  { code: 'redes-bronze', nome: 'Bronze', module: 'redes', monthly_price: R$(59),
    social_accounts: 2, products_limit: 100, campaigns_limit: 5, storage_limit_mb: 1024,
    attendants: null, ai_enabled: true, auditor_enabled: false },
  { code: 'redes-prata', nome: 'Prata', module: 'redes', monthly_price: R$(99), destaque: true,
    social_accounts: 2, products_limit: 500, campaigns_limit: 15, storage_limit_mb: 5120,
    attendants: null, ai_enabled: true, auditor_enabled: true },
  { code: 'redes-ouro', nome: 'Ouro', module: 'redes', monthly_price: R$(149),
    social_accounts: 4, products_limit: 2000, campaigns_limit: 40, storage_limit_mb: 15360,
    attendants: null, ai_enabled: true, auditor_enabled: true },

  // ---- Módulo B: WhatsApp ----
  { code: 'whats-bronze', nome: 'Bronze', module: 'whatsapp', monthly_price: R$(79),
    attendants: 1, products_limit: 100, campaigns_limit: 3, storage_limit_mb: 1024,
    social_accounts: null, ai_enabled: true, auditor_enabled: false },
  { code: 'whats-prata', nome: 'Prata', module: 'whatsapp', monthly_price: R$(129), destaque: true,
    attendants: 3, products_limit: 500, campaigns_limit: 10, storage_limit_mb: 5120,
    social_accounts: null, ai_enabled: true, auditor_enabled: true },
  { code: 'whats-ouro', nome: 'Ouro', module: 'whatsapp', monthly_price: R$(199),
    attendants: 6, products_limit: 2000, campaigns_limit: 25, storage_limit_mb: 15360,
    social_accounts: null, ai_enabled: true, auditor_enabled: true },

  // ---- Combo A+B ----
  { code: 'combo-bronze', nome: 'Bronze', module: 'combo', monthly_price: R$(119),
    social_accounts: 2, attendants: 1, products_limit: 100, campaigns_limit: 8, storage_limit_mb: 1024,
    ai_enabled: true, auditor_enabled: false },
  { code: 'combo-prata', nome: 'Prata', module: 'combo', monthly_price: R$(189), destaque: true,
    social_accounts: 2, attendants: 3, products_limit: 500, campaigns_limit: 25, storage_limit_mb: 5120,
    ai_enabled: true, auditor_enabled: true },
  { code: 'combo-ouro', nome: 'Ouro', module: 'combo', monthly_price: R$(299),
    social_accounts: 4, attendants: 6, products_limit: 2000, campaigns_limit: 65, storage_limit_mb: 15360,
    ai_enabled: true, auditor_enabled: true },
];

/** Adicionais vendidos à parte. */
export const SEMENTE_ADICIONAIS = [
  { code: 'atendente-extra', name: 'Atendente adicional', monthly_price: R$(19.90), usage_price: null, active: true },
  /* Marketplace NÃO entra com preço: o custo de API/provider muda, e prometer
     hoje um número que muda amanhã é prometer errado. */
  { code: 'canal-marketplace', name: 'Canais adicionais (iFood, 99, Zé Delivery, Mercado Livre, Shopee, X)',
    monthly_price: null, usage_price: null, sob_consulta: true, active: true },
];

function semear() {
  const validos = [];
  for (const p of SEMENTE) {
    const v = validarPlano(p);
    if (v.erros.length) { throw new Error(`semente inválida (${p.code}): ${v.erros.join('; ')}`); }
    validos.push(v.plano);
  }
  save('planos', validos);
  save('adicionais', SEMENTE_ADICIONAIS);
  return validos;
}

export function listar({ incluirInativos = false } = {}) {
  const todos = load('planos') || semear();
  return incluirInativos ? todos : todos.filter((p) => p.active !== false);
}

export const adicionais = () => load('adicionais', null) || (semear() && load('adicionais', []));

export const buscar = (code) => (load('planos') || semear()).find((p) => p.code === String(code || '').toLowerCase()) || null;

/** Tabela pronta pra tela: por módulo, na ordem de preço. */
export function tabela() {
  const planos = listar();
  const porModulo = {};
  for (const m of Object.values(MODULOS)) {
    porModulo[m] = planos.filter((p) => p.module === m).sort((a, b) => a.monthly_price - b.monthly_price);
  }
  return { modulos: porModulo, adicionais: adicionais(), ciclos: CICLOS };
}

export function salvarPlano(entrada) {
  const v = validarPlano(entrada);
  if (v.erros.length) { return { ok: false, erros: v.erros }; }
  const todos = load('planos') || semear();
  const i = todos.findIndex((p) => p.code === v.plano.code);

  /* Plano JÁ CONTRATADO não muda de preço por edição: cria-se outra versão.
     Deixar editar seria mudar contrato assinado por dentro do sistema. */
  if (i >= 0 && assinaturasDoPlano(v.plano.code) > 0 && todos[i].monthly_price !== v.plano.monthly_price) {
    return {
      ok: false,
      erros: [`o plano "${v.plano.code}" já tem contrato ativo — mudar o preço dele mudaria contrato assinado. Crie uma nova versão.`],
      sugestao: 'novaVersao',
    };
  }
  if (i >= 0) { todos[i] = { ...todos[i], ...v.plano }; } else { todos.push(v.plano); }
  save('planos', todos);
  return { ok: true, plano: v.plano };
}

/** Cria a versão nova e tira a antiga de venda, numa operação só. */
export function versionarPlano(code, mudancas = {}, sufixo = 'v2') {
  const antigo = buscar(code);
  if (!antigo) { return { ok: false, erros: [`plano "${code}" não existe`] }; }
  const r = novaVersao(antigo, mudancas, sufixo);
  if (r.erros.length) { return { ok: false, erros: r.erros }; }
  const todos = (load('planos') || []).map((p) => (p.code === code ? r.antigo : p));
  todos.push(r.novo);
  save('planos', todos);
  return { ok: true, novo: r.novo, antigoDesativado: r.antigo.code };
}

/* ---------------- quem assinou o quê ---------------- */

const assinaturas = () => load('assinaturas', {}) || {};
const assinaturasDoPlano = (code) => Object.values(assinaturas()).filter((a) => a.plano === code && a.ativa !== false).length;

/** A assinatura desta instalação. Uma por instalação — multi-tenant é outra história. */
export function assinatura() {
  const a = assinaturas().local || null;
  if (!a) { return { plano: null, ciclo: 'mensal', limites: limitesDe(null), semPlano: true }; }
  const p = buscar(a.plano);
  return {
    ...a,
    detalhe: p,
    limites: limitesDe(p),
    preco: p ? precoDoCiclo(p, a.ciclo) : null,
    /* Assinatura apontando pra plano que sumiu não pode virar "sem limite":
       avisa, mantém o contrato e deixa a decisão com gente. */
    orfa: !!a.plano && !p,
  };
}

export function assinar({ plano, ciclo = 'mensal', atendentesExtras = 0 } = {}) {
  const p = buscar(plano);
  if (!p) { return { ok: false, erros: [`plano "${plano}" não existe`] }; }
  if (p.active === false) { return { ok: false, erros: [`o plano "${plano}" não está mais à venda`] }; }
  if (!CICLOS[ciclo]) { return { ok: false, erros: [`ciclo "${ciclo}" não existe`] }; }
  const todas = assinaturas();
  todas.local = {
    plano: p.code, ciclo, atendentesExtras: Number(atendentesExtras) || 0,
    ativa: true, desde: todas.local?.desde || new Date().toISOString(), atualizadoEm: new Date().toISOString(),
  };
  save('assinaturas', todas);
  return { ok: true, assinatura: assinatura() };
}

/** Limite efetivo: o do plano mais o que foi comprado como adicional. */
export function limiteDeAtendentes() {
  const a = assinatura();
  const base = a.limites?.atendentes;
  if (base == null) { return null; }
  return base + (a.atendentesExtras || 0);
}

/** Só pra teste: devolve o catálogo ao estado de fábrica. */
export function _resemear() { return semear(); }
