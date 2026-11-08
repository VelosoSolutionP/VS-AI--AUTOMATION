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
import * as backup from './backup.mjs';
import * as empresaWa from './empresa-whatsapp.mjs';
import * as crm from '../engine/vscrm/index.mjs';
import { testarConexao, CREDENCIAL } from '../engine/vsinfluence/coletor.mjs';
import { diagnostico as tiktokDiagnostico } from '../engine/vstiktok/index.mjs';
import { testar as tiktokTestar } from '../engine/vstiktok/conectar.mjs';
import * as estoque from '../engine/vsestoque/index.mjs';
import { criarCadevcClient } from '../engine/vssalao/cadevc.mjs';
import { criarWhatsAppEvolutionProvider } from '../engine/canais/whatsapp-evolution/index.mjs';
import * as cadevcCfg from '../engine/vssalao/config.mjs';
import * as cadevcHub from '../engine/vssalao/hub.mjs';
import * as salaoIas from '../engine/vssalao/ias.mjs';
import * as canaisEvo from '../engine/vscanais/evolution.mjs';
/* Canal do salão (Evolution): um provider por instância, criado quando as variáveis existem. */
let _provcadevc = null; let _provcadevcKey = '';
const _webhooksCadevc = new Map();
async function garantirWebhookCadevc(cfg, { forcar = false } = {}) {
  const url = `${origemPublica()}/webhook/cadevc`;
  const chave = [cfg.evolutionUrl, cfg.evolutionInstance, cfg.evolutionKey, url].join('|');
  const anterior = _webhooksCadevc.get(chave);
  if (!forcar && anterior?.ok) { return anterior; }
  if (!forcar && anterior && Date.now() - anterior.tentadoEm < 60_000) { return anterior; }
  let resultado;
  try {
    const hook = await fetch(`${cfg.evolutionUrl.replace(/\/$/, '')}/webhook/set/${encodeURIComponent(cfg.evolutionInstance)}`, {
      method: 'POST', headers: { apikey: cfg.evolutionKey, 'content-type': 'application/json' },
      body: JSON.stringify({ webhook: { enabled: true, url, webhookByEvents: false, events: ['MESSAGES_UPSERT'] } }),
    });
    if (!hook.ok) { throw new Error(`Evolution respondeu HTTP ${hook.status} ao configurar o webhook`); }
    resultado = { ok: true, tentadoEm: Date.now() };
  } catch (e) {
    resultado = {
      ok: false, tentadoEm: Date.now(),
      erro: `Não consegui ativar as respostas do bot: ${e.message}. Confira se PAINEL_URL aponta para o endereço HTTPS público do CRM e se o Evolution consegue acessá-lo.`,
    };
    console.warn(`[cadevc] webhook do salão não configurado: ${e.message}`);
  }
  _webhooksCadevc.set(chave, resultado);
  return resultado;
}
function provcadevc() {
  const cfg = cadevcCfg.config();
  if (!cfg.evolutionUrl || !cfg.evolutionKey || !cfg.evolutionInstance) { return null; }
  const key = `${cfg.evolutionUrl}|${cfg.evolutionInstance}|${cfg.evolutionKey}`;
  if (!_provcadevc || _provcadevcKey !== key) {
    _provcadevc = criarWhatsAppEvolutionProvider({ baseUrl: cfg.evolutionUrl, apiKey: cfg.evolutionKey, instance: cfg.evolutionInstance, nome: 'whatsapp-web' });
    _provcadevcKey = key;
  }
  return _provcadevc;
}
import * as vspainel from '../engine/vspainel/index.mjs';
import { painelQuebraGalho, QG_URL } from './quebragalho.mjs';
import * as tk from '../engine/vstiktok/index.mjs';
import { reservarEvento } from './idempotencia.mjs';
import * as atendimento from './atendimento.mjs';
import * as canais from './canais.mjs';
import { ehTelegram } from '../engine/canais/telegram/index.mjs';
import { canalDe } from '../engine/canais/identidade.mjs';
import * as resultados from '../engine/vsresultados/index.mjs';
import * as campanhasTg from '../engine/vscampanhas/index.mjs';
import * as qualif from '../engine/vsqualificacao/index.mjs';
import { montarAuditoria } from '../engine/vsauditoria/index.mjs';
import { montarVisao } from '../engine/vspainel/visao.mjs';
import { lerImagem } from '../engine/vscampanhas/imagem.mjs';
import * as seguranca from '../engine/vsseguranca/index.mjs';
import * as operadores from '../engine/vsoperadores/index.mjs';
import * as proto from '../engine/vsprotocolo/index.mjs';
import * as planos from '../engine/vsplanos/index.mjs';
import * as pagar from '../engine/vspagamentos/index.mjs';
import * as fin from '../engine/vsfinanceiro/index.mjs';
import * as caixaLoja from '../engine/vscaixa/index.mjs';
import * as venda from '../engine/vsvenda/index.mjs';
import * as mapaMental from '../engine/vsmapa/index.mjs';
import * as bot from '../engine/vsbot/index.mjs';
import * as botModelos from '../engine/vsbot/modelos.mjs';
import * as profissoes from '../engine/vsbot/profissoes.mjs';
import * as hotel from '../engine/vs0007/bots.mjs';
import * as docs from '../engine/vsdocumentos/index.mjs';
import { documento as validarDocumento } from '../engine/vsclientes/ofertas.mjs';
import * as clientes from '../engine/vsclientes/index.mjs';
import { definirBuscaCliente } from '../engine/vsbot/fluxo.mjs';
import * as clientesSrv from './clientes-servicos.mjs';
import * as midia from './midia.mjs';
import { pagina as paginaVitrine, paginaProduto, paginaSumiu } from './vitrine.mjs';
import * as vida from './vida.mjs';
import { lerCorpoLimitado, criarRateLimit, ipDe, segredoIgual, CORPO_MAX_BYTES } from './limites.mjs';
import * as consumo from '../engine/vsconsumo/index.mjs';
import * as integ from '../engine/vsintegracoes/index.mjs';
import * as orc from '../engine/vsorcamentos/index.mjs';
import * as provador from '../engine/vsprovador/index.mjs';
import { textoSaudacaoAtendente } from './saudacao-atendente.mjs';
import * as orcSrv from './orcamentos.mjs';
import * as prosp from '../engine/vsprospeccao/index.mjs';
import * as prospEnvio from './prospeccao-envio.mjs';
import * as campanhaWpp from './campanha-whatsapp.mjs';
import * as rendimentoEq from '../engine/vsrendimento/index.mjs';
import * as prospCaixa from './prospeccao-caixa.mjs';
import * as drivin from '../engine/vsdrivin/index.mjs';
import * as drive from '../engine/vsdrive/index.mjs';
import { dentroDaCasa, comLoja, lojaAtual, PRINCIPAL, comEmpresa, empresaAtual } from '../engine/casa.mjs';
import * as empresas from '../engine/empresas.mjs';
import * as lojas from '../engine/vslojas/index.mjs';

/* Pagamento confirmado por QUALQUER caminho → o lead do pedido vira Ganho no
   funil (regra do funil automático, engine/vscrm/automacao.mjs). Idempotente. */
function sincronizarFunil() {
  try {
    const r = crm.sincronizarPagamentos(resultados.pedidos(), pagar.listar());
    if (r.mudou) { console.log(`[crm] funil: ${r.mudou} lead(s) viraram Ganho pelo pagamento`); }
  } catch (e) { console.error(`[crm] funil nao sincronizou com os pagamentos: ${e.message}`); }
  sincronizarDrivin();
}

/* DRIVIN (29/09): pedido PAGO vai sozinho pra roteirização. Em segundo plano —
   a DrivIn fora do ar não pode atrasar a confirmação do pagamento. */
let drivinRodando = false;
function sincronizarDrivin() {
  if (drivinRodando || !drivin.config().ligado) { return; }
  drivinRodando = true;
  drivin.sincronizar(resultados.pedidos(), pagar.listar())
    .then((r) => { if (r.enviados) { console.log(`[drivin] ${r.enviados} pedido(s) enviados pra rota`); } for (const f of r.falhas || []) { console.warn(`[drivin] não enviou ${f}`); } })
    .catch((e) => console.error(`[drivin] sincronização falhou: ${e.message}`))
    .finally(() => { drivinRodando = false; });
}

/* Aviso da DrivIn → mensagem pro cliente no canal do pedido. Não entregue também
   vai pra fila da equipe, pra alguém combinar a nova entrega. */
async function avisarDrivin(avisos = []) {
  for (const a of avisos) {
    const env = await canais.enviar({ para: a.para, texto: a.texto }).catch((e) => ({ ok: false, erro: e.message }));
    console.log(`[drivin] ${a.tipo} ${a.referencia} -> ${env.ok ? 'avisado' : 'NÃO avisado: ' + (env.erro || '?')}`);
    const tel = drivin.envioDe(a.referencia)?.telefone;
    const lead = tel ? crm.listar().find((l) => l.telefone === tel) : null;
    if (lead && env.ok) { crm.interagir(lead.id, { canal: a.canal, direcao: 'saida', texto: a.texto, autor: 'bot' }); }
    if (a.equipe && tel) { try { bot.comCanal(a.canal, () => bot.entregarParaEquipe(tel, { departamento: 'comercial', contexto: { entrega: `não entregue: ${a.referencia}` } })); } catch (e) { console.warn(`[drivin] fila da equipe: ${e.message}`); } }
  }
}

/* Medidor de banda: toda chamada que o servidor faz (Telegram, Meta,
   integrações) passa a ser contada. Precisa vir antes de qualquer provider
   nascer — eles leem globalThis.fetch na hora de chamar. */
