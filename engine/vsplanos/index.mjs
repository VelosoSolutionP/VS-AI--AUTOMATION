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
  { code: 'redes-ouro', nome: 'Gold', module: 'redes', monthly_price: R$(149),
    social_accounts: 4, products_limit: 2000, campaigns_limit: 40, storage_limit_mb: 15360,
    attendants: null, ai_enabled: true, auditor_enabled: true },

  // ---- Módulo B: WhatsApp ----
  { code: 'whats-bronze', nome: 'Bronze', module: 'whatsapp', monthly_price: R$(79),
    attendants: 1, products_limit: 100, campaigns_limit: 3, storage_limit_mb: 1024,
    social_accounts: null, ai_enabled: true, auditor_enabled: false },
  { code: 'whats-prata', nome: 'Prata', module: 'whatsapp', monthly_price: R$(129), destaque: true,
    attendants: 3, products_limit: 500, campaigns_limit: 10, storage_limit_mb: 5120,
    social_accounts: null, ai_enabled: true, auditor_enabled: true },
  { code: 'whats-ouro', nome: 'Gold', module: 'whatsapp', monthly_price: R$(199),
    attendants: 6, products_limit: 2000, campaigns_limit: 25, storage_limit_mb: 15360,
    social_accounts: null, ai_enabled: true, auditor_enabled: true },

  // ---- Módulo C: Telegram (pedido do dono, 2026-09-27; números de partida = WhatsApp) ----
  { code: 'telegram-bronze', nome: 'Bronze', module: 'telegram', monthly_price: R$(79),
    attendants: 1, products_limit: 100, campaigns_limit: 3, storage_limit_mb: 1024,
    social_accounts: null, ai_enabled: true, auditor_enabled: false },
  { code: 'telegram-prata', nome: 'Prata', module: 'telegram', monthly_price: R$(129), destaque: true,
    attendants: 3, products_limit: 500, campaigns_limit: 10, storage_limit_mb: 5120,
    social_accounts: null, ai_enabled: true, auditor_enabled: true },
  { code: 'telegram-ouro', nome: 'Gold', module: 'telegram', monthly_price: R$(199),
    attendants: 6, products_limit: 2000, campaigns_limit: 25, storage_limit_mb: 15360,
    social_accounts: null, ai_enabled: true, auditor_enabled: true },

  // ---- Combo A+B ----
  { code: 'combo-bronze', nome: 'Bronze', module: 'combo', monthly_price: R$(119),
    social_accounts: 2, attendants: 1, products_limit: 100, campaigns_limit: 8, storage_limit_mb: 1024,
    ai_enabled: true, auditor_enabled: false },
  { code: 'combo-prata', nome: 'Prata', module: 'combo', monthly_price: R$(189), destaque: true,
    social_accounts: 2, attendants: 3, products_limit: 500, campaigns_limit: 25, storage_limit_mb: 5120,
    ai_enabled: true, auditor_enabled: true },
  { code: 'combo-ouro', nome: 'Gold', module: 'combo', monthly_price: R$(299),
    social_accounts: 4, attendants: 6, products_limit: 2000, campaigns_limit: 65, storage_limit_mb: 15360,
    ai_enabled: true, auditor_enabled: true },
];

/** Adicionais vendidos à parte. */
export const SEMENTE_ADICIONAIS = [
  { code: 'atendente-extra', name: 'Atendente adicional', monthly_price: R$(19.90), usage_price: null, active: true },
  /* Banda adicional: oferecida quando a banda do mês acaba (modo consulta).
     Sem preço definido pelo dono ainda → sob consulta (vai pro WhatsApp). */
  { code: 'banda-extra', name: 'Banda adicional (+10 GB/mês)', gb: 10, monthly_price: null, usage_price: null, sob_consulta: true, active: true },
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

/* Catálogo gravado antes de um módulo novo existir (Telegram): o que falta da
   semente entra, sem mexer em preço nem versão do que já está lá. */
function carregar() {
  const todos = load('planos') || semear();
  const faltam = SEMENTE.filter((sm) => !todos.some((p) => p.code === sm.code || String(p.code).startsWith(`${sm.code}-v`)));
  if (faltam.length) {
    for (const sm of faltam) { const v = validarPlano(sm); if (!v.erros.length) { todos.push(v.plano); } }
    save('planos', todos);
  }
  return todos;
}

export function listar({ incluirInativos = false } = {}) {
  const todos = carregar();
  return incluirInativos ? todos : todos.filter((p) => p.active !== false);
}

export function adicionais() {
  const lista = load('adicionais', null) || (semear() && load('adicionais', []));
  // Catálogo gravado antes do adendo de banda existir: entra sem mexer no resto.
  if (!lista.some((x) => x.code === 'banda-extra')) {
    lista.push(SEMENTE_ADICIONAIS.find((x) => x.code === 'banda-extra'));
    save('adicionais', lista);
  }
  return lista;
}

export const buscar = (code) => carregar().find((p) => p.code === String(code || '').toLowerCase()) || null;

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
  const todos = carregar();
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
  if (i >= 0) { todos[i] = { ...todos[i], ...v.plano, criadoEm: todos[i].criadoEm || v.plano.criadoEm }; } else { todos.push(v.plano); }
  // Um "mais escolhido" por módulo.
  if (v.plano.destaque) { for (const p of todos) { if (p.module === v.plano.module && p.code !== v.plano.code && p.active !== false) { p.destaque = false; } } }
  save('planos', todos);
  return { ok: true, plano: v.plano };
}

