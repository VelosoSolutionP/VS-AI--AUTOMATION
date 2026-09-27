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
/** Onde o link da campanha pode ser divulgado. */
export const LUGARES = {
  'canal-telegram': 'Canal do Telegram', 'grupo-telegram': 'Grupo do Telegram', instagram: 'Instagram', 'whatsapp-status': 'Status do WhatsApp',
  'grupo-whatsapp': 'Grupo do WhatsApp', site: 'Site / loja virtual', panfleto: 'Panfleto ou cartaz (QR code)', email: 'E-mail', 'balcao': 'Balcão da loja', outro: 'Outro lugar',
};
/** Quantos lugares cada objetivo precisa, no mínimo, para fazer sentido. */
export const ALCANCE_MINIMO = { captar: 2, evento: 1, produto: 1, promocao: 1 };
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

/* ── qualidade do texto (sem IA): o que um revisor humano recusaria ────────── */
const CTA = ['chame', 'chama', 'toque', 'clique', 'fale', 'falar', 'peca', 'peça', 'garanta', 'aproveite', 'compre', 'entre', 'responda', 'acesse', 'venha', 'confira', 'reserve', 'agende', 'mande', 'envie', 'escreva', 'participe', 'inscreva', 'cadastre', 'saiba', 'descubra', 'botao', 'botão', 'link'];
const TECLADO = ['asdf', 'qwer', 'zxcv', 'hjkl', 'sdfg', 'dfgh', 'fghj', 'jklç', 'uiop', 'yuio', 'poiu', 'lkjh', 'mnbv'];
const palavraPlausivel = (w) => {
  if (w.length <= 2 || /^\d+([.,]\d+)?$/.test(w) || /^r\$/.test(w)) { return true; }
  if (/(.)\1{2,}/.test(w)) { return false; } // aaaa, kkkk
  if (!/[aeiouy]/.test(w)) { return false; }
  if (/[bcdfghjklmnpqrstvwxz]{4,}/.test(w)) { return false; }
  if (TECLADO.some((t) => w.includes(t))) { return false; }
  return true;
};
/**
 * Texto de campanha que não convence: digitado aleatório, curto demais, gritando
 * em maiúsculas, repetindo palavra, sem dizer o que fazer. Função pura.
 */
export function qualidadeDoTexto(texto) {
  const out = [];
  const t = String(texto || '').trim();
  if (!t) { return out; }
  const palavras = semAcento(t).replace(/[^a-z0-9$,.\s]/g, ' ').split(/\s+/).filter((w) => /[a-z]/.test(w)).map((w) => w.replace(/[.,]+$/, ''));
  const ruins = palavras.filter((w) => !palavraPlausivel(w));
  if (palavras.length && ruins.length / palavras.length > 0.3) {
    out.push({ nivel: 'corrigir', texto: 'O texto não é compreensível — parece digitado sem sentido. Escreva a mensagem ou use “Me ajude a montar a campanha”.', evidencia: `palavras sem sentido: ${ruins.slice(0, 4).join(', ')}` });
    return out;
  }
  if (palavras.length < 6 || t.length < 30) { out.push({ nivel: 'corrigir', texto: 'Texto curto demais para alguém entender a oferta — diga o que é, o benefício e o que fazer. Ou use “Me ajude a montar a campanha”.', evidencia: `${palavras.length} palavra(s)` }); }
  const letras = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letras.length > 20 && letras.replace(/[^A-ZÀ-Þ]/g, '').length / letras.length > 0.6) { out.push({ nivel: 'alertar', texto: 'Texto quase todo em MAIÚSCULAS — no Telegram parece grito. Use maiúscula só no começo das frases.' }); }
  const cont = {}; for (const w of palavras.filter((x) => x.length > 3)) { cont[w] = (cont[w] || 0) + 1; }
  const repetida = Object.entries(cont).find(([, n]) => n >= 4);
  if (repetida) { out.push({ nivel: 'alertar', texto: `A palavra “${repetida[0]}” se repete ${repetida[1]} vezes — reescreva para ficar natural.` }); }
  if (!palavras.some((w) => CTA.includes(w))) { out.push({ nivel: 'corrigir', texto: 'Falta dizer o que a pessoa deve fazer (ex.: “Toque no botão abaixo e fale com a gente”).' }); }
  if ((t.match(/[!?]{3,}/g) || []).length) { out.push({ nivel: 'sugerir', texto: 'Pontuação exagerada (“!!!”) — um ponto de exclamação basta.' }); }
  const emojis = (t.match(/\p{Extended_Pictographic}/gu) || []).length;
  if (emojis > 8) { out.push({ nivel: 'sugerir', texto: `${emojis} emojis — fica poluído; use 1 a 3.` }); }
  return out;
}

