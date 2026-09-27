/**
 * Protocolos com persistência.
 *
 * Um protocolo por ATENDIMENTO, não por pessoa: quem liga três vezes no mês
 * tem três protocolos, e é assim que o histórico faz sentido. O que amarra
 * tudo é o remetente — por ele se acha o atendimento aberto e o último
 * encerrado, que é o que permite "continua de onde paramos".
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import * as R from './protocolo.mjs';

import { dentroDaCasa } from '../casa.mjs';
export * from './protocolo.mjs';

const arq = () => join(process.env.VSPROTOCOLO_DIR || dentroDaCasa('vsprotocolo'), 'protocolos.json');
const ler = () => { try { return JSON.parse(readFileSync(arq(), 'utf8')); } catch { return []; } };
const gravar = (lista) => {
  mkdirSync(dirname(arq()), { recursive: true, mode: 0o700 });
  /* Histórico não cresce para sempre: os 2000 mais recentes bastam para o
     "continua de onde paramos", e um arquivo JSON de milhões de linhas fica
     lento justamente no dia de movimento. */
  const cortada = lista.slice(-2000);
  writeFileSync(arq(), JSON.stringify(cortada, null, 2), { mode: 0o600 });
  return cortada;
};

export const listar = () => ler();
export const buscarPorNumero = (n) => ler().find((p) => R.normalizarNumero(p.numero) === R.normalizarNumero(n)) || null;

/** O atendimento vivo de alguém, se houver. */
export const aberto = (de) => ler().find((p) => p.de === de && p.estado !== R.ESTADOS.ENCERRADO) || null;

/** O último encerrado de alguém — é por ele que se retoma. */
export const ultimoEncerrado = (de) => ler()
  .filter((p) => p.de === de && p.estado === R.ESTADOS.ENCERRADO)
  .sort((a, b) => String(b.encerradoEm).localeCompare(String(a.encerradoEm)))[0] || null;

const trocar = (lista, p) => [...lista.filter((x) => x.numero !== p.numero), p];

/**
 * A mensagem chegou. Devolve o protocolo em uso e o que fazer com quem voltou.
 *
 * Chamado ANTES de o fluxo decidir qualquer coisa: é aqui que se descobre se
 * esta mensagem continua uma conversa ou começa outra.
 */
export function aoChegar(de, { quando = new Date().toISOString(), endereco = null, voltarParaFila = true } = {}) {
  let lista = ler();

  const vivo = lista.find((p) => p.de === de && p.estado !== R.ESTADOS.ENCERRADO);
  if (vivo) {
    const p = R.tocar({ ...vivo, endereco: endereco || vivo.endereco || null }, { quando });
    gravar(trocar(lista, p));
    return { protocolo: p, volta: { acao: 'seguir' }, novo: false };
  }

  const antigo = lista
    .filter((p) => p.de === de && p.estado === R.ESTADOS.ENCERRADO)
    .sort((a, b) => String(b.encerradoEm).localeCompare(String(a.encerradoEm)))[0];

  if (antigo) {
    const volta = R.aoVoltar(antigo, quando, { voltarParaFila });
    if (volta.acao !== 'novo') {
      /* Reabre O MESMO protocolo. Numero novo a cada volta faria o cliente
         colecionar protocolos do mesmo problema — e o atendente perder o fio. */
      const p = R.tocar({
        ...antigo,
        endereco: endereco || antigo.endereco || null,
        estado: volta.acao === 'voltar_fila' ? R.ESTADOS.NA_FILA : R.ESTADOS.COM_BOT,
        encerradoEm: null,
        filaDesde: volta.acao === 'voltar_fila' ? volta.filaDesde : antigo.filaDesde,
      }, { quando });
      gravar(trocar(lista, p));
      return { protocolo: p, volta, novo: false, retomado: true };
    }
  }

  /* Contato do WhatsApp por LID ("…@lid") so recebe mensagem por esse
     endereco — o `de` sozinho nao serve. Protocolo aberto sem ele (pelo painel,
     numa conversa antiga) herda o do atendimento anterior da mesma pessoa. */
  const herdado = endereco || lista.filter((x) => x.de === de && x.endereco).map((x) => x.endereco).pop() || null;
  const p = { ...R.abrir({ de, quando }), endereco: herdado };
  lista = [...lista, p];
  gravar(lista);
  return { protocolo: p, volta: { acao: 'seguir' }, novo: true };
}

/** Anota onde a conversa está, para o caso de ela parar agora. */
/** Apaga tudo de um remetente. Existe pro SIMULADOR: testar nao pode encher o
    historico de protocolo de mentira, nem fazer o proximo teste "retomar" o
    anterior. */
export function apagarDe(de) {
  const lista = ler();
  const nova = lista.filter((p) => p.de !== de);
  if (nova.length !== lista.length) { gravar(nova); }
  return lista.length - nova.length;
}

export function anotar(numero, dados = {}) {
  const lista = ler();
  const atual = lista.find((p) => p.numero === numero);
  if (!atual) { return null; }
  const p = R.tocar(atual, dados);
  gravar(trocar(lista, p));
  return p;
}

export function encerrarPorNumero(numero, opcoes = {}) {
  const lista = ler();
  const atual = lista.find((p) => p.numero === numero);
  if (!atual || atual.estado === R.ESTADOS.ENCERRADO) { return null; }
  const p = R.encerrar(atual, opcoes);
  gravar(trocar(lista, p));
  return p;
}

/**
 * Varredura: encerra quem ficou em silêncio. Devolve os encerrados para quem
 * chamou avisar o cliente — o módulo não fala com o WhatsApp.
 */
