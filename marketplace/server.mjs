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

/**
 * Rotas abertas. O fluxo do CLIENTE é público de proposito: o requisito diz que
 * ninguem paga — nem faz conta — para PROCURAR. Exigir login na home mataria a
 * conversao logo na entrada. Area do prestador e admin continuam protegidas.
 */
const PUBLICAS = [
  '/api/login', '/api/categorias', '/api/saude', '/api/estado',
  '/api/pedidos', '/api/propostas-do-pedido', '/api/escolher', '/api/aviso-escolha',
  '/api/aceite', '/api/aceitar', '/api/escopo', '/api/escopo/aceitar', '/api/pagar',
  '/api/os', '/api/os/mover', '/api/avaliar', '/api/contestar', '/api/buscar-publico',
];

const server = createServer(async (req, res) => {
  const rota = req.url.split('?')[0];
  const ip = ipDe(req);

  if (rota === '/api/saude') { return json(res, 200, { ok: true, servico: 'quebra-galho' }); }

  // Favicon inline: o browser pede sempre, e sem isso todo carregamento deixa um
  // 404 no console — ruido que esconde erro de verdade.
  if (rota === '/favicon.ico' || rota === '/favicon.svg') {
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public,max-age=86400' });
    return res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
      + '<rect width="64" height="64" rx="14" fill="#F4511E"/>'
      + '<text x="32" y="43" font-family="system-ui,sans-serif" font-size="28" font-weight="800"'
      + ' fill="#fff" text-anchor="middle">QG</text></svg>');
  }

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
      if (rota === '/api/estado') { return json(res, 200, vs.estado()); }
      if (rota === '/api/numeros') { return json(res, 200, vs.fluxo.numeros()); }
      if (rota === '/api/propostas-do-pedido') {
        const id = new URL(req.url, 'http://x').searchParams.get('pedido');
        const r = vs.fluxo.propostasDoPedido(id, vs.prestadores());
        return json(res, r.ok ? 200 : 404, r.ok ? r : { erro: r.erro });
      }
      if (rota === '/api/aviso-escolha') {
        const q = new URL(req.url, 'http://x').searchParams;
        return json(res, 200, { aviso: vs.fluxo.avisoDaEscolha(q.get('pedido'), q.get('proposta'), vs.prestadores()) });
      }
      if (rota === '/api/aceite') {
        const id = new URL(req.url, 'http://x').searchParams.get('proposta');
        const r = vs.fluxo.estadoAceite(id, vs.prestadores());
        return json(res, r.ok ? 200 : 404, r);
      }
      if (rota === '/api/os') {
        const id = new URL(req.url, 'http://x').searchParams.get('id');
        const r = vs.fluxo.ordemCompleta(id);
        return json(res, r.ok ? 200 : 404, r.ok ? r : { erro: r.erro });
      }
      if (rota === '/api/oportunidades') {
        // Pedidos em que ESTE prestador foi convidado.
        const meu = new URL(req.url, 'http://x').searchParams.get('prestador');
        const meus = vs.fluxo.pedidos().filter((p) => ['MATCHING', 'RECEIVING_QUOTES'].includes(p.status)
          && p.convidados.some((c) => c.prestadorId === meu));
        const jaPropus = vs.fluxo.propostas().filter((x) => x.prestadorId === meu).map((x) => x.pedidoId);
        return json(res, 200, {
          oportunidades: meus.map((p) => ({ ...vs.fluxo.ped.resumo(p), jaPropus: jaPropus.includes(p.id),
            distanciaKm: p.convidados.find((c) => c.prestadorId === meu)?.distanciaKm ?? null })),
        });
      }
      if (rota === '/api/ganhos') {
        const meu = new URL(req.url, 'http://x').searchParams.get('prestador');
        return json(res, 200, vs.fluxo.ganhosDoPrestador(meu));
      }
      if (rota === '/api/minhas-os') {
        const q = new URL(req.url, 'http://x').searchParams;
        const campo = q.get('prestador') ? 'prestadorId' : 'clienteId';
        const alvo = q.get('prestador') || q.get('cliente');
        return json(res, 200, { ordens: vs.fluxo.ordens().filter((o) => o[campo] === alvo) });
      }
      if (rota === '/api/admin') {
        const a = vs.ident.autorizado(sessao.sessao, { papeis: ['admin', 'suporte'] });
        if (!a.ok) { return json(res, 403, { erro: a.motivo }); }
        return json(res, 200, {
          numeros: vs.fluxo.numeros(),
          pedidos: vs.fluxo.pedidos().map(vs.fluxo.ped.resumo),
          ordens: vs.fluxo.ordens(),
          pagamentos: vs.fluxo.pagamentos(),
          disputas: vs.fluxo.disputas(),
          avaliacoes: vs.fluxo.avaliacoes(),
          prestadores: vs.prestadores().map(vs.cad.prestadorPublico),
          clientes: vs.clientes(),
        });
      }
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
      if (rota === '/api/pedidos') {
        const r = vs.fluxo.criarPedido(d, vs.prestadores());
        if (!r.ok) { return json(res, 400, { erro: r.erros.join('; '), erros: r.erros, avisos: r.avisos }); }
        // Em demonstracao os convidados respondem na hora, pelo mesmo caminho validado.
        // Com VSMARKET_DEMO=0 o pedido fica esperando proposta de gente de verdade.
        if (process.env.VSMARKET_DEMO !== '0') { vs.fluxo.simularPropostas(r.pedido.id, vs.prestadores(), vs.categorias()); }
        return json(res, 200, r);
      }
      if (rota === '/api/propostas') {
        const r = vs.fluxo.enviarProposta(d);
        return json(res, r.ok ? 200 : 400, r.ok ? r : { erro: r.erros.join('; ') });
      }
      if (rota === '/api/escolher') {
        const r = vs.fluxo.escolherProposta(d.propostaId, vs.prestadores());
        return json(res, r.ok ? 200 : 400, r);
      }
      if (rota === '/api/aceitar') {
        const r = vs.fluxo.aceitarProposta(d.propostaId);
        return json(res, r.ok ? 200 : 400, r);
      }
      if (rota === '/api/escopo') {
        const r = vs.fluxo.congelarEscopo(d.propostaId);
        return json(res, r.ok ? 200 : 400, r.ok ? r : { erro: r.erros.join('; ') });
      }
      if (rota === '/api/escopo/aceitar') {
        const r = vs.fluxo.aceitarEscopo(d.escopoId, d.quem);
        return json(res, r.ok ? 200 : 400, r);
      }
      if (rota === '/api/pagar') {
        const r = vs.fluxo.pagar(d.escopoId, d);
        return json(res, r.ok ? 200 : 400, r);
      }
      if (rota === '/api/os/mover') {
        const r = vs.fluxo.moverOrdem(d.ordemId, d.status, { nota: d.nota, por: ator });
        return json(res, r.ok ? 200 : 400, r);
      }
      if (rota === '/api/avaliar') {
        const r = vs.fluxo.avaliar(d);
        return json(res, r.ok ? 200 : 400, r.ok ? r : { erro: r.erros.join('; ') });
      }
      if (rota === '/api/contestar') {
        const r = vs.fluxo.contestar(d);
        return json(res, r.ok ? 200 : 400, r.ok ? r : { erro: r.erros.join('; ') });
      }
      if (rota === '/api/disputas/resolver') {
        const a = vs.ident.autorizado(sessao.sessao, { papeis: ['admin', 'analista_disputa'] });
        if (!a.ok) { return json(res, 403, { erro: a.motivo }); }
        const r = vs.fluxo.resolverDisputa(d.disputaId, { ...d, responsavel: ator });
        return json(res, r.ok ? 200 : 400, r);
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
// Sem dado nenhum o fluxo nao pode ser percorrido — e produto que nao se percorre
// nao se avalia. O seed passa pelo caminho REAL de cadastro e validacao.
const semeado = vs.semear();
if (!semeado.ok) { console.error('[vsmarket] seed falhou em', semeado.em, '->', (semeado.erros || []).join('; ')); }
else if (!semeado.jaExistia) {
  console.log(`[vsmarket] demonstracao: ${semeado.prestadores} profissionais, 1 pedido com propostas`);
  // Um login de PROFISSIONAL, senao a area do prestador nao tem como ser percorrida:
  // os prestadores sao cadastro, nao conta de acesso.
  const primeiro = vs.prestadores().find((x) => x.status === 'ACTIVE');
  if (primeiro && !vs.usuarios().some((u) => u.papel === 'prestador')) {
    const senha = randomBytes(12).toString('base64url');
    const email = 'profissional@quebragalho.local';
    const r = vs.criarUsuario({ email, nome: primeiro.nome, papel: 'prestador', senha }, 'bootstrap');
    if (r.ok) {
      // Amarra a conta ao cadastro: o app precisa saber QUAL profissional entrou.
      vs.editarPrestador(primeiro.id, { usuarioId: r.usuario.id }, 'bootstrap');
      console.log('  ┌─ ACESSO DO PROFISSIONAL (demonstracao) ───────');
      console.log(`  │  e-mail: ${email}`);
      console.log(`  │  senha : ${senha}`);
      console.log(`  │  perfil: ${primeiro.nome}`);
      console.log('  └───────────────────────────────────────────────\n');
    } else { console.error('[vsmarket] nao criei o usuario do profissional:', r.erros.join('; ')); }
  }
}
server.listen(PORT, () => console.log(`[vsmarket] no ar em http://127.0.0.1:${PORT}  (independente do Bolso Cheio)`));
