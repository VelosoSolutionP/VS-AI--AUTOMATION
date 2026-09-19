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
import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as vs from '../engine/vsmarket/index.mjs';
import { save as salvar } from '../engine/vsmarket/store.mjs';
import { criarSimulado } from './gateway-simulado.mjs';
import { criarAsaas } from './gateway-asaas.mjs';
import * as seo from './seo.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8900;

/**
 * O provedor de pagamento é escolhido na partida e injetado no fluxo. Com
 * ASAAS_API_KEY no ambiente, cobra de verdade; sem ela, o simulado assume — e o
 * painel DIZ qual está em uso, para ninguém achar que cobrou quando não cobrou.
 */
const GATEWAY = process.env.ASAAS_API_KEY
  ? criarAsaas({
      apiKey: process.env.ASAAS_API_KEY,
      ambiente: process.env.ASAAS_AMBIENTE || 'sandbox',
      webhookToken: process.env.ASAAS_WEBHOOK_TOKEN,
    })
  : criarSimulado();

/**
 * Token de integracao servico-a-servico. O painel do Bolso Cheio le AGREGADOS daqui
 * (GMV, contagens) e nada mais: nome, telefone e endereco de cliente NAO atravessam
 * a fronteira entre produtos sem base legal e consentimento (§31, §39).
 */
const QG_INTEGRACAO_TOKEN = process.env.QG_INTEGRACAO_TOKEN || '';

/** Comissão configurável. Sem variável, cai na hipótese comercial de 80%. */
const PCT_PRESTADOR = Number(process.env.QG_PERCENTUAL_PRESTADOR || 80);

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

