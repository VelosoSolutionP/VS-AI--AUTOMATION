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
  COBRAR: 'cobrar',         // pede uma cobrança de verdade ao gateway e manda o link
  NOTA: 'nota',             // marca algo no contexto e segue (sem efeito externo)
  FIM: 'fim',               // encerra sem chamar ninguém
});

import { entender, entenderNoFluxo } from './entender.mjs';

const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const VOLTAR = ['menu', 'voltar', 'inicio', 'começar', 'comecar', 'recomecar', 'recomeçar'];

/* Abrir conversa nao e escolher opcao. Sem isso, "oi", "bom dia" e "opa" viram
   erro de digitacao aos olhos do fluxo. */
const SAUDACAO = /^(oi+|ola|eai+|e ai|eae|opa|opah|bom dia|boa tarde|boa noite|alo+|hey|hi|hello|tudo bem|tudo bom|boa)\b/;
const ehSaudacao = (t) => SAUDACAO.test(norm(t));

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
  /* Existe preço em ALGUM lugar da árvore? Se existe, o passo de cobrança pode
     tirar o valor do carrinho; se não existe nenhum, ele não teria de onde. */
  const temPreco = passos.some((p) => (p.opcoes || []).some((o) => o.valorCentavos != null || o.sku) || p.valorCentavos != null);
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
    /* Cobrar sem saber quanto so poderia gerar link de R$ 0 — e o dono so
       descobriria pelo extrato vazio. Melhor recusar a planilha. */
    if (o.acao === ACOES.COBRAR && o.valorCentavos == null && !temPreco) {
      erros.push(`${onde}: "cobrar" precisa de um valor (coluna valor) ou de alguma opção com preço antes dele — do jeito que está, o link sairia de R$ 0,00`);
    }
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

export const emReais = (c) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;

/**
 * Preço da árvore vem do CATÁLOGO, não da planilha.
 *
 * Preço cravado no CSV envelhece calado: o dono sobe o X-Tudo pra R$ 32 no
 * catálogo e a Mica continua vendendo por R$ 28 — a diferença sai do bolso dele,
 * e ninguém percebe até fechar o mês. Opção com `sku` passa a valer o preço
 * vigente (com promoção, se houver) no instante do pedido.
 *
 * Quem não tem `sku` continua com o valor da planilha: taxa de entrega, serviço,
 * qualquer coisa que não seja item de estoque.
 */
export function comPrecosDoCatalogo(fluxo, produtos = []) {
  if (!fluxo?.passos) { return fluxo; }
  const porSku = new Map((produtos || []).map((p) => [String(p.sku).trim(), p]));
  const resolver = (o) => {
    const sku = String(o.sku || '').trim();
    if (!sku) { return o; }
    const p = porSku.get(sku);
    /* SKU que não existe no catálogo NÃO vira item de graça: vira indisponível.
       O erro fica visível pra quem cuida do fluxo em vez de virar prejuízo. */
    if (!p) { return { ...o, indisponivel: true, motivoIndisponivel: 'fora do catálogo' }; }
    if (p.esgotado) { return { ...o, texto: o.texto || p.nome, indisponivel: true, motivoIndisponivel: 'esgotado' }; }
    return { ...o, texto: o.texto || p.nome, valorCentavos: p.precoCentavos ?? o.valorCentavos ?? null };
  };
  return { ...fluxo, passos: fluxo.passos.map((passo) => ({ ...passo, opcoes: (passo.opcoes || []).map(resolver) })) };
}

/** Desenha o passo — mensagem + opções numeradas. */
export function desenhar(passo) {
  const linhas = [String(passo.mensagem || '').trim()];
  const ops = passo.opcoes || [];
  if (ops.length) {
    linhas.push('');
    /* Preço ao lado da opção: é assim que o cliente decide sem perguntar, e é
       exatamente o que dispensa chamar alguém pra dizer quanto custa. */
    /* Item indisponível continua NA LISTA, dizendo que acabou. Sumir com ele faz
       o cliente perguntar "cadê o X-Tudo?" — e aí precisa de gente pra responder
       o que a própria lista podia ter dito. */
    ops.forEach((o, i) => linhas.push(`${o.tecla || i + 1} - ${o.texto}${o.indisponivel
      ? ` — ${o.motivoIndisponivel === 'esgotado' ? 'esgotado hoje' : 'indisponível'}`
      : (o.valorCentavos ? ` — ${emReais(o.valorCentavos)}` : '')}`));
    linhas.push('');
    linhas.push('Responda com o número da opção.');
  }
  return linhas.join('\n');
}

const acharPasso = (fluxo, id) => (fluxo.passos || []).find((p) => String(p.id).trim() === String(id).trim()) || null;

/**
 * Preço escrito por gente vira centavos.
 *
 * Na planilha da lanchonete o preço aparece como "39,90", "R$ 39,90", "39.90" ou
 * só "39". Ler isso com `Number()` dava NaN em metade dos casos — e cobrança com
 * valor errado é pior que cobrança que não sai.
 */
export function valorEmCentavos(bruto) {
  if (bruto == null || bruto === '') { return null; }
  if (typeof bruto === 'number') { return Number.isFinite(bruto) ? Math.round(bruto * 100) : null; }
  const limpo = String(bruto).replace(/r\$/i, '').replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const n = Number(limpo);
  if (!Number.isFinite(n) || n <= 0) { return null; }
  return Math.round(n * 100);
}

