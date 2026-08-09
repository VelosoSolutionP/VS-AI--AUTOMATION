import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateUnitTestGuard } from '../engine/unit-test-guard.mjs';

test('VS-AUD-004: backend code sem teste bloqueia', () => {
  const r = evaluateUnitTestGuard(['app/Http/Livewire/AtendimentoPlanejado.php']);
  assert.equal(r.blocked, true);
  assert.deepEqual(r.missing, ['app/Http/Livewire/AtendimentoPlanejado.php']);
});

test('VS-AUD-004: backend code COM teste no commit libera', () => {
  const r = evaluateUnitTestGuard([
    'app/Http/Livewire/AtendimentoPlanejado.php',
    'tests/Feature/AtendimentoPlanejadoTest.php',
  ]);
  assert.equal(r.blocked, false);
  assert.deepEqual(r.missing, []);
});

test('VS-AUD-004: front code sem teste bloqueia', () => {
  const r = evaluateUnitTestGuard(['resources/js/components/Form.vue']);
  assert.equal(r.blocked, true);
});

test('VS-AUD-004: front code com .spec libera', () => {
  const r = evaluateUnitTestGuard([
    'src/components/Form.tsx',
    'src/components/Form.spec.tsx',
  ]);
  assert.equal(r.blocked, false);
});

test('VS-AUD-004: mobile dart sem teste bloqueia', () => {
  const r = evaluateUnitTestGuard(['lib/screens/home.dart']);
  assert.equal(r.blocked, true);
});

test('VS-AUD-004: mobile dart com _test.dart libera', () => {
  const r = evaluateUnitTestGuard([
    'lib/screens/home.dart',
    'test/screens/home_test.dart',
  ]);
  assert.equal(r.blocked, false);
});

test('VS-AUD-004: só blade/css/docs não é código de produção', () => {
  const r = evaluateUnitTestGuard([
    'resources/views/atendimento/index.blade.php',
    'public/css/style.css',
    'README.md',
  ]);
  assert.equal(r.blocked, false);
  assert.deepEqual(r.missing, []);
});

test('VS-AUD-004: migrations/seeders/vendor excluídos', () => {
  const r = evaluateUnitTestGuard([
    'database/migrations/2026_01_01_000000_create_x.php',
    'database/seeders/XSeeder.php',
    'vendor/pkg/src/Thing.php',
    'public/js/app.js',
  ]);
  assert.equal(r.blocked, false);
});

test('VS-AUD-004: separadores Windows normalizados', () => {
  const r = evaluateUnitTestGuard(['app\\Models\\Atendimento.php']);
  assert.equal(r.blocked, true);
  assert.deepEqual(r.missing, ['app/Models/Atendimento.php']);
});

test('VS-AUD-004: opts.stacks limita a stack avaliada', () => {
  const r = evaluateUnitTestGuard(['lib/screens/home.dart'], { stacks: ['backend'] });
  assert.equal(r.blocked, false);
});

test('VS-AUD-004: lista vazia libera', () => {
  const r = evaluateUnitTestGuard([]);
  assert.equal(r.blocked, false);
});

import { toNativePath, resolveGitCwd } from '../engine/git-cwd.mjs';

test('git-cwd: normaliza path MSYS /c/ para Windows', () => {
  assert.equal(toNativePath('/c/Veloso/x'), 'C:/Veloso/x');
  assert.equal(toNativePath('C:/Veloso/x'), 'C:/Veloso/x');
  assert.equal(toNativePath('relativo/x'), 'relativo/x');
});

test('git-cwd: cd MSYS extraído e normalizado', () => {
  const g = resolveGitCwd('cd /d/Proj/repo && git commit -m x', 'C:/base');
  assert.equal(g, 'D:/Proj/repo');
});
