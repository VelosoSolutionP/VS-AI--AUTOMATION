/**
 * VSorcamentos — o orçamento feito DENTRO da conversa.
 *
 * O que se ouve de quem vende: "pra mandar um orçamento eu tenho que sair do
 * WhatsApp, entrar num sistema ruim, montar, exportar e voltar". Aqui o
 * vendedor monta com o cliente na tela, o cliente recebe na mesma conversa (PDF
 * + link) e aprova com um toque. O resto — funil, cobrança — já existe e só é
 * chamado.
 *
 * Regras que não se negociam:
 *  - Dinheiro em CENTAVOS inteiros. Nada de float em valor: 3 × R$ 0,10 não
 *    pode virar R$ 0,30000000000000004 num documento que o cliente assina.
 *  - Orçamento ENVIADO não muda. O cliente aprovou o que leu; mudar depois seria
 *    trocar o combinado. Precisa mudar? Duplica e manda outro.
 *  - O link público carrega um código secreto (não o número): ORC-2026-0001 é
 *    fácil de adivinhar, e com ele qualquer um veria o orçamento do vizinho.
 *  - Vencido não aprova. A validade é o prazo que o vendedor segurou o preço.
 *
 * Funções puras + um arquivo JSON na casa, como as outras engines.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { dentroDaCasa } from '../casa.mjs';

const arq = () => (process.env.VSORCAMENTOS_DIR ? join(process.env.VSORCAMENTOS_DIR, 'orcamentos.json') : dentroDaCasa('vsorcamentos', 'orcamentos.json'));
const ler = () => { try { return JSON.parse(readFileSync(arq(), 'utf8')); } catch { return []; } };
const gravar = (lista) => {
  mkdirSync(dirname(arq()), { recursive: true, mode: 0o700 });
  writeFileSync(arq(), JSON.stringify(lista, null, 2), { mode: 0o600 });
};

/* ── Ligar/desligar por NEGÓCIO ───────────────────────────────────────────
   Orçamento é de quem vende sob consulta ou presta serviço (evento, projeto,
   instalação, B2B). Loja de pronta entrega — peça, lanche — vende por PEDIDO:
   ninguém manda orçamento de hambúrguer. Por isso nasce DESLIGADO e o dono liga. */
const arqCfg = () => join(dirname(arq()), 'config.json');
export function config() {
  try { const c = JSON.parse(readFileSync(arqCfg(), 'utf8')); return { ligado: c.ligado === true, ligadoEm: c.ligadoEm || null, por: c.por || null }; }
  catch { return { ligado: false, ligadoEm: null, por: null }; }
}
export function configurar({ ligado } = {}, { por = null, agora = new Date() } = {}) {
  const c = { ligado: ligado === true, ligadoEm: hojeISO(agora), por };
  mkdirSync(dirname(arqCfg()), { recursive: true, mode: 0o700 });
  writeFileSync(arqCfg(), JSON.stringify(c, null, 2), { mode: 0o600 });
  return { ok: true, config: c };
}
export const DESLIGADO = 'o orçamento está desligado neste negócio — o dono liga em Orçamentos (é pra quem vende sob consulta ou presta serviço)';

export const SITUACOES = Object.freeze({
  rascunho: 'Rascunho',
  enviado: 'Enviado',
  aprovado: 'Aprovado',
  recusado: 'Recusado',
  vencido: 'Vencido',
  cancelado: 'Cancelado',
});
export const VALIDADE_PADRAO = 7;
const MAX_ITENS = 100;

