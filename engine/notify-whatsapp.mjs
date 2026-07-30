/**
 * Notificador WhatsApp do qa-gate (auditoria + pedido de ajuda).
 *
 * Provider: CallMeBot (grátis, GET HTTP, sem infra). SÓ TEXTO — a API rejeita
 * emoji/acento; por isso todo texto passa por sanitize() (ASCII imprimível).
 *
 * Opt-in: desligado por padrão. Só envia se notify.whatsapp.enabled=true e
 * phone/apikey preenchidos (diferentes do placeholder 'xxx'). Caso contrário
 * é no-op silencioso — nunca quebra o fluxo do gate.
 */
import { loadCompanyConfig } from './company-config.mjs';

/** CallMeBot só aceita ASCII simples: remove acento/emoji e limita tamanho. */
export function sanitize(s) {
  return String(s ?? '')
    .normalize('NFD') // decompoe acentos; a linha abaixo remove as marcas
    .replace(/[^\x20-\x7E]/g, '') // só ASCII imprimível (tira acento/emoji)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
}

/**
 * Normaliza a `solution`: aceita STRING (correção única) ou OBJETO por stack
 * {back|backend, front|frontend, mobile|app}. Retorna as partes presentes rotuladas,
 * pro card ficar completo separando o que foi feito em cada camada da tarefa.
 */
export function solutionParts(sol) {
  if (!sol) { return []; }
  if (typeof sol === 'string') { return [{ label: null, text: sol }]; }
  const pick = (ks) => { for (const k of ks) { if (sol[k]) { return sol[k]; } } return null; };
  const map = [
    ['Back', pick(['back', 'backend', 'be'])],
    ['Front', pick(['front', 'frontend', 'fe'])],
    ['Mobile', pick(['mobile', 'app', 'mob'])],
  ];
  return map.filter(([, v]) => v).map(([label, text]) => ({ label, text: String(text) }));
}
/** Achata a solution pra UMA linha (WhatsApp texto). Ex.: "Back: x. Front: y." */
export function solutionToPlain(sol) {
  return solutionParts(sol).map((p) => (p.label ? `${p.label}: ${p.text}` : p.text)).join('. ');
}

export function whatsappConfig(baseDir) {
  const cfg = loadCompanyConfig(baseDir);
  return cfg?.notify?.whatsapp || {};
}

export function whatsappEnabled(wa) {
  return !!(
    wa &&
    wa.enabled &&
    wa.phone &&
    wa.apikey &&
    wa.phone !== 'xxx' &&
    wa.apikey !== 'xxx'
  );
}

/**
 * Mensagem padrão. Sempre inclui PROJETO e #TAREFA. `kind`:
 * - help: IA travou e o dev não respondeu no timeout.
 * - impediment: bloqueio de infra (docker/ambiente); inclui a solução/quem resolve.
 * - red: gate vermelho; inclui a correção aplicada (trilha de evidência).
 * - green: gate verde (auditoria).
 */
export function formatMessage({ project, task, kind, problem, solution, dev } = {}) {
  const p = sanitize(project || '?');
  const t = task ? `#${sanitize(String(task))}` : 's/n';
  // TODO recibo comeca com PROJETO + TAREFA rotulados — pro Fabiano saber
  // sempre o que e de quem (varios projetos/devs em paralelo).
  const head = `Projeto ${p} · Tarefa ${t}`;
  const who = dev ? ` [dev: ${sanitize(dev)}]` : '';
  const solStr = solutionToPlain(solution);
  switch (kind) {
    case 'help':
      return `[qa-gate AJUDA] ${head} - ${sanitize(problem)}. Precisa de voce?${who}`;
    case 'impediment':
      return `[qa-gate IMPEDIMENTO] ${head} - ${sanitize(problem)}. Solucao: ${sanitize(solStr || 'aguardando')}.${who}`;
    case 'red':
      return `[qa-gate VERMELHO] ${head} - ${sanitize(problem)}. ${solStr ? 'Corrigi: ' + sanitize(solStr) : 'Resolvendo ate ficar verde.'}${who}`;
    case 'green':
      return `[qa-gate VERDE] ${head} - ${sanitize(problem || 'gate ok')}.${solStr ? ' Correcao: ' + sanitize(solStr) + '.' : ''}${who}`;
    case 'done':
      return `[qa-gate TAREFA CONCLUIDA] ${head} - entregue (push feito, sem erro pendente).${solStr ? ' ' + sanitize(solStr) : ''}${who}`;
    default:
      return `[qa-gate] ${head} - ${sanitize(problem || '')}${who}`;
  }
}

/** Nome do dev (autor) do config — pra assinar a mensagem. */
export function devName(baseDir) {
  const cfg = loadCompanyConfig(baseDir);
  return cfg?.autor || null;
}

/**
 * Nome do PROJETO pro recibo. Ordem: config.projectName (override) -> pai/base
 * (desambigua "backend"/"mobile" entre projetos, ex.: Egle/backend, Velvet/mobile)
 * -> base. O Fabiano precisa saber sempre o que e de quem.
 */
