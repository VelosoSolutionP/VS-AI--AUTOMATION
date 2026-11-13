/**
 * Seletor do banco compartilhado.
 *
 *   DATABASE_URL definido -> Postgres/Prisma (banco-prisma.mjs) — async
 *   sem DATABASE_URL       -> banco desligado (banco-nada.mjs)
 *
 * Só Postgres. O SQLite foi aposentado em 12/11 (cópia final fora do projeto).
 */
import { soDigitos, documentoValido, empresaAtual, ligado } from './banco-comum.mjs';

const impl = !ligado()
  ? await import('./banco-nada.mjs')
  : await import('./banco-prisma.mjs');

export { soDigitos, documentoValido, empresaAtual, ligado };

export const abrir = impl.abrir;
export const fechar = impl.fechar;
export const ler = impl.ler;
export const gravar = impl.gravar;
export const existe = impl.existe;
export const espelharCatalogo = impl.espelharCatalogo;
export const produtosDaEmpresa = impl.produtosDaEmpresa;
