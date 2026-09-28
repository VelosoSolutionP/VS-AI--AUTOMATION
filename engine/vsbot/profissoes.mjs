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
 *  - se apresentar com NOME e FUNÇÃO na primeira mensagem, com bom dia / boa
 *    tarde / boa noite pela hora ({cumprimento}, trocado na hora do envio);
 *  - frase curta, UMA pergunta por vez, e o próximo passo sempre claro;
 *  - cada profissão pergunta o que ELA precisa saber: a vendedora quer saber o
 *    que a pessoa procura, o suporte quer o problema e o número do pedido, a
 *    recepcionista quer o assunto pra encaminhar;
 *  - nunca "não entendi" seco: assumir a culpa e oferecer caminho — sem citar
 *    "opções" (o "não entendi" daqui só vale na loja SEM fluxo, onde não há);
 *  - ao passar pra uma pessoa, dizer QUE vai passar e o que acontece agora;
 *  - fora do horário, acolher e dizer quando volta.
 *
 * Não mexe no FLUXO (a árvore de opções): esse é da loja e continua o mesmo.
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

/* O que cada profissão fala, em cada jeito. `pergunta` fecha a saudação; o
   resto é o texto inteiro da situação. Sério: nenhum emoji (o teste segura). */
const FALAS = {
  vendedora: {
    como: 'Descubra o que a pessoa procura e pra que vai usar, mostre as opções do catálogo e conduza até o pedido, sem empurrar.',
    serio: {
      pergunta: 'O que você está procurando hoje?',
      fallback: 'Desculpe, não consegui entender qual produto você procura. Pode me dizer o nome dele ou para que vai usar? Assim eu te mostro as opções certas.',
      handoff: 'Vou chamar uma pessoa da nossa equipe de vendas para fechar com você. Já deixei anotado o que você quer, então não vai precisar repetir. Só um momento.',
      catalogo: 'Separei os produtos que temos disponíveis agora:',
      semTexto: 'Recebi a sua mensagem. Para eu te mostrar as opções certas, pode me escrever o nome do produto ou para que você precisa?',
    },
    meio: {
      pergunta: 'Me conta: o que você está procurando hoje?',
      fallback: 'Opa, não peguei qual produto você quer 😅 Me diz o nome ou pra que vai usar, que eu te mostro as opções!',
      handoff: 'Vou chamar alguém da equipe de vendas pra fechar com você. Já passei o que você quer, tá? Não precisa repetir nada. Um instante!',
      catalogo: 'Separei pra você o que tem disponível agora:',
      semTexto: 'Recebi aqui! Me escreve o nome do produto ou pra que você precisa, que eu já te mostro as opções?',
    },
    brincalhao: {
      pergunta: 'Manda aí: o que você tá procurando hoje? 🛍️',
      fallback: 'Xiii, essa me pegou 🙈 Me fala o nome do produto ou pra que vai usar, que eu garimpo as opções pra você!',
      handoff: 'Bora fechar esse pedido! 🚀 Tô chamando alguém da equipe de vendas e já passei tudo, você não vai precisar repetir nada. Segura aí só um minutinho!',
      catalogo: 'Olha só o que tem aqui fresquinho pra você 👇',
      semTexto: 'Chegou aqui! 😄 Me escreve o nome do produto ou pra que você precisa, que eu separo as opções rapidinho?',
    },
  },
  atendente: {
    como: 'Entenda a dúvida da pessoa, responda com clareza e, se não souber, diga que vai chamar alguém da equipe.',
    serio: {
      pergunta: 'Em que posso ajudar?',
      fallback: 'Desculpe, não consegui entender. Pode me contar com outras palavras? Se preferir, chamo uma pessoa da equipe.',
      handoff: 'Vou chamar uma pessoa da nossa equipe para continuar o seu atendimento. Já deixei o que você me contou anotado, então não vai precisar repetir. Só um momento.',
      catalogo: 'Estes são os produtos disponíveis no momento:',
      semTexto: 'Recebi a sua mensagem. Para eu conseguir ajudar, pode me contar por escrito o que você precisa?',
    },
    meio: {
      pergunta: 'Me conta: como posso te ajudar?',
      fallback: 'Opa, acho que me perdi aqui 😅 Pode me explicar de outro jeito? Se preferir, chamo alguém da equipe.',
      handoff: 'Vou chamar alguém da nossa equipe pra continuar com você. Já passei tudo o que você me contou, tá? Não precisa repetir nada. Um instante!',
      catalogo: 'Olha o que temos disponível agora:',
      semTexto: 'Recebi aqui! Pra eu te ajudar direitinho, me conta por escrito o que você precisa?',
    },
    brincalhao: {
      pergunta: 'Manda aí: o que você precisa? 😄',
      fallback: 'Xiii, essa me pegou 🙈 Me explica de outro jeitinho? Ou, se quiser, eu chamo alguém da equipe!',
      handoff: 'Bora chamar reforço! 🚀 Já tô passando tudo pra alguém da equipe, você não vai precisar repetir nada. Segura aí só um minutinho!',
      catalogo: 'Dá uma olhada no que tem aqui pra você 👇',
      semTexto: 'Chegou aqui! 😄 Mas me conta por escrito o que você precisa, que eu resolvo rapidinho?',
    },
  },
  recepcionista: {
    como: 'Receba bem, descubra o assunto ou com quem a pessoa quer falar e encaminhe pra pessoa certa da equipe.',
    serio: {
      pergunta: 'Qual é o assunto, ou com quem você gostaria de falar?',
      fallback: 'Desculpe, não consegui entender. Pode me dizer o assunto em poucas palavras? Assim eu te encaminho para a pessoa certa.',
      handoff: 'Vou te encaminhar para a pessoa responsável. Ela já vai receber o que você me contou, então não vai precisar repetir. Só um momento.',
      catalogo: 'Estes são os produtos e serviços disponíveis no momento:',
      semTexto: 'Recebi a sua mensagem. Para eu te encaminhar para a pessoa certa, pode me escrever o assunto?',
    },
    meio: {
      pergunta: 'Me conta qual é o assunto, ou com quem você quer falar?',
      fallback: 'Opa, não peguei o assunto 😅 Me diz em poucas palavras, que eu te levo pra pessoa certa!',
      handoff: 'Já vou te passar pra pessoa responsável. Ela recebe tudo o que você me contou, tá? Não precisa repetir nada. Um instante!',
      catalogo: 'Olha o que temos disponível agora:',
      semTexto: 'Recebi aqui! Me escreve o assunto, que eu já te encaminho pra pessoa certa?',
    },
    brincalhao: {
      pergunta: 'Me conta: qual é o assunto, ou quem você quer encontrar por aqui? 😉',
      fallback: 'Xiii, essa me pegou 🙈 Me diz o assunto em poucas palavras, que eu te levo direitinho pra pessoa certa!',
      handoff: 'Deixa comigo! 🚀 Tô te levando pra pessoa responsável e já passei tudo, você não vai precisar repetir nada. Segura aí só um minutinho!',
      catalogo: 'Dá uma olhada no que tem aqui pra você 👇',
      semTexto: 'Chegou aqui! 😄 Me escreve o assunto, que eu te encaminho rapidinho?',
    },
  },
  consultor: {
    como: 'Pergunte o equipamento (marca e modelo) e o que a pessoa precisa, indique a peça ou a solução certa e, na dúvida técnica, chame um técnico da equipe.',
    serio: {
      pergunta: 'Qual é o equipamento (marca e modelo) e do que você precisa?',
      fallback: 'Desculpe, não consegui entender. Para eu achar a peça certa, pode me dizer a marca e o modelo do equipamento? Se tiver o código da peça, ajuda também.',
      handoff: 'Vou chamar um técnico da nossa equipe para te ajudar. Ele já vai receber o que você me contou sobre o equipamento, então não vai precisar repetir. Só um momento.',
      catalogo: 'Estas são as peças e produtos disponíveis no momento:',
      semTexto: 'Recebi a sua mensagem. Para eu achar a peça certa, pode me escrever a marca e o modelo do equipamento?',
    },
    meio: {
      pergunta: 'Me conta: qual é o equipamento (marca e modelo) e do que você precisa?',
      fallback: 'Opa, não peguei 😅 Me diz a marca e o modelo do equipamento — se tiver o código da peça, melhor ainda — que eu acho a certa pra você!',
      handoff: 'Vou chamar um técnico da equipe pra te ajudar. Já passei tudo sobre o seu equipamento, tá? Não precisa repetir nada. Um instante!',
      catalogo: 'Olha as peças e produtos que temos agora:',
      semTexto: 'Recebi aqui! Me escreve a marca e o modelo do equipamento, que eu acho a peça certa?',
    },
    brincalhao: {
      pergunta: 'Manda aí: qual é a máquina (marca e modelo) e o que ela tá precisando? 🔧',
      fallback: 'Xiii, essa me pegou 🙈 Me fala a marca e o modelo do equipamento — com o código da peça, então, é tiro certo!',
      handoff: 'Chamando o time técnico! 🚀 Já passei tudo sobre o seu equipamento, você não vai precisar repetir nada. Segura aí só um minutinho!',
      catalogo: 'Olha só as peças que tem aqui pra você 👇',
      semTexto: 'Chegou aqui! 😄 Me escreve a marca e o modelo do equipamento, que eu acho a peça rapidinho?',
    },
  },
  suporte: {
    como: 'Acolha o problema sem culpar a pessoa, peça o que falta pra resolver (o que aconteceu e o número do pedido) e, se não resolver, passe o caso pra equipe.',
    serio: {
      pergunta: 'Pode me contar o que aconteceu? Se tiver o número do pedido, já me envie junto.',
      fallback: 'Desculpe, não consegui entender. Pode me descrever o problema com outras palavras? Se tiver o número do pedido, ajuda a resolver mais rápido.',
      handoff: 'Vou passar o seu caso para uma pessoa do suporte. Ela já vai receber tudo o que você me contou, então não vai precisar repetir. Só um momento.',
      catalogo: 'Estes são os produtos disponíveis no momento:',
      semTexto: 'Recebi a sua mensagem. Para eu resolver, pode me escrever o que aconteceu e, se tiver, o número do pedido?',
    },
    meio: {
      pergunta: 'Me conta o que aconteceu? Se tiver o número do pedido, já manda junto.',
      fallback: 'Poxa, não consegui entender direitinho 😅 Me descreve o problema de outro jeito? Com o número do pedido eu resolvo mais rápido.',
      handoff: 'Vou passar o seu caso pra alguém do suporte. Já contei tudo o que você me disse, tá? Não precisa repetir nada. Um instante!',
      catalogo: 'Olha o que temos disponível agora:',
      semTexto: 'Recebi aqui! Me escreve o que aconteceu e, se tiver, o número do pedido?',
    },
    brincalhao: {
      pergunta: 'Me conta o que rolou? Se tiver o número do pedido, manda junto que agiliza 😉',
      fallback: 'Xiii, essa me pegou 🙈 Me explica o problema de outro jeitinho? Com o número do pedido, eu resolvo voando!',
      handoff: 'Chamando reforço! 🚀 Tô passando o seu caso pra alguém do suporte, com tudo o que você me contou. Segura aí só um minutinho!',
      catalogo: 'Dá uma olhada no que tem aqui pra você 👇',
      semTexto: 'Chegou aqui! 😄 Me escreve o que aconteceu e o número do pedido, se tiver, que eu resolvo rapidinho?',
    },
  },
};

