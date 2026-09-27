#!/usr/bin/env node
/**
 * QA-Gate licensing backend (stub). Roda na TUA VPS.
 * Recebe webhook do Stripe -> emite licença assinada -> entrega ao cliente.
 *
 * NÃO faz parte do pacote npm (é server-side, usa a chave privada).
 * A chave privada vem de env QA_GATE_PRIVATE_KEY (VPS) ou license/.keys/private.pem (local).
 *
 * Env:
 *   PORT                     porta (default 8787)
 *   STRIPE_WEBHOOK_SECRET    se setado, valida assinatura do Stripe
 *   QA_GATE_PRIVATE_KEY      chave privada Ed25519 (PEM) — preferir env na VPS
 *   MAIL_FROM / SMTP_*       (TODO) entrega por email
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { issueLicense } from '../license/issue.mjs';
import { sendLicense } from './whatsapp.mjs';
import * as acesso from './acesso.mjs';
import * as usuarios from './usuarios.mjs';
import * as email from './email.mjs';
import * as crm from '../engine/vscrm/index.mjs';
import { testarConexao, CREDENCIAL } from '../engine/vsinfluence/coletor.mjs';
import { diagnostico as tiktokDiagnostico } from '../engine/vstiktok/index.mjs';
import { testar as tiktokTestar } from '../engine/vstiktok/conectar.mjs';
import * as estoque from '../engine/vsestoque/index.mjs';
import * as vspainel from '../engine/vspainel/index.mjs';
import { painelQuebraGalho, QG_URL } from './quebragalho.mjs';
import * as tk from '../engine/vstiktok/index.mjs';
import { reservarEvento } from './idempotencia.mjs';
import * as atendimento from './atendimento.mjs';
import * as canais from './canais.mjs';
import { ehTelegram } from '../engine/canais/telegram/index.mjs';
import * as resultados from '../engine/vsresultados/index.mjs';
import * as campanhasTg from '../engine/vscampanhas/index.mjs';
import * as qualif from '../engine/vsqualificacao/index.mjs';
import { lerImagem } from '../engine/vscampanhas/imagem.mjs';
import * as seguranca from '../engine/vsseguranca/index.mjs';
import * as operadores from '../engine/vsoperadores/index.mjs';
import * as proto from '../engine/vsprotocolo/index.mjs';
import * as planos from '../engine/vsplanos/index.mjs';
import * as pagar from '../engine/vspagamentos/index.mjs';
import * as fin from '../engine/vsfinanceiro/index.mjs';
import * as bot from '../engine/vsbot/index.mjs';
import * as docs from '../engine/vsdocumentos/index.mjs';
import * as clientes from '../engine/vsclientes/index.mjs';
import * as clientesSrv from './clientes-servicos.mjs';
import * as midia from './midia.mjs';
import { pagina as paginaVitrine, paginaProduto, paginaSumiu } from './vitrine.mjs';
import { lerCorpoLimitado, criarRateLimit, ipDe, segredoIgual, CORPO_MAX_BYTES } from './limites.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/* Hora em toda linha de log. Sem isto, `tail` do arquivo mistura o que acabou de
   acontecer com o que quebrou uma hora atras — ja custou um diagnostico errado,
   com linha velha sendo lida como falha nova. */
for (const nivel of ['log', 'warn', 'error']) {
  const original = console[nivel].bind(console);
  console[nivel] = (...args) => original(new Date().toISOString().slice(0, 19).replace('T', ' '), ...args);
}

/* Os limites vem da ASSINATURA, que aponta pra um plano do catalogo. Sem
   assinatura nada e bloqueado — ver engine/vsplanos. */
const limitesAtuais = () => { try { return planos.assinatura().limites; } catch { return {}; } };

/* Carteira de clientes: onde o cliente confere a chave e pra onde o Mercado
   Pago avisa que pagaram. Os dois saem do endereco publico do console. */
const origemPublica = () => process.env.PAINEL_URL || 'https://bolsocheio.velososolution.com.br';
const urlAtivacao = () => `${origemPublica()}/ativar`;
/* SEM notification_url por padrao. O webhook cadastrado no painel do Mercado
   Pago ja cobre todo pagamento da conta e a assinatura dele confere. O aviso
   que vem pela notification_url de cada cobranca chegava com assinatura que
   NAO conferia — 401 em todo evento, calado. So manda se for pedido no env. */
const webhookPagamento = () => process.env.VS_URL_WEBHOOK_PAGAMENTO || undefined;

/**
 * Depois que a chave sai: convite pro cliente criar o PROPRIO usuario (e-mail +
 * senha). Vai no WhatsApp e no e-mail. Cada canal responde por si — um falhar
 * nao some com o outro, e o resultado fica no historico do cliente.
 */
/** Link de "esqueci a senha": e-mail sempre; WhatsApp tambem quando e cliente. */
async function entregarRedefinicao({ token, email: para, nome, clienteId }) {
  const link = `${origemPublica()}/redefinir-senha?t=${encodeURIComponent(token)}`;
  const primeiro = String(nome || '').split(' ')[0];
  const txt = [
    `Olá${primeiro ? ', ' + primeiro : ''}! Recebemos um pedido para trocar a senha do Bolso Cheio (${para}).`,
    '',
    'Crie a nova senha neste link (vale 1 hora):',
    link,
    '',
    'Se não foi você, ignore — a senha atual continua valendo.',
  ].join('\n');
  const html = `<div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:auto;color:#16161c">
    <h2 style="margin:0 0 8px">Trocar a senha do Bolso Cheio</h2>
    <p>Olá${primeiro ? ', ' + primeiro : ''}! Recebemos um pedido para trocar a senha do usuário <b>${para}</b>.</p>
    <p style="margin:24px 0"><a href="${link}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">Criar nova senha</a></p>
    <p style="color:#5b5b66;font-size:13px">O link vale 1 hora. Se não foi você, ignore este e-mail — a senha atual continua valendo.</p>
    <p style="color:#5b5b66;font-size:12px">Veloso Solution · CNPJ 53.759.232/0001-94</p></div>`;
  const c = clienteId ? clientes.obter(clienteId) : null;
  const [e, w] = await Promise.all([
    email.enviarEmail({ para, assunto: 'Trocar a senha do Bolso Cheio', texto: txt, html }).catch((x) => ({ ok: false, erro: x.message })),
    c?.whatsapp ? clientesSrv.enviarWhatsapp({ para: c.whatsapp, texto: txt }).catch((x) => ({ ok: false, erro: x.message })) : null,
  ]);
  console.log(`[acesso] link de nova senha -> e-mail ${para}: ${e.ok ? 'enviado' : 'NAO (' + e.erro + ')'}${w ? ` | WhatsApp: ${w.ok ? 'enviado' : 'NAO (' + w.erro + ')'}` : ''}`);
  return { ok: e.ok || !!w?.ok, email: e, whatsapp: w };
}

async function entregarAcesso(clienteId) {
  const c = clientes.obter(clienteId);
  if (!c) { return { ok: false, motivo: 'cliente nao encontrado' }; }
  const cv = usuarios.convidar({ email: c.email, clienteId: c.id, nome: c.nome });
  if (!cv.ok) { console.warn(`[acesso] ${c.id}: sem convite — ${cv.motivo}`); return cv; }
  const link = `${origemPublica()}/criar-acesso?t=${encodeURIComponent(cv.token)}`;
  const lic = clientes.listar().find((x) => x.id === c.id)?.licencaVigente;
  const primeiro = c.nome.split(' ')[0];
  const txt = [
    `Olá, ${primeiro}! Seu acesso ao Bolso Cheio está pronto.`,
    '',
    `Crie sua senha neste link (vale 72 horas):`,
    link,
    '',
    `Seu usuário é o e-mail ${cv.email}.`,
    lic ? `Chave de ativação: ${lic.codigo} (válida até ${new Date(lic.validaAte).toLocaleDateString('pt-BR')}).` : null,
    '',
    'Depois é só entrar em bolsocheio.velososolution.com.br com e-mail e senha.',
  ].filter((x) => x !== null).join('\n');
  const html = `<div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:auto;color:#16161c">
    <h2 style="margin:0 0 8px">Seu acesso ao Bolso Cheio está pronto</h2>
    <p>Olá, ${primeiro}! Crie a sua senha para entrar. O seu usuário é <b>${cv.email}</b>.</p>
    <p style="margin:24px 0"><a href="${link}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">Criar minha senha</a></p>
    ${lic ? `<p>Chave de ativação: <b style="font-family:monospace">${lic.codigo}</b> — válida até ${new Date(lic.validaAte).toLocaleDateString('pt-BR')}.</p>` : ''}
    <p style="color:#5b5b66;font-size:13px">O link vale 72 horas. Se não foi você, ignore este e-mail.</p>
    <p style="color:#5b5b66;font-size:12px">Veloso Solution · CNPJ 53.759.232/0001-94</p></div>`;
  const [w, e] = await Promise.all([
    clientesSrv.enviarWhatsapp({ para: c.whatsapp, texto: txt }).catch((x) => ({ ok: false, erro: x.message })),
    email.enviarEmail({ para: cv.email, assunto: 'Seu acesso ao Bolso Cheio', texto: txt, html }).catch((x) => ({ ok: false, erro: x.message })),
  ]);
  clientes.registrarEntregaAcesso(c.id, { whatsapp: w, email: e });
  console.log(`[acesso] convite de ${c.id} -> WhatsApp: ${w.ok ? 'enviado' : 'NAO (' + w.erro + ')'} | e-mail ${cv.email}: ${e.ok ? 'enviado' : 'NAO (' + e.erro + ')'}`);
  return { ok: w.ok || e.ok, whatsapp: w, email: e, link };
}

/** Pagamento confirmado que for de cliente da carteira vira chave no WhatsApp dele. */
async function liberarSeForCliente(pagamento) {
  try {
    const r = await clientes.aoConfirmarPagamento(pagamento, {
      assinar: clientesSrv.assinarLicenca, enviar: clientesSrv.enviarWhatsapp, urlAtivacao: urlAtivacao(),
    });
    if (r.naoEDaqui || r.repetido) { return; }
    if (!r.ok) { console.error(`[clientes] pagamento ${pagamento.id} confirmado mas SEM chave: ${r.motivo}`); return; }
    console.log(`[clientes] chave ${r.codigo} emitida (${pagamento.referencia}) — WhatsApp: ${r.envio?.ok ? 'enviado' : 'NAO enviado: ' + (r.envio?.erro || '?')}`);
    const cli = clientes.listar().find((x) => (x.cobrancas || []).some((y) => y.referencia === pagamento.referencia));
    if (cli) { await entregarAcesso(cli.id); }
  } catch (e) { console.error(`[clientes] falha ao liberar ${pagamento?.referencia}: ${e.message}`); }
}

const PORT = process.env.PORT || 8787;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const CHECKOUT_URL = process.env.CHECKOUT_URL || ''; // Stripe Payment Link (opcional)
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || '';
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://api.velososolution.online';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''; // emissão admin on-demand (/issue)
// CRM: DESLIGADO por padrão. Este processo roda exposto na VPS e o CRM guarda nome e
// telefone de cliente — publicar sem querer seria vazamento. Ligar exige CRM_ENABLED=1
// e, se CRM_TOKEN estiver setado, o token em toda chamada.
const CRM_ENABLED = process.env.CRM_ENABLED === '1';
/**
 * Base das URLs de retorno do OAuth. Pode ser DIFERENTE do endereco do painel:
 * a TikTok so aceita redirect dentro de uma propriedade verificada, e a que esta
 * verificada aqui e o dominio raiz — nao o subdominio do painel. Fica gravada no
 * store pra sobreviver a reinicio sem depender de variavel de ambiente.
 */
/* O que o auditor de campanhas precisa do mundo: o produto como o cliente o
   ve (preco vigente, estoque) — ou marcado inativo —, os dados da imagem lidos
   do disco quando ela e nossa (/midia/...) e o link do bot. */
/* Quem esta logado, do jeito que a fila e a carteira gravam. */
function quemAtende(quem) {
  if (quem?.papel === 'vendedor') {
    const op = operadores.listar().find((o) => o.id === quem.operadorId);
    return { operadorId: quem.operadorId, nome: op?.nome || quem.nome || quem.email, equipe: op ? operadores.norm(op.setor) : null };
  }
  return { operadorId: null, nome: 'Administrador', equipe: null };
}
/* O vendedor ve o que e DELE (responsavel ou quem assumiu) e a fila sem dono da
   equipe dele ou geral. Cliente da carteira de outro vendedor nao aparece. */
function vendedorVe(c, eu) {
  const resp = c.comercial?.responsavel?.operadorId || null;
  if (resp === eu.operadorId || c.assumidaPor?.operadorId === eu.operadorId) { return true; }
  if (resp || c.assumidaPor?.operadorId) { return false; }
  // Bot desligado: ninguem atende sozinho, entao conversa sem dono e de toda a equipe.
  if (bot.getConfig().ativo === false) { return true; }
  if (c.situacao !== 'aguardando') { return false; }
  const dep = operadores.norm(c.departamento || 'humano');
  return dep === 'humano' || dep === eu.equipe;
}
/* Pode mexer nesta conversa? Dono sempre; vendedor so no que nao e de outro. */
function vendedorPode(quem, telefone) {
  if (quem?.papel !== 'vendedor') { return { ok: true }; }
  const lead = crm.listar().find((l) => l.telefone === telefone);
  const resp = lead?.comercial?.responsavel;
  if (resp?.operadorId && resp.operadorId !== quem.operadorId) { return { ok: false, motivo: `este cliente é da carteira de ${resp.nome} — peça ao administrador para transferir` }; }
  return { ok: true };
}

/* Vendedor que assume vira o responsavel do cliente (a carteira). O dono
   assumindo nao tira o cliente de ninguem. */
function assumiuVira(quem, telefone) {
  // Quem atendeu fica no PROTOCOLO: e o que o historico mostra depois.
  try { const p = proto.aberto(telefone); if (p) { proto.anotar(p.numero, { atendidoPor: quemAtende(quem) }); } } catch { /* complemento */ }
  if (quem?.papel !== 'vendedor') { return; }
  const lead = crm.listar().find((l) => l.telefone === telefone);
  if (!lead || lead.comercial?.responsavel?.operadorId === quem.operadorId) { return; }
  crm.comercial(lead.id, { responsavel: { ...quemAtende(quem), motivo: 'assumiu o atendimento' } });
}

function contextoCampanha(extra = {}) {
  return {
    produto: (sku) => {
      const vivo = estoque.doAtendimento().find((p) => p.sku === sku);
      if (vivo) { return { ...vivo, ativo: true }; }
      const cru = estoque.obter(sku);
      return cru && !cru.excluidoEm ? { sku, nome: cru.nome, ativo: false } : null;
    },
    imagem: (img) => {
      const nome = midia.nomeValido(img.arquivo) ? img.arquivo : String(img.url || '').match(/\/midia\/([0-9a-f]{24}\.[a-z]+)$/)?.[1];
      return nome && midia.nomeValido(nome) ? lerImagem(join(midia.baseDir(), nome)) : null;
    },
    linkBot: canais.telegramInfo().link || null,
    ...extra,
  };
}

function baseRedirect() {
  try {
    const c = tk.getConfig();
    if (c?.redirectBase) { return String(c.redirectBase).replace(/\/+$/, ''); }
  } catch { /* store indisponivel: cai no padrao */ }
  /* O redirect do OAuth e CADASTRADO no painel de cada rede social. Trocar a
     MARCA do console nao pode trocar esta URL: quem manda aqui e o que esta
     registrado la, e mudar sem recadastrar derruba o login de todas elas de uma
     vez. Por isso e constante, e nao deriva de PAINEL_URL. */
  return (process.env.TIKTOK_REDIRECT_BASE || REDIRECT_OAUTH_REGISTRADO).replace(/\/+$/, '');
}

/** O que esta cadastrado no app da TikTok hoje. Só muda junto com o cadastro lá. */
const REDIRECT_OAUTH_REGISTRADO = process.env.OAUTH_REDIRECT_BASE || 'https://painel.velososolution.com.br';

/**
 * Hosts que servem o CONSOLE (e nao a landing page).
 *
 * São vários de propósito. O console mudou de `painel.` para `bolsocheio.`, mas
 * o endereço antigo continua valendo — ele está cadastrado como redirect de
 * OAuth nas redes sociais, e um link antigo que passa a cair na página de venda
 * faz o dono concluir que o console caiu.
 */
/** O endereço do produto. Constante porque não pode depender de env estar certo. */
const HOST_CONSOLE_PADRAO = 'https://bolsocheio.velososolution.com.br';

const HOSTS_CONSOLE = new Set([
  /* O canônico entra SEMPRE, mesmo que PAINEL_URL aponte pro endereço antigo —
     foi exatamente isso que fez o endereço novo cair na página de venda na
     primeira tentativa. */
  HOST_CONSOLE_PADRAO,
  process.env.PAINEL_URL || HOST_CONSOLE_PADRAO,
  REDIRECT_OAUTH_REGISTRADO,
  ...String(process.env.CONSOLE_HOSTS_EXTRA || '').split(',').filter(Boolean),
].map((u) => { try { return new URL(u.trim()).hostname.toLowerCase(); } catch { return ''; } }).filter(Boolean));
const CRM_TOKEN = process.env.CRM_TOKEN || '';