export function projectLabel(repo) {
  try {
    const cfg = loadCompanyConfig(repo);
    if (cfg?.projectName) { return sanitize(cfg.projectName); }
  } catch {}
  const parts = String(repo || '').replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean);
  const base = parts[parts.length - 1] || 'projeto';
  const parent = parts[parts.length - 2];
  if (parent && !/^[a-z]:$/i.test(parent) && parent !== '') {
    return `${parent}/${base}`;
  }
  return base;
}

/** Envia via CallMeBot. Retorna {ok, skipped?, status?, body?/error?}. Nunca lança. */
export async function sendWhatsApp(text, baseDir) {
  const wa = whatsappConfig(baseDir);
  if (!whatsappEnabled(wa)) {
    return { ok: false, skipped: true, reason: 'whatsapp desativado/placeholder' };
  }
  const url =
    'https://api.callmebot.com/whatsapp.php' +
    `?phone=${encodeURIComponent(wa.phone)}` +
    `&text=${encodeURIComponent(sanitize(text))}` +
    `&apikey=${encodeURIComponent(wa.apikey)}`;
  // Timeout curto: o envio NUNCA pode travar um commit/gate. Se o CallMeBot
  // demorar/estiver fora, aborta e segue (fire-and-forget defensivo).
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
    const body = await res.text();
    const ok = /queued|will receive/i.test(body);
    return { ok, status: res.status, body: body.slice(0, 300) };
  } catch (e) {
    return { ok: false, error: String(e) };
  } finally {
    clearTimeout(t);
  }
}

// ── Slack (GRATIS via incoming webhook) ──────────────────────────────────────
export function slackConfig(baseDir) {
  const cfg = loadCompanyConfig(baseDir);
  return cfg?.notify?.slack || {};
}
export function slackEnabled(sc) {
  return !!(sc && sc.enabled && sc.webhookUrl && sc.webhookUrl !== 'xxx');
}

/** Slack aceita acento/emoji (ao contrário do CallMeBot) — só tira controle e limita. */
function slackClean(s) {
  return String(s ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500);
}

/**
 * Monta o CARD (Block Kit) do recibo: header com status, campos Projeto/Tarefa/Dev,
 * bloco "Correção aplicada" e barra colorida (verde/vermelho/amarelo). Bem mais legível
 * que texto cru — o Fabiano bate o olho e sabe projeto, o que foi feito e quem fez.
 */
export function formatSlackBlocks({ project, task, kind, problem, solution, dev } = {}) {
  const meta = ({
    done: { emoji: ':white_check_mark:', title: 'Tarefa concluida', color: '#2eb67d' },
    green: { emoji: ':white_check_mark:', title: 'Gate verde', color: '#2eb67d' },
    red: { emoji: ':x:', title: 'Gate vermelho', color: '#e01e5a' },
    help: { emoji: ':raising_hand:', title: 'Preciso de voce', color: '#ecb22e' },
    impediment: { emoji: ':construction:', title: 'Impedimento', color: '#ecb22e' },
  })[kind] || { emoji: ':clipboard:', title: 'qa-gate', color: '#4a154b' };
  const p = slackClean(project || '?');
  const t = task ? `#${slackClean(String(task))}` : 's/n';
  const fields = [
    { type: 'mrkdwn', text: `*Projeto:*\n${p}` },
    { type: 'mrkdwn', text: `*Tarefa:*\n${t}` },
  ];
  if (dev) { fields.push({ type: 'mrkdwn', text: `*Dev:*\n${slackClean(dev)}` }); }
  if (problem) { fields.push({ type: 'mrkdwn', text: `*Status:*\n${slackClean(problem)}` }); }
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `${meta.emoji} ${meta.title}`, emoji: true } },
    { type: 'section', fields },
  ];
  const parts = solutionParts(solution);
  if (parts.length) {
    const body = parts
      .map((pt) => (pt.label ? `*${pt.label}:* ${slackClean(pt.text)}` : slackClean(pt.text)))
      .join('\n');
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Correcao aplicada:*\n${body}` } });
  }
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `qa-gate governanca${dev ? ' - ' + slackClean(dev) : ''}` }] });
  return { attachments: [{ color: meta.color, blocks }] };
}

/**
 * Envia pro Slack (webhook). Aceita STRING (texto simples) ou OBJETO (payload
 * Block Kit pronto). No-op se desativado. Timeout defensivo. Nunca lança.
 */
export async function sendSlack(payload, baseDir) {
  const sc = slackConfig(baseDir);
  if (!slackEnabled(sc)) {
    return { ok: false, skipped: true, reason: 'slack desativado/placeholder' };
  }
  const body = typeof payload === 'string' ? { text: sanitize(payload) } : payload;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(sc.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: String(e) };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Dispara pra TODOS os canais ligados. WhatsApp = texto plano (CallMeBot só ASCII).
 * Slack = CARD Block Kit (projeto/tarefa/dev/correção + cor por status).
 */
export async function notify(evt, baseDir) {
  const dev = evt?.dev || devName(baseDir);
  const msg = formatMessage({ ...evt, dev });
  const card = formatSlackBlocks({ ...evt, dev });
  const [wa, sl] = await Promise.all([
    sendWhatsApp(msg, baseDir),
    sendSlack(card, baseDir),
  ]);
  return { ok: !!(wa.ok || sl.ok), whatsapp: wa, slack: sl };
}
