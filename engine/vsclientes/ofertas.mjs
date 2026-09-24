/**
 * VSclientes — o que a Veloso Solution VENDE, e o que cada venda libera.
 *
 * Funções PURAS. Nada aqui lê disco nem rede: é a regra comercial escrita uma
 * vez, e é ela que o contrato, a cobrança e a chave consultam. Se o contrato
 * dissesse um preço e a cobrança calculasse outro, o cliente teria assinado uma
 * coisa e pago outra.
 *
 * Preço em CENTAVOS, sempre. `null` em limite = sem limite; `0` = não inclui.
 */

/** Tabela de venda. Anual cobra 12 meses de uma vez, pelo mensal com desconto. */
export const OFERTAS = Object.freeze([
  {
    code: 'whats-bot',
    nome: 'Bot WhatsApp',
    descricao: 'Atendimento 24h no WhatsApp, com 2 operadores',
    mensal: 3990,
    anualMensal: 3000,
    liberacoes: { operadores: 2, campanhasMes: 3, auditor: false, botFunil: true, bandaGbMes: 5, redes: [] },
  },
  {
    code: 'redes-micro',
    nome: 'Redes sociais — Microempresa',
    descricao: 'TikTok e Instagram: catálogo, campanhas e publicação',
    mensal: 12000,
    anualMensal: 10000,
    liberacoes: { operadores: 0, campanhasMes: 10, auditor: true, botFunil: false, bandaGbMes: 10, redes: ['tiktok', 'instagram'] },
  },
  {
    code: 'sob-consulta',
    nome: 'Sob consulta',
    descricao: 'Demais produtos e empresas de maior porte — valor combinado caso a caso',
    sobConsulta: true,
    mensal: null,
    anualMensal: null,
    liberacoes: { operadores: 0, campanhasMes: 0, auditor: false, botFunil: false, bandaGbMes: 0, redes: [] },
  },
]);

export const CICLOS = Object.freeze({
  mensal: { nome: 'Mensal', meses: 1 },
  semestral: { nome: 'Semestral', meses: 6 },
  anual: { nome: 'Anual', meses: 12 },
});

export const REDES = Object.freeze(['tiktok', 'instagram']);
export const NOME_REDE = Object.freeze({ tiktok: 'TikTok', instagram: 'Instagram' });

/* Os planos Bronze/Prata/Gold moram no catálogo comercial (engine/vsplanos),
   que é dado. Quem monta a carteira injeta a leitura dele aqui, e as ofertas
   passam a ser as fixas + as do catálogo — sem este módulo ler disco. */
let catalogo = () => [];
export function usarCatalogo(fn) { catalogo = typeof fn === 'function' ? fn : () => []; }
export const todasOfertas = () => [...OFERTAS, ...catalogo()];
export const oferta = (code) => todasOfertas().find((o) => o.code === code) || null;

/** Preço mensal de uma oferta no ciclo; null = a oferta não tem esse ciclo. */
export function mensalNoCiclo(o, ciclo) {
  if (ciclo === 'anual') { return o.anualMensal ?? null; }
  if (ciclo === 'semestral') { return o.semestralMensal ?? null; }
  return o.mensal;
}

