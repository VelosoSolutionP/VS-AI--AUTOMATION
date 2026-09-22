/**
 * Protocolo de atendimento.
 *
 * O que estes casos protegem é a promessa central: "continua de onde paramos".
 * Quebrar isso e fazer o cliente repetir tudo e pior do que nunca ter
 * prometido — e e o comportamento padrao de quase todo atendimento automatico.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ESTADOS, MINUTOS_INATIVIDADE, HORAS_RETOMADA, MINUTOS_GUARDA_FILA,
  gerarNumero, ehNumeroDeProtocolo, normalizarNumero,
  abrir, inativo, encerrar, aoVoltar, tocar, textoDeEncerramento, textoDeRetomada,
} from '../engine/vsprotocolo/protocolo.mjs';

const T0 = '2026-09-22T12:00:00.000Z';
const mais = (base, min) => new Date(new Date(base).getTime() + min * 60000).toISOString();

/* ---- o numero ---- */

test('o numero traz a data e nao usa caractere ambiguo', () => {
  const n = gerarNumero(T0, () => 0.999);
  assert.match(n, /^VS-260922-[0-9A-Z]{4}$/);
  // So o SUFIXO precisa ser inequivoco: a data tem zeros por natureza.
  assert.doesNotMatch(n.split('-')[2], /[O0I1]/, 'ler "O" e digitar "0" e o jeito mais bobo de perder cliente');
});

test('aceita o numero do jeito que a pessoa digitar', () => {
  const n = gerarNumero(T0, () => 0.5);
  for (const jeito of [n, n.toLowerCase(), n.replace(/-/g, ''), ` ${n} `, n.replace(/-/g, ' ')]) {
    assert.equal(ehNumeroDeProtocolo(jeito), true, `"${jeito}" tinha de ser aceito`);
  }
  assert.equal(ehNumeroDeProtocolo('meu boleto venceu'), false);
  assert.equal(normalizarNumero('vs-260922-ab7k'), 'VS260922AB7K');
});

/* ---- inatividade ---- */

test('silencio curto nao encerra; no limite, encerra', () => {
  const p = abrir({ de: '5531999', quando: T0 });
  assert.equal(inativo(p, mais(T0, MINUTOS_INATIVIDADE - 1)), false);
  assert.equal(inativo(p, mais(T0, MINUTOS_INATIVIDADE)), true);
});

test('cada mensagem reinicia o relogio', () => {
  let p = abrir({ de: '5531999', quando: T0 });
  p = tocar(p, { quando: mais(T0, 4) });
  assert.equal(inativo(p, mais(T0, 8)), false, 'sao 4 minutos desde a ultima, nao 8');
});

test('protocolo ja encerrado nao encerra de novo', () => {
  const p = encerrar(abrir({ de: '1', quando: T0 }), { quando: T0 });
  assert.equal(inativo(p, mais(T0, 999)), false);
});

test('encerrar NAO apaga — encerrado e estado, nao sumico', () => {
  const p = encerrar(tocar(abrir({ de: '1', quando: T0 }), { passo: 'financeiro', contexto: { problema: 'boleto' } }), { quando: mais(T0, 5) });
  assert.equal(p.estado, ESTADOS.ENCERRADO);
  assert.equal(p.passo, 'financeiro');
  assert.deepEqual(p.contexto, { problema: 'boleto' });
  assert.ok(p.numero, 'o numero sobrevive: e por ele que a pessoa volta');
});

/* ---- voltar: o coracao da ideia ---- */

test('quem estava com o BOT volta no passo em que parou, com o que ja contou', () => {
  let p = abrir({ de: '1', quando: T0 });
  p = tocar(p, { passo: 'suporte_triagem', contexto: { problema: 'nao abre' } });
  p = encerrar(p, { quando: mais(T0, 5) });
  const v = aoVoltar(p, mais(T0, 20));
  assert.equal(v.acao, 'retomar_bot');
  assert.equal(v.passo, 'suporte_triagem');
  assert.deepEqual(v.contexto, { problema: 'nao abre' });
});

