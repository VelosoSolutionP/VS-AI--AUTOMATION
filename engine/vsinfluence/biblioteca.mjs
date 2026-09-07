/**
 * VSinfluence — biblioteca de vídeos. Varre o diretório cadastrado e diz o que ainda
 * NÃO foi publicado naquela rede.
 *
 * O registro de publicados é por (rede + arquivo): o mesmo vídeo pode subir no YouTube
 * e no Instagram sem que um marque o outro como usado.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

export const EXTENSOES = ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v'];

/** É arquivo de vídeo pela extensão? */
export function ehVideo(nome) {
  return EXTENSOES.includes(extname(String(nome)).toLowerCase());
}

/** Chave do registro de publicados. */
export function chave(rede, arquivo) {
  return `${rede}::${basename(String(arquivo))}`;
}

/**
 * Lista os vídeos de um diretório, mais novo primeiro.
 * Diretório inexistente devolve lista vazia com o motivo — pasta que o usuário
 * apagou não pode derrubar a varredura das outras redes.
 *
 * @param {string} dir
 * @param {{readdirImpl?:Function, statImpl?:Function}} [io] injeção pra teste
 * @returns {{videos:Array<{arquivo:string, caminho:string, bytes:number, mtime:number}>, erro:string|null}}
 */
export function listarVideos(dir, io = {}) {
  const rd = io.readdirImpl || readdirSync;
  const st = io.statImpl || statSync;
  let nomes;
  try {
    nomes = rd(dir);
  } catch (e) {
    return { videos: [], erro: `não consegui ler "${dir}": ${e.code || e.message}` };
  }
  const videos = [];
  for (const nome of nomes) {
    if (!ehVideo(nome)) { continue; }
    const caminho = join(dir, nome);
    try {
      const s = st(caminho);
      if (s.isFile && !s.isFile()) { continue; }
      videos.push({ arquivo: nome, caminho, bytes: s.size ?? 0, mtime: Number(s.mtimeMs ?? 0) });
    } catch {
      // arquivo sumiu entre o readdir e o stat — ignora, não é erro do usuário
    }
  }
  return { videos: videos.sort((a, b) => b.mtime - a.mtime), erro: null };
}

/**
 * Vídeos ainda não publicados naquela rede, do mais ANTIGO pro mais novo — fila
 * justa: quem entrou primeiro sobe primeiro.
 * @param {string} rede
 * @param {Array} videos    saída de listarVideos
 * @param {object} publicados registro { chave: {ts, ...} }
 */
export function naoPublicados(rede, videos, publicados = {}) {
  return videos
    .filter((v) => !publicados[chave(rede, v.arquivo)])
    .sort((a, b) => a.mtime - b.mtime);
}

/**
 * Marca um vídeo como publicado. Puro: devolve o novo registro.
 * @returns {object} novo mapa de publicados
 */
export function marcarPublicado(publicados, rede, arquivo, dados = {}) {
  return { ...(publicados || {}), [chave(rede, arquivo)]: { rede, arquivo, ...dados } };
}
