/**
 * VStiktok — túnel público.
 *
 * Existe porque o OAuth da TikTok NÃO aceita `http://localhost` como redirect: exige
 * https público. Sem túnel, autorizar a conta numa máquina de desenvolvimento é
 * impossível — e é esse pedaço que faz a configuração levar horas.
 *
 * Dois provedores, ambos sem conta:
 *   cloudflared   — `cloudflared tunnel --url` (quick tunnel)
 *   localhost.run — só ssh, nem binário extra precisa
 *
 * E uma regra aprendida na marra: **o túnel só é dado como pronto depois de responder
 * de verdade**. Em 2026-09-17 o quick tunnel da Cloudflare subiu, registrou conexão e
 * imprimiu a URL, mas a borda devolvia 404 sem sequer encaminhar o request pro
 * cloudflared. Quem confia no log do provedor entrega ao usuário uma URL morta, ele
 * cola no painel da TikTok e passa a tarde caçando um erro que não é dele. Por isso
 * `abrirTunel` faz um ping ponta a ponta e, no modo `auto`, cai pro próximo provedor.
 */
import { spawn } from 'node:child_process';

/** Rota que o receptor de callback responde só pra provar que o túnel está vivo. */
export const PING = '/__vstiktok/ping';

export const PROVEDORES = {
  cloudflared: {
    nome: 'cloudflared (Cloudflare quick tunnel)',
    bin: () => process.env.VSTIKTOK_CLOUDFLARED || 'cloudflared',
    // 127.0.0.1 e nao "localhost": "localhost" pode resolver pra ::1 primeiro, e o
    // receptor escuta em IPv4 — o tunel sobe e todo request morre no origin.
    args: (porta) => ['tunnel', '--url', `http://127.0.0.1:${porta}`],
    re: /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i,
    ajuda: 'instale o cloudflared (https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/)',
  },
  'localhost.run': {
    nome: 'localhost.run (via ssh, sem instalar nada)',
    bin: () => 'ssh',
    args: (porta) => [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'ServerAliveInterval=30',
      '-R', `80:127.0.0.1:${porta}`,
      'nokey@localhost.run',
    ],
    re: /https:\/\/[a-z0-9.-]+\.lhr\.life/i,
    ajuda: 'precisa do cliente ssh instalado',
  },
};

/** Ordem do modo `auto`. localhost.run vem primeiro por ser o que exige menos da máquina. */
export const ORDEM_AUTO = ['localhost.run', 'cloudflared'];

/** Sobe UM provedor e devolve a URL que ele publicou — sem garantir que funciona. */
export function subirProvedor(nome, opts = {}) {
  const p = PROVEDORES[nome];
  if (!p) { return Promise.resolve({ ok: false, motivo: `provedor desconhecido: "${nome}"` }); }
  const { porta, timeoutMs = 45000, spawnImpl = spawn, aoLog } = opts;
  if (!porta) { return Promise.resolve({ ok: false, motivo: 'porta é obrigatória' }); }

  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawnImpl(p.bin(), p.args(porta), { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return resolve({ ok: false, provedor: nome, motivo: `nao consegui rodar ${p.bin()}: ${e.message}` });
    }

    let resolvido = false;
    const saida = [];
    const fechar = () => { try { proc.kill('SIGTERM'); } catch { /* ja morreu */ } };

    const t = setTimeout(() => {
      if (resolvido) { return; }
      resolvido = true;
      fechar();
      resolve({ ok: false, provedor: nome, motivo: `${nome} nao publicou URL em ${timeoutMs / 1000}s`, saida: saida.join('') });
    }, timeoutMs);

    const olhar = (buf) => {
      const txt = String(buf);
      saida.push(txt);
      if (aoLog) { aoLog(txt); }
      const m = txt.match(p.re);
      if (m && !resolvido) {
        resolvido = true;
        clearTimeout(t);
        resolve({ ok: true, provedor: nome, url: m[0], fechar, processo: proc });
      }
    };

    // O cloudflared imprime a URL no stderr; ler só stdout é o erro clássico aqui.
    proc.stdout?.on('data', olhar);
    proc.stderr?.on('data', olhar);

    proc.on('error', (e) => {
      if (resolvido) { return; }
      resolvido = true;
      clearTimeout(t);
      resolve({
        ok: false,
        provedor: nome,
        motivo: e?.code === 'ENOENT' ? `${p.bin()} nao esta instalado — ${p.ajuda}` : `falha no tunel: ${e.message}`,
      });
    });

    proc.on('exit', (code) => {
      if (resolvido) { return; }
      resolvido = true;
      clearTimeout(t);
      resolve({ ok: false, provedor: nome, motivo: `${nome} encerrou antes de publicar URL (codigo ${code})`, saida: saida.join('') });
    });
  });
}

/**
 * Prova que a URL pública chega ao servidor local. Tenta algumas vezes porque a
 * propagação leva alguns segundos — mas desiste, em vez de aceitar um 404 calado.
 */
export async function verificarTunel(url, opts = {}) {
  // O caminho do ping e configuravel porque o tunel nao serve so ao receptor de
  // callback: apontado para outro servico, `/__vstiktok/ping` nao existe la e a
  // verificacao acusava 404 num tunel que estava perfeito.
  const caminho = opts.caminhoPing || PING;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const esperar = opts.esperar || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const tentativas = opts.tentativas ?? 8;
  let ultimo = null;

  for (let i = 0; i < tentativas; i++) {
    try {
      const res = await fetchImpl(`${url}${caminho}`, { redirect: 'follow' });
      ultimo = res.status;
      if (res.status === 200) { return { ok: true, tentativas: i + 1 }; }
    } catch (e) {
      ultimo = e?.message || 'sem resposta';
    }
    if (i < tentativas - 1) { await esperar(opts.intervaloMs ?? 2500); }
  }
  return {
    ok: false,
    motivo: `o tunel subiu mas nao responde de fora em ${caminho} (ultimo: ${ultimo})`,
    status: ultimo,
  };
}

/**
 * Abre um túnel USÁVEL: sobe o provedor e só devolve depois de o ping passar.
 * `provedor: 'auto'` tenta a ORDEM_AUTO e vai pro próximo quando um falha.
 *
 * @param {{porta:number, provedor?:string, verificar?:boolean}} opts
 */
export async function abrirTunel(opts = {}) {
  const { porta, provedor = 'auto', verificar = true } = opts;
  if (!porta) { return { ok: false, motivo: 'porta é obrigatória' }; }

  const fila = provedor === 'auto' ? ORDEM_AUTO : [provedor];
  const tentados = [];

  for (const nome of fila) {
    const r = await subirProvedor(nome, opts);
    if (!r.ok) { tentados.push({ provedor: nome, motivo: r.motivo }); continue; }
    if (!verificar) { return { ...r, tentados }; }

    const v = await verificarTunel(r.url, opts);
    if (v.ok) { return { ...r, tentados, verificado: true }; }

    // URL publicada mas morta: derruba e tenta o próximo, em vez de entregar lixo.
    r.fechar();
    tentados.push({ provedor: nome, motivo: v.motivo, url: r.url });
  }

  return {
    ok: false,
    tentados,
    motivo: `nenhum tunel funcionou: ${tentados.map((t) => `${t.provedor} (${t.motivo})`).join(' | ')}`,
  };
}
