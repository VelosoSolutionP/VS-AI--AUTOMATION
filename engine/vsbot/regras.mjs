/**
 * VSbot — motor de atendimento. Funções PURAS: recebem a mensagem e o estado da
 * conversa e devolvem a resposta. Nada de rede aqui.
 *
 * Separar assim é o que permite o bot existir ANTES do WhatsApp: o canal só
 * entrega a mensagem e leva a resposta. Trocar Meta por Instagram, site ou
 * Telegram não toca em uma linha de regra.
 */

/** Tira acento e caixa: "Preço?" e "preco" têm que casar com a mesma regra. */
export function normalizar(texto) {
  return String(texto ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const GATILHOS = ['contem', 'exato', 'comeca'];

/** Uma regra casa? `contem` é o padrão porque é como gente escreve. */
export function casa(regra, texto) {
  const t = normalizar(texto);
  if (!t) { return false; }
  const termos = (regra.termos || []).map(normalizar).filter(Boolean);
  if (!termos.length) { return false; }
  const tipo = GATILHOS.includes(regra.gatilho) ? regra.gatilho : 'contem';
  return termos.some((termo) => {
    if (tipo === 'exato') { return t === termo; }
    if (tipo === 'comeca') { return t.startsWith(termo); }
    // Palavra inteira: "oi" não pode casar dentro de "moita".
    return new RegExp(`(^|[^a-z0-9])${termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(t);
  });
}

/**
 * Escolhe a regra. Ordem importa e é explícita: quem tem `prioridade` maior
 * ganha; empate, a primeira cadastrada. Sem isso, mudar a ordem da lista mudava
 * a resposta do bot sem ninguém ter mexido em regra nenhuma.
 */
export function escolher(regras = [], texto) {
  const candidatas = regras.filter((r) => r.ativa !== false && casa(r, texto));
  if (!candidatas.length) { return null; }
  return candidatas.sort((a, b) => (b.prioridade || 0) - (a.prioridade || 0))[0];
}

/** Troca {nome}, {produto}, {empresa}, {assistente}... pelo que o contexto tiver. */
export function preencher(texto, ctx = {}) {
  return String(texto ?? '').replace(/\{(\w+)\}/g, (inteiro, chave) => {
    const v = ctx[chave];
    // Variável sem valor fica visível em vez de virar vazio: "Olá !" é pior que
    // "Olá {nome}" — o segundo denuncia o erro, o primeiro esconde.
    return v == null || v === '' ? inteiro : String(v);
  });
}

export const PALAVRAS_HUMANO = ['atendente', 'humano', 'pessoa', 'falar com alguem', 'gerente', 'reclamacao', 'cancelar'];

/** Pediu gente? É a regra que ganha de todas — nunca deixar cliente preso no bot. */
export function pediuHumano(texto) {
  const t = normalizar(texto);
  return PALAVRAS_HUMANO.some((p) => t.includes(normalizar(p)));
}

/**
 * Responde uma mensagem.
 * @returns {{tipo:'regra'|'humano'|'catalogo'|'fallback', texto:string, regraId?:string, produtos?:Array}}
 */
export function responder(msg, cfg = {}, ctxCru = {}) {
  const texto = String(msg ?? '');
  /* `{assistente}` sai da PERSONA, sempre — quem chama nao precisa saber disso.
     Sem ele, o unico jeito de a saudacao dizer o nome do bot era escrever o nome
     dentro do texto; ai trocar a persona no painel nao mudava a saudacao, e o
     cliente continuava sendo recebido pelo nome antigo. */
  const ctx = { assistente: cfg.nome, ...ctxCru };

  if (pediuHumano(texto)) {
    return {
      tipo: 'humano',
      texto: preencher(cfg.mensagemHandoff || 'Já chamo uma pessoa do time pra te atender. Um instante.', ctx),
      handoff: true,
    };
  }

  const regra = escolher(cfg.regras || [], texto);
  if (regra) {
    return { tipo: 'regra', regraId: regra.id, texto: preencher(regra.resposta, ctx), handoff: regra.handoff === true };
  }

  // Catálogo só responde se houver produto — bot que diz "veja nosso catálogo"
  // e manda lista vazia é pior que bot que não responde.
  if (cfg.usarCatalogo && (ctx.produtos || []).length && casa({ termos: cfg.termosCatalogo || ['catalogo', 'produtos', 'preco', 'quanto custa'] }, texto)) {
    const lista = (ctx.produtos || []).slice(0, cfg.limiteCatalogo || 5);
    return {
      tipo: 'catalogo',
      texto: preencher(cfg.mensagemCatalogo || 'Olha o que temos:', ctx),
      produtos: lista,
    };
  }

  return {
    tipo: 'fallback',
    texto: preencher(cfg.mensagemFallback || 'Não entendi. Quer falar com uma pessoa do time?', ctx),
    // Fallback repetido é sinal de bot perdido: depois do limite, chama gente.
    handoff: (ctx.falhasSeguidas || 0) + 1 >= (cfg.falhasAteHumano || 2),
  };
}

/** Roda uma conversa inteira, acumulando o contador de falhas. */
export function conversar(mensagens = [], cfg = {}, ctx = {}) {
  let falhas = 0;
  const saidas = [];
  for (const m of mensagens) {
    const r = responder(m, cfg, { ...ctx, falhasSeguidas: falhas });
    falhas = r.tipo === 'fallback' ? falhas + 1 : 0;
    saidas.push({ recebida: m, ...r });
    if (r.handoff) { break; }
  }
  return saidas;
}

/** Valida uma regra antes de gravar. */
export function validarRegra(r = {}) {
  const erros = [];
  const termos = (r.termos || []).map((t) => String(t).trim()).filter(Boolean);
  if (!termos.length) { erros.push('informe ao menos um termo que dispara a regra'); }
  if (!String(r.resposta || '').trim()) { erros.push('a resposta é obrigatória'); }
  if (r.gatilho && !GATILHOS.includes(r.gatilho)) { erros.push(`gatilho inválido: "${r.gatilho}"`); }
  if (erros.length) { return { erros }; }
  return {
    erros: [],
    regra: {
      id: String(r.id || '').trim() || `r_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      nome: String(r.nome || '').trim() || termos[0],
      termos,
      gatilho: r.gatilho || 'contem',
      resposta: String(r.resposta).trim(),
      prioridade: Number(r.prioridade) || 0,
      handoff: r.handoff === true,
      ativa: r.ativa !== false,
      criadoEm: r.criadoEm || new Date().toISOString(),
    },
  };
}
