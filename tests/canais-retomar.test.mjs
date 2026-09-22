/**
 * O canal tem de voltar sozinho.
 *
 * O que estes casos protegem e simples de dizer e caro de descobrir em campo:
 * depois de um reinicio do painel, o WhatsApp do cliente ficava mudo ate
 * alguem abrir a tela e clicar em Conectar. Ninguem clica no que nao sabe que
 * caiu — quem descobria era o cliente DELE, mandando mensagem e sendo ignorado.
 */
import test from 'node:test';
/* Este arquivo faz o bot atender, e atender ABRE PROTOCOLO. Sem apontar o
   armazem pra uma pasta descartavel, o teste escreveria na casa de quem roda
   — e um caso comecaria "retomando" o protocolo que o anterior deixou aberto. */
import { mkdtempSync as _mkd, rmSync as _rm } from 'node:fs';
import { tmpdir as _tmp } from 'node:os';
import { join as _join } from 'node:path';
const _dirProto = _mkd(_join(_tmp(), 'proto-iso-'));
process.env.VSPROTOCOLO_DIR = _dirProto;
process.on('exit', () => { try { _rm(_dirProto, { recursive: true, force: true }); } catch { /* ja foi */ } });

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

/* O modulo grava em ~/.qa-gate/canais/config.json. Em vez de escrever na casa
   de quem roda o teste, aponto HOME pra uma pasta descartavel. */
const casa = mkdtempSync(join(tmpdir(), 'canais-'));
process.env.HOME = casa;
const arq = join(casa, '.qa-gate', 'canais', 'config.json');
const escrever = (o) => { mkdirSync(join(casa, '.qa-gate', 'canais'), { recursive: true }); writeFileSync(arq, JSON.stringify(o)); };
const ler = () => JSON.parse(readFileSync(arq, 'utf8'));

const canais = await import('../backend/canais.mjs');
test.after(() => rmSync(casa, { recursive: true, force: true }));

test('canal desligado no papel NAO e reaberto sozinho', async () => {
  escrever({ ligado: false });
  const r = await canais.retomar();
  assert.equal(r.retomado, false);
  assert.match(r.motivo, /desligado/);
});

test('sem config nenhuma, tambem nao inventa conexao', async () => {
  escrever({});
  const r = await canais.retomar();
  assert.equal(r.retomado, false, 'quem nunca conectou nao tem sessao pra retomar');
});

test('desconectar grava a intencao — e ela sobrevive ao reinicio', async () => {
  escrever({ ligado: true, numero: '5531975127978' });
  await canais.desconectar();
  assert.equal(ler().ligado, false, 'desligou de proposito: reinicio nao pode religar');
  assert.equal(ler().numero, '5531975127978', 'o resto da config nao pode ser perdido no caminho');
  assert.ok(ler().desligadoEm, 'fica registrado QUANDO foi desligado');
});
