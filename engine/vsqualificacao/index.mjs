/**
 * VSqualificação — atender não é o mesmo que conduzir uma oportunidade.
 *
 * O bot já responde e já passa para gente. O que faltava era ENTENDER a
 * conversa como negócio e decidir o caminho dela. São três peças, separadas de
 * propósito (a proposta do dono pede isso, e fica mais fácil de auditar):
 *
 *  1. FICHA (qualificar): lê cada mensagem e preenche o que der — intenção,
 *     necessidade, produto, porte, complexidade, prazo. Sem questionário: o que
 *     a pessoa já contou não se pergunta de novo. Só regras, sem IA (custo zero).
 *  2. MATRIZ (decidir): regras em ordem, configuráveis pela empresa. A primeira
 *     que bate decide se o bot segue (Tier 1) ou se vai para uma equipe/vendedor
 *     (Tier 2). Porte sozinho não decide: microempresa pode precisar de
 *     integração, e empresa grande pode querer o produto de prateleira.
 *  3. DISTRIBUIÇÃO (distribuir): dentro da equipe, quem recebe. Carteira primeiro
 *     (cliente que já tem vendedor volta pra ele), depois rodízio entre quem
 *     está ativo. Nunca aleatório: tem que dar pra explicar por que foi fulano.
 *
 * Preço, desconto e condição NÃO moram aqui — o bot continua lendo o catálogo.
 */
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { dentroDaCasa } from '../casa.mjs';

const arq = () => (process.env.VSQUALIFICACAO_DIR ? join(process.env.VSQUALIFICACAO_DIR, 'qualificacao.json') : dentroDaCasa('vsqualificacao', 'qualificacao.json'));
const ler = () => { try { return JSON.parse(readFileSync(arq(), 'utf8')); } catch { return {}; } };
function gravar(d) {
  mkdirSync(dirname(arq()), { recursive: true, mode: 0o700 });
  writeFileSync(arq(), JSON.stringify(d, null, 2), { mode: 0o600 });
  try { chmodSync(arq(), 0o600); } catch { /* FS sem modo */ }
  return d;
}
const agoraIso = () => new Date().toISOString();
export const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* ── 1. ficha ───────────────────────────────────────────────────────────── */

export const INTENCOES = { comprar: 'Comprar', conhecer: 'Conhecer', suporte: 'Suporte', reclamacao: 'Reclamação' };
export const PRAZOS = { imediato: 'Imediato', 'esta-semana': 'Esta semana', 'este-mes': 'Este mês', 'sem-pressa': 'Sem pressa' };

/* Frases por intenção. Ordem importa: reclamação ganha de suporte, que ganha de
   compra — quem diz "comprei e veio quebrado" não está querendo comprar. */
const SINAIS_INTENCAO = [
  ['reclamacao', ['reclamacao', 'reclamar', 'pessimo', 'absurdo', 'descaso', 'procon', 'veio quebrado', 'veio errado', 'nao chegou', 'quero reembolso', 'quero meu dinheiro', 'enganado', 'estou insatisfeit']],
  ['suporte', ['nao funciona', 'parou de funcionar', 'deu erro', 'esta dando erro', 'problema com', 'nao consigo', 'como faco para', 'como configuro', 'suporte', 'ajuda com', 'travou', 'segunda via', 'rastrear', 'rastreio', 'trocar o produto', 'troca de']],
  ['comprar', ['quero comprar', 'quero contratar', 'quero fechar', 'quero assinar', 'vou levar', 'quero pedir', 'quero fazer um pedido', 'fazer pedido', 'como compro', 'como contrato', 'como pago', 'manda o pix', 'aceita pix', 'tem disponivel', 'quero o', 'quero a', 'quero um', 'quero uma', 'preciso de um', 'preciso de uma', 'orcamento', 'proposta', 'cotacao', 'quanto custa', 'qual o valor', 'qual o preco', 'quanto fica', 'tem desconto', 'preciso', 'precisamos', 'queremos', 'estou procurando', 'procuro']],
  ['conhecer', ['queria saber', 'gostaria de saber', 'como funciona', 'quais os planos', 'que tipo de', 'voces fazem', 'voces tem', 'voces trabalham', 'so olhando', 'so pesquisando', 'conhecer', 'informacao', 'informacoes', 'duvida']],
];

