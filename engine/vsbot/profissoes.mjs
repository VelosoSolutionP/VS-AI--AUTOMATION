/**
 * O atendente "profissional pronto" — o cliente escolhe nome, foto, PROFISSÃO e
 * JEITO; o resto é nosso (proposta do dono, 28/09: "só escolher nome, foto e
 * profissão, o resto nós fazemos pra ficar bem profissional").
 *
 * Função pura: profissão × jeito → a apresentação e as mensagens que decidem a
 * conversa. Nada de IA escrevendo pro cliente — a IA local só ENTENDE; o texto é
 * este, revisado, humano e com o nome do atendente e da loja.
 *
 * O que as melhores centrais fazem, e está aqui:
 *  - se apresentar com NOME e FUNÇÃO na primeira mensagem;
 *  - frase curta, UMA pergunta por vez, e o próximo passo sempre claro;
 *  - nunca "não entendi" seco: assumir a culpa e oferecer caminho;
 *  - ao passar pra uma pessoa, dizer QUE vai passar e o que acontece agora;
 *  - fora do horário, acolher e dizer quando volta.
 *
 * `montar()` não mexe no FLUXO (a árvore de opções). A árvore pronta da
 * profissão sai de `montarFluxo()`, mais abaixo, e só entra onde a loja não tem
 * fluxo — ou quando alguém manda trocar.
 */

export const PROFISSOES = Object.freeze({
  vendedora: { nome: 'Vendedora', papel: 'vendedora', foco: 'ajudar você a encontrar o produto certo e fechar seu pedido' },
  atendente: { nome: 'Atendente de loja', papel: 'atendente', foco: 'tirar suas dúvidas e te ajudar no que precisar' },
  recepcionista: { nome: 'Recepcionista', papel: 'recepcionista', foco: 'te receber e te levar pra pessoa certa da equipe' },
  consultor: { nome: 'Consultor técnico', papel: 'consultor técnico', foco: 'te ajudar a achar a peça ou a solução certa pro seu equipamento' },
  suporte: { nome: 'Suporte', papel: 'do suporte', foco: 'resolver o seu problema o quanto antes' },
});

export const JEITOS = Object.freeze({
  serio: { nome: 'Sério', descricao: 'profissional e direto, sem gírias nem emojis' },
  meio: { nome: 'Meio a meio', descricao: 'cordial e leve, com um emoji de vez em quando' },
  brincalhao: { nome: 'Brincalhão', descricao: 'descontraído, próximo, com emojis' },
});

/* Fora do horário o atendente fala de si, na primeira pessoa: o gênero do NOME
   não é conhecido, e "o Micaela continua daqui" soa errado. */

/**
 * @param {{nome:string, profissao:string, jeito:string, loja?:string}} p
 * @returns {{ok:true, config:object} | {ok:false, motivo:string}}
 */
