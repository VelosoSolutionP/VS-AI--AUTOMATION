/**
 * Texto vira áudio — TTS LOCAL e gratuito (Piper), igual o whisper da
 * transcrição: nada sai da máquina, nada é pago por mensagem.
 *
 * Por que existe: quem manda áudio espera ouvir de volta. Responder sempre em
 * texto, para quem está dirigindo ou no meio do serviço, é o mesmo que não
 * responder. Aqui a resposta do bot (o texto do fluxo) vira uma NOTA DE VOZ.
 *
 * O Piper fala português (voz pt_BR-faber-medium) e o ffmpeg converte para
 * OGG/Opus, que é o formato de voz do WhatsApp. Áudio é sempre a resposta do
 * MESMO texto já decidido pelo fluxo — a IA não inventa nada, só dá voz.
 *
 * Falhou, demorou ou o Piper não está instalado? Devolve `ok:false` e o
 * atendimento manda em texto, como sempre. A voz ajuda; nunca trava.
 *
 * Instalação (uma vez): ~/.local/share/piper (binário + voz), ver
 * backend/instalar-voz.sh. Fora do ar ninguém percebe além do texto.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { dentroDaCasa } from '../casa.mjs';

const RAIZ_PIPER = join(homedir(), '.local', 'share', 'piper');

export const PADRAO_FALA = Object.freeze({
  ligado: true,
  bin: join(RAIZ_PIPER, 'piper', 'piper'),
  modelo: join(RAIZ_PIPER, 'vozes', 'pt_BR-faber-medium.onnx'),
  ffmpeg: 'ffmpeg',
  timeoutMs: 25000,
  /* Fala longa (cardápio inteiro) vira áudio de minutos e chega tarde. Acima
     disto a resposta sai em texto, que é lida na hora. */
  maxCaracteres: 700,
  bitrate: '40k',
  /* 11/11: a voz padrão soava robótica (corrida, monótona, chiado nos agudos).
     Um pouco mais lenta, mais variação de entonação, pausa entre frases e um
     corte suave nos agudos deixam a fala mais próxima de uma pessoa. */
  ritmo: 1.1,          // --length_scale: >1 fala mais devagar
  entonacao: 0.75,     // --noise_scale: variação da voz
  variacao: 0.9,       // --noise_w: variação na duração dos sons
  pausaFrase: 0.35,    // --sentence_silence: segundos entre frases
  filtro: 'highpass=f=70,lowpass=f=7800,equalizer=f=3500:t=q:w=1.2:g=-3,equalizer=f=180:t=q:w=1:g=2',
});

const arqConfig = () => join(dentroDaCasa('vsfala'), 'config.json');
const lerSalvo = () => {
  try { return JSON.parse(readFileSync(arqConfig(), 'utf8')) || {}; } catch { return {}; }
};

export function config() {
  const salvo = lerSalvo();
  return {
    ...PADRAO_FALA,
    ...(typeof salvo === 'object' ? salvo : {}),
    ...(process.env.VS_FALA_BIN ? { bin: process.env.VS_FALA_BIN } : {}),
    ...(process.env.VS_FALA_MODELO ? { modelo: process.env.VS_FALA_MODELO } : {}),
    ...(process.env.VS_FALA_DESLIGADA === '1' || salvo.ligado === false ? { ligado: false } : {}),
    ...(process.env.VS_FALA_MAX ? { maxCaracteres: Number(process.env.VS_FALA_MAX) || PADRAO_FALA.maxCaracteres } : {}),
  };
}

/* Tira o que não se fala: asteriscos do WhatsApp, link que o cliente não abre
   ouvindo, emoji e markdown. Mantém pontuação, que é o que dá ritmo à voz. */
