/**
 * Fluxo de atendimento — a árvore que o cliente percorre.
 *
 * É diferente de REGRA. Regra é reflexo: o cliente escreve "preço" e o bot
 * responde. Fluxo é conversa conduzida: pergunta, opções, e o que a pessoa
 * escolhe decide o passo seguinte. Os dois convivem — quem está no meio de um
 * fluxo continua nele; quem chega solto cai nas regras.
 *
 * MENU NUMERADO, E NÃO BOTÃO: botão e lista interativa são recurso da API
 * oficial da Meta; no canal por WhatsApp Web não renderizam de forma confiável.
 * No dia em que o canal oficial entrar, ESTE MESMO fluxo vira botão.
 *
 * Um passo (ou uma opção) pode ter AÇÃO e DESTINO ao mesmo tempo: "faça isto e
 * siga para lá". Ação sem destino encerra o fluxo. Foi o desenho do fluxo real
 * da Micaela que exigiu isso — coletar um texto e continuar é a coisa mais
 * comum que existe numa triagem.
 *
 * Tudo aqui é PURO: recebe fluxo + onde a pessoa está + o que ela escreveu, e
 * devolve o que responder, para onde ir e o que guardar. Quem grava é o store.
 */

/** O que o fluxo sabe fazer. Ação que não está aqui é recusada na importação. */
export const ACOES = Object.freeze({
  ENCAMINHAR: 'encaminhar', // entrega pra uma pessoa/departamento — encerra o fluxo
  COLETAR: 'coletar',       // a PRÓXIMA mensagem é texto livre e vira contexto
  CATALOGO: 'catalogo',     // manda os produtos da vitrine
  CONFIRMAR: 'confirmar',   // pede/confirma os dados do cliente
  NOTA: 'nota',             // marca algo no contexto e segue (sem efeito externo)
  FIM: 'fim',               // encerra sem chamar ninguém
});

const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const VOLTAR = ['menu', 'voltar', 'inicio', 'começar', 'comecar', 'recomecar', 'recomeçar'];

/** Ações que entregam o atendimento pra uma pessoa. */
const ENCERRA_COM_GENTE = (a) => a === ACOES.ENCAMINHAR;

export function validarFluxo(passos = []) {
  const erros = [];
  if (!passos.length) { return { erros: ['o fluxo está vazio'] }; }

  const ids = passos.map((p) => String(p.id || '').trim()).filter(Boolean);
  const repetidos = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (repetidos.length) { erros.push(`passo repetido: ${[...new Set(repetidos)].join(', ')}`); }

  const conhecidos = new Set(ids);
  const validos = Object.values(ACOES);
  const conferir = (onde, o) => {
    if (o.acao && !validos.includes(o.acao)) {
      erros.push(`${onde}: ação "${o.acao}" não existe (use ${validos.join(', ')})`);
    }
    if (!o.acao && !o.vaiPara) { erros.push(`${onde}: falta dizer para onde vai (vai_para) ou o que faz (acao)`); }
    if (o.vaiPara && !conhecidos.has(String(o.vaiPara).trim())) {
      erros.push(`${onde}: aponta para "${o.vaiPara}", que não existe`);
    }
    // Coletar sem destino deixa a resposta do cliente sem para onde ir.
    if (o.acao === ACOES.COLETAR && !o.vaiPara) { erros.push(`${onde}: "coletar" precisa de vai_para — senão a resposta do cliente não leva a lugar nenhum`); }
  };

  for (const p of passos) {
    const id = String(p.id || '').trim();
    if (!id) { erros.push('há passo sem id'); continue; }
    if (!String(p.mensagem || '').trim()) { erros.push(`passo "${id}" não tem mensagem`); }
    for (const o of p.opcoes || []) {
      if (!String(o.texto || '').trim()) { erros.push(`passo "${id}" tem opção sem texto`); continue; }
      conferir(`passo "${id}", opção "${o.texto}"`, o);
    }
    if (!(p.opcoes || []).length) { conferir(`passo "${id}"`, p); }
  }
  if (erros.length) { return { erros }; }
  return { erros: [], fluxo: { inicio: ids[0], passos } };
}

/** Desenha o passo — mensagem + opções numeradas. */
export function desenhar(passo) {
  const linhas = [String(passo.mensagem || '').trim()];
  const ops = passo.opcoes || [];
  if (ops.length) {
    linhas.push('');
    ops.forEach((o, i) => linhas.push(`${o.tecla || i + 1} - ${o.texto}`));
    linhas.push('');
    linhas.push('Responda com o número da opção.');
  }
  return linhas.join('\n');
}