/**
 * O que a tela de Preços chama. Preço de plano que ALGUÉM JÁ ASSINA não muda
 * por baixo do contrato: vira versão nova (quem assinou fica no preço antigo,
 * a venda nova sai pelo novo). Sem assinante, edita no lugar.
 */
export function atualizarPlano(code, mudancas = {}, { por, outrosAssinantes = 0 } = {}) {
  const atual = buscar(code);
  if (!atual) { return { ok: false, erros: [`plano "${code}" não existe`] }; }
  const novo = { ...atual, ...mudancas, code: atual.code, module: atual.module };
  const mudouPreco = Number(novo.monthly_price) !== atual.monthly_price;
  // `outrosAssinantes`: clientes da carteira (engine/vsclientes) com contrato neste plano.
  if (mudouPreco && assinaturasDoPlano(atual.code) + (Number(outrosAssinantes) || 0) > 0) {
    const base = atual.code.replace(/-v\d+$/, '');
    const usados = carregar().map((p) => p.code);
    let n = 2; while (usados.includes(`${base}-v${n}`)) { n++; }
    const todos = carregar();
    const r = novaVersao({ ...atual, code: base }, { ...mudancas, destaque: novo.destaque }, `v${n}`);
    if (r.erros.length) { return { ok: false, erros: r.erros }; }
    r.novo.substitui = atual.code;
    const lista = todos.map((p) => (p.code === atual.code ? { ...p, active: false, destaque: false } : p));
    lista.push({ ...r.novo, alteradoPor: por || null });
    save('planos', lista);
    return { ok: true, versionado: true, plano: r.novo, anterior: atual.code };
  }
  return salvarPlano({ ...novo, alteradoPor: por || null });
}

/** Preço de adendo (atendente extra, banda extra). Vazio = sob consulta. */
export function salvarAdicional(code, { monthly_price, gb, active } = {}) {
  const lista = adicionais();
  const a = lista.find((x) => x.code === code);
  if (!a) { return { ok: false, erros: [`adendo "${code}" não existe`] }; }
  const preco = monthly_price === '' || monthly_price == null ? null : Number(monthly_price);
  if (preco != null && (!Number.isInteger(preco) || preco < 0)) { return { ok: false, erros: ['preço em centavos, número inteiro ≥ 0 (ou vazio para sob consulta)'] }; }
  if (gb != null && gb !== '' && (!Number.isFinite(Number(gb)) || Number(gb) <= 0)) { return { ok: false, erros: ['GB do adendo precisa ser maior que zero'] }; }
  a.monthly_price = preco;
  a.sob_consulta = preco == null;
  if (gb != null && gb !== '') { a.gb = Number(gb); a.name = `Banda adicional (+${Number(gb)} GB/mês)`; }
  if (active != null) { a.active = active !== false; }
  save('adicionais', lista);
  return { ok: true, adicional: a };
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

/**
 * Banda do mês desta instalação: a do plano (storage_limit_mb, que o contrato
 * chama de "banda total de consumo mensal") + a banda adicional liberada.
 * Sem plano = sem limite (erro nosso não trava quem paga — ver cabeMais).
 */
export function bandaDoMes() {
  const a = assinatura();
  const mb = a.limites?.storageMb;
  const planoGb = mb == null ? null : Math.round((mb / 1024) * 10) / 10;
  const extraGb = (a.bandaExtra || []).filter((x) => x.ativa !== false).reduce((s, x) => s + (Number(x.gb) || 0), 0);
  return { planoGb, extraGb, totalGb: planoGb == null ? null : planoGb + extraGb, plano: a.detalhe?.nome ? `${({ whatsapp: 'WhatsApp', redes: 'Redes sociais', combo: 'Combo' })[a.detalhe.module] || a.detalhe.module} ${a.detalhe.nome}` : null, historico: a.bandaExtra || [] };
}

/** Libera banda adicional (adendo contratado ou decisão do dono). Fica no histórico. */
export function adicionarBanda({ gb, motivo, por } = {}) {
  const n = Number(gb);
  if (!Number.isFinite(n) || n <= 0 || n > 10000) { return { ok: false, erro: 'diga quantos GB liberar (número maior que zero)' }; }
  if (!String(motivo || '').trim()) { return { ok: false, erro: 'diga o motivo (ex.: adendo de banda pago, cortesia)' }; }
  const todas = assinaturas();
  if (!todas.local) { return { ok: false, erro: 'esta instalação não tem plano — sem plano não há limite de banda' }; }
  const item = { id: `b${Date.now().toString(36)}`, gb: n, motivo: String(motivo).trim().slice(0, 200), por: por || null, em: new Date().toISOString(), ativa: true };
  todas.local.bandaExtra = [...(todas.local.bandaExtra || []), item];
  save('assinaturas', todas);
  return { ok: true, item, banda: bandaDoMes() };
}

/** Tira uma banda adicional (adendo cancelado). O registro fica, marcado inativo. */
export function removerBanda(id, { por } = {}) {
  const todas = assinaturas();
  const it = (todas.local?.bandaExtra || []).find((x) => x.id === id && x.ativa !== false);
  if (!it) { return { ok: false, erro: 'banda adicional não encontrada' }; }
  it.ativa = false; it.removidaEm = new Date().toISOString(); it.removidaPor = por || null;
  save('assinaturas', todas);
  return { ok: true, banda: bandaDoMes() };
}

/** Só pra teste: grava a lista de planos como está. */
export function _gravar(lista) { save('planos', lista); }

/** Só pra teste: devolve o catálogo ao estado de fábrica. */
export function _resemear() { return semear(); }