export function limparParaFala(texto) {
  return String(texto || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/https?:\/\/\S+/gi, ' link ')
    .replace(/[*_#`~]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function correr(cmd, args, { entrada = null, timeoutMs = 25000, cwd = null } = {}) {
  return new Promise((resolve) => {
    let filho;
    try {
      filho = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return resolve({ code: -1, erro: e.message, stdout: Buffer.alloc(0), stderr: '' });
    }

    const saida = [];
    const erro = [];
    let terminou = false;
    const concluir = (r) => { if (!terminou) { terminou = true; clearTimeout(relogio); resolve(r); } };
    const relogio = setTimeout(() => {
      try { filho.kill('SIGKILL'); } catch { /* já morreu */ }
      concluir({ code: -1, erro: `demorou mais de ${timeoutMs} ms`, stdout: Buffer.concat(saida), stderr: Buffer.concat(erro).toString() });
    }, timeoutMs);

    filho.stdout.on('data', (d) => saida.push(d));
    filho.stderr.on('data', (d) => erro.push(d));
    filho.on('error', (e) => concluir({ code: -1, erro: e.message, stdout: Buffer.concat(saida), stderr: Buffer.concat(erro).toString() }));
    filho.on('close', (code) => concluir({ code, erro: code === 0 ? null : `saiu com código ${code}`, stdout: Buffer.concat(saida), stderr: Buffer.concat(erro).toString() }));

    try { filho.stdin.end(entrada == null ? '' : String(entrada)); } catch { /* sem stdin */ }
  });
}

/* Uma fala por vez: cada Piper carrega um modelo de 60 MB. Duas mensagens ao
   mesmo tempo em dois clientes não podem virar duas cópias do modelo na RAM. */
let fila = Promise.resolve();
const enfileirar = (tarefa) => {
  const proxima = fila.then(tarefa, tarefa);
  fila = proxima.catch(() => {});
  return proxima;
};

/**
 * Sintetiza o texto em nota de voz.
 * @returns {Promise<{ok:boolean, dataUri?:string, mime?:string, buffer?:Buffer, ms:number, erro?:string}>}
 */
export async function falar(texto, { cfg = {} } = {}) {
  const c = { ...config(), ...cfg };
  const inicio = Date.now();
  const limpo = limparParaFala(texto);
  if (!c.ligado) { return { ok: false, ms: 0, erro: 'voz desligada' }; }
  if (!limpo) { return { ok: false, ms: 0, erro: 'nada para falar' }; }
  if (limpo.length > c.maxCaracteres) { return { ok: false, ms: 0, erro: `texto longo demais para voz (${limpo.length} > ${c.maxCaracteres})` }; }
  if (!existsSync(c.bin)) { return { ok: false, ms: 0, erro: `Piper não encontrado em ${c.bin}` }; }
  if (!existsSync(c.modelo)) { return { ok: false, ms: 0, erro: `voz não encontrada em ${c.modelo}` }; }

  return enfileirar(async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'vsfala-'));
    const wav = join(pasta, 'fala.wav');
    const ogg = join(pasta, 'fala.ogg');
    try {
      const piper = await correr(c.bin, ['--model', c.modelo, '--output_file', wav,
        '--length_scale', String(c.ritmo), '--noise_scale', String(c.entonacao), '--noise_w', String(c.variacao),
        '--sentence_silence', String(c.pausaFrase)], {
        entrada: limpo, timeoutMs: c.timeoutMs, cwd: dirname(c.bin),
      });
      if (piper.erro || !existsSync(wav)) {
        return { ok: false, ms: Date.now() - inicio, erro: `Piper não gerou o áudio: ${(piper.stderr || piper.erro || 'sem resposta').trim().slice(0, 200)}` };
      }

      const ff = await correr(c.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav,
        ...(c.filtro ? ['-af', c.filtro] : []),
        '-c:a', 'libopus', '-b:a', c.bitrate, '-ar', '48000', '-ac', '1',
        '-application', 'voip', '-frame_duration', '60', '-vbr', 'on', '-compression_level', '10', ogg], {
        timeoutMs: c.timeoutMs,
      });
      if (ff.erro || !existsSync(ogg)) {
        return { ok: false, ms: Date.now() - inicio, erro: `ffmpeg não gerou o Opus: ${(ff.stderr || ff.erro || 'sem resposta').trim().slice(0, 200)}` };
      }

      const buffer = readFileSync(ogg);
      if (!buffer.length) { return { ok: false, ms: Date.now() - inicio, erro: 'áudio vazio' }; }
      return { ok: true, ms: Date.now() - inicio, buffer, mime: 'audio/ogg', dataUri: `data:audio/ogg;base64,${buffer.toString('base64')}` };
    } finally {
      try { rmSync(pasta, { recursive: true, force: true }); } catch { /* temporário */ }
    }
  });
}

/** O binário e a voz estão instalados e o ffmpeg responde? (integrações/painel) */
export function saude() {
  const c = config();
  if (!c.ligado) { return { ok: false, motivo: 'voz desligada' }; }
  if (!existsSync(c.bin)) { return { ok: false, motivo: `Piper não instalado em ${c.bin}` }; }
  if (!existsSync(c.modelo)) { return { ok: false, motivo: `voz não instalada em ${c.modelo}` }; }
  const ff = spawnSync(c.ffmpeg, ['-version'], { timeout: 3000, encoding: 'utf8' });
  if (ff.error || ff.status !== 0) { return { ok: false, motivo: 'ffmpeg não respondeu' }; }
  return { ok: true, motivo: null };
}
