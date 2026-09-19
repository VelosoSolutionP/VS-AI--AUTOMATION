/**
 * Quebra-Galho — dados de demonstração.
 *
 * Existe porque tela vazia não deixa ninguém julgar o produto: sem pedido, sem
 * proposta e sem OS, o fluxo não pode ser percorrido nem avaliado.
 *
 * Regras que o seed respeita, e não são detalhe:
 *  - os prestadores são criados pelo MESMO caminho do cadastro real (validação,
 *    documento com dígito verificador, status PENDING) e depois promovidos pela
 *    máquina de estados. Injetar direto na base esconderia bug de validação.
 *  - todo dado é claramente de demonstração e o painel diz isso.
 */
import { randomBytes } from 'node:crypto';

/** CPFs/CNPJs válidos de teste (dígito verificador correto, sem dono real). */
export const PRESTADORES_DEMO = [
  {
    nome: 'Carlos Elétrica', documento: '11144477735', telefone: '31988880001',
    categorias: ['eletrica'], lat: -19.9386, lng: -43.9336, raioKm: 12,
    cidades: ['Belo Horizonte'], bairros: ['Savassi', 'Funcionários', 'Lourdes'],
    descricao: 'Instalação, troca de quadro e reparo em geral. Atendo no mesmo dia.',
    reputacao: 4.9, servicosConcluidos: 127, walletId: 'demo_wallet_carlos',
  },
  {
    nome: 'João Reparos', documento: '52998224725', telefone: '31988880002',
    categorias: ['reparos', 'montagem', 'eletrica'], lat: -19.9120, lng: -43.9400, raioKm: 15,
    cidades: ['Belo Horizonte', 'Contagem'], bairros: ['Pampulha', 'Castelo'],
    descricao: 'Pequenos reparos, montagem de móveis, elétrica simples e manutenção residencial.',
    reputacao: 4.6, servicosConcluidos: 83, walletId: 'demo_wallet_joao',
  },
  {
    nome: 'Marcos Serviços', documento: '11222333000181', telefone: '31988880003',
    categorias: ['pintura', 'reparos'], lat: -19.9500, lng: -43.9600, raioKm: 20,
    cidades: ['Belo Horizonte', 'Nova Lima'], bairros: ['Buritis', 'Estoril'],
    descricao: 'Pintura residencial e comercial. Orçamento sem compromisso.',
    reputacao: 4.8, servicosConcluidos: 61, walletId: 'demo_wallet_marcos',
  },
  {
    nome: 'Rafa Hidráulica', documento: '12345678909', telefone: '31988880004',
    categorias: ['hidraulica', 'eletrica'], lat: -19.9300, lng: -43.9200, raioKm: 10,
    cidades: ['Belo Horizonte'], bairros: ['Santa Efigênia'],
    descricao: 'Vazamento, caixa d’água e desentupimento. Urgência 24h.',
    reputacao: 3.6, servicosConcluidos: 19, walletId: 'demo_wallet_rafa',
  },
  {
    nome: 'Duda Montagens', documento: '98765432100', telefone: '31988880005',
    categorias: ['montagem'], lat: -19.9250, lng: -43.9450, raioKm: 14,
    cidades: ['Belo Horizonte'],
    descricao: 'Montagem e desmontagem de móveis. Começou agora no Quebra-Galho.',
    reputacao: null, servicosConcluidos: 0, walletId: null,
  },
];

export const CATEGORIAS_DEMO = [
  { id: 'eletrica', nome: 'Elétrica', icone: '⚡', precificacao: 'ESTIMATE', exemplos: ['Tomada não funciona', 'Trocar disjuntor', 'Instalar chuveiro'] },
  { id: 'hidraulica', nome: 'Hidráulica', icone: '💧', precificacao: 'ESTIMATE', exemplos: ['Vazamento', 'Entupimento', 'Trocar torneira'] },
  { id: 'pintura', nome: 'Pintura', icone: '🎨', precificacao: 'INSPECTION_REQUIRED', exemplos: ['Pintar um quarto', 'Retoque', 'Fachada'] },
  { id: 'montagem', nome: 'Montagem', icone: '🔧', precificacao: 'FIXED_PRICE', exemplos: ['Montar guarda-roupa', 'Montar cama', 'Instalar prateleira'] },
  { id: 'manutencao', nome: 'Manutenção', icone: '🏠', precificacao: 'ESTIMATE', exemplos: ['Revisão geral', 'Telhado', 'Portão'] },
  { id: 'reparos', nome: 'Pequenos reparos', icone: '🛠️', precificacao: 'ESTIMATE', exemplos: ['Furar parede', 'Trocar fechadura', 'Ajustar porta'] },
];

export const CLIENTE_DEMO = {
  nome: 'Maria Souza', telefone: '31977770001', email: 'maria@exemplo.com', aceitouTermos: true,
  enderecos: [{ apelido: 'Casa', logradouro: 'Rua da Bahia', numero: '1200', bairro: 'Centro', cidade: 'Belo Horizonte', uf: 'MG', lat: -19.9245, lng: -43.9352 }],
};

/** Pedido de demonstração, já com propostas — pra tela de comparação ter conteúdo. */
export const PEDIDO_DEMO = {
  categoria: 'eletrica',
  descricao: 'A tomada do quarto parou de funcionar e o disjuntor cai quando ligo o ar-condicionado.',
  lat: -19.9245, lng: -43.9352, cidade: 'Belo Horizonte', bairro: 'Centro',
  endereco: 'Rua da Bahia, 1200', urgencia: 'hoje',
};

export const PROPOSTAS_DEMO = [
  { prestador: 'Carlos Elétrica', valorCentavos: 22000, prazoDias: 1, escopo: 'Troca da tomada, revisão do circuito do quarto e teste de carga do ar-condicionado.', materiaisInclusos: true, materiais: 'Tomada 20A e fio', disponibilidade: 'Disponível hoje' },
  { prestador: 'João Reparos', valorCentavos: 19500, prazoDias: 2, escopo: 'Troca da tomada e verificação do disjuntor.', materiaisInclusos: false, naoIncluso: 'Material por conta do cliente', disponibilidade: 'Amanhã pela manhã' },
  { prestador: 'Rafa Hidráulica', valorCentavos: 17000, prazoDias: 1, escopo: 'Troca da tomada.', materiaisInclusos: false, naoIncluso: 'Não inclui revisão do circuito', disponibilidade: 'Hoje à tarde' },
];

export const id = (p) => `${p}_${randomBytes(6).toString('hex')}`;