test('quem estava NA FILA volta PRA FILA — nao passa pela Micaela de novo', () => {
  let p = abrir({ de: '1', quando: T0 });
  p = tocar(p, { estado: ESTADOS.NA_FILA, departamento: 'financeiro', contexto: { problema: 'boleto em duplicidade' }, quando: T0 });
  p = encerrar(p, { quando: mais(T0, 5) });
  const v = aoVoltar(p, mais(T0, 10));
  assert.equal(v.acao, 'voltar_fila');
  assert.equal(v.departamento, 'financeiro');
  assert.deepEqual(v.contexto, { problema: 'boleto em duplicidade' }, 'o atendente nao pode perguntar tudo de novo');
});

test('voltar rapido GUARDA o lugar na fila — a demora foi nossa', () => {
  let p = abrir({ de: '1', quando: T0 });
  p = tocar(p, { estado: ESTADOS.NA_FILA, quando: T0 });
  p = encerrar(p, { quando: mais(T0, 5) });
  const v = aoVoltar(p, mais(T0, 5 + MINUTOS_GUARDA_FILA - 1));
  assert.equal(v.lugarGuardado, true);
  assert.equal(v.filaDesde, T0, 'entra na fila com a hora ORIGINAL');
});

test('voltar muito depois entra no fim da fila — ai sim seria furar', () => {
  let p = abrir({ de: '1', quando: T0 });
  p = tocar(p, { estado: ESTADOS.NA_FILA, quando: T0 });
  p = encerrar(p, { quando: mais(T0, 5) });
  const agora = mais(T0, 5 + MINUTOS_GUARDA_FILA + 1);
  const v = aoVoltar(p, agora);
  assert.equal(v.lugarGuardado, false);
  assert.equal(v.filaDesde, agora);
});

test('quem estava COM UM ATENDENTE tambem volta pra fila, nao pro bot', () => {
  let p = abrir({ de: '1', quando: T0 });
  p = tocar(p, { estado: ESTADOS.NA_FILA, quando: T0 });
  p = tocar(p, { estado: ESTADOS.COM_HUMANO, quando: mais(T0, 1) });
  p = encerrar(p, { quando: mais(T0, 6) });
  assert.equal(aoVoltar(p, mais(T0, 10)).acao, 'voltar_fila');
});

test('depois da janela e assunto NOVO — mas o protocolo antigo nao some', () => {
  let p = abrir({ de: '1', quando: T0 });
  p = tocar(p, { passo: 'financeiro' });
  p = encerrar(p, { quando: mais(T0, 5) });
  const v = aoVoltar(p, mais(T0, 5 + (HORAS_RETOMADA * 60) + 1));
  assert.equal(v.acao, 'novo');
  assert.match(v.motivo, new RegExp(p.numero));
  assert.equal(p.passo, 'financeiro', 'o historico continua la');
});

test('protocolo aberto nao dispara retomada — a conversa so continua', () => {
  const p = abrir({ de: '1', quando: T0 });
  assert.equal(aoVoltar(p, mais(T0, 1)).acao, 'seguir');
});

/* ---- o que o cliente le ---- */

test('a mensagem de encerramento mostra o numero e promete a continuidade', () => {
  const p = abrir({ de: '1', quando: T0 });
  const t = textoDeEncerramento(p);
  assert.ok(t.includes(p.numero));
  assert.match(t, /continua de onde parou|sem voce ter que repetir|sem você ter que repetir/i);
});

test('quem volta pra fila e avisado se o lugar foi guardado — e o que acalma', () => {
  let p = abrir({ de: '1', quando: T0 });
  p = tocar(p, { estado: ESTADOS.NA_FILA, quando: T0 });
  p = encerrar(p, { quando: mais(T0, 5) });
  const guardou = textoDeRetomada(p, aoVoltar(p, mais(T0, 10)));
  assert.match(guardou, /guardei seu lugar/i);
  const perdeu = textoDeRetomada(p, aoVoltar(p, mais(T0, 5 + MINUTOS_GUARDA_FILA + 1)));
  assert.match(perdeu, /de volta na fila/i);
  assert.match(perdeu, /nao precisa repetir|não precisa repetir/i);
});

