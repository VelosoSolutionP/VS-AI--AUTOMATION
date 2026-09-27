/**
 * Tipo e dimensões de uma imagem lidos do cabeçalho do arquivo — sem biblioteca.
 *
 * O auditor precisa saber largura, altura e peso pra checar os limites que o
 * Telegram documenta pra foto. Pra isso bastam os primeiros bytes: PNG, GIF e
 * WebP dizem o tamanho logo no início; JPEG diz num marcador SOF, que a gente
 * procura pulando os segmentos anteriores.
 */
import { openSync, readSync, closeSync, fstatSync } from 'node:fs';

/** Lê só o começo do arquivo: 256 KB cobrem o SOF de qualquer JPEG razoável (EXIF grande incluso). */
const CABECA = 256 * 1024;

export function dimensoes(buf) {
  if (!buf || buf.length < 12) { return null; }
  // PNG: assinatura + IHDR (largura e altura em big-endian nos bytes 16..23)
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG' && buf.length >= 24) {
    return { tipo: 'png', largura: buf.readUInt32BE(16), altura: buf.readUInt32BE(20) };
  }
  if (buf.toString('ascii', 0, 3) === 'GIF' && buf.length >= 10) {
    return { tipo: 'gif', largura: buf.readUInt16LE(6), altura: buf.readUInt16LE(8) };
  }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP' && buf.length >= 30) {
    const f = buf.toString('ascii', 12, 16);
    if (f === 'VP8X') { return { tipo: 'webp', largura: 1 + buf.readUIntLE(24, 3), altura: 1 + buf.readUIntLE(27, 3) }; }
    if (f === 'VP8 ') { return { tipo: 'webp', largura: buf.readUInt16LE(26) & 0x3fff, altura: buf.readUInt16LE(28) & 0x3fff }; }
    if (f === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { tipo: 'webp', largura: 1 + (b & 0x3fff), altura: 1 + ((b >> 14) & 0x3fff) };
    }
    return { tipo: 'webp', largura: 0, altura: 0 };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const m = buf[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const tam = buf.readUInt16BE(i + 2);
      // SOF0..SOF15, menos DHT (C4), JPG (C8) e DAC (CC)
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { tipo: 'jpeg', largura: buf.readUInt16BE(i + 7), altura: buf.readUInt16BE(i + 5) };
      }
      i += 2 + tam;
    }
    return { tipo: 'jpeg', largura: 0, altura: 0 };
  }
  return null;
}

/** { tipo, largura, altura, bytes } do arquivo, ou null se não der pra ler. */
export function lerImagem(caminho) {
  let fd;
  try {
    fd = openSync(caminho, 'r');
    const bytes = fstatSync(fd).size;
    const buf = Buffer.alloc(Math.min(CABECA, bytes));
    readSync(fd, buf, 0, buf.length, 0);
    const d = dimensoes(buf);
    return d ? { ...d, bytes } : { tipo: null, largura: 0, altura: 0, bytes };
  } catch { return null; } finally { if (fd !== undefined) { try { closeSync(fd); } catch { /* já fechado */ } } }
}
