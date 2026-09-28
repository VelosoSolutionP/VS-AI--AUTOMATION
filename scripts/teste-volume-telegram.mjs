#!/usr/bin/env node
/**
 * Teste de volume do atendimento pelo Telegram.
 *
 * Simula dezenas de clientes escrevendo ao mesmo tempo e confere se o Bolso
 * Cheio recebe, classifica, guarda e mostra as conversas SEM MISTURAR os
 * históricos — pelo MESMO caminho das mensagens reais:
 *
 *   Telegram FALSO (local)  ──►  provider Telegram  ──►  gateway  ──►  atendimento
 *        ▲  (getUpdates)            (o de produção)                       │  bot, CRM, fila
 *        └──────────── sendMessage (resposta do bot) ◄────────────────────┘
 *
 * Só o servidor do Telegram é falso. Todo o resto é o código de produção,
 * rodando numa INSTÂNCIA ISOLADA:
 *   - pasta de dados própria, temporária (HOME e VS_HOME apontam pra ela);
 *   - ambiente limpo: nenhuma credencial (Mercado Pago, WhatsApp, e-mail) herdada;
 *   - escuta só em 127.0.0.1, porta própria — não passa pelo túnel, não fica na rede;
 *   - nenhuma rota nova aceita mensagem falsa: o simulador fala com o Telegram falso,
 *     e é a própria instância que busca as mensagens nele.
 *
 * Uso:
 *   node scripts/teste-volume-telegram.mjs              # os três cenários
 *   node scripts/teste-volume-telegram.mjs concorrencia # só um: funcional | concorrencia | carga
 *   ... --tela <arquivo.png>   tira foto da fila no navegador (precisa de Chrome)
 *   ... --manter               não apaga a pasta de dados do teste no fim
 *   ... --ao-vivo              abre o console da instância de teste no navegador,
 *                              manda os clientes UM A UM (--intervalo ms, padrão 2000)
 *                              e deixa tudo NA TELA até você parar (Ctrl+C). Não apaga nada.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opc = (n) => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] || true) : null; };
const AO_VIVO = args.includes('--ao-vivo');
const MANTER = args.includes('--manter') || AO_VIVO;
const INTERVALO = Number(opc('--intervalo')) || 2000;
const TELA = opc('--tela');

/* Distribuição por cenário: quem pede gente e ninguém pega (aguardando), quem
   pede gente e um vendedor assume, e quem o bot resolve sozinho. */
const CENARIOS = {
  funcional: { total: 5, aguardando: 3, vendedor: 1, bot: 1 },
  concorrencia: { total: 30, aguardando: 20, vendedor: 5, bot: 5 },
  carga: { total: 200, aguardando: 120, vendedor: 40, bot: 40 },
};
const PEDE_GENTE = ['Quero falar com um vendedor.', 'Meu pagamento não foi confirmado.', 'Preciso alterar meu pedido.', 'O valor do produto está errado.'];
const PERGUNTA_BOT = ['Qual o horário de vocês?', 'Vocês abrem sábado?'];
const RESPOSTA_GENTE = 'Vou chamar um vendedor pra te ajudar. Um instante!';
const RESPOSTA_HORARIO = 'Abrimos de segunda a sábado, das 9h às 18h.';
const RESPOSTA_ENDERECO = 'Ficamos na Rua das Flores, 100.';
const TOKEN_BOT = '123456789:AAHtesteDeVolumeSomenteLocal0000000000';

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (v, p) => { if (!v.length) { return null; } const o = [...v].sort((a, b) => a - b); return o[Math.min(o.length - 1, Math.ceil((p / 100) * o.length) - 1)]; };
const idTg = (chat) => '999' + String(chat).padStart(12, '0');

