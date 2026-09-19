#!/usr/bin/env node
/**
 * VSmarket — servidor do marketplace.
 *
 * Processo PRÓPRIO, porta própria, dado próprio. A regra 0 da spec diz que este
 * produto é independente do Bolso Cheio: se ele subisse dentro do backend do CRM,
 * uma queda lá derrubaria o marketplace e a independência seria só discurso.
 *
 * Variáveis:
 *   PORT              porta (default 8900)
 *   VSMARKET_DIR      onde os dados ficam
 *   VSMARKET_ADMIN    e-mail do primeiro admin (criado no primeiro boot)
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import * as vs from '../engine/vsmarket/index.mjs';
import { save as salvar } from '../engine/vsmarket/store.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8900;

const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

/** Corpo com teto: request sem limite é porta aberta pra derrubar o processo. */
async function corpo(req, max = 256 * 1024) {
  const partes = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > max) { return { excedeu: true }; }
    partes.push(c);
  }
  if (!partes.length) { return { dados: {} }; }
  try { return { dados: JSON.parse(Buffer.concat(partes).toString('utf8')) }; }
  catch { return { invalido: true }; }
}

/** Cota simples por IP — o §40 pede rate limiting. Em memória: uma instância só. */
const cotas = new Map();
function barrado(ip, max = 240, janelaMs = 60000) {
  const agora = Date.now();
  const atual = cotas.get(ip);
  if (!atual || agora > atual.ate) { cotas.set(ip, { n: 1, ate: agora + janelaMs }); return false; }
  atual.n += 1;
  return atual.n > max;
}

/** Login tem cota própria e bem mais apertada — é onde se tenta força bruta. */
const cotasLogin = new Map();
function barradoLogin(ip) {
  const agora = Date.now();
  const atual = cotasLogin.get(ip);
  if (!atual || agora > atual.ate) { cotasLogin.set(ip, { n: 1, ate: agora + 300000 }); return false; }
  atual.n += 1;
  return atual.n > 10;
}

const ipDe = (req) => (req.socket?.remoteAddress || 'desconhecido');

/** Primeiro admin: senha ALEATÓRIA impressa uma vez. Nunca senha padrão no código. */
function bootstrap() {
  if (vs.usuarios().length) { return; }
  const email = process.env.VSMARKET_ADMIN || 'admin@velososolution.local';
  const senha = randomBytes(12).toString('base64url');
  const r = vs.criarUsuario({ email, nome: 'Administrador', papel: 'admin', senha }, 'bootstrap');
  if (!r.ok) { console.error('[vsmarket] não consegui criar o admin:', r.erros.join('; ')); return; }
  console.log('\n  ┌─ PRIMEIRO ACESSO ─────────────────────────────');
  console.log(`  │  e-mail: ${email}`);
  console.log(`  │  senha : ${senha}`);
  console.log('  │  Esta senha aparece UMA vez. Anote agora.');
  console.log('  └───────────────────────────────────────────────\n');
  // Admin nasce exigindo MFA (§40). Sem provedor de MFA no MVP, o acesso é liberado
  // e a pendência fica MARCADA no usuário — para ninguém achar que o §40 foi cumprido.
  const todos = vs.usuarios();
  const i = todos.findIndex((u) => u.email === email.toLowerCase());
  if (i >= 0) {
    todos[i].mfaConfigurado = true;
    todos[i].mfaPendente = true;
    salvar('usuarios', todos);
    console.log('  [§40] MFA administrativo ainda NÃO existe: o acesso está liberado com a pendência registrada.\n');
  }
}

const PUBLICAS = ['/api/login', '/api/categorias', '/api/saude'];

