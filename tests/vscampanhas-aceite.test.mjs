/**
 * Critérios de aceite do auditor de campanhas (especificação do dono, 27/09).
 *
 *  - "MONTA PRA MIM" não pode ser aprovada (é pedido de ajuda, não publicidade);
 *  - produto inexistente não pode ser publicado;
 *  - promoção com preço divergente do catálogo exige correção;
 *  - campanha completa pode avançar para aprovação humana;
 *  - alteração posterior invalida a aprovação anterior;
 *  - publicação exige destino autorizado;
 *  - toda decisão de auditoria tem registro de evidências e motivos.
 * Mais: cada objetivo cobra os seus campos; estética não reprova.
 */
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const casa = mkdtempSync(join(tmpdir(), 'campanhas-aceite-iso-'));
process.env.VS_HOME = casa;
process.on('exit', () => { try { rmSync(casa, { recursive: true, force: true }); } catch { /* ja foi */ } });

import assert from 'node:assert/strict';
const C = await import('../engine/vscampanhas/index.mjs');

const CRM = { sku: 'CRM-01', nome: 'Bolso Cheio CRM', descricao: 'Reúne atendimento, oportunidades e pedidos.', precoCentavos: 19900, precoDeCentavos: null, esgotado: false, ativo: true };
const FOTO = { tipo: 'png', largura: 1080, altura: 1080, bytes: 200000 };
let catalogo = { 'CRM-01': CRM };
const mundo = () => ({ produto: (sku) => catalogo[sku] || null, imagem: () => FOTO, linkBot: 'https://t.me/lojabot' });
const DIV = ['canal-telegram', 'instagram'];
const ctx = (extra = {}) => ({ produto: CRM, imagem: FOTO, codigosEmUso: [], linkBot: 'https://t.me/lojabot', ...extra });

test('“MONTA PRA MIM” (captar, CRM COMPLETO, imagem de robô) é reprovada e abre o assistente', () => {
  const r = C.auditar({ objetivo: 'captar', nome: 'CRM COMPLETO', texto: 'MONTA PRA MIM', imagem: { arquivo: 'robo.png' }, codigo: 'crm-completo', divulgacao: DIV }, ctx({ produto: null }));
  assert.equal(r.veredito, 'reprovado');
  assert.ok(r.itens.some((i) => /pedido de ajuda/.test(i.texto) && /Me ajude a montar/.test(i.texto)));
  assert.ok(r.itens.some((i) => /benefício/.test(i.texto)), 'diz que não identificou o benefício');
  assert.ok(r.itens.every((i) => !['bloquear', 'corrigir'].includes(i.nivel) || i.texto.length > 20), 'todo motivo explica o que fazer');
});

test('captar clientes: exige solução, público, benefício e ação — sem exigir preço', () => {
  const falta = C.requisitosDoObjetivo({ objetivo: 'captar', captar: {} }, null).map((f) => f.campo);
  assert.deepEqual(falta, ['solucao', 'publico', 'beneficio', 'acao']);
  const ok = C.auditar({ objetivo: 'captar', nome: 'Organize as vendas', codigo: 'org', divulgacao: DIV, imagem: { arquivo: 'a.png', gerada: true },
    captar: { solucao: 'Bolso Cheio CRM', publico: 'pequenas empresas', beneficio: 'reúne atendimento, oportunidades e pedidos num lugar só', acao: 'vendedor' },
    texto: 'Organize as vendas da sua empresa. Conheça o Bolso Cheio CRM: reúne atendimento, oportunidades e pedidos num lugar só. Toque no botão e converse com nossa equipe.' }, ctx({ produto: null }));
  assert.notEqual(ok.veredito, 'reprovado', ok.itens.filter((i) => i.nivel !== 'ok').map((i) => i.texto).join(' | '));
});

test('evento: exige nome, descrição, data, horário e local OU link', () => {
  assert.deepEqual(C.requisitosDoObjetivo({ objetivo: 'evento', nome: '', evento: {} }).map((f) => f.campo), ['nome', 'descricao', 'data', 'hora', 'local']);
  assert.deepEqual(C.requisitosDoObjetivo({ objetivo: 'evento', nome: 'Live', evento: { descricao: 'x', data: '2030-01-01', hora: '19:00', link: 'https://meet.x' } }), [], 'link substitui o local');
});

