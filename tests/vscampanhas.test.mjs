/**
 * Campanhas do Telegram — preparar, auditar, aprovar.
 *
 * O que estes testes seguram: o auditor bloqueia o que o Telegram recusaria
 * (legenda longa, foto fora do limite, código inválido) e o que venderia errado
 * (produto inativo, preço que não é o do catálogo, promoção que não é promoção);
 * "revisar" só aprova com ressalva registrada; a auditoria é por versão do
 * material; e o link só passa a atribuir depois de aprovado.
 */
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const casa = mkdtempSync(join(tmpdir(), 'campanhas-iso-'));
process.env.VS_HOME = casa;
process.on('exit', () => { try { rmSync(casa, { recursive: true, force: true }); } catch { /* ja foi */ } });

import assert from 'node:assert/strict';
import * as C from '../engine/vscampanhas/index.mjs';
import { dimensoes, lerImagem } from '../engine/vscampanhas/imagem.mjs';
import * as R from '../engine/vsresultados/index.mjs';

const AGORA = '2026-09-27T12:00:00.000Z';
const CAMISA = { sku: 'CAM-01', nome: 'Camiseta preta', precoCentavos: 4990, precoDeCentavos: null, esgotado: false, ativo: true };
const FOTO_OK = { tipo: 'jpeg', largura: 1080, altura: 1080, bytes: 300 * 1024 };
const ctx = (extra = {}) => ({ produto: CAMISA, imagem: FOTO_OK, codigosEmUso: [], linkBot: 'https://t.me/lojabot', agora: AGORA, ...extra });
const base = (extra = {}) => ({ objetivo: 'produto', nome: 'Camiseta', sku: 'CAM-01', texto: 'Camiseta preta por R$ 49,90. Chame no botão!', imagem: { arquivo: 'x.jpg' }, codigo: 'camiseta', botao: 'Quero', promo: null, evento: null, ...extra });
const niveis = (rel, grupo) => rel.itens.filter((i) => !grupo || i.grupo === grupo).map((i) => i.nivel);

function png(l, a) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(l, 16); b.writeUInt32BE(a, 20);
  return b;
}
function jpeg(l, a) {
  // SOI, APP0 curto, SOF0 com altura/largura
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, a >> 8, a & 255, l >> 8, l & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
}

test('imagem: dimensões lidas do cabeçalho de PNG e JPEG', () => {
  assert.deepEqual(dimensoes(png(1200, 630)), { tipo: 'png', largura: 1200, altura: 630 });
  assert.deepEqual(dimensoes(jpeg(800, 600)), { tipo: 'jpeg', largura: 800, altura: 600 });
  assert.equal(dimensoes(Buffer.from('não é imagem nenhuma')), null);
  const f = join(casa, 'a.png'); writeFileSync(f, png(640, 640));
  assert.equal(lerImagem(f).largura, 640);
  assert.equal(lerImagem(join(casa, 'nao-existe.png')), null);
});

test('auditor: material certo passa sem pendência', () => {
  const rel = C.auditar(base(), ctx());
  assert.equal(rel.resultado, 'ok');
  assert.ok(rel.itens.some((i) => i.grupo === 'destino' && i.texto.includes('https://t.me/lojabot?start=camiseta')));
});

test('auditor: produto inexistente ou inativo bloqueia', () => {
  assert.equal(C.auditar(base(), ctx({ produto: null })).resultado, 'bloquear');
  assert.equal(C.auditar(base(), ctx({ produto: { ...CAMISA, ativo: false } })).resultado, 'bloquear');
  assert.equal(C.auditar(base({ sku: null }), ctx()).resultado, 'bloquear');
});

test('auditor: preço no texto diferente do catálogo pede correção; sem estoque só alerta', () => {
  assert.deepEqual(C.precosNoTexto('De R$ 1.299,00 por R$49 ou R$ 9,9'), [129900, 4900, 990]);
  const rel = C.auditar(base({ texto: 'Camiseta por R$ 39,90' }), ctx());
  assert.equal(rel.resultado, 'corrigir');
  assert.match(rel.itens.find((i) => i.nivel === 'corrigir').texto, /R\$ 39,90.*R\$ 49,90/);
  assert.equal(C.auditar(base(), ctx({ produto: { ...CAMISA, esgotado: true } })).resultado, 'alertar');
});

