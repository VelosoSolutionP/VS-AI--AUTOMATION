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
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { dentroDaCasa } from '../casa.mjs';

const arq = () => (process.env.VSPROSPECCAO_DIR ? join(process.env.VSPROSPECCAO_DIR, 'prospeccao.json') : dentroDaCasa('vsprospeccao', 'prospeccao.json'));
const ler = () => { try { return { bloqueados: [], ...JSON.parse(readFileSync(arq(), 'utf8')) }; } catch { return { plano: null, regioes: [], contatos: [], bloqueados: [] }; } };
/* Guarda só o hash do número de quem pediu pra sair: dá pra barrar sem manter o dado. */
const hashTel = (t) => createHash('sha256').update(String(t || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')).digest('hex');
const gravar = (d) => { mkdirSync(dirname(arq()), { recursive: true, mode: 0o700 }); writeFileSync(arq(), JSON.stringify(d, null, 2), { mode: 0o600 }); };
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

/**
 * Texto do WhatsApp — a ÚLTIMA tentativa (dia 5), com as palavras do dono. O 1º
 * contato é o e-mail (emailApresentacao); o WhatsApp só entra depois dele.
 */
export function mensagem(c, toque = 2, { loja = 'Veloso Solution', vendedor = 'Fabiano', agora = new Date() } = {}) {
  const emp = nomeDe(c) ? ` para a ${nomeDe(c)}` : '';
  return `${saudacao(agora)}! Aqui é o ${vendedor || 'Fabiano'}, da ${loja}. Te enviei um e-mail apresentando o Bolso Cheio e uma proposta de parceria${emp}. `
    + 'Você recebeu? Se tiver interesse, é só me responder por aqui pra darmos continuidade. '
    + 'Se não, encerro aqui no sistema e agradeço pelo seu tempo. Fico no aguardo!';
}

/**
 * O e-mail do dia 0, a partir do modelo aprovado pelo dono
 * (docs/prospeccao/email-1a-mensagem.txt): troca {EMPRESA} e {Bom dia | Boa tarde}
 * e separa o assunto. A linha da fonte (Receita) e o SAIR vêm do próprio modelo.
 */
export function emailApresentacao(c, modelo, { agora = new Date() } = {}) {
  const emp = nomeDe(c) || 'sua empresa';
  const t = String(modelo || '').replace(/\{EMPRESA\}/g, emp).replace(/\{Bom dia \| Boa tarde\}/g, saudacao(agora));
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
 * Quem recebe o e-mail do dia 0: na lista, com e-mail, sem pedido de saída. Um
 * pouco de cada região por vez (rodízio), pra comparar os estados desde o 1º lote.
 * E-mail que se repete em várias empresas (contador, genérico) fica por último.
 */
export function loteEmail({ limite = 50 } = {}) {
  const db = ler();
  const contagem = new Map();
  for (const c of db.contatos) { if (c.email) { contagem.set(c.email, (contagem.get(c.email) || 0) + 1); } }
  const fila = new Map(db.regioes.map((r) => [r.id, []]));
  for (const c of db.contatos) {
    if (c.etapa !== 'na-lista' || !c.email || c.optout || !fila.has(c.regiaoId)) { continue; }
    fila.get(c.regiaoId).push(c);
  }
  for (const l of fila.values()) { l.sort((a, b) => (contagem.get(a.email) - contagem.get(b.email)) || String(a.criadoEm).localeCompare(String(b.criadoEm))); }
  const out = []; const jaEmail = new Set();
  const listas = [...fila.values()];
  while (out.length < limite && listas.some((l) => l.length)) {
    for (const l of listas) {
      while (l.length && jaEmail.has(l[0].email)) { l.shift(); }
      if (l.length && out.length < limite) { const c = l.shift(); jaEmail.add(c.email); out.push(c); }
    }
  }
  return out;
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

/** Quantos e-mails do dia 0 saíram hoje (limite diário do provedor). */
export function emailsHoje(agora = new Date()) {
  const hoje = iso(agora).slice(0, 10);
  return ler().contatos.filter((c) => (c.historico || []).some((h) => h.canal === 'email' && String(h.em).slice(0, 10) === hoje)).length;
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
    for (const t of [c.whatsapp, c.telefone].filter(Boolean)) { const h = hashTel(t); if (!db.bloqueados.includes(h)) { db.bloqueados.push(h); } }
    Object.assign(c, { etapa: 'nao-quer', optout: true, whatsapp: null, telefone: null, email: null, responsavel: null });
    c.historico.push({ em: iso(agora), evento: 'pediu pra não receber mais mensagens — contato apagado', por });
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
export function painel({ agora = new Date(), regiaoId = null, busca = '', etapa = '', limite = 10, pagina = 1, loja, vendedor } = {}) {
  const db = ler();
  const regioes = db.regioes.map((r) => ({ ...r, ...situacaoRegiao(r, db.contatos, agora) }))
    .sort((a, b) => a.uf.localeCompare(b.uf) || a.nome.localeCompare(b.nome));
  const ufDe = new Map(db.regioes.map((r) => [r.id, r.uf]));
  const porEmail = new Map();
  for (const c of db.contatos) { if (c.email) { porEmail.set(c.email, (porEmail.get(c.email) || 0) + 1); } }
  const emailsRepetidos = new Set([...porEmail].filter(([, n]) => n > 1).map(([e]) => e));
  const todos = db.contatos.map((c) => ({ ...comProximo(c, agora), wa: linkWhatsapp(c, { loja, vendedor }), alertas: alertasDe(c, ufDe.get(c.regiaoId), emailsRepetidos) }));
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
