/**
 * Entrevista de onboarding — schemas de perguntas por domínio.
 *
 * Motivo: a suite é multi-empresa; não dá pra adivinhar o que cada cliente vende,
 * o funil, o tom. A entrevista captura isso 1x e vira o PERFIL que os módulos leem
 * (VSvendas, e depois os outros). Schema-driven: adicionar pergunta = editar aqui.
 *
 * Tipos: text | longtext | number | bool | choice(opcoes) | multichoice(opcoes) | list
 */

export const SETS = {
  // Base da empresa — serve a todos os módulos.
  empresa: [
    { id: 'empresa_nome', secao: 'Empresa', pergunta: 'Qual o nome da empresa?', tipo: 'text', required: true },
    { id: 'vende', secao: 'Empresa', pergunta: 'O que a empresa vende? (produto/serviço em 1-2 frases)', tipo: 'longtext', required: true },
    { id: 'proposta_valor', secao: 'Empresa', pergunta: 'Principal proposta de valor — por que compram de você?', tipo: 'longtext', required: true },
    { id: 'icp', secao: 'Empresa', pergunta: 'Quem é o cliente ideal? (segmento, porte, cargo do decisor)', tipo: 'longtext', required: true },
    { id: 'ticket', secao: 'Empresa', pergunta: 'Ticket médio aproximado (R$)?', tipo: 'number', required: false },
    { id: 'tom', secao: 'Empresa', pergunta: 'Tom de voz nas mensagens?', tipo: 'choice', opcoes: ['Formal', 'Consultivo', 'Amigável', 'Direto'], required: true },
  ],

  // Vendas — alimenta o VSvendas.
  vendas: [
    { id: 'funil', secao: 'Vendas', pergunta: 'Quais as etapas do funil, em ordem?', tipo: 'list', required: true, help: 'Ex.: Novo lead; Qualificado; Proposta enviada; Negociação; Fechado' },
    { id: 'canais', secao: 'Vendas', pergunta: 'Canais de contato usados?', tipo: 'multichoice', opcoes: ['WhatsApp', 'E-mail', 'Ligação', 'Instagram', 'Presencial'], required: true },
    { id: 'sinais_quente', secao: 'Vendas', pergunta: 'O que indica um lead QUENTE? (sinais de compra)', tipo: 'list', required: false, help: 'Ex.: pediu preço; tem urgência; é o decisor; comparou concorrente' },
    { id: 'sinais_frio', secao: 'Vendas', pergunta: 'O que indica um lead FRIO / desqualificado?', tipo: 'list', required: false, help: 'Ex.: sem orçamento; só curiosidade; fora do perfil' },
    { id: 'objecoes', secao: 'Vendas', pergunta: 'Objeções mais comuns? (uma por linha; se quiser, "objeção => resposta")', tipo: 'list', required: false, help: 'Ex.: tá caro => mostro ROI; vou pensar => marco retorno com data' },
    { id: 'follow_prazo', secao: 'Vendas', pergunta: 'Após enviar proposta, em quantos dias fazer follow-up?', tipo: 'number', required: false },
  ],
};

export function getSet(setId) {
  const s = SETS[setId];
  if (!s) { throw new Error(`entrevista: set desconhecido "${setId}" (use: ${Object.keys(SETS).join(', ')})`); }
  return s;
}

export function findQuestion(setId, id) {
  return getSet(setId).find((q) => q.id === id) || null;
}