export function montar({ nome, profissao, jeito, loja } = {}) {
  const n = String(nome || '').trim().slice(0, 40);
  const pf = PROFISSOES[profissao];
  const j = JEITOS[jeito] ? jeito : null;
  if (!n) { return { ok: false, motivo: 'dê um nome ao atendente' }; }
  if (!pf) { return { ok: false, motivo: 'escolha a profissão' }; }
  if (!j) { return { ok: false, motivo: 'escolha o jeito de falar' }; }
  /* "da equipe X": o gênero do nome da loja não é conhecido ("da Bolso Cheio"
     soa errado), e "equipe" serve pra qualquer um. */
  const lj = String(loja || '').trim();
  const eq = lj && lj !== 'nossa loja' ? `da equipe ${lj}` : 'da nossa equipe';
  const quem = pf.papel === 'do suporte' ? `${n}, do suporte ${eq}` : `${n}, ${pf.papel} ${eq}`;
  const T = {
    serio: {
      persona: `Você é ${quem}. Fale de forma profissional, educada e objetiva, em frases curtas, sem gírias e sem emojis. Seu papel é ${pf.foco}.`,
      saudacao: `Olá! Eu sou ${quem}. Estou aqui para ${pf.foco}. Como posso ajudar?`,
      mensagemFallback: 'Desculpe, acho que não consegui acompanhar. Pode me dizer de outro jeito? Se preferir, responda com o número de uma das opções.',
      mensagemHandoff: 'Vou chamar uma pessoa da nossa equipe para continuar o seu atendimento. Já deixei o que você me contou anotado, então não vai precisar repetir. Só um momento.',
      mensagemCatalogo: 'Estes são os produtos disponíveis no momento:',
      mensagemSemTexto: 'Recebi a sua mensagem. Para eu conseguir ajudar, pode me contar por escrito o que você precisa?',
      mensagemFechado: `Obrigado pelo contato! No momento estamos fora do horário de atendimento.\n\nNosso horário:\n{horario}\n\nAssim que voltarmos, eu continuo o seu atendimento daqui.`,
    },
    meio: {
      persona: `Você é ${quem}. Fale de forma cordial e leve, próxima do cliente, em frases curtas; use no máximo um emoji por mensagem. Seu papel é ${pf.foco}.`,
      saudacao: `Oi! Eu sou ${quem} 😊 Tô aqui pra ${pf.foco}. Me conta: como posso te ajudar?`,
      mensagemFallback: 'Opa, acho que me perdi aqui 😅 Pode me explicar de outro jeito? Se preferir, é só responder com o número de uma das opções.',
      mensagemHandoff: 'Vou chamar alguém da nossa equipe pra continuar com você. Já passei tudo o que você me contou, tá? Não precisa repetir nada. Um instante!',
      mensagemCatalogo: 'Olha o que temos disponível agora:',
      mensagemSemTexto: 'Recebi aqui! Pra eu te ajudar direitinho, me conta por escrito o que você precisa?',
      mensagemFechado: `Oi! Agora a gente está fora do horário 😴\n\nNosso horário:\n{horario}\n\nMe chama nesse horário que eu te atendo!`,
    },
    brincalhao: {
      persona: `Você é ${quem}. Fale de um jeito descontraído e próximo, bem humano, com emojis, sem perder a educação e sem exagerar. Seu papel é ${pf.foco}.`,
      saudacao: `Eeei, tudo certo? Aqui é ${quem} 🙌 Tô aqui pra ${pf.foco}. Manda aí: o que você precisa?`,
      mensagemFallback: 'Xiii, essa me pegou 🙈 Me explica de outro jeitinho? Ou, se quiser, responde com o número de uma das opções que eu te levo lá!',
      mensagemHandoff: 'Bora chamar reforço! 🚀 Já tô passando tudo pra alguém da equipe, você não vai precisar repetir nada. Segura aí só um minutinho!',
      mensagemCatalogo: 'Dá uma olhada no que tem aqui fresquinho pra você 👇',
      mensagemSemTexto: 'Chegou aqui! 😄 Mas me conta por escrito o que você precisa, que eu resolvo rapidinho?',
      mensagemFechado: `Opa! A gente deu uma pausa agora 😴\n\nNosso horário:\n{horario}\n\nVolta nesse horário que eu te atendo com tudo! 💪`,
    },
  }[j];
  return { ok: true, config: { nome: n, profissao, jeito: j, ...T } };
}

/* ---------------- o fluxo pronto de cada profissão ----------------
   "Só escolher nome, foto e profissão, o resto nós fazemos": o resto inclui a
   árvore de opções. Quem não tem planilha de fluxo recebe uma pronta, da
   profissão escolhida, falando no jeito escolhido.

   O CATÁLOGO é o do próprio cliente: o galho de produtos é um passo por
   CATEGORIA do Estoque (`categoria` em fluxo.mjs), montado a cada mensagem com
   o que está ativo e com o preço vigente. Trocar preço, esgotar ou cadastrar
   produto numa categoria que já existe vale na hora, sem gerar o fluxo de novo.

   Nada aqui cobra: sem gateway, "cobrar" responde "pode pagar na entrega?", o
   que não serve pra quem vende sistema ou serviço. O pedido vai montado pra
   uma pessoa fechar valor e pagamento. */

