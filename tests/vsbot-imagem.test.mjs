/**
 * Foto no passo do fluxo: imagem e texto chegam NUM BALAO SO (o texto vira a
 * legenda). E a foto nunca pode custar a resposta: se ela nao carrega ou nao
 * sai, o texto sai do mesmo jeito.
 */
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const casa = mkdtempSync(join(tmpdir(), 'imagem-'));
process.env.VS_HOME = casa;
process.env.VSPROTOCOLO_DIR = join(casa, 'proto');
process.on('exit', () => { try { rmSync(casa, { recursive: true, force: true }); } catch { /* ja foi */ } });

import assert from 'node:assert/strict';
import { fluxoDeCsv } from '../engine/vsbot/fluxo-csv.mjs';
const bot = await import('../engine/vsbot/index.mjs');
const atendimento = await import('../backend/atendimento.mjs');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
bot.salvarConfig({ ativo: true, nome: 'Mica', assinarMensagens: false, cerebro: { ligado: false } });

test('planilha aceita a coluna imagem (nome enviado ou link https) e recusa lixo', () => {
  const ok = fluxoDeCsv('passo,mensagem,opcao,texto_opcao,vai_para,acao,imagem\ninicio,"Oi! Escolha:",1,"Cardápio",cardapio,,boas-vindas.jpg\ncardapio,"Nosso cardápio",,,,fim,https://exemplo.com/menu.png\n');
  assert.equal((ok.erros || []).length, 0, JSON.stringify(ok.erros));
  const achar = (id) => ok.fluxo.passos.find((p) => p.id === id);
  assert.equal(achar('inicio').imagem, 'boas-vindas.jpg');
  assert.equal(achar('cardapio').imagem, 'https://exemplo.com/menu.png');
  const ruim = fluxoDeCsv('passo,mensagem,opcao,texto_opcao,vai_para,acao,imagem\ninicio,"Oi",,,,fim,C:\\\\fotos\\\\x.jpg\n');
  assert.match((ruim.erros || []).join(' '), /imagem/);
});

test('imagem enviada fica guardada, aparece na lista e so aceita foto de ate 5 MB', () => {
  const r = bot.salvarMidia({ nome: 'Boas Vindas.PNG', dataUri: PNG });
  assert.equal(r.ok, true);
  assert.equal(r.nome, 'boas-vindas.png');
  assert.ok(bot.listarMidias().some((m) => m.nome === 'boas-vindas.png'));
  assert.equal(bot.salvarMidia({ nome: 'x.exe', dataUri: 'data:application/x-msdownload;base64,AAAA' }).ok, false);
});

const fluxoComFoto = (mensagem) => bot.salvarFluxo([
  { id: 'inicio', mensagem, imagem: 'boas-vindas.png', opcoes: [{ tecla: '1', texto: 'Suporte', vaiPara: 'fim' }] },
  { id: 'fim', mensagem: 'Até mais!', acao: 'fim' },
]);

test('passo com foto: UM balao — imagem com o texto como legenda, e nenhum texto separado', async () => {
  fluxoComFoto('Oi! Sou a Mica. Escolha:');
  const textos = []; const imagens = [];
  const r = await atendimento.receberMensagem({ id: 'i1', de: '5531900000601', texto: 'oi', tipo: 'texto' }, {
    enviar: async ({ texto }) => { textos.push(texto); return { ok: true }; },
    enviarImagem: async (e) => { imagens.push(e); return { ok: true, id: 'IMG1' }; },
  });
  assert.equal(imagens.length, 1);
  assert.match(imagens[0].legenda, /Oi! Sou a Mica/);
  assert.match(imagens[0].legenda, /1.*Suporte/, 'o menu vai junto na legenda');
  assert.match(imagens[0].dataUri, /^data:image\/png;base64,/);
  assert.equal(textos.length, 0, 'texto separado seria o segundo balao');
  assert.equal(r.respondeu, true);
});

test('texto maior que a legenda do WhatsApp: foto e, logo depois, o texto', async () => {
  fluxoComFoto('x'.repeat(atendimento.LEGENDA_MAX + 50));
  const textos = []; const imagens = [];
  await atendimento.receberMensagem({ id: 'i2', de: '5531900000602', texto: 'oi', tipo: 'texto' }, {
    enviar: async ({ texto }) => { textos.push(texto); return { ok: true }; },
    enviarImagem: async (e) => { imagens.push(e); return { ok: true }; },
  });
  assert.equal(imagens.length, 1);
  assert.equal(imagens[0].legenda, '', 'legenda cortada no meio seria pior');
  assert.equal(textos.length, 1);
});

test('foto que nao sai ou nao existe: o texto sai do mesmo jeito', async () => {
  fluxoComFoto('Oi! Escolha:');
  const textos = [];
  await atendimento.receberMensagem({ id: 'i3', de: '5531900000603', texto: 'oi', tipo: 'texto' }, {
    enviar: async ({ texto }) => { textos.push(texto); return { ok: true }; },
    enviarImagem: async () => ({ ok: false, erro: 'canal caiu' }),
  });
  assert.equal(textos.length, 1, 'foto e enfeite: a resposta nao depende dela');

  bot.salvarFluxo([{ id: 'inicio', mensagem: 'Oi!', imagem: 'nao-existe.jpg', acao: 'fim' }]);
  const t2 = [];
  let chamouImagem = false;
  await atendimento.receberMensagem({ id: 'i4', de: '5531900000604', texto: 'oi', tipo: 'texto' }, {
    enviar: async ({ texto }) => { t2.push(texto); return { ok: true }; },
    enviarImagem: async () => { chamouImagem = true; return { ok: true }; },
  });
  assert.equal(chamouImagem, false);
  assert.equal(t2.length, 1);
});