/* ── regras de negócio por objetivo ─────────────────────────────────────── */
const INCENTIVO = ['cupom', 'desconto', 'brinde', 'gratis', 'gratuito', 'gratuita', 'exclusivo', 'exclusiva', 'exclusivas', 'exclusivos', 'primeiro', 'primeira', 'antes', 'vip', 'sorteio', 'premio', 'oferta', 'ofertas', 'novidade', 'novidades', 'beneficio', 'beneficios', 'bonus', 'presente', 'frete gratis', '% off', 'off'];
const CONVITE = ['entre', 'entrar', 'participe', 'participar', 'cadastre', 'cadastro', 'inscreva', 'inscricao', 'faca parte', 'junte-se', 'receba', 'receber', 'lista', 'grupo', 'canal', 'siga', 'assine'];
const temAlgum = (t, lista) => lista.some((x) => new RegExp(`(^|[^a-z])${x.replace(/[.*+?^${}()|[\]\\%]/g, '\\$&')}([^a-z]|$)`).test(t));
const DATA_NO_TEXTO = /\b\d{1,2}\/\d{1,2}\b|\b(segunda|terca|quarta|quinta|sexta|sabado|domingo|amanha|hoje)\b/;
/**
 * O texto faz o que o OBJETIVO promete? Captar sem motivo pra entrar não capta;
 * divulgar produto sem dizer qual/quanto não vende; evento sem data não junta
 * ninguém.
 */
export function regrasDoObjetivo(m, p) {
  const out = []; const t = semAcento(m.texto || '');
  if (!t.trim()) { return out; }
  if (m.objetivo === 'captar') {
    /* O texto tem de APRESENTAR a solução e o benefício que o cliente informou
       (ou que vêm do catálogo) — nada além disso. É o que impede prometer o que
       não foi dito. */
    const chaves = (v) => semAcento(v || '').split(/[^a-z0-9]+/).filter((w) => w.length > 4 && !['sobre', 'nossa', 'nosso', 'voces', 'vocês', 'empresa', 'clientes'].includes(w));
    const sol = chaves(m.captar?.solucao || p?.nome);
    if (sol.length && !sol.some((w) => t.includes(w))) { out.push({ grupo: 'mensagem', nivel: 'corrigir', texto: `O texto não diz qual solução está sendo oferecida (“${m.captar?.solucao || p?.nome}”).`, evidencia: `procurei: ${sol.slice(0, 4).join(', ')}` }); }
    const ben = chaves(m.captar?.beneficio);
    if (ben.length && !ben.some((w) => t.includes(w))) { out.push({ grupo: 'mensagem', nivel: 'corrigir', texto: 'O texto não apresenta o benefício informado — é ele que faz a pessoa querer saber mais.', evidencia: `benefício: “${m.captar.beneficio.slice(0, 60)}”` }); }
    if (precosNoTexto(m.texto).length >= 2) { out.push({ grupo: 'mensagem', nivel: 'sugerir', texto: 'O texto parece venda de produto (vários preços). Para vender, use “Divulgar produto” ou “Criar promoção”; captar é convite para entrar.' }); }
  }
  if (m.objetivo === 'produto' && p?.nome) {
    const chave = semAcento(p.nome).split(/\s+/).filter((w) => w.length > 3);
    if (chave.length && !chave.some((w) => t.includes(w))) { out.push({ grupo: 'mensagem', nivel: 'corrigir', texto: `O texto não diz qual é o produto (“${p.nome}”). Quem lê precisa saber o que está sendo vendido.` }); }
  }
  if (m.objetivo === 'evento' && m.evento?.data && !DATA_NO_TEXTO.test(t)) {
    out.push({ grupo: 'mensagem', nivel: 'corrigir', texto: 'O texto não diz QUANDO é o evento — coloque a data (ex.: “sábado, 12/10”).' });
  }
  return out;
}

/** Só o que o dono preenche. Campos que o objetivo não usa não são guardados. */
/* O que a pessoa deve fazer depois de clicar (captar clientes). */
export const ACOES_CAPTAR = { conhecer: 'Conhecer a solução', demonstracao: 'Pedir uma demonstração', vendedor: 'Conversar com um vendedor', lista: 'Entrar na lista de novidades' };