const FALAS = {
  serio: {
    oQue: 'Como posso ajudar? Escolha uma opção:',
    tipo: 'Qual tipo de produto você procura?',
    escolha: 'Escolha o produto:',
    mais: 'Anotado. Deseja mais alguma coisa?',
    nome: 'Para fechar o pedido, qual é o seu nome completo?',
    fechar: 'Pedido anotado. Uma pessoa da nossa equipe vai confirmar com você o valor final e a forma de pagamento. Só um momento.',
    conta: 'Pode me contar, em uma mensagem, o que você precisa? Assim a pessoa que vai te atender já chega sabendo.',
    chamar: 'Obrigado. Já estou passando para uma pessoa da nossa equipe, com tudo o que você me contou. Só um momento.',
    nomeRecepcao: 'Para começar, como posso chamar você?',
    assunto: 'Obrigado. Qual é o assunto, para eu encaminhar você à pessoa certa?',
    equipamento: 'Qual é o equipamento? Informe marca e modelo, se souber.',
    problema: 'Qual é o problema?',
  },
  meio: {
    oQue: 'Me diz o que você quer fazer:',
    tipo: 'Que tipo de produto você procura?',
    escolha: 'Escolhe o produto:',
    mais: 'Anotado! 😊 Quer mais alguma coisa?',
    nome: 'Pra fechar, me diz seu nome completo?',
    fechar: 'Pedido anotado! Alguém da nossa equipe já vai confirmar com você o valor e a forma de pagamento. Um instante!',
    conta: 'Me conta numa mensagem o que você precisa? Assim quem for te atender já chega sabendo.',
    chamar: 'Valeu! Já tô passando pra alguém da equipe, com tudo o que você me contou. Um instante!',
    nomeRecepcao: 'Pra começar, como posso te chamar?',
    assunto: 'Prazer! Qual é o assunto, pra eu te levar pra pessoa certa?',
    equipamento: 'Qual é o equipamento? Me passa marca e modelo, se souber.',
    problema: 'O que está acontecendo?',
  },
  brincalhao: {
    oQue: 'Bora lá, escolhe aí:',
    tipo: 'Que tipo de coisa você tá procurando? 👀',
    escolha: 'Escolhe o seu 👇',
    mais: 'Anotadíssimo! ✅ Vai mais alguma coisa?',
    nome: 'Pra fechar com chave de ouro: qual o seu nome completo? 😄',
    fechar: 'Pedido anotado! 🎉 Já chamei alguém da equipe pra confirmar o valor e o pagamento com você. Segura aí um minutinho!',
    conta: 'Me conta numa mensagem o que você precisa? Assim quem for te atender já chega por dentro 😉',
    chamar: 'Show! 🚀 Já tô passando pra alguém da equipe, com tudo que você me contou. Segura aí um minutinho!',
    nomeRecepcao: 'Pra começar: como posso te chamar? 😄',
    assunto: 'Prazer! 🙌 Qual é o assunto, pra eu te levar pra pessoa certa?',
    equipamento: 'Qual é o equipamento? Me passa marca e modelo, se souber 🔧',
    problema: 'Me conta, o que tá pegando? 🛠️',
  },
};

/** As categorias do Estoque que viram menu (na ordem em que aparecem). */
export function categoriasDoEstoque(produtos = []) {
  const vistas = new Map();
  for (const p of produtos || []) {
    const c = String(p?.categoria || '').trim();
    if (c && !vistas.has(c.toLowerCase())) { vistas.set(c.toLowerCase(), c); }
  }
  return [...vistas.values()];
}

/**
 * O galho de produtos: um menu por categoria do Estoque (uma categoria só vai
 * direto pros produtos). Sem categoria nenhuma, cai na vitrine (ação catálogo).
 */
