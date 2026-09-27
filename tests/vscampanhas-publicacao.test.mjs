/**
 * Campanhas do Telegram — 2ª entrega: destinos, publicações e frequência.
 *
 * O que estes testes seguram: canal onde o bot entrou fica PENDENTE até o
 * dono confirmar (qualquer um pode adicionar o bot); sem permissão de publicar
 * não publica; bot removido marca o destino e a publicação agendada falha com o
 * motivo; a política de intervalo e de máximo por dia vale por destino; e o
 * agendador publica o que venceu, uma vez só, guardando link e falha.
 */
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const casa = mkdtempSync(join(tmpdir(), 'campanhas-pub-iso-'));
process.env.VS_HOME = casa;
process.on('exit', () => { try { rmSync(casa, { recursive: true, force: true }); } catch { /* ja foi */ } });

import assert from 'node:assert/strict';
const C = await import('../engine/vscampanhas/index.mjs');
const { podePublicarCom } = await import('../engine/canais/telegram/index.mjs');

const mundo = { produto: () => null, imagem: () => null, linkBot: 'https://t.me/lojabot' };
function campanhaAtiva(nome, codigo) {
  const { campanha } = C.salvar({ objetivo: 'captar', nome, texto: `${nome}: entre na nossa lista e receba as ofertas antes de todo mundo. Toque no botão abaixo.`, codigo, divulgacao: ['canal-telegram', 'instagram'], captar: { solucao: nome, publico: 'clientes', beneficio: 'ofertas antes de todo mundo', acao: 'lista' } });
  const a = C.aprovar(campanha.id, mundo);
  assert.equal(a.ok, true, a.erro);
  return a.campanha;
}
const canal = (id, titulo, extra = {}) => ({ chat: { id, titulo, tipo: 'channel', username: titulo.toLowerCase() }, status: 'administrator', podePublicar: true, ...extra });

test('permissão: canal exige admin com "publicar"; grupo, membro sem restrição', () => {
  assert.equal(podePublicarCom('channel', { status: 'administrator', can_post_messages: true }), true);
  assert.equal(podePublicarCom('channel', { status: 'administrator', can_post_messages: false }), false);
  assert.equal(podePublicarCom('channel', { status: 'member' }), false);
  assert.equal(podePublicarCom('supergroup', { status: 'member' }), true);
  assert.equal(podePublicarCom('supergroup', { status: 'restricted', can_send_messages: false }), false);
  assert.equal(podePublicarCom('group', { status: 'left' }), false);
});

test('destino: entra pendente, só publica depois de confirmado', () => {
  C.registrarEventoMembro(canal(-1001, 'Ofertas'));
  const d = C.listarDestinos().find((x) => x.id === '-1001');
  assert.equal(d.estado, 'pendente');
  const c = campanhaAtiva('Lista VIP', 'lista-vip');
  const r = C.agendarPublicacao(c.id, { destinos: ['-1001'] });
  assert.equal(r.ok, false);
  assert.match(r.erro, /ainda não foi confirmado/);
  assert.equal(C.confirmarDestino('-1001', 'dono').ok, true);
  assert.equal(C.agendarPublicacao(c.id, { destinos: ['-1001'] }).ok, true);
  assert.equal(C.registrarEventoMembro({ chat: { id: 55, tipo: 'private' }, status: 'member' }).ok, false, 'conversa privada não é destino');
});

test('sem permissão de publicar ou campanha não ativa: recusa', () => {
  C.registrarEventoMembro(canal(-1002, 'SemPost', { podePublicar: false }));
  C.confirmarDestino('-1002');
  const c = campanhaAtiva('Promo sem post', 'promo-sem-post');
  assert.match(C.agendarPublicacao(c.id, { destinos: ['-1002'] }).erro, /não tem permissão/);
  const { campanha: rasc } = C.salvar({ objetivo: 'captar', nome: 'Rascunho', texto: 'x', codigo: 'rasc-1' });
  assert.match(C.agendarPublicacao(rasc.id, { destinos: ['-1001'] }).erro, /aprovada/);
});