export const brl = (centavos) => (centavos == null ? '—'
  : (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

const soDigitos = (s) => String(s ?? '').replace(/\D/g, '');

/* ---------------- documento e telefone ---------------- */

function cpfValido(d) {
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) { return false; }
  const dv = (n) => {
    let s = 0;
    for (let i = 0; i < n; i++) { s += Number(d[i]) * (n + 1 - i); }
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

function cnpjValido(d) {
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) { return false; }
  const dv = (n) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((acc, p, i) => acc + Number(d[i]) * p, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

/** CPF ou CNPJ, pelos dígitos verificadores. Documento errado no contrato invalida a assinatura. */
export function documento(bruto) {
  const d = soDigitos(bruto);
  if (d.length === 11) { return cpfValido(d) ? { ok: true, tipo: 'CPF', digitos: d } : { ok: false, motivo: 'CPF inválido (dígito verificador não confere)' }; }
  if (d.length === 14) { return cnpjValido(d) ? { ok: true, tipo: 'CNPJ', digitos: d } : { ok: false, motivo: 'CNPJ inválido (dígito verificador não confere)' }; }
  return { ok: false, motivo: `documento com ${d.length} dígito(s): CPF tem 11, CNPJ tem 14` };
}

export function formatarDocumento(d) {
  const x = soDigitos(d);
  if (x.length === 11) { return x.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'); }
  if (x.length === 14) { return x.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5'); }
  return x;
}

/**
 * WhatsApp com DDI. É por ele que a chave sai — número errado entrega a chave
 * pra outra pessoa, então o formato é conferido aqui e não na hora de enviar.
 */
export function whatsapp(bruto) {
  let d = soDigitos(bruto);
  if (d.length === 10 || d.length === 11) { d = '55' + d; }
  if (!/^55\d{10,11}$/.test(d)) { return { ok: false, motivo: 'WhatsApp inválido: use DDD + número (ex.: 31 99999-8888)' }; }
  return { ok: true, digitos: d };
}

export function formatarWhatsapp(d) {
  const x = soDigitos(d);
  const m = x.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : x;
}

/* ---------------- liberações ---------------- */

const inteiroOuNulo = (v) => (v === null || v === '' || v === undefined ? null : Number(v));

/** Soma das liberações dos produtos escolhidos — é o PADRÃO; quem cadastra ajusta. */
export function liberacoesPadrao(codes = []) {
  const base = { operadores: 0, campanhasMes: 0, auditor: false, botFunil: false, bandaGbMes: 0, redes: [] };
  for (const c of codes) {
    const o = oferta(c);
    if (!o) { continue; }
    const l = o.liberacoes;
    base.operadores += l.operadores;
    base.campanhasMes += l.campanhasMes;
    base.bandaGbMes += l.bandaGbMes;
    base.auditor = base.auditor || l.auditor;
    base.botFunil = base.botFunil || l.botFunil;
    base.redes = [...new Set([...base.redes, ...l.redes])];
  }
  return base;
}

export function validarLiberacoes(l = {}) {
  const erros = [];
  const out = {};
  for (const [campo, nome] of [['operadores', 'operadores'], ['campanhasMes', 'campanhas por mês'], ['bandaGbMes', 'banda mensal (GB)']]) {
    const v = inteiroOuNulo(l[campo]);
    if (v != null && (!Number.isFinite(v) || v < 0)) { erros.push(`${nome} precisa ser um número ≥ 0 (ou vazio para ilimitado)`); }
    out[campo] = v;
  }
  if (out.operadores != null && !Number.isInteger(out.operadores)) { erros.push('operadores precisa ser número inteiro'); }
  if (out.campanhasMes != null && !Number.isInteger(out.campanhasMes)) { erros.push('campanhas por mês precisa ser número inteiro'); }
  out.auditor = l.auditor === true || l.auditor === 'true' || l.auditor === 'on';
  out.botFunil = l.botFunil === true || l.botFunil === 'true' || l.botFunil === 'on';
  const redes = Array.isArray(l.redes) ? l.redes : String(l.redes || '').split(',').map((s) => s.trim()).filter(Boolean);
  const desconhecidas = redes.filter((r) => !REDES.includes(r));
  if (desconhecidas.length) { erros.push(`rede desconhecida: ${desconhecidas.join(', ')} (use ${REDES.join(', ')})`); }
  out.redes = redes.filter((r) => REDES.includes(r));
  return { erros, liberacoes: out };
}

/* ---------------- preço ---------------- */

/**
 * Valor da cobrança de UM ciclo. Sob consulta exige o mensal combinado — sem ele
 * não há valor pra pôr no contrato, e contrato sem valor não é contrato.
 */
export function precoDe({ produtos = [], ciclo = 'mensal', valorCombinadoMensal = null, adendos = [] } = {}) {
  const c = CICLOS[ciclo];
  if (!c) { return { ok: false, motivo: `ciclo "${ciclo}" não existe (use mensal ou anual)` }; }
  if (!produtos.length) { return { ok: false, motivo: 'escolha ao menos um produto' }; }
  const itens = [];
  for (const code of produtos) {
    const o = oferta(code);
    if (!o) { return { ok: false, motivo: `produto "${code}" não existe` }; }
    if (o.sobConsulta) {
      const v = inteiroOuNulo(valorCombinadoMensal);
      if (v == null || !Number.isInteger(v) || v <= 0) {
        return { ok: false, motivo: 'produto sob consulta: informe o valor mensal combinado com o cliente' };
      }
      itens.push({ code, nome: o.nome, mensal: v, mensalCheio: v });
      continue;
    }
    const m = mensalNoCiclo(o, ciclo);
    if (m == null) { return { ok: false, motivo: `o plano "${o.nome}" não tem ciclo ${c.nome.toLowerCase()}` }; }
    itens.push({ code, nome: o.nome, mensal: m, mensalCheio: o.mensal });
  }
  /* Adendo contratado entra em TODA renovação, com o mesmo preço mensal — é
     parte do contrato, não um extra que some no mês seguinte. */
  for (const a of adendos || []) {
    if (!a?.mensalCentavos) { continue; }
    itens.push({ code: `adendo-${a.code}`, nome: `${a.nome} (adendo)${a.qtd > 1 ? ` × ${a.qtd}` : ''}`, mensal: a.mensalCentavos, mensalCheio: a.mensalCentavos, adendo: true });
  }
  const mensal = itens.reduce((s, i) => s + i.mensal, 0);
  const mensalCheio = itens.reduce((s, i) => s + i.mensalCheio, 0);
  return {
    ok: true,
    ciclo,
    nomeCiclo: c.nome,
    meses: c.meses,
    itens,
    mensal,
    total: mensal * c.meses,
    economia: (mensalCheio - mensal) * c.meses,
  };
}

/* ---------------- troca de plano ---------------- */

/**
 * Crédito pelos dias que o cliente já pagou e ainda não usou. Proporcional ao
 * tempo: pagou R$ 79 por 30 dias, faltam 10 → crédito de R$ 26,33.
 */
export function creditoRestante({ pagoCentavos, emitidaEm, validaAte, em = new Date().toISOString() }) {
  const total = new Date(validaAte) - new Date(emitidaEm);
  const resta = new Date(validaAte) - new Date(em);
  if (!(pagoCentavos > 0) || total <= 0 || resta <= 0) { return 0; }
  return Math.floor(pagoCentavos * Math.min(1, resta / total));
}

/**
 * Plano MAIOR troca na hora, com crédito do que sobrou; plano MENOR (ou igual
 * em valor) fica pra renovação — cobrar zero e devolver diferença viraria
 * reembolso, e ninguém perde o que já pagou esperando o fim do ciclo.
 */
export function avaliarTroca({ valorNovoCiclo, valorAtualCiclo, creditoCentavos, mesmoPlano }) {
  if (mesmoPlano) { return { tipo: 'mesmo' }; }
  /* Quem decide se é pra cima ou pra baixo é o PREÇO dos planos, não o saldo:
     depois de uma troca, o "pago" é só a diferença, e comparar com ele fazia
     voltar pro plano menor parecer upgrade — e cobrava. */
  if (valorAtualCiclo != null && valorNovoCiclo <= valorAtualCiclo) { return { tipo: 'downgrade', creditoCentavos }; }
  const aPagar = Math.max(valorNovoCiclo - creditoCentavos, 100);
  return { tipo: 'upgrade', valorCentavos: aPagar, creditoCentavos };
}

/** Adendo cobrado AGORA só pelos dias que faltam no ciclo em vigor (mínimo R$ 1). */
export function valorAdendoProporcional({ mensalCentavos, validaAte, em = new Date().toISOString() }) {
  const dias = Math.max(0, (new Date(validaAte) - new Date(em)) / 86400000);
  return Math.max(100, Math.round(mensalCentavos * Math.min(dias, 31) / 30));
}

/* ---------------- cliente ---------------- */

/** Valida o cadastro inteiro. Devolve o registro normalizado ou a lista de erros. */
export function validarCliente(e = {}) {
  const erros = [];
  const nome = String(e.nome || '').trim().replace(/\s+/g, ' ');
  if (nome.length < 3) { erros.push('nome completo (ou razão social) é obrigatório'); }
  const doc = documento(e.documento);
  if (!doc.ok) { erros.push(doc.motivo); }
  const wa = whatsapp(e.whatsapp);
  if (!wa.ok) { erros.push(wa.motivo); }
  const email = String(e.email || '').trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { erros.push('e-mail inválido'); }
  const produtos = [...new Set((Array.isArray(e.produtos) ? e.produtos : [e.produtos]).filter(Boolean))];
  if (!produtos.length) { erros.push('escolha ao menos um produto'); }
  for (const p of produtos) { if (!oferta(p)) { erros.push(`produto "${p}" não existe`); } }
  const ciclo = e.ciclo || 'mensal';
  if (!CICLOS[ciclo]) { erros.push('ciclo precisa ser mensal, semestral ou anual'); }
  const lib = validarLiberacoes(e.liberacoes || liberacoesPadrao(produtos));
  erros.push(...lib.erros);
  const valorCombinadoMensal = inteiroOuNulo(e.valorCombinadoMensal);
  if (!erros.length) {
    const p = precoDe({ produtos, ciclo, valorCombinadoMensal });
    if (!p.ok) { erros.push(p.motivo); }
  }
  if (erros.length) { return { erros }; }
  return {
    erros: [],
    cliente: {
      nome,
      documento: doc.digitos,
      tipoDocumento: doc.tipo,
      whatsapp: wa.digitos,
      email: email || null,
      endereco: String(e.endereco || '').trim().slice(0, 200) || null,
      cidadeUf: String(e.cidadeUf || '').trim().slice(0, 80) || null,
      responsavel: String(e.responsavel || '').trim().slice(0, 120) || null,
      produtos,
      ciclo,
      valorCombinadoMensal: produtos.includes('sob-consulta') ? valorCombinadoMensal : null,
      liberacoes: lib.liberacoes,
      observacoes: String(e.observacoes || '').trim().slice(0, 1000) || null,
    },
  };
}

/* ---------------- chave de ativação ---------------- */

/* Sem 0/O e 1/I/L: a chave é lida em voz alta e digitada do celular. */
const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** `BC-XXXX-XXXX-XXXX` a partir de bytes aleatórios (injetados, pra dar pra testar). */
export function formatarCodigo(bytes) {
  let s = '';
  for (let i = 0; i < 12; i++) { s += ALFABETO[bytes[i] % ALFABETO.length]; }
  return `BC-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export function normalizarCodigo(bruto) {
  const s = String(bruto || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const corpo = s.startsWith('BC') ? s.slice(2) : s;
  if (corpo.length !== 12 || [...corpo].some((c) => !ALFABETO.includes(c))) { return null; }
  return `BC-${corpo.slice(0, 4)}-${corpo.slice(4, 8)}-${corpo.slice(8, 12)}`;
}

/** Soma meses mantendo o dia; 31/01 + 1 mês = último dia de fevereiro, não 03/03. */
export function somarMeses(iso, meses) {
  const d = new Date(iso);
  const dia = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + meses);
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dia, ultimo));
  return d.toISOString();
}

/* ---------------- assinatura gov.br ---------------- */

/**
 * Olha DENTRO do PDF devolvido. Três perguntas, cada uma com resposta própria:
 *  - tem assinatura digital? (dicionário /ByteRange — é o que todo PDF assinado tem)
 *  - é do gov.br? (o certificado embutido é emitido pela "AC Final do Governo
 *    Federal do Brasil"; o nome aparece no DER dentro de /Contents)
 *  - é O NOSSO contrato? O Assinador do ITI assina por atualização incremental,
 *    então o arquivo assinado COMEÇA com os bytes exatos do que geramos.
 *
 * Isto NÃO valida a cadeia do certificado — quem faz isso com autoridade é o
 * validar.iti.gov.br. Aqui é a triagem que impede aceitar arquivo errado.
 */
export function examinarPdfAssinado(buf, original = null) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  if (b.subarray(0, 5).toString('latin1') !== '%PDF-') { return { ok: false, motivo: 'o arquivo enviado não é um PDF' }; }
  const txt = b.toString('latin1');
  const assinaturas = (txt.match(/\/ByteRange\s*\[/g) || []).length;
  let govbr = false;
  const nomes = [];
  for (const m of txt.matchAll(/\/Contents\s*<([0-9A-Fa-f\s]+)>/g)) {
    /* utf8: o nome no certificado vem em UTF8String, e acento lido como latin1
       vira lixo. Byte binário no meio não atrapalha a busca de texto. */
    const der = Buffer.from(m[1].replace(/\s/g, ''), 'hex').toString('utf8');
    if (/AC Final do Governo Federal do Brasil|Gov-?Br|gov\.br/i.test(der)) { govbr = true; }
    for (const n of der.matchAll(/([A-ZÀ-Ú][A-ZÀ-Ú ]{4,60}):\d{11}/g)) { nomes.push(n[1].trim()); }
  }
  const mesmoDocumento = original ? b.length > original.length && b.subarray(0, original.length).equals(original) : null;
  return { ok: true, assinaturas, govbr, mesmoDocumento, signatarios: [...new Set(nomes)] };
}