function galhoProdutos(F, produtos) {
  const cats = categoriasDoEstoque(produtos);
  const voltar = { texto: 'Voltar ao início', vaiPara: 'inicio' };
  if (!cats.length) {
    return { entrada: 'vitrine', passos: [
      { id: 'vitrine', mensagem: F.escolha, acao: 'catalogo', vaiPara: 'vitrine-conta' },
      ...contarEPassar(F, 'vitrine-conta', 'vendas'),
    ] };
  }
  const porCat = cats.map((c, i) => ({ id: `cat-${i + 1}`, mensagem: cats.length > 1 ? `*${c}* — ${F.escolha}` : F.escolha, categoria: c, vaiPara: 'mais', opcoes: [voltar] }));
  if (cats.length === 1) { return { entrada: porCat[0].id, passos: porCat }; }
  return { entrada: 'produtos', passos: [
    { id: 'produtos', mensagem: F.tipo, opcoes: [...cats.map((c, i) => ({ texto: c, vaiPara: `cat-${i + 1}` })), voltar] },
    ...porCat,
  ] };
}

/* Pedir o que a pessoa precisa e passar pra gente: a triagem de sempre. */
function contarEPassar(F, id, departamento) {
  return [
    { id, mensagem: F.conta, acao: 'coletar', vaiPara: `${id}-gente` },
    { id: `${id}-gente`, mensagem: F.chamar, acao: 'encaminhar', departamento },
  ];
}

/**
 * A árvore pronta da profissão, no jeito escolhido, com o catálogo da loja.
 * O primeiro passo abre com a saudação de `montar()` — com fluxo, é ela que o
 * cliente vê no "oi".
 * @param {{nome, profissao, jeito, loja?, produtos?}} p
 * @returns {{ok:true, passos:object[], categorias:string[]} | {ok:false, motivo:string}}
 */