test('auditor: limites do Telegram para foto e legenda bloqueiam', () => {
  assert.equal(C.auditar(base({ texto: 'a'.repeat(1025) }), ctx()).resultado, 'bloquear');
  assert.notEqual(C.auditar(base({ texto: 'a'.repeat(1025), imagem: null }), ctx()).resultado, 'bloquear', 'sem foto o limite é 4096');
  assert.equal(C.auditar(base(), ctx({ imagem: { ...FOTO_OK, bytes: 11 * 1024 * 1024 } })).resultado, 'bloquear');
  assert.equal(C.auditar(base(), ctx({ imagem: { ...FOTO_OK, largura: 8000, altura: 3000 } })).resultado, 'bloquear');
  assert.equal(C.auditar(base(), ctx({ imagem: { ...FOTO_OK, largura: 4200, altura: 200 } })).resultado, 'bloquear');
  assert.equal(C.auditar(base(), ctx({ imagem: { ...FOTO_OK, tipo: 'gif' } })).resultado, 'bloquear');
  const peq = C.auditar(base(), ctx({ imagem: { ...FOTO_OK, largura: 400, altura: 400 } }));
  assert.equal(peq.resultado, 'alertar', 'imagem pequena mas utilizável só alerta');
  assert.equal(C.auditar(base({ texto: '  ' }), ctx()).resultado, 'bloquear');
});

test('auditor: código do link fora do formato ou repetido bloqueia; bot desconectado alerta', () => {
  assert.equal(C.auditar(base({ codigo: 'promoção sexta' }), ctx()).resultado, 'bloquear');
  assert.equal(C.auditar(base({ codigo: 'x'.repeat(65) }), ctx()).resultado, 'bloquear');
  assert.equal(C.auditar(base(), ctx({ codigosEmUso: ['camiseta'] })).resultado, 'bloquear');
  assert.equal(C.auditar(base(), ctx({ linkBot: null })).resultado, 'alertar');
});

test('auditor: promoção — preço promocional tem que ser menor; prazo e "como aproveitar" são sugestões', () => {
  const promo = (p) => base({ objetivo: 'promocao', texto: 'Só hoje: R$ 39,90!', promo: { precoCentavos: 3990, ate: '2026-09-30', comoAproveitar: 'diga PROMO', ...p } });
  assert.equal(C.auditar(promo(), ctx()).resultado, 'ok');
  assert.equal(C.auditar(promo({ precoCentavos: 4990 }), ctx()).resultado, 'corrigir');
  const semPrazo = C.auditar(promo({ ate: null, comoAproveitar: null }), ctx());
  assert.equal(semPrazo.resultado, 'sugerir');
  assert.equal(niveis(semPrazo, 'mensagem').filter((n) => n === 'sugerir').length, 2);
  assert.equal(C.auditar(promo({ ate: '2026-09-01' }), ctx()).resultado, 'bloquear');
});

test('auditor: evento com data passada bloqueia; captar clientes não pede produto', () => {
  const ev = (data) => base({ objetivo: 'evento', sku: null, texto: 'Bazar no sábado!', evento: { data, local: 'Loja' } });
  assert.equal(C.auditar(ev('2026-10-03'), ctx({ produto: null })).resultado, 'ok');
  assert.equal(C.auditar(ev('2026-09-01'), ctx({ produto: null })).resultado, 'bloquear');
  assert.equal(C.auditar(ev(null), ctx({ produto: null })).resultado, 'bloquear');
  assert.equal(C.auditar(base({ objetivo: 'captar', sku: null, texto: 'Entre na lista VIP' }), ctx({ produto: null })).resultado, 'ok');
});

test('auditor: termo sensível encaminha para revisão, não bloqueia', () => {
  const rel = C.auditar(base({ texto: 'Remédio natural por R$ 49,90' }), ctx());
  assert.equal(rel.resultado, 'revisar');
  assert.equal(C.auditar(base({ texto: 'Camiseta de algodão por R$ 49,90, bem curada' }), ctx()).resultado, 'ok', '"cura" dentro de outra palavra não conta');
});