/* ── Telegram falso: só o que o provider usa ─────────────────────────────── */
function servidorTelegramFalso() {
  const fila = []; let prox = 1; let msgId = 1;
  const enviados = []; // { chat, texto, em, foto?, botao? }
  const chats = {}; // canais/grupos simulados: id -> { chat, membro }
  let acorda = null;
  const corpoCru = (req) => new Promise((ok) => { const partes = []; req.on('data', (c) => partes.push(c)); req.on('end', () => ok(Buffer.concat(partes).toString('latin1'))); });
  const campo = (cru, nome) => (cru.match(new RegExp(`name="${nome}"\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--`)) || [])[1];
  const achaChat = (ref) => Object.values(chats).find((c) => String(c.chat.id) === String(ref) || (c.chat.username && '@' + c.chat.username === String(ref)));

  const corpoJson = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); });
  const arquivos = {}; // file_id -> Buffer (áudios que o "cliente" mandou)
  const srv = http.createServer(async (req, res) => {
    const arqM = req.url.match(/^\/file\/bot[^/]+\/voice\/([^/.]+)\.ogg$/);
    if (arqM) { const buf = arquivos[arqM[1]]; res.writeHead(buf ? 200 : 404, { 'content-type': 'audio/ogg' }); return res.end(buf || ''); }
    const metodo = req.url.split('/').pop().split('?')[0];
    const json = (r) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, result: r })); };
    const erro = (code, desc) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error_code: code, description: desc })); };
    // ── canais e grupos (campanhas) ──
    if (metodo === 'getChat') { const b = await corpoJson(req); const c = achaChat(b.chat_id); return c ? json(c.chat) : erro(400, 'Bad Request: chat not found'); }
    if (metodo === 'getChatMember') { const b = await corpoJson(req); const c = achaChat(b.chat_id); return c ? json(c.membro) : erro(400, 'Bad Request: chat not found'); }
    // ── o que o provider do Bolso Cheio chama (Bot API) ──
    if (metodo === 'getMe') { return json({ id: 1, is_bot: true, username: 'loja_teste_bot', first_name: 'Loja de Teste' }); }
    if (metodo === 'deleteWebhook') { return json(true); }
    if (metodo === 'getUpdates') {
      const b = await corpoJson(req);
      const pendentes = () => fila.filter((u) => u.update_id >= (b.offset || 0));
      if (!pendentes().length) { await new Promise((ok) => { acorda = ok; setTimeout(ok, 1000); }); }
      return json(pendentes().slice(0, 100));
    }
    if (metodo === 'sendMessage') {
      const b = await corpoJson(req);
      const c = achaChat(b.chat_id);
      if (c && !['administrator', 'creator', 'member'].includes(c.membro.status)) { return erro(403, 'Forbidden: bot is not a member'); }
      enviados.push({ chat: String(b.chat_id), texto: String(b.text || ''), em: Date.now(), botao: b.reply_markup?.inline_keyboard?.[0]?.[0] || null });
      return json({ message_id: msgId++, chat: { id: b.chat_id, username: c?.chat.username } });
    }
    if (metodo === 'sendPhoto') {
      const cru = await corpoCru(req);
      const chat = campo(cru, 'chat_id'); const c = achaChat(chat);
      if (c && c.chat.type === 'channel' && !(c.membro.status === 'administrator' && c.membro.can_post_messages)) { return erro(403, 'Forbidden: need administrator rights in the channel chat'); }
      let botao = null; try { botao = JSON.parse(campo(cru, 'reply_markup') || 'null')?.inline_keyboard?.[0]?.[0] || null; } catch { /* sem botao */ }
      enviados.push({ chat: String(chat), texto: Buffer.from(campo(cru, 'caption') || '', 'latin1').toString('utf8'), em: Date.now(), foto: true, botao });
      return json({ message_id: msgId++, chat: { id: chat, username: c?.chat.username } });
    }
    /* Documento (PDF do orçamento, contrato): guarda quem recebeu, o nome e se
       o arquivo é mesmo um PDF — é o que a prova confere. */
    if (metodo === 'sendDocument') {
      const cru = await corpoCru(req);
      const nome = (cru.match(/name="document"; filename="([^"]+)"/) || [])[1] || null;
      enviados.push({ chat: String(campo(cru, 'chat_id')), texto: Buffer.from(campo(cru, 'caption') || '', 'latin1').toString('utf8'), em: Date.now(),
        documento: nome, pdf: cru.includes('%PDF-') });
      return json({ message_id: msgId++ });
    }
    if (metodo === 'deleteMessage') { req.resume(); return json({ message_id: msgId++ }); }
    /* Simulador: o dono adicionou o bot a um canal/grupo (ou tirou). Gera o
       my_chat_member que o Telegram mandaria. */
    if (metodo === '_membro') {
      const b = await corpoJson(req);
      const membro = { status: b.status || 'administrator', can_post_messages: b.podePostar !== false, user: { id: 1, is_bot: true } };
      chats[b.chat.id] = { chat: { id: b.chat.id, title: b.chat.title, type: b.chat.type || 'channel', username: b.chat.username }, membro };
      fila.push({ update_id: prox++, my_chat_member: { chat: chats[b.chat.id].chat, from: { id: 77, first_name: 'Dono' }, date: Math.floor(Date.now() / 1000), old_chat_member: { status: 'left' }, new_chat_member: membro } });
      acorda?.();
      return json(true);
    }
    // ── controle do SIMULADOR (so em 127.0.0.1, so neste processo de teste) ──
    if (metodo === '_escrever') {
      const b = await corpoJson(req);
      const u = b.repetirId ? fila.find((x) => x.message.message_id === b.repetirId) : null;
      const update = u ? { ...u, update_id: prox++ } : {
        update_id: prox++,
        message: { message_id: 100000 + prox, date: Math.floor(Date.now() / 1000), text: b.texto, chat: { id: b.chat, type: 'private' }, from: { id: b.chat, is_bot: false, first_name: b.nome } },
      };
      fila.push(update); acorda?.();
      return json({ message_id: update.message.message_id });
    }
    if (metodo === '_enviados') { return json(enviados); }
    /* Cliente manda ÁUDIO (voz): guarda o arquivo e gera o update com voice. */
    if (metodo === '_escreverAudio') {
      const b = await corpoJson(req);
      const fid = 'voz-' + (prox + 1);
      arquivos[fid] = Buffer.from(b.base64 || '', 'base64');
      const update = { update_id: prox++, message: { message_id: 100000 + prox, date: Math.floor(Date.now() / 1000), chat: { id: b.chat, type: 'private' },
        from: { id: b.chat, is_bot: false, first_name: b.nome }, voice: { file_id: fid, mime_type: 'audio/ogg', duration: b.duracao || 5 } } };
      fila.push(update); acorda?.();
      return json({ message_id: update.message.message_id });
    }
    if (metodo === 'getFile') { const b = await corpoJson(req); return arquivos[b.file_id] ? json({ file_id: b.file_id, file_path: `voice/${b.file_id}.ogg` }) : erro(400, 'Bad Request: file not found'); }
    res.writeHead(404); res.end('{"ok":false,"description":"metodo nao simulado"}');
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, url: `http://127.0.0.1:${srv.address().port}` })));
}

