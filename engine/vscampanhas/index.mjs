/**
 * VScampanhas — preparar, auditar e aprovar uma divulgação antes de ela contar.
 *
 * O `vsresultados` já sabia medir um link (/start com código). O que faltava era
 * o caminho até o link: escolher o produto, montar a publicação, conferir o
 * material e só então liberar. Aqui mora esse caminho:
 *
 *  - CONTEÚDO: objetivo, produto do catálogo, texto, imagem, código do link.
 *  - AUDITORIA: regras objetivas (sem IA, custo zero), guardada POR VERSÃO do
 *    material — só roda de novo quando texto, imagem, produto ou o catálogo mudam.
 *  - ESTADO DA CAMPANHA: rascunho → em revisão / aguardando aprovação → ativa →
 *    encerrada. Publicar em canal e agendar são ESTADOS DA PUBLICAÇÃO (outra
 *    entrega) — campanha só com link já pode estar ativa.
 *
 * O código só entra no registro do `vsresultados` NA APROVAÇÃO: rascunho não
 * atribui conversa nem venda. Quem clica num link de rascunho cai no bot como
 * qualquer um, sem campanha marcada.
 */
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { dentroDaCasa } from '../casa.mjs';
import * as resultados from '../vsresultados/index.mjs';

const arq = () => (process.env.VSCAMPANHAS_DIR ? join(process.env.VSCAMPANHAS_DIR, 'campanhas.json') : dentroDaCasa('vscampanhas', 'campanhas.json'));
const ler = () => { try { return { campanhas: [], ...JSON.parse(readFileSync(arq(), 'utf8')) }; } catch { return { campanhas: [] }; } };
function gravar(d) {
  mkdirSync(dirname(arq()), { recursive: true, mode: 0o700 });
  writeFileSync(arq(), JSON.stringify(d, null, 2), { mode: 0o600 });
  try { chmodSync(arq(), 0o600); } catch { /* FS sem modo */ }
  return d;
}
const agoraIso = () => new Date().toISOString();

export const OBJETIVOS = {
  produto: 'Divulgar produto',
  promocao: 'Criar promoção',
  evento: 'Divulgar evento',
  captar: 'Captar clientes',
};
export const ESTADOS = {
  rascunho: 'Rascunho',
  'em-revisao': 'Em revisão',
  'aguardando-aprovacao': 'Aguardando aprovação',
  ativa: 'Ativa',
  encerrada: 'Encerrada',
};

/* Limites que a Bot API documenta pra sendPhoto / sendMessage. */
export const LIMITE = {
  legendaFoto: 1024,
  textoSemFoto: 4096,
  fotoBytes: 10 * 1024 * 1024,
  fotoSomaLados: 10000,
  fotoProporcao: 20,
  fotoLadoBom: 600,
  nome: 80,
};
export const FORMATO_CODIGO = /^[A-Za-z0-9_-]{1,64}$/;

/* Lista simples, de propósito: termo aqui NÃO bloqueia, só pede um olhar humano.
   Quem decide se "remédio" é farmácia de verdade ou promessa milagrosa é o dono. */
export const TERMOS_REVISAR = [
  'arma', 'munição', 'droga', 'maconha', 'cannabis', 'cigarro eletrônico', 'vape',
  'remédio', 'medicamento', 'sem receita', 'cura', 'emagreça', 'emagrecer rápido',
  'aposta', 'apostas', 'cassino', 'bet', 'réplica', 'falsificado', 'pirata',
  'dinheiro fácil', 'renda garantida', 'lucro garantido', '100% garantido',
];

/* Ordem de gravidade. `ok` e `sugerir`/`alertar` não impedem aprovar; `revisar`
   aprova com ressalva registrada; `corrigir` e `bloquear` não aprovam. */
export const NIVEIS = ['ok', 'sugerir', 'alertar', 'revisar', 'corrigir', 'bloquear'];
const pior = (itens) => itens.reduce((m, i) => (NIVEIS.indexOf(i.nivel) > NIVEIS.indexOf(m) ? i.nivel : m), 'ok');