/* O que pesa para "personalizada": integração, projeto sob medida, operação
   espalhada. Cada termo vira um motivo legível na ficha. */
const SINAIS_COMPLEXO = ['integracao', 'integrar', 'integrado', 'erp', 'api', 'sistema proprio', 'nosso sistema', 'sob medida', 'personalizad', 'customizad', 'desenvolvimento', 'projeto', 'migracao', 'licitacao', 'contrato anual', 'varias lojas', 'varias unidades', 'filiais', 'franquia', 'multiempresa', 'sap', 'totvs', 'protheus', 'bling', 'omie'];

const NUM_EXTENSO = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, quinze: 15, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, cem: 100 };
const PORTE = [
  ['vendedores', /(vendedor(?:es|as)?|atendentes?|consultor(?:es|as)?|corretor(?:es|as)?)/],
  ['unidades', /(lojas?|unidades?|filia(?:l|is)|franquias?|pontos? de venda|clinicas?|escritorios?)/],
  ['funcionarios', /(funcionari[oa]s?|colaborador(?:es|as)?|pessoas na equipe|empregad[oa]s?)/],
];

function numeroAntes(t, alvo) {
  const re = new RegExp(`(\\d{1,5}|${Object.keys(NUM_EXTENSO).join('|')})\\s+(?:[a-z]+\\s+){0,2}?${alvo.source}`, 'g');
  let maior = null;
  for (const m of t.matchAll(re)) { const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM_EXTENSO[m[1]]; if (n != null) { maior = Math.max(maior ?? 0, n); } }
  return maior;
}

const PRAZO_SINAIS = [
  ['imediato', ['hoje', 'agora', 'urgente', 'o quanto antes', 'pra ja', 'para ja', 'imediato', 'ainda hoje', 'amanha']],
  ['esta-semana', ['essa semana', 'esta semana', 'nesta semana', 'nessa semana', 'ate sexta', 'fim de semana', 'proximos dias']],
  ['este-mes', ['este mes', 'esse mes', 'neste mes', 'nesse mes', 'proximo mes', 'mes que vem', 'semana que vem', 'proxima semana', 'em 15 dias', 'em 30 dias']],
  ['sem-pressa', ['sem pressa', 'so pesquisando', 'so olhando', 'mais pra frente', 'ano que vem', 'futuramente', 'por enquanto nao']],
];

const achou = (t, lista) => lista.filter((x) => t.includes(x));

/** Frase que descreve a necessidade: a primeira que tem "preciso/quero/procuro…", enxuta. */
function necessidadeDe(texto) {
  const partes = String(texto || '').split(/(?<=[.!?\n])\s+/).map((s) => s.trim()).filter(Boolean);
  const alvo = partes.find((s) => /\b(preciso|precisamos|quero|queremos|procuro|procuramos|gostaria|busco|buscamos|estou procurando|tenho interesse|necessito)\b/i.test(s));
  return alvo ? alvo.replace(/\s+/g, ' ').slice(0, 220) : null;
}

/**
 * Lê UMA mensagem e devolve a ficha atualizada. Campo que já estava preenchido
 * só muda quando a mensagem nova diz algo mais forte (porte maior, intenção de
 * reclamação/suporte, prazo mais curto). `produtos` = catálogo ({sku,nome}).
 */
