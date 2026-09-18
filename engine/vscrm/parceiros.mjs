/**
 * VScrm — indicação e parceiros. Funções PURAS: validam e calculam, quem grava é o
 * store.
 *
 * Comissão não tem default: se a regra não foi definida, o cálculo devolve `null` com
 * o motivo, em vez de assumir 10% e prometer ao parceiro um valor que você nunca
 * combinou. Mesma regra do resto da suíte — número que não existe não vira zero.
 */

const slug = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Código de indicação a partir do nome (+ sufixo se colidir). */
export function gerarCodigo(nome, existentes = []) {
  const base = slug(nome).slice(0, 18) || 'parceiro';
  if (!existentes.includes(base)) { return base; }
  for (let i = 2; i < 999; i++) {
    const c = `${base}-${i}`;
    if (!existentes.includes(c)) { return c; }
  }
  return `${base}-${Date.now()}`;
}

/**
 * Valida a regra de comissão. `modelo`: percentual | fixo.
 * `quando`: primeira (só a 1ª venda) | sempre (toda venda do indicado).
 */
export function validarRegra(r = {}) {
  const erros = [];
  const modelo = r.modelo;
  if (modelo !== 'percentual' && modelo !== 'fixo') { erros.push('modelo deve ser "percentual" ou "fixo"'); }
  if (modelo === 'percentual') {
    const p = Number(r.percentual);
    if (!Number.isFinite(p) || p <= 0 || p > 100) { erros.push('percentual deve ficar entre 0 e 100'); }
  }
  if (modelo === 'fixo') {
    const v = Number(r.valorFixo);
    if (!Number.isFinite(v) || v <= 0) { erros.push('valor fixo deve ser maior que zero'); }
  }
  if (r.quando !== 'primeira' && r.quando !== 'sempre') { erros.push('quando deve ser "primeira" ou "sempre"'); }
  if (r.linkBase && !/^https?:\/\//i.test(r.linkBase)) { erros.push('linkBase precisa comecar com http:// ou https://'); }
  return { ok: erros.length === 0, erros };
}

/** Normaliza a regra já validada (números viram número, string sobra limpa). */
export function normalizarRegra(r = {}) {
  const v = validarRegra(r);
  if (!v.ok) { return { erro: v.erros.join('; ') }; }
  return {
    regra: {
      modelo: r.modelo,
      percentual: r.modelo === 'percentual' ? Number(r.percentual) : null,
      valorFixo: r.modelo === 'fixo' ? Number(r.valorFixo) : null,
      quando: r.quando,
      linkBase: String(r.linkBase || '').trim().replace(/\/+$/, '') || null,
      validadeDias: r.validadeDias == null || r.validadeDias === '' ? null : Number(r.validadeDias),
    },
  };
}

/**
 * Comissão de UMA venda. Sem regra definida devolve null + motivo — nunca um palpite.
 * @param {number} valorVenda
 * @param {object} regra
 * @param {number} ordem  1 = primeira venda do indicado
 */
export function comissao(valorVenda, regra, ordem = 1) {
  if (!regra || !regra.modelo) { return { valor: null, motivo: 'regra de comissao nao definida' }; }
  if (valorVenda == null || !Number.isFinite(Number(valorVenda))) { return { valor: null, motivo: 'venda sem valor' }; }
  if (regra.quando === 'primeira' && ordem > 1) { return { valor: 0, motivo: 'regra paga so a primeira venda' }; }
  if (regra.modelo === 'fixo') { return { valor: regra.valorFixo }; }
  return { valor: Number((Number(valorVenda) * regra.percentual / 100).toFixed(2)) };
}

/** Link de indicação do parceiro. Sem linkBase cadastrado não há link — diz o porquê. */
export function linkDe(parceiro, regra) {
  if (!regra?.linkBase) { return { link: null, motivo: 'defina o link base antes' }; }
  return { link: `${regra.linkBase}/?ref=${encodeURIComponent(parceiro.codigo)}` };
}

/** Cria o parceiro. Telefone reaproveita a normalização do CRM (DDI 55). */
export function novoParceiro({ nome, telefone, codigo }, existentes, normalizarTelefone) {
  const n = String(nome || '').trim();
  if (!n) { return { erro: 'informe o nome do parceiro' }; }
  const codigos = (existentes || []).map((p) => p.codigo);
  const cod = slug(codigo) || gerarCodigo(n, codigos);
  if (codigos.includes(cod)) { return { erro: `ja existe parceiro com o codigo "${cod}"` }; }
  const t = telefone ? normalizarTelefone(telefone) : { telefone: null };
  return {
    parceiro: {
      id: 'p_' + cod, nome: n, codigo: cod,
      telefone: t.telefone, telefoneAviso: t.erro || null,
      indicados: 0, ganhoAcumulado: null,
      criadoEm: new Date().toISOString(),
    },
  };
}

/** Resumo pro painel: quantos parceiros, quantos indicados, quanto já se deve. */
export function resumoParceiros(parceiros = []) {
  const ganhos = parceiros.map((p) => p.ganhoAcumulado).filter((v) => v != null);
  return {
    parceiros: parceiros.length,
    indicados: parceiros.reduce((a, p) => a + (p.indicados || 0), 0),
    // Ninguém com ganho lançado: null, pra tela escrever "—" em vez de "R$ 0".
    aPagar: ganhos.length ? ganhos.reduce((a, b) => a + b, 0) : null,
  };
}
