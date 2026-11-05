/**
 * BOTS PRONTOS POR NICHO (29/09, dono: "cadê os tipos de bot pra escolher?").
 *
 * A proposta vende "Bots por nicho — escolhe-se o nicho na implantação", mas a
 * tela só importava planilha. Aqui mora o catálogo: cada modelo é um fluxo em
 * exemplos/fluxo-<id>.json. O cardápio sai das CATEGORIAS do estoque da loja
 * (nenhum modelo depende de SKU de outra loja). Ao aplicar, o nome genérico da
 * saudação ("Sua Hamburgueria") vira o nome da empresa, se ele estiver
 * configurado no bot.
 *
 * Os fluxos de clientes específicos (Juarez, Gael) NÃO entram: são deles.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PASTA = () => process.env.VSBOT_MODELOS_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'exemplos');

/* 02/10 (dono: "tá faltando muito mercado, o nosso principalmente… pode colocar todos os
   comércios que usam venda via WhatsApp, o mercado de TI também"): de 8 pra 34 nichos,
   na ordem alimentação → varejo → serviços. Cada `marcador` é único: é o texto da
   saudação trocado pelo nome da empresa. */
export const MODELOS = Object.freeze([
  // Alimentação
  { id: 'hamburgueria', nome: 'Hamburgueria e lanchonete', marcador: 'Sua Hamburgueria', descricao: 'Cardápio, adicionais, observação, entrega ou retirada, taxa por bairro e Pix.' },
  { id: 'pizzaria', nome: 'Pizzaria', marcador: 'Sua Pizzaria', descricao: 'Tamanho, meia a meia (vale a mais cara), bebida, entrega por bairro e Pix.' },
  { id: 'pizzaria-robusta', nome: 'Pizzaria, restaurante e distribuidora', marcador: 'Sua Pizza', descricao: 'Robusto: sabores com fracionamento, bordas e adicionais condicionais, retirada de ingredientes, confirmação com resumo e Ok, entrega/retirada, taxa por CEP e PIX no fluxo. Combo da promoção no início.' },
  { id: 'comida-japonesa', nome: 'Comida japonesa', marcador: 'Seu Japonês', descricao: 'Cardápio pelo estoque, combinado pra festa sob encomenda, entrega e Pix.' },
  { id: 'acai', nome: 'Açaí', marcador: 'Seu Açaí', descricao: 'Monta o copo: tamanho, complementos e adicionais, e fecha com a cobrança.' },
  { id: 'marmitaria', nome: 'Marmitaria e restaurante', marcador: 'Sua Marmitaria', descricao: 'Cardápio do dia pelo estoque, bebida, entrega e cobrança.' },
  { id: 'padaria-encomenda', nome: 'Padaria e confeitaria', marcador: 'Sua Padaria', descricao: 'Encomenda com data e tema, e sinal: parte agora, o resto na retirada.' },
  { id: 'acougue', nome: 'Açougue e peixaria', marcador: 'Seu Açougue', descricao: 'Cortes pelo estoque (peso confirmado na pesagem), kit churrasco sob encomenda, entrega e Pix.' },
  { id: 'mercado', nome: 'Mercado, mercearia e hortifrúti', marcador: 'Seu Mercado', descricao: 'Compra pelo estoque ou lista por foto, ofertas da semana, entrega por bairro e Pix.' },
  { id: 'distribuidora', nome: 'Distribuidora de bebidas, gás e água', marcador: 'Sua Distribuidora', descricao: 'Bebidas, troca do botijão e galão de água, entrega rápida e Pix; aviso de maior de 18.' },
  // Varejo
  { id: 'loja-varejo', nome: 'Lojas e varejo', marcador: 'Sua Loja', descricao: 'Produtos com preço, pergunta sobre tamanho/cor, troca, entrega ou retirada e Pix.' },
  { id: 'farmacia', nome: 'Farmácia e drogaria', marcador: 'Sua Farmácia', descricao: 'Produtos sem receita pelo estoque; receita por foto sempre passa pelo farmacêutico; entrega e Pix.' },
  { id: 'pet-shop', nome: 'Pet shop e veterinária', marcador: 'Seu Pet Shop', descricao: 'Ração e produtos, banho e tosa com dia, horário e leva e traz, e consulta veterinária.' },
  { id: 'materiais-construcao', nome: 'Materiais de construção', marcador: 'Sua Loja de Materiais', descricao: 'Orçamento pela lista da obra (foto), produtos pelo estoque, entrega na obra e Pix.' },
  { id: 'moveis-eletro', nome: 'Móveis e eletrodomésticos', marcador: 'Sua Loja de Móveis', descricao: 'Produtos, crediário com a equipe, entrega, montagem e assistência.' },
  { id: 'otica', nome: 'Ótica', marcador: 'Sua Ótica', descricao: 'Óculos pela receita (foto), exame de vista, armações e lentes, conserto.' },
  { id: 'floricultura', nome: 'Floricultura e presentes', marcador: 'Sua Floricultura', descricao: 'Flores e presentes, mensagem do cartão, dia e endereço de quem recebe, e Pix.' },
  { id: 'autopecas-oficina', nome: 'Autopeças e oficina mecânica', marcador: 'Sua Oficina', descricao: 'Peça pelo carro (modelo e ano), orçamento e agendamento de serviço, e como está o carro.' },
  { id: 'agro-revenda', nome: 'Agro: revenda agrícola e agropecuária', marcador: 'Sua Agropecuária', descricao: 'Produtos e insumos, peça de máquina pelo modelo, visita técnica na propriedade e pagamento combinado (safra).' },
  // Serviços
  { id: 'cadevc-barbearia', nome: 'Salão, barbearia e estética', marcador: 'Seu Salão', descricao: 'Agenda no WhatsApp: serviço, profissional, dia e horário — marca e confirma sozinho; paga no dia ou agora.' },
  { id: 'recepcao-servicos', nome: 'Recepção de serviços', marcador: 'Sua Empresa', descricao: 'Clínica, estúdio e serviços em geral: escolhe o serviço, dia e horário, e paga agora ou no dia.' },
  { id: 'clinica-saude', nome: 'Clínica médica e odontológica', marcador: 'Sua Clínica', descricao: 'Consulta ou exame, particular ou convênio, remarcar e resultado (só pro paciente).' },
  { id: 'academia', nome: 'Academia e estúdio fitness', marcador: 'Sua Academia', descricao: 'Planos e matrícula com pagamento, aula experimental e pedidos de quem já é aluno.' },
  { id: 'escola-cursos', nome: 'Escola e cursos', marcador: 'Sua Escola', descricao: 'Cursos e matrícula com pagamento, visita ou aula experimental, e secretaria pro aluno.' },
  { id: 'assistencia-tecnica', nome: 'Assistência e suporte técnico', marcador: 'Sua Assistência', descricao: 'Orçamento de conserto (aparelho e defeito), acompanhar a OS, busca ou visita.' },
  { id: 'grafica', nome: 'Gráfica e comunicação visual', marcador: 'Sua Gráfica', descricao: 'Orçamento: produto, quantidade, medida, arte pronta ou criada, e prazo.' },
  { id: 'lavanderia', nome: 'Lavanderia', marcador: 'Sua Lavanderia', descricao: 'Coleta das roupas, serviços e preços pelo estoque, e se a roupa está pronta.' },
  { id: 'frete-mudanca', nome: 'Frete, mudança e transporte', marcador: 'Sua Transportadora', descricao: 'Orçamento por origem, destino, carga e data, e acompanhar a entrega.' },
  { id: 'festas-eventos', nome: 'Festas, buffet e eventos', marcador: 'Sua Empresa de Festas', descricao: 'Orçamento por tipo de evento, data, convidados e local.' },
  { id: 'hotel-pousada', nome: 'Hotel e pousada', marcador: 'Sua Pousada', descricao: 'Reserva com datas, pessoas e acomodação, sinal de 30% e alterações.' },
  { id: 'agencia-viagens', nome: 'Agência de viagens', marcador: 'Sua Agência', descricao: 'Orçamento por destino, datas e pessoas, pacotes e atendimento de quem já comprou.' },
  { id: 'imobiliaria', nome: 'Imobiliária e corretor', marcador: 'Sua Imobiliária', descricao: 'Comprar (à vista ou financiado) ou alugar, anunciar o imóvel e atendimento ao inquilino.' },
  { id: 'contabilidade', nome: 'Escritório de contabilidade', marcador: 'Seu Escritório', descricao: 'Abrir empresa ou MEI, trocar de contador, guias e 2ª via, e imposto de renda.' },
  { id: 'software-tecnologia', nome: 'Software, sistemas e TI', marcador: 'Sua Empresa de Tecnologia', descricao: 'Demonstração dos sistemas, sistema sob medida, suporte com urgência, parceria/revenda e financeiro.' },
]);

