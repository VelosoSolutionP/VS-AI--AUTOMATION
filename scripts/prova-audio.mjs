#!/usr/bin/env node
/**
 * Prova do ÁUDIO: o cliente manda mensagem de voz e o bot responde pelo que foi
 * FALADO — de ponta a ponta, com o whisper local de verdade.
 *
 * Instância ISOLADA do painel (pasta temporária, só 127.0.0.1) ligada no
 * Telegram FALSO do teste de volume, que agora aceita voz (getFile + download).
 * O servidor de transcrição tem de estar de pé: backend/subir-transcricao.sh.
 *
 * Uso: node scripts/prova-audio.mjs <pasta com audio-peca.ogg e audio-vendedor.ogg>
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PASTA = process.argv[2];
if (!PASTA || !existsSync(join(PASTA, 'audio-peca.ogg'))) { console.error('uso: node scripts/prova-audio.mjs <pasta com audio-peca.ogg e audio-vendedor.ogg>'); process.exit(2); }
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const filhos = []; const limpar = () => { for (const p of filhos) { try { p.kill('SIGTERM'); } catch { /* saiu */ } } };
process.on('exit', limpar);
const R = []; const ok = (nome, cond, det = '') => { R.push(!!cond); console.log(`${cond ? '  PASSOU' : '  FALHOU'}  ${nome}${det ? ' — ' + det : ''}`); };

const saude = await fetch('http://127.0.0.1:8178/').then((r) => r.status < 500).catch(() => false);
ok('servidor de transcrição (whisper local) no ar em 127.0.0.1:8178', saude);
if (!saude) { process.exit(1); }

const arq = join(tmpdir(), `tg-falso-audio-${process.pid}.json`);
filhos.push(spawn(process.execPath, [join(RAIZ, 'scripts/teste-volume-telegram.mjs'), '--servir-telegram-falso', arq], { stdio: 'ignore' }));
for (let i = 0; i < 50 && !existsSync(arq); i++) { await espera(100); }
const TG = JSON.parse(readFileSync(arq, 'utf8')).url; rmSync(arq, { force: true });
const tg = async (m, corpo) => (await (await fetch(`${TG}/bot/${m}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo || {}) })).json()).result;

const casa = mkdtempSync(join(tmpdir(), 'bolso-audio-'));
process.env.VS_HOME = casa;
const bot = await import(join(RAIZ, 'engine/vsbot/index.mjs'));
const crm = await import(join(RAIZ, 'engine/vscrm/index.mjs'));
const acesso = await import(join(RAIZ, 'backend/acesso.mjs'));
crm.setFunil(['Novo lead', 'Em atendimento', 'Fechado']);
bot.salvarConfig({ ativo: true, nome: 'Bia', falhasAteHumano: 3 });
bot.salvarRegra({ id: 'a-peca', termos: ['peca', 'correia', 'colheitadeira'], resposta: 'Temos sim! Me passa o modelo da colheitadeira que eu confiro a correia pra você.' });
bot.salvarRegra({ id: 'a-gente', termos: ['vendedor'], resposta: 'Já chamei um vendedor pra falar do adubo com você!', handoff: true, prioridade: 5 });
acesso.criar(randomBytes(18).toString('base64url'));
const tok = randomBytes(24).toString('base64url');
mkdirSync(join(casa, 'console'), { recursive: true });
writeFileSync(join(casa, 'console', 'sessoes.json'), JSON.stringify({ [createHash('sha256').update(tok).digest('hex')]: { email: 'admin@prova', papel: 'admin', clienteId: null, criada: new Date().toISOString(), expira: new Date(Date.now() + 3600e3).toISOString() } }));

const porta = 19700 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${porta}`;
const log = join(casa, 'painel.log');
filhos.push(spawn(process.execPath, [join(RAIZ, 'backend/server.mjs')], { cwd: RAIZ, stdio: ['ignore', openSync(log, 'a'), openSync(log, 'a')],
  env: { PATH: process.env.PATH, HOME: casa, VS_HOME: casa, PORT: String(porta), HOST: '127.0.0.1', CRM_ENABLED: '1', TELEGRAM_API_URL: TG, RATE_CRM: '1000000', PAINEL_URL: base } }));
for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) { break; } } catch { /* subindo */ } await espera(250); }
const api = async (rota, corpo) => (await (await fetch(`${base}/crm/api/${rota}`, { method: corpo ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-crm-token': tok }, body: corpo ? JSON.stringify(corpo) : undefined })).json());
ok('painel isolado conectou no Telegram falso', (await api('canais/conectar', { canal: 'telegram', token: '123456789:AAHprovaAudio0000000000000000000000' })).ok);

async function falar(chat, nome, arquivo, esperado, rotulo) {
  const t0 = Date.now();
  await tg('_escreverAudio', { chat, nome, base64: readFileSync(join(PASTA, arquivo)).toString('base64') });
  let resp = null;
  for (let i = 0; i < 120 && !resp; i++) { await espera(500); resp = (await tg('_enviados')).find((e) => e.chat === String(chat)); }
  ok(`${rotulo}: o bot respondeu pelo que foi falado`, resp && esperado.test(resp.texto), resp ? `"${resp.texto.slice(0, 80)}" em ${((Date.now() - t0) / 1000).toFixed(1)} s` : 'sem resposta em 60 s');
  return resp;
}
await falar(830000001, 'Seu Antônio', 'audio-peca.ogg', /modelo da colheitadeira/, 'áudio "preciso de peça pra colheitadeira"');
await falar(830000002, 'Dona Cida', 'audio-vendedor.ogg', /Já chamei um vendedor/, 'áudio "quero falar com um vendedor sobre o adubo"');

const at = await api('atendimentos');
const cida = (at.conversas || []).find((c) => c.telefone === '999000830000002');
ok('quem pediu vendedor por áudio foi pra fila da equipe', cida?.situacao === 'aguardando', cida?.situacao);
const hist = (cida?.historico || []).find((h) => h.tipo === 'interacao' && h.direcao === 'entrada');
ok('a conversa guarda o que o cliente FALOU (texto transcrito)', /vendedor/i.test(hist?.texto || '') && /adubo/i.test(hist?.texto || ''), hist?.texto);
const txt = readFileSync(log, 'utf8');
ok('log registra a transcrição', /\[transcricao\] áudio de/.test(txt));
ok('sem erro no servidor', !/TypeError|ReferenceError|quebrou|Unhandled/.test(txt));
console.log('\n  log:\n' + txt.split('\n').filter((l) => /transcricao/.test(l)).map((l) => '    ' + l.slice(20)).join('\n'));
limpar(); rmSync(casa, { recursive: true, force: true });
const f = R.filter((x) => !x).length;
console.log(`\n${f ? '✗ ' + f + ' de ' + R.length + ' falharam' : '✓ ' + R.length + '/' + R.length + ' verificações passaram'}`);
process.exit(f ? 1 : 0);