/** Arquivos da marca servidos pelo console. Caminho -> nome do arquivo. */
const RAIZ_ASSETS = join(dirname(fileURLToPath(import.meta.url)), 'assets');
const MARCA = Object.freeze({
  '/crm/logo.png': 'bolsocheio.png',
  '/crm/simbolo.png': 'bolsocheio-simbolo.png',
  '/crm/favicon.png': 'favicon.png',
});

const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://velososolution.online';
function cors(res) {
  res.setHeader('access-control-allow-origin', CORS_ORIGIN);
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
}
function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

/** Sentinela: quando o corpo estoura o teto, o handler responde 413 e para. */
const CORPO_GRANDE = Symbol('corpo-grande');

async function readBody(req) {
  const r = await lerCorpoLimitado(req, CORPO_MAX_BYTES);
  if (r.excedeu) { return CORPO_GRANDE; }
  return r.buffer;
}

/** true se o handler já respondeu por corpo grande demais. */
function corpoEstourou(res, raw) {
  if (raw !== CORPO_GRANDE) { return false; }
  /* O campo TEM de se chamar `erro`: e o que o painel le. Chamando de `error`,
     a tela caia no generico e mostrava "HTTP 413" pro dono do negocio — um
     numero que nao diz nem o que aconteceu nem o que fazer.

     E a frase e em portugues, com o tamanho em KB: "corpo acima de 262144
     bytes" nao ajuda quem escolheu uma foto no celular. */
  const kb = Math.round(CORPO_MAX_BYTES / 1024);
  json(res, 413, {
    erro: `o que você enviou passou do limite de ${kb} KB por requisição`,
    comoResolver: 'Se for uma imagem, escolha uma menor ou deixe o painel reduzir para você.',
    limiteBytes: CORPO_MAX_BYTES,
  });
  return true;
}

// Cotas por IP. Emissão de licença é a rota cara: sem teto dava pra mintar chave em
// massa com um laço de shell. Em memória basta com um processo só; com mais de uma
// instância isto precisa ir pro Redis, senão cada uma conta sua própria cota.
const LIM_TRIAL = criarRateLimit({ max: Number(process.env.RATE_TRIAL || 5), janelaMs: 3600000 });
const LIM_CHECKOUT = criarRateLimit({ max: Number(process.env.RATE_CHECKOUT || 20), janelaMs: 3600000 });
const LIM_ISSUE = criarRateLimit({ max: Number(process.env.RATE_ISSUE || 60), janelaMs: 3600000 });
const LIM_CRM = criarRateLimit({ max: Number(process.env.RATE_CRM || 300), janelaMs: 60000 });
/* Pagina publica de assinatura. Iniciar gera contrato (abre o Chrome): teto
   baixo por IP. O resto e leve, mas publico — teto de qualquer jeito. */
const LIM_ASSINAR_INICIO = criarRateLimit({ max: Number(process.env.RATE_ASSINAR_INICIO || 8), janelaMs: 10 * 60000 });
const LIM_REENVIAR = criarRateLimit({ max: Number(process.env.RATE_REENVIAR || 5), janelaMs: 10 * 60000 });
const LIM_ASSINAR = criarRateLimit({ max: Number(process.env.RATE_ASSINAR || 90), janelaMs: 60000 });

/** Aplica a cota; se estourou, responde 429 e devolve true. */
function barrado(res, limitador, req, oque) {
  const r = limitador.checar(ipDe(req));
  if (r.ok) { return false; }
  console.warn(`[rate] ${oque} bloqueado para ${ipDe(req)} — espera ${r.esperaSeg}s`);
  res.setHeader('retry-after', String(r.esperaSeg));
  json(res, 429, { error: `muitas tentativas em ${oque}; tente em ${r.esperaSeg}s` });
  return true;
}

const ALLOW_INSECURE = process.env.ALLOW_INSECURE_WEBHOOK === '1';

/** Verifica assinatura do Stripe (t=..,v1=..). Sem SDK — HMAC SHA256. */
async function verifyStripeSig(rawBody, sigHeader, secret) {
  if (!secret) { return ALLOW_INSECURE; } // prod: sem secret => rejeita (evita mint livre). Local: ALLOW_INSECURE_WEBHOOK=1
  const { createHmac, timingSafeEqual } = await import('node:crypto');
  const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.split('=')));
  if (!parts.t || !parts.v1) { return false; }
  const signed = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  try { return timingSafeEqual(Buffer.from(signed), Buffer.from(parts.v1)); } catch { return false; }
}

// tiers por porte = chave ETERNA (exp null) + atualizacoes. Compat: pro/mensal/trial.
const planToDays = { pequena: null, medio: null, grande: null, pro: null, mensal: 30, trial: 14 };
const PRICE_MAP = {
  pequena: process.env.STRIPE_PRICE_PEQUENA || '',
  medio: process.env.STRIPE_PRICE_MEDIO || '',
  grande: process.env.STRIPE_PRICE_GRANDE || '',
};

async function deliverLicense({ email, phone, name, token, plan }) {
  console.log(`[licenca] emitida para ${name || email} (${plan})`);
  const res = await sendLicense({ phone, key: token, name, plan });
  console.log(`[entrega] provider=${res.provider} ok=${res.ok}${res.link ? ' link=' + res.link : ''}`);
  return res;
}

/**
 * Traduz a entrega pra resposta HTTP. `entregue` só é true quando a mensagem SAIU
 * pela rede (spec §6). Quando fica pendente, devolve o motivo e o link manual, pra
 * ninguém achar que o cliente recebeu a chave quando ela só foi pro console.
 */
