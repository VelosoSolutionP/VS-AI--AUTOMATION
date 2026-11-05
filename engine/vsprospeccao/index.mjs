/**
 * VSprospeccao — o vendedor indo ATRÁS do cliente, região por região.
 *
 * Não é campanha. Campanha é vitrine (desconto, produto novo, marca) publicada
 * com link. Prospecção é pescaria: pode ter resposta, pode não ter — e quando
 * não tem, TROCA A ABORDAGEM em vez de insistir no que não pegou. Palavras do
 * dono (28/09): "estamos tentando pescar… se não der, vamos ter que adotar
 * outra abordagem".
 *
 * O que mora aqui:
 *  - o PLANO (propósito, período, meta, quem aprovou) — é o que dá lastro à
 *    decisão de ir pro interior;
 *  - as REGIÕES, cada uma com a abordagem da vez e as que já foram tentadas;
 *  - os CONTATOS (comércio abordado), com a etapa e a cadência de toques
 *    (dia 2, 5 e 10; depois disso, sem resposta).
 *
 * Regra da troca: numa região, a abordagem da vez com pelo menos
 * MIN_SEM_RESPOSTA contatos sem resposta e NENHUM que respondeu "não pegou" —
 * a tela avisa e sugere a próxima que ainda não foi tentada ali.
 *
 * Sem IA e sem disparo: é o controle da prospecção, quem fala é o vendedor.
 * O botão do WhatsApp abre a conversa com o texto pronto (wa.me) e REGISTRA o
 * toque no mesmo clique — disparo automático em massa pra quem nunca falou com
 * a gente derruba o número (termos do WhatsApp), então quem aperta enviar é gente.
 *
 * LGPD: a base é pública, mas MEI é pessoa física — o celular e o e-mail são
 * dela. Por isso: a 1ª mensagem diz de onde veio o contato, toda mensagem
 * oferece o SAIR, e quem pede pra sair tem os dados de contato apagados e o
 * número bloqueado (hash) pra não voltar numa importação futura.
 */
import * as intel from './inteligencia.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { dentroDaCasa } from '../casa.mjs';

