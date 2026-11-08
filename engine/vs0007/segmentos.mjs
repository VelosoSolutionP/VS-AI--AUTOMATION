/**
 * Segmentos comerciais que o 0007 pesquisa por operação do negócio.
 *
 * O nicho comum vira uma busca só ("<nicho> o que é, como funciona"). Aqui o
 * nicho não é profissão nem cardápio de restaurante: é um ramo com operações
 * próprias. Cada tema tem a sua busca e só conta o trecho que fala dele, e a
 * homologação exige o mínimo de temas cobertos por fonte registrada.
 */
const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const SEGMENTOS = Object.freeze([
  {
    id: 'distribuicao-alimentos-bebidas',
    nome: 'Distribuição e comércio de alimentos e bebidas',
    especialidadeDigital: 'Catálogo e pedidos digitais',
    funcao: 'Catálogo e pedidos digitais',
    nomeSugerido: 'IA Cardápio Digital',
    profissaoBase: 'vendedora',
    finalidade: 'Atender clientes de distribuidoras de alimentos e bebidas e de food service, com especialidade em catálogo e pedidos digitais: produtos, preços, estoque, pedidos, entregas, pagamentos e orientação sobre emissão fiscal, usando somente informações confirmadas e encaminhando à equipe o que não estiver configurado.',
    padrao: /cardapios?[\s-]*digita(l|is)|distribui(dora|doras|cao) de (alimentos|bebidas)/,
    /* A página tem de ser do ramo: sem isto, "catálogo" trazia autopeças e "pagamentos", imposto federal. */
    contexto: /bebida|aliment|distribuidora|food ?service|atacad|cardapio|restaurante|delivery/,
    minimoTemas: 9,
    limites: { leitura: 30, fontes: 18, conhecimentos: 30 },
    temas: [
      { id: 'distribuidoras', nome: 'Distribuidoras de bebidas e alimentos', busca: '"distribuidora de bebidas" como funciona o negócio food service', padrao: /distribui.*(bebida|aliment)|(bebida|aliment).*distribui|food ?service/ },
      { id: 'catalogo-produtos', nome: 'Catálogo, marcas, categorias e preços', busca: '"distribuidora de bebidas" catálogo de produtos marcas categorias', padrao: /catalogo|mix de produtos|\bmarcas?\b|categorias? de produtos/ },
      { id: 'estoque-reposicao', nome: 'Estoque, entrada, saída e reposição', busca: '"distribuidora de bebidas" controle de estoque reposição', padrao: /estoque|reposicao/ },
      { id: 'compras-fornecedores', nome: 'Compras, fornecedores e recebimento', busca: '"distribuidora de alimentos" compras fornecedores recebimento de mercadorias', padrao: /fornecedor|recebimento d[ea]s? mercadoria|ordem de compra|gestao de compras/ },
      { id: 'pedidos-vendas-entregas', nome: 'Pedidos, vendas e entregas', busca: '"distribuidora de bebidas" gestão de pedidos e entregas', padrao: /pedidos?\b|entregas?\b|roteiriz/ },
      { id: 'clientes-condicoes', nome: 'Clientes, atacado, varejo e condições comerciais', busca: '"distribuidora de alimentos" atacado varejo condições comerciais', padrao: /atacad|varej|condic(ao|oes) comerciais/ },
      { id: 'precos-promocoes', nome: 'Tabelas de preços, promoções e descontos', busca: '"distribuidora de bebidas" tabela de preços promoções descontos', padrao: /tabelas? de precos?|promoc|descontos?\b/ },
      { id: 'cardapio-catalogo-digital', nome: 'Cardápio digital e catálogo digital', busca: '"catálogo digital" "distribuidora" bebidas pedidos cardápio digital', padrao: /(cardapio|catalogo)s? (digita|online|virtua)/ },
      { id: 'whatsapp-automacao', nome: 'WhatsApp, atendimento e automação de vendas', busca: '"distribuidora de bebidas" WhatsApp automação de vendas', padrao: /whatsapp|automacao (de|das) vendas|chatbot/ },
      { id: 'pagamentos-pix', nome: 'Pagamentos, PIX e integração financeira', busca: '"distribuidora de bebidas" pagamentos PIX financeiro', padrao: /\bpix\b|pagamentos?\b|boletos?\b|conciliac/ },
      { id: 'fiscal-nfe-sped', nome: 'NF-e, entrada de notas, SPED e obrigações', busca: '"distribuidora de bebidas" NF-e SPED obrigações fiscais', padrao: /nf-?e\b|notas? fisca(l|is)|\bsped\b|icms|substituicao tributaria/ },
    ],
  },
]);

export const segmentoDoNicho = (nicho) => SEGMENTOS.find((s) => s.padrao.test(normalizar(nicho))) || null;
export const falaDoTema = (texto, tema) => tema.padrao.test(normalizar(texto));
export const doRamo = (texto, segmento) => segmento.contexto.test(normalizar(texto));
/** Temas do segmento que têm conhecimento registrado (a categoria é o id do tema). */
export function temasCobertos(segmento, conhecimentos = []) {
  const categorias = new Set(conhecimentos.map((c) => c.categoria));
  return segmento.temas.filter((t) => categorias.has(t.id));
}