test('promoção: preço divergente do catálogo exige correção; validade e condições obrigatórias', () => {
  const r = C.auditar({ objetivo: 'promocao', nome: 'Promo CRM', sku: 'CRM-01', codigo: 'promo-crm', divulgacao: DIV, imagem: { arquivo: 'a.png', doCatalogo: true },
    promo: { precoCentavos: 14900, ate: '2030-01-01', comoAproveitar: 'diga PROMO' }, texto: 'Bolso Cheio CRM de R$ 199,00 por R$ 99,00 até 01/01. Toque no botão e diga PROMO.' }, ctx());
  assert.equal(r.veredito, 'reprovado');
  assert.ok(r.itens.some((i) => i.grupo === 'produto' && i.nivel === 'corrigir' && /catálogo diz/.test(i.texto) && /catálogo: R\$ 199,00/.test(i.evidencia)), 'motivo + evidência');
  const semCond = C.requisitosDoObjetivo({ objetivo: 'promocao', sku: 'CRM-01', promo: { precoCentavos: 14900 } }).map((f) => f.campo);
  assert.deepEqual(semCond, ['validade', 'condicoes']);
});

test('estética não reprova: maiúsculas, imagem escura, imagem lisa são recomendações', () => {
  const base = { objetivo: 'produto', nome: 'CRM', sku: 'CRM-01', codigo: 'crm', divulgacao: DIV, imagem: { arquivo: 'a.png', doCatalogo: true, analise: { variacao: 3, brilho: 20 } },
    texto: 'BOLSO CHEIO CRM POR R$ 199,00 — REÚNE ATENDIMENTO E PEDIDOS. TOQUE NO BOTÃO E FALE COM A GENTE.' };
  const r = C.auditar(base, ctx());
  assert.equal(r.veredito, 'recomendacoes', r.itens.filter((i) => i.nivel !== 'ok').map((i) => `${i.nivel}:${i.texto}`).join(' | '));
});

test('fluxo: completa → aprovação humana; produto some → não publica; mudança invalida a aprovação; destino autorizado', () => {
  const { campanha } = C.salvar({ objetivo: 'produto', nome: 'CRM', sku: 'CRM-01', codigo: 'crm-fluxo', divulgacao: DIV, imagem: { arquivo: 'a.png', doCatalogo: true },
    texto: 'Bolso Cheio CRM por R$ 199,00: reúne atendimento, oportunidades e pedidos. Toque no botão e fale com a gente.' });
  const a = C.rodarAuditoria(campanha.id, mundo());
  assert.equal(a.campanha.estado, 'aguardando-aprovacao', 'completa avança para aprovação');
  assert.ok(a.campanha.auditorias.length === 1 && a.campanha.auditorias[0].itens.some((i) => i.evidencia), 'registro de evidências');
  const ap = C.aprovar(campanha.id, { ...mundo(), por: 'dono' });
  assert.equal(ap.ok, true);

  // Publicação exige destino autorizado.
  assert.equal(C.agendarPublicacao(campanha.id, { destinos: ['-1999'], ctx: mundo() }).ok, false);
  C.registrarEventoMembro({ chat: { id: -1999, titulo: 'Canal', tipo: 'channel' }, status: 'administrator', podePublicar: true });
  assert.match(C.agendarPublicacao(campanha.id, { destinos: ['-1999'], ctx: mundo() }).erro, /não foi confirmado/);
  C.confirmarDestino('-1999');
  assert.equal(C.agendarPublicacao(campanha.id, { destinos: ['-1999'], quando: '2031-05-01T10:00:00-03:00', ctx: mundo() }).ok, true);

  // O preço mudou no catálogo depois da aprovação: backend recusa publicar.
  catalogo = { 'CRM-01': { ...CRM, precoCentavos: 24900 } };
  const r = C.agendarPublicacao(campanha.id, { destinos: ['-1999'], quando: '2031-06-01T10:00:00-03:00', ctx: mundo() });
  assert.equal(r.ok, false);
  assert.match(r.erro, /mudou desde a aprovação/);
  // Produto sumiu do catálogo: não publica.
  catalogo = {};
  assert.equal(C.revalidar(C.obter(campanha.id), mundo()).ok, false);
  catalogo = { 'CRM-01': CRM };

  // Reabrir: sai do ar, agendadas canceladas, volta a rascunho; reaprovar reativa o mesmo link.
  const re = C.reabrir(campanha.id, 'dono');
  assert.equal(re.campanha.estado, 'rascunho');
  assert.ok(re.campanha.publicacoes.every((p) => p.estado !== 'agendada'));
  C.salvar({ ...re.campanha, texto: 'Bolso Cheio CRM por R$ 199,00: atendimento, oportunidades e pedidos juntos. Toque no botão e fale com a gente.' });
  C.rodarAuditoria(campanha.id, mundo());
  assert.equal(C.aprovar(campanha.id, { ...mundo(), por: 'dono' }).ok, true, 'reaprovação usa o mesmo link');
});
