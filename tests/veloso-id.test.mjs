/** Veloso ID no ZEST: o contrato com o Portal e quem pode entrar por ele. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'veloso-id-'));
process.env.VSUSUARIOS_DIR = dir;
process.env.VSCONSOLE_ACESSO = join(dir, 'acesso.json');
process.env.CONSOLE_ADMIN_EMAIL = 'dono@exemplo.com';
Object.assign(process.env, { VELOSO_ID_PORTAL_WEB: 'https://portal.test/', VELOSO_ID_PORTAL_API: 'https://api.test', VELOSO_ID_RAIZ: 'raiz-de-teste', VELOSO_ID_RETORNO: 'https://zest.test/crm' });
const V = await import('../backend/veloso-id.mjs');
const U = await import('../backend/usuarios.mjs');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const portalFalso = (corpo, ok = true) => { const c = []; globalThis.fetch = async (url, o) => { c.push({ url, o, corpo: JSON.parse(o.body) }); return { ok, json: async () => corpo }; }; return c; };

test('sem as variáveis fica desligado e a senha continua', () => {
  const raiz = process.env.VELOSO_ID_RAIZ; process.env.VELOSO_ID_SENHA = '0'; delete process.env.VELOSO_ID_RAIZ;
  assert.equal(V.ativo(), false); assert.equal(V.senhaAtiva(), true);
  process.env.VELOSO_ID_RAIZ = raiz; assert.equal(V.senhaAtiva(), false); delete process.env.VELOSO_ID_SENHA;
});

test('a credencial é a mesma que o Portal deriva: HMAC de ZEST:dia de Brasília', () => {
  const instante = new Date('2026-11-09T02:30:00Z'); /* em Brasília ainda é dia 8 */
  assert.equal(V.credencial('r', 'ZEST', instante), createHmac('sha256', 'r').update('ZEST:2026-11-08').digest('base64url'));
});

test('resgata com PKCE e devolve e-mail e handle', async () => {
  const { url, nonce } = V.iniciar(); const q = new URL(url).searchParams;
  assert.ok(url.startsWith('https://portal.test/veloso-id?')); assert.equal(q.get('client_id'), 'ZEST'); assert.equal(q.get('redirect_uri'), 'https://zest.test/crm');
  const c = portalFalso({ sessionHandle: 'h1', person: { email: 'Maria@Loja.com' } });
  assert.deepEqual(await V.resgatar('cod', q.get('state'), nonce), { email: 'maria@loja.com', handle: 'h1' });
  assert.equal(c[0].url, 'https://api.test/api/v1/identity/apps/redeem');
  assert.equal(createHash('sha256').update(c[0].corpo.codeVerifier).digest('base64url'), q.get('code_challenge'));
  assert.equal(c[0].o.headers['x-veloso-client'], 'ZEST');
});

test('nonce ou estado errado nem chega ao Portal', async () => {
  const { url, nonce } = V.iniciar(); const state = new URL(url).searchParams.get('state');
  const c = portalFalso({ sessionHandle: 'h', person: { email: 'a@b.c' } });
  assert.equal(await V.resgatar('cod', state, 'outro-nonce'), null);
  assert.equal(await V.resgatar('cod', `${state}x`, nonce), null);
  assert.equal(c.length, 0);
});

test('autorização recusada pelo Portal não abre sessão', async () => {
  const { url, nonce } = V.iniciar(); portalFalso({}, false);
  assert.equal(await V.resgatar('cod', new URL(url).searchParams.get('state'), nonce), null);
});

test('sessão: bloqueio no Portal derruba; Portal fora do ar não derruba', async () => {
  portalFalso({ active: false }); assert.equal(await V.sessaoValida('bloqueada'), false);
  globalThis.fetch = async () => { throw new Error('fora'); }; assert.equal(await V.sessaoValida('nova'), true);
});

test('entra só quem é cliente ou empresa; dono e desconhecido não', () => {
  const c = U.convidar({ email: 'cli@loja.com', clienteId: 'c1', nome: 'Cli' }); U.aceitarConvite(c.token, 'senha-do-cliente');
  const r = U.entrarPeloVelosoId('CLI@loja.com', 'hX');
  assert.equal(r.ok, true); assert.equal(r.papel, 'cliente'); assert.equal(r.velosoHandle, undefined);
  assert.equal(U.autenticar(r.token).velosoHandle, 'hX');
  assert.equal(U.entrarPeloVelosoId('dono@exemplo.com', 'h').ok, false);
  assert.equal(U.entrarPeloVelosoId('ninguem@x.com', 'h').ok, false);
  assert.equal(U.entraSoPeloPortal('cli@loja.com'), true);
  assert.equal(U.entraSoPeloPortal('dono@exemplo.com'), false);
});