export function montarFluxo({ nome, profissao, jeito, loja, produtos = [] } = {}) {
  const m = montar({ nome, profissao, jeito, loja });
  if (!m.ok) { return m; }
  const F = FALAS[m.config.jeito];
  /* A saudação termina numa pergunta aberta ("Como posso ajudar?"); no fluxo,
     quem pergunta é o menu logo abaixo — sem cortar, sairia a pergunta duas vezes. */
  const abre = `${m.config.saudacao.replace(/\s*[^.!?]*\?$/, '')}\n\n`;
  const gente = { id: 'gente', mensagem: m.config.mensagemHandoff, acao: 'encaminhar', departamento: 'atendimento' };
  const pessoa = { texto: 'Falar com uma pessoa', vaiPara: 'gente', termos: ['atendente', 'humano', 'pessoa', 'alguem'] };
  const prod = galhoProdutos(F, produtos);
  const produtosOp = (texto) => ({ texto, vaiPara: prod.entrada, termos: ['produto', 'preco', 'valor', 'catalogo', 'comprar', 'quanto custa'] });
  /* Escolheu um produto: ele já está no carrinho (fluxo.mjs). Daqui fecha com
     o nome e vai pra uma pessoa confirmar valor e pagamento. */
  const loja_ = [
    ...prod.passos,
    { id: 'mais', mensagem: F.mais, opcoes: [
      { texto: 'Fechar o pedido', vaiPara: 'nome', termos: ['fechar', 'finalizar', 'so isso', 'pronto'] },
      { texto: 'Escolher mais um produto', vaiPara: prod.entrada, termos: ['mais', 'outro', 'tambem'] },
      pessoa,
    ] },
    { id: 'nome', mensagem: F.nome, acao: 'coletar', vaiPara: 'fechar' },
    { id: 'fechar', mensagem: F.fechar, acao: 'encaminhar', departamento: 'vendas' },
  ];

  let passos;
  switch (m.config.profissao) {
    case 'vendedora':
      passos = [
        { id: 'inicio', mensagem: abre + F.oQue, opcoes: [produtosOp('Ver os produtos e preços'),
          { texto: 'Tirar uma dúvida', vaiPara: 'duvida', termos: ['duvida', 'pergunta', 'saber'] }, pessoa] },
        ...loja_, ...contarEPassar(F, 'duvida', 'vendas'), gente,
      ];
      break;
    case 'atendente':
      passos = [
        { id: 'inicio', mensagem: abre + F.oQue, opcoes: [produtosOp('Ver os produtos e preços'),
          { texto: 'Acompanhar um pedido', vaiPara: 'pedido', termos: ['pedido', 'entrega', 'chegou', 'rastrear'] },
          { texto: 'Tirar uma dúvida', vaiPara: 'duvida', termos: ['duvida', 'pergunta', 'saber'] }, pessoa] },
        ...loja_, ...contarEPassar(F, 'pedido', 'atendimento'), ...contarEPassar(F, 'duvida', 'atendimento'), gente,
      ];
      break;
    case 'recepcionista':
      passos = [
        { id: 'inicio', mensagem: abre + F.nomeRecepcao, acao: 'coletar', vaiPara: 'assunto' },
        { id: 'assunto', mensagem: F.assunto, opcoes: [
          { texto: 'Comprar ou pedir orçamento', vaiPara: 'vendas', termos: ['comprar', 'orcamento', 'preco', 'valor'] },
          { texto: 'Financeiro (boleto, pagamento)', vaiPara: 'financeiro', termos: ['boleto', 'pagamento', 'pix', 'nota', 'fatura'] },
          { texto: 'Suporte ou problema', vaiPara: 'suporte', termos: ['problema', 'erro', 'travou', 'defeito'] },
          { texto: 'Outro assunto', vaiPara: 'outro' },
        ] },
        ...contarEPassar(F, 'vendas', 'vendas'), ...contarEPassar(F, 'financeiro', 'financeiro'),
        ...contarEPassar(F, 'suporte', 'suporte'), ...contarEPassar(F, 'outro', 'atendimento'),
      ];
      break;
    case 'consultor':
      passos = [
        { id: 'inicio', mensagem: abre + F.oQue, opcoes: [
          { texto: 'Procurar uma peça ou produto', vaiPara: 'equipamento', termos: ['peca', 'produto', 'procuro', 'preco'] },
          { texto: 'Pedir um orçamento', vaiPara: 'orcamento', termos: ['orcamento', 'cotacao', 'quanto fica'] },
          { texto: 'Tirar uma dúvida técnica', vaiPara: 'tecnica', termos: ['duvida', 'instalar', 'compativel'] },
          pessoa] },
        { id: 'equipamento', mensagem: F.equipamento, acao: 'coletar', vaiPara: prod.entrada },
        ...loja_, ...contarEPassar(F, 'orcamento', 'vendas'), ...contarEPassar(F, 'tecnica', 'suporte'), gente,
      ];
      break;
    default: // suporte
      passos = [
        { id: 'inicio', mensagem: abre + F.problema, opcoes: [
          { texto: 'Não consigo entrar ou acessar', vaiPara: 'acesso', termos: ['senha', 'login', 'entrar', 'acessar', 'bloqueado'] },
          { texto: 'Algo parou ou deu erro', vaiPara: 'erro', termos: ['erro', 'travou', 'parou', 'bug', 'caiu'] },
          { texto: 'Dúvida de como usar', vaiPara: 'uso', termos: ['como', 'duvida', 'usar', 'configurar'] },
          { texto: 'Pagamento ou cobrança', vaiPara: 'cobranca', termos: ['boleto', 'pagamento', 'cobranca', 'fatura', 'pix'] },
          pessoa] },
        ...contarEPassar(F, 'acesso', 'suporte'), ...contarEPassar(F, 'erro', 'suporte'),
        ...contarEPassar(F, 'uso', 'suporte'), ...contarEPassar(F, 'cobranca', 'financeiro'), gente,
      ];
  }
  return { ok: true, passos, categorias: categoriasDoEstoque(produtos) };
}