/** Entra num passo: devolve o que dizer e como fica o estado. */
function entrar(fluxo, passo) {
  const temOpcoes = (passo.opcoes || []).length > 0;
  const saida = { texto: desenhar(passo), passo: passo.id, acao: null, handoff: false };

  if (temOpcoes) { return saida; }

  // Passo sem opção: a ação dele manda.
  saida.acao = passo.acao || null;
  saida.departamento = passo.departamento || null;
  if (passo.valorCentavos != null) { saida.valorCentavos = passo.valorCentavos; }

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

  /* Escolher o que acabou não pode virar pedido: sem isto o item entraria no
     carrinho por R$ 0 e a cozinha receberia algo que não tem. */
  if (escolhida?.indisponivel) {
    return {
      texto: `Poxa, ${escolhida.texto} ${escolhida.motivoIndisponivel === 'esgotado' ? 'acabou hoje' : 'não está disponível'}. 😕\n\nEscolhe outro:\n\n${desenhar(atual)}`,
      passo: atual.id,
      indisponivel: true,
    };
  }

  if (!escolhida) {
    /* Quem chega dizendo "oi" nao errou escolha nenhuma — nao viu menu nenhum.
       A conversa fica gravada no passo em que parou, entao o "oi" de HOJE era
       lido como resposta errada ao menu de ONTEM, e a primeira frase que o
       cliente ouvia era uma bronca. Saudacao reabre o passo, calada. */
    /* Ninguem escreve "1" no WhatsApp. Escreve "meu boleto venceu". A arvore
       continua mandando no encaminhamento — o que muda e que a pessoa nao
       precisa mais percorre-la tecla por tecla pra chegar onde ja disse que
       queria na primeira frase. */
    const palpite = entender(texto, ops);
    if (palpite.escolhida) { return seguir(fluxo, palpite.escolhida); }

    /* Empate nao vira escolha. Mandar pro departamento errado com cara de
       certeza faz o cliente contar o problema duas vezes — pior que perguntar. */
    if (palpite.empate) {
      const so = { ...atual, mensagem: 'Só pra eu não te mandar pro lugar errado:', opcoes: palpite.empate };
      return { texto: desenhar(so), passo: atual.id, desambiguando: true };
    }

    /* Ainda no comeco da conversa? Entao procura o assunto na arvore INTEIRA.
       Quem escreve "o sistema travou" nao tem como saber que Suporte mora
       dentro de "Ja sou cliente" — e nao deveria precisar saber. */
    /* Vale em QUALQUER menu, nao so no inicial. Em campo: a pessoa estava no
       menu do financeiro, escreveu "o sistema travou e nao consigo entrar", e
       ouviu "nao achei isso nas opcoes" — ela tinha mudado de assunto, e mudar
       de assunto e direito de quem esta conversando.

       O que continua proibido e saltar enquanto a pergunta e ABERTA: ali o que
       ela escreve e a RESPOSTA, e trocar o assunto na cara dela seria jogar
       fora o que acabou de contar. Esse caso nem chega aqui — passo que coleta
       nao tem opcoes. */
    if (ops.length) {
      const salto = entenderNoFluxo(texto, fluxo, { ignorar: atual.id });
      if (salto.opcao) { return { ...seguir(fluxo, salto.opcao), saltou: true }; }
      if (salto.passo) { return { ...entrar(fluxo, salto.passo), saltou: true }; }
    }

    /* A saudacao e conferida DEPOIS de tentar entender, de proposito: "oi,
       minha fatura venceu" comeca com "oi" e nao e uma saudacao — e um pedido
       com educacao na frente. Conferir antes jogava fora a frase inteira e
       devolvia o menu pra quem ja tinha dito do que precisava. */
    if (ehSaudacao(texto)) { return entrar(fluxo, atual); }

    /* "Nao entendi a escolha" poe a culpa em quem escreveu. Quem nao entendeu
       fui eu, e o que resolve nao e a bronca — e a lista.

       E REPETIR O QUE A PESSOA ESCREVEU muda tudo: em campo, alguem respondeu
       o NOME DA EMPRESA num menu e recebeu de volta uma frase generica. Sem ver
       a propria resposta citada, ela nao entende se a mensagem chegou torta, se
       o bot travou, ou se ela e que fez besteira — e tenta de novo igual. */
    const dito = String(texto ?? '').replace(/\s+/g, ' ').trim();
    const eco = dito && dito.length <= 60 ? `Não achei "${dito}" nas opções. ` : '';
    return {
      texto: `${eco}Me ajuda a te levar pro lugar certo — responda com o número de uma das opções:\n\n${desenhar(atual)}`,
      passo: atual.id,
      erroDeEscolha: true,
    };
  }

  return seguir(fluxo, escolhida);
}

/** Levar a conversa pela opção escolhida — por tecla, por texto ou por entendimento. */
function seguir(fluxo, escolhida) {
  const fala = String(escolhida.resposta || '').trim();
  /* Escolher um item com preço É pedir aquele item. O carrinho nasce daqui, e
     não de adivinhar preço no texto livre depois. */
  const item = escolhida.valorCentavos
    ? { nome: escolhida.texto, valorCentavos: escolhida.valorCentavos }
    : null;

  if (escolhida.vaiPara) {
    const prox = acharPasso(fluxo, escolhida.vaiPara);
    if (!prox) { return { texto: 'Desculpe, me perdi aqui. Vou chamar uma pessoa do time.', passo: null, acao: ACOES.ENCAMINHAR, handoff: true }; }
    const seguinte = entrar(fluxo, prox);
    return { ...seguinte, ...(item ? { item } : {}), texto: [fala, seguinte.texto].filter(Boolean).join('\n\n'), acaoAnterior: escolhida.acao || null };
  }

  // Opção terminal.
  return {
    texto: fala,
    passo: null,
    acao: escolhida.acao || null,
    departamento: escolhida.departamento || null,
    ...(item ? { item } : {}),
    handoff: ENCERRA_COM_GENTE(escolhida.acao),
  };
}
