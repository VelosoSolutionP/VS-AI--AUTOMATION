/**
 * VSbot — orquestrador. Guarda as regras e a persona, e responde.
 *
 * O canal (WhatsApp, Instagram, site) é de fora: aqui entra texto e sai texto.
 * É o que permite o bot funcionar HOJE, testado, antes de qualquer token da Meta.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { responder, conversar, validarRegra, escolher, GATILHOS } from './regras.mjs';

const dir = () => process.env.VSBOT_DIR || join(homedir(), '.qa-gate', 'vsbot');
const arq = (n) => join(dir(), `${n}.json`);
const load = (n, p = null) => { try { return JSON.parse(readFileSync(arq(n), 'utf8')); } catch { return p; } };
const save = (n, d) => { mkdirSync(dir(), { recursive: true, mode: 0o700 }); writeFileSync(arq(n), JSON.stringify(d, null, 2), { mode: 0o600 }); };

export { responder, conversar, GATILHOS };

const PADRAO = {
  nome: 'Atendente',
  persona: 'Atende de forma direta e educada, sem prometer o que a loja não faz.',
  saudacao: 'Oi! Sou o atendimento automático. Como posso ajudar?',
  mensagemFallback: 'Não entendi. Quer falar com uma pessoa do time?',
  mensagemHandoff: 'Já chamo uma pessoa do time pra te atender. Um instante.',
  mensagemCatalogo: 'Olha o que temos disponível:',
  usarCatalogo: true,
  limiteCatalogo: 5,
  falhasAteHumano: 2,
  ativo: false,
};

export const getConfig = () => ({ ...PADRAO, ...(load('config', {}) || {}) });

export function salvarConfig(mudancas = {}) {
  const novo = { ...getConfig(), ...mudancas };
  if (novo.falhasAteHumano != null && (!Number.isInteger(Number(novo.falhasAteHumano)) || Number(novo.falhasAteHumano) < 1)) {
    return { ok: false, erros: ['“falhas até chamar humano” precisa ser um inteiro maior que zero'] };
  }
  save('config', novo);
  return { ok: true, config: novo };
}

export const regras = () => load('regras', []) || [];

export function salvarRegra(entrada = {}) {
  const r = validarRegra(entrada);
  if (r.erros.length) { return { ok: false, erros: r.erros }; }
  const todas = regras();
  const i = todas.findIndex((x) => x.id === r.regra.id);
  if (i >= 0) { todas[i] = { ...todas[i], ...r.regra }; } else { todas.push(r.regra); }
  save('regras', todas);
  return { ok: true, regra: r.regra, novo: i < 0 };
}

export function excluirRegra(id) {
  const todas = regras();
  const restantes = todas.filter((r) => r.id !== String(id));
  if (restantes.length === todas.length) { return { ok: false, erros: [`regra "${id}" não encontrada`] }; }
  save('regras', restantes);
  return { ok: true, id: String(id) };
}

/**
 * Testa o bot sem canal nenhum. É isto que faz o módulo ser entregável antes da
 * Meta: dá pra ver a conversa inteira acontecendo, com as regras reais.
 */
export function simular(mensagens = [], ctx = {}) {
  const cfg = { ...getConfig(), regras: regras() };
  return {
    ok: true,
    persona: { nome: cfg.nome, saudacao: cfg.saudacao },
    turnos: conversar(mensagens, cfg, ctx),
  };
}

/** Uma mensagem só — é o que o canal vai chamar quando existir. */
export function atender(texto, ctx = {}) {
  const cfg = { ...getConfig(), regras: regras() };
  return responder(texto, cfg, ctx);
}

export function painel() {
  const cfg = getConfig();
  const rs = regras();
  return {
    config: cfg,
    regras: rs,
    total: rs.length,
    ativas: rs.filter((r) => r.ativa !== false).length,
    comHandoff: rs.filter((r) => r.handoff).length,
    // O bot pode estar "ligado" e sem regra nenhuma: isso e um bot que so sabe
    // dizer que nao entendeu. A tela precisa falar isso em voz alta.
    pronto: cfg.ativo && rs.some((r) => r.ativa !== false),
    aviso: cfg.ativo && !rs.some((r) => r.ativa !== false)
      ? 'o bot está ligado e não tem nenhuma regra ativa — ele só vai saber dizer que não entendeu'
      : null,
  };
}
