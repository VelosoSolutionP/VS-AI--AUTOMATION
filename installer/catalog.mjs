/**
 * Instalador — catálogo de produtos/módulos da suite VelosoSolution.
 * `available` instala; `coming_soon` aparece marcado como "em breve".
 */
export const TRIAL_DAYS = 7;
export const WHATSAPP = '5531975127978'; // contato/chave do teste vão pro WhatsApp (email desativado)
export const whatsappLink = (msg) => `https://wa.me/${WHATSAPP}${msg ? `?text=${encodeURIComponent(msg)}` : ''}`;

export const PRODUTOS = [
  { id: 'gate', nome: 'VSolution — Gate', linha: 'dev', status: 'available', desc: 'Barra bug de UI no commit (Chrome real): injeta o bug, exige msg amigável + console limpo.' },
  { id: 'vsqa', nome: 'VSqa', linha: 'dev', status: 'available', desc: 'Testa a US como um QA: gera cenário, roda no browser e dá o veredito (verde fecha / vermelho devolve).' },
  { id: 'vsanalista', nome: 'VSanalista', linha: 'dev', status: 'available', desc: 'Cria Épico + Histórias de Usuário + tarefas técnicas no padrão do time.' },
  { id: 'vsdiretoria', nome: 'VSdiretoria', linha: 'dev', status: 'available', desc: 'Painel executivo (BI): produtividade, qualidade, governança — com exportação em PDF.' },
  { id: 'vsinfluence', nome: 'VSinfluence', linha: 'criador', status: 'available', desc: 'Corta e melhora os vídeos, agenda a subida por rede, cobra conteúdo quando a pasta está vazia e controla campanhas, ganhos, métricas e lives.' },
  { id: 'vsvendas', nome: 'VSvendas', linha: 'vendas', status: 'available', desc: 'Vendas + Marketing: qualifica leads, redige follow-up, contorna objeção e gera anúncios das fotos.' },
  { id: 'vssuporte', nome: 'VSsuporte', linha: 'suporte', status: 'coming_soon', desc: 'Automação do atendimento/suporte — em breve.' },
];

export const disponiveis = () => PRODUTOS.filter((p) => p.status === 'available');
export const byId = (id) => PRODUTOS.find((p) => p.id === id) || null;

/** Valida a seleção; ignora coming_soon. Retorna { ok, escolhidos, erros }. */
export function validarSelecao(ids) {
  const erros = [];
  const escolhidos = [];
  for (const id of ids || []) {
    const p = byId(id);
    if (!p) { erros.push(`produto desconhecido: ${id}`); continue; }
    if (p.status !== 'available') { erros.push(`${p.nome} ainda não está disponível`); continue; }
    escolhidos.push(p.id);
  }
  if (!escolhidos.length && !erros.length) { erros.push('selecione ao menos um produto'); }
  return { ok: erros.length === 0, escolhidos, erros };
}