/** O simulador fala com o Telegram falso por HTTP — igual se ele roda aqui ou em processo proprio (ao vivo). */
function clienteTelegramFalso(url, fecharServidor) {
  const post = async (m, corpo) => (await (await fetch(`${url}/bot/${m}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo || {}) })).json()).result;
  const c = {
    url,
    enviados: [],
    async atualizar() { c.enviados = await post('_enviados'); return c.enviados; },
    /** Um cliente escreve. `repetirId` reentrega o MESMO update (como o Telegram faz em falha de rede). */
    async escrever(d) { return (await post('_escrever', d)).message_id; },
    fechar: () => (fecharServidor ? new Promise((r) => fecharServidor.close(r)) : Promise.resolve()),
  };
  return c;
}

async function telegramFalso() {
  if (!AO_VIVO) { const { srv, url } = await servidorTelegramFalso(); return clienteTelegramFalso(url, srv); }
  /* Ao vivo, o Telegram falso roda em processo PROPRIO e fica no ar depois que o
     simulador termina — senao o bot do teste perderia o "Telegram" e a tela
     mostraria o canal caido. */
  const arq = join(tmpdir(), `bolso-telegram-falso-${process.pid}.json`);
  const filho = spawn(process.execPath, [fileURLToPath(import.meta.url), '--servir-telegram-falso', arq], { detached: true, stdio: 'ignore' });
  filho.unref();
  for (let i = 0; i < 40 && !existsSync(arq); i++) { await espera(100); }
  const { url } = JSON.parse(readFileSync(arq, 'utf8'));
  rmSync(arq, { force: true });
  const c = clienteTelegramFalso(url, null);
  c.pid = filho.pid;
  return c;
}

/* ── instância isolada do painel ─────────────────────────────────────────── */
async function montarCasa() {
  const casa = mkdtempSync(join(tmpdir(), 'bolso-volume-'));
  if (casa.startsWith(join(homedir(), '.qa-gate'))) { throw new Error('recusado: a pasta de teste não pode ser a de produção'); }
  const antes = process.env.VS_HOME;
  process.env.VS_HOME = casa;
  const crm = await import(join(RAIZ, 'engine/vscrm/index.mjs'));
  const bot = await import(join(RAIZ, 'engine/vsbot/index.mjs'));
  const acesso = await import(join(RAIZ, 'backend/acesso.mjs'));
  crm.setFunil(['Novo lead', 'Em atendimento', 'Fechado']);
  bot.salvarConfig({ ativo: true, nome: 'Bia', falhasAteHumano: 3 });
  // Uma loja de verdade: pagamento, pedido, valor e "vendedor" vão pra gente; horário o bot responde.
  bot.salvarRegra({ id: 'teste-gente', termos: ['vendedor', 'pagamento', 'pedido', 'valor'], resposta: RESPOSTA_GENTE, handoff: true, prioridade: 5 });
  bot.salvarRegra({ id: 'teste-horario', termos: ['horario', 'abrem', 'sabado'], resposta: RESPOSTA_HORARIO });
  /* Segunda pergunta de OUTRO assunto: repetir a mesma pergunta nao serve de teste —
     o canal nao repete a mesma frase pra mesma pessoa em 5 min, de proposito. */
  bot.salvarRegra({ id: 'teste-endereco', termos: ['endereco', 'onde fica'], resposta: RESPOSTA_ENDERECO });
  // Senha de console descartavel: sem ela o painel abre em "Criar o acesso" e a foto nao mostra a fila.
  acesso.criar(randomBytes(18).toString('base64url'));
  process.env.VS_HOME = antes;
  const token = randomBytes(24).toString('base64url');
  mkdirSync(join(casa, 'console'), { recursive: true });
  writeFileSync(join(casa, 'console', 'sessoes.json'), JSON.stringify({ [createHash('sha256').update(token).digest('hex')]: {
    email: 'teste@volume.local', papel: 'admin', clienteId: null, criada: new Date().toISOString(), expira: new Date(Date.now() + 3 * 3600e3).toISOString() } }));
  return { casa, token };
}

async function subirPainel({ casa, telegramUrl }) {
  const porta = 18000 + Math.floor(Math.random() * 2000);
  const log = join(casa, 'painel-teste.log');
  // Ambiente LIMPO de propósito: nada do painel.env (credenciais reais) entra aqui.
  const env = { PATH: process.env.PATH, HOME: casa, VS_HOME: casa, PORT: String(porta), HOST: '127.0.0.1', CRM_ENABLED: '1',
    TELEGRAM_API_URL: telegramUrl, RATE_CRM: '1000000', PAINEL_URL: `http://127.0.0.1:${porta}` };
  const { openSync } = await import('node:fs');
  const fd = openSync(log, 'a');
  const proc = spawn(process.execPath, [join(RAIZ, 'backend/server.mjs')], { cwd: RAIZ, env, stdio: ['ignore', fd, fd], detached: AO_VIVO });
  if (AO_VIVO) { proc.unref(); } // fica no ar como servidor depois que o simulador termina
  const base = `http://127.0.0.1:${porta}`;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + '/health')).ok) { return { proc, base, log }; } } catch { /* subindo */ }
    await espera(250);
  }
  proc.kill('SIGKILL');
  throw new Error('a instância de teste não subiu — veja ' + log);
}