function material(e = {}) {
  const objetivo = OBJETIVOS[e.objetivo] ? e.objetivo : 'produto';
  const usaProduto = objetivo === 'produto' || objetivo === 'promocao';
  const txt = (v, n = 300) => String(v || '').trim().slice(0, n) || null;
  const img = e.imagem && (e.imagem.url || e.imagem.arquivo)
    ? { url: e.imagem.url ? String(e.imagem.url) : null, arquivo: e.imagem.arquivo ? String(e.imagem.arquivo) : null, doCatalogo: !!e.imagem.doCatalogo, gerada: !!e.imagem.gerada,
      /* Medido no navegador ao enviar (canvas): variacao de cor e brilho. */
      analise: e.imagem.analise && typeof e.imagem.analise === 'object' ? { variacao: Number(e.imagem.analise.variacao) || 0, brilho: Number(e.imagem.analise.brilho) || 0 } : null }
    : null;
  return {
    objetivo,
    nome: String(e.nome || '').trim().slice(0, 200),
    sku: usaProduto ? String(e.sku || '').trim() || null : null,
    texto: String(e.texto || '').replace(/\r\n/g, '\n').trim(),
    imagem: img,
    botao: String(e.botao || '').trim().slice(0, 40) || 'Falar com a loja',
    divulgacao: [...new Set((Array.isArray(e.divulgacao) ? e.divulgacao : []).map(String).filter((x) => LUGARES[x]))],
    codigo: String(e.codigo || '').trim(),
    promo: objetivo === 'promocao'
      ? { precoCentavos: centavos(e.promo?.precoCentavos), ate: txt(e.promo?.ate, 10), comoAproveitar: txt(e.promo?.comoAproveitar, 200) }
      : null,
    evento: objetivo === 'evento'
      ? { data: txt(e.evento?.data, 10), hora: txt(e.evento?.hora, 5), local: txt(e.evento?.local, 160), link: txt(e.evento?.link, 300), descricao: txt(e.evento?.descricao, 300) }
      : null,
    /* Captar clientes: sem preço obrigatório, mas o interessado precisa ENTENDER
       o que está sendo oferecido — solução, para quem, benefício real e o que
       fazer depois de clicar. A solução pode vir do catálogo (sku). */
    captar: objetivo === 'captar'
      ? { solucao: txt(e.captar?.solucao, 120), sku: txt(e.captar?.sku, 80), publico: txt(e.captar?.publico, 160), beneficio: txt(e.captar?.beneficio, 300), acao: ACOES_CAPTAR[e.captar?.acao] ? e.captar.acao : null }
      : null,
  };
}

/**
 * Versão do material: muda quando o dono mexe em algo OU quando o catálogo muda
 * o que a campanha usa (preço, estoque, ativo). Mesma versão = mesma auditoria.
 */
export function versaoDe(m, produto) {
  const cat = produto ? { p: produto.precoCentavos, d: produto.precoDeCentavos, e: !!produto.esgotado, a: produto.ativo !== false } : null;
  const { nome, sku, texto, imagem, botao, codigo, promo, evento, captar, objetivo, divulgacao } = m;
  return createHash('sha256').update(JSON.stringify({ objetivo, nome, sku, texto, imagem: imagem && (imagem.arquivo || imagem.url), botao, codigo, promo, evento, captar, divulgacao, cat })).digest('hex').slice(0, 16);
}

/* Pedido de ajuda escrito no lugar do texto ("monta pra mim") não é publicidade:
   abre o assistente, nunca vai ao ar. */
const AJUDA = [/\b(monta|montar|faz|fazer|faca|cria|criar|escreve|escrever|gera|gerar|prepara)\b.{0,15}\b(pra|para|por)\s*(mim|nos|a gente)\b/, /\bme ajud/, /\b(nao sei|sei la|qualquer coisa|tanto faz)\b/, /^\s*(teste|testando|test|xxx+|aaa+|\.+|-+)\s*$/];
export const ehPedidoDeAjuda = (texto) => AJUDA.some((re) => re.test(semAcento(texto || '')));

/**
 * O que CADA objetivo exige antes de ir ao ar (política de validação). Faltou,
 * reprova — com o que falta e como resolver. Consulta o catálogo antes de
 * cobrar do cliente o que o sistema já sabe.
 */