/** Comparacao em tempo constante — tamanho diferente ja e resposta negativa. */
function tokenIgual(recebido, esperado) {
  const a = Buffer.from(String(recebido || ''), 'utf8');
  const b = Buffer.from(String(esperado || ''), 'utf8');
  if (!b.length || a.length !== b.length) { return false; }
  return timingSafeEqual(a, b);
}

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
  '/api/pagamento-config', '/api/liquidar', '/api/cadastrar-profissional',
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

  /* ---- páginas públicas indexáveis (§SEO) ---- */
  const origem = `http://${req.headers.host || '127.0.0.1:' + PORT}`;
  if (rota === '/robots.txt') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end(seo.robots(origem));
  }
  if (rota === '/sitemap.xml') {
    res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
    return res.end(seo.sitemap(vs.categorias(), origem));
  }
  if (rota.startsWith('/servicos/')) {
    const [, , catSlug, cidSlug] = rota.split('/');
    const categoria = seo.acharCategoria(vs.categorias(), catSlug || '');
    const cidade = seo.acharCidade(cidSlug || '');
    if (!categoria || !cidade) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><meta charset=utf-8><title>Não encontrado</title>'
        + '<p>Essa página não existe. <a href="/">Ir para o Quebra-Galho</a>.</p>');
    }
    // A contagem é REAL. A pagina escreve o texto a partir dela, nunca o contrário.
    const quem = seo.quemAtende(vs.prestadores(), categoria.id, cidade);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public,max-age=300' });
    return res.end(seo.pagina({ categoria, cidade, prestadores: quem, origem }));
  }

  if (rota === '/' || rota === '/app') {
    try {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(readFileSync(join(AQUI, 'app.html'), 'utf8'));
    } catch (e) { return json(res, 500, { erro: 'não consegui servir a página: ' + e.message }); }
  }

  /**
   * Webhook do provedor. Fica FORA de /api de proposito: nao usa sessao, a
   * autenticacao e do proprio provedor, e responder 200 rapido e obrigatorio —
   * o Asaas pausa a fila apos 15 falhas consecutivas.
   */
  if (rota === '/webhooks/pagamento' && req.method === 'POST') {
    if (GATEWAY.validarWebhook) {
      const v = GATEWAY.validarWebhook(req.headers);
      if (!v.ok) { return json(res, 401, { erro: v.motivo }); }
    }
    const b = await corpo(req);
    if (b.excedeu) { return json(res, 413, { erro: 'corpo grande demais' }); }
    if (b.invalido) { return json(res, 400, { erro: 'payload invalido' }); }
    const r = vs.fluxo.aplicarEventoPagamento(GATEWAY.traduzirEvento(b.dados));
    return json(res, r.http || 200, r);
  }

  /**
   * Resumo para integracao. Fica FORA da sessao de usuario: quem chama e outro
   * SERVICO, nao uma pessoa. So agregados — nenhum dado pessoal atravessa.
   */
  if (rota === '/api/integracao/resumo' && req.method === 'GET') {
    if (!QG_INTEGRACAO_TOKEN) {
      return json(res, 503, { erro: 'QG_INTEGRACAO_TOKEN nao configurado neste servidor — integracao desligada' });
    }
    if (!tokenIgual(req.headers['x-qg-token'], QG_INTEGRACAO_TOKEN)) {
      return json(res, 401, { erro: 'token de integracao invalido' });
    }
    const est = vs.estado();
    return json(res, 200, {
      numeros: vs.fluxo.numeros(),
      regiao: est.regiao,
      categorias: est.categorias.length,
      prestadores: {
        total: est.prestadores.length,
        ativos: est.prestadores.filter((p) => p.status === 'ACTIVE').length,
        emAnalise: est.prestadores.filter((p) => ['PENDING', 'UNDER_REVIEW'].includes(p.status)).length,
      },
      clientes: est.clientes.length,
    });
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
      if (rota === '/api/pagamento-config') {
        // A tela precisa dizer se o dinheiro e de verdade. Nada de chave aqui.
        return json(res, 200, { provedor: GATEWAY.nome, simulado: Boolean(GATEWAY.simulado),
          ambiente: GATEWAY.ambiente || null, percentualPrestador: PCT_PRESTADOR });
      }
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
      if (rota === '/api/qualidade') {
        const a = vs.ident.autorizado(sessao.sessao, { papeis: ['admin', 'suporte', 'analista_disputa'] });
        if (!a.ok) { return json(res, 403, { erro: a.motivo }); }
        return json(res, 200, vs.fluxo.painelQualidade());
      }
      if (rota === '/api/admin') {
        const a = vs.ident.autorizado(sessao.sessao, { papeis: ['admin', 'suporte'] });
        if (!a.ok) { return json(res, 403, { erro: a.motivo }); }
        return json(res, 200, {
          numeros: vs.fluxo.numeros(),
          pedidos: vs.fluxo.pedidos().map(vs.fluxo.ped.resumo),
          ordens: vs.fluxo.ordens(),
          pagamentos: vs.fluxo.pagamentos(),
          disputas: vs.fluxo.disputas().map((d) => ({
            ...d,
            // O admin precisa ver a ordem e o escopo lado a lado: a pergunta da
            // contestacao e sempre "o que foi combinado x o que foi entregue".
            ordem: vs.fluxo.ordens().find((o) => o.id === d.ordemId) || null,
            escopo: vs.fluxo.escopos().find((e) => e.id === d.escopoId) || null,
          })),
          incidentes: vs.fluxo.incidentes(),
          politica: vs.fluxo.politica(),
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

      if (rota === '/api/cadastrar-profissional') {
        // Cadastro publico: entra PENDING e ainda NAO participa de matching. Criar a
        // conta junto e o que permite o profissional acompanhar a propria analise.
        const p = vs.criarPrestador(d, 'cadastro-publico');
        if (!p.ok) { return json(res, 400, { erro: p.erros.join('; '), erros: p.erros, avisos: p.avisos }); }
        let conta = null;
        if (d.email && d.senha) {
          const u = vs.criarUsuario({ email: d.email, nome: d.nome, papel: 'prestador', senha: d.senha }, 'cadastro-publico');
          if (!u.ok) { return json(res, 400, { erro: u.erros.join('; '), erros: u.erros, prestador: p.prestador }); }
          vs.editarPrestador(p.prestador.id, { usuarioId: u.usuario.id }, 'cadastro-publico');
          conta = u.usuario;
        }
        return json(res, 200, { ok: true, prestador: p.prestador, conta, avisos: p.avisos,
          proximoPasso: 'Seu cadastro entrou em análise. Você não paga nada para participar.' });
      }
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
        // O pedido so e publicado com alguem para avisar. Identificacao acontece
        // AQUI, no fim do fluxo — nao na entrada, que mataria a conversao.
        const ident = vs.fluxo.identificarCliente({ ...d, clientes: vs.clientes() }, (x) => vs.criarCliente(x, 'pedido'));
        if (!ident.ok) { return json(res, 400, { erro: ident.erros.join('; '), erros: ident.erros }); }
        const entrada = { ...d, clienteId: ident.cliente.id, clienteNome: ident.cliente.nome };
        const r = vs.fluxo.criarPedido(entrada, vs.prestadores());
        if (!r.ok) { return json(res, 400, { erro: r.erros.join('; '), erros: r.erros, avisos: r.avisos }); }
        // Em demonstracao os convidados respondem na hora, pelo mesmo caminho validado.
        // Com VSMARKET_DEMO=0 o pedido fica esperando proposta de gente de verdade.
        if (process.env.VSMARKET_DEMO !== '0') { vs.fluxo.simularPropostas(r.pedido.id, vs.prestadores(), vs.categorias()); }
        return json(res, 200, { ...r, cliente: { id: ident.cliente.id, nome: ident.cliente.nome, reusado: ident.reusado } });
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
        // O pagador vem do cadastro local; o provedor cria o dele a partir disso.
        const esc = vs.fluxo.escopos().find((x) => x.id === d.escopoId);
        const cliente = esc ? vs.clientes().find((c) => c.id === esc.clienteId) : null;
        const r = await vs.fluxo.pagar(d.escopoId, {
          ...d, cliente, percentualPrestador: PCT_PRESTADOR,
          aoGuardarCliente: (id, externo) => vs.vincularGateway(id, externo),
        }, GATEWAY);
        return json(res, r.ok ? 200 : 400, r);
      }
      if (rota === '/api/repassar') {
        const a = vs.ident.autorizado(sessao.sessao, { papeis: ['admin'] });
        if (!a.ok) { return json(res, 403, { erro: a.motivo }); }
        const r = vs.fluxo.repassar(d.pagamentoId);
        return json(res, r.ok ? 200 : 400, r);
      }
      if (rota === '/api/liquidar') {
        // Demonstração: dispara a liquidação que, em produção, vem do webhook.
        if (!GATEWAY.simulado) { return json(res, 400, { erro: 'com provedor real a liquidação vem do webhook, não daqui' }); }
        const r = vs.fluxo.aplicarEventoPagamento({
          conhecido: true, estado: 'DISPONIVEL',
          eventoId: 'sim_' + Date.now(), cobrancaId: d.externoId || d.pagamentoId,
        });
        return json(res, r.http || 200, r);
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
      if (rota === '/api/disputas/nivel') {
        const a = vs.ident.autorizado(sessao.sessao, { papeis: ['admin', 'analista_disputa'] });
        if (!a.ok) { return json(res, 403, { erro: a.motivo }); }
        const todas = vs.fluxo.disputas();
        const i = todas.findIndex((x) => x.id === d.disputaId);
        if (i < 0) { return json(res, 404, { erro: 'contestação não encontrada' }); }
        const ordem = ['ABERTA', 'NIVEL_1', 'NIVEL_2', 'NIVEL_3'];
        const pos = ordem.indexOf(d.nivel);
        if (pos < 0) { return json(res, 400, { erro: 'nível inválido' }); }
        // So avanca um degrau por vez: pular direto pra vistoria presencial gasta
        // dinheiro que a mediacao digital talvez resolvesse.
        if (pos !== ordem.indexOf(todas[i].status) + 1) {
          return json(res, 400, { erro: 'a análise avança um nível por vez — mediação antes de perícia' });
        }
        todas[i] = { ...todas[i], status: d.nivel, [`entrouEm_${d.nivel}`]: new Date().toISOString(), responsavel: ator };
        const { save } = await import('../engine/vsmarket/store.mjs');
        save('disputas', todas);
        return json(res, 200, { ok: true, disputa: todas[i] });
      }
      if (rota === '/api/incidentes') {
        const a = vs.ident.autorizado(sessao.sessao, { papeis: ['admin', 'suporte', 'analista_disputa'] });
        if (!a.ok) { return json(res, 403, { erro: a.motivo }); }
        const r = vs.fluxo.abrirIncidente({ ...d, abertoPor: ator });
        return json(res, r.ok ? 200 : 400, r.ok ? r : { erro: r.erros.join('; ') });
      }
      if (rota === '/api/incidentes/mover') {
        const a = vs.ident.autorizado(sessao.sessao, { papeis: ['admin', 'analista_disputa'] });
        if (!a.ok) { return json(res, 403, { erro: a.motivo }); }
        const r = vs.fluxo.moverIncidente(d.id, d.estado, { justificativa: d.justificativa, por: ator });
        return json(res, r.ok ? 200 : 400, r);
      }
      if (rota === '/api/politica') {
        const a = vs.ident.autorizado(sessao.sessao, { papeis: ['admin'] });
        if (!a.ok) { return json(res, 403, { erro: a.motivo }); }
        const r = vs.fluxo.definirPolitica({ ...d, aprovadoPor: d.aprovadaPorJuridico ? ator : undefined });
        return json(res, r.ok ? 200 : 400, r);
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
server.listen(PORT, () => {
  console.log(`[quebra-galho] no ar em http://127.0.0.1:${PORT}  (produto independente)`);
  console.log(`[quebra-galho] pagamento: ${GATEWAY.nome}${GATEWAY.simulado ? ' (SIMULADO — nao cobra de verdade)' : ' ' + GATEWAY.ambiente} · prestador fica com ${PCT_PRESTADOR}%`);
});
