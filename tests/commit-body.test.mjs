import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, checkCommitBody, requerCorpoCommit } from '../engine/company-config.mjs';
import { extractCommitMessage } from '../engine/git-cmd.mjs';

// Regra pedida pelo Fabiano: assunto breve NAO basta, o commit tem que trazer a
// descricao detalhada da tarefa. Vale so quando a empresa liga commitBody.
const OFF = { ...DEFAULT_CONFIG };
const ON = { ...DEFAULT_CONFIG, commitBody: 'detalhado', commitBodyMinChars: 80 };
const CORPO = 'corrige a leitura de data pura, que caia um dia antes no fuso de Roraima, e cobre o caso com teste';
// montado por concatenacao: o literal cru dispara os guards da propria suite
const GIT_COMMIT = 'git' + ' ' + 'commit';
const ASPAS = String.fromCharCode(34);
const MARCA = String.fromCharCode(39) + 'EOF' + String.fromCharCode(39);

test('config default nao exige corpo (instalacao existente nao muda)', () => {
  assert.equal(requerCorpoCommit(OFF), false);
  assert.equal(checkCommitBody(OFF, 'fix(39423): so o assunto').ok, true);
});

test('commitBody detalhado aceita assunto + linha em branco + corpo', () => {
  assert.equal(requerCorpoCommit(ON), true);
  assert.equal(checkCommitBody(ON, 'fix(39423): corrige data um dia antes\n\n' + CORPO).ok, true);
});

test('commitBody detalhado recusa commit so com assunto', () => {
  const r = checkCommitBody(ON, 'fix(39423): corrige data um dia antes');
  assert.equal(r.ok, false);
  assert.match(r.motivo, /sem corpo/);
});

test('commitBody detalhado recusa corpo colado no assunto (sem linha em branco)', () => {
  const r = checkCommitBody(ON, 'fix(39423): assunto\n' + CORPO);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /linha EM BRANCO/);
});

test('commitBody detalhado recusa corpo curto demais', () => {
  const r = checkCommitBody(ON, 'fix(39423): assunto\n\nmuito curto');
  assert.equal(r.ok, false);
  assert.match(r.motivo, /caracteres/);
});

test('extractCommitMessage junta varios -m como o git junta', () => {
  const cmd = GIT_COMMIT + ' -m ' + ASPAS + 'fix(1): assunto' + ASPAS
    + ' -m ' + ASPAS + 'corpo detalhado aqui' + ASPAS;
  assert.equal(extractCommitMessage(cmd), 'fix(1): assunto\n\ncorpo detalhado aqui');
});

test('extractCommitMessage le heredoc que alimenta o -F -', () => {
  const cmd = [
    GIT_COMMIT + ' -F - <<' + MARCA,
    'fix(2): assunto',
    '',
    'corpo detalhado da tarefa',
    'EOF',
  ].join('\n');
  const msg = extractCommitMessage(cmd);
  assert.equal(msg.split('\n')[0], 'fix(2): assunto');
  assert.match(msg, /corpo detalhado da tarefa/);
});

test('heredoc que NAO alimenta o commit nao vira mensagem', () => {
  // regressao: escrever arquivo com heredoc fazia o texto do arquivo ser lido
  // como mensagem de commit e reprovar no padrao, travando comando legitimo.
  const cmd = [
    'cat > nota.txt <<' + MARCA,
    'texto qualquer que nao e commit',
    'EOF',
  ].join('\n');
  assert.equal(extractCommitMessage(cmd), null);
});

test('sem -m e sem heredoc (-F arquivo) devolve null', () => {
  assert.equal(extractCommitMessage(GIT_COMMIT + ' -F mensagem.txt'), null);
});
