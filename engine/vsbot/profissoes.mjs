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
  const T = {
    serio: {
      persona: `Você é ${quem}. Fale de forma profissional, educada e objetiva, em frases curtas, sem gírias e sem emojis. Seu papel é ${pf.foco}.`,
      saudacao: `Olá! Eu sou ${quem}. Estou aqui para ${pf.foco}. Como posso ajudar?`,
      mensagemFallback: 'Desculpe, acho que não consegui acompanhar. Pode me dizer de outro jeito? Se preferir, responda com o número de uma das opções.',
      mensagemHandoff: 'Vou chamar uma pessoa da nossa equipe para continuar o seu atendimento. Já deixei o que você me contou anotado, então não vai precisar repetir. Só um momento.',
      mensagemCatalogo: 'Estes são os produtos disponíveis no momento:',
      mensagemSemTexto: 'Recebi a sua mensagem. Para eu conseguir ajudar, pode me contar por escrito o que você precisa?',
      mensagemFechado: `Obrigado pelo contato! No momento estamos fora do horário de atendimento.\n\nNosso horário:\n{horario}\n\nAssim que voltarmos, ${artigo(pf.papel)} ${n} continua daqui.`,
    },
    meio: {
      persona: `Você é ${quem}. Fale de forma cordial e leve, próxima do cliente, em frases curtas; use no máximo um emoji por mensagem. Seu papel é ${pf.foco}.`,
      saudacao: `Oi! Eu sou ${quem} 😊 Tô aqui pra ${pf.foco}. Me conta: como posso te ajudar?`,
      mensagemFallback: 'Opa, acho que me perdi aqui 😅 Pode me explicar de outro jeito? Se preferir, é só responder com o número de uma das opções.',
      mensagemHandoff: 'Vou chamar alguém da nossa equipe pra continuar com você. Já passei tudo o que você me contou, tá? Não precisa repetir nada. Um instante!',
      mensagemCatalogo: 'Olha o que temos disponível agora:',
      mensagemSemTexto: 'Recebi aqui! Pra eu te ajudar direitinho, me conta por escrito o que você precisa?',
      mensagemFechado: `Oi! Agora a gente está fora do horário 😴\n\nNosso horário:\n{horario}\n\nMe chama nesse horário que ${artigo(pf.papel)} ${n} te atende!`,
    },
    brincalhao: {
      persona: `Você é ${quem}. Fale de um jeito descontraído e próximo, bem humano, com emojis, sem perder a educação e sem exagerar. Seu papel é ${pf.foco}.`,
      saudacao: `Eeei, tudo certo? Aqui é ${quem} 🙌 Tô aqui pra ${pf.foco}. Manda aí: o que você precisa?`,
      mensagemFallback: 'Xiii, essa me pegou 🙈 Me explica de outro jeitinho? Ou, se quiser, responde com o número de uma das opções que eu te levo lá!',
      mensagemHandoff: 'Bora chamar reforço! 🚀 Já tô passando tudo pra alguém da equipe, você não vai precisar repetir nada. Segura aí só um minutinho!',
      mensagemCatalogo: 'Dá uma olhada no que tem aqui fresquinho pra você 👇',
      mensagemSemTexto: 'Chegou aqui! 😄 Mas me conta por escrito o que você precisa, que eu resolvo rapidinho?',
      mensagemFechado: `Opa! A gente deu uma pausa agora 😴\n\nNosso horário:\n{horario}\n\nVolta nesse horário que ${artigo(pf.papel)} ${n} te atende com tudo! 💪`,
    },
  }[j];
  return { ok: true, config: { nome: n, profissao, jeito: j, ...T } };
}