export function requisitosDoObjetivo(m, p) {
  const falta = []; // { campo, texto }
  if (m.objetivo === 'produto') {
    if (!m.sku) { falta.push({ campo: 'produto', texto: 'Escolha o produto do catálogo.' }); }
    if (p && !p.descricao && semAcento(m.texto).split(/\s+/).length < 12) { falta.push({ campo: 'descricao', texto: `“${p.nome}” não tem descrição no catálogo — descreva o produto no texto ou cadastre a descrição.` }); }
    if (p && !precosNoTexto(m.texto).length) { falta.push({ campo: 'preco', texto: `Mostre o preço (${reais(p.precoCentavos)}) — é informação obrigatória para divulgar produto.` }); }
  }
  if (m.objetivo === 'promocao') {
    if (!m.sku) { falta.push({ campo: 'produto', texto: 'Escolha o produto da promoção.' }); }
    if (!(m.promo?.precoCentavos > 0)) { falta.push({ campo: 'precoPromo', texto: 'Informe o preço promocional.' }); }
    if (!m.promo?.ate) { falta.push({ campo: 'validade', texto: 'Informe até quando vale — promoção sem validade não é promoção.' }); }
    if (!m.promo?.comoAproveitar) { falta.push({ campo: 'condicoes', texto: 'Informe as condições (como aproveitar: “diga PROMO no botão”, limite por cliente…).' }); }
  }
  if (m.objetivo === 'evento') {
    if (!m.nome) { falta.push({ campo: 'nome', texto: 'Dê o nome do evento.' }); }
    if (!m.evento?.descricao) { falta.push({ campo: 'descricao', texto: 'Descreva o evento em uma frase (o que vai ter).' }); }
    if (!m.evento?.data) { falta.push({ campo: 'data', texto: 'Informe a data do evento.' }); }
    if (!m.evento?.hora) { falta.push({ campo: 'hora', texto: 'Informe o horário do evento.' }); }
    if (!m.evento?.local && !m.evento?.link) { falta.push({ campo: 'local', texto: 'Informe o local — ou o link de participação, se for on-line.' }); }
  }
  if (m.objetivo === 'captar') {
    if (!m.captar?.solucao && !m.captar?.sku) { falta.push({ campo: 'solucao', texto: 'Qual solução você quer anunciar? Escolha uma do catálogo ou descreva.' }); }
    if (!m.captar?.publico) { falta.push({ campo: 'publico', texto: 'Para quem é (público-alvo)? Ex.: “pequenas lojas de roupa”.' }); }
    if (!m.captar?.beneficio) { falta.push({ campo: 'beneficio', texto: 'Qual benefício REAL a pessoa ganha? Não consegui identificar o benefício da sua oferta.' }); }
    if (!m.captar?.acao) { falta.push({ campo: 'acao', texto: 'O que a pessoa deve fazer depois de clicar: conhecer, pedir demonstração, conversar com um vendedor ou entrar na lista?' }); }
  }
  return falta;
}

/**
 * O auditor. Função pura: recebe o material e o que precisa do mundo (produto
 * do catálogo, dados da imagem, códigos em uso) e devolve o relatório — com a
 * EVIDÊNCIA de cada decisão.
 *
 * Três resultados (`veredito`): aprovado · aprovado com recomendações ·
 * reprovado. Reprova só o que IMPEDE: falta de informação obrigatória,
 * incoerência comprovada (preço ≠ catálogo) ou arquivo fora do exigido pelo
 * Telegram. Estética é recomendação — não bloqueia material tecnicamente válido.
 */
