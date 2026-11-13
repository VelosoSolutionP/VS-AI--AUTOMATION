/**
 * Diário do 0007 (12/11): o que ele faz aparece ao vivo; o auditor de 15 dias traz só o
 * relevante, na ordem do dono (prazo > inoperante > mudou IA); inoperante só registra quando muda.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const casa = mkdtempSync(join(tmpdir(), 'diario-0007-'));
process.env.VS_HOME = casa;
process.env.VSCRM_DIR = join(casa, 'vscrm');
const diario = await import('../engine/vs0007/diario.mjs');
test.after(() => rmSync(casa, { recursive: true, force: true }));

test('auditor traz prazo, depois inoperante, depois mudou-ia; homologou fica só no ao vivo', () => {
  const agora = new Date('2026-11-12T12:00:00Z');
  diario.registrar({ tipo: 'mudou-ia', titulo: 'Revisou Cadu', motivo: 'viu falha no cardápio', em: new Date('2026-11-12T10:00:00Z') });
  diario.registrar({ tipo: 'homologou', titulo: 'Homologou Edson', em: new Date('2026-11-12T10:30:00Z') });
  diario.registrar({ tipo: 'prazo', titulo: 'Não homologou Ana', motivo: 'passou de 12 h', em: new Date('2026-11-12T09:00:00Z') });
  diario.registrar({ tipo: 'prazo', titulo: 'Velho', em: new Date('2026-10-01T09:00:00Z') });
  diario.marcarSaude(false, 'Ollama não respondeu', new Date('2026-11-12T11:00:00Z'));
  const a = diario.auditoria({ agora });
  assert.deepEqual(a.relevantes.map((l) => l.tipo), ['prazo', 'inoperante', 'mudou-ia']);
  assert.equal(a.relevantes[0].motivo, 'passou de 12 h');
  assert.equal(a.contagem.homologou, 1);
  assert.ok(!a.relevantes.some((l) => l.titulo === 'Velho'), 'fora dos 15 dias não entra');
  assert.equal(diario.listar()[0].tipo, 'inoperante', 'ao vivo: mais novo primeiro');
});

test('inoperante e volta só registram quando o estado muda', () => {
  const antes = diario.listar({ limite: 500 }).length;
  assert.equal(diario.marcarSaude(false, 'de novo'), null, 'já estava fora: não repete');
  assert.equal(diario.estado().noAr, false);
  assert.equal(diario.marcarSaude(true).tipo, 'voltou');
  assert.equal(diario.marcarSaude(true), null);
  assert.equal(diario.estado().noAr, true);
  assert.equal(diario.listar({ limite: 500 }).length, antes + 1);
});

test('depois=ISO traz só o que chegou depois', () => {
  const marco = new Date().toISOString();
  diario.registrar({ tipo: 'info', titulo: 'novo', em: new Date(Date.now() + 1000) });
  assert.deepEqual(diario.listar({ depois: marco }).map((l) => l.titulo), ['novo']);
});
