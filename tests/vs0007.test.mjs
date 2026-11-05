import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../engine/vs0007/regras.mjs';

test('classifica agentes internos e modelos comerciais', () => {
  assert.equal(R.classificar('0007'), 'interno');
  assert.equal(R.classificar('isis'), 'interno');
  assert.equal(R.classificar('hera'), 'interno');
  assert.equal(R.classificar('perséfone'), 'interno');
  assert.equal(R.classificar('afrodite'), 'comercializavel');
  assert.equal(R.classificar('modelo-base'), 'comercializavel');
  assert.equal(R.classificar('xyz'), 'nao-classificado');
});

test('conhecimento novo nasce descoberto', () => {
  const r = R.registrarConhecimento({ agenteId: 'afrodite', conhecimento: 'fluxo do carrinho' });
  assert.equal(r.erro, undefined);
  assert.equal(r.conhecimento.estado, 'descoberto');
  assert.equal(r.conhecimento.autorizado, false);
});

test('conhecimento so pode ser homologado com autorizacao', () => {
  const r = R.registrarConhecimento({ agenteId: 'afrodite', conhecimento: 'fluxo do carrinho', estado: 'homologado', autorizado: false });
  assert.ok(r.erro, 'homologado sem autorizacao deve falhar');
});

test('conhecimento homologado exige autorizacao explicita', () => {
  const r = R.registrarConhecimento({ agenteId: 'afrodite', conhecimento: 'fluxo do carrinho', estado: 'homologado', autorizado: true });
  assert.equal(r.erro, undefined);
  assert.equal(r.conhecimento.estado, 'homologado');
});

test('estado invalido e rejeitado', () => {
  const r = R.registrarConhecimento({ agenteId: 'afrodite', conhecimento: 'x', estado: 'estado-fantasma' });
  assert.ok(r.erro);
});

test('promocao exige autorizacao e estado em fluxo', () => {
  assert.equal(R.podePromover('descoberto', true), true);
  assert.equal(R.podePromover('em_validacao', true), true);
  assert.equal(R.podePromover('homologado', true), false, 'ja homologado nao reabre');
  assert.equal(R.podePromover('descoberto', false), false, 'promocao sem autorizacao e negada');
});

test('conflito de responsabilidade e detectado', () => {
  const conflitos = R.conflitosEntre([
    { agenteId: 'isis', atividades: ['relacionamento', 'comercial'] },
    { agenteId: 'hera', atividades: ['relacionamento', 'governanca'] },
  ]);
  assert.equal(conflitos.length, 1);
  assert.equal(conflitos[0].atividade, 'relacionamento');
});