export function qualificar(fichaAtual, texto, { produtos = [], quando = agoraIso() } = {}) {
  const f = { intencao: null, necessidade: null, produtos: [], porte: {}, complexidade: null, sinaisComplexidade: [], prazo: null, mensagens: 0, ...(fichaAtual || {}) };
  f.porte = { ...(f.porte || {}) };
  const t = ` ${norm(texto).replace(/[^a-z0-9$,.\s-]/g, ' ').replace(/\s+/g, ' ')} `;
  if (!t.trim()) { return f; }
  f.mensagens = (f.mensagens || 0) + 1;

  for (const [chave, sinais] of SINAIS_INTENCAO) {
    const h = achou(t, sinais.map((s) => ` ${s}`)).length || achou(t, sinais).length;
    if (!h) { continue; }
    const peso = ['reclamacao', 'suporte', 'comprar', 'conhecer'];
    // Só troca para uma intenção de maior prioridade (reclamação > suporte > compra > conhecer).
    if (!f.intencao || peso.indexOf(chave) < peso.indexOf(f.intencao)) { f.intencao = chave; }
    break;
  }
  if (!f.necessidade) { f.necessidade = necessidadeDe(texto); }

  for (const p of produtos || []) {
    const n = norm(p.nome).trim();
    if (n.length >= 3 && t.includes(` ${n}`) && !f.produtos.includes(p.nome)) { f.produtos.push(p.nome); }
  }
  f.produtos = f.produtos.slice(0, 5);

  for (const [campo, re] of PORTE) {
    const n = numeroAntes(t, re);
    if (n != null && n > (f.porte[campo] || 0)) { f.porte[campo] = n; }
  }

  const complexos = achou(t, SINAIS_COMPLEXO.map((s) => s)).filter((s) => new RegExp(`(^|[^a-z])${s}`).test(t));
  f.sinaisComplexidade = [...new Set([...(f.sinaisComplexidade || []), ...complexos])].slice(0, 8);
  if (f.sinaisComplexidade.length) { f.complexidade = 'personalizada'; }
  else if (!f.complexidade && (f.intencao === 'comprar' || f.produtos.length)) { f.complexidade = 'padrao'; }

  const ordemPrazo = ['imediato', 'esta-semana', 'este-mes', 'sem-pressa'];
  for (const [chave, sinais] of PRAZO_SINAIS) {
    if (achou(t, sinais.map((s) => ` ${s}`)).length) {
      if (!f.prazo || ordemPrazo.indexOf(chave) < ordemPrazo.indexOf(f.prazo)) { f.prazo = chave; }
      break;
    }
  }
  f.atualizadaEm = quando;
  return f;
}

/** O que ainda falta para o vendedor não precisar perguntar de novo. */
export function faltando(f = {}) {
  const out = [];
  if (!f.intencao) { out.push('intenção'); }
  if (!f.necessidade) { out.push('necessidade'); }
  if (!f.produtos?.length && f.intencao !== 'suporte' && f.intencao !== 'reclamacao') { out.push('produto de interesse'); }
  if (!f.prazo && f.intencao === 'comprar') { out.push('prazo'); }
  return out;
}

/* ── 2. matriz ──────────────────────────────────────────────────────────── */

/**
 * Condições que uma regra entende. Todas objetivas — dá pra explicar ao cliente
 * por que a conversa foi para quem foi.
 */
export const CONDICOES = {
  temResponsavel: 'Cliente já tem vendedor responsável',
  intencao: 'Intenção é',
  complexidade: 'Complexidade personalizada',
  porteVendedores: 'Tem pelo menos N vendedores',
  porteUnidades: 'Tem pelo menos N lojas/unidades',
  porteFuncionarios: 'Tem pelo menos N funcionários',
  termo: 'Mensagem contém',
  produto: 'Interesse no produto',
};
export const DESTINOS = { bot: 'Bot continua (Tier 1)', equipe: 'Equipe', responsavel: 'Vendedor responsável' };

/* Padrão do Bolso Cheio, tirado da proposta. A empresa liga/desliga e troca as
   equipes; sem equipe cadastrada, a regra que manda pra equipe fica inerte. */
export const MATRIZ_PADRAO = [
  { id: 'carteira', ativa: true, condicao: 'temResponsavel', destino: 'responsavel', nome: 'Cliente de carteira: quando for para gente, vai para o vendedor dele' },
  { id: 'reclamacao', ativa: true, condicao: 'intencao', valor: 'reclamacao', destino: 'equipe', equipe: 'suporte', nome: 'Reclamação vai para gente, na hora' },
  { id: 'suporte', ativa: false, condicao: 'intencao', valor: 'suporte', destino: 'equipe', equipe: 'suporte', nome: 'Pedido de suporte vai para o suporte' },
  { id: 'personalizada', ativa: true, condicao: 'complexidade', destino: 'equipe', equipe: 'especialistas', nome: 'Integração ou projeto sob medida vai para especialistas' },
  { id: 'porte', ativa: true, condicao: 'porteVendedores', valor: 10, destino: 'equipe', equipe: 'corporativo', nome: 'Operação com 10+ vendedores vai para vendas corporativas' },
  { id: 'unidades', ativa: true, condicao: 'porteUnidades', valor: 3, destino: 'equipe', equipe: 'corporativo', nome: 'Três ou mais lojas vão para vendas corporativas' },
];

