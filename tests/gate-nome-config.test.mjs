/**
 * Nome do arquivo de configuracao do gate.
 *
 * O nome antigo (`qa-gate.config.json`) estava escrito na mao em 5 lugares —
 * hook, dois MCPs e a CLI. Trocar o nome sem centralizar deixaria uma ponta
 * procurando o arquivo velho e o gate "pulando" calado, que e o pior jeito de
 * uma trava falhar: sem mensagem.
 *
 * Repo que ja usava o nome antigo NAO pode quebrar — por isso os dois valem.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { acharConfig, loadConfig, NOMES_CONFIG, runGate } from '../engine/core.mjs';

const novo = (nomes = {}) => {
  const d = mkdtempSync(join(tmpdir(), 'gatecfg-'));
  for (const [nome, cfg] of Object.entries(nomes)) { writeFileSync(join(d, nome), JSON.stringify(cfg)); }
  return d;
};

test('o nome preferido e vs-gate-config.json', () => {
  assert.equal(NOMES_CONFIG[0], 'vs-gate-config.json');
});

test('acha pelo nome novo', () => {
  const d = novo({ 'vs-gate-config.json': { baseUrl: 'http://novo' } });
  assert.equal(basename(acharConfig(d)), 'vs-gate-config.json');
  assert.equal(loadConfig(acharConfig(d)).baseUrl, 'http://novo');
  rmSync(d, { recursive: true, force: true });
});

test('repo antigo continua funcionando com qa-gate.config.json', () => {
  const d = novo({ 'qa-gate.config.json': { baseUrl: 'http://antigo' } });
  assert.equal(basename(acharConfig(d)), 'qa-gate.config.json');
  assert.equal(loadConfig(acharConfig(d)).baseUrl, 'http://antigo');
  rmSync(d, { recursive: true, force: true });
});

test('com os DOIS, o novo manda', () => {
  const d = novo({ 'qa-gate.config.json': { baseUrl: 'http://antigo' }, 'vs-gate-config.json': { baseUrl: 'http://novo' } });
  assert.equal(loadConfig(acharConfig(d)).baseUrl, 'http://novo');
  rmSync(d, { recursive: true, force: true });
});

test('sem nenhum, o caminho devolvido cita o nome NOVO — a mensagem ensina o certo', () => {
  const d = novo();
  assert.equal(basename(acharConfig(d)), 'vs-gate-config.json');
  assert.equal(loadConfig(acharConfig(d)), null);
  rmSync(d, { recursive: true, force: true });
});

test('loadConfig aceita a PASTA do repo — quem chama nao precisa saber o nome', () => {
  const d = novo({ 'vs-gate-config.json': { baseUrl: 'http://pasta' } });
  assert.equal(loadConfig(d).baseUrl, 'http://pasta');
  rmSync(d, { recursive: true, force: true });
});

test('runGate sem config pula citando o nome novo, nao o velho', async () => {
  const d = novo();
  const r = await runGate(d);
  assert.equal(r.status, 'skip');
  assert.match(r.reason, /vs-gate-config\.json/);
  assert.doesNotMatch(r.reason, /qa-gate\.config\.json/);
  rmSync(d, { recursive: true, force: true });
});