export function auditar(m0, ctx = {}) {
  const m = { ...m0, nome: String(m0.nome || '').trim(), texto: String(m0.texto || '').trim(), codigo: String(m0.codigo || '').trim() };
  const itens = [];
  const add = (grupo, nivel, texto, evidencia = null) => itens.push({ grupo, nivel, texto, ...(evidencia ? { evidencia } : {}) });
  const agora = ctx.agora ? new Date(ctx.agora) : new Date();
  const hoje = agora.toISOString().slice(0, 10);
  const p = ctx.produto;

  /* ── Informações obrigatórias do objetivo ── */
  if (m.texto && ehPedidoDeAjuda(m.texto)) {
    add('requisitos', 'corrigir', 'Isso é um pedido de ajuda, não um texto de campanha. Use “Me ajude a montar a campanha”: eu pergunto só o que falta e monto a sugestão.', `texto: “${m.texto.slice(0, 60)}”`);
  }
  const falta = requisitosDoObjetivo(m, p);
  for (const f of falta) { add('requisitos', 'corrigir', f.texto, `campo obrigatório de “${OBJETIVOS[m.objetivo]}”: ${f.campo}`); }
  if (!falta.length && !ehPedidoDeAjuda(m.texto)) { add('requisitos', 'ok', `Tudo o que “${OBJETIVOS[m.objetivo]}” exige está informado.`); }

  /* ── Produto e preço: sempre a fonte oficial (catálogo) ── */
  if (m.objetivo === 'produto' || m.objetivo === 'promocao' || (m.objetivo === 'captar' && m.captar?.sku)) {
    const sku = m.sku || m.captar?.sku;
    if (!sku) { /* já cobrado nos requisitos */ }
    else if (!p) { add('produto', 'bloquear', 'O produto escolhido não existe no catálogo.', `sku ${sku} não encontrado`); }
    else if (p.ativo === false) { add('produto', 'bloquear', `“${p.nome}” está inativo no catálogo — reative ou escolha outro.`, `sku ${sku} inativo`); }
    else {
      const normal = p.precoDeCentavos ?? p.precoCentavos;
      const aceitos = [p.precoCentavos, p.precoDeCentavos, m.promo?.precoCentavos].filter((x) => x != null);
      const citados = precosNoTexto(m.texto);
      const errados = citados.filter((c) => !aceitos.includes(c));
      if (errados.length) {
        add('produto', 'corrigir', `O texto cita ${errados.map(reais).join(', ')}, mas o catálogo diz ${reais(p.precoCentavos)}${m.promo?.precoCentavos ? ` (promoção: ${reais(m.promo.precoCentavos)})` : ''}. Ajuste o texto.`, `catálogo: ${reais(p.precoCentavos)}${p.precoDeCentavos ? ` (de ${reais(p.precoDeCentavos)})` : ''} · texto: ${citados.map(reais).join(', ')}`);
      }
      if (m.objetivo === 'promocao' && m.promo?.precoCentavos > 0) {
        const pr = m.promo.precoCentavos;
        if (normal != null && pr >= normal) { add('produto', 'corrigir', `O preço promocional (${reais(pr)}) não é menor que o vigente (${reais(normal)}).`, `vigente ${reais(normal)} · promo ${reais(pr)}`); }
        else if (!citados.includes(pr)) { add('mensagem', 'corrigir', `O texto não mostra o preço promocional (${reais(pr)}).`); }
      }
      if (p.esgotado) { add('produto', 'alertar', `“${p.nome}” está sem estoque — quem chegar pelo link não vai conseguir comprar.`, 'estoque disponível: 0'); }
      if (!itens.some((i) => i.grupo === 'produto' && i.nivel !== 'ok')) { add('produto', 'ok', `“${p.nome}” ativo no catálogo${citados.length ? ', preço confere' : ''}.`, `catálogo: ${reais(p.precoCentavos)}`); }
    }
  }
  if (m.objetivo === 'promocao' && m.promo?.ate && m.promo.ate < hoje) { add('mensagem', 'bloquear', `A validade da promoção (${m.promo.ate.split('-').reverse().join('/')}) já passou.`); }
  if (m.objetivo === 'evento' && m.evento?.data && m.evento.data.slice(0, 10) < hoje) { add('mensagem', 'bloquear', 'A data do evento já passou.', `data ${m.evento.data}`); }
  if (m.objetivo === 'evento' && m.evento?.link && !/^https?:\/\//.test(m.evento.link)) { add('mensagem', 'corrigir', 'O link de participação precisa começar com https://.'); }

  /* ── Imagem: técnico bloqueia; estético recomenda ── */
  const lim = m.imagem ? LIMITE.legendaFoto : LIMITE.textoSemFoto;
  if (!m.imagem) {
    add('imagem', 'sugerir', 'Sem imagem — o Telegram aceita campanha só com texto, mas foto costuma chamar mais atenção.');
  } else if (!ctx.imagem) {
    add('imagem', 'bloquear', 'Não consegui ler o arquivo da imagem (corrompido ou fora do ar). Envie de novo ou gere a arte.');
  } else {
    const im = ctx.imagem;
    const ev = `${im.tipo || '?'} ${im.largura}×${im.altura} px, ${(im.bytes / 1024).toFixed(0)} KB`;
    if (!['jpeg', 'png', 'webp'].includes(im.tipo)) { add('imagem', 'bloquear', `Formato ${im.tipo ? im.tipo.toUpperCase() : 'desconhecido'} não vai como foto no Telegram — use JPG, PNG ou WebP.`, ev); }
    if (im.bytes > LIMITE.fotoBytes) { add('imagem', 'bloquear', `Imagem com ${(im.bytes / 1048576).toFixed(1)} MB — o Telegram aceita foto de até 10 MB.`, ev); }
    if (im.largura && im.altura) {
      if (im.largura + im.altura > LIMITE.fotoSomaLados) { add('imagem', 'bloquear', `Imagem de ${im.largura}×${im.altura} px — largura + altura passa de 10.000, o limite do Telegram.`, ev); }
      const prop = Math.max(im.largura, im.altura) / Math.min(im.largura, im.altura);
      if (prop > LIMITE.fotoProporcao) { add('imagem', 'bloquear', 'Imagem estreita demais (proporção acima de 20:1) — o Telegram recusa.', ev); }
      if (Math.min(im.largura, im.altura) < LIMITE.fotoLadoBom) { add('imagem', 'alertar', `Imagem pequena (${im.largura}×${im.altura} px) — utilizável, mas pode sair pouco nítida.`, ev); }
    } else { add('imagem', 'bloquear', 'Não consegui ler as dimensões da imagem — o arquivo pode estar corrompido.', ev); }
    if (!itens.some((i) => i.grupo === 'imagem')) { add('imagem', 'ok', 'Arquivo válido e dentro dos limites do Telegram.', ev); }
  }
  if (m.imagem?.analise) {
    const { variacao, brilho } = m.imagem.analise;
    const ev = `variação ${variacao} · brilho ${brilho} (0–255)`;
    if (variacao < 8) { add('imagem', 'alertar', 'A imagem é praticamente lisa (uma cor só) — recomendo a foto do produto ou gerar a arte da campanha.', ev); }
    else if (brilho < 35) { add('imagem', 'alertar', 'Imagem muito escura — no celular quase não se vê.', ev); }
    else if (brilho > 235) { add('imagem', 'alertar', 'Imagem muito clara/estourada — pode sumir no fundo do Telegram.', ev); }
  }
  /* Correspondência imagem × produto: só quando verificável (foto do catálogo
     ou arte gerada). Imagem enviada não dá pra verificar — é recomendação. */
  if (m.imagem && !m.imagem.gerada && !m.imagem.doCatalogo) {
    add('imagem', 'sugerir', (m.objetivo === 'produto' || m.objetivo === 'promocao')
      ? 'Não dá para verificar se a imagem enviada é do produto. A foto do catálogo ou “Gerar imagem” garantem.'
      : 'Não dá para verificar se a imagem combina com a campanha. “Gerar imagem” monta uma arte com o título e a chamada.');
  }

  /* ── Mensagem: compreensível e com chamada para ação ── */
  if (!m.nome) { add('mensagem', 'bloquear', 'Dê um nome à campanha (é só pra você achar ela depois).'); }
  else if (m.nome.length > LIMITE.nome) { add('mensagem', 'bloquear', `Nome longo demais (até ${LIMITE.nome} caracteres).`); }
  if (!m.texto) { add('mensagem', 'bloquear', 'Escreva o texto da publicação — ou use “Me ajude a montar a campanha”.'); }
  else if (!ehPedidoDeAjuda(m.texto)) {
    if (m.texto.length > lim) {
      add('mensagem', 'bloquear', m.imagem
        ? `Texto com ${m.texto.length} caracteres — legenda de foto no Telegram vai até ${LIMITE.legendaFoto}. Encurte ou tire a imagem.`
        : `Texto com ${m.texto.length} caracteres — mensagem no Telegram vai até ${LIMITE.textoSemFoto}.`);
    }
    for (const q of qualidadeDoTexto(m.texto)) { add('mensagem', q.nivel, q.texto, q.evidencia); }
    for (const q of regrasDoObjetivo(m, p)) { add(q.grupo, q.nivel, q.texto, q.evidencia); }
  }
  const t = ` ${semAcento(m.texto + ' ' + m.nome)} `;
  const achados = TERMOS_REVISAR.filter((x) => new RegExp(`[^a-z0-9]${semAcento(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z0-9]`).test(t));
  if (achados.length) { add('mensagem', 'revisar', `Termo que pede um olhar antes de divulgar: ${achados.map((x) => `“${x}”`).join(', ')}. Se estiver tudo certo, aprove com a ressalva.`, `termos: ${achados.join(', ')}`); }
  if (m.texto && !ehPedidoDeAjuda(m.texto) && !itens.some((i) => i.grupo === 'mensagem' && i.nivel !== 'ok')) { add('mensagem', 'ok', `Texto compreensível, com chamada para ação (${m.texto.length} de ${lim} caracteres).`); }

  /* ── Destino: alcance e link rastreável ── */
  const lugares = (m.divulgacao || []).length;
  const minimo = ALCANCE_MINIMO[m.objetivo] || 1;
  if (lugares < minimo) {
    add('destino', 'corrigir', m.objetivo === 'captar'
      ? `Captar clientes pede alcance: escolha pelo menos ${minimo} lugares onde o link vai aparecer (ex.: canal do Telegram + Instagram).`
      : 'Diga onde a campanha vai aparecer (destino obrigatório).', `lugares escolhidos: ${lugares}`);
  } else { add('destino', 'ok', `Vai aparecer em ${lugares} lugar(es): ${m.divulgacao.map((x) => LUGARES[x]).join(', ')}.`); }
  if (!FORMATO_CODIGO.test(m.codigo)) { add('destino', 'bloquear', 'O código do link só pode ter letras sem acento, números, “_” e “-”, até 64 caracteres.'); }
  else if ((ctx.codigosEmUso || []).includes(m.codigo)) { add('destino', 'bloquear', `Já existe outra campanha com o código “${m.codigo}”. Troque pra não misturar os resultados.`); }
  else if (!ctx.linkBot) { add('destino', 'alertar', 'O bot do Telegram não está conectado — o link só funciona depois de conectar.'); }
  else { add('destino', 'ok', `Link rastreável: ${ctx.linkBot}?start=${m.codigo}`); }

  const resultado = pior(itens);
  return { itens, resultado, veredito: vereditoDe(resultado), em: agoraIso() };
}

/** Aprovado · Aprovado com recomendações · Reprovado. */
export const VEREDITOS = { aprovado: 'Aprovado', recomendacoes: 'Aprovado com recomendações', reprovado: 'Reprovado' };
export const vereditoDe = (resultado) => (['bloquear', 'corrigir'].includes(resultado) ? 'reprovado' : resultado === 'ok' ? 'aprovado' : 'recomendacoes');

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
  // Aprovada agora OU já aprovada antes (reaberta para revisão): o código é dela.
  const meu = eu && (!EDITAVEL.includes(eu.estado) || (eu.aprovacoesAnteriores || []).length) ? eu.codigo : null;
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
  const { produto, versao } = versaoAtual(c, ctx);
  if (c.auditoria?.versao === versao && !ctx.forcar) {
    return { ok: true, campanha: publico(c), reaproveitada: true };
  }
  const rel = auditar(c, { produto, imagem: c.imagem && ctx.imagem ? ctx.imagem(c.imagem) : null, codigosEmUso: codigosEmUso(d, c.id), linkBot: ctx.linkBot || null, agora: ctx.agora });
  c.auditoria = { versao, ...rel };
  /* Registro de evidências: cada auditoria (por versão) fica guardada com os
     motivos — é o que responde "por que essa campanha foi (ou não) aprovada?". */
  c.auditorias = [...(c.auditorias || []), { versao, em: rel.em, resultado: rel.resultado, veredito: rel.veredito, itens: rel.itens }].slice(-20);
  c.estado = ['revisar', 'corrigir', 'bloquear'].includes(rel.resultado) ? 'em-revisao' : 'aguardando-aprovacao';
  c.historico.push({ em: rel.em, evento: `auditada: ${VEREDITOS[rel.veredito].toLowerCase()}` });
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
  // Reaprovação (campanha reaberta): o link já existe — só volta a contar.
  const jaTem = resultados.campanhas().some((x) => x.codigo === c.codigo);
  const reg = jaTem ? resultados.arquivarCampanha(c.codigo, false) : resultados.criarCampanha({ nome: c.nome, canal: c.canal, codigo: c.codigo });
  if (!reg.ok) { return { ok: false, erro: reg.erro }; }
  const quando = agoraIso();
  c.estado = 'ativa';
  c.aprovacao = { em: quando, por, versao: a.versao, ressalvas };
  c.historico.push({ em: quando, evento: ressalvas.length ? `aprovada com ${ressalvas.length} ressalva(s)` : 'aprovada' });
  gravar(d);
  return { ok: true, campanha: publico(c) };
}

