/**
 * Dados de mentira para a instância de demonstração.
 *
 * Tudo aqui é inventado, e de propósito é ÓBVIO que é inventado: nome de
 * empresa fictícia, telefone na faixa reservada para ficção, valores redondos.
 * Um revisor que abre isto tem de conseguir dizer em dois segundos que não está
 * olhando o negócio de ninguém.
 *
 * Recusa-se a rodar fora de uma casa de demonstração. Semeador que pode cair na
 * casa errada é uma linha de comando distraída entre você e o dado do cliente.
 */
import { casa } from '../engine/casa.mjs';

const CASA = casa();
if (!/demo/i.test(CASA)) {
  console.error(`RECUSADO: a casa "${CASA}" não parece de demonstração.`);
  console.error('Rode com VS_HOME apontando para uma pasta de demo (ex.: ~/.qa-gate-demo).');
  process.exit(1);
}

const crm = await import('../engine/vscrm/index.mjs');
const estoque = await import('../engine/vsestoque/index.mjs');
const planos = await import('../engine/vsplanos/index.mjs');
const operadores = await import('../engine/vsoperadores/index.mjs');
const bot = await import('../engine/vsbot/index.mjs');

/* Faixa 5531 9xxxx reservada: numeros que nao existem, pra ninguem receber
   mensagem por engano se alguma integracao for ligada sem querer. */
const LEADS = [
  { nome: 'Padaria Pão do Céu', telefone: '5531900000101', origem: 'tiktok', etapa: 'novo' },
  { nome: 'Auto Peças Jacaré', telefone: '5531900000102', origem: 'whatsapp', etapa: 'contato' },
  { nome: 'Studio Bella Unhas', telefone: '5531900000103', origem: 'tiktok', etapa: 'proposta' },
  { nome: 'Mercadinho do Zé', telefone: '5531900000104', origem: 'indicacao', etapa: 'ganho' },
];

const PRODUTOS = [
  { sku: 'demo-caneca-vs', nome: 'Caneca Demo 350ml', descricao: 'Caneca de cerâmica para demonstração.', preco: '39,90', quantidade: 50, marca: 'Demo', categoria: 'Casa' },
  { sku: 'demo-camiseta-vs', nome: 'Camiseta Demo P', descricao: 'Camiseta de algodão para demonstração.', preco: '59,90', quantidade: 30, marca: 'Demo', categoria: 'Vestuário' },
  { sku: 'demo-fone-vs', nome: 'Fone Demo Bluetooth', descricao: 'Fone sem fio para demonstração.', preco: '149,90', quantidade: 12, marca: 'Demo', categoria: 'Eletrônicos' },
];

/* Id FIXO de proposito. Sem ele cada rodada cadastra gente nova — o id nasce
   sorteado — e na terceira o teto do contrato estoura. Semeador atualiza o que
   ja existe; quem multiplica e praga, nao semente. */
const OPERADORES = [
  { id: 'demo-op-comercial', nome: 'Ana Demonstração', setor: 'comercial' },
  { id: 'demo-op-financeiro', nome: 'Bruno Demonstração', setor: 'financeiro' },
  { id: 'demo-op-suporte', nome: 'Carla Demonstração', setor: 'suporte' },
];

const conta = { leads: 0, produtos: 0, operadores: 0, erros: [] };

/* Semear duas vezes tem de ser inofensivo. "Ja existe" e o resultado ESPERADO
   da segunda rodada — tratar como falha faria o script recusar a propria demo
   pronta, e quem estivesse com pressa apagaria a pasta pra "resolver". */
const jaExistia = (m) => /j[áa] existe|duplicad/i.test(String(m || ''));
const motivoDe = (r) => r?.erro || (r?.erros || [r?.motivo]).filter(Boolean).join('; ');

/* O CRM recusa lead sem FUNIL cadastrado, e o funil normalmente vem da
   entrevista. Na demo nao ha entrevista pra fazer: as etapas entram direto. */
crm.setFunil(['novo', 'contato', 'proposta', 'ganho', 'perdido']);

for (const l of LEADS) {
  const r = crm.criar(l);
  /* Este modulo recusa com {erro}, nao com {ok:false} — e na primeira versao
     deste semeador eu conferi o campo errado e ele anunciou "4/4" com ZERO
     leads gravados. Semeador que mente sobre o que semeou e pior que semeador
     que falha: a demo vai pro ar vazia e ninguem fica sabendo. */
  const m = motivoDe(r);
  if (m && !jaExistia(m)) { conta.erros.push(`lead ${l.nome}: ${m}`); }
  else { conta.leads += 1; }
}

for (const p of PRODUTOS) {
  const r = estoque.criar(p);
  const m = motivoDe(r);
  if (m && !jaExistia(m)) { conta.erros.push(`produto ${p.sku}: ${m}`); }
  else { conta.produtos += 1; }
}

/* Plano assinado: sem ele a tela de operadores nao tem teto pra mostrar, e o
   revisor ve "sem limite", que nao demonstra a regra. */
planos.assinar({ plano: 'combo-ouro' });

for (const o of OPERADORES) {
  const r = operadores.salvar(o);
  const m = motivoDe(r);
  if (m && !jaExistia(m)) { conta.erros.push(`operador ${o.nome}: ${m}`); }
  else { conta.operadores += 1; }
}

/* A Micaela LIGADA com um fluxo curto: o revisor precisa ver o bot respondendo
   no simulador, que e onde ele consegue testar sem WhatsApp pareado. */
bot.salvarConfig({
  ativo: true,
  nome: 'Micaela (demonstração)',
  saudacao: 'Olá! Sou a Micaela, assistente de demonstração da Veloso Solution.',
});
bot.salvarFluxo([
  { id: 'inicio', mensagem: 'Olá! Sou a Micaela, assistente de demonstração. Como posso ajudar?', opcoes: [
    { tecla: '1', texto: 'Quero conhecer os produtos', vaiPara: 'catalogo' },
    { tecla: '2', texto: 'Financeiro', acao: 'encaminhar', departamento: 'financeiro', resposta: 'Passando para o financeiro.' },
    { tecla: '3', texto: 'Falar com uma pessoa', acao: 'encaminhar', departamento: 'humano', resposta: 'Já chamo alguém do time.' },
  ] },
  { id: 'catalogo', mensagem: 'Estes são os produtos da loja de demonstração:', acao: 'catalogo', vaiPara: 'fim' },
  { id: 'fim', mensagem: 'Obrigada pelo contato!', acao: 'fim' },
]);

console.log(`casa da demo : ${CASA}`);
console.log(`leads        : ${conta.leads}/${LEADS.length}`);
console.log(`produtos     : ${conta.produtos}/${PRODUTOS.length}`);
console.log(`operadores   : ${conta.operadores}/${OPERADORES.length}`);
console.log(`plano        : ${planos.assinatura().plano || '(nenhum)'}`);
console.log(`bot          : ${bot.painel().config.ativo ? 'ligado' : 'desligado'} · fluxo com ${(bot.getFluxo()?.passos || []).length} passos`);
if (conta.erros.length) { console.log('\navisos:'); conta.erros.forEach((e) => console.log('  -', e)); }

/* Sai com erro quando a semeadura ficou incompleta. Sem isto, um script que
   chama este aqui seguiria em frente achando que a demo esta pronta. */
const faltou = conta.leads < LEADS.length || conta.produtos < PRODUTOS.length || conta.operadores < OPERADORES.length;
if (faltou) { console.error('\nSEMEADURA INCOMPLETA — a demo NAO esta pronta.'); process.exit(1); }
