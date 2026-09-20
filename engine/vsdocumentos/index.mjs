/**
 * VSdocumentos — contrato e política de uso, com versão e aceite.
 *
 * O TEXTO é do cliente: ninguém pode gerar contrato por ele. O que faltava era a
 * máquina em volta — versionar, datar a vigência e registrar quem aceitou o quê.
 * Isso não depende de token de ninguém e é o que transforma "um texto numa tela"
 * em prova de que a pessoa concordou COM AQUELA versão.
 *
 * Versão publicada é IMUTÁVEL. Editar o texto de uma versão já aceita apagaria a
 * prova: quem aceitou concordou com o que leu, não com o que veio depois.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

const dir = () => process.env.VSDOCS_DIR || join(homedir(), '.qa-gate', 'vsdocumentos');
const arq = (n) => join(dir(), `${n}.json`);
const load = (n, p = null) => { try { return JSON.parse(readFileSync(arq(n), 'utf8')); } catch { return p; } };
const save = (n, d) => { mkdirSync(dir(), { recursive: true, mode: 0o700 }); writeFileSync(arq(n), JSON.stringify(d, null, 2), { mode: 0o600 }); return d; };

export const TIPOS = ['contrato', 'politica'];
export const NOMES = { contrato: 'Contrato', politica: 'Política de uso' };

const digest = (texto) => createHash('sha256').update(String(texto), 'utf8').digest('hex').slice(0, 16);
const hoje = () => new Date().toISOString().slice(0, 10);

function valida(tipo) {
  return TIPOS.includes(tipo) ? null : `tipo inválido: "${tipo}" (use ${TIPOS.join(' ou ')})`;
}

export const versoes = (tipo) => (valida(tipo) ? [] : load(`${tipo}`, []) || []);

/** A que está valendo: a publicada mais recente cuja vigência já começou. */
export function vigente(tipo, em = hoje()) {
  return versoes(tipo)
    .filter((v) => v.publicadaEm && v.vigenteDe <= em)
    .sort((a, b) => b.vigenteDe.localeCompare(a.vigenteDe) || b.versao - a.versao)[0] || null;
}

export const rascunho = (tipo) => versoes(tipo).find((v) => !v.publicadaEm) || null;

/**
 * Grava o rascunho. Só existe UM rascunho por tipo: dois rascunhos do mesmo
 * documento é a receita pra publicar o errado.
 */
export function salvarRascunho(tipo, texto, opts = {}) {
  const erro = valida(tipo);
  if (erro) { return { ok: false, erros: [erro] }; }
  const t = String(texto ?? '').trim();
  if (!t) { return { ok: false, erros: ['o texto é obrigatório'] }; }
  if (t.length < 50) { return { ok: false, erros: ['texto curto demais pra valer como documento (mínimo 50 caracteres)'] }; }

  const todas = versoes(tipo);
  const atual = todas.find((v) => !v.publicadaEm);
  const proxima = Math.max(0, ...todas.map((v) => v.versao || 0)) + (atual ? 0 : 1);

  const nova = {
    versao: atual ? atual.versao : proxima,
    texto: t,
    hash: digest(t),
    vigenteDe: opts.vigenteDe || atual?.vigenteDe || hoje(),
    criadaEm: atual?.criadaEm || new Date().toISOString(),
    atualizadaEm: new Date().toISOString(),
    publicadaEm: null,
  };
  save(tipo, [...todas.filter((v) => v.publicadaEm), nova]);
  return { ok: true, versao: nova };
}

/** Publica o rascunho. Daqui pra frente o texto daquela versão não muda mais. */
export function publicar(tipo, opts = {}) {
  const erro = valida(tipo);
  if (erro) { return { ok: false, erros: [erro] }; }
  const todas = versoes(tipo);
  const i = todas.findIndex((v) => !v.publicadaEm);
  if (i < 0) { return { ok: false, erros: ['não há rascunho pra publicar'] }; }
  if (opts.vigenteDe) { todas[i].vigenteDe = opts.vigenteDe; }
  todas[i] = { ...todas[i], publicadaEm: new Date().toISOString() };
  save(tipo, todas);
  return { ok: true, versao: todas[i] };
}