const mundo = { produto: () => CAMISA, imagem: () => FOTO_OK, linkBot: 'https://t.me/lojabot', agora: AGORA };

test('ciclo: rascunho → aguardando aprovação → ativa; só então o link atribui', () => {
  const { campanha: c } = C.salvar({ ...base(), codigo: '' });
  assert.equal(c.estado, 'rascunho');
  assert.equal(c.codigo, 'camiseta', 'código sai do nome quando vem vazio');
  assert.equal(R.registrarOrigem('111', { canal: 'telegram', campanha: c.codigo }).ok, false, 'rascunho não atribui');

  const a = C.rodarAuditoria(c.id, mundo);
  assert.equal(a.campanha.estado, 'aguardando-aprovacao');
  assert.equal(C.rodarAuditoria(c.id, mundo).reaproveitada, true, 'mesma versão: não roda de novo');

  const ok = C.aprovar(c.id, { ...mundo, por: 'dono' });
  assert.equal(ok.ok, true);
  assert.equal(ok.campanha.estado, 'ativa');
  assert.equal(R.registrarOrigem('111', { canal: 'telegram', campanha: c.codigo }).ok, true, 'aprovada atribui');
  R.registrarOrigem('111', { canal: 'telegram', campanha: c.codigo });
  const linha = R.resumo({ canal: 'telegram' }).porCampanha.find((x) => x.codigo === c.codigo);
  assert.equal(linha.entradas, 2, 'cada /start é uma entrada');
  assert.equal(linha.conversas, 1, 'mas é uma pessoa só');

  assert.equal(C.salvar({ ...base(), id: c.id, texto: 'outro' }).ok, false, 'ativa não se edita');
  assert.equal(C.excluir(c.id).ok, false, 'ativa não se exclui');
  assert.equal(C.encerrar(c.id).campanha.estado, 'encerrada');
});

test('ciclo: mexer no material volta a rascunho e a auditoria roda de novo', () => {
  const { campanha: c } = C.salvar(base({ nome: 'Versões', codigo: 'versoes' }));
  C.rodarAuditoria(c.id, mundo);
  const v1 = C.obter(c.id).auditoria.versao;
  const s = C.salvar({ ...base({ nome: 'Versões', codigo: 'versoes' }), id: c.id, texto: 'Camiseta por R$ 39,90' });
  assert.equal(s.campanha.estado, 'rascunho');
  const a = C.rodarAuditoria(c.id, mundo);
  assert.equal(a.reaproveitada, false);
  assert.notEqual(a.campanha.auditoria.versao, v1);
  assert.equal(a.campanha.estado, 'em-revisao');
  assert.equal(C.aprovar(c.id, mundo).ok, false, 'correção pendente não aprova');
  // O catálogo mudou o preço para o do texto: nova versão, e agora confere.
  const r = C.aprovar(c.id, { ...mundo, produto: () => ({ ...CAMISA, precoCentavos: 3990 }) });
  assert.equal(r.ok, true);
});

test('ciclo: "revisar" aprova só com confirmação, e a ressalva fica registrada', () => {
  const { campanha: c } = C.salvar(base({ nome: 'Sensível', codigo: 'sensivel', texto: 'Aposta certeira: camiseta por R$ 49,90' }));
  const sem = C.aprovar(c.id, mundo);
  assert.equal(sem.ok, false);
  assert.equal(sem.precisaConfirmar, true);
  const com = C.aprovar(c.id, { ...mundo, aceitarRessalvas: true, por: 'dono' });
  assert.equal(com.ok, true);
  assert.equal(com.campanha.aprovacao.ressalvas.length, 1);
});

test('ciclo: código de link antigo (criado só com nome) não pode ser reusado', () => {
  R.criarCampanha({ nome: 'Panfleto', canal: 'telegram' });
  const { campanha: c } = C.salvar(base({ nome: 'Panfleto novo', codigo: 'panfleto' }));
  assert.equal(C.rodarAuditoria(c.id, mundo).campanha.auditoria.resultado, 'bloquear');
  const auto = C.salvar(base({ nome: 'Panfleto', codigo: '' })).campanha;
  assert.equal(auto.codigo, 'panfleto-2');
});
