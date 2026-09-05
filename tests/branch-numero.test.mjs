/**
 * VS-BRANCH-010 — número da tarefa no muro de branch.
 *
 * Regressão real: o report de QA da #39701 (Morar Melhor) fazia o muro extrair "100"
 * de "Navegação 100% por clique real" e "2026" da data "04/09/2026". Resultado no
 * repositório: branch fix/fabiano.veloso/100 criada com ZERO commits. Os próprios
 * comentários do hook já registravam o mesmo padrão no Egle (#100 e #500).
 *
 * Os testes abaixo usam o TEXTO REAL do report, não uma versão reduzida — é o formato
 * que o Fabiano cola, e é nele que a heurística tem de segurar.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBranch, extrairNumeroTarefa, limparRuidoNumerico, resolverNumero } from '../engine/branch-req.mjs';

// Trecho fiel do report de QA colado pelo dev (defeito do PDF do TAS, HU-05).
const REPORT_QA = `PDF do TAS imprime valores internos do sistema no lugar dos nomes — "Municipio ALTO_ALEGRE", "AREA_SERVICO" e "BANHEIRO" no documento que o beneficiario assina (HU-05)

Ambiente: Dev — https://morarmelhor.msbtec.dev, medido em 04/09/2026. Perfil: agente.analista@msbtec.email (P04 — AGENTE_ANALISTA_MM). Navegação 100% por clique real, a partir do cartão "Planejamento de Reforma" da home.

Trecho literal do PDF gerado para o cadastro 01KYRXVQHD7K6XFHN0EE3C7S9G:
Também vale notar: a área sai como 10.00 e 6.50, com ponto decimal e sem a unidade.
Não há RN sobre a formatação — o que a HU diz é Fluxo 08 item 14 e Fluxo 08 item 15.
Encontrado no regressivo de QA da HU-05 em 04/09/2026. pode criar as branchs e seguir com a tarefa lembrar dos testes unitarios que sao obrigatorios`;

test('#VS-BRANCH-010: report de QA NAO vira numero de tarefa (nem 100, nem 2026)', () => {
  const { inicio, marcado } = extrairNumeroTarefa(REPORT_QA);
  assert.equal(inicio, null, 'report nao comeca com numero');
  assert.equal(marcado, null, 'report nao tem numero MARCADO — nao pode inventar um');
  assert.equal(parseBranch(REPORT_QA).num, null);
});

test('#VS-BRANCH-010: o ruido que causou a branch fantasma some antes da busca', () => {
  const limpo = limparRuidoNumerico(REPORT_QA);
  assert.ok(!/\b100\b/.test(limpo), 'percentual "100%" ainda vaza como numero');
  assert.ok(!/\b2026\b/.test(limpo), 'ano da data ainda vaza como numero');
  assert.ok(!/01KYRXVQ/i.test(limpo), 'ULID do cadastro ainda vaza');
  // decimais da area, codigos HU-05/P04 e o e-mail tambem nao podem sobrar
  assert.ok(!/\b10\.00\b/.test(limpo) && !/\b6\.50\b/.test(limpo), 'decimais ainda vazam');
  assert.ok(!/msbtec/.test(limpo), 'e-mail/URL ainda vazam');
});

test('#VS-BRANCH-010: numero MARCADO no meio do texto e reconhecido', () => {
  assert.equal(extrairNumeroTarefa('corrige o #39701 por favor').marcado, '39701');
  assert.equal(extrairNumeroTarefa('tarefa 39701, pode seguir').marcado, '39701');
  assert.equal(extrairNumeroTarefa('chamado 39701 do Redmine').marcado, '39701');
  assert.equal(extrairNumeroTarefa('task 39701').marcado, '39701');
});

test('#VS-BRANCH-010: report COM o numero marcado devolve o numero certo, nao o ruido', () => {
  const comNumero = 'tarefa 39701\n\n' + REPORT_QA;
  assert.equal(extrairNumeroTarefa(comNumero).marcado, '39701',
    'com marcador explicito tem de vencer o "100" de "Navegacao 100%"');
});

test('#VS-BRANCH-010: mensagem que ABRE a tarefa continua funcionando', () => {
  const { inicio } = extrairNumeroTarefa('39701 fix dev back');
  assert.equal(inicio, '39701');
  const p = parseBranch('39701 fix dev back');
  assert.equal(p.num, '39701');
  assert.equal(p.tipo, 'fix');
  assert.equal(p.origem, 'dev');
  assert.deepEqual(p.target, ['back']);
});

test('#VS-BRANCH-010: palavra "tarefa" solta NAO autoriza pescar qualquer numero', () => {
  // era exatamente isto que quebrava: "tarefa" em qualquer lugar + 1o numero do texto.
  const { marcado } = extrairNumeroTarefa('segue com a tarefa; o job roda 1500 vezes por hora');
  assert.equal(marcado, null);
});

test('#VS-BRANCH-010: checklist ja aberto MANDA — report como escopo nao troca o numero', () => {
  const pending = { num: '39702', tipo: 'fix', origem: 'dev', repositorios: ['back'] };
  // numero fantasma que o turno do escopo poderia trazer
  assert.equal(resolverNumero(pending, '100'), '39702');
  assert.equal(resolverNumero(pending, null), '39702');
});

test('#VS-BRANCH-010: sem checklist aberto, o numero do turno abre a tarefa', () => {
  assert.equal(resolverNumero(null, '39701'), '39701');
  assert.equal(resolverNumero({ tipo: 'fix' }, '39701'), '39701');
  assert.equal(resolverNumero(null, null), null);
});

test('#VS-BRANCH-010: parseBranch e o muro passam a concordar no numero', () => {
  // antes: parseBranch dizia "2026" (data) e o muro dizia "100" (percentual).
  const doParse = parseBranch(REPORT_QA).num;
  const { inicio, marcado } = extrairNumeroTarefa(REPORT_QA);
  assert.equal(doParse, inicio || marcado);
});