const centavos = (v) => (v == null || v === '' ? null : Math.round(Number(v)));
const reais = (c) => 'R$ ' + (c / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Valores em reais citados no texto ("R$ 49,90", "R$49", "R$ 1.299,00"), em centavos. */
export function precosNoTexto(texto) {
  const out = [];
  for (const m of String(texto || '').matchAll(/R\$\s?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/g)) {
    out.push(Number(m[1].replace(/\./g, '')) * 100 + Number((m[2] || '0').padEnd(2, '0')));
  }
  return out;
}

/** Só o que o dono preenche. Campos que o objetivo não usa não são guardados. */
function material(e = {}) {
  const objetivo = OBJETIVOS[e.objetivo] ? e.objetivo : 'produto';
  const usaProduto = objetivo === 'produto' || objetivo === 'promocao';
  const img = e.imagem && (e.imagem.url || e.imagem.arquivo)
    ? { url: e.imagem.url ? String(e.imagem.url) : null, arquivo: e.imagem.arquivo ? String(e.imagem.arquivo) : null, doCatalogo: !!e.imagem.doCatalogo }
    : null;
  return {
    objetivo,
    nome: String(e.nome || '').trim().slice(0, 200),
    sku: usaProduto ? String(e.sku || '').trim() || null : null,
    texto: String(e.texto || '').replace(/\r\n/g, '\n').trim(),
    imagem: img,
    botao: String(e.botao || '').trim().slice(0, 40) || 'Falar com a loja',
    codigo: String(e.codigo || '').trim(),
    promo: objetivo === 'promocao'
      ? { precoCentavos: centavos(e.promo?.precoCentavos), ate: String(e.promo?.ate || '').trim() || null, comoAproveitar: String(e.promo?.comoAproveitar || '').trim() || null }
      : null,
    evento: objetivo === 'evento'
      ? { data: String(e.evento?.data || '').trim() || null, local: String(e.evento?.local || '').trim() || null }
      : null,
  };
}

/**
 * Versão do material: muda quando o dono mexe em algo OU quando o catálogo muda
 * o que a campanha usa (preço, estoque, ativo). Mesma versão = mesma auditoria.
 */
export function versaoDe(m, produto) {
  const cat = produto ? { p: produto.precoCentavos, d: produto.precoDeCentavos, e: !!produto.esgotado, a: produto.ativo !== false } : null;
  const { nome, sku, texto, imagem, botao, codigo, promo, evento, objetivo } = m;
  return createHash('sha256').update(JSON.stringify({ objetivo, nome, sku, texto, imagem: imagem && (imagem.arquivo || imagem.url), botao, codigo, promo, evento, cat })).digest('hex').slice(0, 16);
}

/**
 * O auditor. Função pura: recebe o material e o que precisa do mundo (produto
 * do catálogo, dados da imagem, códigos em uso) e devolve o relatório.
 *
 * @param {object} m                material (ver `material`)
 * @param {object} ctx
 * @param {object|null} ctx.produto produto do catálogo ({ ativo:false } se inativo; null se não existe)
 * @param {object|null} ctx.imagem  { tipo, largura, altura, bytes } ou null se não deu pra ler
 * @param {string[]}   ctx.codigosEmUso códigos de OUTRAS campanhas
 * @param {string|null} ctx.linkBot https://t.me/<bot> ou null se o bot não está conectado
 * @param {string}     [ctx.agora]  ISO
 */
export function auditar(m0, ctx = {}) {
  const m = { ...m0, nome: String(m0.nome || '').trim(), texto: String(m0.texto || '').trim(), codigo: String(m0.codigo || '').trim() };
  const itens = [];
  const add = (grupo, nivel, texto) => itens.push({ grupo, nivel, texto });
  const agora = ctx.agora ? new Date(ctx.agora) : new Date();
  const hoje = agora.toISOString().slice(0, 10);
  const p = ctx.produto;

  /* ── Produto e preço ── */
  if (m.objetivo === 'produto' || m.objetivo === 'promocao') {
    if (!m.sku) { add('produto', 'bloquear', 'Escolha o produto do catálogo que a campanha divulga.'); }
    else if (!p) { add('produto', 'bloquear', 'O produto escolhido não existe mais no catálogo.'); }
    else if (p.ativo === false) { add('produto', 'bloquear', `“${p.nome}” está inativo no catálogo — reative ou escolha outro.`); }
    else {
      const normal = p.precoDeCentavos ?? p.precoCentavos;
      const aceitos = [p.precoCentavos, p.precoDeCentavos, m.promo?.precoCentavos].filter((x) => x != null);
      const citados = precosNoTexto(m.texto);
      const errados = citados.filter((c) => !aceitos.includes(c));
      if (errados.length) {
        add('produto', 'corrigir', `O texto cita ${errados.map(reais).join(', ')}, mas o catálogo diz ${reais(p.precoCentavos)}${m.promo?.precoCentavos ? ` (promoção: ${reais(m.promo.precoCentavos)})` : ''}. Ajuste o texto.`);
      }
      if (m.objetivo === 'promocao') {
        const pr = m.promo?.precoCentavos;
        if (!(pr > 0)) { add('produto', 'corrigir', 'Informe o preço promocional.'); }
        else if (normal != null && pr >= normal) { add('produto', 'corrigir', `O preço promocional (${reais(pr)}) não é menor que o normal (${reais(normal)}).`); }
        else if (!citados.includes(pr)) { add('mensagem', 'sugerir', `O texto não mostra o preço promocional (${reais(pr)}) — é o que faz a pessoa clicar.`); }
      }
      if (!errados.length && (m.objetivo === 'produto') && citados.length) { add('produto', 'ok', 'Preço do texto confere com o catálogo.'); }
      if (!errados.length && m.objetivo === 'produto' && !citados.length) { add('mensagem', 'sugerir', `O texto não diz o preço (${reais(p.precoCentavos)}).`); }
      if (p.esgotado) { add('produto', 'alertar', `“${p.nome}” está sem estoque — quem chegar pelo link não vai conseguir comprar.`); }
      else if (!itens.some((i) => i.grupo === 'produto' && i.nivel !== 'ok')) { add('produto', 'ok', `“${p.nome}” ativo no catálogo, com estoque.`); }
    }
  }
  if (m.objetivo === 'promocao') {
    if (!m.promo?.ate) { add('mensagem', 'sugerir', 'A promoção não tem prazo — “só até sexta” dá motivo pra não deixar pra depois.'); }
    else if (m.promo.ate < hoje) { add('mensagem', 'bloquear', `O prazo da promoção (${m.promo.ate.split('-').reverse().join('/')}) já passou.`); }
    if (!m.promo?.comoAproveitar) { add('mensagem', 'sugerir', 'Diga como aproveitar (ex.: “chame no botão e diga PROMO”).'); }
  }
  if (m.objetivo === 'evento') {
    if (!m.evento?.data) { add('mensagem', 'bloquear', 'Informe a data do evento.'); }
    else if (m.evento.data.slice(0, 10) < hoje) { add('mensagem', 'bloquear', 'A data do evento já passou.'); }
    if (!m.evento?.local) { add('mensagem', 'sugerir', 'Informe o local do evento (ou “on-line”).'); }
  }

  /* ── Imagem ── */
  const lim = m.imagem ? LIMITE.legendaFoto : LIMITE.textoSemFoto;
  if (!m.imagem) {
    add('imagem', 'sugerir', 'Sem imagem. Publicação com foto costuma chamar mais atenção.');
  } else if (!ctx.imagem) {
    add('imagem', 'alertar', 'Não consegui abrir a imagem pra conferir tamanho e dimensões — confira se ela aparece na prévia.');
  } else {
    const im = ctx.imagem;
    if (!['jpeg', 'png', 'webp'].includes(im.tipo)) { add('imagem', 'bloquear', `Formato ${im.tipo ? im.tipo.toUpperCase() : 'desconhecido'} não vai como foto no Telegram — use JPG, PNG ou WebP.`); }
    if (im.bytes > LIMITE.fotoBytes) { add('imagem', 'bloquear', `Imagem com ${(im.bytes / 1048576).toFixed(1)} MB — o Telegram aceita foto de até 10 MB.`); }
    if (im.largura && im.altura) {
      if (im.largura + im.altura > LIMITE.fotoSomaLados) { add('imagem', 'bloquear', `Imagem de ${im.largura}×${im.altura} px — largura + altura passa de 10.000, o limite do Telegram.`); }
      const prop = Math.max(im.largura, im.altura) / Math.min(im.largura, im.altura);
      if (prop > LIMITE.fotoProporcao) { add('imagem', 'bloquear', 'Imagem estreita demais (proporção acima de 20:1) — o Telegram recusa.'); }
      if (Math.min(im.largura, im.altura) < LIMITE.fotoLadoBom) { add('imagem', 'alertar', `Imagem pequena (${im.largura}×${im.altura} px). Dá pra usar, mas pode sair borrada — o ideal é a partir de ${LIMITE.fotoLadoBom} px no menor lado.`); }
    }
    if (!itens.some((i) => i.grupo === 'imagem')) { add('imagem', 'ok', `Imagem ${im.largura}×${im.altura} px, ${(im.bytes / 1024).toFixed(0)} KB — dentro dos limites do Telegram.`); }
  }

  /* ── Mensagem ── */
  if (!m.nome) { add('mensagem', 'bloquear', 'Dê um nome à campanha (é só pra você achar ela depois).'); }
  else if (m.nome.length > LIMITE.nome) { add('mensagem', 'bloquear', `Nome longo demais (até ${LIMITE.nome} caracteres).`); }
  if (!m.texto) { add('mensagem', 'bloquear', 'Escreva o texto da publicação.'); }
  else if (m.texto.length > lim) {
    add('mensagem', 'bloquear', m.imagem
      ? `Texto com ${m.texto.length} caracteres — legenda de foto no Telegram vai até ${LIMITE.legendaFoto}. Encurte ou tire a imagem.`
      : `Texto com ${m.texto.length} caracteres — mensagem no Telegram vai até ${LIMITE.textoSemFoto}.`);
  }
  const t = ` ${semAcento(m.texto + ' ' + m.nome)} `;
  const achados = TERMOS_REVISAR.filter((x) => new RegExp(`[^a-z0-9]${semAcento(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z0-9]`).test(t));
  if (achados.length) { add('mensagem', 'revisar', `Termo que pede um olhar antes de divulgar: ${achados.map((x) => `“${x}”`).join(', ')}. Se estiver tudo certo, aprove com a ressalva.`); }
  if (m.texto && !itens.some((i) => i.grupo === 'mensagem' && i.nivel !== 'ok')) { add('mensagem', 'ok', `Texto com ${m.texto.length} de ${lim} caracteres.`); }

  /* ── Destino (o link) ── */
  if (!FORMATO_CODIGO.test(m.codigo)) { add('destino', 'bloquear', 'O código do link só pode ter letras sem acento, números, “_” e “-”, até 64 caracteres.'); }
  else if ((ctx.codigosEmUso || []).includes(m.codigo)) { add('destino', 'bloquear', `Já existe outra campanha com o código “${m.codigo}”. Troque pra não misturar os resultados.`); }
  else if (!ctx.linkBot) { add('destino', 'alertar', 'O bot do Telegram não está conectado — o link só funciona depois de conectar.'); }
  else { add('destino', 'ok', `Link rastreável: ${ctx.linkBot}?start=${m.codigo}`); }

  const resultado = pior(itens);
  return { itens, resultado, em: agoraIso() };
}

/* ── ciclo de vida ──────────────────────────────────────────────────────── */

const EDITAVEL = ['rascunho', 'em-revisao', 'aguardando-aprovacao'];
const publico = (c) => ({ ...c, estadoTexto: ESTADOS[c.estado], objetivoTexto: OBJETIVOS[c.objetivo] });

export function listar() { return ler().campanhas.map(publico); }
export function obter(id) { const c = ler().campanhas.find((x) => x.id === id); return c ? publico(c) : null; }

/** Códigos que já estão tomados: os daqui e os links antigos do `vsresultados`. */
function codigosEmUso(d, excetoId) {
  const aqui = d.campanhas.filter((c) => c.id !== excetoId).map((c) => c.codigo);
  // Só a própria campanha JÁ APROVADA tem o código dela no vsresultados — e aí não é conflito.
  const eu = d.campanhas.find((c) => c.id === excetoId);
  const meu = eu && !EDITAVEL.includes(eu.estado) ? eu.codigo : null;
  return [...new Set([...aqui, ...resultados.campanhas().map((c) => c.codigo).filter((c) => c !== meu)])];
}

/**
 * Cria ou atualiza o rascunho. Mexer no material de uma campanha já auditada
 * a devolve para rascunho: a auditoria era daquela versão, não desta.
 */
export function salvar(entrada = {}, { canal = 'telegram' } = {}) {
  const d = ler();
  const m = material(entrada);
  let c = entrada.id ? d.campanhas.find((x) => x.id === entrada.id) : null;
  if (entrada.id && !c) { return { ok: false, erro: 'campanha não encontrada' }; }
  if (c && !EDITAVEL.includes(c.estado)) { return { ok: false, erro: `campanha ${ESTADOS[c.estado].toLowerCase()} não pode ser editada — crie outra` }; }
  if (!m.codigo) { m.codigo = resultados.codigoDe(m.nome || 'campanha', codigosEmUso(d, c?.id)); }
  const quando = agoraIso();
  if (!c) {
    c = { id: 'cp_' + randomBytes(6).toString('hex'), canal, estado: 'rascunho', criadaEm: quando, auditoria: null, aprovacao: null, historico: [] };
    d.campanhas.push(c);
    c.historico.push({ em: quando, evento: 'criada' });
  }
  const mudou = JSON.stringify(material(c)) !== JSON.stringify(m);
  Object.assign(c, m, { atualizadaEm: quando });
  if (mudou && c.estado !== 'rascunho') { c.estado = 'rascunho'; c.historico.push({ em: quando, evento: 'material alterado — volta a rascunho' }); }
  gravar(d);
  return { ok: true, campanha: publico(c) };
}

/**
 * Roda (ou reaproveita) a auditoria da versão atual.
 * @param {string} id
 * @param {object} ctx  { produto(sku), imagem(img), linkBot, agora }
 */
export function rodarAuditoria(id, ctx = {}) {
  const d = ler();
  const c = d.campanhas.find((x) => x.id === id);
  if (!c) { return { ok: false, erro: 'campanha não encontrada' }; }
  if (!EDITAVEL.includes(c.estado)) { return { ok: true, campanha: publico(c), reaproveitada: true }; }
  const produto = c.sku && ctx.produto ? ctx.produto(c.sku) : null;
  const versao = versaoDe(c, produto);
  if (c.auditoria?.versao === versao && !ctx.forcar) {
    return { ok: true, campanha: publico(c), reaproveitada: true };
  }
  const rel = auditar(c, { produto, imagem: c.imagem && ctx.imagem ? ctx.imagem(c.imagem) : null, codigosEmUso: codigosEmUso(d, c.id), linkBot: ctx.linkBot || null, agora: ctx.agora });
  c.auditoria = { versao, ...rel };
  c.estado = ['revisar', 'corrigir', 'bloquear'].includes(rel.resultado) ? 'em-revisao' : 'aguardando-aprovacao';
  c.historico.push({ em: rel.em, evento: `auditada: ${rel.resultado}` });
  gravar(d);
  return { ok: true, campanha: publico(c), reaproveitada: false };
}

/**
 * Aprovar = ativar o link. Exige auditoria DA VERSÃO ATUAL (roda de novo se o
 * material ou o catálogo mudou desde a última). Bloqueio e correção não passam;
 * "revisar" passa só com `aceitarRessalvas`, e a ressalva fica registrada.
 */
export function aprovar(id, { por = null, aceitarRessalvas = false, ...ctx } = {}) {
  const r = rodarAuditoria(id, ctx);
  if (!r.ok) { return r; }
  const d = ler();
  const c = d.campanhas.find((x) => x.id === id);
  if (!EDITAVEL.includes(c.estado)) { return { ok: false, erro: `campanha já está ${ESTADOS[c.estado].toLowerCase()}` }; }
  const a = c.auditoria;
  if (a.resultado === 'bloquear') { return { ok: false, erro: 'a auditoria encontrou um bloqueio — resolva antes de aprovar', campanha: publico(c) }; }
  if (a.resultado === 'corrigir') { return { ok: false, erro: 'a auditoria pediu correção — ajuste antes de aprovar', campanha: publico(c) }; }
  const ressalvas = a.itens.filter((i) => i.nivel === 'revisar').map((i) => i.texto);
  if (ressalvas.length && !aceitarRessalvas) { return { ok: false, erro: 'há itens para revisar — confirme que você conferiu pra aprovar mesmo assim', precisaConfirmar: true, campanha: publico(c) }; }
  const reg = resultados.criarCampanha({ nome: c.nome, canal: c.canal, codigo: c.codigo });
  if (!reg.ok) { return { ok: false, erro: reg.erro }; }
  const quando = agoraIso();
  c.estado = 'ativa';
  c.aprovacao = { em: quando, por, versao: a.versao, ressalvas };
  c.historico.push({ em: quando, evento: ressalvas.length ? `aprovada com ${ressalvas.length} ressalva(s)` : 'aprovada' });
  gravar(d);
  return { ok: true, campanha: publico(c) };
}

/** Encerrar tira da lista de ativas. O link continua abrindo o bot; a atribuição dos 30 dias segue a regra do `vsresultados`. */
export function encerrar(id) {
  const d = ler();
  const c = d.campanhas.find((x) => x.id === id);
  if (!c) { return { ok: false, erro: 'campanha não encontrada' }; }
  if (c.estado !== 'ativa') { return { ok: false, erro: 'só campanha ativa pode ser encerrada' }; }
  resultados.arquivarCampanha(c.codigo, true);
  c.estado = 'encerrada';
  c.encerradaEm = agoraIso();
  c.historico.push({ em: c.encerradaEm, evento: 'encerrada' });
  gravar(d);
  return { ok: true, campanha: publico(c) };
}

/** Só rascunho some de vez: campanha que já foi ativa tem resultado, e resultado não se apaga. */
export function excluir(id) {
  const d = ler();
  const i = d.campanhas.findIndex((x) => x.id === id);
  if (i < 0) { return { ok: false, erro: 'campanha não encontrada' }; }
  if (!EDITAVEL.includes(d.campanhas[i].estado)) { return { ok: false, erro: 'campanha que já foi ativada não se exclui — encerre' }; }
  d.campanhas.splice(i, 1);
  gravar(d);
  return { ok: true };
}

/* ── 2ª entrega: DESTINOS, PUBLICAÇÕES e FREQUÊNCIA ─────────────────────────
   Publicação orgânica em canais e grupos onde o bot foi autorizado. O estado da
   campanha (ativa…) é uma coisa; o estado de CADA publicação (agendada,
   publicada, falha) é outra — uma campanha ativa pode nunca ter sido publicada
   pelo Bolso Cheio (só link) ou ter três publicações, cada uma com seu destino. */

export const TIPOS_DESTINO = { channel: 'Canal', group: 'Grupo', supergroup: 'Grupo' };
export const ESTADOS_PUB = { agendada: 'Agendada', publicando: 'Publicando', publicada: 'Publicada', falha: 'Falha', cancelada: 'Cancelada' };
/* Política INTERNA de frequência (a proposta do dono foi cortada no valor): o
   Telegram aguenta ~20 msg/min num grupo, mas propaganda em sequência espanta
   o público. Padrão conservador, ajustável na tela. */
export const POLITICA_PADRAO = { intervaloHoras: 4, maxPorDia: 3 };

const destinosDe = (d) => d.destinos || (d.destinos = []);
export function listarDestinos() { return ler().destinos || []; }
export function politica() { const d = ler(); return { ...POLITICA_PADRAO, ...(d.politica || {}) }; }
export function salvarPolitica({ intervaloHoras, maxPorDia } = {}) {
  const ih = Number(intervaloHoras); const mx = Number(maxPorDia);
  if (!(ih >= 0.5 && ih <= 168)) { return { ok: false, erro: 'intervalo entre campanhas: de 0,5 a 168 horas' }; }
  if (!(Number.isInteger(mx) && mx >= 1 && mx <= 24)) { return { ok: false, erro: 'máximo por dia: de 1 a 24' }; }
  const d = ler(); d.politica = { intervaloHoras: ih, maxPorDia: mx }; gravar(d);
  return { ok: true, politica: d.politica };
}

/**
 * O Telegram avisou que o bot entrou/saiu/mudou de permissão num chat.
 * Entrou: vira destino PENDENTE — só aparece para publicar depois que o dono
 * confirma (o bot pode ser adicionado por qualquer um; o canal precisa ser da
 * loja). Saiu/perdeu permissão: marcado, e as publicações agendadas nele falham
 * com o motivo, em vez de sumirem.
 */
export function registrarEventoMembro(ev = {}) {
  const id = String(ev.chat?.id ?? '');
  if (!id || !['channel', 'group', 'supergroup'].includes(ev.chat?.tipo)) { return { ok: false, motivo: 'não é canal nem grupo' }; }
  const d = ler(); const lista = destinosDe(d);
  let x = lista.find((y) => y.id === id);
  const saiu = ['left', 'kicked'].includes(ev.status);
  if (!x) {
    if (saiu) { return { ok: true, ignorado: true }; }
    x = { id, titulo: ev.chat.titulo || null, tipo: ev.chat.tipo, username: ev.chat.username || null, estado: 'pendente', origem: 'evento', adicionadoEm: ev.quando || agoraIso(), adicionadoPor: ev.por?.nome || null };
    lista.push(x);
  }
  Object.assign(x, { titulo: ev.chat.titulo || x.titulo, username: ev.chat.username ?? x.username, podePublicar: !!ev.podePublicar, statusBot: ev.status, verificadoEm: agoraIso() });
  if (saiu) { x.estado = 'removido'; }
  else if (x.estado === 'removido') { x.estado = 'pendente'; }
  gravar(d);
  return { ok: true, destino: x };
}

/** Cadastro manual (canal onde o bot já estava antes): vem da consulta ao Telegram. */
export function cadastrarDestino(consulta = {}) {
  if (!consulta.ok) { return { ok: false, erro: consulta.erro || 'não consegui consultar o destino' }; }
  if (!['channel', 'group', 'supergroup'].includes(consulta.chat?.tipo)) { return { ok: false, erro: 'isso é uma conversa privada — publicação é só em canal ou grupo' }; }
  const r = registrarEventoMembro({ chat: consulta.chat, status: consulta.status, podePublicar: consulta.podePublicar });
  if (r.destino && r.destino.origem === 'evento' && !r.destino.adicionadoPor) { r.destino.origem = 'manual'; const d = ler(); const x = destinosDe(d).find((y) => y.id === r.destino.id); if (x) { x.origem = 'manual'; gravar(d); } }
  return r;
}

export function confirmarDestino(id, por = null) {
  const d = ler(); const x = destinosDe(d).find((y) => y.id === String(id));
  if (!x) { return { ok: false, erro: 'destino não encontrado' }; }
  if (x.estado === 'removido') { return { ok: false, erro: 'o bot não está mais nesse destino — adicione de novo' }; }
  x.estado = 'confirmado'; x.confirmadoEm = agoraIso(); x.confirmadoPor = por;
  gravar(d); return { ok: true, destino: x };
}
export function removerDestino(id) {
  const d = ler(); const lista = destinosDe(d); const i = lista.findIndex((y) => y.id === String(id));
  if (i < 0) { return { ok: false, erro: 'destino não encontrado' }; }
  lista.splice(i, 1); gravar(d); return { ok: true };
}

/** Publicações (de todas as campanhas) num destino, para a regra de frequência. */
function publicacoesNoDestino(d, destinoId) {
  return (d.campanhas || []).flatMap((c) => (c.publicacoes || []).filter((p) => p.destinoId === destinoId && ['agendada', 'publicando', 'publicada'].includes(p.estado)).map((p) => ({ ...p, campanhaId: c.id })));
}

/**
 * Pode publicar esta campanha neste destino, neste horário? Checa destino
 * confirmado com permissão e a política: intervalo mínimo entre campanhas
 * no mesmo destino e máximo por dia.
 */
export function podeAgendar(d, campanha, destinoId, quando, pol = politica()) {
  const dest = destinosDe(d).find((y) => y.id === destinoId);
  if (!dest) { return { ok: false, erro: 'destino não encontrado' }; }
  if (dest.estado !== 'confirmado') { return { ok: false, erro: `“${dest.titulo}” ainda não foi confirmado` }; }
  if (!dest.podePublicar) { return { ok: false, erro: `o bot não tem permissão de publicar em “${dest.titulo}”` }; }
  const t = new Date(quando).getTime();
  const outras = publicacoesNoDestino(d, destinoId);
  if (outras.some((p) => p.campanhaId === campanha.id && ['agendada', 'publicando'].includes(p.estado))) { return { ok: false, erro: `esta campanha já está agendada em “${dest.titulo}”` }; }
  const perto = outras.find((p) => Math.abs(new Date(p.quando).getTime() - t) < pol.intervaloHoras * 3600e3);
  if (perto) {
    return { ok: false, erro: `em “${dest.titulo}” já há campanha às ${new Date(perto.quando).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} — a política pede ${String(pol.intervaloHoras).replace('.', ',')} h entre campanhas no mesmo destino` };
  }
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(t));
  const noDia = outras.filter((p) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(p.quando)) === dia).length;
  if (noDia >= pol.maxPorDia) { return { ok: false, erro: `“${dest.titulo}” já tem ${noDia} campanha(s) nesse dia — o máximo é ${pol.maxPorDia}` }; }
  return { ok: true, destino: dest };
}