function entregaResumo(entrega) {
  if (!entrega) { return { entregue: false, entrega: { pendente: true, motivo: 'sem telefone valido para entrega' } }; }
  if (entrega.ok) { return { entregue: true, entrega: { provider: entrega.provider, id: entrega.id || null } }; }
  return {
    entregue: false,
    entrega: {
      pendente: true,
      provider: entrega.provider,
      motivo: entrega.error || 'entrega falhou',
      linkManual: entrega.link || null,
    },
  };
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') { return json(res, 200, { ok: true }); }

  /**
   * No host do PAINEL, a raiz e o console — nao a pagina de venda do QA-Gate.
   * O mesmo processo serve os dois, e quem digita o endereço do console
   * esperando o CRM caia na landing page e conclui, com razao, que o console nao
   * carregou. O host vem de PAINEL_URL pra isto nao virar regra escondida no codigo.
   */
  if (req.method === 'GET' && req.url === '/' && CRM_ENABLED
      && HOSTS_CONSOLE.has(String(req.headers.host || '').split(':')[0].toLowerCase())) {
    res.writeHead(302, { location: '/crm' });
    return res.end();
  }

  if (req.method === 'GET' && (req.url === '/' || req.url.split('?')[0] === '/comprar')) {
    try {
      let html = readFileSync(join(HERE, 'sales.html'), 'utf8');
      html = html.split('{{CHECKOUT_URL}}').join(CHECKOUT_URL || '#');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch (e) { return json(res, 500, { error: 'sales page: ' + e.message }); }
  }

  if (req.method === 'GET' && req.url.split('?')[0] === '/obrigado') {
    // A página prometia "a caminho do seu WhatsApp" mesmo com o provider em `log`,
    // quando nada era enviado. Agora o texto segue o que o servidor consegue fazer.
    const envia = process.env.WHATSAPP_PROVIDER === 'cloud' && !!process.env.WA_TOKEN && !!process.env.WA_PHONE_ID;
    const recado = envia
      ? 'Sua licença QA-Gate está a caminho do seu WhatsApp.'
      : 'Sua licença QA-Gate já foi emitida e será enviada em instantes.';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<meta charset=utf-8><body style="font-family:system-ui;background:#0b1220;color:#f2f4f7;text-align:center;padding:80px 20px"><h1>Pagamento confirmado ✅</h1><p style="color:#cfd6e4">${recado} Qualquer coisa: velososolution.online</p></body>`);
  }

  // preflight CORS do checkout (form vindo do site)
  if (req.method === 'OPTIONS' && req.url === '/checkout') {
    cors(res); res.writeHead(204); return res.end();
  }

  // cadastro (nome + WhatsApp) -> cria sessão de checkout no Stripe
  if (req.method === 'POST' && req.url === '/checkout') {
    cors(res);
    if (barrado(res, LIM_CHECKOUT, req, '/checkout')) { return; }
    const buf = await readBody(req);
    if (corpoEstourou(res, buf)) { return; }
    const raw = buf.toString('utf8');
    let data; try { data = JSON.parse(raw); } catch { data = {}; }
    const name = String(data.name || '').trim().slice(0, 80);
    const phone = String(data.phone || '').replace(/\D/g, '').slice(0, 20);
    const plan = String(data.plan || 'pro').toLowerCase();
    if (!name || phone.length < 10) { return json(res, 400, { error: 'Informe nome e WhatsApp com DDD.' }); }
    const priceId = PRICE_MAP[plan] || STRIPE_PRICE_ID;
    if (!STRIPE_SECRET_KEY || !priceId) { return json(res, 503, { error: 'Pagamento ainda não configurado. Volte em breve.' }); }
    const p = new URLSearchParams();
    p.set('mode', 'payment');
    p.set('line_items[0][price]', priceId);
    p.set('line_items[0][quantity]', '1');
    p.set('phone_number_collection[enabled]', 'true');
    p.set('success_url', PUBLIC_URL + '/obrigado');
    p.set('cancel_url', PUBLIC_URL + '/');
    p.set('metadata[name]', name);
    p.set('metadata[phone]', phone);
    p.set('metadata[plan]', plan);
    try {
      const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: { authorization: `Bearer ${STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: p,
      });
      const j = await r.json();
      if (!r.ok) { return json(res, 502, { error: 'Stripe: ' + (j.error?.message || 'erro') }); }
      return json(res, 200, { url: j.url });
    } catch (e) { return json(res, 502, { error: 'checkout: ' + e.message }); }
  }

  // ADMIN: emite chave de QUALQUER plano on-demand (protegido por ADMIN_TOKEN).
  // Ex.: curl -H "authorization: Bearer $ADMIN_TOKEN" -d '{"contato":"5531...","plan":"grande"}' .../issue
  if (req.method === 'POST' && req.url === '/issue') {
    cors(res);
    if (!ADMIN_TOKEN) { return json(res, 403, { error: 'emissão admin desativada (defina ADMIN_TOKEN)' }); }
    if (barrado(res, LIM_ISSUE, req, '/issue')) { return; }
    const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    const buf = await readBody(req);
    if (corpoEstourou(res, buf)) { return; }
    const raw = buf.toString('utf8');
    let data; try { data = JSON.parse(raw); } catch { data = {}; }
    // Comparacao em tempo constante: `!==` vaza pelo tempo quantos caracteres do
    // token ja estao certos, e o token do /issue emite licenca de qualquer plano.
    if (!segredoIgual(auth, ADMIN_TOKEN) && !segredoIgual(data.token, ADMIN_TOKEN)) {
      return json(res, 401, { error: 'token admin inválido' });
    }
    const plan = String(data.plan || 'pro').toLowerCase();
    const name = String(data.name || '').trim().slice(0, 80);
    const phone = String(data.whatsapp || data.phone || '').replace(/\D/g, '').slice(0, 20);
    const contato = phone || String(data.email || data.contato || '').trim().slice(0, 120);
    if (!contato) { return json(res, 400, { error: 'informe contato (whatsapp/email)' }); }
    const days = data.days != null ? Number(data.days) : (planToDays[plan] ?? 365);
    const token = issueLicense({ email: contato, plan, days });
    let entrega = null;
    if (phone.length >= 10 && data.entregar !== false) {
      // catch vazio escondia a falha e a resposta saia igual a de um envio bem-sucedido.
      try { entrega = await deliverLicense({ email: contato, phone, name, token, plan }); }
      catch (e) { console.error('[entrega] erro inesperado:', e.message); entrega = { ok: false, provider: 'erro', error: e.message }; }
    }
    return json(res, 200, { token, plan, days, ...entregaResumo(entrega) });
  }

  // preflight do trial (instalador)
  if (req.method === 'OPTIONS' && (req.url === '/trial' || req.url === '/issue')) { cors(res); res.writeHead(204); return res.end(); }

  // cadastro do TESTE -> emite chave trial POR CLIENTE (exp longo; o corte de 7 dias é
  // feito pela trava por data de instalação no cliente). Entrega best-effort no WhatsApp.
  if (req.method === 'POST' && req.url === '/trial') {
    cors(res);
    if (barrado(res, LIM_TRIAL, req, '/trial')) { return; }
    const buf = await readBody(req);
    if (corpoEstourou(res, buf)) { return; }
    const raw = buf.toString('utf8');
    let data; try { data = JSON.parse(raw); } catch { data = {}; }
    const name = String(data.name || '').trim().slice(0, 80);
    const phone = String(data.whatsapp || data.phone || data.contato || '').replace(/\D/g, '').slice(0, 20);
    const contato = phone || String(data.email || data.contato || '').trim().slice(0, 120);
    if (!contato) { return json(res, 400, { error: 'Informe WhatsApp ou e-mail.' }); }
    const token = issueLicense({ email: contato, plan: 'trial', days: 3650 });
    let entrega = null;
    if (phone.length >= 10) {
      try { entrega = await deliverLicense({ email: contato, phone, name, token, plan: 'trial' }); }
      catch (e) { console.error('[entrega] erro inesperado:', e.message); entrega = { ok: false, provider: 'erro', error: e.message }; }
    }
    return json(res, 200, { token, plan: 'trial', ...entregaResumo(entrega) });
  }

  /**
   * Webhook do Asaas. Publico de proposito — quem chama e o servidor deles.
   * A trava e o token estatico no header `asaas-access-token` (eles NAO assinam
   * o corpo como o Stripe), conferido em tempo constante dentro do modulo.
   * Responde 200 tambem na reentrega: 4xx repetido faz a fila do Asaas PAUSAR
   * depois de 15 falhas, e ai nenhum pagamento e confirmado.
   */
  /**
   * Webhook de ENTRADA do WhatsApp (Meta Cloud API). E o canal do bot.
   *
   * GET  = aperto de mao da Meta: ela chama uma vez com hub.challenge e so
   *        registra a URL se o desafio voltar CRU, em texto puro.
   * POST = mensagem do cliente.
   *
   * Fica FORA do /crm de proposito: quem chama e a Meta, sem sessao do painel.
   * Quem protege aqui e a assinatura (WA_APP_SECRET), nao o token do console.
   */
  if (req.method === 'GET' && req.url.split('?')[0] === '/webhook/whatsapp') {
    const q = new URL(req.url, 'http://x').searchParams;
    const esperado = process.env.WA_VERIFY_TOKEN || '';
    if (!esperado) {
      console.error('[whatsapp] verificacao recusada: WA_VERIFY_TOKEN nao esta no ambiente');
      return json(res, 503, { erro: 'WA_VERIFY_TOKEN ausente no servidor' });
    }
    // segredoIgual: comparacao em tempo constante, igual ao resto do backend.
    if (q.get('hub.mode') === 'subscribe' && segredoIgual(q.get('hub.verify_token') || '', esperado)) {
      console.log('[whatsapp] webhook verificado pela Meta');
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(String(q.get('hub.challenge') || ''));
    }
    /* Diz o BASTANTE pra achar o erro de digitacao sem imprimir o segredo: quase
       sempre o token foi copiado pela metade (selecao de duplo clique para no
       separador) e o tamanho entrega isso na hora. */
    const rec = String(q.get('hub.verify_token') || '');
    console.error(`[whatsapp] verificacao recusada: token nao confere `
      + `(recebido ${rec.length} caracteres, esperado ${esperado.length}; `
      + `comeca "${rec.slice(0, 2)}", termina "${rec.slice(-2)}")`);
    return json(res, 403, { erro: 'verify_token nao confere' });
  }

  if (req.method === 'POST' && req.url.split('?')[0] === '/webhook/whatsapp') {
    const buf = await readBody(req);
    if (corpoEstourou(res, buf)) { return; }
    const cru = buf.toString('utf8');

    const ass = atendimento.confereAssinatura(cru, req.headers['x-hub-signature-256'], process.env.WA_APP_SECRET || '');
    if (!ass.ok) {
      console.error(`[whatsapp] payload RECUSADO: ${ass.motivo}`);
      return json(res, 401, { erro: ass.motivo });
    }
    if (!ass.conferida) { console.warn(`[whatsapp] ${ass.motivo} — qualquer um que souber a URL consegue escrever na trilha`); }

    let evento; try { evento = JSON.parse(cru); } catch { return json(res, 400, { erro: 'payload invalido' }); }

    /* Responde 200 JA. A Meta reentrega tudo que nao receber 2xx rapido, e
       processar antes de responder transformaria uma resposta lenta do bot numa
       enxurrada de reentregas. A reentrega que vier mesmo assim para na trava de
       idempotencia, que e feita pelo id da mensagem la dentro. */
    json(res, 200, { received: true });

    atendimento.processarEvento(evento, { produtos: () => estoque.doAtendimento() })
      .then((r) => {
        for (const x of r.resultados) {
          if (x.duplicado) { console.log(`[whatsapp] reentrega ignorada (${x.telefone})`); continue; }
          if (!x.ok) { console.error(`[whatsapp] ${x.motivo}`); continue; }
          if (x.semCrm) { console.warn(`[whatsapp] lead NAO criado para ${x.telefone}: ${x.semCrm}`); }
          if (x.leadNovo) { console.log(`[whatsapp] lead novo: ${x.leadId}`); }
          if (x.botDesligado) { console.log(`[whatsapp] bot desligado — mensagem de ${x.telefone} so registrada`); continue; }
          if (x.semTexto) { console.log(`[whatsapp] ${x.telefone} mandou algo sem texto — precisa de gente`); continue; }
          console.log(`[whatsapp] ${x.telefone}: ${x.tipo}${x.handoff ? ' (chamar gente)' : ''} -> ${x.respondeu ? 'respondido' : 'NAO enviado: ' + (x.envio?.error || '?')}`);
        }
      })
      .catch((e) => console.error('[whatsapp] falha ao processar evento:', e.message));
    return;
  }

  /* Webhook do Mercado Pago. Ele manda "houve algo com o pagamento X" e a gente
     vai BUSCAR o estado — por isso a query importa: o id dela entra no manifesto
     que valida a assinatura. */
  /* Dois caminhos pro mesmo webhook: o nosso e o que ja foi cadastrado no painel
     do Mercado Pago (`/api/webhooks/mercadopago`). Trocar URL cadastrada em
     gateway e um passo manual a mais e uma chance a mais de ficar sem receber
     nada — aceitar os dois custa uma linha. */
  const CAMINHOS_MP = {
    /* Sem sufixo: segue o ambiente configurado no painel. E o que ja esta
       cadastrado no gateway, e continua valendo. */
    '/webhook/mercadopago': null,
    '/api/webhooks/mercadopago': null,
    /* Com sufixo: o caminho DECIDE o ambiente. Teste e producao podem ficar
       cadastrados ao mesmo tempo sem um ser confundido com o outro — cada um
       com o seu segredo de assinatura e a sua conta na hora de consultar. */
    '/webhook/mercadopago/teste': 'teste',
    '/api/webhooks/mercadopago/teste': 'teste',
    '/webhook/mercadopago/producao': 'producao',
    '/api/webhooks/mercadopago/producao': 'producao',
  };
  const caminhoMp = req.url.split('?')[0];
  if (req.method === 'POST' && Object.hasOwn(CAMINHOS_MP, caminhoMp)) {
    const mpAmbiente = CAMINHOS_MP[caminhoMp];
    const buf = await readBody(req);
    if (corpoEstourou(res, buf)) { return; }
    let evento; try { evento = JSON.parse(buf.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
    const query = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    const r = await pagar.processarWebhook(req.headers, evento, { query, mpAmbiente });

    /* Pagamento confirmado vira LANCAMENTO no caixa, igual ao Asaas. */
    if (r.ok && ['CONFIRMADO', 'DISPONIVEL'].includes(r.estado) && r.pagamento) {
      const l = fin.lancarPagamento(r.pagamento);
      if (l.ok && !l.repetido) { console.log(`[caixa] entrada de ${r.pagamento.id} lancada`); }
      await liberarSeForCliente(r.pagamento);
      await canais.pixConfirmado(r.pagamento).catch((e) => console.warn(`[pix] aviso pelo webhook falhou: ${e.message}`));
    }
    console.log(`[mercadopago${mpAmbiente ? '/' + mpAmbiente : ''}] ${evento.type || evento.topic || '?'} ${evento.data?.id || ''} -> ${r.ok ? (r.estado || 'recebido') : 'recusado: ' + r.motivo}`);
    /* Quando a assinatura NAO confere, o 401 sozinho nao diz o que faltou. Este
       log mostra so a PRESENCA de cada peca — nunca o segredo, nunca a
       assinatura recebida. Sem ele, investigar o 401 do simulador oficial era
       adivinhacao. */
    if (r.presenca) {
      console.log(`[mercadopago] assinatura recusada — ${Object.entries(r.presenca).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    }
    return json(res, r.http || (r.ok ? 200 : 400), r);
  }

  if (req.method === 'POST' && req.url === '/webhook/asaas') {
    const buf = await readBody(req);
    if (corpoEstourou(res, buf)) { return; }
    let evento; try { evento = JSON.parse(buf.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
    const r = await pagar.processarWebhook(req.headers, evento);
    /* Pagamento confirmado vira LANCAMENTO no caixa. E idempotente pela
       referencia: o mesmo pagamento reentregue nao entra duas vezes. Sem isto, o
       financeiro so mostrava promessa do funil e nunca o dinheiro que entrou. */
    if (r.ok && ['CONFIRMADO', 'DISPONIVEL'].includes(r.estado) && r.pagamento) {
      const l = fin.lancarPagamento(r.pagamento);
      if (l.ok && !l.repetido) { console.log(`[caixa] entrada de ${r.pagamento.id} lancada`); }
      await liberarSeForCliente(r.pagamento);
    }
    console.log(`[asaas] ${evento.event || '?'} ${evento.payment?.id || ''} -> ${r.ok ? r.estado : 'recusado: ' + r.motivo}`);
    return json(res, r.http || (r.ok ? 200 : 400), r);
  }

  if (req.method === 'POST' && req.url === '/webhook') {
    const buf = await readBody(req);
    if (corpoEstourou(res, buf)) { return; }
    const raw = buf.toString('utf8');
    const ok = await verifyStripeSig(raw, req.headers['stripe-signature'] || '', WEBHOOK_SECRET);
    if (!ok) { return json(res, 400, { error: 'assinatura Stripe inválida' }); }

    let event;
    try { event = JSON.parse(raw); } catch { return json(res, 400, { error: 'payload inválido' }); }

    // Idempotência (spec §24): o Stripe reentrega o mesmo evento quando não recebe 2xx.
    // Sem esta trava, cada reentrega emitia OUTRA licença pro mesmo pagamento.
    // Responde 200 na reentrega — 4xx faria o Stripe insistir para sempre.
    if (event.id && !reservarEvento(event.id, { tipo: event.type })) {
      console.log(`[webhook] evento ${event.id} ja processado — reentrega ignorada`);
      return json(res, 200, { received: true, duplicado: true, issued: false });
    }

    if (event.type === 'checkout.session.completed') {
      const s = event.data?.object || {};
      const email = s.customer_details?.email || s.customer_email || 'sem-email';
      const phone = s.customer_details?.phone || s.metadata?.phone || '';
      const name = s.customer_details?.name || s.metadata?.name || '';
      const plan = (s.metadata?.plan || 'pro').toLowerCase();
      const token = issueLicense({ email, plan, days: planToDays[plan] ?? 365 });
      const entrega = await deliverLicense({ email, phone, name, token, plan });
      return json(res, 200, { received: true, issued: true, email, phone: !!phone, plan, ...entregaResumo(entrega) });
    }
    return json(res, 200, { received: true, issued: false });
  }

  /**
   * Retorno do OAuth das redes sociais. Fica FORA do /crm de proposito: quem chega
   * aqui e o navegador redirecionado pela rede, sem o header de sessao do painel.
   * O `state` e conferido dentro de `concluirAutorizacao` — e o que impede alguem
   * mandar um `code` forjado.
   */
  /* Arquivo de verificacao de dominio da TikTok. Fica na RAIZ porque e la que ela
     procura, e antes do resto do roteamento porque o nome vem deles — nao da pra
     reservar um prefixo nosso. So responde o arquivo exatamente cadastrado. */
  if (req.method === 'GET' && /^(\/[A-Za-z0-9._-]{1,64}){0,6}\/[A-Za-z0-9._-]{1,64}\.txt$/.test(req.url.split('?')[0])) {
    const v = tk.servirVerificacao(req.url);
    if (v) {
      res.writeHead(200, { 'content-type': v.tipo });
      return res.end(v.conteudo);
    }
  }

  /* Conferencia PUBLICA da chave de ativacao. Sem sessao de proposito: quem
     abre e o cliente, pelo link que chegou no WhatsApp. So mostra primeiro
     nome, o que esta liberado e ate quando — nada de documento ou telefone. */
  if (req.method === 'GET' && req.url.split('?')[0].startsWith('/api/licenca/')) {
    if (barrado(res, LIM_CRM, req, '/api/licenca')) { return; }
    const r = clientes.consultarCodigo(decodeURIComponent(req.url.split('?')[0].slice('/api/licenca/'.length)));
    return json(res, r.ok ? 200 : 404, r);
  }
  if (req.method === 'GET' && req.url.split('?')[0] === '/ativar') {
    try {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(readFileSync(join(HERE, 'ativar.html'), 'utf8'));
    } catch (e) { return json(res, 500, { erro: 'pagina de ativacao: ' + e.message }); }
  }

  if (req.method === 'GET' && req.url.split('?')[0] === '/redefinir-senha') {
    try {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(readFileSync(join(HERE, 'redefinir-senha.html'), 'utf8'));
    } catch (e) { return json(res, 500, { erro: 'pagina: ' + e.message }); }
  }
  /* ---- Criar o proprio acesso (link do convite) ---- */
  if (req.method === 'GET' && req.url.split('?')[0] === '/criar-acesso') {
    try {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(readFileSync(join(HERE, 'criar-acesso.html'), 'utf8'));
    } catch (e) { return json(res, 500, { erro: 'pagina: ' + e.message }); }
  }
  if (req.url.split('?')[0].startsWith('/api/acesso/')) {
    if (barrado(res, LIM_ASSINAR, req, 'acesso')) { return; }
    const rotaC = req.url.split('?')[0];
    if (req.method === 'GET' && rotaC === '/api/acesso/convite') {
      const r = usuarios.lerConvite(new URL(req.url, 'http://x').searchParams.get('t'));
      return json(res, r.ok ? 200 : 404, r.ok ? r : { ...r, erro: r.motivo });
    }
    if (req.method === 'POST' && rotaC === '/api/acesso/aceitar') {
      const b = await readBody(req);
      if (corpoEstourou(res, b)) { return; }
      let d; try { d = JSON.parse(b.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
      const r = usuarios.aceitarConvite(d.token, d.senha);
      if (r.ok) { console.log(`[acesso] ${r.email} criou a senha`); }
      return json(res, r.ok ? 200 : 400, r.ok ? r : { ...r, erro: r.motivo });
    }
    /* "Paguei e não recebi" / "esqueci a senha": manda o link SÓ pros canais
       cadastrados na assinatura. A resposta é sempre a mesma — não confirma pra
       quem pergunta se um e-mail é cliente (LGPD). */
    if (req.method === 'POST' && rotaC === '/api/acesso/reenviar') {
      if (barrado(res, LIM_REENVIAR, req, 'reenvio de acesso')) { return; }
      const b = await readBody(req);
      if (corpoEstourou(res, b)) { return; }
      let d; try { d = JSON.parse(b.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
      const c = clientes.assinantePorEmail(d.email);
      if (c) { await entregarAcesso(c.id).catch((e) => console.warn(`[acesso] reenvio de ${c.id} falhou: ${e.message}`)); }
      else { console.log('[acesso] pedido de reenvio para e-mail sem assinatura em vigor'); }
      return json(res, 200, { ok: true, mensagem: 'Se existe assinatura em vigor com este e-mail, o link para criar a senha foi enviado agora para o e-mail e o WhatsApp cadastrados.' });
    }
    /* Esqueci a senha: link de 1 h no e-mail da conta (e no WhatsApp, se for
       cliente). Resposta sempre igual — não diz a quem pergunta se o e-mail
       tem conta. */
    if (req.method === 'POST' && rotaC === '/api/acesso/esqueci') {
      if (barrado(res, LIM_REENVIAR, req, 'esqueci a senha')) { return; }
      const b = await readBody(req);
      if (corpoEstourou(res, b)) { return; }
      let d; try { d = JSON.parse(b.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
      const r = usuarios.pedirRedefinicao(d.email);
      if (r.ok) { await entregarRedefinicao(r).catch((e) => console.warn(`[acesso] link de nova senha para ${r.email} falhou: ${e.message}`)); }
      else { console.log('[acesso] esqueci a senha para e-mail sem conta'); }
      return json(res, 200, { ok: true, mensagem: 'Se este e-mail tem conta no Bolso Cheio, o link para criar uma nova senha acabou de ser enviado. Ele vale 1 hora.' });
    }
    if (req.method === 'GET' && rotaC === '/api/acesso/redefinicao') {
      const r = usuarios.lerRedefinicao(new URL(req.url, 'http://x').searchParams.get('t'));
      return json(res, r.ok ? 200 : 404, r.ok ? r : { ...r, erro: r.motivo });
    }
    if (req.method === 'POST' && rotaC === '/api/acesso/redefinir') {
      const b = await readBody(req);
      if (corpoEstourou(res, b)) { return; }
      let d; try { d = JSON.parse(b.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
      const r = usuarios.redefinirSenha(d.token, d.senha);
      if (r.ok) { console.log(`[acesso] ${r.email} redefiniu a senha pelo link`); }
      return json(res, r.ok ? 200 : 400, r.ok ? r : { ...r, erro: r.motivo });
    }
    return json(res, 404, { erro: 'rota desconhecida' });
  }

  /* Administracao sem tela, pela maquina: reenviar o convite de acesso de um
     cliente. Protegido pelo ADMIN_TOKEN, igual ao /issue. */
  if (req.method === 'POST' && req.url === '/admin/entregar-acesso') {
    const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    if (!ADMIN_TOKEN || !segredoIgual(auth, ADMIN_TOKEN)) { return json(res, 401, { error: 'token admin inválido' }); }
    const b = await readBody(req);
    if (corpoEstourou(res, b)) { return; }
    let d; try { d = JSON.parse(b.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
    return json(res, 200, await entregarAcesso(d.clienteId));
  }

  /* ---- Pagina PUBLICA de assinatura: o cliente compra sozinho, sem login ----
     Tudo que mexe numa tentativa exige a senha de uso unico que o /iniciar
     devolveu. O valor cobrado continua sendo o do contrato, decidido aqui. */
  if (req.method === 'GET' && req.url.split('?')[0] === '/assinar') {
    try {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(readFileSync(join(HERE, 'assinar.html'), 'utf8'));
    } catch (e) { return json(res, 500, { erro: 'pagina de assinatura: ' + e.message }); }
  }
  if (req.url.split('?')[0].startsWith('/api/assinar/')) {
    const rotaA = req.url.split('?')[0];
    const q = new URL(req.url, 'http://x').searchParams;
    if (barrado(res, rotaA === '/api/assinar/iniciar' ? LIM_ASSINAR_INICIO : LIM_ASSINAR, req, 'assinatura')) { return; }
    if (req.method === 'GET' && rotaA === '/api/assinar/config') {
      return json(res, 200, {
        ofertas: clientes.todasOfertas().filter((o) => o.catalogo),
        cartao: pagar.chavePublicaCartao(),
        contato: process.env.VITRINE_WHATSAPP || '553175536010',
      });
    }
    const liberado = (id, acesso) => clientes.conferirAcessoCheckout(id, acesso);
    if (req.method === 'GET' && rotaA === '/api/assinar/estado') {
      if (!liberado(q.get('id'), q.get('t'))) { return json(res, 403, { erro: 'sessão de pagamento expirada — recomece a assinatura' }); }
      let e = clientes.estadoCheckout(q.get('id'), q.get('ref'));
      if (e.ok && e.estado === 'AGUARDANDO' && e.pagamentoId) {
        const a = await pagar.atualizarEstado(e.pagamentoId);
        if (a.ok && ['CONFIRMADO', 'DISPONIVEL'].includes(a.pagamento?.estado)) {
          if (a.mudou) { const l = fin.lancarPagamento(a.pagamento); if (l.ok && !l.repetido) { console.log(`[caixa] entrada de ${a.pagamento.id} lancada`); } }
          await liberarSeForCliente(a.pagamento);
          e = clientes.estadoCheckout(q.get('id'), q.get('ref'));
        }
      }
      return json(res, e.ok ? 200 : 404, e);
    }
    if (req.method === 'GET' && rotaA === '/api/assinar/contrato.pdf') {
      if (!liberado(q.get('id'), q.get('t'))) { return json(res, 403, { erro: 'sessão expirada' }); }
      const a = clientes.arquivoContrato(q.get('id'));
      if (!a) { return json(res, 404, { erro: 'contrato nao encontrado' }); }
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${a.nome}"`, 'cache-control': 'no-store' });
      return res.end(a.buf);
    }
    if (req.method === 'POST') {
      const b = await readBody(req);
      if (corpoEstourou(res, b)) { return; }
      let d; try { d = JSON.parse(b.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
      let r;
      if (rotaA === '/api/assinar/iniciar' || rotaA === '/api/assinar/trocar') {
        const troca = rotaA === '/api/assinar/trocar';
        r = await clientes.iniciarCheckout({ ...d, troca }, { imprimir: clientesSrv.imprimirPdf, publico: true });
        /* Ja e assinante nao e erro: e a tela de trocar plano / adendo. */
        if (r.jaAssinante) { return json(res, 200, { ok: false, jaAssinante: true, assinante: r.assinante, motivo: r.motivo }); }
        if (r.ok) { console.log(`[assinar] ${r.clienteId} ${troca ? (r.agendada ? 'agendou troca para ' + r.para : 'iniciou troca') : 'iniciou'} ${(d.produtos || []).join('+')} (${d.ciclo})${r.contrato ? ' — ' + r.contrato.numero : ''}`); }
      } else if (rotaA === '/api/assinar/adendo') {
        r = clientes.iniciarAdendo(d, { publico: true });
        if (r.ok) { console.log(`[assinar] ${r.clienteId} iniciou adendo ${d.code} x${r.pedido.qtd} — ${r.pedido.valorCentavos}`); }
      } else if (!liberado(d.id, d.acesso)) {
        return json(res, 403, { erro: 'sessão de pagamento expirada — recomece a assinatura' });
      } else if (rotaA === '/api/assinar/criar-acesso') {
        /* Quem ACABOU de pagar vai direto criar usuario e senha, na mesma tela —
           sem depender de e-mail ou WhatsApp chegando. So com assinatura em
           vigor e com a senha de uso unico desta compra. */
        const c = clientes.listar().find((x) => x.id === d.id);
        if (!c?.licencaVigente) { return json(res, 400, { erro: 'o pagamento ainda não foi confirmado' }); }
        const jaTem = usuarios.doCliente(c.id);
        if (jaTem?.hash) { return json(res, 200, { ok: true, jaTemUsuario: true, email: jaTem.email, entrar: '/crm' }); }
        const cv = usuarios.convidar({ email: c.email, clienteId: c.id, nome: c.nome });
        if (!cv.ok) { return json(res, 400, { erro: cv.motivo }); }
        return json(res, 200, { ok: true, email: cv.email, link: `/criar-acesso?t=${encodeURIComponent(cv.token)}` });
      } else if (rotaA === '/api/assinar/pix') {
        r = await clientes.pixCheckout(d.id, { cobrar: pagar.cobrar, webhookUrl: webhookPagamento() });
      } else if (rotaA === '/api/assinar/cartao') {
        r = await clientes.cartaoCheckout(d.id, {
          cartao: d.cartao || {}, pagarCartao: pagar.pagarCartao, webhookUrl: webhookPagamento(),
          assinar: clientesSrv.assinarLicenca, enviar: clientesSrv.enviarWhatsapp, urlAtivacao: urlAtivacao(),
        });
        console.log(`[assinar] cartao ${d.id}: ${r.aprovado ? 'APROVADO, chave ' + r.codigo : (r.emAnalise ? 'em analise' : 'recusado — ' + (r.tecnico || r.mensagem || r.motivo))}`);
        if (r.aprovado) { await entregarAcesso(d.id); }
        if (r.recusado && r.ok === false) { r = { ok: true, aprovado: false, recusado: true, mensagem: r.motivo }; }
      } else {
        return json(res, 404, { erro: 'rota desconhecida' });
      }
      if (r && r.ok === false) { return json(res, 400, { ...r, erro: r.motivo || (r.erros || []).join('; ') }); }
      return json(res, 200, r);
    }
    return json(res, 404, { erro: 'rota desconhecida' });
  }

  /* Vitrine — loja PUBLICA. Sem sessao de proposito: quem abre e cliente final,
     pelo link que o dono manda no WhatsApp. So produto marcado como exposto e
     ativo aparece; esgotado aparece marcado, nao sumido — sumir da a impressao
     de que a loja e menor do que e. */
  const rotaV = req.url.split('?')[0];
  /* Robô de busca: a vitrine é pra ser achada; o painel, o login e a API não. */
  if (req.method === 'GET' && rotaV === '/robots.txt') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' });
    return res.end(['User-agent: *', 'Allow: /vitrine', 'Allow: /midia/', 'Disallow: /crm', 'Disallow: /api/', 'Disallow: /criar-acesso',
      'Disallow: /redefinir-senha', 'Disallow: /ativar', 'Disallow: /assinar', `Sitemap: ${origemPublica()}/vitrine/sitemap.xml`, ''].join('\n'));
  }
  if (req.method === 'GET' && rotaV === '/vitrine/sitemap.xml') {
    const o = origemPublica();
    const urls = [`${o}/vitrine`, ...estoque.daVitrine().map((p) => `${o}/vitrine/p/${encodeURIComponent(p.sku)}`)];
    res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' });
    return res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
      urls.map((u) => `  <url><loc>${u.replace(/&/g, '&amp;')}</loc></url>`).join('\n')}\n</urlset>\n`);
  }
  if (req.method === 'GET' && (rotaV === '/vitrine' || rotaV.startsWith('/vitrine/'))) {
    /* O botão "pedir" cai no WhatsApp que ATENDE: o número configurado pra
       vitrine ou, sem ele, o do bot conectado agora. Antes, sem a variável, todo
       card dizia "Consulte a loja" e ninguém chegava na conversa. */
    const lojaV = {
      nome: process.env.VITRINE_NOME || 'Veloso Solution',
      descricao: process.env.VITRINE_DESCRICAO,
      whatsapp: process.env.VITRINE_WHATSAPP
        || (canais.estado().canais || []).find((c) => c.nome === 'whatsapp-web' && c.numero)?.numero || null,
      origem: origemPublica(),
    };
    try {
      if (rotaV === '/vitrine') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' });
        return res.end(paginaVitrine(estoque.daVitrine(), lojaV));
      }
      /* FEED DO GOOGLE (Merchant Center busca sozinho, todo dia). Só produto da
         vitrine, e o link de cada um é a página dele aqui mesmo. */
      if (rotaV === '/vitrine/google.xml') {
        const f = estoque.exportarVitrine('google', { loja: lojaV.nome, site: `${lojaV.origem}/vitrine`,
          linkDe: (sku) => `${lojaV.origem}/vitrine/p/${encodeURIComponent(sku)}` });
        res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=300',
          'x-vs-incluidos': String(f.incluidos), 'x-vs-recusados': String((f.recusados || []).length) });
        return res.end(f.conteudo);
      }
      if (rotaV.startsWith('/vitrine/p/')) {
        const p = estoque.daVitrinePorSku(decodeURIComponent(rotaV.slice('/vitrine/p/'.length)));
        if (!p) { res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }); return res.end(paginaSumiu(lojaV)); }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' });
        return res.end(paginaProduto(p, lojaV));
      }
    } catch (e) { return json(res, 500, { erro: 'vitrine: ' + e.message }); }
  }

  /* Arquivo de midia. Publico porque quem baixa e o servidor da TikTok, sem
     sessao nenhuma: o `PULL_FROM_URL` manda ELA buscar o video. O nome e gerado
     por nos e conferido antes de tocar no disco. */
  if (req.method === 'GET' && req.url.split('?')[0].startsWith('/midia/')) {
    const nome = decodeURIComponent(req.url.split('?')[0].slice('/midia/'.length));
    if (midia.servir(req, res, nome)) { return; }
    return json(res, 404, { erro: 'midia nao encontrada' });
  }

  if (req.url.split('?')[0].startsWith('/oauth/callback/')) {
    const u = new URL(req.url, 'http://x');
    const familia = u.pathname.split('/')[3] || '';
    const code = u.searchParams.get('code') || u.searchParams.get('auth_code');
    const erro = u.searchParams.get('error');
    /* Registra TODA chegada. Sem isto, "nao apareceu token" e indistinguivel de
       "a rede nem chamou de volta" — e sao problemas opostos: um e nosso, o outro
       e do app la. O code nao vai pro log; so o fato de ter vindo. */
    console.log(`[oauth] ${familia} <- code:${code ? 'sim' : 'nao'} erro:${erro || '-'} `
      + `descricao:${u.searchParams.get('error_description') || '-'} state:${u.searchParams.get('state') ? 'veio' : 'faltou'}`);
    const pagina = (titulo, texto, ok) => {
      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title></head>
<body style="font-family:system-ui,sans-serif;background:#fafafa;color:#18181b;display:grid;place-items:center;height:100vh;margin:0">
<div style="max-width:30rem;padding:2rem;text-align:center">
<div style="font-size:2.6rem;color:${ok ? '#15803d' : '#b91c1c'}">${ok ? '✓' : '✖'}</div>
<h1 style="font-size:1.2rem;margin:.6rem 0">${titulo}</h1>
<p style="color:#52525b;line-height:1.55">${texto}</p>
<p style="margin-top:1.4rem"><a href="/crm#redes" style="color:#18181b">Voltar ao painel</a></p>
</div></body></html>`);
    };

    if (erro) { return pagina('A rede recusou', `Motivo: ${erro}. Nada foi salvo.`, false); }
    /* Visita SECA (sem code, sem erro, sem state) nao e um retorno falhado: e o
       verificador da rede conferindo se a URL existe, ou alguem abrindo o link na
       mao. Respondia 400, e pro verificador da TikTok 400 significa "essa URL nao
       presta" — a verificacao de propriedade falhava por causa do nosso codigo de
       status, com a pagina certa na tela. */
    if (!code && !u.search) {
      return pagina('URL de retorno do TikTok', 'Esta página existe para receber a volta da autorização. '
        + 'Não há nada a fazer aqui — a conexão começa no painel, em Conexões com redes sociais.', true);
    }
    if (!code) { return pagina('Retorno sem código', 'A rede voltou sem o código de autorização.', false); }
    try {
      const r = await tk.concluirAutorizacao(familia, code, { state: u.searchParams.get('state') });
      console.log(`[oauth] ${familia} troca do code -> ${r.ok ? 'OK, token guardado' : 'FALHOU: ' + r.motivo}`);
      if (!r.ok) { return pagina('Não consegui concluir', r.motivo, false); }
      return pagina('Conta conectada', `A conta do TikTok (${familia}) está ligada ao painel. Pode fechar esta aba.`, true);
    } catch (e) {
      return pagina('Erro ao concluir', e.message, false);
    }
  }

  // ---- VScrm (opt-in: CRM_ENABLED=1) ----
  if (CRM_ENABLED && req.url.split('?')[0].startsWith('/crm')) {
    const rota = req.url.split('?')[0];

    /* A MARCA — logo, símbolo e favicon.
     *
     * Ficam em arquivo e não embutidos no HTML: o console é uma página só, e
     * enfiar 300 KB de PNG em base64 dentro dela faria a tela inteira baixar de
     * novo a cada abertura. Aqui o navegador guarda a imagem e recarrega só o
     * HTML, que é o que muda.
     *
     * Antes da senha, de propósito: a tela de entrada precisa da marca, e quem
     * ainda não entrou também vê logo.
     */
    if (req.method === 'GET' && MARCA[rota]) {
      try {
        const arq = readFileSync(join(RAIZ_ASSETS, MARCA[rota]));
        res.writeHead(200, {
          'content-type': 'image/png',
          /* Logo muda uma vez por ano. Um dia de cache poupa o download a cada
             abertura, e o `?v=` no HTML força a troca quando mudar mesmo. */
          'cache-control': 'public, max-age=86400',
        });
        return res.end(arq);
      } catch { return json(res, 404, { erro: 'imagem não encontrada' }); }
    }

    if (req.method === 'GET' && rota === '/crm') {
      try {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          /* O painel e UM arquivo que muda a cada deploy, e nao tinha cabecalho
             de cache nenhum. Sem instrucao, o navegador guarda por conta propria
             — e o dono ficava com a tela de ontem enquanto o servidor ja tinha a
             de hoje. Custou uma manha: correcao subia, ele recarregava, nada
             mudava, e os dois lados achavam que o conserto nao funcionou.

             `no-store` porque aqui nao ha o que reaproveitar: e uma pagina so,
             pequena, e servir a versao errada dela quebra o painel inteiro. */
          'cache-control': 'no-store, must-revalidate',
          pragma: 'no-cache',
          expires: '0',
        });
        return res.end(readFileSync(join(HERE, 'crm.html'), 'utf8'));
      } catch (e) { return json(res, 500, { erro: 'crm page: ' + e.message }); }
    }
    // O token do painel chega no header; o ?t= da URL só alimenta o header no front.
    if (barrado(res, LIM_CRM, req, '/crm')) { return; }

    /**
     * Login do painel. Existe para o dashboard NAO aparecer antes de alguem provar
     * que pode ve-lo — sem isso, qualquer um com a URL via nome e telefone de cliente.
     * A comparacao e em tempo constante (segredoIgual), e a rota diz quando o
     * CRM_TOKEN nao esta configurado em vez de deixar o painel aberto em silencio.
     */
    if (req.method === 'GET' && rota === '/crm/api/auth') {
      return json(res, 200, { ...acesso.estado(), login: 'email' });
    }

    /* Primeiro acesso. Quem comprou a licenca abre o console e define a
       propria senha aqui — sem terminal, sem variavel de ambiente, sem
       ninguem ter que "passar" credencial. So funciona enquanto nao houver
       senha: depois disso a rota fecha, senao qualquer um com a URL
       trocaria a senha de um console ja configurado. */
    if (req.method === 'POST' && rota === '/crm/api/criar-acesso') {
      const b = await readBody(req);
      if (corpoEstourou(res, b)) { return; }
      let d; try { d = JSON.parse(b.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
      try {
        acesso.criar(d.senha);
        console.log(`[${new Date().toISOString()}] senha do console definida no primeiro acesso`);
        return json(res, 201, { ok: true });
      } catch (e) {
        return json(res, e.code || 400, { erro: e.message });
      }
    }

    if (req.method === 'POST' && rota === '/crm/api/entrar') {
      const b = await readBody(req);
      if (corpoEstourou(res, b)) { return; }
      let d; try { d = JSON.parse(b.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
      if (acesso.precisaCriar()) {
        return json(res, 409, { erro: 'primeiro acesso', precisaCriar: true });
      }
      /* E-mail + senha. Sem e-mail (tela antiga em cache) vale a senha do dono. */
      const r = usuarios.entrar(d.email || usuarios.emailAdmin(), d.senha);
      if (!r.ok) { return json(res, 401, { erro: r.motivo }); }
      console.log(`[acesso] login ${r.papel} ${r.email}`);
      return json(res, 200, r);
    }
    if (req.method === 'POST' && rota === '/crm/api/sair') {
      usuarios.sair(req.headers['x-crm-token']);
      return json(res, 200, { ok: true });
    }

    /* Troca de senha, ja de dentro do console e com a atual na mao. Dono e
       cliente: cada um troca a PROPRIA, a sessao diz de quem e. */
    if (req.method === 'POST' && rota === '/crm/api/trocar-senha') {
      const eu = usuarios.autenticar(req.headers['x-crm-token']);
      if (!eu) { return json(res, 403, { erro: 'sessao invalida' }); }
      const b = await readBody(req);
      if (corpoEstourou(res, b)) { return; }
      let d; try { d = JSON.parse(b.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
      const r = usuarios.trocarSenha(eu.email, d.atual, d.nova);
      if (r.ok) { console.log(`[acesso] ${eu.email} trocou a senha`); }
      return json(res, r.ok ? 200 : r.code, r.ok ? { ok: true } : { erro: r.motivo });
    }

    /* Daqui para baixo e dado de cliente. Sem senha definida, o console fica
       fechado: antes, CRM_TOKEN vazio liberava o painel inteiro em silencio
       para quem tivesse a URL. */
    const quem = usuarios.autenticar(req.headers['x-crm-token']);
    if (!quem) {
      return json(res, 403, acesso.precisaCriar()
        ? { erro: 'console sem senha definida', precisaCriar: true }
        : { erro: 'sessão expirada — entre de novo' });
    }
    /* CLIENTE so enxerga a propria conta. O resto do console e da Veloso:
       cliente, funil, caixa e WhatsApp do dono. */
    if (quem.papel === 'cliente') {
      if (req.method === 'GET' && rota === '/crm/api/minha-conta') {
        const c = clientes.listar().find((x) => x.id === quem.clienteId);
        if (!c) { return json(res, 404, { erro: 'conta nao encontrada' }); }
        const k = (c.contratos || []).at(-1);
        return json(res, 200, {
          papel: 'cliente', nome: c.nome, email: quem.email, whatsapp: c.whatsapp,
          plano: (c.produtos || []).map((p) => clientes.todasOfertas().find((o) => o.code === p)?.nome || p),
          ciclo: c.ciclo, liberacoes: c.liberacoes, adendos: c.adendos || [], trocaAgendada: c.trocaAgendada || null,
          licenca: c.licencaVigente, situacao: c.situacao,
          contrato: k ? { numero: k.numero, versao: k.versao, geradoEm: k.geradoEm, valorCiclo: k.valorCiclo } : null,
          documento: c.documento,
        });
      }
      if (req.method === 'GET' && rota === '/crm/api/minha-conta/contrato.pdf') {
        const a = clientes.arquivoContrato(quem.clienteId);
        if (!a) { return json(res, 404, { erro: 'contrato nao encontrado' }); }
        res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${a.nome}"`, 'cache-control': 'no-store' });
        return res.end(a.buf);
      }
      return json(res, 403, { erro: 'área restrita ao administrador', papel: 'cliente' });
    }
    /* VENDEDOR: so o Atendimento. A porta e aqui, no servidor — esconder o menu
       na tela nao protege nada. */
    if (quem.papel === 'vendedor') {
      if (req.method === 'GET' && rota === '/crm/api/minha-conta') { return json(res, 200, { papel: 'vendedor', email: quem.email, ...quemAtende(quem) }); }
      const livre = (req.method === 'GET' && ['/crm/api/atendimentos', '/crm/api/atendimentos/historico', '/crm/api/atendimentos/historico/detalhe', '/crm/api/canais/telegram', '/crm/api/seguranca/pendentes'].includes(rota))
        || (req.method === 'POST' && ['/crm/api/atendimentos/responder', '/crm/api/atendimentos/assumir', '/crm/api/atendimentos/devolver', '/crm/api/atendimentos/encerrar'].includes(rota));
      if (!livre) { return json(res, 403, { erro: 'área restrita ao administrador', papel: 'vendedor' }); }
    }
    if (req.method === 'GET' && rota === '/crm/api/minha-conta') { return json(res, 200, { papel: 'admin', email: quem.email }); }
    /* Qualificacao e roteamento: a matriz, as equipes (setores dos operadores) e
       quem tem acesso de vendedor. */
    if (req.method === 'GET' && rota === '/crm/api/qualificacao') {
      const ops = operadores.listar();
      const acessos = usuarios.acessosVendedores();
      const equipes = {};
      for (const o of operadores.ativos(ops)) { const e = operadores.norm(o.setor); (equipes[e] ||= []).push(o.nome); }
      return json(res, 200, {
        ...qualif.config(), condicoes: qualif.CONDICOES, destinos: qualif.DESTINOS, intencoes: qualif.INTENCOES, prazos: qualif.PRAZOS,
        equipes, operadores: ops.map((o) => ({ ...o, acesso: acessos.find((a) => a.operadorId === o.id) || null })),
      });
    }
    if (req.method === 'GET' && rota === '/crm/api/painel') { return json(res, 200, crm.painel()); }
    if (req.method === 'GET' && rota === '/crm/api/status') { return json(res, 200, crm.statusIntegracoes(canais.estado())); }
    if (req.method === 'GET' && rota === '/crm/api/indicacao') { return json(res, 200, crm.painelIndicacao()); }
    if (req.method === 'GET' && rota === '/crm/api/redes') { return json(res, 200, { credenciais: CREDENCIAL }); }
    // TikTok: o painel LE o estado e MANDA testar, mas nao grava credencial por HTTP.
    // Gravar token via endpoint web contradiz a regra desta tela ("a credencial nao
    // fica gravada") e poria app_secret num POST. A configuracao mora na CLI, que
    // guarda em ~/.qa-gate/vstiktok com arquivo 0600. O diagnostico ja sai mascarado.
    if (req.method === 'GET' && rota === '/crm/api/tiktok') { return json(res, 200, tiktokDiagnostico()); }
    if (req.method === 'GET' && rota === '/crm/api/estoque') {
      return json(res, 200, estoque.painel({ limiteProdutos: limitesAtuais().produtos }));
    }
    // Telas que eram casca: leem recibo do gate, dinheiro e cruzamento de dado real.
    if (req.method === 'GET' && rota === '/crm/api/auditor') { return json(res, 200, await vspainel.painelAuditor()); }
    if (req.method === 'GET' && rota === '/crm/api/financeiro') { return json(res, 200, await vspainel.painelFinanceiro()); }
    if (req.method === 'GET' && rota === '/crm/api/relatorios') { return json(res, 200, await vspainel.painelRelatorios()); }
    if (req.method === 'GET' && rota === '/crm/api/conta') { return json(res, 200, await vspainel.painelConta()); }
    // O Quebra-Galho é produto separado, com servidor proprio. O painel fala com ele
    // por HTTP — nao por import. Assim ele aparece aqui dentro sem que um vire
    // dependencia de compilacao do outro, e fora do ar vira aviso, nao tela quebrada.
    if (req.method === 'GET' && rota === '/crm/api/quebragalho') { return json(res, 200, await painelQuebraGalho()); }
    if (req.method === 'GET' && rota === '/crm/api/tiktok/app') {
      // O redirect e FIXO e derivado do dominio do painel — nao ha o que o usuario
      // digitar errado, e ele so cola esse valor uma vez no painel do TikTok.
      const origem = baseRedirect();
      return json(res, 200, {
        diagnostico: tk.diagnostico(),
        redirects: ['open', 'business', 'shop'].reduce((a, f) => ({ ...a, [f]: `${origem}/oauth/callback/${f}` }), {}),
        origem,
        verificacao: tk.getVerificacao(),
      });
    }
    /* Upload do video. NAO passa pelo leitor de JSON (teto de 256 KB): vai
       direto pro disco em streaming, com teto proprio. */
    if (req.method === 'POST' && rota === '/crm/api/midia') {
      if (usuarios.autenticar(req.headers['x-crm-token'])?.papel !== 'admin') { return json(res, 403, { erro: 'senha ausente ou invalida' }); }
      const u = new URL(req.url, 'http://x');
      const nome = u.searchParams.get('nome') || '';
      /* Foto e video entram pela mesma porta mas com tetos diferentes: 256 MB de
         JPEG numa vitrine so serve pra deixar a loja lenta pro cliente. */
      const imagem = u.searchParams.get('tipo') === 'imagem'
        || String(req.headers['content-type'] || '').startsWith('image/');
      const r = await midia.receber(req, nome, imagem
        ? { padrao: '.jpg', maxBytes: midia.MAX_IMAGEM_BYTES }
        : { padrao: '.mp4', maxBytes: midia.MAX_BYTES });
      if (!r.ok) { return json(res, 413, { erro: r.motivo }); }
      const origem = process.env.PAINEL_URL || 'https://bolsocheio.velososolution.com.br';
      return json(res, 201, { ...r, imagem, url: `${origem}/midia/${r.arquivo}` });
    }
    if (req.method === 'GET' && rota === '/crm/api/midia') {
      if (usuarios.autenticar(req.headers['x-crm-token'])?.papel !== 'admin') { return json(res, 403, { erro: 'senha ausente ou invalida' }); }
      const origem = process.env.PAINEL_URL || 'https://bolsocheio.velososolution.com.br';
      return json(res, 200, { arquivos: midia.listar().map((a) => ({ ...a, url: `${origem}/midia/${a.arquivo}` })), maxBytes: midia.MAX_BYTES });
    }
    /* Catalogo e campanhas EXISTIAM no motor e nao tinham porta: o painel
       alcancava 2 das 10 capacidades do modulo. Vender "catalogo e campanhas"
       no Modulo A com o codigo pronto e sem rota e prometer o que nao se
       entrega — nao por falta de codigo, por falta de porta. */
    /* Estado da conexao com a TikTok Shop, do jeito que um revisor precisa ver:
       conectada ou nao, QUAL loja, e a prova da ultima chamada real. */
    if (req.method === 'GET' && rota === '/crm/api/tiktok/shop') {
      const d = tk.diagnostico();
      const cfg = tk.getConfig();
      const fam = d.familias.shop || {};
      return json(res, 200, {
        appPronto: fam.appConfigurado === true,
        faltando: fam.faltando || [],
        conectada: fam.autorizado === true && Boolean(cfg.shopCipher),
        autorizado: fam.autorizado === true,
        loja: cfg.shopCipher ? { nome: cfg.shopNome || null, id: cfg.shopId || null } : null,
        ultimaSincronizacao: tk.ultimaSincronizacao(),
        publicados: Object.keys(tk.publicados()).length,
      });
    }
    if (req.method === 'GET' && rota === '/crm/api/tiktok/loja') {
      const cfg = tk.getConfig();
      /* Sem loja escolhida NAO se chama a API: a TikTok responde erro cru e a
         tela mostraria falha onde o que falta e um passo de configuracao. */
      if (!cfg.shopCipher) {
        return json(res, 200, { pronto: false, motivo: 'nenhuma loja do TikTok Shop selecionada ainda', produtos: [], config: cfg });
      }
      const r = await tk.listarProdutos({ pageSize: 50 });
      return json(res, 200, {
        pronto: true, config: cfg,
        produtos: r.ok ? (r.dados?.products || r.produtos || []) : [],
        ...(r.ok ? {} : { motivo: r.motivo }),
        /* O estoque daqui, com a marca de quem ja foi pra la — e o que permite
           a tela mostrar "publicar" e "republicar" em vez de deixar o lojista
           adivinhar o que ja subiu. */
        doEstoque: estoque.listar().slice(0, 200),
        publicados: tk.publicados(),
      });
    }
    if (req.method === 'GET' && rota === '/crm/api/tiktok/campanhas') {
      const cfg = tk.getConfig();
      if (!cfg.anuncianteId) {
        return json(res, 200, { pronto: false, motivo: 'nenhuma conta de anuncio selecionada ainda', campanhas: [], config: cfg });
      }
      const lista = await tk.listarCampanhas({});
      /* O relatorio e complemento: campanha sem numero ainda e campanha. Se ele
         falhar, a lista continua aparecendo em vez de a tela inteira sumir. */
      const hoje = new Date().toISOString().slice(0, 10);
      const de = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
      const rel = await tk.relatorioCampanhas({ de, ate: hoje }).catch(() => ({ ok: false }));
      return json(res, 200, {
        pronto: true, config: cfg,
        campanhas: lista.ok ? (lista.dados?.list || lista.campanhas || []) : [],
        ...(lista.ok ? {} : { motivo: lista.motivo }),
        relatorio: rel.ok ? (rel.dados?.list || rel.relatorio || []) : [],
        periodo: { de, ate: hoje },
      });
    }
    if (req.method === 'GET' && rota === '/crm/api/tiktok/publicacao') {
      const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
      return json(res, 200, await tk.statusPublicacao(id));
    }
    /* `/financeiro` ja era o consolidado do VSpainel (receita do funil, estoque
       parado). O livro-caixa e outra coisa e ganha nome proprio — duas rotas com
       o mesmo caminho fazem a segunda nunca responder, calada. */
    /* Canais. O QR vai junto do status de proposito: a tela pergunta "como esta
       o canal" e recebe o que precisa desenhar, sem uma segunda rota so pro QR
       que poderia responder um codigo ja vencido. */
    if (req.method === 'GET' && rota === '/crm/api/clientes') { return json(res, 200, clientes.painel()); }
    /* Checkout: o que a tela precisa pra montar o cartão (chave PUBLICA) e a
       tabela de servicos. Nada secreto sai daqui. */
    if (req.method === 'GET' && rota === '/crm/api/checkout/config') {
      const k = pagar.chavePublicaCartao();
      return json(res, 200, { ofertas: clientes.todasOfertas(), ciclos: clientes.CICLOS, cartao: k, modoTeste: clientes.modoTeste(), contato: process.env.VITRINE_WHATSAPP || '553175536010' });
    }
    /* A tela do Pix pergunta aqui enquanto espera. Se o webhook ainda nao
       chegou, consulta o Mercado Pago direto — e libera a chave se ja pagou. */
    if (req.method === 'GET' && rota === '/crm/api/checkout/estado') {
      const q = new URL(req.url, 'http://x').searchParams;
      let e = clientes.estadoCheckout(q.get('id'), q.get('ref'));
      if (e.ok && e.estado === 'AGUARDANDO' && e.pagamentoId) {
        const a = await pagar.atualizarEstado(e.pagamentoId);
        if (a.ok && ['CONFIRMADO', 'DISPONIVEL'].includes(a.pagamento?.estado)) {
          if (a.mudou) { const l = fin.lancarPagamento(a.pagamento); if (l.ok && !l.repetido) { console.log(`[caixa] entrada de ${a.pagamento.id} lancada`); } }
          await liberarSeForCliente(a.pagamento);
          e = clientes.estadoCheckout(q.get('id'), q.get('ref'));
        }
      }
      return json(res, e.ok ? 200 : 404, e);
    }
    /* PDF do contrato (gerado ou assinado). O painel busca com o header da
       sessao e baixa como arquivo — link direto exigiria senha na URL. */
    if (req.method === 'GET' && rota === '/crm/api/clientes/contrato.pdf') {
      const q = new URL(req.url, 'http://x').searchParams;
      const a = clientes.arquivoContrato(q.get('id'), q.get('v'), { assinado: q.get('assinado') === '1' });
      if (!a) { return json(res, 404, { erro: 'contrato nao encontrado' }); }
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${a.nome}"`, 'cache-control': 'no-store' });
      return res.end(a.buf);
    }
    /* O PDF assinado chega CRU (application/pdf), com teto proprio: o limite
       geral de 256 KB e pra JSON, e um contrato assinado passa disso facil. */
    if (req.method === 'POST' && rota === '/crm/api/clientes/assinado') {
      const q = new URL(req.url, 'http://x').searchParams;
      const corpo = await lerCorpoLimitado(req, 10 * 1024 * 1024);
      if (corpo.excedeu) { return json(res, 413, { erro: 'PDF acima de 10 MB — confira se é o arquivo do contrato' }); }
      const r = clientes.receberAssinado(q.get('id'), corpo.buffer, { versao: q.get('v') });
      return json(res, r.ok ? 200 : 400, r.ok ? r : { ...r, erro: r.motivo });
    }
    if (req.method === 'GET' && rota === '/crm/api/planos') {
      return json(res, 200, { ...planos.tabela(), assinatura: planos.assinatura(), limiteAtendentes: planos.limiteDeAtendentes() });
    }
    if (req.method === 'GET' && rota === '/crm/api/operadores') {
      /* Os setores vem do FLUXO, nao de uma lista cravada: e o fluxo que decide
         pra onde o cliente e encaminhado, entao e ele que diz quais setores
         precisam de gente. Setor no fluxo sem operador = cliente transferido
         pro vazio, e isso tem de aparecer na tela. */
      const fx = bot.getFluxo();
      const setores = new Set((canais.estado().config?.setores || []).map((x) => operadores.norm(x)));
      for (const p of fx?.passos || []) {
        if (p.departamento) { setores.add(operadores.norm(p.departamento)); }
        for (const o of p.opcoes || []) { if (o.departamento) { setores.add(operadores.norm(o.departamento)); } }
      }
      return json(res, 200, operadores.painel([...setores]));
    }
    if (req.method === 'GET' && rota === '/crm/api/canais') {
      return json(res, 200, { ...canais.estado(), saude: await canais.saude(), perfilAnterior: canais.perfilAnterior(),
        /* Sobe junto: alerta de tomada de conta que so existe no log e alerta
           que ninguem ve a tempo. */
        invasoes: canais.invasoes() });
    }
    /* Rota PROPRIA porque ler o perfil baixa a FOTO do servidor da Meta: pendurar
       isso no status faria a tela inteira esperar por uma imagem. */
    /* Resultado comercial de um canal: receita comprovada, pedidos, conversao,
       oportunidades e campanhas. Leads atendidos saem do CRM (trilha do canal). */
    if (req.method === 'GET' && rota === '/crm/api/resultados') {
      const u = new URL(req.url, 'http://x');
      const canal = u.searchParams.get('canal') === 'telegram' ? 'telegram' : 'whatsapp';
      const dias = [7, 30, 90].includes(Number(u.searchParams.get('dias'))) ? Number(u.searchParams.get('dias')) : 30;
      const desde = Date.now() - dias * 86400000;
      let atendidos = 0; let peloBot = 0;
      for (const l of crm.listar()) {
        if (ehTelegram(l.telefone) !== (canal === 'telegram')) { continue; }
        const inter = (l.historico || []).filter((h) => h.tipo === 'interacao' && new Date(h.quando).getTime() >= desde);
        if (!inter.some((h) => h.direcao === 'entrada')) { continue; }
        atendidos += 1;
        // Pelo bot = ninguem da equipe precisou responder essa pessoa no periodo.
        if (!inter.some((h) => h.direcao === 'saida' && h.autor === 'atendente')) { peloBot += 1; }
      }
      const tg = canais.telegramInfo();
      return json(res, 200, {
        ...resultados.resumo({ canal, dias, pagamentos: pagar.listar(), leads: { atendidos, peloBot } }),
        linkBot: canal === 'telegram' ? tg.link || null : null,
      });
    }
    /* Campanhas do Telegram: as montadas no assistente (vscampanhas) mais os
       links antigos, criados so com nome, que aparecem como "Captar clientes". */
    if (req.method === 'GET' && rota === '/crm/api/campanhas') {
      const u = new URL(req.url, 'http://x');
      const dias = [7, 30, 90].includes(Number(u.searchParams.get('dias'))) ? Number(u.searchParams.get('dias')) : 30;
      const r = resultados.resumo({ canal: 'telegram', dias, pagamentos: pagar.listar() });
      const num = new Map(r.porCampanha.map((c) => [c.codigo, c]));
      const doAssistente = campanhasTg.listar().filter((c) => c.canal === 'telegram');
      const conhecidos = new Set(doAssistente.map((c) => c.codigo));
      const metricas = (c) => { const n = num.get(c.codigo); return n ? { entradas: n.entradas, conversas: n.conversas, pedidos: n.pedidos, concluidos: n.concluidos, receitaCentavos: n.receitaCentavos } : null; };
      const lista = [
        ...doAssistente.map((c) => ({ ...c, metricas: ['ativa', 'encerrada'].includes(c.estado) ? metricas(c) : null })),
        ...r.porCampanha.filter((c) => !conhecidos.has(c.codigo)).map((c) => ({
          id: null, legado: true, canal: 'telegram', codigo: c.codigo, nome: c.nome, objetivo: 'captar', objetivoTexto: campanhasTg.OBJETIVOS.captar,
          estado: c.arquivada ? 'encerrada' : 'ativa', estadoTexto: c.arquivada ? 'Encerrada' : 'Ativa', criadaEm: c.criadaEm, metricas: metricas(c),
        })),
      ].sort((a, b) => String(b.atualizadaEm || b.criadaEm).localeCompare(String(a.atualizadaEm || a.criadaEm)));
      return json(res, 200, {
        dias, campanhas: lista, linkBot: canais.telegramInfo().link || null,
        catalogo: estoque.doAtendimento().map((p) => ({ sku: p.sku, nome: p.nome, descricao: p.descricao, precoCentavos: p.precoCentavos, precoDeCentavos: p.precoDeCentavos, imagem: p.imagem, esgotado: p.esgotado })),
        limites: campanhasTg.LIMITE,
      });
    }
    /* Tela do Telegram: estado do bot e se ha token guardado. O token nao sai. */
    if (req.method === 'GET' && rota === '/crm/api/canais/telegram') {
      return json(res, 200, canais.telegramInfo());
    }
    if (req.method === 'GET' && rota === '/crm/api/canais/perfil') {
      return json(res, 200, { ok: true, perfil: await canais.perfilAtual() });
    }
    /* Caixa de entrada do atendente. Junta o que o CRM sabe do lead com o que a
       Micaela coletou antes de chamar gente — e e por isso que o especialista
       nao comeca perguntando "qual e o problema?". */
    /* HISTORICO: atendimentos encerrados, pra auditar depois — quem atendeu,
       quem encerrou, quanto durou, a nota do cliente. O vendedor ve so os dele. */
    if (req.method === 'GET' && (rota === '/crm/api/atendimentos/historico' || rota === '/crm/api/atendimentos/historico/detalhe')) {
      const u = new URL(req.url, 'http://x');
      const leads = crm.listar();
      const porTel = new Map(leads.map((l) => [l.telefone, l]));
      const eu = quem.papel === 'vendedor' ? quemAtende(quem) : null;
      const todosEnc = proto.encerrados();
      const doVendedor = (p) => !eu || p.atendidoPor?.operadorId === eu.operadorId || p.encerradoPor?.operadorId === eu.operadorId
        || porTel.get(p.de)?.comercial?.responsavel?.operadorId === eu.operadorId;
      const linha = (p) => {
        const l = porTel.get(p.de) || null;
        /* A 1a mensagem e gravada ANTES de o protocolo nascer (milissegundos):
           a janela comeca 5 min antes da abertura, sem invadir o atendimento
           anterior da mesma pessoa. */
        const anterior = todosEnc.filter((x) => x.de === p.de && x.encerradoEm < p.abertoEm).map((x) => x.encerradoEm).sort().pop() || '';
        const iniJanela = [new Date(new Date(p.abertoEm).getTime() - 300000).toISOString(), anterior].sort().pop();
        const inter = (l?.historico || []).filter((h) => h.tipo === 'interacao' && h.quando > iniJanela && h.quando <= new Date(new Date(p.encerradoEm).getTime() + 60000).toISOString());
        return {
          numero: p.numero, telefone: p.de, nome: l?.nome || null, canal: ehTelegram(p.de) ? 'telegram' : 'whatsapp',
          abertoEm: p.abertoEm, encerradoEm: p.encerradoEm, duracaoMin: Math.max(0, Math.round((new Date(p.encerradoEm) - new Date(p.abertoEm)) / 60000)),
          motivo: p.motivoEncerramento || null, encerradoPor: p.encerradoPor || null, atendidoPor: p.atendidoPor || null,
          comGente: [proto.ESTADOS.NA_FILA, proto.ESTADOS.COM_HUMANO].includes(p.estadoAntes) || !!p.atendidoPor,
          departamento: p.departamento || null, avaliacao: p.avaliacao || null, mensagens: inter.length,
          tier: l?.comercial?.decisao?.tier || null, equipe: l?.comercial?.decisao?.equipe || null,
          ...(rota.endsWith('/detalhe') ? { historico: inter, resumo: l?.comercial?.ficha ? qualif.resumo(l.comercial.ficha) : null } : {}),
        };
      };
      if (rota.endsWith('/detalhe')) {
        const p = proto.buscarPorNumero(u.searchParams.get('numero'));
        if (!p || p.estado !== proto.ESTADOS.ENCERRADO || !doVendedor(p)) { return json(res, 404, { erro: 'atendimento não encontrado' }); }
        return json(res, 200, linha(p));
      }
      const canal = u.searchParams.get('canal');
      const dias = [1, 7, 30, 90].includes(Number(u.searchParams.get('dias'))) ? Number(u.searchParams.get('dias')) : 30;
      const desde = new Date(Date.now() - dias * 86400000).toISOString();
      const lista = proto.encerrados().filter((p) => p.encerradoEm >= desde && doVendedor(p)).map(linha)
        .filter((x) => !canal || x.canal === canal).filter((x) => x.mensagens > 0 || x.comGente);
      const notas = lista.map((x) => x.avaliacao?.nota).filter((n) => n != null);
      return json(res, 200, {
        dias, atendimentos: lista.slice(0, 500), total: lista.length,
        resumo: {
          comGente: lista.filter((x) => x.comGente).length,
          porCliente: lista.filter((x) => x.encerradoPor?.tipo === 'cliente').length,
          porAtendente: lista.filter((x) => x.encerradoPor?.tipo === 'atendente').length,
          porInatividade: lista.filter((x) => x.encerradoPor?.tipo === 'inatividade').length,
          avaliados: notas.length, pedidas: lista.filter((x) => x.avaliacao).length,
          media: notas.length ? Math.round((notas.reduce((a, b) => a + b, 0) / notas.length) * 10) / 10 : null,
        },
      });
    }
    if (req.method === 'GET' && rota === '/crm/api/atendimentos') {
      const esperando = bot.emAtendimento();
      const leads = crm.listar();
      const pagamentos = pagar.listar();
      const conversas = leads
        .map((l) => {
          const inter = (l.historico || []).filter((h) => h.tipo === 'interacao');
          if (!inter.length) { return null; }
          const fila = esperando.find((e) => e.telefone === l.telefone) || null;
          return {
            id: l.id,
            telefone: l.telefone,
            canal: ehTelegram(l.telefone) ? 'telegram' : 'whatsapp',
            nome: l.nome,
            etapa: l.etapa,
            status: l.status,
            faixa: l.faixa,
            score: l.score,
            mensagens: inter.length,
            ultima: inter[inter.length - 1],
            esperandoGente: !!fila,
            /* Quem precisa de atencao AGORA: aguardando = foi pra gente e ninguem
               pegou; com-vendedor = alguem ja assumiu; com-bot = o bot esta dando
               conta. Pedido pago sem ninguem na conversa fecha como concluido. */
            situacao: fila ? (fila.assumida ? 'com-vendedor' : 'aguardando') : 'com-bot',
            assumidaEm: fila?.assumidaEm || null,
            transferidaEm: fila?.transferidaEm || null,
            pedido: resultados.ultimoPedido(l.telefone, pagamentos),
            desde: fila?.desde || null,
            departamento: fila?.departamento || null,
            contexto: fila?.contexto || {},
            /* O protocolo na lista e o que o atendente le em voz alta quando o
               cliente liga. Sem ele na tela, ele teria que caçar no historico. */
            protocolo: (proto.aberto(l.telefone) || proto.ultimoEncerrado(l.telefone) || {}).numero || null,
            protocoloEstado: (proto.aberto(l.telefone) || proto.ultimoEncerrado(l.telefone) || {}).estado || null,
            historico: l.historico || [],
            assumidaPor: fila?.assumidaPor || null,
            comercial: l.comercial ? {
              ficha: l.comercial.ficha || null,
              decisao: l.comercial.decisao || null,
              responsavel: l.comercial.responsavel || null,
              resumo: l.comercial.ficha ? qualif.resumo(l.comercial.ficha) : null,
              faltando: qualif.faltando(l.comercial.ficha || {}),
            } : null,
          };
        })
        .filter(Boolean)
        /* Encerrado SAI da lista: vai pro Historico. Fica quem tem atendimento
           aberto ou esta na fila; conversa antiga sem protocolo nenhum (de antes
           de todo atendimento ter um) fica 24 h e depois so no historico do lead. */
        .filter((c) => c.esperandoGente || c.protocoloEstado && c.protocoloEstado !== 'encerrado'
          || (!c.protocolo && (Date.now() - new Date(c.ultima?.quando || 0)) < 86400000))
        .filter((c) => quem.papel !== 'vendedor' || vendedorVe(c, quemAtende(quem)))
        .sort((a, b) => {
          // Quem espera gente vem primeiro; depois, conversa mais recente.
          if (a.esperandoGente !== b.esperandoGente) { return a.esperandoGente ? -1 : 1; }
          return String(b.ultima?.quando || '').localeCompare(String(a.ultima?.quando || ''));
        });
      return json(res, 200, { conversas, esperando: esperando.length, canal: canais.estado() });
    }
    if (req.method === 'GET' && rota === '/crm/api/bot') { return json(res, 200, bot.painel()); }
    /* Segurança de quem atende e de quem é atendido: config, responsáveis e
       o que aconteceu (auditoria). */
    /* A sirene do painel pergunta aqui a cada poucos segundos: leve de propósito. */
    if (req.method === 'GET' && rota === '/crm/api/seguranca/pendentes') {
      return json(res, 200, { pendentes: seguranca.pendentes() });
    }
    if (req.method === 'GET' && rota === '/crm/api/seguranca') {
      const c = bot.getConfig();
      return json(res, 200, {
        emergencia: c.emergencia || {}, moderacao: c.moderacao || {},
        avisosAntesDePausa: c.avisosAntesDePausa, horasDePausa: c.horasDePausa,
        responsaveis: seguranca.responsaveis(), auditoria: seguranca.auditoria(30),
        canal: (canais.estado().canais || []).find((c) => /whatsapp/.test(c.nome || c.canal || ''))?.estado || null,
      });
    }
    if (req.method === 'GET' && rota === '/crm/api/documentos') { return json(res, 200, docs.painel()); }
    if (req.method === 'GET' && rota === '/crm/api/caixa') {
      const u = new URL(req.url, 'http://x');
      return json(res, 200, fin.painel({ de: u.searchParams.get('de'), ate: u.searchParams.get('ate') }));
    }
    if (req.method === 'GET' && rota === '/crm/api/pagamentos') {
      const origem = process.env.PAINEL_URL || 'https://bolsocheio.velososolution.com.br';
      const prov = pagar.provedorAtual();
      return json(res, 200, {
        painel: pagar.painel(),
        pagamentos: pagar.listar().slice(-40).reverse(),
        provedor: prov,
        provedores: pagar.PROVEDORES,
        // Cada provedor tem a SUA URL de webhook: cadastrar a errada e nao receber nada.
        urlWebhook: `${origem}/webhook/${prov.nome === 'mercadopago' ? 'mercadopago' : 'asaas'}`,
        // Aceito também, pra quem já cadastrou neste formato no painel do gateway.
        urlWebhookAlternativa: prov.nome === 'mercadopago' ? `${origem}/api/webhooks/mercadopago` : null,
        /* Uma URL por ambiente: no painel do Mercado Pago o modo de teste e o de
           producao sao cadastros separados, com segredos diferentes. */
        urlWebhookTeste: prov.nome === 'mercadopago' ? `${origem}/api/webhooks/mercadopago/teste` : null,
        urlWebhookProducao: prov.nome === 'mercadopago' ? `${origem}/api/webhooks/mercadopago/producao` : null,
      });
    }
    /* Um produto so — a tela de ver/editar nao deve baixar o catalogo inteiro. */
    if (req.method === 'GET' && rota === '/crm/api/estoque/produto') {
      const sku = new URL(req.url, 'http://x').searchParams.get('sku') || '';
      const p = estoque.obter(sku);
      if (!p) { return json(res, 404, { erro: `produto "${sku}" nao encontrado` }); }
      return json(res, 200, { produto: p, historico: estoque.historico(sku, 20) });
    }
    if (req.method === 'GET' && rota === '/crm/api/estoque/publicados') {
      const origem = process.env.PAINEL_URL || 'https://bolsocheio.velososolution.com.br';
      return json(res, 200, { publicados: estoque.publicados(), urlVitrine: `${origem}/vitrine`, reservas: estoque.reservas().slice(0, 100) });
    }
    if (req.method === 'GET' && rota === '/crm/api/estoque/reservas') {
      return json(res, 200, { reservas: estoque.reservas(), excluidos: estoque.excluidos().map(estoque.resumir) });
    }
    if (req.method === 'GET' && rota === '/crm/api/estoque/lotes') {
      const origem = process.env.PAINEL_URL || 'https://bolsocheio.velososolution.com.br';
      return json(res, 200, {
        lotes: estoque.lotes(),
        canais: estoque.FORMATOS,
        urlVitrine: `${origem}/vitrine`,
        vitrineConfigurada: Boolean(process.env.VITRINE_WHATSAPP),
      });
    }
    /* Download do lote: sai como ARQUIVO, com o conteudo CONGELADO no momento da
       criacao — regerar agora daria outro resultado, e ai "reimportar o lote 7"
       nao quer dizer mais nada. */
    if (req.method === 'GET' && rota === '/crm/api/estoque/lote') {
      const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
      const l = estoque.obterLote(id);
      if (!l) { return json(res, 404, { erro: `lote "${id}" nao encontrado` }); }
      res.writeHead(200, {
        'content-type': l.tipo,
        'content-disposition': `attachment; filename="${l.id}-${l.arquivo}"`,
        'x-vs-incluidos': String(l.incluidos),
        'x-vs-recusados': String(l.recusados.length),
      });
      return res.end(l.conteudo);
    }
    if (req.method === 'GET' && rota === '/crm/api/estoque/historico') {
      return json(res, 200, { movimentos: estoque.historico(new URL(req.url, 'http://x').searchParams.get('sku')) });
    }
    // Download do feed: sai como ARQUIVO, nao como JSON — e o que o Google e a Meta
    // consomem. Os recusados vao no header, pra tela poder avisar sem baixar duas vezes.
    if (req.method === 'GET' && rota === '/crm/api/estoque/exportar') {
      const canal = new URL(req.url, 'http://x').searchParams.get('canal') || 'json';
      const r = estoque.exportar(canal, { loja: process.env.VSESTOQUE_LOJA, site: process.env.VSESTOQUE_SITE });
      if (!r.ok) { return json(res, 400, { erro: r.motivo }); }
      res.writeHead(200, {
        'content-type': r.tipo,
        'content-disposition': `attachment; filename="${r.arquivo}"`,
        'x-vs-incluidos': String(r.incluidos),
        'x-vs-recusados': String(r.recusados.length),
      });
      return res.end(r.conteudo);
    }
    if (req.method === 'POST' && rota === '/crm/api/tiktok/testar') {
      const b = await readBody(req);
      if (corpoEstourou(res, b)) { return; }
      let d; try { d = JSON.parse(b.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
      const familia = String(d.familia || '').toLowerCase();
      if (!['open', 'business', 'shop'].includes(familia)) { return json(res, 400, { erro: 'familia invalida' }); }
      return json(res, 200, await tiktokTestar(familia));
    }
    // Teste de conexao: a credencial e USADA e descartada — nao gravamos token aqui.
    if (req.method === 'POST' && rota === '/crm/api/redes/testar') {
      const b = await readBody(req);
      if (corpoEstourou(res, b)) { return; }
      let d; try { d = JSON.parse(b.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
      const r = await testarConexao(d.rede, d.cred || {});
      return json(res, 200, r);
    }
    /* Foto do fluxo: rota propria porque imagem nao cabe no limite de corpo do
       resto do console (256 KB). Aqui vale ate ~5 MB de imagem. */
    if (req.method === 'POST' && rota === '/crm/api/bot/midia') {
      const r0 = await lerCorpoLimitado(req, 8 * 1024 * 1024);
      if (r0.excedeu) { return json(res, 413, { erro: 'imagem grande demais — o máximo é 5 MB' }); }
      let d; try { d = JSON.parse(r0.buffer.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
      const r = bot.salvarMidia(d);
      return json(res, r.ok ? 200 : 400, r.ok ? r : { ...r, erro: r.motivo });
    }
    if (req.method === 'POST' && rota.startsWith('/crm/api/')) {
      const b = await readBody(req);
      if (corpoEstourou(res, b)) { return; }
      let d; try { d = JSON.parse(b.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
      let r;
      switch (rota) {
        case '/crm/api/perfil': r = vspainel.salvarPerfil(d); break;
        case '/crm/api/tiktok/verificacao':
          r = d.limpar ? tk.limparVerificacao() : tk.salvarVerificacao(d);
          break;
        case '/crm/api/tiktok/app': {
          r = tk.salvarCredencial(d.familia, { ...d.cred, redirectUri: `${baseRedirect()}/oauth/callback/${d.familia}` });
          break;
        }
        /* Onde a rede vai devolver a pessoa. So aceita o que RESPONDE de verdade:
           salvar um endereco que nao existe faria a autorizacao falhar la na
           frente, longe de quem digitou. */
        case '/crm/api/tiktok/redirect-base': {
          const base = String(d.base || '').trim().replace(/\/+$/, '');
          if (!/^https:\/\/[a-z0-9.-]+$/i.test(base)) { r = { ok: false, motivo: 'informe um endereco https, so o dominio' }; break; }
          try {
            const teste = await fetch(`${base}/oauth/callback/open`, { redirect: 'manual' });
            if (!teste.ok) { r = { ok: false, motivo: `${base}/oauth/callback/open respondeu ${teste.status} — esse endereco nao serve` }; break; }
          } catch (e) { r = { ok: false, motivo: `nao consegui alcancar ${base}: ${e.message}` }; break; }
          tk.salvarConfig({ redirectBase: base });
          r = { ok: true, base };
          break;
        }
        case '/crm/api/tiktok/autorizar': {
          const origem = baseRedirect();
          /* Pede o MINIMO por padrao. Escopo que o app ainda nao teve aprovado
             derruba a autorizacao inteira com "access_denied" — e o erro nao diz
             qual escopo foi, entao quem pede tudo de uma vez fica sem saber se o
             problema e a conta, o app ou o redirect. A tela marca o que quer a
             mais; aqui so passa o que esta na lista conhecida. */
          const permitidos = new Set(Object.values(tk.auth.ESCOPOS));
          const pedidos = Array.isArray(d.escopos) ? d.escopos.filter((e) => permitidos.has(e)) : [];
          const escopos = [tk.auth.ESCOPOS.perfil, ...pedidos.filter((e) => e !== tk.auth.ESCOPOS.perfil)];
          r = tk.iniciarAutorizacao(d.familia, {
            redirectUri: `${origem}/oauth/callback/${d.familia}`,
            escopos,
            serviceId: d.serviceId,
          });
          break;
        }
        /* A chave do Asaas ENTRA por aqui e nunca mais sai: o diagnostico so
           devolve mascarado. Guardar e inevitavel — cobranca e chamada autenticada. */
        case '/crm/api/pagamentos/config': r = pagar.configurar(d); break;
        /* Quem responde "esta chave e de teste ou de producao?" passa a ser o
           Mercado Pago. Antes isso dependia de lembrar onde cada uma foi colada
           — e chave de teste e de producao comecam as duas com APP_USR-. */
        case '/crm/api/pagamentos/conferir': r = await pagar.conferirCredenciais(); break;
        case '/crm/api/pagamentos/cobrar': {
          // Cliente primeiro: o Asaas recusa cobranca sem `customer`, e o
          // documento e obrigatorio do lado dele.
          const c = await pagar.garantirCliente({ nome: d.nome, cpfCnpj: d.cpfCnpj, email: d.email, telefone: d.telefone });
          if (!c.ok) { r = { ok: false, erro: c.motivo }; break; }
          const cob = await pagar.cobrar({
            clienteId: c.clienteId,
            metodo: d.metodo,
            valorCentavos: Number(d.valorCentavos),
            vencimento: d.vencimento,
            descricao: d.descricao,
            referencia: d.referencia,
          });
          if (!cob.ok) { r = { ok: false, erro: cob.motivo }; break; }
          // Pix so tem QR depois de criada a cobranca — por isso vem aqui, nao antes.
          const qr = String(d.metodo).toUpperCase() === 'PIX' ? await pagar.qrPix(cob.pagamento.id) : null;
          r = { ...cob, clienteReusado: c.reusado, pix: qr?.ok ? qr.pix : null, pixErro: qr && !qr.ok ? qr.motivo : null };
          break;
        }
        case '/crm/api/tiktok/descobrir-loja': r = await tk.descobrirLoja({}); break;
        /* Sincronizar e CHAMAR a TikTok. Devolve o que veio de la, com o
           carimbo — e devolve a falha do mesmo jeito, porque esconder falha de
           integracao e o que faz o cliente descobrir no pior dia. */
        case '/crm/api/tiktok/sincronizar': r = await tk.sincronizarProdutos({}); break;
        case '/crm/api/tiktok/descobrir-anunciante': r = await tk.descobrirAnunciante({}); break;
        case '/crm/api/tiktok/loja-ativa': r = tk.salvarConfig({ shopCipher: d.cipher, shopId: d.id, shopNome: d.nome }); break;
        case '/crm/api/tiktok/anunciante-ativo': r = tk.salvarConfig({ anuncianteId: d.id, anuncianteNome: d.nome }); break;
        case '/crm/api/tiktok/produto': r = await tk.cadastrarProduto(d); break;
        case '/crm/api/tiktok/categorias': r = await tk.categoriasDaLoja({}); break;
        case '/crm/api/tiktok/armazens': r = await tk.armazensDaLoja({}); break;
        case '/crm/api/tiktok/padroes': r = tk.salvarConfig({ categoriaId: d.categoriaId, categoriaNome: d.categoriaNome, armazemId: d.armazemId, armazemNome: d.armazemNome }); break;
        /* O CICLO FECHADO: produto do estoque daqui vira produto na loja de la.
           As imagens sao baixadas do proprio painel e reenviadas pra TikTok, que
           so aceita URI dela. */
        case '/crm/api/tiktok/publicar-produto': {
          const prod = estoque.obter(String(d.sku || ''));
          if (!prod) { r = { ok: false, motivo: `produto "${d.sku}" nao existe no estoque` }; break; }
          r = await tk.publicarProdutoDoEstoque(prod, {
            /* Baixar a imagem e I/O, entao entra por injecao: o modulo continua
               testavel sem rede, como o resto da casa. */
            baixarImagem: async (url) => {
              const abs = /^https?:/i.test(url) ? url : `${process.env.PAINEL_URL || 'https://bolsocheio.velososolution.com.br'}${url.startsWith('/') ? '' : '/'}${url}`;
              const res = await fetch(abs);
              if (!res.ok) { return null; }
              return Buffer.from(await res.arrayBuffer());
            },
          });
          break;
        }
        case '/crm/api/tiktok/campanha': {
          /* Campanha custa dinheiro de verdade. Orcamento ausente ou zerado nao
             pode virar chamada: a TikTok recusa com erro cru, e o pior caso e
             ela NAO recusar. */
          const orcamento = Number(d.orcamentoCentavos || 0);
          if (!String(d.nome || '').trim()) { r = { ok: false, motivo: 'dê um nome à campanha' }; break; }
          if (!(orcamento > 0)) { r = { ok: false, motivo: 'informe o orçamento diário — campanha sem orçamento não é criada' }; break; }
          r = await tk.criarCampanha(d);
          break;
        }
        case '/crm/api/tiktok/publicar': {
          // App ainda nao auditado so publica privado. Mandar publico nesse estado
          // faz a TikTok recusar — melhor avisar do que deixar falhar la.
          r = await tk.publicarVideo({
            videoUrl: d.videoUrl,
            titulo: d.titulo,
            privacidade: d.privacidade || 'SELF_ONLY',
          });
          break;
        }
        case '/crm/api/documentos/rascunho': r = docs.salvarRascunho(d.tipo, d.texto, { vigenteDe: d.vigenteDe }); break;
        case '/crm/api/documentos/publicar': r = docs.publicar(d.tipo, { vigenteDe: d.vigenteDe }); break;
        case '/crm/api/documentos/descartar': r = docs.descartarRascunho(d.tipo); break;
        case '/crm/api/documentos/aceite': r = docs.registrarAceite(d.tipo, d.quem || {}); break;
        case '/crm/api/documentos/conferir': r = docs.conferirAceite(d.id); break;
        case '/crm/api/canais/conectar':
          r = await canais.conectar({ canal: d.canal, token: d.token, produtos: () => estoque.doAtendimento() });
          break;
        case '/crm/api/canais/desconectar': r = await canais.desconectar({ canal: d.canal }); break;
        case '/crm/api/canais/trocar-numero':
          r = await canais.trocarNumero({ canal: d.canal, produtos: () => estoque.doAtendimento() });
          break;
        case '/crm/api/canais/enviar': r = await canais.enviar(d); break;
        case '/crm/api/canais/desparear': r = await canais.desparear({ canal: d.canal }); break;
        case '/crm/api/canais/personalizar': r = await canais.personalizar(d); break;
        case '/crm/api/canais/restaurar-perfil': r = await canais.restaurarPerfil({ canal: d.canal }); break;
        case '/crm/api/canais/config': r = canais.salvarConfigCanal(d); break;
        case '/crm/api/operadores/salvar': r = operadores.salvar(d); break;
        case '/crm/api/operadores/remover': r = operadores.remover(d.id); break;
        case '/crm/api/checkout/modo-teste':
          r = d.ligar ? clientes.ligarModoTeste({ minutos: d.minutos }) : clientes.desligarModoTeste();
          console.log(`[checkout] modo teste ${r.ativo ? 'LIGADO ate ' + r.ate + ' — cobrancas por R$ 0,50' : 'desligado'}`);
          break;
        case '/crm/api/checkout/iniciar': r = await clientes.iniciarCheckout(d, { imprimir: clientesSrv.imprimirPdf }); break;
        case '/crm/api/checkout/pix': r = await clientes.pixCheckout(d.id, { cobrar: pagar.cobrar, webhookUrl: webhookPagamento() }); break;
        case '/crm/api/checkout/cartao':
          r = await clientes.cartaoCheckout(d.id, {
            cartao: d.cartao || {}, pagarCartao: pagar.pagarCartao, webhookUrl: webhookPagamento(),
            assinar: clientesSrv.assinarLicenca, enviar: clientesSrv.enviarWhatsapp, urlAtivacao: urlAtivacao(),
          });
          /* Recusa de cartao NAO e erro do sistema: e resposta do banco, com a
             frase do motivo. Vai como 200 pra tela mostrar a mensagem certa. */
          console.log(`[checkout] cartao ${d.id}: ${r.aprovado ? 'APROVADO, chave ' + r.codigo : (r.emAnalise ? 'em analise' : 'recusado — ' + (r.tecnico || r.mensagem || r.motivo))}`);
          if (r.aprovado) { await entregarAcesso(d.id); }
          if (r.recusado && r.ok === false) { r = { ok: true, aprovado: false, recusado: true, mensagem: r.motivo }; }
          break;
        case '/crm/api/clientes/salvar': r = clientes.salvar(d); break;
        case '/crm/api/clientes/contratada': r = clientes.salvarContratada(d); break;
        case '/crm/api/clientes/contrato': {
          r = await clientes.gerarContrato(d.id, { imprimir: clientesSrv.imprimirPdf });
          /* Mandar o PDF no WhatsApp e opcional: o dono pode preferir baixar e
             mandar por e-mail. Falha no envio NAO desfaz o contrato gerado. */
          if (r.ok && d.enviar) {
            const e = await clientes.enviarContrato(d.id, { enviarArquivo: clientesSrv.enviarArquivoWhatsapp, versao: r.contrato.versao });
            r.envio = e.envio;
            r.cliente = e.cliente || r.cliente;
            console.log(`[clientes] contrato ${r.contrato.numero} -> WhatsApp: ${e.ok ? 'enviado' : 'NAO enviado: ' + e.motivo}`);
          }
          break;
        }
        case '/crm/api/clientes/enviar-contrato': {
          r = await clientes.enviarContrato(d.id, { enviarArquivo: clientesSrv.enviarArquivoWhatsapp, versao: d.versao });
          console.log(`[clientes] contrato reenviado (${d.id}) -> WhatsApp: ${r.ok ? 'enviado' : 'NAO enviado: ' + r.motivo}`);
          break;
        }
        case '/crm/api/clientes/cobrar':
          r = await clientes.cobrar(d.id, {
            cobrar: pagar.cobrar, enviar: d.enviar === false ? null : clientesSrv.enviarWhatsapp,
            webhookUrl: webhookPagamento(), exigirAssinatura: d.exigirAssinatura === true,
          });
          break;
        case '/crm/api/clientes/reenviar-cobranca': r = await clientes.reenviarCobranca(d.id, { enviar: clientesSrv.enviarWhatsapp }); break;
        case '/crm/api/clientes/cancelar-cobranca': r = clientes.cancelarCobranca(d.id); break;
        case '/crm/api/clientes/liberar-manual':
          r = await clientes.liberarManual(d.id, { motivo: d.motivo, assinar: clientesSrv.assinarLicenca, enviar: clientesSrv.enviarWhatsapp, urlAtivacao: urlAtivacao() });
          if (r.ok) { r.acesso = await entregarAcesso(d.id); }
          break;
        case '/crm/api/clientes/enviar-acesso': r = await entregarAcesso(d.id); break;
        case '/crm/api/clientes/reenviar-chave': r = await clientes.reenviarChave(d.id, { enviar: clientesSrv.enviarWhatsapp, urlAtivacao: urlAtivacao() }); break;
        case '/crm/api/clientes/revogar': r = clientes.revogar(d.id, { motivo: d.motivo }); break;
        case '/crm/api/planos/assinar': r = planos.assinar(d); break;
        case '/crm/api/planos/salvar': r = planos.salvarPlano(d); break;
        case '/crm/api/planos/versionar': r = planos.versionarPlano(d.code, d.mudancas || {}, d.sufixo || 'v2'); break;
        /* O atendente responde DAQUI. A resposta sai pelo canal e entra na trilha
           do lead — mesma trilha do bot, pra conversa nao virar duas metades. */
        case '/crm/api/atendimentos/responder': {
          const texto = String(d.texto || '').trim();
          if (!texto) { r = { ok: false, motivo: 'escreva a mensagem antes de enviar' }; break; }
          const tel = String(d.telefone || '').replace(/\D/g, '');
          /* Quem responde pelo painel ASSUME a conversa: o bot sai de cena antes
             da mensagem sair. Sem isto, numa conversa que estava com o bot, ele
             continuava respondendo por cima do vendedor. */
          const pode = vendedorPode(quem, tel);
          if (!pode.ok) { r = pode; break; }
          bot.assumirConversa(tel, { por: quemAtende(quem) });
          assumiuVira(quem, tel);
          const envio = await canais.enviar({ canal: d.canal, para: d.telefone, texto });
          if (!envio.ok) { r = { ok: false, motivo: envio.erro || 'não consegui enviar' }; break; }
          const lead = crm.listar().find((l) => l.telefone === String(d.telefone || '').replace(/\D/g, ''));
          if (lead) { crm.interagir(lead.id, { canal: ehTelegram(d.telefone) ? 'telegram' : 'whatsapp', direcao: 'saida', texto, autor: 'atendente' }); }
          r = { ok: true, enviado: true, id: envio.id || null };
          break;
        }
        case '/crm/api/campanhas/salvar': r = campanhasTg.salvar(d, { canal: 'telegram' }); break;
        case '/crm/api/campanhas/auditar': r = campanhasTg.rodarAuditoria(String(d.id || ''), contextoCampanha({ forcar: d.forcar === true })); break;
        case '/crm/api/campanhas/aprovar': r = campanhasTg.aprovar(String(d.id || ''), { ...contextoCampanha(), por: quem.email || null, aceitarRessalvas: d.aceitarRessalvas === true }); break;
        case '/crm/api/campanhas/encerrar': r = campanhasTg.encerrar(String(d.id || '')); break;
        case '/crm/api/campanhas/excluir': r = campanhasTg.excluir(String(d.id || '')); break;
        case '/crm/api/resultados/campanha': r = resultados.criarCampanha({ nome: d.nome, canal: d.canal === 'whatsapp' ? 'whatsapp' : 'telegram' }); break;
        case '/crm/api/resultados/campanha/arquivar': r = resultados.arquivarCampanha(String(d.codigo || ''), d.arquivada !== false); break;
        /* Retomar um pedido parado: UMA mensagem, pelo canal de onde a pessoa
           veio, pra quem ja estava conversando com a loja. Nunca disparo em massa. */
        case '/crm/api/resultados/retomar': {
          const p = resultados.obterPedido(d.referencia);
          if (!p) { r = { ok: false, motivo: 'pedido não encontrado' }; break; }
          if (p.retomadaEm) { r = { ok: false, motivo: 'este pedido já foi retomado' }; break; }
          const texto = String(d.texto || '').trim();
          if (!texto) { r = { ok: false, motivo: 'escreva a mensagem da retomada' }; break; }
          if (texto.length > 1000) { r = { ok: false, motivo: 'mensagem longa demais (até 1000 caracteres)' }; break; }
          const envio = await canais.enviar({ para: p.endereco || p.telefone, texto });
          if (!envio.ok) { r = { ok: false, motivo: envio.erro || 'não consegui enviar' }; break; }
          resultados.marcarRetomada(p.referencia);
          const lead = crm.listar().find((l) => l.telefone === p.telefone);
          if (lead) { crm.interagir(lead.id, { canal: p.canal, direcao: 'saida', texto, autor: 'atendente' }); }
          r = { ok: true, enviado: true };
          break;
        }
        /* O vendedor pega a conversa antes de responder (ler o historico,
           checar o pedido): o bot para de falar com esta pessoa ja. */
        case '/crm/api/atendimentos/assumir': {
          const tel = String(d.telefone || '').replace(/\D/g, '');
          if (!tel) { r = { ok: false, motivo: 'conversa sem identificador' }; break; }
          const pode = vendedorPode(quem, tel);
          if (!pode.ok) { r = pode; break; }
          r = bot.assumirConversa(tel, { por: quemAtende(quem) });
          assumiuVira(quem, tel);
          break;
        }
        case '/crm/api/atendimentos/devolver': {
          const tel = String(d.telefone || '').replace(/\D/g, '');
          const pode = vendedorPode(quem, tel);
          r = pode.ok ? bot.devolverAoBot(tel) : pode;
          break;
        }
        /* O dono troca o responsavel (ou tira): ferias, desligamento, cliente
           que pediu outro vendedor. Fica no historico do lead. */
        case '/crm/api/atendimentos/responsavel': {
          const lead = crm.listar().find((l) => l.telefone === String(d.telefone || '').replace(/\D/g, ''));
          if (!lead) { r = { ok: false, motivo: 'cliente não encontrado' }; break; }
          if (!d.operadorId) { r = crm.comercial(lead.id, { responsavel: null }); r = r.erro ? r : { ok: true }; break; }
          const op = operadores.ativos(operadores.listar()).find((o) => o.id === d.operadorId);
          if (!op) { r = { ok: false, motivo: 'operador não encontrado ou desativado' }; break; }
          const x = crm.comercial(lead.id, { responsavel: { operadorId: op.id, nome: op.nome, equipe: operadores.norm(op.setor), motivo: 'definido pelo administrador' } });
          r = x.erro ? x : { ok: true };
          break;
        }
        case '/crm/api/qualificacao/salvar': r = qualif.salvarConfig(d); break;
        /* Testar a matriz com uma conversa inventada: mostra a ficha e a decisao
           SEM gravar nada e sem girar o rodizio. */
        case '/crm/api/qualificacao/simular': {
          const msgs = (Array.isArray(d.mensagens) ? d.mensagens : [d.texto]).map((x) => String(x || '')).filter(Boolean).slice(0, 20);
          if (!msgs.length) { r = { ok: false, motivo: 'escreva ao menos uma mensagem do cliente' }; break; }
          let ficha = null;
          const cat = estoque.doAtendimento().map((p) => ({ sku: p.sku, nome: p.nome }));
          for (const m of msgs) { ficha = qualif.qualificar(ficha, m, { produtos: cat }); }
          const dec = qualif.decidir(ficha, { texto: msgs.join(' '), equipesComGente: [...new Set(operadores.ativos(operadores.listar()).map((o) => operadores.norm(o.setor)))], matriz: Array.isArray(d.matriz) ? d.matriz : undefined });
          r = { ok: true, ficha, decisao: dec, resumo: qualif.resumo(ficha), faltando: qualif.faltando(ficha) };
          break;
        }
        case '/crm/api/vendedores/acesso': {
          const op = operadores.listar().find((o) => o.id === d.operadorId);
          if (!op) { r = { ok: false, motivo: 'operador não encontrado' }; break; }
          r = usuarios.criarAcessoVendedor({ email: d.email || op.email, nome: op.nome, senha: d.senha, operadorId: op.id });
          break;
        }
        case '/crm/api/vendedores/remover': r = usuarios.removerAcessoVendedor(d.operadorId); break;
        /* O ATENDENTE encerra. Ate agora so o silencio encerrava, e quem
           resolveu o caso em dois minutos ficava preso na fila esperando o
           relogio — ocupando lugar que era de outra pessoa. */
        case '/crm/api/atendimentos/encerrar': {
          const tel = String(d.telefone || '').replace(/\D/g, '');
          const pode = vendedorPode(quem, tel);
          if (!pode.ok) { r = pode; break; }
          /* Conversa de antes de todo atendimento ter protocolo: abre um agora
             pra poder encerrar e ir pro historico. */
          if (!proto.aberto(tel) && crm.listar().some((l) => l.telefone === tel)) { proto.aoChegar(tel, { voltarParaFila: false }); }
          const p = proto.aberto(tel);
          if (!p) { r = { ok: false, motivo: 'não há atendimento aberto para este cliente' }; break; }
          const fila = bot.emAtendimento().find((e) => e.telefone === tel);
          const leadE = crm.listar().find((l) => l.telefone === tel);
          const fechado = proto.encerrarPorNumero(p.numero, { motivo: d.motivo || 'encerrado pelo atendente', por: { tipo: 'atendente', ...quemAtende(quem) },
            atendidoPor: p.atendidoPor || fila?.assumidaPor || leadE?.comercial?.responsavel || null });
          bot.devolverAoBot(tel);
          /* Encerrou, pede a nota. A resposta ("5") e tratada no atendimento
             antes do bot — nao reabre o protocolo. */
          const avaliar = d.avaliar !== false && d.avisar !== false;
          if (avaliar) { proto.pedirAvaliacao(fechado.numero); }
          /* Avisar com o numero e o que permite a pessoa voltar pro mesmo
             lugar. Encerrar calado deixaria ela achando que foi largada. */
          let avisado = false;
          if (d.avisar !== false) {
            const env = await canais.enviar({
              para: fechado.endereco || tel,
              texto: proto.textoDeEncerramento(fechado) + (avaliar ? `\n\n${proto.textoAvaliacao()}` : ''),
            }).catch((e) => ({ ok: false, erro: e.message }));
            if (env?.ok && leadE) { crm.interagir(leadE.id, { canal: ehTelegram(tel) ? 'telegram' : 'whatsapp', direcao: 'saida', texto: proto.textoDeEncerramento(fechado) + (avaliar ? `\n\n${proto.textoAvaliacao()}` : ''), autor: 'atendente' }); }
            avisado = env?.ok === true;
          }
          r = { ok: true, protocolo: fechado.numero, avisado };
          break;
        }
        case '/crm/api/bot/config': r = bot.salvarConfig(d); break;
        case '/crm/api/seguranca/config': {
          const antes = bot.getConfig();
          r = bot.salvarConfig({
            emergencia: { ...(antes.emergencia || {}), ...(d.emergencia || {}) },
            moderacao: { ...(antes.moderacao || {}), ...(d.moderacao || {}) },
          });
          if (r?.ok !== false) {
            const e = { ...(antes.emergencia || {}), ...(d.emergencia || {}) };
            seguranca.auditar({ tipo: 'config', detalhe: `configuração salva por ${quem.email}: socorro ${e.ativo === false ? 'DESLIGADO' : 'ligado'}` });
          }
          break;
        }
        case '/crm/api/seguranca/visto': r = seguranca.reconhecer(d.ids || [], quem.email); break;
        case '/crm/api/seguranca/responsaveis': r = seguranca.salvarResponsaveis(d.responsaveis || []); break;
        case '/crm/api/seguranca/teste': r = await canais.alertarResponsaveis({ tipo: 'teste', por: quem.email }); if (!r.ok) { r = { ...r, ok: false, erro: r.motivo || `ninguém recebeu: ${(r.falhas || []).map((f) => `${f.nome} (${f.erro})`).join(', ')}` }; } break;
        case '/crm/api/seguranca/sos': {
          seguranca.auditar({ tipo: 'sos', detalhe: `SOS acionado no painel por ${quem.email}${d.motivo ? `: ${String(d.motivo).slice(0, 300)}` : ''}` });
          r = await canais.alertarResponsaveis({ tipo: 'sos', motivo: d.motivo || null, por: quem.email });
          if (!r.ok) { r = { ...r, ok: false, erro: r.motivo || `ninguém recebeu: ${(r.falhas || []).map((f) => `${f.nome} (${f.erro})`).join(', ')}` }; }
          break;
        }
        case '/crm/api/bot/regra': r = bot.salvarRegra(d); break;
        case '/crm/api/bot/regra-excluir': r = bot.excluirRegra(d.id); break;
        case '/crm/api/bot/fluxo-csv': r = bot.importarFluxoCsv(String(d.csv || '')); break;
        case '/crm/api/bot/fluxo-apagar': r = bot.apagarFluxo(); break;
        case '/crm/api/bot/midia-apagar': r = bot.apagarMidia(d.nome); break;
        /* Simulador: o catalogo real entra como contexto, entao o teste mostra o
           que o cliente veria de verdade — nao um exemplo inventado. */
        case '/crm/api/bot/simular': {
          const sim = bot.simular(d.mensagens || [], {
            nome: d.nome || 'Cliente',
            empresa: process.env.VITRINE_NOME || 'nossa loja',
            produtos: estoque.doAtendimento(),
          });
          /* Cobranca no simulador e OPT-IN, e so no ambiente de teste. Simular
             uma conversa nao pode gerar cobranca por acidente — mas quem esta
             conferindo o fluxo precisa poder ver o link chegar de verdade, que e
             justamente o passo que ninguem confia sem ver. */
          const querCobrar = d.cobrar === true;
          const amb = pagar.provedorAtual();
          for (const t of (sim.turnos || [])) {
            if (!t.cobranca) { continue; }
            if (!querCobrar) { t.cobrancaSimulada = t.cobranca; continue; }
            if (amb.emProducao) {
              t.cobrancaRecusada = 'o provedor está em PRODUÇÃO: simular não cobra dinheiro de verdade';
              continue;
            }
            const c = await pagar.cobrar({
              valorCentavos: t.cobranca.valorCentavos,
              metodo: 'PIX',
              descricao: t.cobranca.descricao,
              referencia: t.cobranca.referencia,
              webhookUrl: process.env.VS_URL_WEBHOOK_PAGAMENTO || undefined,
            });
            if (c.ok && c.pagamento?.linkPagamento) {
              t.pagamento = { valorCentavos: c.pagamento.valorCentavos, linkPagamento: c.pagamento.linkPagamento };
            } else {
              t.cobrancaRecusada = c.motivo || 'o gateway não devolveu link';
            }
          }
          r = { ok: true, ...sim, ambientePagamento: amb.ambiente, provedorPagamento: amb.rotulo };
          break;
        }
        case '/crm/api/caixa': r = fin.criar(d); break;
        case '/crm/api/caixa/editar': r = fin.editar(d.id, d.mudancas || {}); break;
        case '/crm/api/caixa/excluir': r = fin.excluir(d.id, { motivo: d.motivo }); break;
        case '/crm/api/caixa/restaurar': r = fin.restaurar(d.id); break;
        case '/crm/api/estoque/produto': r = estoque.criar(d, { limiteProdutos: limitesAtuais().produtos }); break;
        case '/crm/api/estoque/editar': r = estoque.editar(d.sku, d.mudancas || {}); break;
        case '/crm/api/estoque/movimentar': r = estoque.movimentar(d.sku, d); break;
        case '/crm/api/estoque/excluir': r = estoque.excluir(d.sku); break;
        case '/crm/api/estoque/restaurar': r = estoque.restaurar(d.sku); break;
        case '/crm/api/estoque/esquecer-canal': r = estoque.esquecerCanal(d.sku, d.canal); break;
        /* Comprar = entrada de mercadoria. Fica separado de `movimentar` porque
           carrega custo e fornecedor, que vao pro historico. */
        case '/crm/api/estoque/comprar': {
          r = estoque.movimentar(d.sku, {
            tipo: 'entrada',
            quantidade: Number(d.quantidade),
            motivo: d.fornecedor ? `compra — ${d.fornecedor}` : 'compra',
            ref: d.nota || null,
          });
          break;
        }
        case '/crm/api/estoque/reservar': r = estoque.reservar(d.sku, Number(d.quantidade), { chave: d.chave, canal: d.canal }); break;
        case '/crm/api/estoque/confirmar': r = estoque.confirmarReserva(d.chave); break;
        case '/crm/api/estoque/cancelar-reserva': r = estoque.cancelarReserva(d.chave); break;
        case '/crm/api/estoque/vitrine': r = estoque.vitrine(d.sku, d.expor !== false); break;
        /* "Vender" = mandar pro TikTok Shop. Enquanto a loja nao esta ligada, a
           resposta diz O QUE falta em vez de um erro seco — o produto ja fica
           marcado pra vitrine, que e o canal que funciona sem aprovacao. */
        /* VENDER, na ordem que a especificacao manda: valida -> RESERVA idempotente
           -> encaminha pro canal. A baixa do saldo NAO acontece aqui; ela espera a
           confirmacao do canal (POST /crm/api/estoque/confirmar). */
        case '/crm/api/estoque/vender': {
          const p = estoque.obter(d.sku);
          if (!p) { r = { ok: false, motivo: `produto "${d.sku}" nao encontrado` }; break; }
          const qtd = Number(d.quantidade) || 1;
          // Chave estavel: o mesmo clique repetido nao reserva de novo.
          const chave = String(d.chave || `${d.sku}:${d.canal || 'tiktok'}:${qtd}:${new Date().toISOString().slice(0, 13)}`);
          const res = estoque.reservar(d.sku, qtd, { chave, canal: d.canal || 'tiktok' });
          if (!res.ok) { r = { ok: false, motivo: res.erro || res.motivo }; break; }

          const shop = tk.diagnostico().familias.shop;
          if (!shop.autorizado) {
            estoque.vitrine(d.sku, true);
            r = {
              ok: false,
              motivo: 'a loja do TikTok ainda não está conectada',
              falta: shop.appConfigurado
                ? ['autorizar a conta em Conexões com redes sociais']
                : ['cadastrar o app do TikTok Shop em Conexões com redes sociais: ' + (shop.faltando || []).join(', ')],
              naVitrine: true,
              reserva: res.reserva,
            };
            break;
          }
          const env = await estoque.publicarNoTiktok(d.sku, {
            armazemId: d.armazemId || process.env.TIKTOK_ARMAZEM_ID,
            categoriaId: d.categoriaId || process.env.TIKTOK_CATEGORIA_ID,
          });
          r = { ...env, reserva: res.reserva };
          break;
        }
        case '/crm/api/estoque/lote': r = estoque.criarLote(d); break;
        case '/crm/api/estoque/lote-excluir': r = estoque.excluirLote(d.id); break;
        case '/crm/api/funil': r = crm.setFunil(d.etapas); break;
        case '/crm/api/leads': r = crm.criar(d); break;
        case '/crm/api/mover': r = crm.mover(d.id, d.etapa); break;
        case '/crm/api/fechar': r = crm.encerrar(d.id, d.status, d.motivo); break;
        case '/crm/api/indicacao': r = crm.setRegraIndicacao(d); break;
        case '/crm/api/parceiros': r = crm.criarParceiro(d); break;
        case '/crm/api/parceiros/remover': r = crm.removerParceiro(d.id); break;
        default: return json(res, 404, { erro: 'rota de CRM desconhecida' });
      }
      /* Tres formatos de recusa convivem aqui: {erros:[...]} nos modulos de
         cadastro, {motivo:'...'} nos de integracao (pagamentos, lote, tiktok) e
         {erro} nos antigos. Faltava o `motivo`: a recusa virava o generico "nao
         foi possivel concluir" e a pessoa perdia a unica frase que dizia O QUE
         estava errado — "nenhum produto alterado nesse periodo" virava nada. */
      if (r && r.ok === false && !r.erro) {
        r = { ...r, erro: (r.erros || []).join('; ') || r.motivo || 'nao foi possivel concluir' };
      }
      return json(res, (r?.erro || r?.ok === false) ? 400 : 200, r);
    }
    return json(res, 404, { erro: 'rota de CRM desconhecida' });
  }

  json(res, 404, { error: 'not found' });
});

/* HOST so e definido pela instancia isolada do teste de volume (127.0.0.1):
   ela aceita mensagem simulada e nao pode ficar visivel na rede. Sem HOST,
   escuta como sempre escutou. */
server.listen(...(process.env.HOST ? [PORT, process.env.HOST] : [PORT]), () => {
  console.log(`[qa-gate-backend] ouvindo em :${PORT} (webhook /webhook, health /health)`);
  /* O canal volta sozinho se estava ligado. Nao trava o boot: se o navegador
     demorar ou falhar, o painel ja esta de pe e a tela mostra o estado. */
  canais.retomar({ produtos: () => estoque.doAtendimento() })
    .catch((e) => console.error(`[canais] falhei ao retomar o canal: ${e.message}`));

  /* Um minuto e resolucao suficiente pra um limite de cinco: varrer mais rapido
     so gasta disco, e mais devagar faria o cliente esperar o dobro do prometido
     pelo aviso de encerramento. `unref` pra este relogio nunca segurar o
     processo de pe sozinho. */
  const relogio = setInterval(() => {
    canais.encerrarParados().catch((e) => console.error(`[protocolo] varredura falhou: ${e.message}`));
    /* Na mesma batida: quem esta esperando gente ha tempo demais. Sao duas
       varreduras porque sao dois problemas — uma fecha conversa parada, a outra
       resgata cliente abandonado na fila. */
    canais.resgatarFila().catch((e) => console.error(`[fila] varredura falhou: ${e.message}`));
  }, 60000);
  relogio.unref?.();

  /* Quem pagou e ficou sem o link (e-mail fora, WhatsApp caído) recebe de novo
     sozinho, sem depender de alguém notar no histórico. */
  const reentrega = setInterval(async () => {
    for (const id of clientes.pendentesDeAcesso({ temSenha: (cid) => !!usuarios.doCliente(cid)?.hash })) {
      console.log(`[acesso] ${id} pagou e segue sem acesso — nova tentativa de entrega`);
      await entregarAcesso(id).catch((e) => console.error(`[acesso] nova tentativa de ${id} falhou: ${e.message}`));
    }
  }, 10 * 60000);
  reentrega.unref?.();
});
