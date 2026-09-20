/**
 * Mídia do painel — arquivos grandes que precisam de URL PÚBLICA.
 *
 * Existe por causa do jeito que a TikTok aceita vídeo: `PULL_FROM_URL` manda ELA
 * baixar o arquivo de um endereço https em domínio verificado. Nosso domínio já
 * está verificado, então hospedar aqui é o caminho curto — sem isso, o cliente
 * teria que subir o vídeo em outro lugar antes de publicar.
 *
 * O corpo NÃO passa pelo leitor de JSON do painel (teto de 256 KB): vai direto
 * pro disco em streaming, com teto próprio. Nome de arquivo é gerado aqui — o
 * que o usuário manda vira só a extensão, porque isto vira rota pública.
 */
import { createWriteStream, createReadStream, existsSync, mkdirSync, statSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

export const MAX_BYTES = Number(process.env.MIDIA_MAX_BYTES || 256 * 1024 * 1024);

/** Só o que a TikTok aceita. Extensão desconhecida vira .mp4, não vira caminho. */
const TIPOS = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

export function baseDir() {
  const d = process.env.VSMIDIA_DIR || join(homedir(), '.qa-gate', 'midia');
  mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}

const extensaoDe = (nome) => {
  const m = String(nome || '').toLowerCase().match(/\.(mp4|mov|webm)$/);
  return m ? `.${m[1]}` : '.mp4';
};

/** Nome interno: id nosso + extensão conhecida. Nada do usuário entra no caminho. */
export const novoNome = (nomeOriginal) => randomBytes(12).toString('hex') + extensaoDe(nomeOriginal);

/**
 * Grava o corpo da requisição em disco, em streaming.
 * @returns {Promise<{ok:boolean, arquivo?:string, bytes?:number, motivo?:string}>}
 */
export function receber(req, nomeOriginal) {
  return new Promise((resolve) => {
    const arquivo = novoNome(nomeOriginal);
    const destino = join(baseDir(), arquivo);
    const saida = createWriteStream(destino, { mode: 0o600 });
    let bytes = 0;
    let encerrado = false;

    const falhar = (motivo) => {
      if (encerrado) { return; }
      encerrado = true;
      /* Apaga DEPOIS que o stream fechou. `createWriteStream` abre o arquivo de
         forma assincrona: apagar no ato podia rodar ANTES da abertura terminar,
         e o arquivo reaparecia em seguida — teto que deixa lixo no disco nao e
         teto. O 'close' garante que nao ha mais o que criar. */
      const limpar = () => {
        try { unlinkSync(destino); } catch { /* já não existe */ }
        resolve({ ok: false, motivo });
      };
      saida.once('close', limpar);
      saida.destroy();
    };

    req.on('data', (p) => {
      bytes += p.length;
      // Corta no ato: sem isto, um upload de 10 GB enche o disco antes de qualquer
      // validação, e o teto vira decoração.
      if (bytes > MAX_BYTES) { falhar(`arquivo acima de ${Math.round(MAX_BYTES / 1024 / 1024)} MB`); req.destroy(); }
    });
    req.on('error', () => falhar('a transferência foi interrompida'));
    saida.on('error', (e) => falhar('não consegui gravar: ' + e.message));
    saida.on('finish', () => {
      if (encerrado) { return; }
      if (!bytes) { return falhar('arquivo vazio'); }
      encerrado = true;
      resolve({ ok: true, arquivo, bytes });
    });
    req.pipe(saida);
  });
}

/** Nome válido? Só o que este módulo gera. Fecha caminho e nome inventado. */
export const nomeValido = (n) => /^[0-9a-f]{24}\.(mp4|mov|webm)$/.test(String(n || ''));

/**
 * Serve o arquivo. Atende Range porque quem baixa é a TikTok, e servidor que
 * ignora Range faz o cliente dela desistir de vídeo grande.
 */
export function servir(req, res, nome) {
  if (!nomeValido(nome)) { return false; }
  const caminho = join(baseDir(), nome);
  if (!existsSync(caminho)) { return false; }

  const { size } = statSync(caminho);
  const tipo = TIPOS[nome.slice(nome.lastIndexOf('.'))] || 'application/octet-stream';
  const range = String(req.headers.range || '').match(/bytes=(\d*)-(\d*)/);

  if (range) {
    const ini = range[1] ? Number(range[1]) : 0;
    const fim = range[2] ? Number(range[2]) : size - 1;
    if (ini >= size || fim >= size || ini > fim) {
      res.writeHead(416, { 'content-range': `bytes */${size}` });
      res.end();
      return true;
    }
    res.writeHead(206, {
      'content-type': tipo,
      'content-length': String(fim - ini + 1),
      'content-range': `bytes ${ini}-${fim}/${size}`,
      'accept-ranges': 'bytes',
    });
    createReadStream(caminho, { start: ini, end: fim }).pipe(res);
    return true;
  }

  res.writeHead(200, { 'content-type': tipo, 'content-length': String(size), 'accept-ranges': 'bytes' });
  createReadStream(caminho).pipe(res);
  return true;
}

export function listar() {
  try {
    return readdirSync(baseDir()).filter(nomeValido).map((arquivo) => {
      const s = statSync(join(baseDir(), arquivo));
      return { arquivo, bytes: s.size, em: s.mtime.toISOString() };
    }).sort((a, b) => b.em.localeCompare(a.em));
  } catch { return []; }
}

export function excluir(nome) {
  if (!nomeValido(nome)) { return { ok: false, motivo: 'nome inválido' }; }
  try { unlinkSync(join(baseDir(), nome)); return { ok: true }; }
  catch (e) { return { ok: false, motivo: e.message }; }
}