consumo.medirFetch({ telegramApi: process.env.TELEGRAM_API_URL });
for (const sinal of ['SIGTERM', 'SIGINT']) { process.once(sinal, () => { consumo.descarregar(); process.exit(0); }); }
process.on('exit', () => consumo.descarregar());

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
    `Olá${primeiro ? ', ' + primeiro : ''}! Recebemos um pedido para trocar a senha do ZEST (${para}).`,
    '',
    'Crie a nova senha neste link (vale 1 hora):',
    link,
    '',
    'Se não foi você, ignore — a senha atual continua valendo.',
  ].join('\n');
  const html = `<div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:auto;color:#16161c">
    <h2 style="margin:0 0 8px">Trocar a senha do ZEST</h2>
    <p>Olá${primeiro ? ', ' + primeiro : ''}! Recebemos um pedido para trocar a senha do usuário <b>${para}</b>.</p>
    <p style="margin:24px 0"><a href="${link}" style="background:#ff8a00;color:#1a1107;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">Criar nova senha</a></p>
    <p style="color:#5b5b66;font-size:13px">O link vale 1 hora. Se não foi você, ignore este e-mail — a senha atual continua valendo.</p>
    <p style="color:#5b5b66;font-size:12px">Veloso Solution · CNPJ 53.759.232/0001-94</p></div>`;
  const c = clienteId ? clientes.obter(clienteId) : null;
  const [e, w] = await Promise.all([
    email.enviarEmail({ para, assunto: 'Trocar a senha do ZEST', texto: txt, html }).catch((x) => ({ ok: false, erro: x.message })),
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
    `Olá, ${primeiro}! Seu acesso ao ZEST está pronto.`,
    '',
    `Crie sua senha neste link (vale 72 horas):`,
    link,
    '',
    `Seu usuário é o e-mail ${cv.email}.`,
    lic ? `Chave de ativação: ${lic.codigo} (válida até ${new Date(lic.validaAte).toLocaleDateString('pt-BR')}).` : null,
    '',
    'Depois, entre no painel ZEST da Veloso Solution com e-mail e senha.',
  ].filter((x) => x !== null).join('\n');
  const html = `<div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:auto;color:#16161c">
    <h2 style="margin:0 0 8px">Seu acesso ao ZEST está pronto</h2>
    <p>Olá, ${primeiro}! Crie a sua senha para entrar. O seu usuário é <b>${cv.email}</b>.</p>
    <p style="margin:24px 0"><a href="${link}" style="background:#ff8a00;color:#1a1107;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">Criar minha senha</a></p>
    ${lic ? `<p>Chave de ativação: <b style="font-family:monospace">${lic.codigo}</b> — válida até ${new Date(lic.validaAte).toLocaleDateString('pt-BR')}.</p>` : ''}
    <p style="color:#5b5b66;font-size:13px">O link vale 72 horas. Se não foi você, ignore este e-mail.</p>
    <p style="color:#5b5b66;font-size:12px">Veloso Solution · CNPJ 53.759.232/0001-94</p></div>`;
  const [w, e] = await Promise.all([
    clientesSrv.enviarWhatsapp({ para: c.whatsapp, texto: txt }).catch((x) => ({ ok: false, erro: x.message })),
    email.enviarEmail({ para: cv.email, assunto: 'Seu acesso ao ZEST', texto: txt, html }).catch((x) => ({ ok: false, erro: x.message })),
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
/* "Já sou cliente" (02/10): o passo de documento do fluxo procura o CPF/CNPJ no cadastro
   de clientes (Clientes e licenças) da loja da conversa. Só devolve nome e id. */
definirBuscaCliente((digitos) => {
  const c = clientes.painel().clientes.find((x) => String(x.documento || '').replace(/\D/g, '') === digitos);
  return c ? { id: c.id, nome: c.nome } : null;
});

/* SAUDAÇÃO DE QUEM ASSUME (02/10, dono: "quando atender, o nome da pessoa e uma frase
   legal: em que posso estar te ajudando no dia de hoje"). Sai UMA vez, quando a conversa
   passa do bot pra uma pessoa — não a cada resposta. "Meu nome é…" evita errar o
   artigo (a/o) do nome de quem atende. Sem nome (administrador sem cadastro), fica sem. */
async function saudarAoAssumir(quem, tel, canal) {
  const lead = crm.listar().find((l) => l.telefone === tel);
  const texto = textoSaudacaoAtendente({ cliente: lead?.nome, atendente: quemAtende(quem).nome === 'Administrador' ? (quem?.nome || null) : quemAtende(quem).nome, empresa: orcSrv.loja() });
  const envio = await canais.enviar({ canal, para: proto.enderecoDe(tel), texto }).catch((e) => ({ ok: false, erro: e.message }));
  if (lead && envio.ok) { crm.interagir(lead.id, { canal: canalDe(tel), direcao: 'saida', texto, autor: 'atendente', por: quemAtende(quem) }); }
  if (!envio.ok) { console.warn(`[atendimento] saudação de quem assumiu não saiu (••••${tel.slice(-4)}): ${envio.erro}`); }
  return envio.ok;
}
/* O vendedor ve o que e DELE (responsavel ou quem assumiu) e a fila sem dono da
   equipe dele ou geral. Cliente da carteira de outro vendedor nao aparece. */
function vendedorVe(c, eu) {
  const resp = c.comercial?.responsavel?.operadorId || null;
  if (resp === eu.operadorId || c.assumidaPor?.operadorId === eu.operadorId) { return true; }
  if (resp || c.assumidaPor?.operadorId) { return false; }
  // Bot desligado: ninguem atende sozinho, entao conversa sem dono e de toda a equipe.
  if (bot.comCanal(c.canal, () => bot.getConfig()).ativo === false) { return true; }
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

/* Finalizar/encerrar so quem esta ATENDENDO: a conversa tem de estar assumida
   por alguem. E o que da sentido a "quem encerrou" no historico. */
function contextoFechamento(quem, tel) {
  const pode = vendedorPode(quem, tel);
  if (!pode.ok) { return pode; }
  const fila = bot.emAtendimento().find((e) => e.telefone === tel) || null;
  if (!fila?.assumida) { return { ok: false, motivo: 'assuma o atendimento antes — só quem está atendendo pode finalizar ou encerrar' }; }
  if (quem?.papel === 'vendedor' && fila.assumidaPor?.operadorId && fila.assumidaPor.operadorId !== quem.operadorId) {
    return { ok: false, motivo: `quem está atendendo é ${fila.assumidaPor.nome}` };
  }
  // Conversa de antes de todo atendimento ter protocolo: abre um agora (marcado legado).
  if (!proto.aberto(tel)) { const n = proto.aoChegar(tel, { voltarParaFila: false }); if (n.novo) { proto.marcarLegado(n.protocolo.numero); } }
  const p = proto.aberto(tel);
  if (!p) { return { ok: false, motivo: 'não há atendimento aberto para este cliente' }; }
  return { ok: true, p, fila, lead: crm.listar().find((l) => l.telefone === tel) || null };
}

/* O que o agendador manda pro Telegram: a imagem da campanha (arquivo nosso,
   lido do disco; ou URL externa), o texto e o BOTAO com o link rastreavel. */
function publicarCampanha(pub, c, dest) {
  const link = canais.telegramInfo().link;
  let imagem = null;
  if (c.imagem) {
    const nome = midia.nomeValido(c.imagem.arquivo) ? c.imagem.arquivo : String(c.imagem.url || '').match(/\/midia\/([0-9a-f]{24}\.[a-z]+)$/)?.[1];
    if (nome && midia.nomeValido(nome)) {
      try { imagem = { buffer: readFileSync(join(midia.baseDir(), nome)), nome, tipo: /png$/.test(nome) ? 'image/png' : /webp$/.test(nome) ? 'image/webp' : 'image/jpeg' }; } catch { imagem = null; }
    } else if (/^https:\/\//.test(c.imagem.url || '')) { imagem = { url: c.imagem.url }; }
  }
  return canais.telegramPublicar({ chatId: dest.id, texto: c.texto, imagem, botao: link ? { texto: c.botao || 'Falar com a loja', url: `${link}?start=${c.codigo}` } : null });
}

/* UMA rodada do agendador por vez: o botao "publicar agora" e o relogio usam a
   mesma trava — duas rodadas juntas podiam publicar a mesma campanha 2 vezes. */
let rodadaCampanhas = null;
function agendadorCampanhas() {
  // Modo consulta: nada é publicado; as agendadas esperam (não viram falha).
  if (emModoConsulta()) { return Promise.resolve({ publicadas: 0, falhas: 0, modoConsulta: true }); }
  if (!rodadaCampanhas) {
    rodadaCampanhas = campanhasTg.rodarAgendador({ publicar: publicarCampanha, revalidarCom: contextoCampanha() }).finally(() => { rodadaCampanhas = null; });
  }
  return rodadaCampanhas;
}

function contextoCampanha(extra = {}) {
  return {
    produto: async (sku) => {
      const vivo = (await estoque.doAtendimento()).find((p) => p.sku === sku);
      if (vivo) { return { ...vivo, ativo: true }; }
      const cru = await estoque.obter(sku);
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
  '/crm/logo.png': 'zest-logo.svg',
  '/crm/logo.svg': 'zest-logo.svg',
  '/crm/simbolo.png': 'zest-icon.svg',
  '/crm/favicon.png': 'zest-icon.svg',
  '/crm/icone-192.png': 'zest-icon-192.png',
  '/crm/icone-512.png': 'zest-icon-512.png',
  '/crm/apple-touch-icon.png': 'zest-icon-180.png',
  '/crm/zest-logo.svg': 'zest-logo.svg',
  '/crm/zest-icon.svg': 'zest-icon.svg',
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
/* Link público do orçamento: quem tem o código vê e responde. O limite segura
   quem tenta adivinhar código na força bruta. */
/* O orçamento só usa o que a loja VENDE: produto ativo do Estoque, com preço. */
const catalogoOrc = async () => (await estoque.doAtendimento()).filter((p) => p.precoCentavos > 0).map((p) => ({ sku: p.sku, nome: p.nome, precoCentavos: p.precoCentavos }));
const LIM_ORCAMENTO = criarRateLimit({ max: Number(process.env.RATE_ORCAMENTO || 60), janelaMs: 10 * 60000 });
/* Tela do provador na vitrine: medir/avaliar a cada toque da cliente — teto folgado, mas teto. */
const LIM_PROVADOR = criarRateLimit({ max: Number(process.env.RATE_PROVADOR || 240), janelaMs: 10 * 60000 });
const LIM_SAIR = criarRateLimit({ max: Number(process.env.RATE_SAIR || 30), janelaMs: 3600000 });
const LIM_ASSINAR_INICIO = criarRateLimit({ max: Number(process.env.RATE_ASSINAR_INICIO || 8), janelaMs: 10 * 60000 });
const LIM_REENVIAR = criarRateLimit({ max: Number(process.env.RATE_REENVIAR || 5), janelaMs: 10 * 60000 });
const LIM_ASSINAR = criarRateLimit({ max: Number(process.env.RATE_ASSINAR || 90), janelaMs: 60000 });
const LIM_PORTAL_CONTRATO = criarRateLimit({ max: Number(process.env.RATE_PORTAL_CONTRATO || 10), janelaMs: 10 * 60000 });

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

/* Banda do mês: plano + adendos contra o que o medidor contou. A mídia
   guardada varre pastas — por isso a foto vale 15 s. */
let fotoConsumo = null;
function pastasDeMidia() { return [...new Set([midia.baseDir(), dentroDaCasa('midia'), dentroDaCasa('vscampanhas'), dentroDaCasa('vsdocumentos')])]; }
/* Caixa da Prospecção: uma leitura por vez; só lê depois que algum e-mail saiu. */
let lendoCaixaProsp = null;
function lerCaixaProsp() {
  if (lendoCaixaProsp) { return lendoCaixaProsp; }
  lendoCaixaProsp = prospCaixa.lerCaixa().finally(() => { lendoCaixaProsp = null; });
  return lendoCaixaProsp;
}
/* Uma pesquisa do mapa mental por vez (agendador e botão dividem a trava). */
let pesquisaMapaRodando = false;
async function rodarPesquisaMapa(tipo) {
  if (pesquisaMapaRodando) { return { ok: false, motivo: 'já tem uma pesquisa rodando — espere terminar' }; }
  pesquisaMapaRodando = true;
  try { return await mapaMental.pesquisar({ tipo }); } finally { pesquisaMapaRodando = false; }
}
function estadoConsumo(forcar = false) {
  if (!forcar && fotoConsumo && Date.now() - fotoConsumo.t < 15000) { return fotoConsumo.e; }
  const banda = planos.bandaDoMes();
  const md = consumo.midiaDoMes(pastasDeMidia());
  const e = { ...consumo.estado({ limiteGb: banda.totalGb, midia: md }), banda };
  fotoConsumo = { t: Date.now(), e };
  return e;
}
/* Central de integrações: cada módulo diz o próprio estado; a foto vale 60 s
   (o Quebra-Galho é consultado pela rede). */
let fotoInteg = null;
async function estadoIntegracoes(forcar = false) {
  if (!forcar && fotoInteg && Date.now() - fotoInteg.t < 60000) { return fotoInteg.e; }
  const tenta = async (fn) => { try { return await fn(); } catch (e) { return { erro: e.message }; } };
  const cs = canais.estado().canais || [];
  const fontes = {
    whatsapp: cs.find((c) => c.nome === 'whatsapp-web') || null,
    telegram: await tenta(() => canais.telegramInfo()),
    pagamento: await tenta(() => pagar.provedorAtual()),
    tiktok: await tenta(() => tiktokDiagnostico()),
    loja: await tenta(async () => ({ publicados: ((await estoque.publicados()) || []).length })),
    quebragalho: await tenta(() => painelQuebraGalho()),
    email: { configurado: email.configurado() },
    alertas: await tenta(() => ({ responsaveis: seguranca.responsaveis().length })),
  };
  const e = integ.comHistorico(integ.montar(fontes));
  fotoInteg = { t: Date.now(), e };
  return e;
}

/* MODO CONSULTA DESLIGADO (dono, 29/09: "tira consumo do sistema, não vamos
   cobrar assim"). A cobrança não é por banda: nada trava o cliente por consumo.
   A medição continua no vsconsumo, parada — religar é voltar esta linha. */
export const emModoConsulta = () => false;
canais.definirTrava(emModoConsulta);
const MSG_CONSULTA = 'modo consulta: a banda do mês acabou — dá para ver tudo, mas enviar, publicar e editar ficam parados até renovar ou entrar banda adicional';
/* O que continua funcionando em modo consulta: sair, trocar senha, o próprio
   consumo (pedir/liberar banda) e ler. */
const LIVRE_EM_CONSULTA = new Set(['/crm/api/sair', '/crm/api/trocar-senha', '/crm/api/consumo/banda', '/crm/api/consumo/banda/remover', '/crm/api/consumo/pedir-banda']);

const server = createServer(async (req, res) => {
  consumo.medirRequisicao(req, res);
  if (req.method === 'GET' && req.url === '/health') { return json(res, 200, { ok: true }); }
  /* O subdomínio cadevc.* continua reservado ao sistema próprio do salão. A
     integração do salão no console fica em /crm#cadevc; este host só abre quando
     o domínio apontar para o serviço dedicado. */
  if (String(req.headers.host || '').toLowerCase().startsWith('cadevc.')) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Em breve.'); }

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
  /* 18/10 — INSTAGRAM DIRECT. Mesmo esquema do WhatsApp: a Meta confere o
     endereço (GET) e manda as mensagens (POST). Cada entrada traz o id da conta
     do Instagram: conta de empresa cliente vai pros dados DELA. */
  if (req.method === 'GET' && req.url.split('?')[0] === '/webhook/instagram') {
    const q = new URL(req.url, 'http://x').searchParams;
    const esperado = process.env.IG_VERIFY_TOKEN || process.env.WA_VERIFY_TOKEN || '';
    if (!esperado) { return json(res, 503, { erro: 'IG_VERIFY_TOKEN ausente no servidor' }); }
    if (q.get('hub.mode') === 'subscribe' && segredoIgual(q.get('hub.verify_token') || '', esperado)) {
      console.log('[instagram] webhook verificado pela Meta');
      res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(String(q.get('hub.challenge') || ''));
    }
    return json(res, 403, { erro: 'verify_token nao confere' });
  }
  if (req.method === 'POST' && req.url.split('?')[0] === '/webhook/instagram') {
    const buf = await readBody(req);
    if (corpoEstourou(res, buf)) { return; }
    const cru = buf.toString('utf8');
    const ass = atendimento.confereAssinatura(cru, req.headers['x-hub-signature-256'], process.env.IG_APP_SECRET || process.env.WA_APP_SECRET || '');
    if (!ass.ok) { console.error(`[instagram] payload RECUSADO: ${ass.motivo}`); return json(res, 401, { erro: ass.motivo }); }
    let evento; try { evento = JSON.parse(cru); } catch { return json(res, 400, { erro: 'payload invalido' }); }
    json(res, 200, { received: true });
    const daPlataforma = []; const porEmpresa = new Map();
    for (const en of evento?.entry || []) {
      const e = empresas.porIgId(en?.id);
      if (e) { if (!porEmpresa.has(e.cnpj)) { porEmpresa.set(e.cnpj, []); } porEmpresa.get(e.cnpj).push(en); } else { daPlataforma.push(en); }
    }
    const entregar = (ev) => canais.receberInstagram(ev).then((n) => { if (n === null) { console.error('[instagram] canal não montado — mensagem não entregue ao bot'); } })
      .catch((e) => console.error(`[instagram] falha ao processar: ${e.message}`));
    for (const [cnpj, entry] of porEmpresa) { comEmpresa(cnpj, () => entregar({ object: 'instagram', entry })); }
    if (daPlataforma.length) { entregar({ object: 'instagram', entry: daPlataforma }); }
    return;
  }

  /* Webhook do Evolution (salão). Público: o Evolution chama de fora. A gente
     acha o tenant pela `instance` e entrega pro bot do salão daquele cliente.
     Sempre 200, pra o Evolution não ficar reenviando. */
  /* Webhook da Evolution dos CANAIS (universal). Segredo na query; a empresa sai
     da instância e o número precisa existir nela. Sempre 200 para não reenviar. */
  if (req.method === 'POST' && req.url.split('?')[0] === '/webhook/canais') {
    const buf = await readBody(req);
    if (corpoEstourou(res, buf)) { return; }
    let body; try { body = JSON.parse(buf.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
    const segredo = new URL(req.url, 'http://x').searchParams.get('k') || '';
    json(res, 200, { ok: true });
    canaisEvo.receberWebhook(body, { segredo })
      .then((r) => { if (!r.ok) { console.log(`[canais-evo] webhook ignorado: ${r.motivo}`); } })
      .catch((e) => console.error(`[canais-evo] webhook quebrou: ${e.message}`));
    return;
  }
  if (req.method === 'POST' && req.url.split('?')[0] === '/webhook/cadevc') {
    const buf = await readBody(req);
    if (corpoEstourou(res, buf)) { return; }
    let body; try { body = JSON.parse(buf.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
    try { const r = cadevcHub.receberWebhook(body); if (!r.ok) { console.log(`[cadevc] webhook ignorado: ${r.motivo}`); } }
    catch (e) { console.error(`[cadevc] webhook quebrou: ${e.message}`); }
    return json(res, 200, { ok: true });
  }

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
    /* 02/10: o aviso de entrega da Meta (enviada/entregue/lida/FALHOU) vai pro log —
       sem isto, "a Meta aceitou mas não chegou" não tinha como ser auditado. */
    for (const en of evento?.entry || []) {
      for (const ch of en?.changes || []) {
        for (const st of ch?.value?.statuses || []) {
          const er = (st.errors || []).map((e) => `${e.code} ${e.title || ''}${e.error_data?.details ? ' — ' + e.error_data.details : ''}`).join('; ');
          console.log(`[whatsapp] status ${st.status} pra ••••${String(st.recipient_id || '').slice(-4)}${er ? ' — ' + er : ''}`);
        }
      }
    }
    /* 18/10 (multi-empresa): cada pedaço do evento vai pra empresa dona do número
       (phone_number_id). O que é do número da plataforma segue o caminho de sempre. */
    const daEmpresa = new Map();
    for (const en of evento?.entry || []) {
      const resto = [];
      for (const ch of en?.changes || []) {
        const e = empresas.porPhoneId(ch?.value?.metadata?.phone_number_id);
        if (e) { if (!daEmpresa.has(e.cnpj)) { daEmpresa.set(e.cnpj, []); } daEmpresa.get(e.cnpj).push({ ...en, changes: [ch] }); } else { resto.push(ch); }
      }
      en.changes = resto;
    }
    for (const [cnpj, entry] of daEmpresa) {
      comEmpresa(cnpj, () => {
        const ev = { object: evento.object, entry };
        canais.registrarConsumoMeta(ev);
        const n = canais.receberWhatsAppCloud(ev);
        if (n === null) { console.error(`[whatsapp] empresa ${cnpj}: o painel não está na API oficial — mensagem não entregue ao bot`); }
      });
    }
    /* 09/10: e os mesmos avisos contam o consumo do mês (franquia de 1.000 grátis por número). */
    canais.registrarConsumoMeta(evento);

    /* Responde 200 JA. A Meta reentrega tudo que nao receber 2xx rapido, e
       processar antes de responder transformaria uma resposta lenta do bot numa
       enxurrada de reentregas. A reentrega que vier mesmo assim para na trava de
       idempotencia, que e feita pelo id da mensagem la dentro. */
    json(res, 200, { received: true });

    /* 03/10: com o canal na API oficial, a mensagem vai pra Micaela de verdade
       (mesmo fluxo do WhatsApp Web). O caminho antigo abaixo só roda sem ele. */
    if (canais.receberWhatsAppCloud(evento) !== null) { return; }

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
      await comLoja(r.pagamento.loja, async () => {
        const l = fin.lancarPagamento(r.pagamento);
        if (l.ok && !l.repetido) { console.log(`[caixa] entrada de ${r.pagamento.id} lancada${r.pagamento.loja && r.pagamento.loja !== PRINCIPAL ? ` (loja ${r.pagamento.loja})` : ''}`); }
        sincronizarFunil();
      });
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

  /* Webhooks da DrivIn (rota e prova de entrega). O segredo vai na URL que a
     gente entrega ao suporte deles; sem ele, 401 e nada muda. */
  const caminhoDv = req.url.split('?')[0];
  if (req.method === 'POST' && (caminhoDv === '/webhook/drivin/rotas' || caminhoDv === '/webhook/drivin/entregas')) {
    const t = new URL(req.url, 'http://x').searchParams.get('t');
    if (!drivin.segredoConfere(t)) { return json(res, 401, { erro: 'segredo inválido' }); }
    const buf = await readBody(req);
    if (corpoEstourou(res, buf)) { return; }
    let corpo; try { corpo = JSON.parse(buf.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
    const r = caminhoDv.endsWith('/rotas') ? drivin.webhookRota(corpo) : drivin.webhookProva(corpo);
    console.log(`[drivin] webhook ${caminhoDv.split('/').pop()}: ${r.achados} pedido(s) nosso(s), ${r.avisos.length} aviso(s)`);
    await avisarDrivin(r.avisos);
    return json(res, 200, { ok: true, achados: r.achados, avisos: r.avisos.length });
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
      comLoja(r.pagamento.loja, () => {
        const l = fin.lancarPagamento(r.pagamento);
        if (l.ok && !l.repetido) { console.log(`[caixa] entrada de ${r.pagamento.id} lancada`); }
        sincronizarFunil();
      });
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
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/portal/contrato') {
    if (barrado(res, LIM_PORTAL_CONTRATO, req, 'portal')) { return; }
    const b = await readBody(req);
    if (corpoEstourou(res, b)) { return; }
    let d; try { d = JSON.parse(b.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
    const r = clientes.contratoAtivoPorDocumento(d.documento);
    return json(res, r.ok ? 200 : 400, r.ok ? { ativo: r.ativo } : { erro: r.motivo });
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
      return json(res, 200, { ok: true, mensagem: 'Se este e-mail tem conta no ZEST, o link para criar uma nova senha acabou de ser enviado. Ele vale 1 hora.' });
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
        ofertas: clientes.todasOfertas().filter((o) => o.catalogo && o.ativo !== false),
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
          if (a.mudou) { comLoja(a.pagamento.loja, () => { const l = fin.lancarPagamento(a.pagamento); if (l.ok && !l.repetido) { console.log(`[caixa] entrada de ${a.pagamento.id} lancada`); } sincronizarFunil(); }); }
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
  /* PROVADOR VIRTUAL (19/10): a tela da vitrine em tamanho real. Sem login — ela
     fica na loja, aberta pra quem passa. O link carrega a empresa e uma chave
     aleatória (Provador virtual → link da tela); trocar a chave derruba a tela
     antiga. A câmera roda no aparelho: aqui só chegam números. */
  /* Biblioteca 3D da vitrine (Three.js), servida do próprio sistema pra a tela da
     loja NÃO depender de internet — no estúdio/projetor sem rede o 3D caía pro
     desenho 2D (20/10). Fica fora do /crm, no nível da própria vitrine. */
  if (req.method === 'GET' && (rotaV === '/provador-lib/three.module.js' || rotaV === '/provador-lib/RoomEnvironment.js')) {
    try {
      const nome = rotaV.endsWith('RoomEnvironment.js') ? 'RoomEnvironment.js' : 'three.module.js';
      const js = readFileSync(join(HERE, 'vendor', 'three', nome), 'utf8');
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=86400' });
      return res.end(js);
    } catch { return json(res, 404, { erro: 'lib nao encontrada' }); }
  }
  const mProv = rotaV.match(/^\/provador\/(0|\d{11}|\d{14})\.([A-Za-z0-9_-]{20,40})(\/dados|\/medir|\/avaliar|\/prova)?$/);
  if (mProv) {
    if (barrado(res, LIM_PROVADOR, req, 'provador')) { return; }
    const emp = mProv[1] === '0' ? null : mProv[1];
    if (emp && !empresas.existe(emp)) { return json(res, 404, { erro: 'tela não encontrada' }); }
    const b = req.method === 'POST' ? await readBody(req) : null;
    if (b && corpoEstourou(res, b)) { return; }
    return comEmpresa(emp, () => comLoja(PRINCIPAL, () => {
      if (!provador.chaveConfere(mProv[2])) {
        if (!mProv[3]) { res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end('<!doctype html><meta charset="utf-8"><title>Provador</title><body style="font:20px system-ui;background:#0b1220;color:#e6e9f2;display:grid;place-items:center;height:100vh;margin:0;text-align:center"><div><h1>Provador desligado</h1><p>Esta tela foi desligada ou o link mudou. Peça o link novo no painel.</p></div></body>'); }
        return json(res, 404, { erro: 'provador desligado ou link trocado' });
      }
      if (req.method === 'GET' && !mProv[3]) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
        return res.end(readFileSync(join(HERE, 'provador.html'), 'utf8'));
      }
      if (req.method === 'GET' && mProv[3] === '/dados') {
        const c = provador.config();
        return json(res, 200, {
          config: { segmento: c.segmento, alturaTelaCm: c.alturaTelaCm, titulo: c.titulo, loja: (empresaAtual() && empresas.obter(empresaAtual())?.nome) || orcSrv.loja() },
          segmentos: provador.SEGMENTOS, medidas: provador.MEDIDAS, categorias: provador.CATEGORIAS, veste: provador.VESTE, pecas: provador.pecasDaVitrine()
        });
      }
      if (req.method === 'POST' && mProv[3]) {
        let d; try { d = JSON.parse(b.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
        const c = provador.config();
        let r;
        if (mProv[3] === '/medir') { r = provador.medirSilhueta({ ...d, fator: c.fatorScanner }); }
        else if (mProv[3] === '/avaliar') { r = provador.recomendar(d.corpo, String(d.pecaId || ''), { segmento: c.segmento }); }
        else if (mProv[3] === '/prova') {
          r = provador.registrarProva(d);
          if (r.ok) { console.log(`[provador] prova registrada (${r.prova.peca?.nome || 'sem peça'})`); r = { ok: true }; }
        }
        if (r) { return json(res, r.ok === false ? 400 : 200, r.ok === false ? { ...r, erro: r.motivo } : r); }
      }
      return json(res, 405, { erro: 'método não permitido' });
    }));
  }
  /* Orçamento: a página que o cliente abre pelo link da conversa. Mostra,
     aprova e recusa — sem login, porque o cliente não tem conta. O código no
     link é o que autoriza (e o limite por IP segura quem tenta adivinhar). */
  const mOrc = rotaV.match(/^\/orcamento\/([A-Za-z0-9_-]{16,64})(\/aprovar|\/recusar)?$/);
  if (mOrc) {
    if (barrado(res, LIM_ORCAMENTO, req, 'orçamento')) { return; }
    const pagina = (code, corpo) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }); return res.end(corpo); };
    const naoAchei = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orçamento</title><body style="font:16px system-ui;padding:40px;text-align:center;color:#333"><h1>Orçamento não encontrado</h1><p>Confira o link que chegou na conversa ou fale com quem te atendeu.</p></body>';
    if (req.method === 'GET' && !mOrc[2]) {
      const o = orc.porToken(mOrc[1]);
      if (!o || o.situacao === 'rascunho') { return pagina(404, naoAchei); }
      const q = new URL(req.url, 'http://x').searchParams.get('r');
      const aviso = q === 'aprovado' ? { texto: 'Orçamento aprovado. Obrigado! A equipe já vai te chamar na conversa.' }
        : q === 'recusado' ? { texto: 'Anotado: você não vai seguir com este orçamento.', tipo: 'nao' }
          : q === 'erro' ? { texto: 'Não deu pra registrar sua resposta — este orçamento pode ter vencido. Fale com quem te atendeu.', tipo: 'nao' } : null;
      return pagina(200, orc.html(o, { loja: orcSrv.loja(), url: `/orcamento/${o.token}`, aviso }));
    }
    if (req.method === 'POST' && mOrc[2]) {
      const b = await readBody(req);
      if (corpoEstourou(res, b)) { return; }
      const motivo = new URLSearchParams(b.toString('utf8')).get('motivo');
      const r = orc.responder(mOrc[1], mOrc[2] === '/aprovar' ? 'aprovar' : 'recusar', { motivo });
      if (r.ok && !r.jaEstava) { orcSrv.aoResponder(r.orcamento).catch((e) => console.error(`[orcamento] aviso da resposta falhou: ${e.message}`)); }
      const dest = `/orcamento/${mOrc[1]}?r=${r.ok ? (mOrc[2] === '/aprovar' ? 'aprovado' : 'recusado') : 'erro'}`;
      res.writeHead(303, { location: dest, 'cache-control': 'no-store' });
      return res.end();
    }
    return pagina(405, naoAchei);
  }
  /* SAIR DA BASE (02/10, dono: "caso não tenha interesse, ele clica em alguma parte,
     chega pra nós e tiramos ele da base"). Link do WhatsApp da prospecção. ABRIR não
     tira (o WhatsApp abre o link sozinho pra prévia); o botão da página é que tira. */
  const mSair = rotaV.match(/^\/sair\/([A-Za-z0-9_.-]{20,80})$/);
  if (mSair) {
    if (barrado(res, LIM_SAIR, req, 'sair')) { return; }
    const c = prosp.contatoDoTokenSair(mSair[1]);
    const pg = (code, titulo, corpo) => {
      res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
      return res.end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title>
<body style="margin:0;font:17px/1.5 system-ui,sans-serif;background:#f6f7f9;color:#1f2933"><main style="max-width:440px;margin:48px auto;padding:28px 22px;background:#fff;border-radius:14px;box-shadow:0 2px 12px #0001;text-align:center">
<p style="margin:0 0 6px;font-weight:700;color:#0f7a3d">Veloso Solution</p>${corpo}</main></body></html>`);
    };
    if (!c) { return pg(404, 'Link inválido', '<h1 style="font-size:22px">Link não encontrado</h1><p>Se não quer receber nossas mensagens, responda <b>SAIR</b> na conversa e tiramos seu contato.</p>'); }
    const feito = '<h1 style="font-size:22px">Pronto, contato removido</h1><p>Tiramos o seu contato da nossa base e não vamos mais te procurar. Obrigado pelo seu tempo!</p>';
    if (req.method === 'GET') {
      if (c.optout) { return pg(200, 'Contato removido', feito); }
      return pg(200, 'Sair da base', `<h1 style="font-size:22px">Não tem interesse?</h1><p>Toque no botão e tiramos o contato${c.nome ? ` da <b>${String(c.nome).replace(/[&<>"]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[x])}</b>` : ''} da nossa base. Não vamos mais te procurar.</p>
<form method="post"><button style="margin-top:8px;padding:14px 22px;font:inherit;font-weight:700;color:#fff;background:#0f7a3d;border:0;border-radius:10px;width:100%">Tirar meu contato</button></form>`);
    }
    if (req.method === 'POST') {
      if (!c.optout) {
        const r = prosp.mover(c.id, 'saiu', { por: 'link do WhatsApp (o próprio contato)' });
        if (r.ok) {
          console.log(`[prospeccao] SAIR pelo link: ${c.nome || c.id} — contato apagado e número bloqueado`);
          seguranca.auditar({ tipo: 'prospeccao:sair-link', detalhe: `${c.id} ${c.nome || ''}`.trim(), cliente: null, resultado: 'removido' });
          vida.registrar('prospeccao:sair-link', { contato: c.id, nome: c.nome || null });
        }
      }
      return pg(200, 'Contato removido', feito);
    }
    return pg(405, 'Sair da base', '<p>Use o botão da página.</p>');
  }
  /* Robô de busca: a vitrine é pra ser achada; o painel, o login e a API não. */
  if (req.method === 'GET' && rotaV === '/robots.txt') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' });
    return res.end(['User-agent: *', 'Allow: /vitrine', 'Allow: /midia/', 'Disallow: /crm', 'Disallow: /api/', 'Disallow: /criar-acesso',
      'Disallow: /redefinir-senha', 'Disallow: /ativar', 'Disallow: /orcamento/', 'Disallow: /assinar', `Sitemap: ${origemPublica()}/vitrine/sitemap.xml`, ''].join('\n'));
  }
  if (req.method === 'GET' && rotaV === '/vitrine/sitemap.xml') {
    const o = origemPublica();
    const urls = [`${o}/vitrine`, ...(await estoque.daVitrine()).map((p) => `${o}/vitrine/p/${encodeURIComponent(p.sku)}`)];
    res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' });
    return res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u.replace(/&/g, '&amp;')}</loc></url>`).join('\n')}\n</urlset>\n`);
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
        return res.end(paginaVitrine(await estoque.daVitrine(), lojaV));
      }
      /* FEED DO GOOGLE (Merchant Center busca sozinho, todo dia). Só produto da
         vitrine, e o link de cada um é a página dele aqui mesmo. */
      if (rotaV === '/vitrine/google.xml') {
        const f = await estoque.exportarVitrine('google', {
          loja: lojaV.nome, site: `${lojaV.origem}/vitrine`,
          linkDe: (sku) => `${lojaV.origem}/vitrine/p/${encodeURIComponent(sku)}`
        });
        res.writeHead(200, {
          'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=300',
          'x-vs-incluidos': String(f.incluidos), 'x-vs-recusados': String((f.recusados || []).length)
        });
        return res.end(f.conteudo);
      }
      if (rotaV.startsWith('/vitrine/p/')) {
        const p = await estoque.daVitrinePorSku(decodeURIComponent(rotaV.slice('/vitrine/p/'.length)));
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

  /* Painel de Aplicativos (29/09): página própria do carro em Uber/99/InDrive,
     fora do painel da loja. O login é o mesmo (token do painel); os dados vêm de /crm/api/drive. */
  if (CRM_ENABLED && req.method === 'GET' && req.url.split('?')[0] === '/frota') {
    try { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store, must-revalidate' }); return res.end(readFileSync(join(HERE, 'frota.html'), 'utf8')); }
    catch (e) { return json(res, 500, { erro: 'frota page: ' + e.message }); }
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
          'content-type': MARCA[rota].endsWith('.svg') ? 'image/svg+xml; charset=utf-8' : 'image/png',
          /* Logo muda uma vez por ano. Um dia de cache poupa o download a cada
             abertura, e o `?v=` no HTML força a troca quando mudar mesmo. */
          'cache-control': 'public, max-age=86400',
        });
        return res.end(arq);
      } catch { return json(res, 404, { erro: 'imagem não encontrada' }); }
    }

    /* 18/10 (plano item 6, "atendente pelo celular"): o painel instala como aplicativo
       (PWA) e avisa quando um cliente fica esperando. Antes da senha: o navegador busca
       os dois sem token. O service worker não guarda o painel em cache — a versão
       errada do painel quebraria tudo (ver o no-store logo abaixo). */
    if (req.method === 'GET' && rota === '/crm/manifest.webmanifest') {
      res.writeHead(200, { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'public, max-age=3600' });
      return res.end(JSON.stringify({
        name: 'ZEST — atendimento', short_name: 'ZEST', lang: 'pt-BR', start_url: '/crm#wa-atendimento', scope: '/crm', display: 'standalone',
        background_color: '#08060D', theme_color: '#08060D', icons: [
          { src: '/crm/icone-192.png?v=3', sizes: '192x192', type: 'image/png' },
          { src: '/crm/icone-512.png?v=3', sizes: '512x512', type: 'image/png' },
          { src: '/crm/apple-touch-icon.png?v=3', sizes: '180x180', type: 'image/png' },
        ]
      }));
    }
    if (req.method === 'GET' && rota === '/crm/sw.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', 'service-worker-allowed': '/crm' });
      return res.end(`self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',(e)=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',()=>{});
self.addEventListener('notificationclick',(e)=>{ e.notification.close(); const alvo=e.notification.data?.url||'/crm#wa-atendimento';
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then((cs)=>{ for(const c of cs){ if(c.url.includes('/crm')){ c.focus(); c.navigate?.(alvo); return; } } return self.clients.openWindow(alvo); })); });`);
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
      /* Aceita e-mail ou documento associado a uma conta. Documento apenas
         localiza a conta: a senha cadastrada continua obrigatória. */
      const identificador = String(d.email || '').trim();
      let emailLogin = identificador || usuarios.emailAdmin();
      if (identificador && !identificador.includes('@')) {
        const documento = validarDocumento(identificador);
        emailLogin = documento.ok
          ? (usuarios.emailPorDocumento(documento.digitos, clientes.listar()) || '')
          : '';
      }
      const r = emailLogin
        ? usuarios.entrar(emailLogin, d.senha)
        : { ok: false, motivo: 'e-mail ou senha incorretos' };
      if (!r.ok) { return json(res, 401, { erro: r.motivo }); }
      if (r.exigeCodigo) {
        const c = usuarios.emitirCodigoDelegacao(r.email, { reenviar: d.reenviar === true });
        if (!c.ok) { return json(res, c.aguarde ? 429 : 403, { erro: c.motivo }); }
        if (c.novo) {
          const texto = `Seu código de acesso delegado ao ZEST é ${c.codigo}.\n\nEle vale por 24 horas e não deve ser compartilhado. Se você não solicitou este acesso, avise o administrador da conta.`;
          const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px;color:#202124"><h2 style="margin:0 0 12px">Código de acesso temporário</h2><p>Use este código para confirmar o acesso delegado ao ZEST:</p><p style="font-size:30px;font-weight:800;letter-spacing:7px;padding:14px 18px;background:#f4f4f5;border-radius:12px;text-align:center">${c.codigo}</p><p>O código vale por 24 horas. Não compartilhe. Se você não solicitou este acesso, avise o administrador da conta.</p><small>ZEST · Veloso Solution</small></div>`;
          const envio = await email.enviarEmail({ para: c.email, assunto: 'Seu código de acesso ao ZEST', texto, html });
          if (!envio.ok) {
            usuarios.cancelarCodigoDelegacao(c.email);
            console.error(`[acesso] código delegado não enviado para ${c.email}: ${envio.erro}`);
            return json(res, 503, { erro: 'Não consegui enviar o código por e-mail. Tente novamente mais tarde.' });
          }
          console.log(`[acesso] código delegado enviado para ${c.email}`);
        }
        return json(res, 200, { exigeCodigo: true, email: r.email, expira: c.expira, enviado: c.novo });
      }
      console.log(`[acesso] login ${r.papel} ${r.email}`);
      return json(res, 200, r);
    }
    if (req.method === 'POST' && rota === '/crm/api/entrar-codigo') {
      const b = await readBody(req);
      if (corpoEstourou(res, b)) { return; }
      let d; try { d = JSON.parse(b.toString('utf8')); } catch { return json(res, 400, { erro: 'payload invalido' }); }
      const r = usuarios.entrarComCodigoDelegacao(d.email, d.codigo);
      if (!r.ok) { return json(res, 401, { erro: r.motivo }); }
      console.log(`[acesso] login delegado ${r.email}`);
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
    /* EMPRESA CLIENTE (18/10): administra o painel DELA (o servidor já abriu os
       dados dela), mas não as telas da plataforma — carteira de clientes da
       Veloso, preços, venda, parceiros, a prospecção da Veloso, acessos. */
    if (quem.papel === 'empresa') {
      if (req.method === 'GET' && rota === '/crm/api/minha-conta') { const e = empresas.obter(quem.empresa); return json(res, 200, { papel: 'empresa', email: quem.email, nome: quem.nome || null, empresa: e ? { cnpj: e.cnpj, nome: e.nome } : null }); }
      if (/^\/crm\/api\/(clientes|precos|parceiros|venda|acessos|empresas|checkout|indicacao|prospeccao|planos|drive|drivin|tiktok|criar-acesso|campanhas|telegram|canais\/telegram|quebragalho|cortesia|integracoes)(\/|$)/.test(rota)) {
        return json(res, 403, { erro: 'área da plataforma', papel: 'empresa' });
      }
    }
    /* VENDEDOR: so o Atendimento. A porta e aqui, no servidor — esconder o menu
       na tela nao protege nada. */
    if (quem.papel === 'vendedor') {
      if (req.method === 'GET' && rota === '/crm/api/minha-conta') { return json(res, 200, { papel: 'vendedor', email: quem.email, ...quemAtende(quem) }); }
      const livre = (req.method === 'GET' && ['/crm/api/atendimentos', '/crm/api/atendimentos/historico', '/crm/api/atendimentos/historico/detalhe', '/crm/api/canais/telegram', '/crm/api/seguranca/pendentes', '/crm/api/orcamentos', '/crm/api/orcamentos/pdf', '/crm/api/prospeccao', '/crm/api/prospeccao/respostas'].includes(rota))
        || (req.method === 'POST' && ['/crm/api/atendimentos/responder', '/crm/api/atendimentos/assumir', '/crm/api/atendimentos/devolver', '/crm/api/atendimentos/encerrar', '/crm/api/atendimentos/finalizar',
          '/crm/api/orcamentos/salvar', '/crm/api/orcamentos/enviar', '/crm/api/orcamentos/cancelar', '/crm/api/orcamentos/duplicar', '/crm/api/orcamentos/cobrar',
          '/crm/api/prospeccao/contato', '/crm/api/prospeccao/mover'].includes(rota));
      if (!livre) { return json(res, 403, { erro: 'área restrita ao administrador', papel: 'vendedor' }); }
    }
    /* MODO CONSULTA: banda do mês esgotada. Leitura segue; escrita para. */
    if (req.method !== 'GET' && !LIVRE_EM_CONSULTA.has(rota) && emModoConsulta()) {
      return json(res, 402, { erro: MSG_CONSULTA, modoConsulta: true });
    }
    if (req.method === 'GET' && rota === '/crm/api/minha-conta') { const es = empresaAtual() ? empresas.obter(empresaAtual()) : null; return json(res, 200, { papel: 'admin', email: quem.email, delegada: quem.delegada === true, expira: quem.delegada ? quem.expira : null, suporte: es ? { cnpj: es.cnpj, nome: es.nome } : null }); }
    /* Qualificacao e roteamento: a matriz, as equipes (setores dos operadores) e
       quem tem acesso de vendedor. */
    if (req.method === 'GET' && rota === '/crm/api/qualificacao') {
      const ops = operadores.listar();
      const acessos = usuarios.acessosVendedores();
      const equipes = {};
      for (const o of operadores.ativos(ops)) { const e = operadores.norm(o.setor); (equipes[e] ||= []).push(o.nome); }
      const porTier = {};
      for (const o of operadores.ativos(ops).filter((x) => operadores.ehComercial(x.setor))) { (porTier[o.tier || operadores.TIER_MIN] ||= []).push(o.nome); }
      return json(res, 200, {
        ...qualif.config(), condicoes: qualif.CONDICOES, destinos: qualif.DESTINOS, intencoes: qualif.INTENCOES, prazos: qualif.PRAZOS,
        equipes, porTier, tierMin: qualif.TIER_MIN, tierMax: qualif.TIER_MAX, operadores: ops.map((o) => ({ ...o, comercial: operadores.ehComercial(o.setor), acesso: acessos.find((a) => a.operadorId === o.id) || null })),
      });
    }
    if (req.method === 'GET' && rota === '/crm/api/painel') { sincronizarFunil(); return json(res, 200, crm.painel()); }
    /* Visão geral: o painel do negócio (todos os canais) num período. Junta o
       que Resultados, Auditor e CRM já calculam — engine/vspainel/visao.mjs. */
    /* 18/10 (plano item 7): resultado mensal — WhatsApp + Telegram juntos. */
    if (req.method === 'GET' && rota === '/crm/api/retorno') {
      const dias = [7, 30, 90].includes(Number(new URL(req.url, 'http://x').searchParams.get('dias'))) ? Number(new URL(req.url, 'http://x').searchParams.get('dias')) : 30;
      const desde = Date.now() - dias * 86400000; let atendidos = 0; let peloBot = 0;
      for (const l of crm.listar()) {
        const inter = (l.historico || []).filter((h) => h.tipo === 'interacao' && new Date(h.quando).getTime() >= desde);
        if (!inter.some((h) => h.direcao === 'entrada')) { continue; }
        atendidos += 1; if (!inter.some((h) => h.direcao === 'saida' && h.autor === 'atendente')) { peloBot += 1; }
      }
      return json(res, 200, resultados.retorno({ dias, pagamentos: pagar.listar(), atendidos, peloBot }));
    }
    if (req.method === 'GET' && rota === '/crm/api/visao') {
      const u = new URL(req.url, 'http://x');
      const dias = [7, 30, 90].includes(Number(u.searchParams.get('dias'))) ? Number(u.searchParams.get('dias')) : 30;
      sincronizarFunil();
      const p = crm.painel();
      const protocolos = proto.listar();
      const pagamentos = pagar.listar();
      const naFila = protocolos.filter((x) => x.estado === 'na_fila');
      return json(res, 200, montarVisao({
        dias, leads: p.leads, funil: p.resumo, ehTelegram,
        auditoria: montarAuditoria({ canal: 'todos', doCanal: () => true, dias, leads: p.leads, protocolos, campanhas: campanhasTg.listar(), seguranca: seguranca.auditoria(500) }),
        resultados: ['whatsapp', 'telegram'].map((canal) => resultados.resumo({ canal, dias, pagamentos })),
        atencao: { esfriando: p.resumo.esfriando, filaSemDono: { whatsapp: naFila.filter((x) => !ehTelegram(x.de)).length, telegram: naFila.filter((x) => ehTelegram(x.de)).length } },
      }));
    }
    if (req.method === 'GET' && rota === '/crm/api/status') { return json(res, 200, crm.statusIntegracoes(estadoDoCanal())); }
    if (req.method === 'GET' && rota === '/crm/api/indicacao') { return json(res, 200, crm.painelIndicacao()); }
    if (req.method === 'GET' && rota === '/crm/api/redes') { return json(res, 200, { credenciais: CREDENCIAL }); }
    // TikTok: o painel LE o estado e MANDA testar, mas nao grava credencial por HTTP.
    // Gravar token via endpoint web contradiz a regra desta tela ("a credencial nao
    // fica gravada") e poria app_secret num POST. A configuracao mora na CLI, que
    // guarda em ~/.qa-gate/vstiktok com arquivo 0600. O diagnostico ja sai mascarado.
    if (req.method === 'GET' && rota === '/crm/api/tiktok') { return json(res, 200, tiktokDiagnostico()); }
    if (req.method === 'GET' && rota === '/crm/api/estoque') {
      return json(res, 200, await estoque.painel({ limiteProdutos: limitesAtuais().produtos }));
    }
    // Telas que eram casca: leem recibo do gate, dinheiro e cruzamento de dado real.
    /* Auditor de um canal no padrão de mercado: desempenho (TPR, TMA, SLA, CSAT,
       resolução pelo bot) + log de auditoria. Só dados do canal pedido. */
    if (req.method === 'GET' && rota === '/crm/api/auditor/canal') {
      const u = new URL(req.url, 'http://x');
      const canal = u.searchParams.get('canal') === 'whatsapp' ? 'whatsapp' : 'telegram';
      const dias = [7, 30, 90].includes(Number(u.searchParams.get('dias'))) ? Number(u.searchParams.get('dias')) : 30;
      const doCanal = (id) => canalDe(id) === canal;
      return json(res, 200, montarAuditoria({ canal, doCanal, dias, leads: crm.listar(), protocolos: proto.listar(), campanhas: canal === 'telegram' ? campanhasTg.listar() : [], seguranca: seguranca.auditoria(500) }));
    }
    /* Consumo: banda GERAL da instalação (todos os canais, painel, loja,
       integrações e mídia) + o recorte do canal pedido. */
    if (req.method === 'GET' && rota === '/crm/api/integracoes') {
      return json(res, 200, await estadoIntegracoes(new URL(req.url, 'http://x').searchParams.get('forcar') === '1'));
    }
    if (req.method === 'GET' && rota === '/crm/api/integracoes/alerta') {
      const e = await estadoIntegracoes();
      return json(res, 200, { caidas: e.caidas, resumo: e.resumo });
    }
    if (req.method === 'GET' && rota === '/crm/api/consumo/estado') {
      const e = estadoConsumo();
      return json(res, 200, { mes: e.mes, faixa: e.faixa, modoConsulta: e.modoConsulta, pct: e.pct, usadoBytes: e.usadoBytes, limiteBytes: e.limiteBytes, renovaEm: e.renovaEm });
    }
    if (req.method === 'GET' && rota === '/crm/api/consumo') {
      const u = new URL(req.url, 'http://x');
      const canal = u.searchParams.get('canal') === 'whatsapp' ? 'whatsapp' : 'telegram';
      const e = estadoConsumo(true);
      const doCanal = (id) => canalDe(id) === canal;
      const noMes = (q) => consumo.mesDe(q) === e.mes;
      let recebidas = 0; let peloBot = 0; let pelaEquipe = 0; let comMidia = 0; const conversas = new Set();
      for (const l of crm.listar()) {
        if (!doCanal(l.telefone)) { continue; }
        for (const h of l.historico || []) {
          if (h.tipo !== 'interacao' || !noMes(h.quando)) { continue; }
          conversas.add(l.telefone);
          if (h.direcao === 'entrada') { recebidas++; } else if (h.autor === 'atendente') { pelaEquipe++; } else { peloBot++; }
          if (h.midia || h.anexo) { comMidia++; }
        }
      }
      const publicacoes = canal === 'telegram' ? campanhasTg.listar().flatMap((c) => c.publicacoes || []).filter((p) => p.estado === 'publicada' && noMes(p.publicadaEm || p.quando)).length : 0;
      // O atendimento do WhatsApp roda pelo WhatsApp Web (a API da Meta aqui só entrega licença).
      const via = canal === 'telegram' ? 'API do Telegram' : 'WhatsApp Web';
      return json(res, 200, {
        ...e, canal, via,
        mensagens: { recebidas, peloBot, pelaEquipe, conversas: conversas.size, comMidia, publicacoes },
        custoPorMensagem: canal === 'telegram' ? 'A API do Telegram não cobra por mensagem.' : 'O WhatsApp Web não cobra por mensagem.',
        adendo: planos.adicionais().find((x) => x.code === 'banda-extra') || null,
        pedidos: consumo.pedidosBanda().slice(-10).reverse(),
        podeLiberar: quem.papel === 'admin',
      });
    }
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
      if (!['admin', 'empresa'].includes(usuarios.autenticar(req.headers['x-crm-token'])?.papel)) { return json(res, 403, { erro: 'senha ausente ou invalida' }); }
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
        doEstoque: (await estoque.listar()).slice(0, 200),
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
    /* Montar venda pela tabela do dono (29/09): catálogo importado do template. */
    if (req.method === 'GET' && rota === '/crm/api/venda') { return json(res, 200, { ...venda.catalogo(), templateNaPasta: venda.templateMaisNovo() }); }
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
          if (a.mudou) { comLoja(a.pagamento.loja, () => { const l = fin.lancarPagamento(a.pagamento); if (l.ok && !l.repetido) { console.log(`[caixa] entrada de ${a.pagamento.id} lancada`); } sincronizarFunil(); }); }
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
    /* Preços (aba de Clientes e licenças): o dono edita planos e adendos.
       Quem já tem contrato num plano mantém o preço — mudar vira versão nova. */
    if (req.method === 'GET' && rota === '/crm/api/precos') {
      const comContrato = (code) => clientes.listar().filter((c) => (c.produtos || []).includes(code) && (c.contratos || []).length).length;
      const lista = planos.listar().map((p) => ({ ...p, clientes: comContrato(p.code) }));
      return json(res, 200, { planos: lista, adicionais: planos.adicionais(), ciclos: planos.CICLOS, assinaturaLocal: planos.assinatura().plano || null });
    }
    if (req.method === 'GET' && rota === '/crm/api/planos') {
      return json(res, 200, {
        ...planos.tabela(),
        assinatura: planos.assinatura(),
        limiteAtendentes: planos.limiteDeAtendentes()
      });
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
      return json(res, 200, {
        ...estadoDoCanal(), saude: await canais.saude(), perfilAnterior: canais.perfilAnterior(),
        /* Sobe junto: alerta de tomada de conta que so existe no log e alerta
           que ninguem ve a tempo. */
        invasoes: canais.invasoes(), consumoMeta: canais.consumoMetaDoMes()
      });
    }
    /* Rota PROPRIA porque ler o perfil baixa a FOTO do servidor da Meta: pendurar
       isso no status faria a tela inteira esperar por uma imagem. */
    /* Resultado comercial de um canal: receita comprovada, pedidos, conversao,
       oportunidades e campanhas. Leads atendidos saem do CRM (trilha do canal). */
    /* Vendas do dia de UM canal (o que vendeu, pico, mais vendidos) + o caixa
       da LOJA (um só, soma os canais: aberto com o esperado até agora, e os
       últimos fechamentos). */
    if (req.method === 'GET' && rota === '/crm/api/vendas-dia') {
      const u = new URL(req.url, 'http://x');
      const canal = u.searchParams.get('canal') === 'telegram' ? 'telegram' : 'whatsapp';
      const pagamentos = pagar.listar();
      const cx = caixaLoja.estado();
      const vendasCaixa = cx.aberto ? resultados.vendasEntre({ de: cx.aberto.abertoEm, ate: new Date(Date.now() + 60000), pagamentos }) : null;
      return json(res, 200, {
        dia: resultados.doDia({ canal, dia: u.searchParams.get('dia'), pagamentos }),
        caixa: caixaLoja.estado({ vendas: vendasCaixa }),
        fechamentos: caixaLoja.historico({ limite: 10 }),
      });
    }
    /* Mapa mental do atendente: aprendizado do CANAL + empresa, concorrência,
       estratégia e dossiês (da loja, os mesmos nos dois canais). */
    if (req.method === 'GET' && rota === '/crm/api/mapa') {
      const u = new URL(req.url, 'http://x');
      return json(res, 200, { ...mapaMental.mapa(u.searchParams.get('canal') === 'telegram' ? 'telegram' : 'whatsapp'), rodando: pesquisaMapaRodando });
    }
    if (req.method === 'GET' && rota === '/crm/api/resultados') {
      const u = new URL(req.url, 'http://x');
      const canal = u.searchParams.get('canal') === 'telegram' ? 'telegram' : 'whatsapp';
      const dias = [7, 30, 90].includes(Number(u.searchParams.get('dias'))) ? Number(u.searchParams.get('dias')) : 30;
      const desde = Date.now() - dias * 86400000;
      let atendidos = 0; let peloBot = 0;
      for (const l of crm.listar()) {
        if (canalDe(l.telefone) !== canal) { continue; }
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
    /* Orçamentos: a lista (o vendedor vê só os dele), os números do período e o
       catálogo pra montar — o vendedor não tem acesso ao Estoque, e orçamento
       sem catálogo seria digitar preço de cabeça. */
    /* Prospecção: o vendedor indo atrás do cliente, região por região. */
    /* Envio automático do e-mail do dia 0 (só o dono: vendedor não chega aqui). */
    if (req.method === 'GET' && rota === '/crm/api/prospeccao/envio') {
      if (quem.papel === 'vendedor') { return json(res, 403, { erro: 'área restrita ao administrador' }); }
      let previa = null; try { previa = prospEnvio.previa(); } catch (e) { previa = { erro: e.message }; }
      /* Retorno: prospecção + parceiros do Telegram (canais com link próprio e comissão). */
      let retorno = null;
      try {
        const vp = resultados.vendasPorParceiro({ canal: 'telegram', pagamentos: pagar.listar() });
        const parcs = campanhasTg.listar().flatMap((c) => (c.parceiros || []).map((p) => campanhasTg.contaDaComissao(p, vp[`${c.codigo}${resultados.SEP_PARCEIRO}${p.slug}`])));
        retorno = {
          ...prosp.retorno({ clientes: clientes.listar() }), canaisParceiros: parcs.length, canaisComVenda: parcs.filter((x) => x.vendas).length,
          vendasCanais: parcs.reduce((s, x) => s + x.vendas, 0), comissaoDevida: parcs.reduce((s, x) => s + x.devidaCentavos, 0)
        };
      } catch (e) { retorno = { erro: e.message }; }
      return json(res, 200, { ...prospEnvio.estado(), previa, caixa: prospCaixa.estado(), retorno });
    }
    /* Campanha no WhatsApp Contagem/Betim/BH (03/10) — só o dono vê. */
    if (req.method === 'GET' && rota === '/crm/api/prospeccao/campanha-whatsapp') {
      if (quem.papel === 'vendedor') { return json(res, 403, { erro: 'área restrita ao administrador' }); }
      return json(res, 200, campanhaWpp.estado());
    }
    /* 16/10: retorno por estado e ramo, onde o ramo rende mais e a cota do mês. A plataforma
       (VS_PROSPECCAO_ISENTA=1) não paga a própria prospecção. Vendedor fica fora (lista livre). */
    if (req.method === 'GET' && rota === '/crm/api/prospeccao/inteligencia') {
      const u = new URL(req.url, 'http://x').searchParams;
      return json(res, 200, prosp.inteligencia({ ramo: String(u.get('ramo') || '').slice(0, 80), isenta: process.env.VS_PROSPECCAO_ISENTA === '1' }));
    }
    if (req.method === 'GET' && rota === '/crm/api/prospeccao/respostas') { return json(res, 200, { respostas: prosp.respostas() }); }
    if (req.method === 'GET' && rota === '/crm/api/prospeccao') {
      const u = new URL(req.url, 'http://x').searchParams;
      return json(res, 200, prosp.painel({
        regiaoId: u.get('regiao') || null, busca: u.get('busca') || '', etapa: u.get('etapa') || '', limite: Number(u.get('limite')) || 10, pagina: Number(u.get('pagina')) || 1,
        loja: orcSrv.loja(), vendedor: quem.papel === 'vendedor' ? quemAtende(quem).nome : null, origem: origemPublica()
      }));
    }
    /* Balanço da prospecção: é pra diretoria — vendedor não chega aqui (fora da lista livre). */
    if (req.method === 'GET' && rota === '/crm/api/prospeccao/balanco') { return json(res, 200, prosp.balanco()); }
    /* 18/10 — EMPRESAS CLIENTES (só o dono da plataforma: empresa e vendedor caem nos 403 acima). */
    if (req.method === 'GET' && rota === '/crm/api/empresas') {
      return json(res, 200, { empresas: empresas.listar().map((e) => ({ ...e, acessos: usuarios.acessosDaEmpresa(e.cnpj) })), embedded: empresaWa.embeddedDisponivel() });
    }
    /* O WhatsApp oficial da empresa em uso (login dela, ou o dono em suporte). */
    if (req.method === 'GET' && rota === '/crm/api/empresa/whatsapp') { return json(res, 200, empresaWa.estado()); }
    /* 18/10: Instagram Direct (da plataforma, ou da empresa cliente em uso). */
    if (req.method === 'GET' && rota === '/crm/api/canais/instagram') { return json(res, 200, canais.instagramInfo()); }
    /* Acessos (07/10, dono: "um menu pra eu travar acessos, só o dono"). Vendedor cai no 403 da lista. */
    if (req.method === 'GET' && rota === '/crm/api/acessos') {
      const t = usuarios.travas();
      const ops = new Map(operadores.listar().map((o) => [o.id, o]));
      const pessoas = usuarios.acessosVendedores().map((a) => ({ email: a.email, nome: ops.get(a.operadorId)?.nome || a.nome || a.email, setor: ops.get(a.operadorId)?.setor || null, papel: 'atendente', travado: t.travados.includes(a.email) }));
      const clientesAcesso = usuarios.acessosClientes().map((c) => ({ ...c, papel: 'cliente', travado: t.travados.includes(c.email) }));
      return json(res, 200, { soDono: t.soDono, mudouPor: t.mudouPor || null, mudouEm: t.mudouEm || null, pessoas, clientes: clientesAcesso, delegacao: usuarios.statusDelegacao() });
    }
    /* Rendimento da equipe (07/10): só resultado — atendente PJ não tem horário medido. Só o dono (vendedor cai no 403 da lista). */
    if (req.method === 'GET' && (rota === '/crm/api/rendimento' || rota === '/crm/api/rendimento/pdf')) {
      const u = new URL(req.url, 'http://x');
      const per = rendimentoEq.periodo({ tipo: u.searchParams.get('tipo') === 'semana' ? 'semana' : 'mes', ref: u.searchParams.get('ref') || undefined });
      const r = rendimentoEq.rendimento({
        periodo: per, operadores: operadores.listar(), acessos: usuarios.acessosVendedores(), leads: crm.listar(),
        protocolos: proto.listar(), orcamentos: orc.listar({}), pedidos: resultados.pedidos(), pagamentos: pagar.listar()
      });
      if (rota === '/crm/api/rendimento') { return json(res, 200, r); }
      try {
        const buf = await clientesSrv.imprimirPdf(rendimentoEq.rendimentoHtml(r, { loja: orcSrv.loja() }));
        res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="rendimento-equipe-${per.diaInicial}.pdf"`, 'cache-control': 'no-store' });
        return res.end(buf);
      } catch (e) { return json(res, 500, { erro: `não consegui gerar o PDF: ${e.message}` }); }
    }
    if (req.method === 'GET' && rota === '/crm/api/prospeccao/balanco/pdf') {
      try {
        const buf = await clientesSrv.imprimirPdf(prosp.balancoHtml(prosp.balanco(), { loja: orcSrv.loja() }));
        res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="balanco-prospeccao-${new Date().toISOString().slice(0, 10)}.pdf"`, 'cache-control': 'no-store' });
        return res.end(buf);
      } catch (e) { return json(res, 500, { erro: `não consegui gerar o PDF: ${e.message}` }); }
    }
    if (req.method === 'GET' && rota === '/crm/api/provador') {
      const c = provador.config();
      return json(res, 200, {
        config: c, link: c.chave ? `${origemPublica()}/provador/${empresaAtual() || '0'}.${c.chave}` : null,
        segmentos: provador.segmentosAtivos(), medidas: provador.MEDIDAS, categorias: provador.CATEGORIAS, veste: provador.VESTE,
        pecas: provador.listarPecas(), provas: provador.listarProvas()
      });
    }
    /* Cadê Você e WhatsApp do salão (Evolution): configuração e estado do canal
       são carregados pelo cadastro isolado de cada salão. */
    /* Canais universais (Evolution): números da empresa, IA de cada um e estado. */
    if (req.method === 'GET' && rota === '/crm/api/canais/evolution') {
      const moduloCanais = new URL(req.url, 'http://x').searchParams.get('modulo') === 'salao' ? 'salao' : 'canais';
      const empresaCanais = empresaAtual() ? empresas.obter(empresaAtual()) : null;
      return json(res, 200, { ok: true, configurado: canaisEvo.configurado(), numeros: canaisEvo.listar(moduloCanais), ias: canaisEvo.iasDisponiveis(moduloCanais), nichos: moduloCanais === 'salao' ? canaisEvo.NICHOS_SALAO : [], modulo: moduloCanais, empresa: empresaCanais?.nome || null, ...(moduloCanais === 'canais' ? { auditoria: canaisEvo.estadoAuditoria() } : {}) });
    }
    if (req.method === 'GET' && rota === '/crm/api/cadevc') {
      const cfgcadevc = cadevcCfg.config();
      let wa = { estado: 'nao-configurado', instancia: cfgcadevc.evolutionInstance || null };
      const ps = provcadevc();
      if (ps) {
        try {
          await ps.sincronizar();
          wa = { ...ps.status(), tentativas: 0 };
          if (wa.estado === 'conectado') {
            const hook = await garantirWebhookCadevc(cfgcadevc);
            wa.webhookConfigurado = hook.ok;
            if (!hook.ok) { wa.webhookErro = hook.erro; }
          }
        } catch (e) { wa = { estado: 'erro', erro: e.message, instancia: cfgcadevc.evolutionInstance }; }
      }
      if (new URL(req.url, 'http://x').searchParams.get('estado') === '1') {
        return json(res, 200, { ok: true, whatsapp: wa, config: cadevcCfg.paraTela() });
      }
      let cadevcInfo = { ligado: false, erro: 'Cadê Você não configurado.' };
      if (cfgcadevc.cadevcUrl && cfgcadevc.cadevcToken) {
        try {
          const cli = criarCadevcClient({ baseUrl: cfgcadevc.cadevcUrl, token: cfgcadevc.cadevcToken });
          const sal = await cli.cadevc();
          cadevcInfo = { ligado: true, cadevc: sal.cadevc, regras: sal.regras, servicos: sal.servicos, horarios: sal.horarios };
        } catch (e) { cadevcInfo = { ligado: false, erro: e.message }; }
      }
      return json(res, 200, { ok: true, cadevc: cadevcInfo, whatsapp: wa, config: cadevcCfg.paraTela(), ia: { conectada: cfgcadevc.bot0007Id || null, opcoes: salaoIas.listarParaSalao(), servicos: salaoIas.SERVICOS_SALAO.map((x) => ({ id: x.id, nome: x.nome })) } });
    }
    if (req.method === 'GET' && rota === '/crm/api/orcamentos') {
      const u = new URL(req.url, 'http://x');
      const dias = [7, 30, 90, 365].includes(Number(u.searchParams.get('dias'))) ? Number(u.searchParams.get('dias')) : 30;
      const eu = quem.papel === 'vendedor' ? quem.email : null;
      const tel = u.searchParams.get('telefone') || undefined;
      const lista = orc.listar({ dias: tel ? undefined : dias, telefone: tel, vendedorEmail: eu || undefined })
        .map((o) => ({ ...o, url: o.situacao === 'rascunho' ? null : orcSrv.urlPublica(o) }));
      return json(res, 200, {
        orcamentos: lista, resumo: orc.resumo({ dias }), loja: orcSrv.loja(), config: orc.config(),
        catalogo: await catalogoOrc()
      });
    }
    if (req.method === 'GET' && rota === '/crm/api/orcamentos/pdf') {
      const o = orc.obter(new URL(req.url, 'http://x').searchParams.get('id'));
      if (!o || (quem.papel === 'vendedor' && o.vendedor?.email !== quem.email)) { return json(res, 404, { erro: 'orçamento não encontrado' }); }
      try {
        const buf = await clientesSrv.imprimirPdf(orc.html(o, { loja: orcSrv.loja(), publico: false }));
        res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${o.numero}.pdf"`, 'cache-control': 'no-store' });
        return res.end(buf);
      } catch (e) { return json(res, 500, { erro: `não consegui gerar o PDF: ${e.message}` }); }
    }
    if (req.method === 'GET' && rota === '/crm/api/campanhas') {
      const u = new URL(req.url, 'http://x');
      const dias = [7, 30, 90].includes(Number(u.searchParams.get('dias'))) ? Number(u.searchParams.get('dias')) : 30;
      const r = resultados.resumo({ canal: 'telegram', dias, pagamentos: pagar.listar() });
      const num = new Map(r.porCampanha.map((c) => [c.codigo, c]));
      const vendasParc = resultados.vendasPorParceiro({ canal: 'telegram', pagamentos: pagar.listar() });
      const doAssistente = campanhasTg.listar().filter((c) => c.canal === 'telegram')
        .map((c) => ({ ...c, parceiros: (c.parceiros || []).map((p) => ({ ...p, comissao: campanhasTg.contaDaComissao(p, vendasParc[`${c.codigo}${resultados.SEP_PARCEIRO}${p.slug}`]) })) }));
      const conhecidos = new Set(doAssistente.map((c) => c.codigo));
      const metricas = (c) => { const n = num.get(c.codigo); return n ? { entradas: n.entradas, conversas: n.conversas, pedidos: n.pedidos, concluidos: n.concluidos, receitaCentavos: n.receitaCentavos, porParceiro: n.porParceiro || [] } : null; };
      const lista = [
        ...doAssistente.map((c) => ({ ...c, metricas: ['ativa', 'encerrada'].includes(c.estado) ? metricas(c) : null })),
        ...r.porCampanha.filter((c) => !conhecidos.has(c.codigo)).map((c) => ({
          id: null, legado: true, canal: 'telegram', codigo: c.codigo, nome: c.nome, objetivo: 'captar', objetivoTexto: campanhasTg.OBJETIVOS.captar,
          estado: c.arquivada ? 'encerrada' : 'ativa', estadoTexto: c.arquivada ? 'Encerrada' : 'Ativa', criadaEm: c.criadaEm, metricas: metricas(c),
        })),
      ].sort((a, b) => String(b.atualizadaEm || b.criadaEm).localeCompare(String(a.atualizadaEm || a.criadaEm)));
      return json(res, 200, {
        dias, campanhas: lista, linkBot: canais.telegramInfo().link || null, botArroba: canais.telegramInfo().numero || null,
        destinos: campanhasTg.listarDestinos(), politica: campanhasTg.politica(),
        loja: process.env.VITRINE_NOME || 'nossa loja',
        catalogo: (await estoque.doAtendimento()).map((p) => ({ sku: p.sku, nome: p.nome, descricao: p.descricao, precoCentavos: p.precoCentavos, precoDeCentavos: p.precoDeCentavos, imagem: p.imagem, esgotado: p.esgotado })),
        limites: campanhasTg.LIMITE,
      });
    }
    /* Onde o bot trabalha (canais e grupos) — configurado em Canal e conexão. */
    if (req.method === 'GET' && rota === '/crm/api/telegram/destinos') {
      return json(res, 200, { destinos: campanhasTg.listarDestinos(), link: canais.telegramInfo().link || null, bot: canais.telegramInfo().numero || null });
    }
    /* Tela do Telegram: estado do bot e se ha token guardado. O token nao sai. */
    if (req.method === 'GET' && rota === '/crm/api/canais/telegram') {
      return json(res, 200, canais.telegramInfo());
    }
    if (req.method === 'GET' && rota === '/crm/api/canais/perfil') {
      const perfil = await canais.perfilAtual();
      return json(res, 200, { ok: true, perfil: perfil ? { ...perfil, temPin: canais.temPinDoNumero() } : null });
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
        const iniJanela = p.legado ? anterior : [new Date(new Date(p.abertoEm).getTime() - 300000).toISOString(), anterior].sort().pop();
        const inter = (l?.historico || []).filter((h) => h.tipo === 'interacao' && h.quando > iniJanela && h.quando <= new Date(new Date(p.encerradoEm).getTime() + 60000).toISOString());
        return {
          numero: p.numero, telefone: p.de, nome: l?.nome || null, canal: canalDe(p.de),
          abertoEm: p.abertoEm, encerradoEm: p.encerradoEm, duracaoMin: Math.max(0, Math.round((new Date(p.encerradoEm) - new Date(p.abertoEm)) / 60000)),
          motivo: p.motivoEncerramento || null, encerradoPor: p.encerradoPor || null, atendidoPor: p.atendidoPor || null,
          desfecho: p.desfecho || (['inatividade', 'moderacao'].includes(p.motivoEncerramento) ? p.motivoEncerramento : 'encerrado'), motivoTexto: p.motivoTexto || null,
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
        .filter((x) => !canal || x.canal === canal).filter((x) => x.mensagens > 0 || x.comGente || x.desfecho === 'encerrado');
      const notas = lista.map((x) => x.avaliacao?.nota).filter((n) => n != null);
      return json(res, 200, {
        dias, atendimentos: lista.slice(0, 500), total: lista.length,
        resumo: {
          comGente: lista.filter((x) => x.comGente).length,
          porCliente: lista.filter((x) => x.encerradoPor?.tipo === 'cliente').length,
          porAtendente: lista.filter((x) => x.encerradoPor?.tipo === 'atendente').length,
          porInatividade: lista.filter((x) => x.desfecho === 'inatividade').length,
          finalizados: lista.filter((x) => x.desfecho === 'finalizado').length,
          encerradosAForca: lista.filter((x) => x.desfecho === 'encerrado').length,
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
            canal: canalDe(l.telefone),
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
            /* 02/10 (dono: "tela de atendimento badernada"): a conversa abre no atendimento
               ATUAL; o que veio antes fica recolhido em "atendimentos anteriores". */
            protocoloAbertoEm: (proto.aberto(l.telefone) || proto.ultimoEncerrado(l.telefone) || {}).abertoEm || null,
            historico: l.historico || [],
            assumidaPor: fila?.assumidaPor || null,
            aguardandoFinal: proto.aberto(l.telefone)?.finalizacao?.estado === 'aguardando',
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
           aberto, quem esta na fila e a conversa antiga SEM protocolo nenhum (de
           antes de todo atendimento ter um): ela nunca foi encerrada, e tirar da
           lista fazia sumir da tela — no historico ela nao entra, porque ele vem
           dos protocolos. Encerrou pelo botao, ganha protocolo e vai pro historico. */
        .filter((c) => c.esperandoGente || (c.protocoloEstado && c.protocoloEstado !== 'encerrado') || !c.protocolo)
        .filter((c) => quem.papel !== 'vendedor' || vendedorVe(c, quemAtende(quem)))
        .sort((a, b) => {
          // Quem espera gente vem primeiro; depois, conversa mais recente.
          if (a.esperandoGente !== b.esperandoGente) { return a.esperandoGente ? -1 : 1; }
          return String(b.ultima?.quando || '').localeCompare(String(a.ultima?.quando || ''));
        });
      /* Quem pode atender agora — a tela SEM conversa mostra isto em vez de um
         vazio: bot ligado, atendentes ativos e quem esta com o painel aberto. */
      const noPainel = usuarios.vendedoresNoPainel();
      const acessos = new Set(usuarios.acessosVendedores().map((a) => a.operadorId));
      const equipe = operadores.ativos(operadores.listar()).map((o) => ({ nome: o.nome, setor: o.setor, temAcesso: acessos.has(o.id), noPainel: noPainel.has(o.id) }));
      const cfgBot = bot.getConfig();
      const cfgTg = bot.comCanal('telegram', () => bot.getConfig());
      return json(res, 200, {
        conversas, esperando: esperando.length, canal: estadoDoCanal(), equipe,
        /* 17/10: o card dizia "atende 24 h" com horário configurado — fora dele o bot só avisa que está fechado. */
        bot: { ativo: cfgBot.ativo !== false, nome: cfgBot.nome || null, temHorario: !!cfgBot.horario, aberto: bot.estaAberto(cfgBot.horario), hoje: bot.horarioDeHoje(cfgBot.horario) },
        botTelegram: { ativo: cfgTg.ativo !== false, nome: cfgTg.nome || null },
        /* A conversa só mostra o botão Orçamento se o negócio trabalha com orçamento. */
        orcamentoLigado: orc.config().ligado
      });
    }
    // Um bot por canal: ?canal=telegram abre o bot do Telegram.
    /* MULTI-LOJA: a lista (pro seletor) e o controle UNIFICADO — cada loja com o
       dia dela e o total da rede. Cada número sai de dentro da loja (comLoja). */
    if (req.method === 'GET' && rota === '/crm/api/lojas') { return json(res, 200, { ...lojas.estado(), atual: req.todasLojas ? 'todas' : lojaAtual() }); }
    if (req.method === 'GET' && rota === '/crm/api/lojas/unificado') {
      const pagamentos = pagar.listar();
      const porLoja = (await lojas.emCadaLoja(async () => {
        const dia = resultados.doDia({ pagamentos });
        const cx = caixaLoja.estado();
        const itens = (await estoque.listar()).filter((p) => p.ativo !== false);
        return {
          vendidoCentavos: dia.vendidoCentavos + dia.naEntregaCentavos, pedidos: dia.pedidos, aguardandoCentavos: dia.aguardandoCentavos,
          semanaPassadaCentavos: (dia.semanaPassada?.vendidoCentavos || 0) + (dia.semanaPassada?.naEntregaCentavos || 0),
          caixaAberto: !!cx.aberto, produtos: itens.length, emFalta: itens.filter((p) => Number(p.quantidade) - Number(p.reservado || 0) <= 0).length, leads: crm.listar().length
        };
      })).map((x) => ({ ...x.loja, ...x.r }));
      const soma = (k) => porLoja.reduce((s, l) => s + (l[k] || 0), 0);
      return json(res, 200, {
        dia: resultados.doDia({ pagamentos }).dia, lojas: porLoja,
        total: {
          vendidoCentavos: soma('vendidoCentavos'), pedidos: soma('pedidos'), aguardandoCentavos: soma('aguardandoCentavos'), semanaPassadaCentavos: soma('semanaPassadaCentavos'),
          produtos: soma('produtos'), emFalta: soma('emFalta'), leads: soma('leads'), caixasAbertos: porLoja.filter((l) => l.caixaAberto).length
        }
      });
    }
    if (req.method === 'GET' && rota === '/crm/api/drive') { return json(res, 200, drive.painel()); }
    if (req.method === 'GET' && rota === '/crm/api/drivin') {
      const env = new Map(drivin.listarEnvios({ limite: 200 }).map((e) => [e.referencia, e]));
      const pags = new Map(pagar.listar().map((p) => [String(p.id), p.estado]));
      const pedidos = resultados.pedidos().slice(-40).reverse().map((p) => ({
        referencia: p.referencia, nome: p.nome, criadoEm: p.criadoEm, valorCentavos: p.valorCentavos,
        canal: p.canal, entrega: p.entrega?.endereco || null, pago: ['CONFIRMADO', 'DISPONIVEL'].includes(pags.get(String(p.pagamentoId))), drivin: env.get(p.referencia) || null
      }));
      const s = encodeURIComponent(drivin.segredo());
      return json(res, 200, {
        config: drivin.config(), pedidos,
        webhooks: { rotas: `${origemPublica()}/webhook/drivin/rotas?t=${s}`, entregas: `${origemPublica()}/webhook/drivin/entregas?t=${s}` }
      });
    }
    if (req.method === 'GET' && rota === '/crm/api/bot/modelos') {
      return json(res, 200, {
        modelos: botModelos.listar(),
        profissoes: Object.entries(profissoes.PROFISSOES).map(([id, item]) => ({ id, nome: item.nome, foco: item.foco })),
        empresa: process.env.VITRINE_NOME || null,
      });
    }
    /* Hotel dos Bots (missão 0007): catálogo dos bots comerciais, totais e instâncias. */
    if (req.method === 'GET' && rota === '/crm/api/hotel') {
      return json(res, 200, {
        ...hotel.painel(),
        salao: { bot0007Id: cadevcCfg.config().bot0007Id || null },
        nichosSalao: [...salaoIas.SERVICOS_SALAO.map((x) => x.padrao.source), salaoIas.PADRAO_SALAO_GERAL.source],
      });
    }
    if (req.method === 'GET' && rota === '/crm/api/bot') {
      const canalBot = new URL(req.url, 'http://x').searchParams.get('canal') === 'telegram' ? 'telegram' : 'whatsapp';
      return json(res, 200, { canal: canalBot, ...bot.comCanal(canalBot, () => bot.painel()), profissoes: profissoes.PROFISSOES, areas: profissoes.AREAS, jeitos: profissoes.JEITOS });
    }
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
        canal: (estadoDoCanal().canais || []).find((c) => /whatsapp/.test(c.nome || c.canal || ''))?.estado || null,
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
      const p = await estoque.obter(sku);
      if (!p) { return json(res, 404, { erro: `produto "${sku}" nao encontrado` }); }
      return json(res, 200, { produto: p, historico: await estoque.historico(sku, 20) });
    }
    if (req.method === 'GET' && rota === '/crm/api/estoque/publicados') {
      const origem = process.env.PAINEL_URL || 'https://bolsocheio.velososolution.com.br';
      return json(res, 200, { publicados: await estoque.publicados(), urlVitrine: `${origem}/vitrine`, reservas: (await estoque.reservas()).slice(0, 100) });
    }
    if (req.method === 'GET' && rota === '/crm/api/estoque/reservas') {
      return json(res, 200, { reservas: await estoque.reservas(), excluidos: (await estoque.excluidos()).map(estoque.resumir) });
    }
    if (req.method === 'GET' && rota === '/crm/api/estoque/lotes') {
      const origem = process.env.PAINEL_URL || 'https://bolsocheio.velososolution.com.br';
      return json(res, 200, {
        lotes: await estoque.lotes(),
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
      const l = await estoque.obterLote(id);
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
      return json(res, 200, { movimentos: await estoque.historico(new URL(req.url, 'http://x').searchParams.get('sku')) });
    }
    // Download do feed: sai como ARQUIVO, nao como JSON — e o que o Google e a Meta
    // consomem. Os recusados vao no header, pra tela poder avisar sem baixar duas vezes.
    if (req.method === 'GET' && rota === '/crm/api/estoque/exportar') {
      const canal = new URL(req.url, 'http://x').searchParams.get('canal') || 'json';
      const r = await estoque.exportar(canal, { loja: process.env.VSESTOQUE_LOJA, site: process.env.VSESTOQUE_SITE });
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
          const prod = await estoque.obter(String(d.sku || ''));
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
        case '/crm/api/canais/aplicar-nome': r = await canais.aplicarNomeAprovado({ pin: d.pin }); seguranca.auditar({ tipo: 'canal:nome', detalhe: r.ok ? 'nome aprovado colocado no ar' : `nome aprovado não entrou: ${r.erro}`, cliente: quem.email || null, resultado: r.ok ? 'salvo' : 'erro' }); break;
        case '/crm/api/canais/restaurar-perfil': r = await canais.restaurarPerfil({ canal: d.canal }); break;
        case '/crm/api/canais/config': r = canais.salvarConfigCanal(d); break;
        case '/crm/api/empresas/criar': r = empresas.criar(d);
          /* Nasce com o funil da plataforma (sem funil o CRM não registra a conversa e ela some do Atendimento). */
          if (r.ok) { const fun = crm.getFunil()?.funil?.length ? crm.getFunil().funil : ['Novo lead', 'Em atendimento', 'Proposta', 'Fechado']; comEmpresa(r.empresa.cnpj, () => crm.setFunil(fun)); }
          if (r.ok) { seguranca.auditar({ tipo: 'empresa:criada', detalhe: `${r.empresa.nome} (${r.empresa.cnpj})`, cliente: quem.email || null, resultado: 'salvo' }); } break;
        case '/crm/api/empresas/arquivar': r = empresas.arquivar(d.cnpj);
          if (r.ok) { seguranca.auditar({ tipo: 'empresa:arquivada', detalhe: String(d.cnpj || ''), cliente: quem.email || null, resultado: 'salvo' }); } break;
        case '/crm/api/empresas/acesso':
          r = empresas.existe(d.cnpj) ? usuarios.criarAcessoEmpresa({ empresa: d.cnpj, email: d.email, nome: d.nome, senha: d.senha }) : { ok: false, motivo: 'empresa não encontrada' };
          if (r.ok) { seguranca.auditar({ tipo: 'empresa:acesso', detalhe: `${r.email} → ${r.empresa}`, cliente: quem.email || null, resultado: 'salvo' }); } break;
        case '/crm/api/empresas/acesso/remover': r = usuarios.removerAcessoEmpresa(d.email);
          if (r.ok) { seguranca.auditar({ tipo: 'empresa:acesso-removido', detalhe: String(d.email || ''), cliente: quem.email || null, resultado: 'salvo' }); } break;
        case '/crm/api/empresa/whatsapp/conectar': r = await empresaWa.conectarManual(d);
          seguranca.auditar({ tipo: 'empresa:whatsapp', detalhe: r.ok ? `ligado (manual) ${r.numero || ''} na ${empresaAtual()}` : `não ligou: ${r.motivo}`, cliente: quem.email || null, resultado: r.ok ? 'salvo' : 'erro' }); break;
        case '/crm/api/empresa/whatsapp/embedded': r = await empresaWa.conectarEmbedded(d);
          seguranca.auditar({ tipo: 'empresa:whatsapp', detalhe: r.ok ? `ligado (Meta) ${r.numero || ''} na ${empresaAtual()}` : `não ligou: ${r.motivo}`, cliente: quem.email || null, resultado: r.ok ? 'salvo' : 'erro' }); break;
        case '/crm/api/canais/instagram/conectar': {
          r = await canais.conectarInstagram({ token: d.token, produtos: () => estoque.doAtendimento() });
          if (r.ok && empresaAtual()) { const lig = empresas.ligarInstagram(empresaAtual(), { igId: r.igId, conta: r.conta }); if (!lig.ok) { await canais.desconectarInstagram(); r = { ok: false, erro: lig.motivo }; } }
          seguranca.auditar({ tipo: 'canal:instagram', detalhe: r.ok ? `ligado ${r.conta || r.igId}${empresaAtual() ? ' na ' + empresaAtual() : ''}${r.webhook === false ? ' (webhook NÃO inscrito)' : ''}` : `não ligou: ${r.erro}`, cliente: quem.email || null, resultado: r.ok ? 'salvo' : 'erro' });
          break;
        }
        case '/crm/api/canais/instagram/desconectar': r = await canais.desconectarInstagram(); if (empresaAtual()) { empresas.ligarInstagram(empresaAtual(), { igId: null }); } break;
        case '/crm/api/empresa/whatsapp/desligar': r = empresaWa.desligar();
          if (r.ok) { seguranca.auditar({ tipo: 'empresa:whatsapp', detalhe: `desligado na ${empresaAtual()}`, cliente: quem.email || null, resultado: 'salvo' }); } break;
        case '/crm/api/acessos/so-dono': r = usuarios.travarTudo(d.ligado === true, { por: quem.email || null });
          seguranca.auditar({ tipo: 'acessos:so-dono', detalhe: d.ligado === true ? 'só o dono entra (todos travados)' : 'acessos liberados', cliente: quem.email || null, resultado: 'salvo' }); break;
        case '/crm/api/acessos/pessoa': r = usuarios.travarPessoa(String(d.email || ''), d.travado === true, { por: quem.email || null });
          if (r.ok) { seguranca.auditar({ tipo: 'acessos:pessoa', detalhe: `${d.travado === true ? 'travado' : 'liberado'}: ${String(d.email || '').toLowerCase()}`, cliente: quem.email || null, resultado: 'salvo' }); } break;
        case '/crm/api/acessos/delegacao':
          r = quem.delegada ? { ok: false, motivo: 'somente o administrador titular pode alterar a delegação' }
            : usuarios.configurarDelegacao(String(d.email || ''), { por: quem.email || null });
          if (r.ok) { seguranca.auditar({ tipo: 'acessos:delegacao', detalhe: r.delegacao.email ? `delegado: ${r.delegacao.email}` : 'delegação removida', cliente: quem.email || null, resultado: 'salvo' }); }
          break;
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
        case '/crm/api/precos/plano': {
          const code = String(d.code || '');
          const outros = clientes.listar().filter((c) => (c.produtos || []).includes(code) && (c.contratos || []).length).length;
          r = planos.atualizarPlano(code, d.mudancas || {}, { por: quem.email || null, outrosAssinantes: outros });
          if (r.ok) { console.log(`[precos] ${code}${r.versionado ? ` → ${r.plano.code} (versão nova)` : ''} por ${quem.email}`); }
          break;
        }
        /* Teste de verdade de uma integração: pergunta ao próprio serviço. */
        case '/crm/api/integracoes/testar': {
          const id = String(d.id || '');
          const t0 = Date.now();
          let t = { ok: false, detalhe: 'esta integração não tem teste automático' };
          if (id === 'whatsapp' || id === 'telegram') {
            const sa = (await canais.saude()) || [];
            const x = (Array.isArray(sa) ? sa : sa.canais || []).find((c) => c.nome === (id === 'whatsapp' ? 'whatsapp-web' : 'telegram'));
            t = x ? { ok: !!x.ok, detalhe: x.detalhe || (x.ok ? 'respondeu' : 'não respondeu') } : { ok: false, detalhe: 'canal não montado' };
          } else if (id === 'pagamento') {
            const prov = pagar.provedorAtual();
            if (prov.nome !== 'mercadopago') { t = { ok: prov.pronto, detalhe: prov.pronto ? 'credencial gravada (o Asaas não tem conferência automática aqui)' : 'sem credencial' }; } else {
              const c = await pagar.conferirCredenciais();
              const ativa = c.chaves.find((k) => k.campo === (c.ambienteAtivo === 'producao' ? 'producao' : 'teste'));
              t = { ok: !!ativa?.ok && !c.trocadas.length, detalhe: ativa?.ok ? `o Mercado Pago aceitou a chave de ${ativa.ambiente}${c.avisos.length ? ' · ' + c.avisos.join('; ') : ''}` : (ativa?.erro || ativa?.motivo || 'chave recusada ou não preenchida') };
            }
          } else if (id === 'quebragalho') {
            const q = await painelQuebraGalho();
            t = { ok: !!q.disponivel, detalhe: q.disponivel ? 'marketplace respondeu' : `${q.motivo}${q.comoResolver ? ' — ' + q.comoResolver : ''}` };
          } else if (id === 'email') {
            const para = String(quem.email || '');
            const e = /@/.test(para) ? await email.enviarEmail({ para, assunto: 'Teste do ZEST', texto: 'Este é um e-mail de teste da central de integrações do ZEST. Se chegou, o envio de e-mail está funcionando.' }) : await email.testarLogin();
            t = { ok: !!e.ok, detalhe: e.ok ? (/@/.test(para) ? `e-mail de teste enviado para ${para}` : 'o servidor de e-mail aceitou o login') : (e.erro || 'falhou') };
          }
          await estadoIntegracoes(true);
          r = { ok: true, id, teste: { ...t, ms: Date.now() - t0 } };
          break;
        }
        case '/crm/api/integracoes/dispensar': r = integ.dispensar(String(d.id || '')); await estadoIntegracoes(true); break;
        case '/crm/api/precos/adicional': r = planos.salvarAdicional(String(d.code || ''), d); break;
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
          const assumiu = bot.assumirConversa(tel, { por: quemAtende(quem) });
          assumiuVira(quem, tel);
          /* Respondeu direto, sem clicar em "assumir": a saudação vai antes da 1ª resposta. */
          if (assumiu.ok && assumiu.primeiraPessoa) { await saudarAoAssumir(quem, tel, d.canal); }
          // Contato por LID so recebe pelo endereco guardado no protocolo.
          const envio = await canais.enviar({ canal: d.canal, para: proto.enderecoDe(tel), texto });
          if (!envio.ok) { r = { ok: false, motivo: envio.erro || 'não consegui enviar' }; break; }
          const lead = crm.listar().find((l) => l.telefone === String(d.telefone || '').replace(/\D/g, ''));
          if (lead) { crm.interagir(lead.id, { canal: canalDe(d.telefone), direcao: 'saida', texto, autor: 'atendente', por: quemAtende(quem) }); }
          /* Mapa mental: se o bot não tinha sabido responder essa pessoa, a
             resposta da equipe fica guardada ao lado da dúvida (vira regra
             quando o dono aprovar). */
          try { mapaMental.respostaDaEquipe({ canal: canalDe(tel), telefone: tel, texto }); } catch (e) { console.error(`[mapa] resposta da equipe: ${e.message}`); }
          r = { ok: true, enviado: true, id: envio.id || null };
          break;
        }
        /* Prospecção: plano, regiões e abordagem são do dono; contato e etapa, de quem prospecta. */
        case '/crm/api/prospeccao/plano': r = prosp.salvarPlano(d, { por: quem.email || null }); break;
        case '/crm/api/prospeccao/regiao': r = prosp.salvarRegiao(d); break;
        /* Ler a caixa AGORA (o botão) — a leitura automática roda a cada 10 min. */
        case '/crm/api/prospeccao/caixa/ler': r = await lerCaixaProsp(); break;
        case '/crm/api/prospeccao/envio-auto': r = prospEnvio.ligarAuto(d.ligado === true, { por: quem.email || null, hora: d.hora });
          seguranca.auditar({ tipo: 'prospeccao:envio-auto', detalhe: d.ligado === true ? 'ligado' : 'desligado', cliente: quem.email || null, resultado: 'salvo' }); break;
        case '/crm/api/prospeccao/campanha-whatsapp': r = campanhaWpp.ligar(d.ligado === true, { por: quem.email || null });
          seguranca.auditar({ tipo: 'prospeccao:campanha-whatsapp', detalhe: d.ligado === true ? 'ligada' : 'desligada', cliente: quem.email || null, resultado: 'salvo' }); break;
        case '/crm/api/prospeccao/envio':
          r = d.confirmar === true ? prospEnvio.iniciar(d.quantos, { por: quem.email || null }) : { ok: false, motivo: 'confirme o envio' };
          if (r.ok) { console.log(`[prospeccao] lote de ${r.total} e-mail(s) iniciado por ${quem.email}`); }
          break;
        case '/crm/api/prospeccao/regiao/remover': r = prosp.removerRegiao(String(d.id || '')); break;
        case '/crm/api/prospeccao/abordagem': r = prosp.trocarAbordagem(String(d.regiaoId || ''), String(d.abordagem || ''), { por: quem.email || null, motivo: d.motivo }); break;
        case '/crm/api/prospeccao/contato': r = prosp.registrarContato(d, { por: quemAtende(quem).nome || quem.email || null }); break;
        case '/crm/api/prospeccao/mover': r = prosp.mover(String(d.id || ''), String(d.etapa || ''), { por: quemAtende(quem).nome || quem.email || null, nota: d.nota, canal: d.canal }); break;
        /* Provador virtual: tela da vitrine, peças com a tabela de medidas e quem pediu atendimento. */
        case '/crm/api/cadevc/config': {
          const anterior = cadevcCfg.config();
          r = cadevcCfg.salvar(d);
          if (r.ok) {
            const atual = cadevcCfg.config();
            const credenciaisMudaram = ['evolutionUrl', 'evolutionKey', 'evolutionInstance', 'cadevcUrl', 'cadevcToken']
              .some((chave) => anterior[chave] !== atual[chave]);
            if (credenciaisMudaram) { cadevcHub.esquecer(empresaAtual() || ''); }
          }
          break;
        }
        case '/crm/api/cadevc/perfil/foto': {
          const ps = provcadevc();
          if (!ps) { r = { ok: false, motivo: 'Configure Evolution: URL, API key e nome da instância do WhatsApp do salão.' }; break; }
          try {
            r = await ps.atualizarFotoPerfil(String(d.foto || ''));
          } catch (e) {
            r = { ok: false, motivo: e.message };
          }
          break;
        }
        case '/crm/api/cadevc/conectar': {
          const ps = provcadevc();
          if (!ps) { r = { ok: false, erro: 'Configure Evolution: URL, API key e nome da instância do WhatsApp do salão.' }; break; }
          r = await ps.conectar();
          if (r.ok) {
            const hook = await garantirWebhookCadevc(cadevcCfg.config(), { forcar: true });
            if (!hook.ok) { r.webhookErro = hook.erro; }
          }
          break;
        }
        case '/crm/api/cadevc/webhook': {
          const cfg = cadevcCfg.config();
          const hook = await garantirWebhookCadevc(cfg, { forcar: true });
          r = hook.ok ? { ok: true } : { ok: false, erro: hook.erro };
          break;
        }
        case '/crm/api/canais/evolution/aprendizado/validar': r = canaisEvo.validarAprendizado({ id: String(d.id || ''), resposta: d.resposta, por: quem.email || null }); break;
        case '/crm/api/canais/evolution/aprendizado/recusar': r = canaisEvo.recusarAprendizado({ id: String(d.id || ''), por: quem.email || null }); break;
        case '/crm/api/canais/evolution/cadastrar': r = canaisEvo.cadastrar({ rotulo: d.rotulo, numeroPrevisto: d.numeroPrevisto, agenteId: String(d.agenteId || ''), modulo: d.modulo === 'salao' ? 'salao' : 'canais', nicho: String(d.nicho || '') }); break;
        case '/crm/api/canais/evolution/vincular': r = canaisEvo.vincularIA({ id: String(d.id || ''), agenteId: String(d.agenteId || ''), nicho: String(d.nicho || '') }); break;
        case '/crm/api/canais/evolution/conectar': r = await canaisEvo.conectar({ id: String(d.id || '') }); break;
        case '/crm/api/canais/evolution/estado': r = await canaisEvo.estado({ id: String(d.id || '') }); break;
        case '/crm/api/canais/evolution/desconectar': r = await canaisEvo.desconectar({ id: String(d.id || '') }); break;
        case '/crm/api/canais/evolution/apagar-sessao': r = await canaisEvo.apagarSessao({ id: String(d.id || '') }); break;
        case '/crm/api/canais/evolution/remover': r = await canaisEvo.remover({ id: String(d.id || '') }); break;
        case '/crm/api/canais/evolution/identidade': r = await canaisEvo.sincronizarIdentidade({ id: String(d.id || '') }); break;
        case '/crm/api/canais/evolution/conversas': r = { ok: true, conversas: canaisEvo.conversas({ id: String(d.id || '') }) }; break;
        case '/crm/api/cadevc/desconectar': { const ps = provcadevc(); if (ps) { await ps.desconectar(); } r = { ok: true }; break; }
        case '/crm/api/provador/config': r = provador.configurar(d, { por: quem.email || null }); break;
        case '/crm/api/provador/peca': r = provador.salvarPeca(d, { por: quem.email || null }); break;
        case '/crm/api/provador/peca/remover': r = provador.removerPeca(String(d.id || '')); break;
        case '/crm/api/provador/prova': r = d.apagar === true ? provador.apagarProva(String(d.id || '')) : provador.marcarProva(String(d.id || ''), String(d.situacao || '')); break;
        /* Ligar/desligar o orçamento do negócio: só o dono (vendedor não chega aqui). */
        case '/crm/api/orcamentos/config': r = orc.configurar({ ligado: d.ligado === true }, { por: quem.email || null }); break;
        /* Orçamento: o vendedor mexe no que é dele; o dono, em todos. */
        case '/crm/api/orcamentos/salvar': {
          const tel = String(d.cliente?.telefone || '').replace(/\D/g, '');
          const pode = vendedorPode(quem, tel);
          if (!pode.ok) { r = pode; break; }
          const antes = d.id ? orc.obter(String(d.id)) : null;
          if (antes && quem.papel === 'vendedor' && antes.vendedor?.email !== quem.email) { r = { ok: false, motivo: 'este orçamento é de outro vendedor' }; break; }
          const qa = quemAtende(quem);
          r = orc.salvar({
            ...d, vendedor: antes?.vendedor || { nome: qa.nome, email: quem.email || null },
            cliente: { ...(d.cliente || {}), canal: canalDe(tel) }
          }, { por: quem.email || null, catalogo: await catalogoOrc() });
          break;
        }
        case '/crm/api/orcamentos/enviar':
        case '/crm/api/orcamentos/cancelar':
        case '/crm/api/orcamentos/duplicar':
        case '/crm/api/orcamentos/cobrar': {
          const o = orc.obter(String(d.id || ''));
          if (!o) { r = { ok: false, motivo: 'orçamento não encontrado' }; break; }
          if (quem.papel === 'vendedor' && o.vendedor?.email !== quem.email) { r = { ok: false, motivo: 'este orçamento é de outro vendedor' }; break; }
          const acao = rota.split('/').pop();
          r = acao === 'enviar' ? await orcSrv.enviar(o.id, { por: quem.email || null })
            : acao === 'cobrar' ? await orcSrv.cobrar(o.id, { por: quem.email || null })
              : acao === 'cancelar' ? orc.cancelar(o.id, { por: quem.email || null })
                : orc.duplicar(o.id, { por: quem.email || null, catalogo: await catalogoOrc() });
          break;
        }
        case '/crm/api/campanhas/salvar': r = campanhasTg.salvar(d, { canal: 'telegram' }); break;
        /* Canal parceiro: link próprio (codigo__parceiro) pro dono de outro canal postar. */
        /* Mandar um DOCUMENTO (PDF) pelo WhatsApp da loja — ex.: a proposta pros
           atendentes (dono, 29/09). Só dono/admin (vendedor é barrado na porta),
           só PDF, até 5 MB, e fica na auditoria de segurança. */
        case '/crm/api/venda/importar': r = venda.importar({ html: d.html || null, origem: d.nome || null }); break;
        case '/crm/api/venda/montar': r = { ...venda.montar(Array.isArray(d.escolhidos) ? d.escolhidos : []), ok: true }; break;
        /* Finalizar = TUDO de uma vez (dono, 29/09: "a tela tem que ser simples"):
           cadastra o cliente, gera o contrato e a cobrança do Mercado Pago, e
           devolve o LINK de pagamento pra copiar ou mandar no WhatsApp. */
        case '/crm/api/venda/finalizar': {
          const f = venda.finalizar({ cliente: d.cliente || {}, escolhidos: Array.isArray(d.escolhidos) ? d.escolhidos : [] });
          if (!f.ok) { r = f; break; }
          const id = f.cliente.id;
          const k = await clientes.gerarContrato(id, { imprimir: clientesSrv.imprimirPdf });
          if (!k.ok) { r = { ok: false, motivo: `venda salva, mas o contrato não saiu: ${k.motivo || k.erro}`, cliente: f.cliente }; break; }
          let cob = await clientes.cobrar(id, { cobrar: pagar.cobrar, enviar: null, webhookUrl: webhookPagamento(), exigirAssinatura: false });
          /* Cliente que já tinha cobrança aberta: cancela a antiga (o valor mudou) e gera a nova. */
          if (!cob.ok && cob.cobranca?.estado === 'AGUARDANDO') { clientes.cancelarCobranca(id); cob = await clientes.cobrar(id, { cobrar: pagar.cobrar, enviar: null, webhookUrl: webhookPagamento(), exigirAssinatura: false }); }
          if (!cob.ok) { r = { ok: false, motivo: `venda e contrato salvos, mas a cobrança não saiu: ${cob.motivo}`, cliente: f.cliente }; break; }
          r = {
            ok: true, cliente: cob.cliente || f.cliente, novo: f.novo, mensalCentavos: f.mensalCentavos, avulsoCentavos: f.avulsoCentavos,
            link: cob.cobranca.link, pix: cob.cobranca.pix, teste: pagar.credenciaisMercadoPago(pagar.getConfig()).ambiente !== 'producao', contrato: k.contrato?.numero || null
          };
          break;
        }
        /* ASSINATURA GRATUITA (cortesia do dono, 30 dias): a mesma venda montada, sem
           link de pagamento — contrato gerado, chave de 30 dias e o acesso entregue. */
        case '/crm/api/venda/cortesia': {
          const f = venda.finalizar({ cliente: d.cliente || {}, escolhidos: Array.isArray(d.escolhidos) ? d.escolhidos : [], atendentes: null });
          if (!f.ok) { r = f; break; }
          const id = f.cliente.id;
          const k = await clientes.gerarContrato(id, { imprimir: clientesSrv.imprimirPdf });
          if (!k.ok) { r = { ok: false, motivo: `cadastro salvo, mas o contrato não saiu: ${k.motivo || k.erro}`, cliente: f.cliente }; break; }
          if ((clientes.obter(id).cobrancas || []).some((x) => x.estado === 'AGUARDANDO')) { clientes.cancelarCobranca(id); }
          const dias = Number(d.dias) || 30;
          const l = await clientes.liberarManual(id, {
            motivo: `Assinatura gratuita — cortesia de ${quem.nome || quem.email || 'dono'} (${dias} dias)`, dias,
            assinar: clientesSrv.assinarLicenca, enviar: clientesSrv.enviarWhatsapp, urlAtivacao: urlAtivacao()
          });
          if (!l.ok) { r = { ok: false, motivo: `cadastro e contrato salvos, mas a chave não saiu: ${l.motivo}`, cliente: f.cliente }; break; }
          const acesso = await entregarAcesso(id).catch((e) => ({ ok: false, motivo: e.message }));
          seguranca.auditar({ tipo: 'cortesia:liberada', detalhe: `${f.cliente.nome} — ${dias} dias, valeria ${f.mensalCentavos} centavos/mês`, cliente: quem.email || null, resultado: 'liberada' });
          r = {
            ok: true, cortesia: true, cliente: l.cliente || f.cliente, mensalCentavos: f.mensalCentavos, validaAte: l.validaAte, codigo: l.codigo,
            chaveEnviada: !!l.envio?.ok, acesso: { ok: acesso?.ok !== false }, contrato: k.contrato?.numero || null
          };
          break;
        }
        case '/crm/api/documento/enviar': {
          const para = String(d.para || '').replace(/\D/g, '');
          const buf = Buffer.from(String(d.base64 || ''), 'base64');
          if (!/^\d{10,13}$/.test(para)) { r = { ok: false, motivo: 'número inválido (DDD + número)' }; break; }
          if (!buf.length || buf.length > 5 * 1024 * 1024 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') { r = { ok: false, motivo: 'mande um PDF de até 5 MB' }; break; }
          const nome = String(d.nome || 'documento.pdf').replace(/[^\w .()-]/g, '').slice(0, 80) || 'documento.pdf';
          const env = await canais.enviarArquivo({
            para: para.length <= 11 ? '55' + para : para, nome, legenda: String(d.legenda || '').slice(0, 900) || null,
            dataUri: `data:application/pdf;base64,${buf.toString('base64')}`
          });
          seguranca.auditar({ tipo: 'documento:enviado', detalhe: `${nome} (${Math.round(buf.length / 1024)} KB) para ${para}`, cliente: quem.email || null, resultado: env?.ok ? 'enviado' : `falhou: ${env?.erro || '?'}` });
          r = env?.ok ? { ok: true, enviado: true } : { ok: false, motivo: env?.erro || 'o WhatsApp não confirmou o envio' };
          break;
        }
        case '/crm/api/campanhas/parceiro': r = campanhasTg.adicionarParceiro(String(d.id || ''), { nome: d.nome, canal: d.canal, valorPago: d.valorPago, comissaoPct: d.comissaoPct }); break;
        case '/crm/api/campanhas/parceiro/comissao': r = campanhasTg.definirComissao(String(d.id || ''), String(d.slug || ''), d.comissaoPct); break;
        case '/crm/api/campanhas/parceiro/pagar': r = campanhasTg.pagarComissao(String(d.id || ''), String(d.slug || ''), { valor: d.valor, por: quem.email || null, obs: d.obs });
          if (r.ok) { seguranca.auditar({ tipo: 'campanha:comissao-paga', detalhe: `${d.slug} R$ ${d.valor}`, cliente: quem.email || null, resultado: 'registrado' }); } break;
        case '/crm/api/campanhas/parceiro/remover': r = campanhasTg.removerParceiro(String(d.id || ''), String(d.slug || '')); break;
        case '/crm/api/campanhas/auditar': r = await campanhasTg.rodarAuditoria(String(d.id || ''), contextoCampanha({ forcar: d.forcar === true })); break;
        case '/crm/api/campanhas/aprovar': r = await campanhasTg.aprovar(String(d.id || ''), { ...contextoCampanha(), por: quem.email || null, aceitarRessalvas: d.aceitarRessalvas === true }); break;
        case '/crm/api/campanhas/encerrar': r = campanhasTg.encerrar(String(d.id || '')); break;
        case '/crm/api/campanhas/reabrir': r = campanhasTg.reabrir(String(d.id || ''), quem.email || null); break;
        case '/crm/api/campanhas/excluir': r = campanhasTg.excluir(String(d.id || '')); break;
        /* Destinos de publicacao (canais/grupos onde o bot foi autorizado). */
        case '/crm/api/campanhas/destino/verificar': {
          const ref = String(d.ref || d.id || '').trim();
          if (!ref) { r = { ok: false, motivo: 'informe o @ do canal/grupo ou o link t.me' }; break; }
          r = campanhasTg.cadastrarDestino(await canais.telegramConsultarChat(ref), { confirmar: d.confirmar === true, por: quem.email || null });
          break;
        }
        case '/crm/api/campanhas/destino/aguardar': r = campanhasTg.aguardarDestino({ por: quem.email || null }); break;
        case '/crm/api/campanhas/destino/confirmar': r = campanhasTg.confirmarDestino(String(d.id || ''), quem.email || null); break;
        case '/crm/api/campanhas/destino/remover': r = campanhasTg.removerDestino(String(d.id || '')); break;
        case '/crm/api/campanhas/politica': r = campanhasTg.salvarPolitica(d); break;
        /* Banda: liberar (adendo pago ou decisão do dono), tirar, pedir. */
        case '/crm/api/consumo/banda': r = planos.adicionarBanda({ gb: d.gb, motivo: d.motivo, por: quem.email || null }); if (r.ok) { consumo.fecharPedidosBanda({ por: quem.email || null }); console.log(`[consumo] +${d.gb} GB de banda liberados por ${quem.email} — ${d.motivo}`); } estadoConsumo(true); break;
        case '/crm/api/consumo/banda/remover': r = planos.removerBanda(String(d.id || ''), { por: quem.email || null }); estadoConsumo(true); break;
        case '/crm/api/consumo/pedir-banda': r = consumo.pedirBanda({ gb: d.gb, por: quem.email || null, observacao: d.observacao }); if (r.ok && !r.repetido) { console.log(`[consumo] pedido de banda adicional de ${quem.email}`); } break;
        /* Publicar agora ou agendar. "Agora" entra na fila e o agendador manda
           na mesma hora — e o mesmo caminho, com as mesmas regras. */
        case '/crm/api/campanhas/publicar': {
          r = await campanhasTg.agendarPublicacao(String(d.id || ''), { destinos: Array.isArray(d.destinos) ? d.destinos : [], quando: d.quando || null, por: quem.email || null, ctx: contextoCampanha() });
          if (r.ok && !d.quando) {
            // Duas voltas: se o relogio ja estava rodando, a 1a e a dele (anterior a este pedido).
            await agendadorCampanhas(); await agendadorCampanhas();
            r = { ...r, campanha: campanhasTg.obter(String(d.id)) };
          }
          break;
        }
        case '/crm/api/campanhas/publicacao/cancelar': r = campanhasTg.cancelarPublicacao(String(d.id || ''), String(d.pubId || '')); break;
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
          if (lead) { crm.interagir(lead.id, { canal: p.canal, direcao: 'saida', texto, autor: 'atendente', por: quemAtende(quem) }); }
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
          if (r.ok && r.primeiraPessoa) { r.saudou = await saudarAoAssumir(quem, tel, d.canal); }
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
          const cat = (await estoque.doAtendimento()).map((p) => ({ sku: p.sku, nome: p.nome }));
          for (const m of msgs) { ficha = qualif.qualificar(ficha, m, { produtos: cat }); }
          const ativosOps = operadores.ativos(operadores.listar());
          const dec = qualif.decidir(ficha, { texto: msgs.join(' '), equipesComGente: [...new Set(ativosOps.map((o) => qualif.normEquipe(o.setor)))], tiersComGente: qualif.tiersComGente(ativosOps), matriz: Array.isArray(d.matriz) ? d.matriz : undefined });
          if (dec.tier === 1 && qualif.precisaPerguntar(ficha)) { dec.pergunta = qualif.config().perguntar.texto; }
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
        /* FINALIZAR (desfecho normal): manda "posso ajudar em algo mais?". A
           resposta "nao" do cliente e que finaliza e pede a nota (ver
           backend/atendimento.mjs); outra resposta, a conversa segue. */
        case '/crm/api/atendimentos/finalizar': {
          const tel = String(d.telefone || '').replace(/\D/g, '');
          const ctx = contextoFechamento(quem, tel);
          if (!ctx.ok) { r = ctx; break; }
          proto.pedirFinalizacao(ctx.p.numero, quemAtende(quem));
          const texto = proto.textoPerguntaFinal();
          const env = await canais.enviar({ para: ctx.p.endereco || proto.enderecoDe(tel), texto }).catch((e) => ({ ok: false, erro: e.message }));
          if (env?.ok && ctx.lead) { crm.interagir(ctx.lead.id, { canal: canalDe(tel), direcao: 'saida', texto, autor: 'atendente', por: quemAtende(quem) }); }
          if (!env?.ok) { proto.continuarAtendimento(ctx.p.numero); }
          r = env?.ok ? { ok: true, protocolo: ctx.p.numero, perguntado: true }
            : { ok: false, motivo: `a pergunta não chegou ao cliente: ${env?.erro || 'motivo não informado'}` };
          break;
        }
        /* ENCERRAR (a forca): conversa pesada, cliente sumiu, engano… Exige
           MOTIVO (e o que a auditoria le) e NAO pede nota: nao foi concluido. */
        case '/crm/api/atendimentos/encerrar': {
          const tel = String(d.telefone || '').replace(/\D/g, '');
          const motivoTexto = String(d.motivo || '').trim();
          if (motivoTexto.length < 3) { r = { ok: false, motivo: 'diga o motivo do encerramento — é o que fica no histórico para auditoria' }; break; }
          const ctx = contextoFechamento(quem, tel);
          if (!ctx.ok) { r = ctx; break; }
          const fechado = proto.encerrarPorNumero(ctx.p.numero, {
            motivo: 'encerrado pelo atendente', desfecho: 'encerrado', motivoTexto,
            por: { tipo: 'atendente', ...quemAtende(quem) }, atendidoPor: ctx.p.atendidoPor || ctx.fila?.assumidaPor || null
          });
          bot.devolverAoBot(tel);
          let avisado = false; let erroAviso = null;
          if (d.avisar !== false) {
            const texto = proto.textoDeEncerramento(fechado);
            const env = await canais.enviar({ para: fechado.endereco || proto.enderecoDe(tel), texto }).catch((e) => ({ ok: false, erro: e.message }));
            if (env?.ok && ctx.lead) { crm.interagir(ctx.lead.id, { canal: canalDe(tel), direcao: 'saida', texto, autor: 'atendente', por: quemAtende(quem) }); }
            avisado = env?.ok === true; erroAviso = avisado ? null : (env?.erro || 'motivo não informado');
          }
          r = { ok: true, protocolo: fechado.numero, avisado, erroAviso };
          break;
        }
        case '/crm/api/bot/config': r = bot.comCanal(d.canal, () => bot.salvarConfig(d)); break;
        /* O atendente profissional pronto: o cliente escolhe nome, profissão e
           jeito; os textos saem de engine/vsbot/profissoes. Sem `aplicar` só
           mostra como fica (não mexe no atendimento no ar); com `aplicar` grava
           no bot do canal. O fluxo (árvore de opções) não é tocado. */
        case '/crm/api/bot/profissional': {
          const m = profissoes.montar({ nome: d.nome, profissao: d.profissao, jeito: d.jeito, loja: process.env.VITRINE_NOME });
          if (!m.ok) { r = m; break; }
          r = d.aplicar === true
            ? { ...bot.comCanal(d.canal, () => bot.salvarConfig(m.config)), config: m.config }
            : { ok: true, previa: true, config: m.config };
          break;
        }
        case '/crm/api/seguranca/config': {
          /* Seguranca (socorro, moderacao) vale para OS DOIS bots: quem pede
             socorro no Telegram merece a mesma resposta que no WhatsApp. */
          const antes = bot.getConfig();
          r = bot.salvarConfig({
            emergencia: { ...(antes.emergencia || {}), ...(d.emergencia || {}) },
            moderacao: { ...(antes.moderacao || {}), ...(d.moderacao || {}) },
          });
          if (r?.ok !== false) {
            bot.comCanal('telegram', () => { const a2 = bot.getConfig(); return bot.salvarConfig({ emergencia: { ...(a2.emergencia || {}), ...(d.emergencia || {}) }, moderacao: { ...(a2.moderacao || {}), ...(d.moderacao || {}) } }); });
          }
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
        case '/crm/api/bot/regra': r = bot.comCanal(d.canal, () => bot.salvarRegra(d)); break;
        case '/crm/api/bot/regra-excluir': r = bot.comCanal(d.canal, () => bot.excluirRegra(d.id)); break;
        case '/crm/api/bot/fluxo-csv': r = bot.comCanal(d.canal, () => bot.importarFluxoCsv(String(d.csv || ''))); break;
        case '/crm/api/bot/fluxo-apagar': r = bot.comCanal(d.canal, () => bot.apagarFluxo()); break;
        /* Volta uma cópia guardada do fluxo (antes de bot pronto, planilha ou apagar). */
        case '/crm/api/bot/fluxo-voltar': {
          r = bot.comCanal(d.canal, () => bot.voltarCopiaFluxo(d.id));
          if (r.ok) { seguranca.auditar({ tipo: 'bot:fluxo-voltar', detalhe: `cópia ${d.id} no ${d.canal === 'telegram' ? 'Telegram' : 'WhatsApp'} (${r.passos} passos)`, cliente: quem.email || null, resultado: 'aplicado' }); }
          break;
        }
        case '/crm/api/lojas/multi': r = lojas.ligarMultiLoja(d.ligado === true); break;
        case '/crm/api/lojas/criar': r = lojas.criar(d); if (r.ok) { seguranca.auditar({ tipo: 'loja:criada', detalhe: `${r.loja.nome} (${r.loja.id})`, cliente: quem.email || null, resultado: 'criada' }); } break;
        case '/crm/api/lojas/renomear': r = lojas.renomear(String(d.id || ''), d); break;
        case '/crm/api/lojas/arquivar': r = lojas.arquivar(String(d.id || '')); if (r.ok) { seguranca.auditar({ tipo: 'loja:arquivada', detalhe: String(d.id), cliente: quem.email || null, resultado: 'arquivada' }); } break;
        case '/crm/api/drive/config': r = drive.salvarConfig(d); if (r.ok) { r = { ok: true, painel: drive.painel() }; seguranca.auditar({ tipo: 'drive:config', detalhe: `ligado=${r.painel.config.ligado}${d.desvincular ? ' (motorista desvinculado)' : ''}`, cliente: quem.email || null, resultado: 'salvo' }); } break;
        case '/crm/api/drivin/config': r = drivin.salvarConfig(d); if (r.ok) { seguranca.auditar({ tipo: 'drivin:config', detalhe: `ligado=${r.config.ligado} esquema=${r.config.schemaCode || '-'}${d.apiKey ? ' (chave trocada)' : ''}`, cliente: quem.email || null, resultado: 'salvo' }); sincronizarDrivin(); } break;
        case '/crm/api/drivin/testar': r = await drivin.testar(); break;
        case '/crm/api/drivin/enviar': {
          const p = resultados.obterPedido(String(d.referencia || ''));
          r = p ? await drivin.enviar(p) : { ok: false, motivo: 'pedido não encontrado' };
          break;
        }
        /* Bot pronto por nicho: troca o fluxo do canal pelo modelo, com o nome da loja na saudação. */
        case '/crm/api/bot/modelo': {
          const empresa = String(d.empresa || '').trim().slice(0, 60) || bot.comCanal(d.canal, () => bot.painel().config.nomeEmpresa) || process.env.VITRINE_NOME || null;
          const passos = botModelos.passosDe(String(d.id || ''), { empresa });
          r = passos ? bot.comCanal(d.canal, () => { const copia = bot.guardarCopiaFluxo(`antes do bot pronto ${d.id}`); return { ...bot.salvarFluxo(passos), copia }; }) : { ok: false, motivo: 'modelo não encontrado' };
          if (r.ok) { seguranca.auditar({ tipo: 'bot:modelo', detalhe: `${d.id} no ${d.canal === 'telegram' ? 'Telegram' : 'WhatsApp'}${empresa ? ` (${empresa})` : ''}`, cliente: quem.email || null, resultado: 'aplicado' }); }
          break;
        }
        case '/crm/api/bot/midia-apagar': r = bot.apagarMidia(d.nome); break;
        /* Fábrica de Modelos e Hotel dos Bots (missão 0007): criação, derivação,
           homologação e instância. Tudo passa pela máquina de estados do mapa
           mental e pela autorização do criador — nada comercial sem aprovação. */
        case '/crm/api/hotel/pesquisar-nicho':
          r = d.especialidadeId || d.especialidade
            ? hotel.prepararEspecialidade(d)
            : hotel.pesquisarNicho({ nicho: d.nicho });
          break;
        case '/crm/api/hotel/preparar-nicho': r = hotel.prepararNicho({ nicho: d.nicho }); break;
        /* Missão 007 — o fluxo automático: nicho + identificação da empresa +
           aceite. O 0007 faz pesquisa, testes e homologação sozinho quando o
           risco é baixo; em risco alto, deixa em validação para uma pessoa. */
        case '/crm/api/hotel/criar-automatico': {
          /* IA de um dos 7 nichos do salão só nasce com o Cadê Você confirmado. */
          const ehSalao = salaoIas.exigeDadosSalao(d.nicho);
          const sistema = ehSalao ? await salaoIas.validarDadosSistema({ url: d.cadevcUrl, token: d.cadevcToken }) : null;
          if (sistema?.erro) { r = sistema; break; }
          r = await hotel.criarIAZestAutomatica({
            nicho: d.nicho,
            empresaTipo: d.empresaTipo,
            empresaIdentificador: d.empresaIdentificador,
            empresaSite: typeof d.empresaSite === 'string' ? d.empresaSite : '',
            aceite: d.aceite === true,
            autorizado: d.autorizado === true,
          });
          if (ehSalao && r.bot?.agenteId) { salaoIas.salvarDadosSistema(r.bot.agenteId, { url: d.cadevcUrl, token: d.cadevcToken, salao: sistema.salao }); }
          break;
        }
        case '/crm/api/hotel/excluir': {
          const agenteExcluir = String(d.agenteId || '');
          if (cadevcCfg.config().bot0007Id && cadevcCfg.config().bot0007Id === agenteExcluir) {
            r = { erro: 'esta IA-ZEST está conectada ao Salão; desconecte antes de excluir' };
            break;
          }
          r = hotel.excluirBot({
            agenteId: agenteExcluir,
            autorizado: d.autorizado === true,
          });
          if (r.ok) { salaoIas.apagarDadosSistema(agenteExcluir); }
          break;
        }
        case '/crm/api/hotel/novo-bot': {
          if (d.aprovacaoCriador !== true) {
            r = { erro: 'a proposta do 0007 precisa ser aprovada pelo criador' };
            break;
          }
          if (salaoIas.exigeDadosSalao([d.nome, d.especialidade, d.finalidade].join(' '))) {
            r = { erro: 'IA de salão é criada pela criação automática, informando os dados do Cadê Você' };
            break;
          }
          const personalizado = d.personalizado === true;
          if (personalizado && !d.empresaCnpj) {
            r = { erro: 'informe o CNPJ da empresa para pesquisar e preparar o bot personalizado' };
            break;
          }
          if (!personalizado && d.empresaCnpj) {
            r = { erro: 'marque a preparação personalizada para informar o CNPJ da empresa' };
            break;
          }
          const base = hotel.prepararEspecialidade({
            especialidadeId: d.especialidadeId,
            especialidade: d.especialidade,
            profissao: d.profissao,
            finalidade: d.finalidade,
          });
          if (base.erro) { r = base; break; }
          const preparacao = hotel.revisarPreparacao(base, d.revisao || {});
          if (preparacao.erro) { r = preparacao; break; }
          const criado = hotel.criarBotComercial({
            nome: d.nome,
            finalidade: d.finalidade,
            especialidade: preparacao.especialidade,
            profissao: preparacao.profissao.id,
            empresaCnpj: personalizado ? d.empresaCnpj : '',
            autorizado: d.autorizado === true,
            atividades: preparacao.atividades,
            ferramentas: preparacao.ferramentas.map((item) => item.nome || String(item)),
            falhas: preparacao.falhas,
            lacunas: preparacao.lacunas,
            conhecimentos: preparacao.conhecimentos,
            preparacao,
            perfil: d.perfil,
          });
          if (criado.erro) { r = criado; break; }
          const pesquisa = await hotel.pesquisarERegistrarPreparacaoInicial({
            agenteId: criado.bot.agenteId,
            autorizado: d.autorizado === true,
            empresaCnpj: personalizado ? d.empresaCnpj : '',
          });
          r = {
            ...criado,
            bot: pesquisa.ok ? pesquisa.bot : hotel.obterBot(criado.bot.agenteId),
            pesquisa: pesquisa.erro
              ? { erro: pesquisa.erro, mensagem: pesquisa.mensagem, falhas: pesquisa.falhas || [] }
              : {
                ok: true,
                fontes: pesquisa.bot.preparacao.pesquisaInicial.fontes,
                conhecimentos: pesquisa.bot.preparacao.pesquisaInicial.conhecimentos,
              },
          };
          break;
        }
        case '/crm/api/hotel/editar-perfil':
          r = hotel.atualizarPerfilBot({
            agenteId: String(d.agenteId || ''),
            nome: d.nome,
            perfil: d.perfil,
            autorizado: d.autorizado === true,
          });
          break;
        case '/crm/api/hotel/pesquisa-inicial':
          r = await hotel.pesquisarERegistrarPreparacaoInicial({
            agenteId: String(d.agenteId || ''),
            autorizado: d.autorizado === true,
          });
          break;
        case '/crm/api/hotel/validar':
          r = hotel.validarBot({
            agenteId: String(d.agenteId || ''),
            autorizado: d.autorizado === true,
            confirmado: d.confirmado === true,
            lacunasConfirmadas: Array.isArray(d.lacunasConfirmadas) ? d.lacunasConfirmadas : [],
          });
          break;
        case '/crm/api/hotel/derivar': {
          const derivacao = hotel.registrarModeloDerivado(d);
          if (derivacao.erro) { r = derivacao; break; }
          const pesquisa = await hotel.pesquisarERegistrarPreparacaoInicial({
            agenteId: derivacao.modelo.agenteId,
            autorizado: d.autorizado === true,
          });
          r = {
            ...derivacao,
            modelo: hotel.obterBot(derivacao.modelo.agenteId),
            pesquisa: pesquisa.erro
              ? { erro: pesquisa.erro, mensagem: pesquisa.mensagem, falhas: pesquisa.falhas || [] }
              : { ok: true, relatorio: pesquisa.relatorio },
          };
          break;
        }
        case '/crm/api/hotel/homologar': r = hotel.homologarBot(d); break;
        /* Força agora a rodada do prazo de 12h (a mesma do relógio). */
        case '/crm/api/hotel/processar-prazos':
          r = d.autorizado === true
            ? { ok: true, ...(await hotel.processarPrazosHomologacao({ forcar: true })) }
            : { erro: 'processar os prazos exige autorização do criador' };
          break;
        case '/crm/api/hotel/salao': {
          if (d.autorizado !== true) { r = { erro: 'a alteração do atendimento do Salão exige autorização do criador' }; break; }
          const atual = cadevcCfg.config();
          if (d.desconectar === true) {
            r = cadevcCfg.salvar({ bot0007Id: '' });
            if (r.ok) {
              cadevcHub.esquecer(empresaAtual() || '');
              r = { ...r, conectado: false, bot0007Id: null };
            }
            break;
          }
          const agenteId = String(d.agenteId || '').trim();
          const perfil = hotel.obterBot(agenteId);
          if (!perfil) { r = { erro: 'bot do 0007 não encontrado' }; break; }
          const avaliacaoSalao = salaoIas.avaliarParaUso(perfil);
          if (!avaliacaoSalao.ok) { r = { erro: `esta IA não pode atender o Salão: ${avaliacaoSalao.motivo}` }; break; }
          if (perfil.preparacao?.pesquisaInicial?.estado !== 'concluida') {
            r = { erro: 'registre a preparação inicial antes de conectar o perfil ao Salão' };
            break;
          }
          if (perfil.estado !== 'homologado' || perfil.validacao?.validado !== true || (perfil.falhas || []).length || (perfil.lacunas || []).length) {
            r = { erro: 'homologue o perfil do 0007 e resolva as pendências antes de conectá-lo ao Salão' };
            break;
          }
          if (!atual.evolutionKey || !atual.evolutionInstance) {
            r = { erro: 'configure a conexão do WhatsApp e a agenda Cadê Você antes de ativar o perfil' };
            break;
          }
          if (atual.bot0007Id && atual.bot0007Id !== agenteId) {
            r = { erro: 'já existe outro perfil do 0007 conectado; desconecte-o antes de trocar' };
            break;
          }
          /* A agenda do salão passa a ser a dos dados informados na criação da IA. */
          const dadosIa = salaoIas.dadosSistema(agenteId);
          r = cadevcCfg.salvar({ bot0007Id: agenteId, cadevcUrl: dadosIa.url, cadevcToken: dadosIa.token });
          if (r.ok) {
            cadevcHub.esquecer(empresaAtual() || '');
            r = { ...r, conectado: true, bot0007Id: agenteId };
          }
          break;
        }
        case '/crm/api/hotel/instanciar': r = hotel.criarInstancia(d); break;
        case '/crm/api/hotel/ativar': r = hotel.ativarInstancia(d); break;
        /* Simulador: o catalogo real entra como contexto, entao o teste mostra o
           que o cliente veria de verdade — nao um exemplo inventado. */
        case '/crm/api/bot/simular': {
          const listaProdutos = await estoque.doAtendimento();
          const sim = bot.comCanal(d.canal, () => bot.simular(d.mensagens || [], {
            nome: d.nome || 'Cliente',
            empresa: process.env.VITRINE_NOME || 'nossa loja',
            produtos: listaProdutos,
          }));
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
        /* Caixa da LOJA (abertura/fechamento, uma gaveta que soma os canais),
           separado do livro-caixa acima. O fechamento grava o retrato das
           vendas de todos os canais desde a abertura. */
        case '/crm/api/caixa-loja/abrir': r = caixaLoja.abrir({ troco: d.troco, quem: quem.email }); break;
        case '/crm/api/caixa-loja/movimento': r = caixaLoja.movimentar({ tipo: d.tipo, valor: d.valor, motivo: d.motivo, quem: quem.email }); break;
        case '/crm/api/caixa-loja/fechar': {
          const cx = caixaLoja.estado();
          const vendas = cx.aberto ? resultados.vendasEntre({ de: cx.aberto.abertoEm, ate: new Date(Date.now() + 60000), pagamentos: pagar.listar() }) : null;
          r = caixaLoja.fechar({ contado: d.contado, maquininha: d.maquininha, obs: d.obs, quem: quem.email, vendas });
          break;
        }
        case '/crm/api/mapa/empresa': r = mapaMental.salvarEmpresa(d); break;
        case '/crm/api/mapa/concorrente': r = mapaMental.salvarConcorrente(d); break;
        case '/crm/api/mapa/concorrente/remover': r = mapaMental.removerConcorrente(String(d.id || '')); break;
        /* Estudar/pesquisar AGORA (o botão), sem esperar o encerramento. Uma
           pesquisa por vez: a do agendador e a do botão não se atropelam. */
        case '/crm/api/mapa/pesquisar': {
          const tipo = ['diaria', 'semanal', 'bimestral'].includes(d.tipo) ? d.tipo : 'diaria';
          r = await rodarPesquisaMapa(tipo);
          break;
        }
        case '/crm/api/mapa/estudar-empresa': r = await mapaMental.estudarEmpresa(); break;
        /* Dúvida que o bot não soube → regra do bot DAQUELE canal, com a resposta aprovada. */
        case '/crm/api/mapa/duvida/regra': {
          const canalD = d.canal === 'telegram' ? 'telegram' : 'whatsapp';
          const p = mapaMental.propostaDeRegra(canalD, String(d.chave || ''), d.resposta);
          if (!p.ok) { r = { ok: false, motivo: p.erro }; break; }
          const sr = bot.comCanal(canalD, () => bot.salvarRegra(p.regra));
          if (!sr.ok) { r = { ok: false, motivo: (sr.erros || []).join('; ') }; break; }
          mapaMental.marcarDuvida(canalD, String(d.chave), { virouRegra: sr.regra.id, respostaEquipe: p.regra.resposta });
          r = { ok: true, regra: sr.regra };
          break;
        }
        case '/crm/api/mapa/duvida/esquecer': r = mapaMental.marcarDuvida(d.canal === 'telegram' ? 'telegram' : 'whatsapp', String(d.chave || ''), { esquecer: true }); break;
        case '/crm/api/caixa/editar': r = fin.editar(d.id, d.mudancas || {}); break;
        case '/crm/api/caixa/excluir': r = fin.excluir(d.id, { motivo: d.motivo }); break;
        case '/crm/api/caixa/restaurar': r = fin.restaurar(d.id); break;
        case '/crm/api/estoque/produto': r = await estoque.criar(d, { limiteProdutos: limitesAtuais().produtos }); break;
        case '/crm/api/estoque/editar': r = await estoque.editar(d.sku, d.mudancas || {}); break;
        case '/crm/api/estoque/movimentar': r = await estoque.movimentar(d.sku, d); break;
        case '/crm/api/estoque/excluir': r = await estoque.excluir(d.sku); break;
        case '/crm/api/estoque/restaurar': r = await estoque.restaurar(d.sku); break;
        case '/crm/api/estoque/esquecer-canal': r = await estoque.esquecerCanal(d.sku, d.canal); break;
        /* Comprar = entrada de mercadoria. Fica separado de `movimentar` porque
           carrega custo e fornecedor, que vao pro historico. */
        case '/crm/api/estoque/comprar': {
          r = await estoque.movimentar(d.sku, {
            tipo: 'entrada',
            quantidade: Number(d.quantidade),
            motivo: d.fornecedor ? `compra — ${d.fornecedor}` : 'compra',
            ref: d.nota || null,
          });
          break;
        }
        case '/crm/api/estoque/reservar': r = await estoque.reservar(d.sku, Number(d.quantidade), { chave: d.chave, canal: d.canal }); break;
        case '/crm/api/estoque/confirmar': r = await estoque.confirmarReserva(d.chave); break;
        case '/crm/api/estoque/cancelar-reserva': r = await estoque.cancelarReserva(d.chave); break;
        case '/crm/api/estoque/vitrine': r = await estoque.vitrine(d.sku, d.expor !== false); break;
        /* "Vender" = mandar pro TikTok Shop. Enquanto a loja nao esta ligada, a
           resposta diz O QUE falta em vez de um erro seco — o produto ja fica
           marcado pra vitrine, que e o canal que funciona sem aprovacao. */
        /* VENDER, na ordem que a especificacao manda: valida -> RESERVA idempotente
           -> encaminha pro canal. A baixa do saldo NAO acontece aqui; ela espera a
           confirmacao do canal (POST /crm/api/estoque/confirmar). */
        case '/crm/api/estoque/vender': {
          const p = await estoque.obter(d.sku);
          if (!p) { r = { ok: false, motivo: `produto "${d.sku}" nao encontrado` }; break; }
          const qtd = Number(d.quantidade) || 1;
          // Chave estavel: o mesmo clique repetido nao reserva de novo.
          const chave = String(d.chave || `${d.sku}:${d.canal || 'tiktok'}:${qtd}:${new Date().toISOString().slice(0, 13)}`);
          const res = await estoque.reservar(d.sku, qtd, { chave, canal: d.canal || 'tiktok' });
          if (!res.ok) { r = { ok: false, motivo: res.erro || res.motivo }; break; }

          const shop = tk.diagnostico().familias.shop;
          if (!shop.autorizado) {
            await estoque.vitrine(d.sku, true);
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
        case '/crm/api/estoque/lote': r = await estoque.criarLote(d); break;
        case '/crm/api/estoque/lote-excluir': r = await estoque.excluirLote(d.id); break;
        case '/crm/api/funil': r = crm.setFunil(d.etapas); break;
        case '/crm/api/funil/automacao': r = crm.setAutomacao(d); break;
        case '/crm/api/leads': r = crm.criar(d); break;
        case '/crm/api/mover': r = crm.mover(d.id, d.etapa); break;
        case '/crm/api/fechar': r = crm.encerrar(d.id, d.status, d.motivo); break;
        case '/crm/api/indicacao': r = crm.setRegraIndicacao(d); break;
        case '/crm/api/parceiros': r = crm.criarParceiro(d); break;
        case '/crm/api/parceiros/remover': r = crm.removerParceiro(d.id); break;
        /* 07/10: indicação (parceiro × avulso). Contrato indicado = quem trouxe + 1º pagamento. */
        case '/crm/api/parceiros/editar': r = crm.editarParceiro(String(d.id || ''), { margemPct: d.margemPct, peloNossoPreco: d.peloNossoPreco, comprovacao: d.comprovacao, recorrente: d.recorrente, justificativaRecorrente: d.justificativaRecorrente, clientes: d.clientes, por: quem.email || null }); break;
        case '/crm/api/indicacao/contrato': r = crm.registrarContratoIndicado({ ...d, por: quem.email || null }); break;
        case '/crm/api/indicacao/contrato/pago': r = crm.marcarComissaoPaga(String(d.id || ''), d.pago !== false, { por: quem.email || null }); break;
        case '/crm/api/indicacao/contrato/remover': r = crm.removerContratoIndicado(String(d.id || '')); break;
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
/* MULTI-LOJA: cada pedido do painel roda com os dados da loja escolhida no
   seletor (cabeçalho x-loja). Loja que não existe/arquivada = principal. "todas"
   roda na principal e marca o pedido — as rotas do controle unificado leem isso.
   Webhooks e canais não mandam x-loja: ficam na principal (pagamento acha a loja
   dele pelo próprio registro). */
{
  const tratar = server.listeners('request')[0];
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    /* 18/10 (multi-empresa): a sessão diz de que empresa é quem chegou — login de
       empresa cliente (e os atendentes dela) só abre os dados dela. O dono da
       plataforma pode entrar numa empresa pra dar suporte (cabeçalho x-empresa). */
    const sess = req.headers['x-crm-token'] ? usuarios.autenticar(req.headers['x-crm-token']) : null;
    let emp = sess?.empresa || null;
    if (!emp && sess?.papel === 'admin') { const pe = String(req.headers['x-empresa'] || '').replace(/\D/g, ''); if (pe && empresas.existe(pe)) { emp = pe; } }
    return comEmpresa(emp, () => {
      const pedida = String(req.headers['x-loja'] || '').trim();
      req.todasLojas = pedida === 'todas';
      const loja = pedida && pedida !== 'todas' && lojas.existe(pedida) ? pedida : PRINCIPAL;
      return comLoja(loja, () => tratar(req, res));
    });
  });
}

/* 18/10 (multi-empresa): numa empresa cliente, o "canal" das telas é o número DELA, não o da plataforma. */
function estadoDoCanal() {
  const est = canais.estado();
  if (!empresaAtual()) { return est; }
  const e = empresas.obter(empresaAtual()) || {};
  const ligado = !!empresas.credenciais();
  return { ...est, canais: [{ nome: 'whatsapp-web', provider: 'whatsapp-cloud', oficial: true, estado: ligado ? 'conectado' : 'desconectado', numero: ligado ? (e.waNumero || null) : null }] };
}

/* 18/10: aviso pro dono que não depende do WhatsApp (é ele que pode estar fora): e-mail. */
const avisosDono = new Map();
async function avisarDono(texto) {
  const k = String(texto).slice(0, 80); const ag = Date.now();
  if (ag - (avisosDono.get(k) || 0) < 3600e3) { return { ok: true, repetido: true }; }
  avisosDono.set(k, ag);
  const para = process.env.ALERTA_EMAIL || usuarios.emailAdmin();
  const r = await email.enviarEmail({ para, assunto: `[ZEST] ${String(texto).slice(0, 70)}`, texto: `${texto}\n\nAviso automático do painel em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.` }).catch((e) => ({ ok: false, erro: e.message }));
  console.log(`[alerta] ${r.ok ? 'e-mail enviado' : 'e-mail NÃO saiu (' + r.erro + ')'} pro dono: ${texto}`);
  return r;
}

server.listen(...(process.env.HOST ? [PORT, process.env.HOST] : [PORT]), () => {
  console.log(`[qa-gate-backend] ouvindo em :${PORT} (webhook /webhook, health /health)`);
  vida.iniciar({ porta: PORT });
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
    /* 18/10: e o mesmo em cada empresa cliente (a varredura lê os dados de quem estiver em uso). */
    empresas.paraCada(() => Promise.all([canais.encerrarParados(), canais.resgatarFila()])).catch((e) => console.error(`[empresas] varredura falhou: ${e.message}`));
    /* Na mesma batida: quem esta esperando gente ha tempo demais. Sao duas
       varreduras porque sao dois problemas — uma fecha conversa parada, a outra
       resgata cliente abandonado na fila. */
    canais.resgatarFila().catch((e) => console.error(`[fila] varredura falhou: ${e.message}`));
    /* 16/10: canal caído (boot sem internet) tenta de novo sozinho a cada minuto. */
    canais.vigiarCanais({ avisar: avisarDono }).catch((e) => console.error(`[canais] vigia falhou: ${e.message}`));
  }, 60000);
  relogio.unref?.();

  /* 18/10: cópia de segurança diária, sozinha, depois das 3h (backend/backup.mjs). */
  const batidaBackup = () => {
    backup.talvezFazer({ avisar: avisarDono }).then((r) => {
      if (r.feito) { console.log(`[backup] cópia de ${r.dia}: ${r.arquivos.join(' + ')} (${(r.bytes / 1048576).toFixed(1)} MB)${r.destino ? ' — enviada pro destino' : ' — só nesta máquina (BACKUP_DESTINO não configurado)'}`); vida.registrar('backup:feito', { dia: r.dia, bytes: r.bytes }); }
      else if (!r.ok) { console.error(`[backup] FALHOU: ${r.erro}`); vida.registrar('backup:falhou', { erro: r.erro }); }
    }).catch((e) => console.error(`[backup] falhou: ${e.message}`));
  };
  /* 2 min depois de subir (máquina que passou a noite desligada faz a de hoje) e a cada 30 min. */
  setTimeout(batidaBackup, 2 * 60000).unref?.();
  setInterval(batidaBackup, 30 * 60000).unref?.();

  /* Prospecção: a cada 10 min lê a caixa de entrada — o SAIR respondido por
     e-mail tem de travar o WhatsApp do dia 5 antes de alguém mandar. */

  /* Envio automático da prospecção: a cada 5 min, se o dono ligou, na hora, o lote do dia sai sozinho. */
  let ultimoMotivoAuto = null;
  const envioAuto = setInterval(() => {
    try {
      const r = prospEnvio.tickAuto();
      if (r.ok) { console.log(`[prospeccao] envio automático: lote de ${r.total} e-mail(s) iniciado`); vida.registrar('prospeccao:lote-iniciado', { total: r.total }); }
      /* 02/10: o lote que NÃO saiu fica na trilha com o motivo (uma vez por dia e motivo). */
      else if (!r.silencioso) { const k = `${new Date().toISOString().slice(0, 10)}|${r.motivo}`; if (k !== ultimoMotivoAuto) { ultimoMotivoAuto = k; console.log(`[prospeccao] envio automático NÃO saiu: ${r.motivo}`); vida.registrar('prospeccao:lote-nao-saiu', { motivo: r.motivo }); } }
    }
    catch (e) { console.error(`[prospeccao] envio automático falhou: ${e.message}`); }
  }, 5 * 60000);
  envioAuto.unref?.();

  /* Campanha no WhatsApp (03/10): a cada 30 s confere alguns números e, na hora, manda UMA. O freio mora no módulo. */
  let ultimoMotivoCampanha = null;
  const campanhaRelogio = setInterval(async () => {
    try {
      const r = await campanhaWpp.tick({ deps: { conectado: canais.whatsappConectado, consultar: canais.consultarWhatsApp, enviar: canais.enviarArquivo, origem: origemPublica() } });
      if (!r.ok && r.motivo && r.motivo !== ultimoMotivoCampanha && !/rodando/.test(r.motivo)) { ultimoMotivoCampanha = r.motivo; console.log(`[campanha-wpp] ${r.motivo}`); }
    } catch (e) { console.error(`[campanha-wpp] passo falhou: ${e.message}`); }
  }, 30000);
  campanhaRelogio.unref?.();

  /* Nome do número (09/10): aprovado pela Meta depois de análise → entra no ar sozinho, com o PIN guardado. */
  const nomeRelogio = setInterval(() => { canais.conferirNomeAprovado().catch((e) => console.error(`[canais] conferir nome: ${e.message}`)); }, 10 * 60000);
  nomeRelogio.unref?.();

  const caixaProsp = setInterval(async () => {
    try {
      if (!prospCaixa.configurada() || !prosp.emailsJaEnviados()) { return; }
      const r = await lerCaixaProsp();
      if (!r.ok) { console.warn(`[prospeccao] caixa: ${r.motivo}`); } else if (r.lidos) { console.log(`[prospeccao] caixa: ${r.lidos} lido(s) — ${r.sair} SAIR, ${r.resposta} resposta(s), ${r.devolvida} devolvido(s)`); }
    } catch (e) { console.error(`[prospeccao] caixa falhou: ${e.message}`); }
  }, 10 * 60000);
  caixaProsp.unref?.();

  /* Mapa mental: a cada 5 min pergunta se já passou do ENCERRAMENTO do
     expediente (horário do bot do WhatsApp) e a pesquisa de hoje não rodou —
     diária, semanal (dominante da região) ou bimestral (dossiê). */
  const mapaAgenda = setInterval(async () => {
    try {
      if (emModoConsulta()) { return; }
      const tipo = mapaMental.oQueRodar({ horario: bot.comCanal('whatsapp', () => bot.getConfig()).horario });
      if (tipo) { const r = await rodarPesquisaMapa(tipo); console.log(`[mapa] pesquisa ${tipo}: ${r.concorrentes ?? 0} concorrente(s), ${r.mudancas?.length ?? 0} mudança(s)`); }
    } catch (e) { console.error(`[mapa] pesquisa falhou: ${e.message}`); }
  }, 5 * 60000);
  mapaAgenda.unref?.();

  /* Agendador das campanhas do Telegram: a cada 30 s publica o que venceu. */
  const agenda = setInterval(async () => {
    try {
      const r = await agendadorCampanhas();
      if (r.publicadas || r.falhas) { console.log(`[campanhas] agendador: ${r.publicadas} publicada(s), ${r.falhas} falha(s)`); }
    } catch (e) { console.error(`[campanhas] agendador falhou: ${e.message}`); }
  }, 30000);
  agenda.unref?.();

  /* Quem pagou e ficou sem o link (e-mail fora, WhatsApp caído) recebe de novo
     sozinho, sem depender de alguém notar no histórico. */
  const reentrega = setInterval(async () => {
    for (const id of clientes.pendentesDeAcesso({ temSenha: (cid) => !!usuarios.doCliente(cid)?.hash })) {
      console.log(`[acesso] ${id} pagou e segue sem acesso — nova tentativa de entrega`);
      await entregarAcesso(id).catch((e) => console.error(`[acesso] nova tentativa de ${id} falhou: ${e.message}`));
    }
  }, 10 * 60000);
  reentrega.unref?.();

  /* Hotel dos Bots — prazo de 12h: o 0007 empurra sozinho cada IA-ZEST em
     preparação até a homologação (pesquisa, testes, revisão). Risco alto fica
     validado aguardando uma pessoa. Roda 1 min depois de subir e a cada 30 min,
     na empresa dona e em cada empresa cliente. */
  const prazoHotel = async () => {
    if (emModoConsulta()) { return; }
    const rodar = async () => {
      const r = await hotel.processarPrazosHomologacao();
      if (r.verificados) { console.log(`[hotel] prazo 12h: ${r.verificados} verificado(s), ${r.homologados} homologado(s), ${r.aguardandoAprovacao} aguardando pessoa, ${r.pendentes} pendente(s)`); }
    };
    await rodar().catch((e) => console.error(`[hotel] prazo 12h falhou: ${e.message}`));
    await empresas.paraCada(rodar).catch((e) => console.error(`[hotel] prazo 12h (empresas) falhou: ${e.message}`));
  };
  setTimeout(prazoHotel, 60000).unref?.();
  setInterval(prazoHotel, 30 * 60000).unref?.();
});