/**
 * Agenda (ou publica já, com `quando` = agora) a campanha ATIVA em destinos.
 * Devolve o resultado de cada destino: um pode passar e outro esbarrar na regra.
 */
export function agendarPublicacao(id, { destinos = [], quando = null, por = null, agora = new Date() } = {}) {
  const d = ler();
  const c = (d.campanhas || []).find((x) => x.id === id);
  if (!c) { return { ok: false, erro: 'campanha não encontrada' }; }
  if (c.estado !== 'ativa') { return { ok: false, erro: 'só campanha aprovada (ativa) é publicada' }; }
  if (!destinos.length) { return { ok: false, erro: 'escolha pelo menos um destino' }; }
  const t = quando ? new Date(quando) : new Date(agora);
  if (Number.isNaN(t.getTime())) { return { ok: false, erro: 'data/hora inválida' }; }
  if (quando && t.getTime() < agora.getTime() - 60000) { return { ok: false, erro: 'esse horário já passou' }; }
  c.publicacoes = c.publicacoes || [];
  const resultados = [];
  for (const destinoId of destinos.map(String)) {
    const v = podeAgendar(d, c, destinoId, t.toISOString());
    if (!v.ok) { resultados.push({ destinoId, ok: false, erro: v.erro }); continue; }
    const pub = { id: 'pb_' + randomBytes(5).toString('hex'), destinoId, destino: v.destino.titulo, quando: t.toISOString(), estado: 'agendada', criadaEm: agoraIso(), por };
    c.publicacoes.push(pub);
    c.historico.push({ em: agoraIso(), evento: `publicação ${quando ? 'agendada' : 'pedida agora'} em ${v.destino.titulo}` });
    resultados.push({ destinoId, ok: true, publicacao: pub });
  }
  gravar(d);
  return { ok: resultados.some((x) => x.ok), resultados, erro: resultados.every((x) => !x.ok) ? resultados.map((x) => x.erro).join(' · ') : undefined, campanha: publico(c) };
}