const acharPasso = (fluxo, id) => (fluxo.passos || []).find((p) => String(p.id).trim() === String(id).trim()) || null;

/** Entra num passo: devolve o que dizer e como fica o estado. */
function entrar(fluxo, passo) {
  const temOpcoes = (passo.opcoes || []).length > 0;
  const saida = { texto: desenhar(passo), passo: passo.id, acao: null, handoff: false };

  if (temOpcoes) { return saida; }

  // Passo sem opção: a ação dele manda.
  saida.acao = passo.acao || null;
  saida.departamento = passo.departamento || null;

  /* COLETAR e CONFIRMAR são a mesma mecânica: a pergunta sai agora e a RESPOSTA
     vem na próxima mensagem. Se não esperassem, o cliente responderia pro vazio —
     "me confirma seu nome" e o que ele digita cai no chão. */
  if (passo.acao === ACOES.COLETAR || passo.acao === ACOES.CONFIRMAR) {
    saida.coletando = true;
    return saida;
  }
  if (passo.vaiPara) {
    // Ação de passagem ("faça e siga"): executa e entra no próximo já.
    const prox = acharPasso(fluxo, passo.vaiPara);
    if (prox) {
      const seguinte = entrar(fluxo, prox);
      return { ...seguinte, texto: [saida.texto, seguinte.texto].filter(Boolean).join('\n\n'), acaoAnterior: passo.acao || null };
    }
  }
  saida.passo = null; // fim de galho
  saida.handoff = ENCERRA_COM_GENTE(passo.acao);
  return saida;
}

/**
 * Decide o próximo movimento.
 * @returns {{texto, passo, acao?, departamento?, handoff?, erroDeEscolha?, coleta?, coletando?}}
 */
export function avancar(fluxo, estado, texto) {
  const t = norm(texto);

  if (!estado?.passo || VOLTAR.includes(t)) {
    return entrar(fluxo, acharPasso(fluxo, fluxo.inicio));
  }

  const atual = acharPasso(fluxo, estado.passo);
  if (!atual) { return entrar(fluxo, acharPasso(fluxo, fluxo.inicio)); } // fluxo mudou embaixo da conversa

  /* A pessoa está respondendo uma pergunta aberta: o que ela escreveu É a
     resposta. Nada de interpretar como escolha de menu. */
  if (estado.coletando) {
    const prox = acharPasso(fluxo, atual.vaiPara);
    const coleta = { chave: atual.id, valor: String(texto ?? '').trim() };
    if (!prox) { return { texto: '', passo: null, acao: ACOES.FIM, coleta }; }
    return { ...entrar(fluxo, prox), coleta };
  }

  const ops = atual.opcoes || [];
  if (!ops.length) { return entrar(fluxo, atual); }

  /* Aceita o número, a tecla e o texto da opção — gente responde "já sou
     cliente" em vez de "1" o tempo todo, e recusar isso é fazer o cliente
     trabalhar pra falar com a gente. */
  const escolhida = ops.find((o, i) => {
    const tecla = String(o.tecla || i + 1);
    return t === norm(tecla) || t === norm(o.texto) || (norm(o.texto).length > 3 && t.length > 3 && norm(o.texto).includes(t));
  });

  if (!escolhida) {
    return { texto: `Não entendi a escolha.\n\n${desenhar(atual)}`, passo: atual.id, erroDeEscolha: true };
  }

  const fala = String(escolhida.resposta || '').trim();

  if (escolhida.vaiPara) {
    const prox = acharPasso(fluxo, escolhida.vaiPara);
    if (!prox) { return { texto: 'Desculpe, me perdi aqui. Vou chamar uma pessoa do time.', passo: null, acao: ACOES.ENCAMINHAR, handoff: true }; }
    const seguinte = entrar(fluxo, prox);
    return { ...seguinte, texto: [fala, seguinte.texto].filter(Boolean).join('\n\n'), acaoAnterior: escolhida.acao || null };
  }

  // Opção terminal.
  return {
    texto: fala,
    passo: null,
    acao: escolhida.acao || null,
    departamento: escolhida.departamento || null,
    handoff: ENCERRA_COM_GENTE(escolhida.acao),
  };
}