/** Produto que a campanha usa (produto, promoção ou a solução de captar) e a versão atual. */
function versaoAtual(c, ctx = {}) {
  const sku = c.sku || c.captar?.sku || null;
  const produto = sku && ctx.produto ? ctx.produto(sku) : null;
  return { produto, versao: versaoDe(c, produto) };
}

/**
 * O BACKEND confere de novo antes de publicar — não depende da tela: a versão
 * aprovada tem de ser a de agora (texto, imagem, produto, preço/estoque no
 * catálogo) e a auditoria de agora não pode reprovar.
 */
export function revalidar(c, ctx = {}) {
  if (c.estado !== 'ativa' || !c.aprovacao) { return { ok: false, erro: 'a campanha não está aprovada' }; }
  const { produto, versao } = versaoAtual(c, ctx);
  if (versao !== c.aprovacao.versao) {
    return { ok: false, erro: 'algo mudou desde a aprovação (texto, imagem, produto ou preço/estoque no catálogo) — reabra a campanha, revise e aprove de novo' };
  }
  const d = ler();
  const rel = auditar(c, { produto, imagem: c.imagem && ctx.imagem ? ctx.imagem(c.imagem) : null, codigosEmUso: codigosEmUso(d, c.id).filter((x) => x !== c.codigo), linkBot: ctx.linkBot || null, agora: ctx.agora });
  if (rel.veredito === 'reprovado') { return { ok: false, erro: `a auditoria de agora reprova: ${rel.itens.filter((i) => ['bloquear', 'corrigir'].includes(i.nivel)).map((i) => i.texto).join(' ')}` }; }
  return { ok: true };
}