const ARQUIVO_MODELO = { 'cadevc-barbearia': 'salao-barbearia' };
const passosDoArquivo = (id) => JSON.parse(readFileSync(join(PASTA(), `fluxo-${ARQUIVO_MODELO[id] || id}.json`), 'utf8'));

export function fonteDe(id) {
  return `exemplos/fluxo-${ARQUIVO_MODELO[id] || id}.json`;
}

/** A lista pra tela: nome, o que faz, quantos passos e as categorias do estoque que ele usa. */
export function listar() {
  return MODELOS.map((m) => {
    const passos = passosDoArquivo(m.id);
    return { id: m.id, nome: m.nome, descricao: m.descricao, passos: passos.length,
      categorias: [...new Set(passos.map((p) => p.categoria).filter(Boolean))],
      roteiro: passos.map((p) => ({ id: p.id, texto: String(p.mensagem || '').split('\n')[0].slice(0, 90) })) };
  });
}

/** Os passos do modelo, com o nome da empresa no lugar do genérico. */
export function passosDe(id, { empresa = null } = {}) {
  const m = MODELOS.find((x) => x.id === id);
  if (!m) { return null; }
  const nome = String(empresa || '').trim();
  const passos = passosDoArquivo(id);
  if (!nome) { return passos; }
  return JSON.parse(JSON.stringify(passos).split(m.marcador).join(nome.replace(/["\\]/g, '')));
}