/* ---- com disco: o ciclo inteiro ---- */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'proto-'));
process.env.VSPROTOCOLO_DIR = dir;
const P = await import('../engine/vsprotocolo/index.mjs');
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('primeira mensagem ABRE protocolo — nao espera o fim pra existir', () => {
  const r = P.aoChegar('5531900001', { quando: T0 });
  assert.equal(r.novo, true);
  assert.ok(r.protocolo.numero);
  assert.equal(P.aberto('5531900001').numero, r.protocolo.numero);
});

test('mensagem seguinte usa o MESMO protocolo', () => {
  const a = P.aoChegar('5531900001', { quando: mais(T0, 1) });
  assert.equal(a.novo, false);
  assert.equal(a.protocolo.numero, P.aberto('5531900001').numero);
});

test('a varredura encerra quem calou, e devolve quem encerrou pra avisar', () => {
  const encerrados = P.varrerInativos({ quando: mais(T0, 10) });
  assert.equal(encerrados.length, 1);
  assert.equal(encerrados[0].de, '5531900001');
  assert.equal(P.aberto('5531900001'), null);
});

test('voltar dentro da janela REABRE o mesmo numero — nao colecionar protocolos', () => {
  const antes = P.ultimoEncerrado('5531900001').numero;
  const r = P.aoChegar('5531900001', { quando: mais(T0, 30) });
  assert.equal(r.retomado, true);
  assert.equal(r.protocolo.numero, antes, 'mesmo problema, mesmo protocolo');
  assert.equal(r.volta.acao, 'retomar_bot');
});

test('quem estava na fila volta pra fila, e o contexto vai junto', () => {
  P.anotar(P.aberto('5531900001').numero, {
    estado: ESTADOS.NA_FILA, departamento: 'financeiro',
    contexto: { problema: 'boleto em duplicidade' }, quando: mais(T0, 31),
  });
  P.varrerInativos({ quando: mais(T0, 40) });
  const r = P.aoChegar('5531900001', { quando: mais(T0, 45) });
  assert.equal(r.volta.acao, 'voltar_fila');
  assert.equal(r.volta.departamento, 'financeiro');
  assert.deepEqual(r.volta.contexto, { problema: 'boleto em duplicidade' });
  assert.equal(r.protocolo.estado, ESTADOS.NA_FILA);
});

test('depois da janela abre protocolo NOVO, e o antigo continua achavel', () => {
  const antigo = P.aberto('5531900001').numero;
  P.varrerInativos({ quando: mais(T0, 50) });
  const r = P.aoChegar('5531900001', { quando: mais(T0, 50 + HORAS_RETOMADA * 60 + 10) });
  assert.equal(r.novo, true);
  assert.notEqual(r.protocolo.numero, antigo);
  assert.ok(P.buscarPorNumero(antigo), 'o antigo nao pode sumir do historico');
});

test('busca pelo numero aceita o jeito que a pessoa digita', () => {
  const n = P.aberto('5531900001').numero;
  assert.equal(P.buscarPorNumero(n.toLowerCase().replace(/-/g, ' ')).numero, n);
});

test('duas pessoas diferentes nao se misturam', () => {
  P.aoChegar('5531900002', { quando: T0 });
  assert.notEqual(P.aberto('5531900001').numero, P.aberto('5531900002').numero);
});

/* ---- encerrar pelo atendente ----

   Ate aqui so o silencio encerrava. Quem resolvia o caso em dois minutos ficava
   preso na fila esperando o relogio bater cinco — ocupando um lugar que era de
   outra pessoa, e recebendo depois um "vou encerrar por inatividade" que e
   mentira: o atendimento acabou porque foi resolvido. */