export const emReais = (c) => `R$ ${(Math.round(Number(c) || 0) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;

/** "1.234,56" | "1234.56" | 1234.56 | "R$ 10" → centavos. Inválido → null. */
export function centavos(v) {
  if (v === null || v === undefined || v === '') { return null; }
  if (typeof v === 'number') { return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null; }
  let s = String(v).replace(/[R$\s]/g, '');
  if (!s) { return null; }
  if (s.includes(',')) { s = s.replace(/\./g, '').replace(',', '.'); }
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

const hojeISO = (agora = new Date()) => new Date(agora).toISOString();
const somaDias = (iso, dias) => { const d = new Date(iso); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); };
/* Campo em branco na tela = zero, não "inválido". */
const vazio = (v) => v === null || v === undefined || String(v).trim() === '';
const texto = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Valida e normaliza os itens e os valores. Devolve { erros, itens, subtotal, desconto, frete, total }.
 *
 * Com `catalogo` (o Estoque da loja), SÓ entra produto cadastrado, com o nome e
 * o preço de lá. Item livre deixava orçar camisa numa lanchonete: o catálogo é o
 * nicho da loja, e o orçamento não sai dele. Negociação vai no desconto.
 */
export function calcular(d = {}, { catalogo = null } = {}) {
  const doCat = catalogo ? new Map(catalogo.map((p) => [String(p.sku), p])) : null;
  const erros = [];
  const brutos = Array.isArray(d.itens) ? d.itens : [];
  if (!brutos.length) { erros.push('coloque pelo menos um item'); }
  if (brutos.length > MAX_ITENS) { erros.push(`no máximo ${MAX_ITENS} itens por orçamento`); }
  const itens = brutos.slice(0, MAX_ITENS).map((b, i) => {
    const prod = doCat ? doCat.get(String(b.sku || '')) : null;
    if (doCat && !prod) { erros.push(`item ${i + 1}: escolha um produto do catálogo`); }
    const descricao = prod ? texto(prod.nome, 200) : texto(b.descricao ?? b.nome, 200);
    const q = Number(String(b.quantidade ?? 1).replace(',', '.'));
    const preco = prod ? Math.round(Number(prod.precoCentavos)) : b.precoCentavos != null ? Math.round(Number(b.precoCentavos)) : centavos(b.preco);
    if (!descricao && !doCat) { erros.push(`item ${i + 1}: falta a descrição`); }
    if (!Number.isFinite(q) || q <= 0 || q > 1e6) { erros.push(`item ${i + 1}: quantidade inválida`); }
    if (preco === null || !Number.isFinite(preco) || preco < 0) { erros.push(`item ${i + 1}: valor inválido`); }
    const quantidade = Number.isFinite(q) && q > 0 ? Math.round(q * 1000) / 1000 : 0;
    const precoCentavos = Number.isFinite(preco) && preco >= 0 ? preco : 0;
    return {
      descricao, quantidade, precoCentavos,
      unidade: texto(b.unidade, 12) || null,
      sku: prod ? String(prod.sku) : texto(b.sku, 60) || null,
      totalCentavos: Math.round(quantidade * precoCentavos),
    };
  });
  const subtotal = itens.reduce((s, i) => s + i.totalCentavos, 0);

  const tipo = d.desconto?.tipo === 'percentual' ? 'percentual' : 'valor';
  let desconto = 0;
  if (tipo === 'percentual') {
    const p = Number(String(d.desconto?.valor ?? 0).replace(',', '.'));
    if (!Number.isFinite(p) || p < 0 || p > 100) { erros.push('desconto em % precisa ficar entre 0 e 100'); } else { desconto = Math.round(subtotal * p / 100); }
  } else {
    const v = centavos(vazio(d.desconto?.valor) ? 0 : d.desconto.valor);
    if (v === null) { erros.push('desconto inválido'); } else { desconto = v; }
  }
  if (desconto > subtotal) { erros.push('o desconto é maior que o valor dos itens'); desconto = subtotal; }
  const frete = centavos(vazio(d.frete) ? 0 : d.frete);
  if (frete === null) { erros.push('frete inválido'); }
  return {
    erros, itens, subtotalCentavos: subtotal, descontoCentavos: desconto,
    desconto: { tipo, valor: tipo === 'percentual' ? Number(String(d.desconto?.valor ?? 0).replace(',', '.')) || 0 : desconto },
    freteCentavos: frete || 0,
    totalCentavos: Math.max(0, subtotal - desconto + (frete || 0)),
  };
}

function proximoNumero(lista, agora) {
  const ano = new Date(agora).getUTCFullYear();
  const doAno = lista.map((o) => String(o.numero || '')).filter((n) => n.startsWith(`ORC-${ano}-`)).map((n) => Number(n.split('-')[2]) || 0);
  return `ORC-${ano}-${String((doAno.length ? Math.max(...doAno) : 0) + 1).padStart(4, '0')}`;
}

/** Situação que VALE agora: enviado com a validade passada é vencido, mesmo antes do arquivo saber. */
export function situacaoDe(o, agora = new Date()) {
  if (o?.situacao === 'enviado' && o.validoAte && new Date(agora).toISOString().slice(0, 10) > o.validoAte) { return 'vencido'; }
  return o?.situacao || 'rascunho';
}
const comSituacao = (o, agora) => (o ? { ...o, situacao: situacaoDe(o, agora) } : null);

/** Cria ou atualiza um RASCUNHO. Enviado não se edita. */
export function salvar(d = {}, { por = null, agora = new Date(), catalogo = null } = {}) {
  if (!config().ligado) { return { ok: false, motivo: DESLIGADO, desligado: true }; }
  const lista = ler();
  const atual = d.id ? lista.find((o) => o.id === d.id) : null;
  if (d.id && !atual) { return { ok: false, motivo: 'orçamento não encontrado' }; }
  if (atual && atual.situacao !== 'rascunho') { return { ok: false, motivo: 'orçamento já enviado não muda — duplique para mandar outro' }; }
  const c = calcular(d, { catalogo });
  if (catalogo && !catalogo.length) { c.erros.unshift('o catálogo está vazio — cadastre os produtos no Estoque pra fazer orçamento'); }
  const telefone = String(d.cliente?.telefone ?? atual?.cliente?.telefone ?? '').replace(/\D/g, '');
  if (!telefone) { c.erros.push('orçamento sem cliente: abra pela conversa'); }
  const dias = Number(d.validadeDias ?? atual?.validadeDias ?? VALIDADE_PADRAO);
  if (!Number.isInteger(dias) || dias < 1 || dias > 90) { c.erros.push('validade entre 1 e 90 dias'); }
  if (c.erros.length) { return { ok: false, motivo: c.erros[0], erros: c.erros }; }
  const iso = hojeISO(agora);
  const o = {
    ...(atual || { id: 'orc_' + randomBytes(6).toString('hex'), numero: proximoNumero(lista, agora), token: randomBytes(18).toString('base64url'), criadoEm: iso, situacao: 'rascunho', historico: [] }),
    cliente: {
      nome: texto(d.cliente?.nome ?? atual?.cliente?.nome, 120) || 'Cliente',
      telefone,
      canal: d.cliente?.canal === 'telegram' || (!d.cliente?.canal && atual?.cliente?.canal === 'telegram') ? 'telegram' : 'whatsapp',
      documento: texto(d.cliente?.documento ?? atual?.cliente?.documento, 30) || null,
    },
    vendedor: d.vendedor ? { nome: texto(d.vendedor.nome, 80) || null, email: texto(d.vendedor.email, 120) || null } : (atual?.vendedor || (por ? { nome: null, email: por } : null)),
    itens: c.itens,
    subtotalCentavos: c.subtotalCentavos,
    desconto: c.desconto,
    descontoCentavos: c.descontoCentavos,
    freteCentavos: c.freteCentavos,
    totalCentavos: c.totalCentavos,
    validadeDias: dias,
    condicoes: texto(d.condicoes ?? atual?.condicoes, 600) || null,
    observacoes: texto(d.observacoes ?? atual?.observacoes, 600) || null,
    atualizadoEm: iso,
  };
  o.historico = [...(o.historico || []), { quando: iso, evento: atual ? 'editado' : 'criado', por }];
  gravar([...lista.filter((x) => x.id !== o.id), o]);
  return { ok: true, orcamento: o };
}

/** Marca como enviado (a validade começa a contar AGORA). Quem manda a mensagem é o servidor. */
export function marcarEnviado(id, { por = null, agora = new Date() } = {}) {
  if (!config().ligado) { return { ok: false, motivo: DESLIGADO, desligado: true }; }
  const lista = ler();
  const o = lista.find((x) => x.id === id);
  if (!o) { return { ok: false, motivo: 'orçamento não encontrado' }; }
  if (!['rascunho', 'enviado'].includes(o.situacao)) { return { ok: false, motivo: `orçamento ${SITUACOES[situacaoDe(o, agora)].toLowerCase()} não pode ser enviado` }; }
  const iso = hojeISO(agora);
  const reenvio = o.situacao === 'enviado';
  if (reenvio && situacaoDe(o, agora) === 'vencido') { return { ok: false, motivo: 'orçamento vencido — duplique para mandar um novo' }; }
  const novo = { ...o, situacao: 'enviado', enviadoEm: o.enviadoEm || iso,
    validoAte: o.validoAte || somaDias(iso, o.validadeDias || VALIDADE_PADRAO),
    historico: [...(o.historico || []), { quando: iso, evento: reenvio ? 'reenviado' : 'enviado', por }] };
  gravar(lista.map((x) => (x.id === id ? novo : x)));
  return { ok: true, orcamento: novo, reenvio };
}

/**
 * A mensagem não saiu: volta a rascunho. Sem isto o painel diria "Enviado" de
 * um orçamento que o cliente nunca recebeu — e a validade correria à toa.
 */
export function desfazerEnvio(id) {
  const lista = ler();
  const o = lista.find((x) => x.id === id);
  if (!o || o.situacao !== 'enviado' || o.respondidoEm) { return { ok: false }; }
  const h = [...(o.historico || [])];
  if (h.at(-1)?.evento === 'enviado') { h.pop(); }
  const { enviadoEm: _e, validoAte: _v, ...resto } = o;
  gravar(lista.map((x) => (x.id === id ? { ...resto, situacao: 'rascunho', historico: h } : x)));
  return { ok: true };
}

/** O cliente, pelo link: aprova ou recusa. Só vale para enviado dentro da validade. */
export function responder(token, acao, { motivo = null, agora = new Date() } = {}) {
  const lista = ler();
  const o = lista.find((x) => x.token && x.token === String(token || ''));
  if (!o) { return { ok: false, motivo: 'orçamento não encontrado' }; }
  const sit = situacaoDe(o, agora);
  if (sit === 'aprovado' && acao === 'aprovar') { return { ok: true, orcamento: o, jaEstava: true }; }
  if (sit !== 'enviado') { return { ok: false, motivo: `este orçamento está ${SITUACOES[sit].toLowerCase()}`, situacao: sit }; }
  if (!['aprovar', 'recusar'].includes(acao)) { return { ok: false, motivo: 'ação inválida' }; }
  const iso = hojeISO(agora);
  const novo = { ...o, situacao: acao === 'aprovar' ? 'aprovado' : 'recusado',
    respondidoEm: iso, motivoRecusa: acao === 'recusar' ? texto(motivo, 300) || null : null,
    historico: [...(o.historico || []), { quando: iso, evento: acao === 'aprovar' ? 'aprovado pelo cliente' : 'recusado pelo cliente', por: 'cliente' }] };
  gravar(lista.map((x) => (x.id === o.id ? novo : x)));
  return { ok: true, orcamento: novo };
}

export function cancelar(id, { por = null, agora = new Date() } = {}) {
  const lista = ler();
  const o = lista.find((x) => x.id === id);
  if (!o) { return { ok: false, motivo: 'orçamento não encontrado' }; }
  if (['aprovado', 'cancelado'].includes(o.situacao)) { return { ok: false, motivo: `orçamento ${SITUACOES[o.situacao].toLowerCase()} não pode ser cancelado` }; }
  const iso = hojeISO(agora);
  const novo = { ...o, situacao: 'cancelado', historico: [...(o.historico || []), { quando: iso, evento: 'cancelado', por }] };
  gravar(lista.map((x) => (x.id === id ? novo : x)));
  return { ok: true, orcamento: novo };
}

/** Novo rascunho com os mesmos itens: é assim que se "edita" o que já foi enviado. */
export function duplicar(id, { por = null, agora = new Date(), catalogo = null } = {}) {
  const o = ler().find((x) => x.id === id);
  if (!o) { return { ok: false, motivo: 'orçamento não encontrado' }; }
  return salvar({ cliente: o.cliente, vendedor: o.vendedor, itens: o.itens, desconto: o.desconto.tipo === 'percentual' ? o.desconto : { tipo: 'valor', valor: o.descontoCentavos / 100 },
    frete: o.freteCentavos / 100, validadeDias: o.validadeDias, condicoes: o.condicoes, observacoes: o.observacoes }, { por, agora, catalogo });
}

/** Guarda a cobrança gerada a partir do orçamento aprovado. */
export function marcarCobrado(id, { referencia, pagamentoId = null, por = null, agora = new Date() } = {}) {
  const lista = ler();
  const o = lista.find((x) => x.id === id);
  if (!o) { return { ok: false, motivo: 'orçamento não encontrado' }; }
  const iso = hojeISO(agora);
  const novo = { ...o, cobranca: { referencia, pagamentoId, em: iso }, historico: [...(o.historico || []), { quando: iso, evento: `cobrança ${referencia} enviada`, por }] };
  gravar(lista.map((x) => (x.id === id ? novo : x)));
  return { ok: true, orcamento: novo };
}

export const obter = (id, agora = new Date()) => comSituacao(ler().find((x) => x.id === id), agora);
export const porToken = (token, agora = new Date()) => comSituacao(ler().find((x) => x.token && x.token === String(token || '')), agora);

/** Lista (mais novo primeiro). Filtros: telefone, situacao, dias (criados nos últimos N dias), vendedorEmail. */
export function listar({ telefone, situacao, dias, vendedorEmail, agora = new Date() } = {}) {
  const desde = dias ? new Date(new Date(agora).getTime() - Number(dias) * 86400000).toISOString() : null;
  const tel = telefone ? String(telefone).replace(/\D/g, '') : null;
  return ler().map((o) => comSituacao(o, agora))
    .filter((o) => (!tel || o.cliente?.telefone === tel) && (!situacao || o.situacao === situacao) && (!desde || o.criadoEm >= desde)
      && (!vendedorEmail || o.vendedor?.email === vendedorEmail))
    .sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
}

/** Números do período: quanto se orçou (enviados), quanto foi aprovado e a taxa. Rascunho e cancelado não contam. */
export function resumo({ dias = 30, agora = new Date() } = {}) {
  const lista = listar({ dias, agora });
  const conta = Object.fromEntries(Object.keys(SITUACOES).map((k) => [k, 0]));
  lista.forEach((o) => { conta[o.situacao] = (conta[o.situacao] || 0) + 1; });
  const mandados = lista.filter((o) => !['rascunho', 'cancelado'].includes(o.situacao));
  const aprovados = lista.filter((o) => o.situacao === 'aprovado');
  const respondidos = lista.filter((o) => ['aprovado', 'recusado', 'vencido'].includes(o.situacao)).length;
  return {
    dias, quantidade: conta,
    orcadoCentavos: mandados.reduce((s, o) => s + o.totalCentavos, 0),
    aprovadoCentavos: aprovados.reduce((s, o) => s + o.totalCentavos, 0),
    /* Taxa sobre quem JÁ decidiu: enviado ainda no prazo não é "não". */
    taxaAprovacao: respondidos ? Math.round((aprovados.length / respondidos) * 100) : null,
  };
}

const dataBr = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const qtdTxt = (q) => String(q).replace('.', ',');

/** A mensagem que vai na conversa junto com o PDF. Curta: o detalhe está no documento. */
export function mensagem(o, url, { loja = null } = {}) {
  const linhas = o.itens.slice(0, 5).map((i) => `• ${qtdTxt(i.quantidade)}${i.unidade ? ' ' + i.unidade : 'x'} ${i.descricao} — ${emReais(i.totalCentavos)}`);
  if (o.itens.length > 5) { linhas.push(`• e mais ${o.itens.length - 5} item(ns)`); }
  return [
    `Olá, ${o.cliente.nome.split(' ')[0]}! Segue o orçamento *${o.numero}*${loja ? ` da ${loja}` : ''}:`,
    '',
    ...linhas,
    '',
    o.descontoCentavos ? `Desconto: − ${emReais(o.descontoCentavos)}` : null,
    o.freteCentavos ? `Frete: ${emReais(o.freteCentavos)}` : null,
    `*Total: ${emReais(o.totalCentavos)}*`,
    `Válido até ${dataBr(o.validoAte)}.`,
    '',
    `Pra ver completo e aprovar: ${url}`,
  ].filter((l) => l !== null).join('\n');
}

const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * O documento: a MESMA página serve pro link (com Aprovar/Recusar) e pro PDF
 * (sem botões). Uma fonte só — o que o cliente aprova é exatamente o que leu.
 */
export function html(o, { loja = 'Nossa loja', url = null, publico = true, aviso = null, agora = new Date() } = {}) {
  const sit = situacaoDe(o, agora);
  const linhas = o.itens.map((i) => `<tr><td>${escH(i.descricao)}${i.sku ? `<small>${escH(i.sku)}</small>` : ''}</td><td class="n">${escH(qtdTxt(i.quantidade))}${i.unidade ? ' ' + escH(i.unidade) : ''}</td><td class="n">${emReais(i.precoCentavos)}</td><td class="n">${emReais(i.totalCentavos)}</td></tr>`).join('');
  const selo = { enviado: ['Aguardando sua aprovação', 'aguarda'], aprovado: ['Aprovado', 'ok'], recusado: ['Recusado', 'nao'], vencido: ['Vencido', 'nao'], cancelado: ['Cancelado', 'nao'], rascunho: ['Rascunho', 'aguarda'] }[sit];
  const acoes = publico && sit === 'enviado' && url ? `
  <form class="acoes" method="post" action="${escH(url)}/aprovar"><button class="bt ok" type="submit">Aprovar orçamento</button></form>
  <details class="recusa"><summary>Não vou seguir com este orçamento</summary>
    <form method="post" action="${escH(url)}/recusar"><textarea name="motivo" maxlength="300" placeholder="Se quiser, conte o motivo (opcional)"></textarea><button class="bt" type="submit">Recusar</button></form></details>` : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Orçamento ${escH(o.numero)} — ${escH(loja)}</title>
<style>
@page{size:A4;margin:16mm 14mm}
*{box-sizing:border-box}body{margin:0;background:#f4f5f7;color:#16161c;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.pg{max-width:820px;margin:0 auto;padding:28px 18px 48px}
.doc{background:#fff;border:1px solid #e3e5ea;border-radius:16px;padding:32px clamp(18px,4vw,40px)}
.top{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;border-bottom:2px solid #15803d;padding-bottom:16px}
.top h1{margin:0;font-size:22px}.top .num{font:700 15px ui-monospace,monospace;color:#15803d}
.top small{display:block;color:#5b616e}
.selo{display:inline-block;padding:4px 12px;border-radius:99px;font-size:13px;font-weight:600;margin-top:6px}
.selo.aguarda{background:#fef3c7;color:#92400e}.selo.ok{background:#dcfce7;color:#166534}.selo.nao{background:#fee2e2;color:#991b1b}
.blk{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:18px 0}
.blk div{background:#f8f9fb;border-radius:10px;padding:10px 14px}.blk b{display:block;font-size:12px;color:#5b616e;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
table{width:100%;border-collapse:collapse;margin-top:6px}th,td{padding:10px 8px;border-bottom:1px solid #eceef2;text-align:left;vertical-align:top}
th{font-size:12px;color:#5b616e;text-transform:uppercase;letter-spacing:.04em}td small{display:block;color:#8a8f99;font-size:12px}
.n{text-align:right;white-space:nowrap}
.tot{margin:14px 0 0 auto;max-width:320px}.tot div{display:flex;justify-content:space-between;padding:5px 0}
.tot .g{border-top:2px solid #16161c;margin-top:6px;padding-top:10px;font-size:19px;font-weight:700}
.obs{margin-top:22px;padding:14px 16px;background:#f8f9fb;border-radius:10px;white-space:pre-line}.obs b{display:block;margin-bottom:4px}
.aviso{margin:0 0 16px;padding:12px 16px;border-radius:12px;background:#dcfce7;color:#166534;font-weight:600}
.aviso.nao{background:#fee2e2;color:#991b1b}
.acoes{margin-top:26px}.bt{font:600 16px system-ui;border:1px solid #d3d6dd;background:#fff;color:#16161c;padding:14px 22px;border-radius:12px;cursor:pointer}
.bt.ok{background:#15803d;border-color:#15803d;color:#fff;width:100%}
.recusa{margin-top:14px;color:#5b616e}.recusa textarea{width:100%;min-height:70px;margin:10px 0;padding:10px;border-radius:10px;border:1px solid #d3d6dd;font:inherit}
.rod{margin-top:26px;color:#8a8f99;font-size:12.5px;text-align:center}
@media print{body{background:#fff}.pg{padding:0}.doc{border:0;padding:0}.acoes,.recusa{display:none}}
</style></head><body><div class="pg">
${aviso ? `<p class="aviso${aviso.tipo === 'nao' ? ' nao' : ''}">${escH(aviso.texto)}</p>` : ''}
<div class="doc">
  <div class="top"><div><h1>${escH(loja)}</h1><small>Orçamento</small></div>
    <div style="text-align:right"><span class="num">${escH(o.numero)}</span><small>Emitido em ${dataBr(o.enviadoEm || o.criadoEm)}</small><span class="selo ${selo[1]}">${selo[0]}</span></div></div>
  <div class="blk">
    <div><b>Cliente</b>${escH(o.cliente.nome)}${o.cliente.documento ? `<br><small>${escH(o.cliente.documento)}</small>` : ''}</div>
    <div><b>Válido até</b>${dataBr(o.validoAte || somaDias(o.criadoEm, o.validadeDias || VALIDADE_PADRAO))}</div>
    ${o.vendedor?.nome ? `<div><b>Atendido por</b>${escH(o.vendedor.nome)}</div>` : ''}
  </div>
  <table><thead><tr><th>Item</th><th class="n">Qtd.</th><th class="n">Valor unit.</th><th class="n">Total</th></tr></thead><tbody>${linhas}</tbody></table>
  <div class="tot">
    <div><span>Subtotal</span><span>${emReais(o.subtotalCentavos)}</span></div>
    ${o.descontoCentavos ? `<div><span>Desconto${o.desconto?.tipo === 'percentual' ? ` (${String(o.desconto.valor).replace('.', ',')}%)` : ''}</span><span>− ${emReais(o.descontoCentavos)}</span></div>` : ''}
    ${o.freteCentavos ? `<div><span>Frete</span><span>${emReais(o.freteCentavos)}</span></div>` : ''}
    <div class="g"><span>Total</span><span>${emReais(o.totalCentavos)}</span></div>
  </div>
  ${o.condicoes ? `<div class="obs"><b>Condições</b>${escH(o.condicoes)}</div>` : ''}
  ${o.observacoes ? `<div class="obs"><b>Observações</b>${escH(o.observacoes)}</div>` : ''}
  ${acoes}
</div>
<p class="rod">Orçamento gerado pelo Bolso Cheio · ${escH(loja)}</p>
</div></body></html>`;
}