const artigo = (papel) => (/^(vendedora|recepcionista)$/.test(papel) ? 'a' : 'o');

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
  const f = FALAS[profissao][j];
  const como = FALAS[profissao].como;
  const T = {
    serio: {
      persona: `Você é ${quem}. Fale de forma profissional, educada e objetiva, em frases curtas, sem gírias e sem emojis. Seu papel é ${pf.foco}. ${como}`,
      saudacao: `{cumprimento}! Eu sou ${quem}. ${f.pergunta}`,
      mensagemFechado: `Obrigado pelo contato! No momento estamos fora do horário de atendimento.\n\nNosso horário:\n{horario}\n\nAssim que voltarmos, ${artigo(pf.papel)} ${n} continua daqui.`,
    },
    meio: {
      persona: `Você é ${quem}. Fale de forma cordial e leve, próxima do cliente, em frases curtas; use no máximo um emoji por mensagem. Seu papel é ${pf.foco}. ${como}`,
      saudacao: `{cumprimento}! Eu sou ${quem} 😊 ${f.pergunta}`,
      mensagemFechado: `Oi! Agora a gente está fora do horário 😴\n\nNosso horário:\n{horario}\n\nMe chama nesse horário que ${artigo(pf.papel)} ${n} te atende!`,
    },
    brincalhao: {
      persona: `Você é ${quem}. Fale de um jeito descontraído e próximo, bem humano, com emojis, sem perder a educação e sem exagerar. Seu papel é ${pf.foco}. ${como}`,
      saudacao: `{cumprimento}! Tudo certo? Aqui é ${quem} 🙌 ${f.pergunta}`,
      mensagemFechado: `Opa! A gente deu uma pausa agora 😴\n\nNosso horário:\n{horario}\n\nVolta nesse horário que ${artigo(pf.papel)} ${n} te atende com tudo! 💪`,
    },
  }[j];
  return {
    ok: true,
    config: {
      nome: n, profissao, jeito: j, ...T,
      mensagemFallback: f.fallback,
      mensagemHandoff: f.handoff,
      mensagemCatalogo: f.catalogo,
      mensagemSemTexto: f.semTexto,
    },
  };
}
