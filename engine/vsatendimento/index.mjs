/**
 * VSatendimento — fachada com persistencia.
 *
 * Mesma casa do VScrm (~/.qa-gate/vscrm/*.json, fora de qualquer repositorio):
 * atendimento carrega conversa de cliente real, isso nao se versiona.
 *
 * Dois datasets: `contratos` e `atendimentos`. A regra de negocio inteira mora
 * em contratos.mjs / triagem.mjs / fila.mjs, que sao puros e testaveis sem
 * disco; aqui so entra ler, gravar e costurar.
 */

import { load, save } from '../vscrm/store.mjs';
import * as c from './contratos.mjs';
import * as f from './fila.mjs';
import * as kb from './conhecimento.mjs';
import { triar } from './triagem.mjs';

export { SETORES, competencia } from './contratos.mjs';
export { STATUS, TIPOS_EVIDENCIA, semEvidencia } from './fila.mjs';
export { LIMIAR, TIPOS } from './conhecimento.mjs';
export { triar };

const lerContratos = () => load('contratos', []);
const lerAtendimentos = () => load('atendimentos', []);
const lerBase = () => load('conhecimento', []);
const trocar = (lista, item) => [...lista.filter((x) => x.id !== item.id), item];

/* --------------------------------------------------------------- contratos */

export const listarContratos = () => lerContratos();
export const contratoDe = (cliente) =>
  lerContratos().find((x) => x.cliente === String(cliente).replace(/\D/g, '')) || null;

export function salvarContrato(dados) {
  const r = c.normalizar(dados);
  if (r.erro) { return r; }
  const lista = lerContratos().filter((x) => x.cliente !== r.contrato.cliente);
  save('contratos', [...lista, r.contrato]);
  return { contrato: r.contrato };
}

/* ------------------------------------------------------------ atendimentos */

export const listar = () => lerAtendimentos();
export const aguardando = (setor) => f.aguardando(lerAtendimentos(), setor);
export const buscar = (id) => lerAtendimentos().find((a) => a.id === id) || null;

/**
 * A Micaela desistiu: tria e abre o atendimento no setor certo.
 * `pendencias` vem de fora (financeiro) — este modulo nao decide se o cliente
 * deve, so obedece quem sabe.
 */
export function escalar({ cliente, servico = null, assunto = null, conversa = [], evidencias = [] }, deps = {}) {
  const tel = String(cliente || '').replace(/\D/g, '');
  const contrato = deps.contrato !== undefined ? deps.contrato : contratoDe(tel);
  const pendencias = deps.pendencias || [];
  const quando = deps.quando || new Date().toISOString();
  const mes = c.competencia(quando);
  const todos = lerAtendimentos();

  const veredito = triar({ cliente: tel, servico, assunto }, {
    contrato,
    pendencias,
    cotaUsada: f.usosNoMes(todos, tel, servico, mes),
    minutosUsados: f.minutosNoMes(todos, tel, mes),
    quando,
  });
  if (veredito.erro) { return veredito; }

  const r = f.abrir({
    cliente: tel, setor: veredito.setor, status: veredito.status,
    motivo: veredito.motivo, assunto, servico, evidencias,
    /* A fala da Micaela entra na conversa: o especialista abre o chat e ja le
       o que foi dito, e o cliente nao repete a historia do zero. */
    conversa: [...conversa, { autor: 'micaela', texto: veredito.mensagem, quando }],
  }, quando);
  if (r.erro) { return r; }

  save('atendimentos', [...todos, r.atendimento]);
  return { atendimento: r.atendimento, mensagem: veredito.mensagem };
}

/** Operacoes que mudam um atendimento: aplica a funcao pura e grava. */
function aplicar(id, fn) {
  const todos = lerAtendimentos();
  const a = todos.find((x) => x.id === id);
  if (!a) { return { erro: 'atendimento nao encontrado: ' + id }; }
  const r = fn(a);
  if (r.erro) { return r; }
  save('atendimentos', trocar(todos, r.atendimento));
  return r;
}

export function assumir(setor, especialista) {
  const todos = lerAtendimentos();
  const r = f.assumir(todos, setor, especialista);
  if (r.erro || r.vazio) { return r; }
  save('atendimentos', trocar(todos, r.atendimento));
  return r;
}

export const falar = (id, msg) => aplicar(id, (a) => f.falar(a, msg));
export const anexar = (id, ev) => aplicar(id, (a) => f.anexar(a, ev));
export const liberar = (id, dados) => aplicar(id, (a) => f.liberar(a, dados));

/** Encerra e ja devolve o que sobrou do contrato — o painel mostra sem segunda chamada. */
export function encerrar(id, dados = {}) {
  const r = aplicar(id, (a) => f.encerrar(a, dados));
  if (r.erro) { return r; }
  const contrato = contratoDe(r.atendimento.cliente);
  const mes = c.competencia(r.atendimento.encerradoEm);
  return {
    atendimento: r.atendimento,
    minutosRestantes: c.minutosRestantes(contrato, f.minutosNoMes(lerAtendimentos(), r.atendimento.cliente, mes)),
  };
}

/* ---------------------------------------------------------- conhecimento */

export const listarConhecimento = () => lerBase();

export function salvarConhecimento(dados) {
  const r = kb.novaEntrada(dados);
  if (r.erro) { return r; }
  const lista = lerBase().filter((x) => x.id !== r.entrada.id);
  save('conhecimento', [...lista, r.entrada]);
  return { entrada: r.entrada };
}

/**
 * O que a Micaela oferece antes de escalar. Chamada SEPARADA de `escalar` de
 * proposito: nao existe caminho em que uma sugestao errada impeca o chamado
 * de chegar no especialista. Ela sugere; quem decide e o cliente.
 */
export const sugerir = (consulta, opcoes) => kb.sugerir(lerBase(), consulta, opcoes);

/** Placar da entrada. O "nao resolveu" e o que aposenta conhecimento ruim. */
export function avaliarConhecimento(id, resolveu) {
  const lista = lerBase();
  const e = lista.find((x) => x.id === id);
  if (!e) { return { erro: 'entrada nao encontrada: ' + id }; }
  const r = kb.registrarResultado(e, resolveu);
  save('conhecimento', [...lista.filter((x) => x.id !== id), r.entrada]);
  return r;
}

/** Atendimento resolvido -> rascunho pra alguem revisar e publicar. */
export function aprenderCom(id, opcoes) {
  const a = buscar(id);
  if (!a) { return { erro: 'atendimento nao encontrado: ' + id }; }
  return kb.aprender(a, opcoes);
}

/** Tudo que a tela precisa numa chamada so — mesmo contrato do painel do VScrm. */
export function painel() {
  const todos = lerAtendimentos();
  const porSetor = {};
  for (const setor of c.SETORES) {
    porSetor[setor] = {
      aguardando: f.aguardando(todos, setor).length,
      emAtendimento: todos.filter((a) => a.setor === setor && a.status === 'em_atendimento').length,
      bloqueados: todos.filter((a) => a.setor === setor && a.status === 'bloqueado').length,
    };
  }
  return {
    setores: c.SETORES,
    porSetor,
    fila: f.aguardando(todos),
    emAtendimento: todos.filter((a) => a.status === 'em_atendimento'),
    bloqueados: todos.filter((a) => a.status === 'bloqueado'),
    semEvidencia: f.aguardando(todos).filter(f.semEvidencia).length,
    contratos: lerContratos().length,
    conhecimento: lerBase().length,
  };
}