export function varrerInativos({ quando = new Date().toISOString(), limite } = {}) {
  const lista = ler();
  const vencidos = lista.filter((p) => R.inativo(p, quando, limite ?? R.MINUTOS_INATIVIDADE));
  if (!vencidos.length) { return []; }
  let nova = lista;
  const saida = [];
  for (const v of vencidos) {
    /* Perguntou "algo mais?" e o cliente nao voltou: o atendimento estava
       concluido — fecha como FINALIZADO (sem resposta), nao como abandono. */
    const p = v.finalizacao?.estado === 'aguardando'
      ? R.encerrar(v, { quando, motivo: 'finalizado sem resposta', desfecho: 'finalizado', por: v.finalizacao.por ? { tipo: 'atendente', ...v.finalizacao.por } : null, motivoTexto: 'o cliente não respondeu à pergunta final' })
      : R.encerrar(v, { quando, motivo: 'inatividade' });
    nova = trocar(nova, p);
    saida.push(p);
  }
  gravar(nova);
  return saida;
}

/* ── avaliação ───────────────────────────────────────────────────────────── */

/** Pede a nota: o próximo "1".."5" desta pessoa vira avaliação, não conversa nova. */
export function pedirAvaliacao(numero, quando = new Date().toISOString()) {
  const lista = ler();
  const p = lista.find((x) => x.numero === numero);
  if (!p) { return null; }
  const n = { ...p, avaliacao: { estado: 'aguardando', pedidaEm: quando, nota: null, comentario: null } };
  gravar(trocar(lista, n));
  return n;
}

/**
 * Avaliação esperando resposta desta pessoa (nota ou comentário), dentro da
 * janela. Fora dela, some sozinha: ninguém é cobrado de nota no dia seguinte.
 */
export function avaliacaoPendente(de, quando = new Date().toISOString()) {
  const p = ultimoEncerrado(de);
  const a = p?.avaliacao;
  if (!a || !['aguardando', 'comentario'].includes(a.estado)) { return null; }
  if (aberto(de)) { return null; }
  const desde = a.estado === 'comentario' ? a.notaEm : a.pedidaEm;
  const lim = a.estado === 'comentario' ? R.MINUTOS_COMENTARIO : R.MINUTOS_AVALIACAO;
  if ((new Date(quando) - new Date(desde)) / 60000 > lim) { return null; }
  return p;
}

function mexerAvaliacao(numero, fn) {
  const lista = ler();
  const p = lista.find((x) => x.numero === numero);
  if (!p?.avaliacao) { return null; }
  const n = { ...p, avaliacao: fn({ ...p.avaliacao }) };
  gravar(trocar(lista, n));
  return n;
}
export const registrarNota = (numero, nota, quando = new Date().toISOString()) =>
  mexerAvaliacao(numero, (a) => ({ ...a, nota, notaEm: quando, estado: nota <= 3 ? 'comentario' : 'respondida' }));
export const registrarComentario = (numero, comentario, quando = new Date().toISOString()) =>
  mexerAvaliacao(numero, (a) => ({ ...a, comentario: comentario ? String(comentario).slice(0, 1000) : null, comentarioEm: quando, estado: 'respondida' }));
/** Mandou outra coisa em vez da nota: a avaliação fecha sem resposta e a conversa segue. */
export const semResposta = (numero) => mexerAvaliacao(numero, (a) => ({ ...a, estado: a.nota ? 'respondida' : 'sem-resposta' }));

/** Encerrados (o histórico), mais recentes primeiro. */
export const encerrados = () => ler().filter((p) => p.estado === R.ESTADOS.ENCERRADO)
  .sort((a, b) => String(b.encerradoEm).localeCompare(String(a.encerradoEm)));

/** Por onde falar com esta pessoa: o endereço guardado (LID etc.) ou o próprio id. */
export const enderecoDe = (de) => ler().filter((x) => x.de === de && x.endereco).map((x) => x.endereco).pop() || de;

/* ── finalização ─────────────────────────────────────────────────────────── */

/** O atendente perguntou "algo mais?": a próxima resposta decide se finaliza. */
export function pedirFinalizacao(numero, por = null, quando = new Date().toISOString()) {
  const lista = ler();
  const p = lista.find((x) => x.numero === numero && x.estado !== R.ESTADOS.ENCERRADO);
  if (!p) { return null; }
  const n = { ...p, ultimaAtividade: quando, finalizacao: { estado: 'aguardando', pedidaEm: quando, por } };
  gravar(trocar(lista, n));
  return n;
}
/** Atendimento aberto esperando a resposta da pergunta final. */
export function finalizacaoPendente(de) {
  const p = aberto(de);
  return p?.finalizacao?.estado === 'aguardando' ? p : null;
}
/** Respondeu outra coisa: não era o fim, a conversa segue com o atendente. */
export function continuarAtendimento(numero, quando = new Date().toISOString()) {
  const lista = ler();
  const p = lista.find((x) => x.numero === numero);
  if (!p?.finalizacao) { return null; }
  const n = { ...p, finalizacao: { ...p.finalizacao, estado: 'continuou', respondidaEm: quando } };
  gravar(trocar(lista, n));
  return n;
}

/**
 * Protocolo aberto só para fechar uma conversa ANTIGA (de antes de todo
 * atendimento ter protocolo): o histórico dele vai buscar as mensagens desde o
 * atendimento anterior da pessoa — senão aparecia vazio.
 */
export function marcarLegado(numero) {
  const lista = ler();
  const p = lista.find((x) => x.numero === numero);
  if (!p) { return null; }
  const n = { ...p, legado: true };
  gravar(trocar(lista, n));
  return n;
}