const arq = () => (process.env.VSPROSPECCAO_DIR ? join(process.env.VSPROSPECCAO_DIR, 'prospeccao.json') : dentroDaCasa('vsprospeccao', 'prospeccao.json'));
const ler = () => { try { return { bloqueados: [], ...JSON.parse(readFileSync(arq(), 'utf8')) }; } catch { return { plano: null, regioes: [], contatos: [], bloqueados: [] }; } };
/* Guarda só o hash do número de quem pediu pra sair: dá pra barrar sem manter o dado. */
const hashTel = (t) => createHash('sha256').update(String(t || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')).digest('hex');
const gravar = (d) => { mkdirSync(dirname(arq()), { recursive: true, mode: 0o700 }); writeFileSync(arq(), JSON.stringify(d, null, 2), { mode: 0o600 }); };
/* Ondas que recebem e-mail. Base antiga só tinha `ondaAtual` (uma por vez). */
const ondasLiberadasDe = (db) => new Set(db.ondasLiberadas || (db.ondaAtual ? [db.ondaAtual] : []));
const id = (p) => `${p}_${randomBytes(5).toString('hex')}`;
const iso = (agora = new Date()) => new Date(agora).toISOString();
const txt = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const dia = (d) => String(d || '').slice(0, 10);
const somaDias = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString(); };

export const ABORDAGENS = Object.freeze({
  'mensagem-direta': 'Mensagem direta no WhatsApp do comércio',
  'grupo-local': 'Grupo de WhatsApp/Telegram da cidade',
  ligacao: 'Ligação',
  visita: 'Visita presencial',
  'parceiro-local': 'Parceiro local (CDL, sindicato rural, contador)',
  indicacao: 'Indicação de cliente',
});
/* Ordem em que se tenta: do mais barato pro mais caro. */
export const ORDEM = ['mensagem-direta', 'grupo-local', 'ligacao', 'parceiro-local', 'visita', 'indicacao'];
export const ETAPAS = Object.freeze({
  'na-lista': 'Na lista (não contatado)',
  contatado: 'Contatado', respondeu: 'Respondeu', demonstracao: 'Demonstração',
  cliente: 'Virou cliente', 'sem-resposta': 'Sem resposta', 'nao-quer': 'Não quer',
});
/* Regra do dono (28/09, revista no mesmo dia: "mata a segunda e vamos só em duas"):
   dia 0 = E-MAIL automático com a apresentação e o portfólio; dia 5 = WhatsApp, a
   ÚLTIMA tentativa, pela mão de gente, com o texto dele; sem resposta, encerra —
   "não adianta insistir". WhatsApp nunca é automático: mensagem fria em volume
   bane o número da Micaela. */
export const CADENCIA = [5];
export const TOQUES = Object.freeze({ 1: 'e-mail — apresentação e portfólio', 2: 'WhatsApp — última tentativa' });
export const MIN_SEM_RESPOSTA = 5;
const RESPONDEU = ['respondeu', 'demonstracao', 'cliente', 'nao-quer'];
/*
 * De onde veio cada lista — o link oficial é a resposta pra "de onde tiraram meu
 * contato?". A base do CNPJ é a da Receita (Nextcloud público, arquivos
 * Estabelecimentos + Municípios), baixada pelo scripts/prospectar-agro-cnpj.mjs.
 * Fonte nova (outra base, lista comprada, indicação): entra aqui com o site dela.
 */
export const FONTES = [
  { casa: /receita federal/i, nome: 'Receita Federal', detalhe: 'dados abertos do CNPJ',
    url: 'https://dados.gov.br/dados/conjuntos-dados/cadastro-nacional-da-pessoa-juridica---cnpj',
    arquivos: 'https://arquivos.receitafederal.gov.br/index.php/s/YggdBLfdninEJX9' },
];
const fonteDe = (texto) => (texto ? FONTES.find((f) => f.casa.test(texto)) || null : null);

/* Respondeu e ainda não decidiu: é o "tem possibilidade de fechar" do balanço. */
const EM_CONVERSA = ['respondeu', 'demonstracao'];

/* DDD por UF — contato de Água Santa/RS com DDD 61 é sinal de cadastro de fachada ou de contador de fora. */
const DDD_UF = { AC: [68], AL: [82], AP: [96], AM: [92, 97], BA: [71, 73, 74, 75, 77], CE: [85, 88], DF: [61], ES: [27, 28], GO: [61, 62, 64],
  MA: [98, 99], MT: [65, 66], MS: [67], MG: [31, 32, 33, 34, 35, 37, 38], PA: [91, 93, 94], PB: [83], PR: [41, 42, 43, 44, 45, 46], PE: [81, 87],
  PI: [86, 89], RJ: [21, 22, 24], RN: [84], RS: [51, 53, 54, 55], RO: [69], RR: [95], SC: [47, 48, 49], SP: [11, 12, 13, 14, 15, 16, 17, 18, 19],
  SE: [79], TO: [63] };

/**
 * Texto pronto do toque pelo WhatsApp. A 1ª diz de onde veio o contato
 * (transparência) e todas oferecem o SAIR (oposição) — é o que sustenta o
 * legítimo interesse se alguém perguntar.
 */
export const saudacao = (agora = new Date()) => {
  /* Horário de Brasília (UTC-3): antes do meio-dia, bom dia; até as 18h, boa tarde. */
  const h = (new Date(agora).getUTCHours() + 21) % 24;
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
};
/** Nome pra falar com a empresa: sem nome na base, "sua empresa" — nunca "CNPJ 1234". */
const nomeDe = (c) => (c.nome && !/^CNPJ \d/.test(c.nome) ? c.nome : null);

/*
 * LINK "NÃO TENHO INTERESSE" (02/10, dono: "caso não tenha interesse, ele clica em
 * alguma parte, chega pra nós e tiramos ele da base"). O token é o id do contato
 * assinado com um segredo da casa — não dá pra adivinhar o de outra empresa.
 * Abrir o link NÃO tira ninguém (o WhatsApp abre links sozinho pra montar a
 * prévia); quem tira é o botão da página (POST) → mover(..., 'saiu').
 */
const arqSegredo = () => join(dirname(arq()), 'sair-segredo');
function segredoSair() {
  try { const t = readFileSync(arqSegredo(), 'utf8').trim(); if (t.length >= 32) { return t; } } catch { /* cria abaixo */ }
  const t = randomBytes(32).toString('hex');
  mkdirSync(dirname(arqSegredo()), { recursive: true, mode: 0o700 }); writeFileSync(arqSegredo(), t, { mode: 0o600 });
  return t;
}
const assinar = (id) => createHmac('sha256', segredoSair()).update(String(id)).digest('base64url').slice(0, 22);
export const tokenSair = (contatoId) => `${contatoId}.${assinar(contatoId)}`;
/** O contato do token (ou null se o token é falso). */
export function contatoDoTokenSair(token) {
  const m = /^([A-Za-z0-9_-]{3,40})\.([A-Za-z0-9_-]{22})$/.exec(String(token || ''));
  if (!m) { return null; }
  const a = Buffer.from(assinar(m[1])), b = Buffer.from(m[2]);
  if (a.length !== b.length || !timingSafeEqual(a, b)) { return null; }
  const c = ler().contatos.find((x) => x.id === m[1]);
  return c ? { id: c.id, nome: nomeDe(c), optout: !!c.optout } : null;
}
export const linkSair = (c, origem) => (origem ? `${String(origem).replace(/\/$/, '')}/sair/${tokenSair(c.id)}` : null);

/**
 * Texto do WhatsApp — a ÚLTIMA tentativa (dia 5). 02/10 (dono: "tenta ser direta,
 * de forma que ele entenda o motivo do contato"): diz quem é, por que está
 * falando com a empresa, de onde veio o contato, e dá o link pra sair. Não supõe
 * que o e-mail chegou (parte do 1º lote voltou) — resume o que ele dizia.
 * Parceiro de sistema (tem `oferta`) recebe o motivo da parceria; o resto, o do cliente.
 */
export function mensagem(c, toque = 2, { loja = 'Veloso Solution', vendedor = 'Fabiano', agora = new Date(), origem = null } = {}) {
  const emp = nomeDe(c) || 'sua empresa';
  const motivo = c.oferta
    ? `Estou falando com a ${emp} porque procuramos um parceiro por região pra revender o ZEST, nosso sistema de atendimento e vendas no WhatsApp — você vende com a sua margem.`
    : `Estou falando com a ${emp} porque temos o ZEST: ele atende seus clientes no WhatsApp 24 horas, tira o pedido e recebe no Pix, sem trocar o sistema que vocês já usam.`;
  const sair = linkSair(c, origem);
  return `${saudacao(agora)}! Aqui é o ${vendedor || 'Fabiano'}, da ${loja || 'Veloso Solution'}.\n\n${motivo} Mandei a apresentação por e-mail há alguns dias.\n\n`
    + 'Se fizer sentido, me responde aqui que te explico em 2 minutos.\n\n'
    + (sair ? `Se não tiver interesse, toque aqui e tiramos seu contato da nossa base: ${sair}\n\n` : 'Se não tiver interesse, responda SAIR e tiramos seu contato da nossa base.\n\n')
    + 'Seu contato veio dos dados públicos de empresas da Receita Federal. Obrigado pelo seu tempo!';
}

/**
 * O e-mail do dia 0, a partir do modelo aprovado pelo dono
 * (docs/prospeccao/email-1a-mensagem.txt): troca {EMPRESA} e {Bom dia | Boa tarde}
 * e separa o assunto. A linha da fonte (Receita) e o SAIR vêm do próprio modelo.
 */
export function emailApresentacao(c, modelo, { agora = new Date() } = {}) {
  const emp = nomeDe(c) || 'sua empresa';
  const t = String(modelo || '').replace(/\{EMPRESA\}/g, emp).replace(/\{Bom dia \| Boa tarde\}/g, saudacao(agora))
    .replace(/\{TERRITORIO\}/g, c.oferta?.territorio || 'a sua região').replace(/\{CLIENTES\}/g, c.oferta?.clientes || 'centenas de');
  const m = /^ASSUNTO:\s*(.+)\n+/.exec(t);
  const corpo = (m ? t.slice(m[0].length) : t).replace(/\n+ANEXO:.*$/s, '').trim();
  return { assunto: (m ? m[1] : `Parceria para a ${emp}`).replace(/para a sua empresa/g, 'para sua empresa').trim(), texto: corpo };
}

/**
 * Respostas prontas pras três situações que o dono sabe que vão acontecer (28/09).
 * Sempre cordial — quem responde é a marca. As que encerram também apagam o
 * contato e bloqueiam o número (LGPD): pedir desculpa e continuar mandando é pior.
 */
export function respostas({ agora = new Date() } = {}) {
  const fim = `A Veloso Solution deseja ${saudacao(agora) === 'Bom dia' ? 'um bom dia' : saudacao(agora) === 'Boa tarde' ? 'uma boa tarde' : 'uma boa noite'}.`;
  return [
    { id: 'grosseria', titulo: 'Foi grosso ou faltou com respeito', apaga: true,
      texto: `Entendemos, e pedimos desculpas pelo transtorno. Já estamos removendo o seu número do nosso cadastro e você não receberá mais mensagens nossas. ${fim}` },
    { id: 'origem', titulo: 'Perguntou de onde veio o número', apaga: false,
      texto: 'Seu contato veio dos dados públicos de empresas da Receita Federal (dados abertos do CNPJ) — é assim que nós, vendedores, trabalhamos para apresentar soluções às empresas. '
        + `Se isso te incomodou, pedimos desculpas: é só nos avisar que apagamos o seu contato na hora. ${fim}` },
    /* Parceiro de sistema perguntou se ganha nos nossos valores (dono, 29/09): não é
       comissão — é margem própria, logo no site; consultoria e suporte adicional são nossos. */
    { id: 'parceiro-ganho', titulo: 'Parceiro perguntou se ganha nos nossos valores', apaga: false,
      texto: 'Ótima pergunta! Não trabalhamos com comissão sobre os nossos valores: a nossa margem já é bem apertada. O seu ganho vem de outro jeito, e costuma ser maior que o nosso. '
        + 'A nossa tabela é o valor firme que você paga; o preço para o seu cliente é você quem define. Pode ficar no meio-termo entre o nosso e o que o mercado cobra: hoje, sistemas de pedido pelo WhatsApp saem de R$ 184,90 a R$ 299,99 por mês. '
        + 'A sua logo também entra no nosso site, na página de parceiros. A consultoria e o suporte adicional ficam com a nossa equipe. '
        + `Se quiser, te mando a comparação completa com os valores do mercado. ${fim}` },
    { id: 'sem-interesse', titulo: 'Não tem interesse / pediu pra parar', apaga: true,
      texto: `Tudo bem, agradecemos pelo seu tempo e pedimos desculpas pelo incômodo. Já estamos apagando o seu contato do nosso cadastro. ${fim}` },
  ];
}

/** Link wa.me com o texto do próximo toque — só pros toques que são mensagem (1º e 2º). */
function linkWhatsapp(c, opts) {
  if (!c.whatsapp) { return null; }
  /* Só a última tentativa (dia 5) é WhatsApp — e só depois que o e-mail saiu. */
  const toque = c.etapa === 'contatado' && c.toques === 1 && !c.optout ? 2 : null;
  if (!toque) { return null; }
  return { toque, url: `https://wa.me/55${c.whatsapp}?text=${encodeURIComponent(mensagem(c, toque, opts))}` };
}

/** Sinais de que o contato da base pública não é bem da empresa — não barra, avisa o vendedor. */
function alertasDe(c, uf, emailsRepetidos) {
  const a = [];
  const tel = c.whatsapp || c.telefone;
  const ddd = tel ? Number(String(tel).slice(0, 2)) : null;
  if (ddd && DDD_UF[uf] && !DDD_UF[uf].includes(ddd)) { a.push(`DDD ${ddd} é de fora de ${uf}`); }
  if (c.email && emailsRepetidos.has(c.email)) { a.push('e-mail repetido em outras empresas (genérico ou de contador)'); }
  if (!c.whatsapp && c.telefone && c.etapa === 'na-lista') { a.push('só telefone fixo — abordar por ligação'); }
  return a;
}

/** O plano: propósito, período, meta e a aprovação. Só o dono grava. */
export function salvarPlano(d = {}, { por = null, agora = new Date() } = {}) {
  const db = ler();
  const inicio = dia(d.inicio), fim = dia(d.fim);
  const meta = Number(d.meta);
  const erros = [];
  if (!txt(d.nome, 120)) { erros.push('dê um nome ao plano'); }
  if (!txt(d.proposito, 600)) { erros.push('escreva o propósito'); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim) || fim < inicio) { erros.push('período inválido'); }
  if (!Number.isInteger(meta) || meta < 1) { erros.push('meta de clientes precisa ser um número inteiro'); }
  if (erros.length) { return { ok: false, motivo: erros[0], erros }; }
  db.plano = { nome: txt(d.nome, 120), proposito: txt(d.proposito, 600), inicio, fim, meta,
    aprovacao: d.aprovadoPor ? { por: txt(d.aprovadoPor, 120), em: iso(agora) } : (db.plano?.aprovacao || null), atualizadoEm: iso(agora), atualizadoPor: por };
  gravar(db);
  return { ok: true, plano: db.plano };
}

