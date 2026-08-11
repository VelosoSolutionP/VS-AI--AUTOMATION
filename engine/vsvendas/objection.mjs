/**
 * VSvendas — objeções. Casa a fala do cliente com a resposta que a EMPRESA definiu
 * na entrevista; se não achar, cai numa biblioteca genérica de contorno.
 */

const norm = (s) => String(s || '').toLowerCase();

const GENERICAS = [
  { re: /(caro|preç|preco|valor alto|sem verba|orçamento apertado)/i, resposta: 'Entendo. Vamos olhar o retorno, não só o preço: quanto {dor} custa hoje pra você? Aí comparamos com o investimento.' },
  { re: /(vou pensar|preciso pensar|depois|mais pra frente)/i, resposta: 'Faz sentido. Pra eu te ajudar a decidir, o que ainda ficou em dúvida? Posso te retornar {prazo} dias com isso resolvido.' },
  { re: /(já tenho|fornecedor|concorrente|uso outro)/i, resposta: 'Ótimo que já resolve isso. Muitos clientes vieram de lá — o que hoje te incomoda no atual? Se nada, tranquilo; se tem algo, mostro a diferença.' },
  { re: /(sem tempo|corrido|ocupad)/i, resposta: 'Rapidinho então: te mando um resumo de 3 linhas e você decide se vale 10 min. Pode ser?' },
  { re: /(falar com|decisor|sócio|chefe|equipe)/i, resposta: 'Perfeito. Quer que eu prepare um material curto pra você levar a quem decide? Facilito a conversa interna.' },
];

/**
 * @param {string} fala   objeção do cliente
 * @param {object} profile
 * @returns {{objecao:string, resposta:string, origem:'empresa'|'generica'|'nenhuma'}}
 */
export function handleObjection(fala, profile) {
  const t = norm(fala);
  const prazo = profile?.followPrazoDias ?? 3;

  const doPerfil = (profile?.objecoes || []).find((o) => o.resposta && t.includes(norm(o.objecao)));
  if (doPerfil) { return { objecao: doPerfil.objecao, resposta: doPerfil.resposta, origem: 'empresa' }; }

  const gen = GENERICAS.find((g) => g.re.test(t));
  if (gen) {
    return { objecao: fala, resposta: gen.resposta.replace('{prazo}', String(prazo)).replace('{dor}', 'esse problema'), origem: 'generica' };
  }
  return { objecao: fala, resposta: 'Não reconheci essa objeção. Faça uma pergunta aberta pra entender a raiz antes de responder.', origem: 'nenhuma' };
}