export function descartarRascunho(tipo) {
  const todas = versoes(tipo);
  if (!todas.some((v) => !v.publicadaEm)) { return { ok: false, erros: ['não há rascunho'] }; }
  save(tipo, todas.filter((v) => v.publicadaEm));
  return { ok: true };
}

/* ---------------- aceites ---------------- */

const ACEITES = 'aceites';
export const aceites = (tipo) => (load(ACEITES, []) || []).filter((a) => !tipo || a.tipo === tipo);

/**
 * Registra que alguém aceitou. Guarda a VERSÃO e o HASH do texto: sem o hash,
 * "aceitou a versão 2" não prova nada se a versão 2 puder ser reescrita.
 */
export function registrarAceite(tipo, quem = {}, opts = {}) {
  const erro = valida(tipo);
  if (erro) { return { ok: false, erros: [erro] }; }
  const v = vigente(tipo, opts.em);
  if (!v) { return { ok: false, erros: [`não há ${NOMES[tipo]} publicado e vigente pra aceitar`] }; }
  const identificacao = String(quem.email || quem.documento || quem.nome || '').trim();
  if (!identificacao) { return { ok: false, erros: ['informe quem está aceitando (nome, e-mail ou documento)'] }; }

  const todos = load(ACEITES, []) || [];
  // Mesmo aceitante + mesma versão = o mesmo aceite. Reaceitar não gera prova nova.
  const igual = todos.find((a) => a.tipo === tipo && a.versao === v.versao && a.identificacao === identificacao);
  if (igual) { return { ok: true, aceite: igual, repetido: true }; }

  const aceite = {
    id: `a_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    tipo,
    versao: v.versao,
    hash: v.hash,
    identificacao,
    nome: quem.nome || null,
    email: quem.email || null,
    documento: quem.documento || null,
    origem: quem.origem || 'painel',
    em: new Date().toISOString(),
  };
  save(ACEITES, [...todos, aceite]);
  return { ok: true, aceite };
}

/** Confere se o aceite ainda corresponde ao texto — detecta adulteração. */
export function conferirAceite(aceiteId) {
  const a = aceites().find((x) => x.id === String(aceiteId));
  if (!a) { return { ok: false, motivo: 'aceite não encontrado' }; }
  const v = versoes(a.tipo).find((x) => x.versao === a.versao);
  if (!v) { return { ok: false, motivo: 'a versão aceita não existe mais' }; }
  /* Recalcula do TEXTO. Comparar o hash gravado com o hash do aceite não prova
     nada: quem edita o texto por fora edita o hash junto, ou nem precisa — os
     dois campos continuariam iguais entre si e diferentes do conteúdo real. */
  const agora = digest(v.texto);
  if (agora !== a.hash) {
    return { ok: false, motivo: 'o texto da versão mudou depois do aceite — a prova não bate', adulterado: true, hashAceito: a.hash, hashAtual: agora };
  }
  return { ok: true, aceite: a, versao: v };
}

export function painel() {
  const out = {};
  for (const t of TIPOS) {
    const v = vigente(t);
    const r = rascunho(t);
    const acs = aceites(t);
    out[t] = {
      nome: NOMES[t],
      vigente: v ? { versao: v.versao, vigenteDe: v.vigenteDe, publicadaEm: v.publicadaEm, hash: v.hash, tamanho: v.texto.length } : null,
      texto: v?.texto || r?.texto || '',
      rascunho: r ? { versao: r.versao, vigenteDe: r.vigenteDe, atualizadaEm: r.atualizadaEm } : null,
      versoes: versoes(t).map(({ texto, ...resto }) => ({ ...resto, tamanho: texto.length })).sort((a, b) => b.versao - a.versao),
      aceites: acs.length,
      listaAceites: [...acs].sort((a, b) => b.em.localeCompare(a.em)).slice(0, 200),
      ultimoAceite: [...acs].sort((a, b) => b.em.localeCompare(a.em))[0] || null,
    };
  }
  return out;
}
