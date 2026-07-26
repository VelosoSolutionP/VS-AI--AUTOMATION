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
  switch (kind) {
    case 'help':
      return `[qa-gate AJUDA] ${head} - ${sanitize(problem)}. Precisa de voce?${who}`;
    case 'impediment':
      return `[qa-gate IMPEDIMENTO] ${head} - ${sanitize(problem)}. Solucao: ${sanitize(solution || 'aguardando')}.${who}`;
    case 'red':
      return `[qa-gate VERMELHO] ${head} - ${sanitize(problem)}. ${solution ? 'Corrigi: ' + sanitize(solution) : 'Resolvendo ate ficar verde.'}${who}`;
    case 'green':
      return `[qa-gate VERDE] ${head} - ${sanitize(problem || 'gate ok')}.${solution ? ' Correcao: ' + sanitize(solution) + '.' : ''}${who}`;
    case 'done':
      return `[qa-gate TAREFA CONCLUIDA] ${head} - entregue (push feito, sem erro pendente).${solution ? ' ' + sanitize(solution) : ''}${who}`;
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
/** Envia pro Slack (webhook). No-op se desativado. Timeout defensivo. Nunca lança. */
export async function sendSlack(text, baseDir) {
  const sc = slackConfig(baseDir);
  if (!slackEnabled(sc)) {
    return { ok: false, skipped: true, reason: 'slack desativado/placeholder' };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(sc.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: sanitize(text) }),
      signal: ctrl.signal,
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: String(e) };
  } finally {
    clearTimeout(t);
  }
}

/** Monta a mensagem 1x e dispara pra TODOS os canais ligados (WhatsApp + Slack). */
export async function notify(evt, baseDir) {
  const dev = evt?.dev || devName(baseDir);
  const msg = formatMessage({ ...evt, dev });
  const [wa, sl] = await Promise.all([
    sendWhatsApp(msg, baseDir),
    sendSlack(msg, baseDir),
  ]);
  return { ok: !!(wa.ok || sl.ok), whatsapp: wa, slack: sl };
}