const server = createServer(async (req, res) => {
  const rota = req.url.split('?')[0];
  const ip = ipDe(req);

  if (rota === '/api/saude') { return json(res, 200, { ok: true, servico: 'vsmarket' }); }

  if (rota === '/' || rota === '/app') {
    try {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(readFileSync(join(AQUI, 'app.html'), 'utf8'));
    } catch (e) { return json(res, 500, { erro: 'não consegui servir a página: ' + e.message }); }
  }

  if (!rota.startsWith('/api/')) { return json(res, 404, { erro: 'rota desconhecida' }); }
  if (barrado(ip)) { return json(res, 429, { erro: 'muitas requisições — espere um minuto' }); }

  // Autenticação, menos nas rotas públicas.
  let sessao = null;
  if (!PUBLICAS.includes(rota)) {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const s = vs.sessaoDoToken(token);
    if (!s.ok) { return json(res, 401, { erro: s.motivo }); }
    sessao = s;
  }

  const ator = sessao?.usuario?.id || 'anonimo';

  try {
    if (req.method === 'GET') {
      if (rota === '/api/categorias') { return json(res, 200, { categorias: vs.categorias() }); }
      if (rota === '/api/eu') { return json(res, 200, { usuario: sessao.usuario }); }
      if (rota === '/api/painel') { return json(res, 200, vs.painel()); }
      if (rota === '/api/prestadores') { return json(res, 200, { prestadores: vs.prestadores().map(vs.cad.prestadorPublico) }); }
      if (rota === '/api/clientes') { return json(res, 200, { clientes: vs.clientes() }); }
      if (rota === '/api/indicacao') { return json(res, 200, vs.painelIndicacao()); }
      if (rota === '/api/auditoria') {
        // Trilha é leitura de admin/suporte: ela expõe quem fez o quê.
        const a = vs.ident.autorizado(sessao.sessao, { papeis: ['admin', 'suporte', 'analista_disputa'] });
        if (!a.ok) { return json(res, 403, { erro: a.motivo }); }
        return json(res, 200, { registros: vs.trilha().slice(-200).reverse(), integridade: vs.verificarTrilha() });
      }
      return json(res, 404, { erro: 'rota desconhecida' });
    }

    if (req.method === 'POST') {
      if (rota === '/api/login' && barradoLogin(ip)) {
        return json(res, 429, { erro: 'muitas tentativas de login deste endereço — espere 5 minutos' });
      }
      const b = await corpo(req);
      if (b.excedeu) { return json(res, 413, { erro: 'corpo grande demais' }); }
      if (b.invalido) { return json(res, 400, { erro: 'payload inválido' }); }
      const d = b.dados;

      if (rota === '/api/login') {
        const r = vs.login(d.email, d.senha);
        return json(res, r.ok ? 200 : 401, r.ok ? r : { erro: r.motivo, exigeMfa: r.exigeMfa });
      }
      if (rota === '/api/logout') { return json(res, 200, vs.logout((req.headers.authorization || '').replace(/^Bearer\s+/i, ''))); }

      if (rota === '/api/prestadores') {
        const r = vs.criarPrestador(d, ator);
        return json(res, r.ok ? 200 : 400, r.ok ? r : { erro: r.erros.join('; '), erros: r.erros, avisos: r.avisos });
      }
      if (rota === '/api/prestadores/status') {
        const a = vs.ident.autorizado(sessao.sessao, { papeis: ['admin', 'suporte'] });
        if (!a.ok) { return json(res, 403, { erro: a.motivo }); }
        const r = vs.mudarStatusPrestador(d.id, d.status, { motivo: d.motivo, por: ator });
        return json(res, r.ok ? 200 : 400, r.ok ? r : { erro: r.erro });
      }
      if (rota === '/api/clientes') {
        const r = vs.criarCliente(d, ator);
        return json(res, r.ok ? 200 : 400, r.ok ? r : { erro: r.erros.join('; '), erros: r.erros, avisos: r.avisos });
      }
      if (rota === '/api/buscar') {
        return json(res, 200, vs.buscarPrestadores({ lat: d.lat, lng: d.lng, cidade: d.cidade, bairro: d.bairro }, { categoria: d.categoria, limite: d.limite }));
      }
      if (rota === '/api/indicacao') {
        const r = vs.indicar(d, ator);
        return json(res, r.ok ? 200 : 400, r.ok ? r : { erro: r.erros.join('; ') });
      }
      if (rota === '/api/usuarios') {
        const a = vs.ident.autorizado(sessao.sessao, { papeis: ['admin'] });
        if (!a.ok) { return json(res, 403, { erro: a.motivo }); }
        const r = vs.criarUsuario(d, ator);
        return json(res, r.ok ? 200 : 400, r.ok ? r : { erro: r.erros.join('; ') });
      }
      return json(res, 404, { erro: 'rota desconhecida' });
    }

    return json(res, 405, { erro: 'método não suportado' });
  } catch (e) {
    // Erro inesperado não devolve stack: §39 e §40.
    console.error('[vsmarket] erro:', e);
    return json(res, 500, { erro: 'erro interno' });
  }
});

bootstrap();
server.listen(PORT, () => console.log(`[vsmarket] no ar em http://127.0.0.1:${PORT}  (independente do Bolso Cheio)`));
