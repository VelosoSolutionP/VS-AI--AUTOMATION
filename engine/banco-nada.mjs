/**
 * Backend do seletor `banco.mjs` quando nenhum banco está ligado. Os módulos
 * checam `banco.ligado()` antes de chamar, então isto só existe para manter a
 * superfície de exports igual nos dois backends.
 */
const desligado = () => { throw new Error('banco compartilhado não está ligado (defina DATABASE_URL)'); };

export function abrir() { return desligado(); }
export async function fechar() { /* nada a fazer */ }
export async function ler() { return desligado(); }
export async function gravar() { return desligado(); }
export async function existe() { return desligado(); }
export async function espelharCatalogo() { return desligado(); }
export async function produtosDaEmpresa() { return desligado(); }
