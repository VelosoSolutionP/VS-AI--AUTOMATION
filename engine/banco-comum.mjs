/**
 * Regras comuns do banco compartilhado — ficam num módulo à parte para o seletor
 * `banco.mjs` e o backend Postgres importarem sem ciclo.
 */
import { lojaAtual, empresaAtual as empresaDoContexto } from './casa.mjs';

export const soDigitos = (v) => String(v || '').replace(/\D/g, '');

/** CNPJ válido pelos dígitos verificadores (CPF também passa: MEI/pessoa física vende). */
export function documentoValido(v) {
  const d = soDigitos(v);
  if (d.length === 11) {
    if (/^(\d)\1+$/.test(d)) { return false; }
    const dv = (n) => { let s = 0; for (let i = 0; i < n; i += 1) { s += Number(d[i]) * (n + 1 - i); } const r = (s * 10) % 11; return r === 10 ? 0 : r; };
    return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
  }
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) { return false; }
  const dv = (n) => { const p = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const s = p.reduce((a, x, i) => a + x * Number(d[i]), 0); const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

/** O banco está ligado nesta instalação? */
export const ligado = () => !!process.env.DATABASE_URL;

/** A empresa desta instalação (CNPJ só dígitos). */
export function empresaAtual() {
  /* Empresa cliente em uso (login dela, ou o webhook do número dela) vence; senão, a dona da instalação. */
  const c = soDigitos(empresaDoContexto() || process.env.VS_EMPRESA_CNPJ);
  if (!documentoValido(c)) { throw new Error('banco ligado sem VS_EMPRESA_CNPJ válido — sem a empresa, os dados não teriam dono'); }
  return c;
}

export { lojaAtual };