/**
 * Reabrir para revisão: a campanha sai do ar (o link para de atribuir),
 * publicações agendadas são canceladas e ela volta a rascunho. Nova aprovação
 * reativa o MESMO link.
 */
export function reabrir(id, por = null) {
  const d = ler();
  const c = d.campanhas.find((x) => x.id === id);
  if (!c) { return { ok: false, erro: 'campanha não encontrada' }; }
  if (c.estado !== 'ativa') { return { ok: false, erro: 'só campanha ativa é reaberta' }; }
  resultados.arquivarCampanha(c.codigo, true);
  const quando = agoraIso();
  for (const p of c.publicacoes || []) { if (p.estado === 'agendada') { p.estado = 'cancelada'; p.canceladaEm = quando; p.erro = 'campanha reaberta para revisão'; } }
  c.aprovacoesAnteriores = [...(c.aprovacoesAnteriores || []), c.aprovacao].slice(-10);
  c.aprovacao = null;
  c.estado = 'rascunho';
  c.historico.push({ em: quando, evento: `reaberta para revisão${por ? ` por ${por}` : ''}` });
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
  /* O dono clicou em "Conectar canal/grupo" no painel e, nos minutos seguintes,
     o bot entrou com permissão: é ELE adicionando — entra já confirmado. Fora
     dessa janela (alguém pôs o bot sem passar pelo painel) continua pendente. */
  if (!saiu && x.estado === 'pendente' && x.podePublicar && d.aguardandoDestinoAte && d.aguardandoDestinoAte >= agoraIso()) {
    x.estado = 'confirmado'; x.confirmadoEm = agoraIso(); x.confirmadoPor = d.aguardandoDestinoPor || 'dono (pelo painel)'; x.origem = 'painel';
  }
  gravar(d);
  return { ok: true, destino: x };
}