test('política: intervalo mínimo e máximo por dia, por destino', () => {
  C.salvarPolitica({ intervaloHoras: 4, maxPorDia: 2 });
  C.registrarEventoMembro(canal(-1003, 'Bairro')); C.confirmarDestino('-1003');
  const a = campanhaAtiva('Promo A', 'promo-a'); const b = campanhaAtiva('Promo B', 'promo-b'); const c = campanhaAtiva('Promo C', 'promo-c');
  const dia = '2030-05-10';
  assert.equal(C.agendarPublicacao(a.id, { destinos: ['-1003'], quando: `${dia}T09:00:00-03:00` }).ok, true);
  const perto = C.agendarPublicacao(b.id, { destinos: ['-1003'], quando: `${dia}T11:00:00-03:00` });
  assert.equal(perto.ok, false);
  assert.match(perto.erro, /4 h entre campanhas/);
  assert.equal(C.agendarPublicacao(b.id, { destinos: ['-1003'], quando: `${dia}T14:00:00-03:00` }).ok, true);
  assert.match(C.agendarPublicacao(c.id, { destinos: ['-1003'], quando: `${dia}T20:00:00-03:00` }).erro, /máximo é 2/);
  assert.equal(C.agendarPublicacao(c.id, { destinos: ['-1001'], quando: `${dia}T20:00:00-03:00` }).ok, true, 'outro destino, outra conta');
  assert.equal(C.salvarPolitica({ intervaloHoras: 0, maxPorDia: 2 }).ok, false);
  C.salvarPolitica({ intervaloHoras: 4, maxPorDia: 3 });
});

test('agendador: publica o que venceu, uma vez, guarda link; falha fica com o motivo', async () => {
  const chamadas = [];
  const publicar = async (pub, camp, dest) => { chamadas.push([camp.nome, dest.titulo]); return dest.id === '-1001' ? { ok: true, mensagemId: 7, link: 'https://t.me/ofertas/7' } : { ok: false, erro: 'o bot não tem permissão de publicar nesse destino' }; };
  const agora = new Date('2030-05-11T00:00:00-03:00');
  const r1 = await C.rodarAgendador({ publicar, agora, espera: async () => {} });
  assert.ok(r1.publicadas >= 1);
  assert.ok(r1.falhas >= 1, 'destino -1003 falha no publicar injetado');
  const r2 = await C.rodarAgendador({ publicar, agora, espera: async () => {} });
  assert.equal(r2.publicadas + r2.falhas, 0, 'não publica duas vezes');
  const vip = C.listar().find((x) => x.codigo === 'lista-vip');
  const pub = vip.publicacoes.find((p) => p.destinoId === '-1001');
  assert.equal(pub.estado, 'publicada');
  assert.equal(pub.link, 'https://t.me/ofertas/7');
  const a = C.listar().find((x) => x.codigo === 'promo-a');
  assert.equal(a.publicacoes[0].estado, 'falha');
  assert.match(a.publicacoes[0].erro, /permissão/);
  assert.equal(vip.estado, 'ativa', 'estado da campanha ≠ estado da publicação');
});

test('bot removido do canal: destino marcado e a agendada falha com o motivo; cancelar funciona', async () => {
  C.registrarEventoMembro(canal(-1004, 'Grupo X')); C.confirmarDestino('-1004');
  const c = campanhaAtiva('Promo X', 'promo-x');
  const ag = C.agendarPublicacao(c.id, { destinos: ['-1004'], quando: '2031-01-01T10:00:00-03:00' });
  const ag2 = C.agendarPublicacao(campanhaAtiva('Promo Y', 'promo-y').id, { destinos: ['-1004'], quando: '2031-01-02T10:00:00-03:00' });
  assert.equal(C.cancelarPublicacao(ag2.campanha.id, ag2.resultados[0].publicacao.id).ok, true);
  C.registrarEventoMembro({ chat: { id: -1004, titulo: 'Grupo X', tipo: 'channel' }, status: 'kicked', podePublicar: false });
  assert.equal(C.listarDestinos().find((x) => x.id === '-1004').estado, 'removido');
  await C.rodarAgendador({ publicar: async () => ({ ok: true }), agora: new Date('2031-01-03T00:00:00-03:00'), espera: async () => {} });
  const pub = C.obter(ag.campanha.id).publicacoes[0];
  assert.equal(pub.estado, 'falha');
  assert.match(pub.erro, /não está mais confirmado|perdeu a permissão/);
  assert.equal(C.obter(ag2.campanha.id).publicacoes[0].estado, 'cancelada');
});