export function config() {
  const d = ler();
  return { matriz: Array.isArray(d.matriz) ? d.matriz : MATRIZ_PADRAO.map((r) => ({ ...r })), mensagemTransferencia: d.mensagemTransferencia || MENSAGEM_PADRAO, rodizio: d.rodizio || {} };
}
export const MENSAGEM_PADRAO = 'Entendi. Para isso vou chamar nossa equipe {equipe} — já passei o que você me contou, não vai precisar repetir. Em instantes alguém continua com você aqui.';

function validarRegra(r, i) {
  const erro = (m) => ({ erro: `regra ${i + 1}: ${m}` });
  if (!CONDICOES[r.condicao]) { return erro('condição desconhecida'); }
  if (!DESTINOS[r.destino]) { return erro('destino desconhecido'); }
  if (r.destino === 'equipe' && !norm(r.equipe).trim()) { return erro('diga para qual equipe'); }
  if (r.condicao === 'intencao' && !INTENCOES[r.valor]) { return erro('escolha a intenção'); }
  if (/^porte/.test(r.condicao) && !(Number(r.valor) >= 1)) { return erro('informe o número mínimo'); }
  if ((r.condicao === 'termo' || r.condicao === 'produto') && !String(r.valor || '').trim()) { return erro('informe o termo'); }
  return {
    regra: {
      id: String(r.id || `r${Date.now().toString(36)}${i}`).slice(0, 40), ativa: r.ativa !== false,
      nome: String(r.nome || '').trim().slice(0, 120) || `${CONDICOES[r.condicao]} → ${DESTINOS[r.destino]}`,
      condicao: r.condicao, valor: /^porte/.test(r.condicao) ? Number(r.valor) : r.valor != null ? String(r.valor).trim().slice(0, 80) : undefined,
      destino: r.destino, equipe: r.destino === 'equipe' ? norm(r.equipe).trim().slice(0, 60) : undefined,
    },
  };
}

export function salvarConfig({ matriz, mensagemTransferencia } = {}) {
  const d = ler();
  if (matriz === null) { delete d.matriz; } else if (matriz !== undefined) {
    if (!Array.isArray(matriz) || matriz.length > 30) { return { ok: false, erro: 'matriz inválida (até 30 regras)' }; }
    const out = [];
    for (const [i, r] of matriz.entries()) { const v = validarRegra(r || {}, i); if (v.erro) { return { ok: false, erro: v.erro }; } out.push(v.regra); }
    d.matriz = out;
  }
  if (mensagemTransferencia !== undefined) { d.mensagemTransferencia = String(mensagemTransferencia || '').trim().slice(0, 500) || MENSAGEM_PADRAO; }
  gravar(d);
  return { ok: true, ...config() };
}

function bate(r, ficha, ctx) {
  const f = ficha || {};
  switch (r.condicao) {
    case 'temResponsavel': return !!ctx.responsavel;
    case 'intencao': return f.intencao === r.valor;
    case 'complexidade': return f.complexidade === 'personalizada';
    case 'porteVendedores': return (f.porte?.vendedores || 0) >= r.valor;
    case 'porteUnidades': return (f.porte?.unidades || 0) >= r.valor;
    case 'porteFuncionarios': return (f.porte?.funcionarios || 0) >= r.valor;
    case 'termo': return norm(ctx.texto || '').includes(norm(r.valor));
    case 'produto': return (f.produtos || []).some((p) => norm(p).includes(norm(r.valor)));
    default: return false;
  }
}

/**
 * A decisão. Primeira regra ativa que bate ganha — e só vale se tiver pra onde
 * ir: equipe sem ninguém ativo não recebe (o cliente ficaria esperando o vazio),
 * então a matriz segue para a próxima regra.
 *
 * @param {'mensagem'|'handoff'} gatilho  mensagem = decidir se sai do bot; handoff = o bot já passou pra gente, decidir PRA QUEM
 * @returns {{tier:1|2, destino:'bot'|'equipe'|'responsavel', equipe?, regra?, motivo, proximaAcao}}
 */
