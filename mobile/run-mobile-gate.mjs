#!/usr/bin/env node
/**
 * QA-GATE MOBILE (Flutter) — prova de funcional no APARELHO REAL via USB (adb).
 *
 * Fecha a lacuna do gate de browser (inviável no Flutter) e do emulador (não boota /
 * "passou no emulador, quebrou no celular"). Roda determinístico e grava recibo verde.
 *
 * Camadas (cada uma pega uma classe de bug de device):
 *   1) flutter analyze            -> erros estáticos
 *   2) flutter build apk --release-> quebra SÓ no release (R8/proguard/obfuscação/tree-shake)
 *   3) integration_test NO DEVICE -> runtime real (Reverb/websocket, permissão, câmera, path, render)
 *
 * Uso:
 *   node run-mobile-gate.mjs --repo <path> [--flavor dev] [--target lib/main.dart]
 *                            [--test integration_test] [--build release|debug|skip]
 *                            [--device <serial>] [--analyze on|off]
 *
 * Sem device autorizado plugado -> AMARELO (não grava recibo de device; só build/analyze).
 * Recibo verde: <repo>/.git/qa-gate-green-mobile.json  { status, branch, ts, device, steps }
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function arg(name, def = null) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const REPO = arg('repo');
const FLAVOR = arg('flavor');
const TARGET = arg('target');
const TESTPATH = arg('test', 'integration_test');
const BUILD = arg('build', 'release');   // release | debug | skip
const ANALYZE = arg('analyze', 'on');
let DEVICE = arg('device');

if (!REPO || !existsSync(REPO)) { fail(`--repo inválido: ${REPO}`); }
if (!existsSync(join(REPO, 'pubspec.yaml'))) { fail(`${REPO} não é projeto Flutter (sem pubspec.yaml)`); }

function fail(msg) { console.error('[mobile-gate] ERRO: ' + msg); process.exit(2); }
function sh(cmd, opts = {}) { return execSync(cmd, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }); }
function findAdb() {
  const cands = [process.env.ANDROID_HOME, process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android/Sdk')]
    .filter(Boolean).map((b) => join(b, 'platform-tools', 'adb.exe'));
  for (const c of cands) { if (existsSync(c)) { return c; } }
  return 'adb';
}
function findFlutter() {
  for (const c of ['C:/flutter/bin/flutter.bat', 'C:/flutter/bin/flutter', 'flutter']) {
    try { execSync(`"${c}" --version`, { stdio: 'ignore' }); return c; } catch {}
  }
  return 'flutter';
}
const ADB = findAdb();
const FLUTTER = findFlutter();

function devices() {
  try {
    return sh(`"${ADB}" devices`).split(/\r?\n/).slice(1)
      .map((l) => l.trim()).filter(Boolean)
      .map((l) => { const [serial, state] = l.split(/\s+/); return { serial, state }; })
      .filter((d) => d.serial);
  } catch { return []; }
}

const steps = [];
function step(name, ok, detail = '') { steps.push({ name, ok, detail }); console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ' — ' + detail : ''}`); }

let branch = '';
try { branch = sh('git rev-parse --abbrev-ref HEAD').trim(); } catch {}

// 1) analyze
if (ANALYZE === 'on') {
  try { sh(`"${FLUTTER}" analyze --no-fatal-infos`); step('flutter analyze', true); }
  catch (e) { step('flutter analyze', false, (e.stdout || e.message || '').split(/\r?\n/).filter((l) => /error/i.test(l)).slice(0, 5).join(' | ')); finish('red'); }
}

// device check
const devs = devices();
const authed = devs.filter((d) => d.state === 'device');
const chosen = DEVICE || (authed[0] && authed[0].serial);
if (devs.some((d) => d.state === 'unauthorized')) { step('device autorizado', false, 'device UNAUTHORIZED — aceite o popup de depuração USB no celular'); }

// 2) build release (pega release-only)
if (BUILD !== 'skip') {
  const flavorArg = FLAVOR ? ` --flavor ${FLAVOR}` : '';
  const targetArg = TARGET ? ` --target ${TARGET}` : '';
  try {
    console.log(`[mobile-gate] flutter build apk --${BUILD}${flavorArg}${targetArg} (pode demorar)...`);
    sh(`"${FLUTTER}" build apk --${BUILD}${flavorArg}${targetArg}`, { stdio: ['ignore', 'inherit', 'pipe'] });
    step(`flutter build apk --${BUILD}`, true);
  } catch (e) { step(`flutter build apk --${BUILD}`, false, 'build falhou (veja o log acima)'); finish('red'); }
}

// 3) integration_test no device real
if (!chosen) {
  step('integration_test no device', false, 'nenhum device autorizado plugado');
  finish('yellow'); // amarelo: build ok, mas sem prova de device
}
if (!existsSync(join(REPO, TESTPATH))) {
  step('integration_test no device', false, `pasta ${TESTPATH} não existe — escreva os testes de fluxo (login/chat/export/câmera)`);
  finish('yellow');
}
try {
  const flavorArg = FLAVOR ? ` --flavor ${FLAVOR}` : '';
  const targetArg = TARGET ? ` --target ${TARGET}` : '';
  console.log(`[mobile-gate] flutter test ${TESTPATH} -d ${chosen} (no aparelho real)...`);
  sh(`"${FLUTTER}" test ${TESTPATH} -d ${chosen}${flavorArg}${targetArg}`, { stdio: ['ignore', 'inherit', 'pipe'] });
  step('integration_test no device', true, chosen);
} catch (e) { step('integration_test no device', false, 'testes falharam NO APARELHO (veja o log)'); finish('red'); }

finish('green');

function finish(status) {
  const summary = { status, branch, device: chosen || null, steps, ts: Date.now() };
  if (status === 'green') {
    try { writeFileSync(join(REPO, '.git', 'qa-gate-green-mobile.json'), JSON.stringify(summary)); } catch {}
  }
  console.log('\n[mobile-gate] RESULTADO: ' + status.toUpperCase());
  console.log(JSON.stringify(summary));
  process.exit(status === 'green' ? 0 : (status === 'yellow' ? 1 : 3));
}