test('o atendente encerra na hora, sem esperar o relogio', () => {
  P.aoChegar('5531900003', { quando: T0 });
  const numero = P.aberto('5531900003').numero;
  const fechado = P.encerrarPorNumero(numero, { motivo: 'encerrado pelo atendente', quando: mais(T0, 1) });
  assert.equal(fechado.estado, ESTADOS.ENCERRADO);
  assert.equal(fechado.motivoEncerramento, 'encerrado pelo atendente');
  assert.equal(P.aberto('5531900003'), null);
});

test('encerrar pelo atendente NAO quebra a retomada', () => {
  const numero = P.ultimoEncerrado('5531900003').numero;
  const r = P.aoChegar('5531900003', { quando: mais(T0, 30) });
  assert.equal(r.retomado, true);
  assert.equal(r.protocolo.numero, numero, 'resolvido nao e esquecido: o cliente volta no mesmo caso');
});

test('encerrar o que ja esta encerrado nao inventa um segundo encerramento', () => {
  const numero = P.aberto('5531900003').numero;
  P.encerrarPorNumero(numero, { quando: mais(T0, 31) });
  assert.equal(P.encerrarPorNumero(numero, { quando: mais(T0, 32) }), null);
});

test('encerrar numero que nao existe devolve null em vez de fingir', () => {
  assert.equal(P.encerrarPorNumero('VS-999999-ZZZZ'), null);
});

test('quem encerrou COM GENTE volta pra fila, mesmo tendo sido o atendente a fechar', () => {
  P.aoChegar('5531900004', { quando: T0 });
  const n = P.aberto('5531900004').numero;
  P.anotar(n, { estado: ESTADOS.COM_HUMANO, departamento: 'suporte', contexto: { problema: 'nao abre' } });
  P.encerrarPorNumero(n, { motivo: 'encerrado pelo atendente', quando: mais(T0, 5) });
  const r = P.aoChegar('5531900004', { quando: mais(T0, 15) });
  assert.equal(r.volta.acao, 'voltar_fila');
  assert.deepEqual(r.volta.contexto, { problema: 'nao abre' });
});

/* ---- por onde avisar ----

   Em producao, um protocolo encerrou e o aviso nao saiu:
     "179340671226006" nao e um telefone valido (15 digitos)
   Ele tentou avisar usando o LID como se fosse telefone, porque o ENDERECO da
   conversa nunca tinha chegado ate aqui — o objeto montado a mao no canal
   engolia o campo. Resultado: o cliente fica sem o numero do protocolo, que e
   justamente o que permite ele voltar pro mesmo lugar. */

test('o endereco da conversa e guardado desde a primeira mensagem', () => {
  P.aoChegar('90000000000001', { quando: T0, endereco: '90000000000001@lid' });
  assert.equal(P.aberto('90000000000001').endereco, '90000000000001@lid');
});

test('o encerramento sabe por onde avisar, mesmo sem telefone', () => {
  // A varredura fecha TODOS os parados; o que importa aqui e o deste caso.
  const f = P.varrerInativos({ quando: mais(T0, 10) }).find((x) => x.de === '90000000000001');
  assert.ok(f, 'o protocolo tinha de ter sido encerrado pela varredura');
  assert.equal(f.endereco, '90000000000001@lid', 'e por ele que a despedida sai');
  assert.notEqual(f.endereco, f.de, 'o LID cru seria recusado no envio');
});

test('voltar mantem o endereco, e um endereco novo substitui o antigo', () => {
  P.aoChegar('90000000000001', { quando: mais(T0, 20), endereco: '90000000000001@c.us' });
  assert.equal(P.aberto('90000000000001').endereco, '90000000000001@c.us',
    'se a pessoa passou a chegar por outro caminho, e o novo que vale');
});

test('sem endereco novo, o guardado NAO e apagado', () => {
  P.aoChegar('90000000000001', { quando: mais(T0, 21) });
  assert.equal(P.aberto('90000000000001').endereco, '90000000000001@c.us',
    'perder o endereco por uma mensagem sem ele deixaria a conversa sem volta');
});