export function cancelarPublicacao(id, pubId) {
  const d = ler(); const c = (d.campanhas || []).find((x) => x.id === id);
  const p = c?.publicacoes?.find((x) => x.id === pubId);
  if (!p) { return { ok: false, erro: 'publicação não encontrada' }; }
  if (p.estado !== 'agendada') { return { ok: false, erro: `publicação ${ESTADOS_PUB[p.estado].toLowerCase()} não se cancela` }; }
  p.estado = 'cancelada'; p.canceladaEm = agoraIso();
  c.historico.push({ em: p.canceladaEm, evento: `publicação em ${p.destino} cancelada` });
  gravar(d); return { ok: true, campanha: publico(c) };
}

/**
 * O AGENDADOR: publica o que venceu, uma por vez (≤ 1/s — limite do Telegram).
 * `publicar(pub, campanha, destino)` é quem fala com o Telegram (injetado pelo
 * backend). Falha fica registrada com o motivo; nada some calado.
 */
export async function rodarAgendador({ publicar, agora = new Date(), espera = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const d0 = ler();
  const vencidas = (d0.campanhas || []).flatMap((c) => (c.publicacoes || []).filter((p) => p.estado === 'agendada' && new Date(p.quando) <= agora).map((p) => ({ c: c.id, p: p.id })));
  const feitas = [];
  for (const [i, v] of vencidas.entries()) {
    if (i) { await espera(1100); }
    let d = ler(); let c = d.campanhas.find((x) => x.id === v.c); let p = c?.publicacoes.find((x) => x.id === v.p);
    if (!p || p.estado !== 'agendada') { continue; }
    const dest = destinosDe(d).find((y) => y.id === p.destinoId);
    p.estado = 'publicando'; gravar(d);
    let r;
    if (!dest || dest.estado !== 'confirmado' || !dest.podePublicar) { r = { ok: false, erro: 'o destino não está mais confirmado ou o bot perdeu a permissão' }; }
    else if (c.estado !== 'ativa') { r = { ok: false, erro: 'a campanha foi encerrada antes da hora' }; }
    else { try { r = await publicar(p, publico(c), dest); } catch (e) { r = { ok: false, erro: e.message }; } }
    d = ler(); c = d.campanhas.find((x) => x.id === v.c); p = c.publicacoes.find((x) => x.id === v.p);
    Object.assign(p, r.ok ? { estado: 'publicada', publicadaEm: agoraIso(), mensagemId: r.mensagemId || null, link: r.link || null, erro: null } : { estado: 'falha', falhouEm: agoraIso(), erro: r.erro || 'motivo não informado' });
    c.historico.push({ em: agoraIso(), evento: r.ok ? `publicada em ${p.destino}` : `falhou em ${p.destino}: ${p.erro}` });
    gravar(d);
    feitas.push({ id: p.id, ok: r.ok, erro: r.erro || null });
  }
  return { publicadas: feitas.filter((x) => x.ok).length, falhas: feitas.filter((x) => !x.ok).length, feitas };
}