const memoriaMb = (pid) => { try { return Math.round(Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))[1]) / 1024); } catch { return null; } };

/* ── um cenário ──────────────────────────────────────────────────────────── */
async function rodar(nomeCen) {
  const cen = CENARIOS[nomeCen];
  const tg = await telegramFalso();
  const { casa, token } = await montarCasa();
  const { proc, base, log } = await subirPainel({ casa, telegramUrl: tg.url });
  const api = async (rota, corpo) => {
    const r = await fetch(`${base}/crm/api/${rota}`, { method: corpo ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-crm-token': token }, body: corpo ? JSON.stringify(corpo) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { erros.push(`HTTP ${r.status} em ${rota}: ${j.erro || j.motivo || ''}`); }
    return j;
  };
  const erros = [];
  let memMax = 0; const memIni = memoriaMb(proc.pid);
  const vigia = setInterval(() => { memMax = Math.max(memMax, memoriaMb(proc.pid) || 0); }, 300);
  const R = { cenario: nomeCen, clientes: cen.total, verificacoes: [] };
  const ok = (nome, cond, det = '') => R.verificacoes.push({ ok: !!cond, nome, det });
  try {
    const con = await api('canais/conectar', { canal: 'telegram', token: TOKEN_BOT });
    ok('instância isolada conectou no Telegram falso', con.ok, con.numero || con.erro);
    if (AO_VIVO) {
      // Link direto com a sessão da instância de TESTE (só existe nesta máquina, em 127.0.0.1).
      const url = `${base}/crm?t=${token}#tg-atendimento`;
      console.log(`\n  🔴 AO VIVO — abrindo no navegador:\n     ${url}\n  (instância de teste isolada; seus dados reais não são tocados)\n`);
      try { spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref(); } catch { /* abre na mão */ }
      await espera(7000); // tempo do navegador abrir antes do primeiro cliente
    }

    // Quem é quem
    const clientes = Array.from({ length: cen.total }, (_, i) => {
      const grupo = i < cen.aguardando ? 'aguardando' : i < cen.aguardando + cen.vendedor ? 'vendedor' : 'bot';
      const chat = 800000000 + i + 1;
      return { n: i + 1, chat, id: idTg(chat), nome: `Cliente ${String(i + 1).padStart(3, '0')}`, grupo,
        texto: grupo === 'bot' ? PERGUNTA_BOT[i % PERGUNTA_BOT.length] : PEDE_GENTE[i % PEDE_GENTE.length], enviou: [] };
    });

    // 1ª onda: todos escrevem de uma vez
    const t0 = Date.now();
    for (const c of clientes) {
      c.t0 = Date.now(); c.msgId = await tg.escrever({ chat: c.chat, nome: c.nome, texto: c.texto }); c.enviou.push(c.texto);
      if (AO_VIVO) { console.log(`  → ${c.nome}: "${c.texto}"`); await espera(INTERVALO); }
    }
    // Reentrega do MESMO update pra alguns (o Telegram faz isso em falha de rede): não pode duplicar nada
    const repetidos = clientes.slice(0, Math.min(5, clientes.length));
    for (const c of repetidos) { await tg.escrever({ repetirId: c.msgId }); }

    const respostasDe = (c) => tg.enviados.filter((e) => e.chat === String(c.chat));
    const limite = Date.now() + 90000;
    await tg.atualizar();
    while (Date.now() < limite && clientes.some((c) => !respostasDe(c).length)) { await espera(100); await tg.atualizar(); }
    const tProc = Date.now() - t0;
    const lat = clientes.map((c) => { const r = respostasDe(c)[0]; return r ? r.em - c.t0 : null; }).filter((x) => x != null);
    ok('todo cliente recebeu resposta do bot', lat.length === clientes.length, `${lat.length}/${clientes.length}`);
    ok('reentrega do mesmo update não gerou resposta em dobro', repetidos.every((c) => respostasDe(c).length === 1), repetidos.map((c) => respostasDe(c).length).join(','));
    ok('resposta certa pra cada tipo de pedido',
      clientes.every((c) => (respostasDe(c)[0]?.texto || '').includes(c.grupo === 'bot' ? 'segunda a sábado' : 'chamar um vendedor')));

    // Vendedor assume as conversas do grupo "vendedor"
    for (const c of clientes.filter((x) => x.grupo === 'vendedor')) {
      await api('atendimentos/assumir', { telefone: c.id });
      if (AO_VIVO) { console.log(`  ✋ vendedor assumiu ${c.nome}`); await espera(INTERVALO); }
    }

    // 2ª onda: quem está com gente escreve de novo (o bot tem que ficar QUIETO); quem está com o bot pergunta de novo
    await tg.atualizar();
    const antes = new Map(clientes.map((c) => [c.n, respostasDe(c).length]));
    for (const c of clientes) {
      const t = c.grupo === 'bot' ? 'Qual o endereço de vocês?' : 'Alguém aí? (' + c.nome + ')';
      await tg.escrever({ chat: c.chat, nome: c.nome, texto: t }); c.enviou.push(t);
      if (AO_VIVO) { await espera(Math.round(INTERVALO / 3)); }
    }
    const limite2 = Date.now() + 60000;
    const doBot = clientes.filter((c) => c.grupo === 'bot');
    await tg.atualizar();
    while (Date.now() < limite2 && doBot.some((c) => respostasDe(c).length <= antes.get(c.n))) { await espera(100); await tg.atualizar(); }
    await espera(1500); // tempo pra uma resposta indevida aparecer, se fosse aparecer
    await tg.atualizar();
    ok('bot fica quieto com quem está esperando ou com vendedor',
      clientes.filter((c) => c.grupo !== 'bot').every((c) => respostasDe(c).length === antes.get(c.n)));
    ok('bot continua respondendo quem está com ele', doBot.every((c) => respostasDe(c).length === antes.get(c.n) + 1
      && respostasDe(c).at(-1).texto.includes('Rua das Flores')));

    // A fila no CRM: tempo até mostrar tudo certo
    const tFila0 = Date.now(); let at = null;
    const alvo = { aguardando: cen.aguardando, 'com-vendedor': cen.vendedor, 'com-bot': cen.bot };
    const contar = (a) => { const x = { aguardando: 0, 'com-vendedor': 0, 'com-bot': 0 }; (a?.conversas || []).filter((c) => /^999\d{12}$/.test(c.telefone)).forEach((c) => { x[c.situacao] = (x[c.situacao] || 0) + 1; }); return x; };
    while (Date.now() - tFila0 < 20000) {
      at = await api('atendimentos');
      const x = contar(at);
      if (Object.keys(alvo).every((k) => x[k] === alvo[k])) { break; }
      await espera(250);
    }
    const tFila = Date.now() - tFila0;
    const cont = contar(at);
    ok(`fila no CRM: ${cen.aguardando} aguardando · ${cen.vendedor} com vendedor · ${cen.bot} com o bot`,
      Object.keys(alvo).every((k) => cont[k] === alvo[k]), `${cont.aguardando} · ${cont['com-vendedor']} · ${cont['com-bot']}`);
    const conv = new Map((at?.conversas || []).map((c) => [c.telefone, c]));
    ok('uma conversa por cliente, nenhuma a mais', (at?.conversas || []).filter((c) => /^999\d{12}$/.test(c.telefone)).length === cen.total);
    // Históricos não se misturam: as mensagens de entrada de cada conversa são EXATAMENTE as que aquele cliente mandou
    const misturadas = clientes.filter((c) => {
      const h = (conv.get(c.id)?.historico || []).filter((x) => x.tipo === 'interacao' && x.direcao === 'entrada').map((x) => x.texto);
      return JSON.stringify(h) !== JSON.stringify(c.enviou);
    });
    ok('históricos não se misturam (cada conversa só tem as mensagens do seu cliente)', !misturadas.length,
      misturadas.length ? `${misturadas.length} com problema, ex.: ${misturadas[0].nome}` : `${clientes.length} conferidas`);
    ok('quem pediu gente tem a hora da transferência; quem foi assumido, a hora que assumiram',
      clientes.every((c) => c.grupo === 'bot' || (conv.get(c.id)?.transferidaEm && (c.grupo !== 'vendedor' || conv.get(c.id)?.assumidaEm))));

    if (TELA && nomeCen === 'concorrencia') { R.tela = await foto(base, token, TELA); }

    const logTxt = readFileSync(log, 'utf8');
    const quebras = logTxt.split('\n').filter((l) => /quebrou|TypeError|ReferenceError|Unhandled|NAO consegui responder/.test(l));
    ok('sem erro no servidor durante o teste', !quebras.length && !erros.length, [...erros, ...quebras].slice(0, 3).join(' | '));

    R.metricas = {
      tempoPrimeiraOndaMs: tProc,
      mensagensPorSegundo: Math.round((clientes.length / (tProc / 1000)) * 10) / 10,
      latenciaRespostaMs: { p50: pct(lat, 50), p95: pct(lat, 95), max: Math.max(...lat) },
      tempoAteFilaCorretaMs: tFila,
      memoriaMb: { inicio: memIni, pico: memMax },
    };
  } finally {
    clearInterval(vigia);
    if (AO_VIVO) {
      /* Fica NO AR como servidor: o quadro continua na tela e o Telegram falso
         segue atendendo o bot. Desliga com --parar; a pasta de dados fica. */
      writeFileSync(ESTADO_AO_VIVO, JSON.stringify({ pids: [proc.pid, tg.pid].filter(Boolean), casa, url: `${base}/crm?t=${token}#tg-atendimento`, desde: new Date().toISOString() }, null, 2));
      console.log(`\n  🟢 tudo na tela. A instância de teste continua no ar em:\n     ${base}/crm?t=${token}#tg-atendimento`);
      console.log(`     dados do teste guardados em ${casa}`);
      console.log('     para desligar: node scripts/teste-volume-telegram.mjs --parar');
      R.pasta = casa;
      return R;
    }
    proc.kill('SIGTERM'); await espera(300); try { proc.kill('SIGKILL'); } catch { /* ja saiu */ }
    await tg.fechar();
    if (MANTER) { R.pasta = casa; } else { rmSync(casa, { recursive: true, force: true }); }
  }
  return R;
}

async function foto(base, token, arquivo) {
  let chromium; try { ({ chromium } = await import('playwright')); } catch { return 'playwright indisponível'; }
  const exe = ['/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  const pg = await (await b.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  await pg.addInitScript((t) => sessionStorage.setItem('crm_token', t), token);
  await pg.goto(base + '/crm#tg-atendimento', { waitUntil: 'networkidle' });
  await pg.waitForTimeout(1500);
  await pg.screenshot({ path: arquivo, fullPage: true });
  await b.close();
  return arquivo;
}

/* ── execução ────────────────────────────────────────────────────────────── */
const ESTADO_AO_VIVO = join(tmpdir(), 'bolso-volume-ao-vivo.json');
if (args[0] === '--servir-telegram-falso') {
  const { url } = await servidorTelegramFalso();
  writeFileSync(args[1], JSON.stringify({ url, pid: process.pid }));
  await new Promise(() => {}); // fica no ar ate --parar
}
if (args.includes('--parar')) {
  if (!existsSync(ESTADO_AO_VIVO)) { console.log('nenhum teste ao vivo rodando'); process.exit(0); }
  const e = JSON.parse(readFileSync(ESTADO_AO_VIVO, 'utf8'));
  for (const pid of e.pids) { try { process.kill(pid, 'SIGTERM'); } catch { /* ja tinha saido */ } }
  rmSync(ESTADO_AO_VIVO, { force: true });
  console.log(`teste ao vivo desligado. Dados guardados em ${e.casa} (apague a pasta quando nao precisar mais).`);
  process.exit(0);
}
if (AO_VIVO && existsSync(ESTADO_AO_VIVO)) {
  console.log('já existe um teste ao vivo no ar — desligue antes com: node scripts/teste-volume-telegram.mjs --parar');
  process.exit(1);
}
const alvo = args.find((a) => CENARIOS[a]);
const ordem = alvo ? [alvo] : ['funcional', 'concorrencia', 'carga'];
const resultados = [];
for (const c of ordem) {
  process.stdout.write(`\n▶ cenário ${c} (${CENARIOS[c].total} clientes)…\n`);
  const r = await rodar(c);
  resultados.push(r);
  for (const v of r.verificacoes) { console.log(`  ${v.ok ? 'PASSOU' : 'FALHOU'}  ${v.nome}${v.det ? ' — ' + v.det : ''}`); }
  if (r.metricas) {
    const m = r.metricas;
    console.log(`  ⏱  1ª onda em ${m.tempoPrimeiraOndaMs} ms (${m.mensagensPorSegundo} msg/s) · resposta p50 ${m.latenciaRespostaMs.p50} ms · p95 ${m.latenciaRespostaMs.p95} ms · máx ${m.latenciaRespostaMs.max} ms`);
    console.log(`  ⏱  fila correta no CRM em ${m.tempoAteFilaCorretaMs} ms · memória ${m.memoriaMb.inicio} → pico ${m.memoriaMb.pico} MB`);
  }
  if (r.tela) { console.log(`  📷 ${r.tela}`); }
}
const falhas = resultados.flatMap((r) => r.verificacoes.filter((v) => !v.ok).map((v) => `${r.cenario}: ${v.nome}`));
console.log(`\n${falhas.length ? '✗ ' + falhas.length + ' verificação(ões) falharam' : '✓ todos os cenários passaram'}`);
const saida = opc('--json');
if (saida && saida !== true) { writeFileSync(saida, JSON.stringify(resultados, null, 2)); }
process.exit(falhas.length ? 1 : 0);
