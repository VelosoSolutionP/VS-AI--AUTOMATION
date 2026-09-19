/**
 * VSmarket — CPF e CNPJ, validados pelo dígito verificador.
 *
 * O §4 exige CPF/CNPJ conforme a modalidade, e o gateway de pagamento vai recusar
 * subconta com documento inválido. Barrar aqui evita descobrir isso no meio do
 * cadastro do prestador, depois de ele ter preenchido tudo.
 */

const so = (v) => String(v || '').replace(/\D/g, '');

/** Todos os dígitos iguais passa na conta do DV e é sempre inválido na prática. */
const repetido = (d) => /^(\d)\1+$/.test(d);

export function cpfValido(valor) {
  const d = so(valor);
  if (d.length !== 11 || repetido(d)) { return false; }
  for (const [tam, pesoIni] of [[9, 10], [10, 11]]) {
    let soma = 0;
    for (let i = 0; i < tam; i++) { soma += Number(d[i]) * (pesoIni - i); }
    const resto = (soma * 10) % 11 % 10;
    if (resto !== Number(d[tam])) { return false; }
  }
  return true;
}

export function cnpjValido(valor) {
  const d = so(valor);
  if (d.length !== 14 || repetido(d)) { return false; }
  const calc = (base) => {
    let peso = base.length - 7;
    let soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * peso;
      peso = peso - 1 < 2 ? 9 : peso - 1;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  if (calc(d.slice(0, 12)) !== Number(d[12])) { return false; }
  return calc(d.slice(0, 13)) === Number(d[13]);
}

/** Aceita os dois e diz qual é — a modalidade do prestador depende disso. */
export function validarDocumento(valor) {
  const d = so(valor);
  if (!d) { return { ok: false, motivo: 'documento é obrigatório' }; }
  if (d.length === 11) {
    return cpfValido(d) ? { ok: true, tipo: 'CPF', numero: d } : { ok: false, motivo: 'CPF inválido (dígito verificador não bate)' };
  }
  if (d.length === 14) {
    return cnpjValido(d) ? { ok: true, tipo: 'CNPJ', numero: d } : { ok: false, motivo: 'CNPJ inválido (dígito verificador não bate)' };
  }
  return { ok: false, motivo: `documento deve ter 11 dígitos (CPF) ou 14 (CNPJ) — veio com ${d.length}` };
}

/**
 * Mostra parcial. O §39 pede não registrar documento completo sem necessidade;
 * a tela quase sempre só precisa confirmar qual é.
 */
export function mascarar(valor) {
  const d = so(valor);
  if (d.length === 11) { return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`; }
  if (d.length === 14) { return `**.${d.slice(2, 5)}.${d.slice(5, 8)}/****-**`; }
  return d ? '*'.repeat(d.length) : '';
}

/** Telefone brasileiro em formato canônico. */
export function normalizarTelefone(valor) {
  let d = so(valor);
  if (d.startsWith('55') && d.length >= 12) { d = d.slice(2); }
  if (d.length !== 10 && d.length !== 11) {
    return { ok: false, motivo: `telefone deve ter DDD + número (10 ou 11 dígitos) — veio com ${d.length}` };
  }
  const ddd = Number(d.slice(0, 2));
  if (ddd < 11 || ddd > 99) { return { ok: false, motivo: `DDD inválido: ${d.slice(0, 2)}` }; }
  return { ok: true, telefone: '55' + d, ddd: d.slice(0, 2) };
}