export function salvarRegiao(d = {}, { agora = new Date() } = {}) {
  const db = ler();
  const nome = txt(d.nome, 80), uf = txt(d.uf, 2).toUpperCase();
  if (!nome || !/^[A-Z]{2}$/.test(uf)) { return { ok: false, motivo: 'informe o nome da região e a UF' }; }
  const abordagem = ABORDAGENS[d.abordagem] ? d.abordagem : ORDEM[0];
  const atual = d.id ? db.regioes.find((r) => r.id === d.id) : null;
  if (d.id && !atual) { return { ok: false, motivo: 'região não encontrada' }; }
  const r = atual || { id: id('rg'), criadaEm: iso(agora), abordagem, tentadas: [{ abordagem, desde: iso(agora) }] };
  Object.assign(r, { nome, uf, cidades: txt(d.cidades, 200), publico: txt(d.publico, 200) });
  /* E-mail do dia 0 PRÓPRIO da região (29/09: comércio de bairro de BH não é
     agro). Só o nome do arquivo em docs/prospeccao; sem isso, vale o padrão. */
  if (d.modelo !== undefined) { r.modelo = /^[\w.-]+\.txt$/.test(String(d.modelo || '')) ? String(d.modelo) : null; }
  /* Anexos: portfólio (.pdf) e vídeo (.mp4) — um nome ou uma lista. */
  if (d.anexo !== undefined) {
    const lista = (Array.isArray(d.anexo) ? d.anexo : [d.anexo]).map(String).filter((n) => /^[\w.-]+\.(pdf|mp4)$/.test(n)).slice(0, 3);
    r.anexo = lista.length ? (lista.length === 1 ? lista[0] : lista) : null;
  }
  db.regioes = [...db.regioes.filter((x) => x.id !== r.id), r];
  gravar(db);
  return { ok: true, regiao: r };
}

/** Troca a abordagem da região. A anterior fica no histórico — é o que diz o que já não pegou ali. */
/** Tira uma região sem nenhum contato (plano mudou de estado, por exemplo). */
export function removerRegiao(regiaoId) {
  const db = ler();
  if (!db.regioes.some((r) => r.id === regiaoId)) { return { ok: false, motivo: 'região não encontrada' }; }
  if (db.contatos.some((c) => c.regiaoId === regiaoId)) { return { ok: false, motivo: 'a região tem contatos — não dá pra tirar' }; }
  db.regioes = db.regioes.filter((r) => r.id !== regiaoId);
  gravar(db);
  return { ok: true };
}

/**
 * Empresas da base PÚBLICA (Receita Federal, dados abertos do CNPJ) entram "na
 * lista": ainda não foram contatadas. CNPJ repetido não entra de novo. A fonte
 * fica gravada em cada uma — é a resposta pra "de onde veio esse contato?".
 */