/**
 * O dono vai adicionar o bot a um canal/grupo pelo painel: abre uma janela de
 * 10 min em que o destino que chegar (com permissão) entra confirmado.
 */
export function aguardarDestino({ minutos = 10, por = null } = {}) {
  const d = ler();
  d.aguardandoDestinoAte = new Date(Date.now() + minutos * 60000).toISOString();
  d.aguardandoDestinoPor = por;
  gravar(d);
  return { ok: true, ate: d.aguardandoDestinoAte };
}

/** Cadastro manual (canal onde o bot já estava antes): vem da consulta ao Telegram. `confirmar`: foi o dono, no painel. */
export function cadastrarDestino(consulta = {}, { confirmar = false, por = null } = {}) {
  if (!consulta.ok) { return { ok: false, erro: consulta.erro || 'não consegui consultar o destino' }; }
  if (!['channel', 'group', 'supergroup'].includes(consulta.chat?.tipo)) { return { ok: false, erro: 'isso é uma conversa privada — publicação é só em canal ou grupo' }; }
  const r = registrarEventoMembro({ chat: consulta.chat, status: consulta.status, podePublicar: consulta.podePublicar });
  if (r.destino) {
    const d = ler(); const x = destinosDe(d).find((y) => y.id === r.destino.id);
    if (x) {
      if (x.origem === 'evento' && !x.adicionadoPor) { x.origem = 'manual'; }
      if (confirmar && x.podePublicar && x.estado === 'pendente') { x.estado = 'confirmado'; x.confirmadoEm = agoraIso(); x.confirmadoPor = por || 'dono (pelo painel)'; }
      gravar(d); r.destino = x;
    }
  }
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
export function agendarPublicacao(id, { destinos = [], quando = null, por = null, agora = new Date(), ctx = null } = {}) {
  const d = ler();
  const c = (d.campanhas || []).find((x) => x.id === id);
  if (!c) { return { ok: false, erro: 'campanha não encontrada' }; }
  if (c.estado !== 'ativa') { return { ok: false, erro: 'só campanha aprovada (ativa) é publicada' }; }
  if (ctx) { const v = revalidar(c, ctx); if (!v.ok) { return { ok: false, erro: v.erro }; } }
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
export async function rodarAgendador({ publicar, revalidarCom = null, agora = new Date(), espera = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
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
    else if (revalidarCom && !(r = revalidar(c, revalidarCom)).ok) { /* r já tem o motivo */ }
    else { try { r = await publicar(p, publico(c), dest); } catch (e) { r = { ok: false, erro: e.message }; } }
    d = ler(); c = d.campanhas.find((x) => x.id === v.c); p = c.publicacoes.find((x) => x.id === v.p);
    Object.assign(p, r.ok ? { estado: 'publicada', publicadaEm: agoraIso(), mensagemId: r.mensagemId || null, link: r.link || null, erro: null } : { estado: 'falha', falhouEm: agoraIso(), erro: r.erro || 'motivo não informado' });
    c.historico.push({ em: agoraIso(), evento: r.ok ? `publicada em ${p.destino}` : `falhou em ${p.destino}: ${p.erro}` });
    gravar(d);
    feitas.push({ id: p.id, ok: r.ok, erro: r.erro || null });
  }
  return { publicadas: feitas.filter((x) => x.ok).length, falhas: feitas.filter((x) => !x.ok).length, feitas };
}