export function decidir(ficha, { responsavel = null, texto = '', equipesComGente = null, matriz, gatilho = 'mensagem' } = {}) {
  /* Ter vendedor NÃO tira a conversa do bot: quem já é cliente e só quer repetir
     o pedido de sempre segue com o bot. A carteira decide QUEM atende quando a
     conversa for para gente (gatilho 'handoff'). */
  const regras = (matriz || config().matriz).filter((r) => r.ativa !== false && !(gatilho === 'mensagem' && r.condicao === 'temResponsavel'));
  const pulei = [];
  for (const r of regras) {
    if (!bate(r, ficha, { responsavel, texto })) { continue; }
    if (r.destino === 'bot') { return { tier: 1, destino: 'bot', regra: r.id, motivo: r.nome, proximaAcao: 'Bot conduz a venda' }; }
    if (r.destino === 'responsavel') {
      if (!responsavel) { continue; }
      return { tier: 2, destino: 'responsavel', responsavel, equipe: responsavel.equipe || null, regra: r.id, motivo: r.nome, proximaAcao: proximaAcao(ficha) };
    }
    if (equipesComGente && !equipesComGente.includes(r.equipe)) { pulei.push(r.equipe); continue; }
    return { tier: 2, destino: 'equipe', equipe: r.equipe, regra: r.id, motivo: r.nome, proximaAcao: proximaAcao(ficha) };
  }
  return { tier: 1, destino: 'bot', regra: null, motivo: pulei.length ? `nenhuma regra com gente disponível (sem atendente em: ${[...new Set(pulei)].join(', ')})` : 'nenhuma regra de transferência bateu', proximaAcao: 'Bot conduz a venda' };
}

export function proximaAcao(f = {}) {
  if (f.intencao === 'reclamacao') { return 'Acolher a reclamação e resolver'; }
  if (f.intencao === 'suporte') { return 'Resolver o problema relatado'; }
  if (f.complexidade === 'personalizada') { return (f.sinaisComplexidade || []).some((s) => /integr|erp|api|sap|totvs|protheus|bling|omie/.test(s)) ? 'Avaliar a integração e o escopo' : 'Levantar o escopo do projeto'; }
  if (f.intencao === 'comprar') { return f.produtos?.length ? 'Fechar o pedido' : 'Entender o que ele quer comprar'; }
  return 'Entender a necessidade';
}

/** Resumo de uma frase para o vendedor não começar do zero. */
export function resumo(f = {}, nome) {
  const partes = [];
  if (f.intencao) { partes.push(`${INTENCOES[f.intencao]}`); }
  const porte = [f.porte?.unidades && `${f.porte.unidades} unidade(s)`, f.porte?.vendedores && `${f.porte.vendedores} vendedor(es)`, f.porte?.funcionarios && `${f.porte.funcionarios} funcionário(s)`].filter(Boolean);
  if (porte.length) { partes.push(porte.join(', ')); }
  if (f.produtos?.length) { partes.push(`interesse em ${f.produtos.join(', ')}`); }
  if (f.complexidade === 'personalizada') { partes.push(`precisa de algo sob medida (${(f.sinaisComplexidade || []).slice(0, 3).join(', ')})`); }
  if (f.prazo) { partes.push(`prazo: ${PRAZOS[f.prazo].toLowerCase()}`); }
  const base = partes.length ? partes.join(' · ') : 'Ainda sem informação comercial';
  return `${nome ? nome + ': ' : ''}${base}${f.necessidade ? ` — “${f.necessidade}”` : ''}`;
}

/* ── 3. distribuição ────────────────────────────────────────────────────── */

/**
 * Quem da equipe recebe. `operadores` = ativos ({id, nome, setor}).
 * Rodízio guardado por equipe: o próximo depois do último que recebeu.
 */
export function distribuir(equipe, operadores = []) {
  const eq = norm(equipe).trim();
  const time = operadores.filter((o) => o.ativo !== false && norm(o.setor).trim() === eq).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (!time.length) { return null; }
  const d = ler();
  const ultimo = d.rodizio?.[eq];
  const i = time.findIndex((o) => o.id === ultimo);
  const escolhido = time[(i + 1) % time.length];
  d.rodizio = { ...(d.rodizio || {}), [eq]: escolhido.id };
  gravar(d);
  return { operadorId: escolhido.id, nome: escolhido.nome, equipe: eq, motivo: time.length > 1 ? `rodízio da equipe ${eq}` : `único da equipe ${eq}` };
}