export function importarLista(regiaoId, empresas = [], { fonte, agora = new Date() } = {}) {
  const db = ler();
  const r = db.regioes.find((x) => x.id === regiaoId);
  if (!r) { return { ok: false, motivo: 'região não encontrada' }; }
  const jaTem = new Set(db.contatos.map((c) => c.cnpj).filter(Boolean));
  const bloq = new Set(db.bloqueados);
  let novos = 0, repetidos = 0, bloqueados = 0;
  for (const e of empresas) {
    const cnpj = String(e.cnpj || '').replace(/\D/g, '');
    if (!cnpj || jaTem.has(cnpj)) { repetidos++; continue; }
    const whats = String(e.whatsapp || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
    if ((whats && bloq.has(hashTel(whats))) || (e.telefone && bloq.has(hashTel(e.telefone)))) { bloqueados++; continue; }
    jaTem.add(cnpj);
    db.contatos.push({ id: id('pc'), regiaoId: r.id, cnpj, nome: txt(e.nome, 120) || `CNPJ ${cnpj}`, cidade: txt(e.cidade, 80) || null,
      segmento: txt(e.segmento, 120) || null, telefone: String(e.telefone || '').replace(/\D/g, '') || null, whatsapp: whats || null,
      email: txt(e.email, 120).toLowerCase() || null, responsavel: txt(e.responsavel, 120) || null,
      /* Parceiro por território (29/09): o que o e-mail dele diz — território e nº de possíveis clientes. */
      ...(e.oferta ? { oferta: { territorio: txt(e.oferta.territorio, 200) || null, clientes: txt(e.oferta.clientes, 20) || null, numero: Number(e.oferta.numero) || null } } : {}),
      abordagem: r.abordagem, etapa: 'na-lista', toques: 0, criadoEm: iso(agora), fonte: txt(fonte, 160) || null, historico: [{ em: iso(agora), evento: 'entrou na lista', fonte: txt(fonte, 160) || null }] });
    novos++;
  }
  gravar(db);
  return { ok: true, novos, repetidos, bloqueados };
}

export function trocarAbordagem(regiaoId, abordagem, { por = null, motivo = null, agora = new Date() } = {}) {
  const db = ler();
  const r = db.regioes.find((x) => x.id === regiaoId);
  if (!r) { return { ok: false, motivo: 'região não encontrada' }; }
  if (!ABORDAGENS[abordagem]) { return { ok: false, motivo: 'abordagem inválida' }; }
  if (r.abordagem === abordagem) { return { ok: false, motivo: 'essa já é a abordagem da vez' }; }
  const t = [...(r.tentadas || [])];
  const aberta = t.findLast((x) => x.abordagem === r.abordagem && !x.ate);
  if (aberta) { aberta.ate = iso(agora); aberta.motivo = txt(motivo, 200) || null; aberta.por = por; }
  t.push({ abordagem, desde: iso(agora), por });
  Object.assign(r, { abordagem, tentadas: t });
  gravar(db);
  return { ok: true, regiao: r };
}

/** Registra um comércio abordado. A abordagem é a da vez na região (ou a informada). */
export function registrarContato(d = {}, { por = null, agora = new Date() } = {}) {
  const db = ler();
  const r = db.regioes.find((x) => x.id === d.regiaoId);
  if (!r) { return { ok: false, motivo: 'escolha a região' }; }
  const nome = txt(d.nome, 120);
  if (!nome) { return { ok: false, motivo: 'informe o nome do comércio ou da pessoa' }; }
  const whats = String(d.whatsapp || '').replace(/\D/g, '');
  if (whats && db.contatos.some((c) => c.whatsapp === whats)) { return { ok: false, motivo: 'esse WhatsApp já está na prospecção' }; }
  if (whats && db.bloqueados.includes(hashTel(whats))) { return { ok: false, motivo: 'esse número pediu pra não receber mais mensagens' }; }
  const abordagem = ABORDAGENS[d.abordagem] ? d.abordagem : r.abordagem;
  const c = { id: id('pc'), regiaoId: r.id, nome, cidade: txt(d.cidade, 80) || null, whatsapp: whats || null, segmento: txt(d.segmento, 80) || null,
    abordagem, etapa: 'contatado', criadoEm: iso(agora), por, toques: 1, historico: [{ em: iso(agora), evento: `contatado — ${ABORDAGENS[abordagem].toLowerCase()}`, por }] };
  db.contatos.push(c);
  gravar(db);
  return { ok: true, contato: comProximo(c, agora) };
}

/**
 * E-MAIL QUE NÃO É DA EMPRESA (30/09, 1º lote: "voltou um monte, mandou pra empresa
 * americana"). A Receita guarda o e-mail de quem ABRIU o CNPJ — muitas vezes o
 * contador — e domínio .com antigo que já é de outro dono. Só regra, sem IA:
 *  - e-mail de escritório contábil (contab, contador, cnt.br, fiscal@, societario@…);
 *  - empresa sem nome na Receita ("CNPJ 123…"): quase sempre é o do contador;
 *  - domínio de outro país (.rs, .us…);
 *  - domínio sem .br (.com, .net, .store…) que não tem nenhuma palavra do nome da empresa;
 *  - o que o envio já achou sem servidor de e-mail (c.emailRuim).
 * Devolve o motivo, ou null quando pode mandar.
 */
const SEM_ACENTO = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const PALAVRA_FRACA = new Set(['ltda', 'comercio', 'servicos', 'empresa', 'brasil', 'agro', 'agricola', 'agricolas', 'maquinas', 'produtos', 'industria', 'distribuidora', 'cnpj']);
/* 18/10 (dono: "quase todos os e-mails estão voltando"): os 1.022 enviados até
   aqui eram TODOS de domínio de empresa, tirado do cadastro antigo da Receita —
   caixa que não existe mais. O Gmail/Hotmail do dono, que é o e-mail que o
   pequeno empresário usa de verdade, caía na regra "domínio sem .br e sem o
   nome da empresa" e nunca saía (8.466 na fila). Agora: webmail conhecido passa
   e vai primeiro; provedor que fechou sai; domínio que já devolveu sai. */
export const WEBMAIL = new Set(['gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.com.br', 'outlook.com', 'outlook.com.br', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.com.br', 'ymail.com', 'icloud.com', 'me.com', 'bol.com.br', 'uol.com.br', 'terra.com.br', 'globo.com', 'globomail.com']);
export const PROVEDOR_FECHADO = new Set(['brturbo.com.br', 'veloxmail.com.br', 'ibest.com.br', 'superig.com.br', 'click21.com.br', 'pop.com.br', 'itelefonica.com.br', 'zipmail.com.br']);
export const dominioDe = (email) => SEM_ACENTO(email).split('@')[1] || '';
export const ehWebmail = (email) => WEBMAIL.has(dominioDe(email));

export function motivoEmailRuim(c, { devolvidos = null } = {}) {
  if (c.emailRuim) { return c.emailRuim; }
  const e = SEM_ACENTO(c.email); const [local = '', dominio = ''] = e.split('@');
  if (!dominio.includes('.')) { return 'e-mail mal escrito'; }
  if (PROVEDOR_FECHADO.has(dominio)) { return 'provedor de e-mail que fechou'; }
  if (devolvidos?.has(dominio)) { return 'esse domínio já devolveu e-mail (a caixa não existe mais)'; }
  const nome = SEM_ACENTO(c.nome);
  /* Webmail sem nome fantasia: a onda já exige e-mail que não se repete (contador repete). */
  if (/^cnpj\s*\d/.test(nome) && !WEBMAIL.has(dominio)) { return 'empresa sem nome na Receita (o e-mail costuma ser do contador)'; }
  if (!/contab|contador/.test(nome) && (/contab|contador|cnt\.br|cont\.com|contadores/.test(dominio) || /^(fiscal|societario|registros?|legaliza\w*|contab\w*|dp|escrita)$/.test(local.split('.')[0]))) {
    return 'e-mail do escritório contábil, não da empresa';
  }
  if (WEBMAIL.has(dominio)) { return null; }
  const partes = dominio.split('.'); const tld = partes.at(-1);
  if (!/^[a-z]{2,24}$/.test(tld) || partes.some((x) => !x) || /com?br$/.test(tld)) { return 'e-mail mal escrito'; }
  if (tld.length === 2 && tld !== 'br') { return `domínio de outro país (.${tld})`; }
  if (tld !== 'br') {
    const raiz = partes.slice(0, -1).join('');
    const palavras = nome.split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !PALAVRA_FRACA.has(w));
    if (!palavras.some((w) => raiz.includes(w))) { return 'domínio sem .br e sem ligação com o nome da empresa (pode ser de outro dono)'; }
  }
  return null;
}

/** O envio achou o domínio sem servidor de e-mail: esse contato não entra em lote nenhum. */
export function marcarEmailRuim(contatoId, motivo) {
  const db = ler();
  const c = db.contatos.find((x) => x.id === contatoId);
  if (!c) { return { ok: false }; }
  c.emailRuim = String(motivo || 'e-mail inválido').slice(0, 160); c.atualizadoEm = iso(new Date());
  c.historico.push({ em: iso(new Date()), evento: `e-mail não enviado — ${c.emailRuim}`, canal: 'email', por: 'envio automático', semEnvio: true });
  gravar(db);
  return { ok: true };
}

/**
 * Quem recebe o e-mail do dia 0: na lista, com e-mail, sem pedido de saída. Um
 * pouco de cada região por vez (rodízio), pra comparar os estados desde o 1º lote.
 * E-mail que se repete em várias empresas (contador, genérico) fica por último.
 */
export function loteEmail({ limite = 50 } = {}) {
  const db = ler();
  /* ONDA liberada (dono, 29/09: "606 pra começar"): com onda, só ela recebe. */
  const liberadas = ondasLiberadasDe(db);
  const contagem = new Map();
  for (const c of db.contatos) { if (c.email) { contagem.set(c.email, (contagem.get(c.email) || 0) + 1); } }
  const devolvidos = new Set(db.dominiosDevolvidos || []);
  const fila = new Map(db.regioes.map((r) => [r.id, []]));
  for (const c of db.contatos) {
    if (c.etapa !== 'na-lista' || !c.email || c.optout || !fila.has(c.regiaoId)) { continue; }
    if (motivoEmailRuim(c, { devolvidos })) { continue; }
    if (liberadas.size && !liberadas.has(c.onda)) { continue; }
    fila.get(c.regiaoId).push(c);
  }
  /* Webmail primeiro (é o e-mail que o dono lê); domínio de empresa depois. */
  for (const l of fila.values()) { l.sort((a, b) => (Number(!ehWebmail(a.email)) - Number(!ehWebmail(b.email))) || (contagem.get(a.email) - contagem.get(b.email)) || String(a.criadoEm).localeCompare(String(b.criadoEm))); }
  /* E-mail que JÁ recebeu (filial da mesma empresa, contador) não recebe de
     novo em outro lote: duas mensagens na mesma caixa é spam e é print pra
     reclamação. Quem pediu pra sair teve o e-mail apagado — e o CNPJ barra. */
  const out = []; const jaEmail = new Set(db.contatos.filter((c) => c.etapa !== 'na-lista' && c.email).map((c) => c.email.toLowerCase()));
  const listas = [...fila.values()];
  while (out.length < limite && listas.some((l) => l.length)) {
    for (const l of listas) {
      while (l.length && jaEmail.has(l[0].email.toLowerCase())) { l.shift(); }
      if (l.length && out.length < limite) { const c = l.shift(); jaEmail.add(c.email.toLowerCase()); out.push(c); }
    }
  }
  return out;
}

/**
 * PORTE da Receita em cada contato (arquivos Empresas/Simples): MEI, ME, EPP ou
 * Demais, e se é pessoa física (empresário individual). Só isso — razão social
 * e CPF do MEI NÃO entram (LGPD). `porCnpjBase`: Map(cnpj8 → {porte, pf}).
 */
export function aplicarPorte(porCnpjBase) {
  const db = ler();
  let n = 0;
  for (const c of db.contatos) {
    const i = porCnpjBase.get(String(c.cnpj).padStart(14, '0').slice(0, 8));
    if (i) { c.porte = i.porte; c.pessoaFisica = i.pf === true; n++; }
  }
  gravar(db);
  return { ok: true, marcados: n };
}

/**
 * ONDAS da campanha, do menor risco pro maior (dono, 29/09). Marca os contatos
 * da onda e a libera: dali em diante o lote do e-mail só pega ela.
 */
export function definirOnda({ numero, nome, criterio, ids = [], agora = new Date() } = {}) {
  const db = ler();
  const alvo = new Set(ids);
  let n = 0;
  for (const c of db.contatos) { if (alvo.has(c.id) && c.etapa === 'na-lista' && !c.optout) { c.onda = numero; n++; } }
  db.ondas = [...(db.ondas || []).filter((o) => o.numero !== numero), { numero, nome: txt(nome, 120), criterio: txt(criterio, 400), total: n, em: iso(agora) }];
  /* Liberar uma onda nova não tranca a anterior (29/09: agro e bairro de BH
     andam juntos) — o limite do dia se divide entre as regiões. */
  db.ondasLiberadas = [...new Set([...ondasLiberadasDe(db), numero])];
  db.ondaAtual = numero;
  gravar(db);
  return { ok: true, numero, total: n };
}

/** Algum e-mail do dia 0 já saiu? (sem isso não há o que ler na caixa) */
export const emailsJaEnviados = () => ler().contatos.some((c) => (c.historico || []).some((h) => h.canal === 'email'));

/** Contatos com este e-mail (filiais podem dividir o mesmo). */
export const contatosDoEmail = (email) => { const e = String(email || '').trim().toLowerCase(); return e ? ler().contatos.filter((c) => (c.email || '').toLowerCase() === e) : []; };

/**
 * Resposta que chegou por E-MAIL (lida da caixa por backend/prospeccao-caixa.mjs):
 *  - sair      → oposição: apaga e bloqueia, em TODAS as empresas com esse e-mail;
 *  - resposta  → "Respondeu": o WhatsApp genérico do dia 5 não sai; vai pra gente;
 *  - devolvida → o e-mail não existe: anota (o WhatsApp do dia 5 continua valendo).
 * Só mexe em quem já recebeu o e-mail (etapa ≠ na-lista) — resposta de estranho não vira nada.
 */
export function respostaPorEmail(email, { tipo, assunto = '', trecho = '', agora = new Date() } = {}) {
  const alvo = contatosDoEmail(email).filter((c) => c.etapa !== 'na-lista');
  let n = 0;
  for (const c of alvo) {
    if (tipo === 'sair') {
      const antes = contatosDoEmail(email).length;
      if (!c.optout && mover(c.id, 'saiu', { por: 'caixa de e-mail', agora }).ok) { n += Math.max(1, antes - contatosDoEmail(email).length); }
      continue;
    }
    const db = ler(); const x = db.contatos.find((y) => y.id === c.id); if (!x) { continue; }
    if (tipo === 'resposta' && ['contatado', 'sem-resposta'].includes(x.etapa)) {
      x.etapa = 'respondeu';
      x.historico.push({ em: iso(agora), evento: 'respondeu por e-mail', canal: 'email', por: 'caixa de e-mail', nota: txt(`${assunto ? assunto + ' — ' : ''}${trecho}`, 200) || null });
    } else if (tipo === 'devolvida' && !x.emailDevolvido) {
      x.emailDevolvido = true;
      /* Domínio de empresa que devolveu: os outros contatos dele também não recebem. Webmail não (é caixa a caixa). */
      const dom = dominioDe(email);
      if (dom && !WEBMAIL.has(dom)) { db.dominiosDevolvidos = [...new Set([...(db.dominiosDevolvidos || []), dom])]; }
      x.historico.push({ em: iso(agora), evento: 'e-mail voltou (endereço não existe ou caixa cheia)', canal: 'email', por: 'caixa de e-mail' });
    } else { continue; }
    x.atualizadoEm = iso(agora); gravar(db); n++;
  }
  return { ok: true, contatos: n };
}

/** O mínimo de cada contato pra montar onda (sem histórico nem nome). */
export const paraOndas = () => ler().contatos.map((c) => ({ id: c.id, cnpj: c.cnpj, email: c.email || null, etapa: c.etapa, optout: !!c.optout, porte: c.porte || null, pessoaFisica: c.pessoaFisica ?? null }));

/** E-mail e anexo do dia 0 da região (null = o padrão, o do agro). */
export function modeloDaRegiao(regiaoId) {
  const r = ler().regioes.find((x) => x.id === regiaoId);
  return { modelo: r?.modelo || null, anexo: r?.anexo || null };
}

/** Todas as ondas liberadas, cada uma com quantos já receberam e quantos faltam. */
export function ondasLiberadas() {
  const db = ler(); const lib = ondasLiberadasDe(db);
  return (db.ondas || []).filter((o) => lib.has(o.numero)).map((o) => {
    const da = db.contatos.filter((c) => c.onda === o.numero);
    return { ...o, enviados: da.filter((c) => c.etapa !== 'na-lista').length, faltam: da.filter((c) => c.etapa === 'na-lista' && c.email && !c.optout && !motivoEmailRuim(c)).length, filtrados: da.filter((c) => c.etapa === 'na-lista' && c.email && !c.optout && motivoEmailRuim(c)).length };
  });
}

/**
 * RETORNO (30/09, dono: "o que deu de retorno, quantos contratos, quantos
 * parceiros — quero ver isso rápido"). Conta sobre quem JÁ recebeu o e-mail.
 * `clientes` = cadastro de Clientes e licenças (liga pelo CNPJ).
 */
export function retorno({ clientes = [] } = {}) {
  const db = ler();
  const recebeu = (c) => (c.historico || []).some((h) => h.canal === 'email');
  const env = db.contatos.filter(recebeu);
  const conta = (f) => env.filter(f).length;
  const docs = new Set(env.map((c) => String(c.cnpj || '')));
  const viraram = clientes.filter((k) => docs.has(String(k.documento || '').replace(/\D/g, '')));
  const porOnda = (db.ondas || []).map((o) => { const da = db.contatos.filter((c) => c.onda === o.numero); const e = da.filter(recebeu);
    return { numero: o.numero, nome: o.nome, total: da.length, enviados: e.length, responderam: e.filter((c) => ['respondeu', 'demonstracao', 'cliente'].includes(c.etapa)).length }; });
  return {
    enviados: env.length, naFila: db.contatos.filter((c) => c.etapa === 'na-lista' && c.onda && (ondasLiberadasDe(db).has(c.onda)) && c.email && !c.optout).length,
    devolvidos: conta((c) => (c.historico || []).some((h) => /devolv/i.test(h.evento || ''))),
    sair: conta((c) => c.optout), responderam: conta((c) => ['respondeu', 'demonstracao', 'cliente'].includes(c.etapa)),
    interessados: conta((c) => c.etapa === 'demonstracao'), clientes: conta((c) => c.etapa === 'cliente'), naoQuer: conta((c) => c.etapa === 'nao-quer'), semResposta: conta((c) => c.etapa === 'sem-resposta'),
    contratos: viraram.filter((k) => (k.contratos || []).length).length, pagos: viraram.filter((k) => (k.licencas || []).some((l) => !l.teste)).length,
    parceirosSistema: db.contatos.filter((c) => c.oferta && recebeu(c) && ['respondeu', 'demonstracao', 'cliente'].includes(c.etapa)).length,
    porOnda,
  };
}

/** A onda liberada agora, com quantos já receberam e quantos faltam. */
export function ondaAtual() {
  const db = ler();
  const o = (db.ondas || []).find((x) => x.numero === db.ondaAtual);
  if (!o) { return null; }
  const da = db.contatos.filter((c) => c.onda === o.numero);
  return { ...o, enviados: da.filter((c) => c.etapa !== 'na-lista').length, faltam: da.filter((c) => c.etapa === 'na-lista' && c.email && !c.optout && !motivoEmailRuim(c)).length, filtrados: da.filter((c) => c.etapa === 'na-lista' && c.email && !c.optout && motivoEmailRuim(c)).length };
}

/** E-mail do dia 0 saiu (o servidor aceitou): entra na cadência, com o id da mensagem no histórico. */
export function marcarEmailEnviado(contatoId, { id = null, agora = new Date() } = {}) {
  const db = ler();
  const c = db.contatos.find((x) => x.id === contatoId);
  if (!c || c.etapa !== 'na-lista') { return { ok: false }; }
  c.etapa = 'contatado'; c.toques = 1; c.contatadoEm = iso(agora); c.atualizadoEm = iso(agora);
  c.historico.push({ em: iso(agora), evento: TOQUES[1], canal: 'email', por: 'envio automático', msg: id || null });
  gravar(db);
  return { ok: true };
}

/**
 * Quem pode entrar na campanha do WhatsApp (03/10): das cidades pedidas, ainda
 * na lista (sem contato nenhum nosso), com telefone, sem pedido de sair e com o
 * número fora da lista de bloqueados.
 */
export function contatosParaCampanha({ cidades = [] } = {}) {
  const db = ler();
  const bloq = new Set(db.bloqueados);
  const quer = new Set(cidades.map((x) => String(x).toUpperCase()));
  return db.contatos.filter((c) => quer.has(String(c.cidade || '').toUpperCase()) && c.etapa === 'na-lista' && !c.optout
    && c.telefone && !bloq.has(hashTel(c.telefone)));
}

/** Quantos e-mails do dia 0 saíram hoje (limite diário do provedor). */
export function emailsHoje(agora = new Date()) {
  const hoje = iso(agora).slice(0, 10);
  return ler().contatos.filter((c) => (c.historico || []).some((h) => h.canal === 'email' && !h.semEnvio && String(h.em).slice(0, 10) === hoje)).length;
}

/**
 * Anda a etapa do contato, registra mais um toque (etapa "toque") ou o pedido
 * pra sair (etapa "saiu"). `canal: 'whatsapp'` = veio do botão que abriu a conversa.
 */
export function mover(contatoId, etapa, { por = null, nota = null, canal = null, agora = new Date() } = {}) {
  const db = ler();
  const c = db.contatos.find((x) => x.id === contatoId);
  if (!c) { return { ok: false, motivo: 'contato não encontrado' }; }
  const via = canal === 'whatsapp' ? { canal: 'whatsapp' } : {};
  if (etapa === 'contatado' && c.etapa === 'na-lista') {
    c.etapa = 'contatado'; c.toques = 1; c.contatadoEm = iso(agora);
    c.historico.push({ em: iso(agora), evento: TOQUES[1], por, nota: txt(nota, 200) || null, ...via });
  } else if (etapa === 'toque') {
    if (c.etapa !== 'contatado') { return { ok: false, motivo: 'só se cutuca quem ainda não respondeu' }; }
    c.toques = (c.toques || 1) + 1;
    c.historico.push({ em: iso(agora), evento: TOQUES[c.toques] || `toque ${c.toques}`, por, nota: txt(nota, 200) || null, ...via });
  } else if (etapa === 'saiu') {
    /* Oposição (LGPD art. 18): apaga o contato pessoal e bloqueia o número. Fica o CNPJ — é dado da empresa e é o que barra reimportar. */
    /* O pedido vale pro CANAL em qualquer empresa (filial, contador): o e-mail
       e o telefone de quem pediu são apagados das outras também — senão a
       filial ainda na lista receberia o e-mail. A outra empresa só sai inteira
       se ficar sem contato nenhum: quem tem WhatsApp próprio e respondeu com
       interesse continua sendo atendido. */
    const semDdi = (t) => String(t).replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
    const tels = new Set([c.whatsapp, c.telefone].filter(Boolean).map(semDdi));
    const mail = (c.email || '').toLowerCase();
    for (const t of tels) { const h = hashTel(t); if (!db.bloqueados.includes(h)) { db.bloqueados.push(h); } }
    Object.assign(c, { etapa: 'nao-quer', optout: true, whatsapp: null, telefone: null, email: null, responsavel: null });
    c.historico.push({ em: iso(agora), evento: 'pediu pra não receber mais mensagens — contato apagado', por });
    for (const x of db.contatos) {
      if (x.id === c.id || x.optout) { continue; }
      const tira = [];
      if (mail && (x.email || '').toLowerCase() === mail) { x.email = null; tira.push('e-mail'); }
      if (x.whatsapp && tels.has(semDdi(x.whatsapp))) { x.whatsapp = null; tira.push('WhatsApp'); }
      if (x.telefone && tels.has(semDdi(x.telefone))) { x.telefone = null; tira.push('telefone'); }
      if (!tira.length) { continue; }
      const nada = !x.email && !x.whatsapp && !x.telefone;
      if (nada) { Object.assign(x, { etapa: 'nao-quer', optout: true, responsavel: null }); }
      x.historico.push({ em: iso(agora), evento: `${tira.join(' e ')} apagado: quem usa esse contato pediu pra sair em outra empresa${nada ? ' — sem outro contato, saiu também' : ''}`, por });
      x.atualizadoEm = iso(agora);
    }
  } else {
    if (!ETAPAS[etapa]) { return { ok: false, motivo: 'etapa inválida' }; }
    c.etapa = etapa;
    c.historico.push({ em: iso(agora), evento: ETAPAS[etapa].toLowerCase(), por, nota: txt(nota, 200) || null });
  }
  c.atualizadoEm = iso(agora);
  gravar(db);
  return { ok: true, contato: comProximo(c, agora) };
}

/** Próximo toque pela cadência; passou do último, é "sem resposta" (calculado — a tela oferece marcar). */
export function proximoToque(c, agora = new Date()) {
  if (c.etapa !== 'contatado') { return null; }
  const dias = CADENCIA[(c.toques || 1) - 1];
  if (dias == null) { return { vencido: true, esgotado: true, quando: null }; }
  const quando = somaDias(c.contatadoEm || c.criadoEm, dias);
  return { quando, vencido: quando <= iso(agora), esgotado: false, oque: TOQUES[(c.toques || 1) + 1] || null };
}
const comProximo = (c, agora) => ({ ...c, proximo: proximoToque(c, agora) });

/** A situação de cada região na abordagem da vez — e se é hora de trocar. */
export function situacaoRegiao(r, contatos, agora = new Date()) {
  const naLista = contatos.filter((c) => c.regiaoId === r.id && c.etapa === 'na-lista').length;
  const daRegiao = contatos.filter((c) => c.regiaoId === r.id && c.etapa !== 'na-lista');
  const naVez = daRegiao.filter((c) => c.abordagem === r.abordagem);
  const conta = (lista, f) => lista.filter(f).length;
  const semResposta = conta(naVez, (c) => c.etapa === 'sem-resposta' || (c.etapa === 'contatado' && proximoToque(c, agora)?.esgotado));
  const responderam = conta(naVez, (c) => RESPONDEU.includes(c.etapa));
  const tentadas = new Set((r.tentadas || []).map((t) => t.abordagem));
  const trocar = semResposta >= MIN_SEM_RESPOSTA && responderam === 0;
  return {
    naLista,
    contatos: daRegiao.length,
    responderam: conta(daRegiao, (c) => RESPONDEU.includes(c.etapa)),
    demonstracoes: conta(daRegiao, (c) => ['demonstracao', 'cliente'].includes(c.etapa)),
    clientes: conta(daRegiao, (c) => c.etapa === 'cliente'),
    naAbordagem: { contatos: naVez.length, responderam, semResposta },
    trocar,
    sugestao: trocar ? ORDEM.find((a) => !tentadas.has(a)) || null : null,
    situacao: !daRegiao.length ? (naLista ? 'lista' : 'nao-iniciada') : trocar ? 'trocar' : 'andamento',
  };
}

/** Tudo o que a tela precisa. */
export function painel({ agora = new Date(), regiaoId = null, busca = '', etapa = '', limite = 10, pagina = 1, loja, vendedor, origem = null } = {}) {
  const db = ler();
  const regioes = db.regioes.map((r) => ({ ...r, ...situacaoRegiao(r, db.contatos, agora) }))
    .sort((a, b) => a.uf.localeCompare(b.uf) || a.nome.localeCompare(b.nome));
  const ufDe = new Map(db.regioes.map((r) => [r.id, r.uf]));
  const porEmail = new Map();
  for (const c of db.contatos) { if (c.email) { porEmail.set(c.email, (porEmail.get(c.email) || 0) + 1); } }
  const emailsRepetidos = new Set([...porEmail].filter(([, n]) => n > 1).map(([e]) => e));
  const todos = db.contatos.map((c) => ({ ...comProximo(c, agora), wa: linkWhatsapp(c, { loja, vendedor, origem }), alertas: alertasDe(c, ufDe.get(c.regiaoId), emailsRepetidos) }));
  const q = String(busca || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const filtrados = todos.filter((c) => (!regiaoId || c.regiaoId === regiaoId) && (!etapa || c.etapa === etapa)
    && (!q || `${c.nome} ${c.cidade || ''} ${c.segmento || ''} ${c.cnpj || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(q)))
    /* Quem tem toque vencido primeiro; depois os já contatados; a lista por último. */
    .sort((a, b) => (Number(!!b.proximo?.vencido) - Number(!!a.proximo?.vencido)) || (Number(a.etapa === 'na-lista') - Number(b.etapa === 'na-lista')) || String(b.criadoEm).localeCompare(String(a.criadoEm)));
  /* Paginação (dono, 28/09): 10, 50 ou 100 por página — são milhares de empresas. */
  const tam = [10, 50, 100].includes(Number(limite)) ? Number(limite) : 10;
  const paginas = Math.max(1, Math.ceil(filtrados.length / tam));
  const pag = Math.min(paginas, Math.max(1, Math.floor(Number(pagina) || 1)));
  const contatos = filtrados.slice((pag - 1) * tam, pag * tam);
  const trabalhados = todos.filter((c) => c.etapa !== 'na-lista');
  const hoje = dia(iso(agora));
  const p = db.plano;
  const duracao = p ? Math.round((Date.parse(p.fim) - Date.parse(p.inicio)) / 86400000) + 1 : null;
  const decorrido = p ? Math.min(duracao, Math.max(0, Math.round((Date.parse(hoje) - Date.parse(p.inicio)) / 86400000) + 1)) : null;
  const clientes = todos.filter((c) => c.etapa === 'cliente').length;
  return {
    plano: p ? { ...p, duracaoDias: duracao, diaAtual: decorrido, clientes } : null,
    regioes, contatos, filtrados: filtrados.length, pagina: pag, paginas, porPagina: tam,
    totais: { naLista: todos.length - trabalhados.length, contatos: trabalhados.length, responderam: trabalhados.filter((c) => RESPONDEU.includes(c.etapa)).length,
      demonstracoes: trabalhados.filter((c) => ['demonstracao', 'cliente'].includes(c.etapa)).length, clientes,
      tocarHoje: trabalhados.filter((c) => c.proximo?.vencido && !c.proximo?.esgotado).length },
    /* As fontes da lista inteira (não só da página), com o site de cada uma. */
    fontes: [...db.contatos.reduce((m, c) => { if (c.fonte) { m.set(c.fonte, (m.get(c.fonte) || 0) + 1); } return m; }, new Map())]
      .map(([texto, n]) => { const f = fonteDe(texto); return { texto, n, nome: f?.nome || texto, url: f?.url || null, arquivos: f?.arquivos || null }; })
      .sort((a, b) => b.n - a.n),
    abordagens: ABORDAGENS, etapas: ETAPAS, cadencia: CADENCIA, toques: TOQUES,
  };
}

/**
 * Balanço da prospecção: o que o período rendeu, pra diretoria. Enquanto o
 * plano corre é PARCIAL; passou do fim, é o FINAL.
 *
 * "Visualizaram" não existe aqui de propósito: pelo wa.me o WhatsApp não conta
 * quem leu (só a API oficial devolve leitura). Número que a gente não tem não
 * vai pro relatório.
 */
export function balanco({ agora = new Date() } = {}) {
  const db = ler();
  const p = db.plano;
  const hoje = dia(iso(agora));
  const trab = db.contatos.map((c) => comProximo(c, agora)).filter((c) => c.etapa !== 'na-lista');
  const semResp = (c) => c.etapa === 'sem-resposta' || (c.etapa === 'contatado' && c.proximo?.esgotado);
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
  const numeros = (lista) => {
    const n = { contatados: lista.length, responderam: lista.filter((c) => RESPONDEU.includes(c.etapa)).length,
      emConversa: lista.filter((c) => EM_CONVERSA.includes(c.etapa)).length, demonstracoes: lista.filter((c) => ['demonstracao', 'cliente'].includes(c.etapa)).length,
      fechados: lista.filter((c) => c.etapa === 'cliente').length, semInteresse: lista.filter((c) => c.etapa === 'nao-quer' && !c.optout).length,
      pediramSair: lista.filter((c) => c.optout).length, semResposta: lista.filter(semResp).length,
      aguardando: lista.filter((c) => c.etapa === 'contatado' && !c.proximo?.esgotado).length };
    return { ...n, taxaResposta: pct(n.responderam, n.contatados), taxaFechamento: pct(n.fechados, n.contatados) };
  };
  const agrupa = (chave, nomeDe) => {
    const g = new Map();
    for (const c of trab) { const k = chave(c) || '—'; if (!g.has(k)) { g.set(k, []); } g.get(k).push(c); }
    return [...g].map(([k, l]) => ({ nome: nomeDe ? nomeDe(k) : k, ...numeros(l) })).sort((a, b) => b.fechados - a.fechados || b.responderam - a.responderam || b.contatados - a.contatados);
  };
  const regiao = new Map(db.regioes.map((r) => [r.id, r]));
  const primeiro = (c) => c.historico.find((h) => h.evento === TOQUES[1]) || null;
  const ultimo = (c) => c.historico[c.historico.length - 1] || null;
  const envios = new Map();
  for (const c of trab) { for (const h of c.historico) { if (Object.values(TOQUES).includes(h.evento)) { const d = dia(h.em); envios.set(d, (envios.get(d) || 0) + 1); } } }
  const resumo = (c) => ({ id: c.id, nome: c.nome, cidade: c.cidade, segmento: c.segmento, regiao: regiao.get(c.regiaoId)?.nome || '—',
    etapa: ETAPAS[c.etapa], desde: ultimo(c)?.em || null, por: primeiro(c)?.por || null });
  const duracao = p ? Math.round((Date.parse(p.fim) - Date.parse(p.inicio)) / 86400000) + 1 : null;
  return {
    plano: p ? { nome: p.nome, proposito: p.proposito, inicio: p.inicio, fim: p.fim, meta: p.meta, aprovacao: p.aprovacao, duracaoDias: duracao,
      diaAtual: Math.min(duracao, Math.max(0, Math.round((Date.parse(hoje) - Date.parse(p.inicio)) / 86400000) + 1)) } : null,
    final: !!p && hoje > p.fim,
    geradoEm: iso(agora),
    base: db.contatos.length,
    naoContatados: db.contatos.length - trab.length,
    ...numeros(trab),
    visualizaram: null,
    porRegiao: agrupa((c) => c.regiaoId, (k) => { const r = regiao.get(k); return r ? `${r.nome} (${r.uf})` : '—'; }),
    porAbordagem: agrupa((c) => c.abordagem, (k) => ABORDAGENS[k] || k),
    porSegmento: agrupa((c) => (c.segmento || '').split(' | ')[0] || null).filter((s) => s.nome !== '—').slice(0, 8),
    porVendedor: agrupa((c) => primeiro(c)?.por || c.por || null),
    enviosPorDia: [...envios].sort(([a], [b]) => a.localeCompare(b)).map(([d, n]) => ({ dia: d, n })),
    listaFechados: trab.filter((c) => c.etapa === 'cliente').map(resumo),
    listaPossiveis: trab.filter((c) => EM_CONVERSA.includes(c.etapa)).map(resumo).sort((a, b) => String(b.desde).localeCompare(String(a.desde))),
  };
}

const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dataBr = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');
const pctTxt = (v) => (v == null ? '—' : `${String(v).replace('.', ',')}%`);

/** O balanço como documento A4 (vai pro PDF pelo Chrome, igual ao orçamento). */
export function balancoHtml(b, { loja = 'Nossa empresa' } = {}) {
  const p = b.plano;
  const kpi = (rot, v, sub = '') => `<div class="k"><b>${escH(rot)}</b><span>${escH(v)}</span>${sub ? `<small>${escH(sub)}</small>` : ''}</div>`;
  const funil = [['Contatados', b.contatados], ['Responderam', b.responderam], ['Demonstração', b.demonstracoes], ['Fecharam', b.fechados]];
  const fMax = Math.max(1, b.contatados);
  const tabela = (tit, linhas) => (linhas.length ? `<h2>${escH(tit)}</h2><table><thead><tr><th></th><th class="n">Contatados</th><th class="n">Responderam</th><th class="n">Taxa de resposta</th><th class="n">Em conversa</th><th class="n">Fecharam</th></tr></thead><tbody>${
    linhas.map((l) => `<tr><td>${escH(l.nome)}</td><td class="n">${l.contatados}</td><td class="n">${l.responderam}</td><td class="n">${pctTxt(l.taxaResposta)}</td><td class="n">${l.emConversa}</td><td class="n"><b>${l.fechados}</b></td></tr>`).join('')}</tbody></table>` : '');
  const nomes = (tit, l, vazio) => `<h2>${escH(tit)} <small>${l.length}</small></h2>${l.length ? `<table><thead><tr><th>Empresa</th><th>Região</th><th>Situação</th><th>Desde</th><th>Quem abordou</th></tr></thead><tbody>${
    l.map((c) => `<tr><td>${escH(c.nome)}<small>${escH([c.cidade, c.segmento].filter(Boolean).join(' · '))}</small></td><td>${escH(c.regiao)}</td><td>${escH(c.etapa)}</td><td>${dataBr(c.desde)}</td><td>${escH(c.por || '—')}</td></tr>`).join('')}</tbody></table>` : `<p class="vazio">${escH(vazio)}</p>`}`;
  const eMax = Math.max(1, ...b.enviosPorDia.map((e) => e.n));
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Balanço da prospecção — ${escH(p?.nome || loja)}</title>
<style>
@page{size:A4;margin:14mm 12mm}
*{box-sizing:border-box}body{margin:0;color:#16161c;font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
.top{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #15803d;padding-bottom:12px;margin-bottom:16px}
.top h1{margin:0;font-size:20px}.top small{display:block;color:#5b616e}
.selo{display:inline-block;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:600;background:#fef3c7;color:#92400e}.selo.final{background:#dcfce7;color:#166534}
.prop{background:#f8f9fb;border-radius:10px;padding:10px 14px;margin-bottom:14px}.prop b{display:block;font-size:11px;color:#5b616e;text-transform:uppercase;letter-spacing:.05em}
.ks{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
.k{border:1px solid #e3e5ea;border-radius:10px;padding:10px 12px}.k b{display:block;font-size:11px;color:#5b616e;text-transform:uppercase;letter-spacing:.04em;font-weight:600}
.k span{display:block;font-size:22px;font-weight:700;font-variant-numeric:tabular-nums}.k small{color:#5b616e;font-size:11.5px}
h2{font-size:14px;margin:20px 0 6px;break-after:avoid}h2 small{color:#8a8f99;font-weight:500}
.fu{display:grid;grid-template-columns:120px 1fr 60px;gap:6px 10px;align-items:center}.fu i{display:block;height:14px;border-radius:4px;background:#15803d}.fu span{text-align:right;font-variant-numeric:tabular-nums}
.env{display:flex;align-items:flex-end;gap:3px;height:70px;border-bottom:1px solid #e3e5ea}.env i{flex:1;background:#15803d;border-radius:3px 3px 0 0;min-height:2px}
.envd{display:flex;justify-content:space-between;color:#8a8f99;font-size:11px}
table{width:100%;border-collapse:collapse}th,td{padding:6px 6px;border-bottom:1px solid #eceef2;text-align:left;vertical-align:top}tr{break-inside:avoid}
th{font-size:11px;color:#5b616e;text-transform:uppercase;letter-spacing:.04em}td small{display:block;color:#8a8f99;font-size:11px}.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.vazio{color:#8a8f99}.nota{margin-top:22px;padding:10px 14px;border-radius:10px;background:#f8f9fb;color:#5b616e;font-size:11.5px}
</style></head><body>
<div class="top"><div><h1>Balanço da prospecção</h1><small>${escH(loja)}${p ? ` · ${escH(p.nome)}` : ''}</small></div>
  <div style="text-align:right"><span class="selo${b.final ? ' final' : ''}">${b.final ? 'Resultado final' : `Parcial — dia ${p?.diaAtual ?? '—'} de ${p?.duracaoDias ?? '—'}`}</span>
  <small>${p ? `${dataBr(p.inicio)} → ${dataBr(p.fim)}` : ''}</small><small>gerado em ${dataBr(b.geradoEm)}</small></div></div>
${p ? `<div class="prop"><b>Propósito</b>${escH(p.proposito)}${p.aprovacao ? `<br><small>Aprovado por ${escH(p.aprovacao.por)} em ${dataBr(p.aprovacao.em)}</small>` : ''}</div>` : ''}
<div class="ks">
  ${kpi('Contatados', String(b.contatados), `de ${b.base} empresas na base`)}
  ${kpi('Responderam', String(b.responderam), `taxa de resposta ${pctTxt(b.taxaResposta)}`)}
  ${kpi('Podem fechar', String(b.emConversa), 'responderam e estão em conversa')}
  ${kpi('Fecharam', String(b.fechados), p ? `meta: ${p.meta} · ${pctTxt(b.taxaFechamento)} dos contatados` : pctTxt(b.taxaFechamento))}
</div>
<h2>Funil</h2><div class="fu">${funil.map(([r, n]) => `<div>${escH(r)}</div><i style="width:${Math.max(1, (n / fMax) * 100).toFixed(1)}%"></i><span>${n}</span>`).join('')}</div>
<div class="ks" style="margin-top:14px">
  ${kpi('Aguardando retorno', String(b.aguardando), 'ainda na cadência')}
  ${kpi('Sem resposta', String(b.semResposta), 'cadência encerrada')}
  ${kpi('Sem interesse', String(b.semInteresse))}
  ${kpi('Pediram pra sair', String(b.pediramSair), 'dados apagados (LGPD)')}
</div>
${b.enviosPorDia.length > 1 ? `<h2>Mensagens e ligações por dia</h2><div class="env">${b.enviosPorDia.map((e) => `<i style="height:${((e.n / eMax) * 100).toFixed(0)}%" title="${dataBr(e.dia)}: ${e.n}"></i>`).join('')}</div>
  <div class="envd"><span>${dataBr(b.enviosPorDia[0].dia)}</span><span>pico: ${eMax} no dia</span><span>${dataBr(b.enviosPorDia.at(-1).dia)}</span></div>` : ''}
${tabela('Por região', b.porRegiao)}
${tabela('Por abordagem', b.porAbordagem)}
${tabela('Por segmento', b.porSegmento)}
${tabela('Por vendedor', b.porVendedor)}
${nomes('Fecharam', b.listaFechados, 'Nenhum fechamento no período.')}
${nomes('Podem fechar', b.listaPossiveis, 'Ninguém em conversa agora.')}
<p class="nota">Base: dados públicos de empresas da Receita Federal (CNPJ). O WhatsApp não informa leitura de mensagens enviadas pelo link (wa.me), por isso o balanço não mostra "visualizaram" — só o que o vendedor registrou: envio, resposta e resultado. Quem pediu pra sair teve o contato apagado e o número bloqueado.</p>
</body></html>`;
}

/* Inteligência (16/10): retorno por estado e ramo, onde o ramo rende mais e a
   cota do mês (100 grátis, R$ 29,90 a cada 100). Regras em ./inteligencia.mjs. */
export function inteligencia({ ramo = '', mes, isenta = false } = {}) {
  const db = ler();
  return {
    porEstado: intel.porEstado(db), porRamo: intel.porRamo(db), ramos: intel.ramos(db),
    sugestao: ramo ? intel.sugerirRegiao(db, ramo) : null,
    cota: intel.cotaDoMes(db, { mes, isenta }), minAmostra: intel.MIN_AMOSTRA,
  };
}
