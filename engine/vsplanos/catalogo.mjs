/**
 * Catálogo de planos — funções PURAS.
 *
 * A REGRA QUE MANDA AQUI: plano é DADO, não código. Preço e limite mudam com o
 * mercado; código não deve mudar junto. Se daqui a dois meses o Bronze estiver
 * barato demais, nasce um `bronze-v2` e o `bronze` vira inativo — quem já
 * contratou continua no que assinou, e ninguém precisa caçar número espalhado
 * pelo sistema.
 *
 * É por isso que plano NÃO é editado no lugar: `novaVersao()` clona com outro
 * código. Mudar o preço de um plano que alguém já assinou é mudar contrato
 * assinado — coisa que software não deveria conseguir fazer sozinho.
 */

/** Um plano vale para um módulo. Combo é o par vendido junto. */
export const MODULOS = Object.freeze({ REDES: 'redes', WHATSAPP: 'whatsapp', TELEGRAM: 'telegram', COMBO: 'combo' });

/** Ciclos de cobrança e o que cada um faz com o preço. */
export const CICLOS = Object.freeze({
  mensal: { nome: 'Mensal', meses: 1, desconto: 0 },
  // Fidelidade tem de devolver algo: 10% é o que o cliente ganha por travar 6 meses.
  semestral: { nome: 'Semestral', meses: 6, desconto: 0.10 },
});

const inteiro = (v) => (v == null || v === '' ? null : Number(v));

/**
 * Valida um plano antes de gravar. Limite ausente = SEM limite, e isso é
 * explícito: `null` significa ilimitado, `0` significa que não pode nada. Tratar
 * os dois como "vazio" foi o que fez mais de um sistema liberar tudo por engano.
 */
export function validarPlano(p = {}) {
  const erros = [];
  const code = String(p.code || '').trim().toLowerCase();
  if (!code) { erros.push('o plano precisa de um código (ex.: "prata-whatsapp")'); }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(code || 'x')) { erros.push('código só com letras, números, ponto, hífen ou underline'); }
  if (!String(p.nome || '').trim()) { erros.push('o plano precisa de um nome pra aparecer na tela'); }
  if (!Object.values(MODULOS).includes(p.module)) {
    erros.push(`módulo inválido: use ${Object.values(MODULOS).join(', ')}`);
  }
  const preco = inteiro(p.monthly_price);
  if (preco == null || Number.isNaN(preco) || preco < 0) { erros.push('preço mensal em centavos é obrigatório'); }
  for (const campo of ['social_accounts', 'attendants', 'products_limit', 'campaigns_limit', 'storage_limit_mb']) {
    const v = inteiro(p[campo]);
    if (v != null && (Number.isNaN(v) || v < 0)) { erros.push(`${campo} precisa ser um número ≥ 0 (ou vazio para ilimitado)`); }
  }
  if (erros.length) { return { erros }; }
  return {
    erros: [],
    plano: {
      code,
      nome: String(p.nome).trim(),
      module: p.module,
      monthly_price: preco,
      billing_cycle: CICLOS[p.billing_cycle] ? p.billing_cycle : 'mensal',
      social_accounts: inteiro(p.social_accounts),
      attendants: inteiro(p.attendants),
      products_limit: inteiro(p.products_limit),
      campaigns_limit: inteiro(p.campaigns_limit),
      storage_limit_mb: inteiro(p.storage_limit_mb),
      ai_enabled: p.ai_enabled !== false,
      auditor_enabled: p.auditor_enabled === true,
      /* Só um plano por módulo leva o destaque: dois "mais escolhido" na mesma
         tabela não ajudam ninguém a escolher. */
      destaque: p.destaque === true,
      active: p.active !== false,
      criadoEm: p.criadoEm || new Date().toISOString(),
      substitui: p.substitui || null,
    },
  };
}

/** Preço final do ciclo, em centavos. Semestral cobra 6 meses com desconto. */
export function precoDoCiclo(plano, ciclo = 'mensal') {
  const c = CICLOS[ciclo] || CICLOS.mensal;
  const mensalCheio = plano.monthly_price || 0;
  const mensalComDesconto = Math.round(mensalCheio * (1 - c.desconto));
  return {
    ciclo,
    nomeCiclo: c.nome,
    meses: c.meses,
    mensal: mensalComDesconto,
    total: mensalComDesconto * c.meses,
    economia: (mensalCheio - mensalComDesconto) * c.meses,
    desconto: c.desconto,
  };
}

/**
 * Nova versão de um plano. NÃO altera o antigo: cria outro código e marca quem
 * ele substitui. O antigo sai de venda (`active:false`) e continua valendo pra
 * quem já assinou.
 */
export function novaVersao(planoAntigo, mudancas = {}, sufixo = 'v2') {
  const code = `${planoAntigo.code}-${sufixo}`;
  const v = validarPlano({ ...planoAntigo, ...mudancas, code, substitui: planoAntigo.code, criadoEm: new Date().toISOString() });
  if (v.erros.length) { return { erros: v.erros }; }
  return { erros: [], novo: v.plano, antigo: { ...planoAntigo, active: false } };
}

/**
 * O que o plano permite, pronto pra quem for barrar alguma coisa.
 * `null` = ilimitado. Quem consome isto NÃO deve inventar default.
 */
export function limitesDe(plano) {
  if (!plano) { return { produtos: null, atendentes: null, redes: null, campanhas: null, storageMb: null, ia: true, auditor: false }; }
  return {
    produtos: plano.products_limit,
    atendentes: plano.attendants,
    redes: plano.social_accounts,
    campanhas: plano.campaigns_limit,
    storageMb: plano.storage_limit_mb,
    ia: plano.ai_enabled !== false,
    auditor: plano.auditor_enabled === true,
  };
}

/**
 * Cabe mais um? Serve pra produto, atendente, rede — o que tiver teto.
 *
 * Limite NULO não bloqueia: é ilimitado por contrato, não por falta de dado.
 * Plano AUSENTE também não bloqueia — se a licença não informou o plano, o erro
 * é nosso e quem paga não pode ser o cliente.
 */
export function cabeMais(usadosAgora, limite, oQue = 'itens') {
  if (limite == null) { return { ok: true, limite: null }; }
  const usados = Number(usadosAgora) || 0;
  if (usados < limite) { return { ok: true, limite, restam: limite - usados }; }
  return {
    ok: false,
    limite,
    restam: 0,
    motivo: `seu plano permite ${limite} ${oQue} e você já tem ${usados}. `
      + 'Amplie o plano em Plano e acesso, ou libere espaço desativando o que não usa.',
  };
}

/** Quanto do teto já foi usado — a tela avisa antes de encher. */
export function uso(usadosAgora, limite, oQue = 'itens') {
  const usados = Number(usadosAgora) || 0;
  if (limite == null) { return { usados, limite: null, texto: `${usados} ${oQue} · sem limite no plano` }; }
  const pct = limite ? Math.round((usados / limite) * 100) : 100;
  return {
    usados,
    limite,
    restam: Math.max(0, limite - usados),
    pct,
    alerta: pct >= 100 ? 'cheio' : (pct >= 80 ? 'quase cheio' : null),
    texto: `${usados} de ${limite} ${oQue}`,
  };
}
