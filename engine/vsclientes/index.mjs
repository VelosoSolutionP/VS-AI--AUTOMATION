/**
 * VSclientes — a carteira de clientes da Veloso Solution.
 *
 * Um caminho só, do cadastro à chave:
 *
 *   cadastrar → gerar contrato (PDF) → cliente assina no gov.br e devolve
 *   → cobrar (Pix ou cartão, link no WhatsApp) → pagamento confirmado pelo
 *   webhook → chave de ativação gerada e enviada ao WhatsApp cadastrado
 *
 * Quem fala com o mundo (Chrome pra imprimir PDF, gateway de pagamento,
 * WhatsApp, assinatura da licença) entra INJETADO. É o que deixa o teste
 * percorrer o caminho inteiro sem cobrar ninguém de verdade.
 *
 * Dado de cliente mora na casa (`<casa>/vsclientes`), fora do repositório.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { dentroDaCasa } from '../casa.mjs';
import {
  OFERTAS, CICLOS, validarCliente, precoDe, liberacoesPadrao, formatarCodigo, normalizarCodigo,
  somarMeses, examinarPdfAssinado, brl, formatarWhatsapp, oferta, documento as conferirDocumento,
  creditoRestante, avaliarTroca, valorAdendoProporcional, mensalNoCiclo,
} from './ofertas.mjs';
import { montarContrato, CONTRATADA_PADRAO } from './contrato.mjs';
import { usarCatalogo, todasOfertas } from './ofertas.mjs';
import { listar as planosDoCatalogo, CICLOS as CICLOS_CATALOGO, adicionais as adicionaisDoCatalogo } from '../vsplanos/index.mjs';

export { OFERTAS, CICLOS, liberacoesPadrao, precoDe, normalizarCodigo, todasOfertas };

const NOME_MODULO = { redes: 'Redes sociais', whatsapp: 'WhatsApp', telegram: 'Telegram', combo: 'Combo WhatsApp + Redes' };
/**
 * Plano do catálogo (Bronze/Prata/Gold) no formato de oferta da carteira. O
 * desconto do semestral vem do PRÓPRIO catálogo — se lá mudar, muda aqui.
 */
export function ofertaDoPlano(p) {
  const desc = CICLOS_CATALOGO.semestral?.desconto ?? 0;
  const gb = p.storage_limit_mb == null ? null : Math.round((p.storage_limit_mb / 1024) * 10) / 10;
  return {
    code: p.code,
    nome: `${NOME_MODULO[p.module] || p.module} ${p.nome}`,
    tier: p.nome,
    modulo: p.module,
    descricao: NOME_MODULO[p.module] || p.module,
    catalogo: true,
    ativo: p.active !== false,
    substitui: p.substitui || null,
    destaque: p.destaque === true,
    mensal: p.monthly_price,
    semestralMensal: Math.round(p.monthly_price * (1 - desc)),
    anualMensal: null,
    produtosLimite: p.products_limit,
    liberacoes: {
      operadores: p.attendants ?? 0,
      campanhasMes: p.campaigns_limit,
      auditor: p.auditor_enabled === true,
      botFunil: p.module !== 'redes' && p.ai_enabled !== false,
      bandaGbMes: gb,
      redes: p.social_accounts ? ['tiktok', 'instagram'] : [],
      contasRedes: p.social_accounts ?? 0,
    },
  };
}
/* Com os INATIVOS: cliente num plano que virou versão antiga continua achando o
   nome e o preço dele. A tela de venda filtra por `ativo`. */
usarCatalogo(() => { try { return planosDoCatalogo({ incluirInativos: true }).map(ofertaDoPlano); } catch { return []; } });

const dir = () => process.env.VSCLIENTES_DIR || dentroDaCasa('vsclientes');
const arq = (n) => join(dir(), n);
const ler = (n, p) => { try { return JSON.parse(readFileSync(arq(n), 'utf8')); } catch { return p; } };
const gravar = (n, d) => {
  mkdirSync(dir(), { recursive: true, mode: 0o700 });
  writeFileSync(arq(n), JSON.stringify(d, null, 2), { mode: 0o600 });
  return d;
};
const gravarArquivo = (sub, nome, buf) => {
  mkdirSync(join(dir(), sub), { recursive: true, mode: 0o700 });
  writeFileSync(join(dir(), sub, nome), buf, { mode: 0o600 });
  return join(sub, nome);
};
const agora = () => new Date().toISOString();
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

const lista = () => ler('clientes.json', []);
const salvarLista = (l) => gravar('clientes.json', l);

export const contratada = () => ({ ...CONTRATADA_PADRAO, ...ler('contratada.json', {}) });
export function salvarContratada(d = {}) {
  const campos = ['nomeFantasia', 'razaoSocial', 'cnpj', 'endereco', 'email', 'foro'];
  const atual = contratada();
  for (const c of campos) { if (d[c] != null && String(d[c]).trim()) { atual[c] = String(d[c]).trim(); } }
  atual.cnpj = String(atual.cnpj).replace(/\D/g, '');
  return { ok: true, contratada: gravar('contratada.json', atual) };
}

/* ---------------- modo teste de cobrança ---------------- */

/**
 * Pra testar pagamento DE VERDADE sem pagar o plano: enquanto ligado, toda
 * cobrança sai por R$ 0,50. Três travas, porque esquecer isto ligado é vender
 * o ano por cinquenta centavos:
 *  - desliga sozinho (2 h por padrão);
 *  - a chave emitida por pagamento de teste vale 1 dia, não o ciclo;
 *  - a cobrança fica marcada `teste`, e a tela mostra isso em vermelho.
 */
export const VALOR_TESTE = 50;
export function modoTeste(em = agora()) {
  const t = ler('modo-teste.json', null);
  const ativo = !!t?.ate && t.ate > em;
  return { ativo, ate: ativo ? t.ate : null, valorCentavos: VALOR_TESTE };
}
export function ligarModoTeste({ minutos = 120 } = {}) {
  const m = Math.min(Math.max(Number(minutos) || 120, 5), 24 * 60);
  gravar('modo-teste.json', { ate: new Date(Date.now() + m * 60000).toISOString(), ligadoEm: agora() });
  return { ok: true, ...modoTeste() };
}
export function desligarModoTeste() { gravar('modo-teste.json', { ate: null, desligadoEm: agora() }); return { ok: true, ...modoTeste() }; }
/** Quanto cobrar AGORA por este contrato — e se é de teste. */
const valorDaCobranca = (k, pedido = null) => {
  const t = modoTeste();
  if (t.ativo) { return { valor: VALOR_TESTE, teste: true }; }
  return { valor: pedido?.valorCentavos ?? k.valorCiclo, teste: false };
};

/* ---------------- situação ---------------- */

/** A licença que vale AGORA (a de validade mais longa, não revogada). */
function licencaVigente(c, em = agora()) {
  return (c.licencas || [])
    .filter((l) => !l.revogadaEm && l.validaAte > em)
    .sort((a, b) => b.validaAte.localeCompare(a.validaAte))[0] || null;
}

/**
 * Em que pé está o cliente, em uma palavra e na próxima ação. A tela mostra isto
 * em vez de cinco checkboxes que a pessoa teria de interpretar.
 */
export function situacao(c, em = agora()) {
  const lic = licencaVigente(c, em);
  const contrato = (c.contratos || []).at(-1) || null;
  const pendente = (c.cobrancas || []).find((x) => x.estado === 'AGUARDANDO');
  if (lic) {
    const dias = Math.ceil((new Date(lic.validaAte) - new Date(em)) / 86400000);
    return { codigo: dias <= 5 ? 'vencendo' : 'ativo', texto: dias <= 5 ? `vence em ${dias} dia(s)` : 'ativo', diasRestantes: dias, proximo: dias <= 5 ? 'gerar a cobrança de renovação' : null };
  }
  if ((c.licencas || []).length) { return { codigo: 'vencido', texto: 'vencido', proximo: 'gerar a cobrança de renovação' }; }
  if (pendente) { return { codigo: 'aguardando_pagamento', texto: 'aguardando pagamento', proximo: 'esperar o pagamento — a chave sai sozinha' }; }
  if (contrato?.assinadoEm) { return { codigo: 'assinado', texto: 'contrato assinado', proximo: 'gerar a cobrança' }; }
  if (contrato) { return { codigo: 'contrato_gerado', texto: 'contrato aguardando assinatura', proximo: 'mandar o contrato e receber de volta assinado no gov.br' }; }
  return { codigo: 'cadastrado', texto: 'cadastrado', proximo: 'gerar o contrato' };
}

const comSituacao = (c) => ({ ...c, situacao: situacao(c), licencaVigente: mascararLic(licencaVigente(c)) });
const mascararLic = (l) => (l ? { codigo: l.codigo, validaAte: l.validaAte, emitidaEm: l.emitidaEm, entregue: l.entregue } : null);

export const listar = () => lista().map(comSituacao);
export const obter = (id) => lista().find((c) => c.id === String(id)) || null;

export function painel() {
  const todos = listar();
  const teste = modoTeste();
  const conta = (cod) => todos.filter((c) => c.situacao.codigo === cod).length;
  const receitaMensal = todos.filter((c) => ['ativo', 'vencendo'].includes(c.situacao.codigo))
    .reduce((s, c) => { const p = precoDe(c); return s + (p.ok ? p.mensal : 0); }, 0);
  return {
    ofertas: todasOfertas(),
    ciclos: CICLOS,
    contratada: contratada(),
    modoTeste: teste,
    clientes: todos,
    resumo: { total: todos.length, ativos: conta('ativo') + conta('vencendo'), aguardando: conta('aguardando_pagamento'), vencidos: conta('vencido'), receitaMensal },
  };
}

/* ---------------- cadastro ---------------- */

export function salvar(entrada = {}) {
  const v = validarCliente(entrada);
  if (v.erros.length) { return { ok: false, erros: v.erros }; }
  const todos = lista();
  /* Mesmo documento = mesmo cliente. Dois cadastros da mesma pessoa viram duas
     chaves, dois contratos e uma confusão na hora de renovar. */
  const dup = todos.find((c) => c.documento === v.cliente.documento && c.id !== entrada.id);
  if (dup) { return { ok: false, erros: [`já existe cliente com este documento: ${dup.nome}`] }; }

  if (entrada.id) {
    const i = todos.findIndex((c) => c.id === String(entrada.id));
    if (i < 0) { return { ok: false, erros: ['cliente não encontrado'] }; }
    const antes = todos[i];
    todos[i] = { ...antes, ...v.cliente, atualizadoEm: agora() };
    /* Mudou o que o contrato promete? Então o contrato em vigor deixou de
       descrever a relação: marca pra gerar outro. Não apaga o antigo. */
    const pesa = (c) => JSON.stringify([c.produtos, c.ciclo, c.valorCombinadoMensal, c.liberacoes, c.nome, c.documento]);
    if (pesa(antes) !== pesa(todos[i]) && (antes.contratos || []).length) { todos[i].contratoDesatualizado = true; }
    salvarLista(todos);
    return { ok: true, cliente: comSituacao(todos[i]) };
  }
  const c = {
    id: 'cli_' + randomBytes(5).toString('hex'),
    ...v.cliente,
    contratos: [], cobrancas: [], licencas: [], historico: [{ em: agora(), o: 'cadastrado' }],
    criadoEm: agora(), atualizadoEm: agora(),
  };
  salvarLista([...todos, c]);
  return { ok: true, cliente: comSituacao(c) };
}

function atualizar(id, fn) {
  const todos = lista();
  const i = todos.findIndex((c) => c.id === String(id));
  if (i < 0) { return null; }
  todos[i] = fn(todos[i]);
  todos[i].atualizadoEm = agora();
  salvarLista(todos);
  return todos[i];
}

const registrar = (c, o, extra = {}) => ({ ...c, historico: [...(c.historico || []), { em: agora(), o, ...extra }] });

/* ---------------- contrato ---------------- */

/**
 * Gera o PDF do contrato. `imprimir(html) → Buffer` é injetado (Chrome em
 * produção). Cada geração é uma versão nova; nenhuma é sobrescrita.
 */
export async function gerarContrato(id, { imprimir, comoFicara } = {}) {
  /* `comoFicara`: o cadastro como fica DEPOIS de uma troca de plano. O contrato
     nasce com o plano novo, mas o cadastro só muda quando o pagamento entrar —
     troca não paga não pode mexer no que o cliente tem. */
  const c = comoFicara ? { ...obter(id), ...comoFicara } : obter(id);
  if (!c) { return { ok: false, motivo: 'cliente não encontrado' }; }
  if (typeof imprimir !== 'function') { return { ok: false, motivo: 'impressora de PDF não configurada' }; }
  const preco = precoDe(c);
  if (!preco.ok) { return { ok: false, motivo: preco.motivo }; }
  const versao = (c.contratos || []).length + 1;
  const numero = `BC-${new Date().getFullYear()}-${c.id.slice(4, 10).toUpperCase()}-${versao}`;
  const html = montarContrato({ cliente: c, contratada: contratada(), preco, numero });
  let pdf;
  try { pdf = await imprimir(html); } catch (e) { return { ok: false, motivo: 'não consegui gerar o PDF: ' + e.message }; }
  if (!Buffer.isBuffer(pdf) || pdf.subarray(0, 5).toString('latin1') !== '%PDF-') { return { ok: false, motivo: 'a impressão não devolveu um PDF' }; }
  const caminho = gravarArquivo('contratos', `${c.id}-v${versao}.pdf`, pdf);
  const contrato = {
    versao, numero, caminho, sha256: sha(pdf), bytes: pdf.length, geradoEm: agora(),
    valorCiclo: preco.total, ciclo: preco.ciclo, liberacoes: c.liberacoes, produtos: c.produtos, adendos: c.adendos || [],
    assinadoEm: null,
  };
  const novo = atualizar(c.id, (x) => registrar({ ...x, contratos: [...(x.contratos || []), contrato], contratoDesatualizado: comoFicara ? x.contratoDesatualizado : false }, 'contrato gerado', { numero }));
  return { ok: true, contrato, cliente: comSituacao(novo) };
}

export function arquivoContrato(id, versao, { assinado = false } = {}) {
  const c = obter(id);
  const k = (c?.contratos || []).find((x) => x.versao === Number(versao)) || (c?.contratos || []).at(-1);
  if (!k) { return null; }
  const rel = assinado ? k.assinado?.caminho : k.caminho;
  if (!rel || !existsSync(join(dir(), rel))) { return null; }
  return { buf: readFileSync(join(dir(), rel)), nome: `contrato-${k.numero}${assinado ? '-assinado' : ''}.pdf` };
}

/**
 * Recebe o PDF que o cliente devolveu do gov.br. Recusa o que não é o NOSSO
 * contrato assinado: sem assinatura, ou de outro documento. Assinatura que não
 * é do gov.br passa com aviso — pode ser certificado ICP-Brasil, que também vale.
 */
export function receberAssinado(id, pdfBuf, { versao } = {}) {
  const c = obter(id);
  if (!c) { return { ok: false, motivo: 'cliente não encontrado' }; }
  const k = (c.contratos || []).find((x) => x.versao === Number(versao)) || (c.contratos || []).at(-1);
  if (!k) { return { ok: false, motivo: 'este cliente ainda não tem contrato gerado' }; }
  const original = readFileSync(join(dir(), k.caminho));
  const ex = examinarPdfAssinado(pdfBuf, original);
  if (!ex.ok) { return { ok: false, motivo: ex.motivo }; }
  if (!ex.assinaturas) { return { ok: false, motivo: 'o PDF não tem assinatura digital — assine em assinador.iti.br e envie o arquivo que ele devolve' }; }
  if (!ex.mesmoDocumento) {
    return { ok: false, motivo: `este PDF assinado não é o contrato ${k.numero}: o conteúdo não bate com o que foi gerado. Confira se o cliente assinou o arquivo certo.` };
  }
  const caminho = gravarArquivo('assinados', `${c.id}-v${k.versao}.pdf`, Buffer.from(pdfBuf));
  const avisos = [];
  if (!ex.govbr) { avisos.push('a assinatura não parece ser do gov.br (pode ser certificado ICP-Brasil). Confira em validar.iti.gov.br.'); }
  if (ex.assinaturas < 2) { avisos.push('só há 1 assinatura: falta a outra parte assinar (contratada ou contratante).'); }
  const assinado = { caminho, sha256: sha(Buffer.from(pdfBuf)), assinaturas: ex.assinaturas, govbr: ex.govbr, signatarios: ex.signatarios, recebidoEm: agora() };
  const novo = atualizar(c.id, (x) => registrar({
    ...x,
    contratos: x.contratos.map((y) => (y.versao === k.versao ? { ...y, assinado, assinadoEm: agora() } : y)),
  }, 'contrato assinado recebido', { numero: k.numero, assinaturas: ex.assinaturas, govbr: ex.govbr }));
  return { ok: true, avisos, assinado, cliente: comSituacao(novo) };
}

/**
 * Manda o PDF do contrato no WhatsApp da cliente e REGISTRA o resultado. Antes
 * o envio saía sem deixar rastro: quando não chegava, não havia como saber se
 * falhou, por quê, ou se nem tinha sido tentado.
 */
export async function enviarContrato(id, { enviarArquivo, versao } = {}) {
  const c = obter(id);
  if (!c) { return { ok: false, motivo: 'cliente não encontrado' }; }
  const a = arquivoContrato(id, versao);
  if (!a) { return { ok: false, motivo: 'este cliente ainda não tem contrato gerado' }; }
  const k = (c.contratos || []).find((x) => x.versao === Number(versao)) || c.contratos.at(-1);
  let envio;
  try {
    envio = await enviarArquivo({
      para: c.whatsapp, buf: a.buf, nome: a.nome,
      legenda: `Contrato ${k.numero} do Bolso Cheio. Assine em assinador.iti.br com a sua conta gov.br e me devolva aqui o PDF assinado.`,
    });
  } catch (e) { envio = { ok: false, erro: e.message }; }
  const novo = atualizar(id, (x) => registrar(x, envio.ok ? 'contrato enviado no WhatsApp' : 'contrato NÃO enviado', envio.ok ? { numero: k.numero } : { numero: k.numero, erro: envio.erro }));
  return { ok: !!envio.ok, envio, motivo: envio.ok ? null : envio.erro, cliente: comSituacao(novo) };
}

/* ---------------- cobrança ---------------- */

/**
 * Gera a cobrança do próximo ciclo e (se pedido) manda o link pro WhatsApp.
 *
 * `cobrar(e)` é o `vspagamentos.cobrar` — injetado. O link do checkout aceita
 * Pix e cartão; quando o gateway também devolve Pix direto, o copia-e-cola vai
 * junto, que é o jeito mais rápido de pagar pelo celular.
 */
export async function cobrar(id, { cobrar: cobrarNoGateway, enviar, webhookUrl, exigirAssinatura = false } = {}) {
  const c = obter(id);
  if (!c) { return { ok: false, motivo: 'cliente não encontrado' }; }
  const k = (c.contratos || []).at(-1);
  if (!k) { return { ok: false, motivo: 'gere o contrato antes: é ele que diz o valor da cobrança' }; }
  if (c.contratoDesatualizado) { return { ok: false, motivo: 'o cadastro mudou depois do último contrato — gere o contrato novo antes de cobrar' }; }
  if (exigirAssinatura && !k.assinadoEm) { return { ok: false, motivo: 'o contrato ainda não voltou assinado' }; }
  const aberta = (c.cobrancas || []).find((x) => x.estado === 'AGUARDANDO');
  if (aberta) { return { ok: false, motivo: 'já existe cobrança aguardando pagamento — reenvie o link dela em vez de gerar outra', cobranca: aberta }; }

  const n = (c.cobrancas || []).length + 1;
  const referencia = `bc-${c.id}-${n}`;
  const vc = valorDaCobranca(k);
  const r = await cobrarNoGateway({
    metodo: 'CREDIT_CARD', // checkout do Mercado Pago: abre com Pix E cartão
    excluirTipos: ['ticket', 'atm'], // boleto e lotérica ficam fora: o contrato diz Pix ou cartão
    valorCentavos: vc.valor,
    descricao: `Bolso Cheio — ${c.produtos.map((p) => oferta(p)?.nome || p).join(' + ')} (${CICLOS[k.ciclo].nome.toLowerCase()})`,
    referencia,
    nome: c.nome,
    email: c.email || undefined,
    webhookUrl,
    idempotencyKey: referencia,
  });
  if (!r.ok) { return { ok: false, motivo: r.motivo || r.erro || 'o gateway recusou a cobrança' }; }
  const cob = {
    n, referencia, pagamentoId: r.pagamento.id, valorCentavos: vc.valor, teste: vc.teste, ciclo: k.ciclo,
    contrato: k.numero, link: r.pagamento.linkPagamento, pix: r.pagamento.pix?.payload || null,
    estado: 'AGUARDANDO', criadaEm: agora(),
  };
  let novo = atualizar(c.id, (x) => registrar({ ...x, cobrancas: [...(x.cobrancas || []), cob] }, 'cobrança gerada', { referencia, valor: k.valorCiclo }));
  let envio = null;
  if (enviar) {
    envio = await enviar({ para: c.whatsapp, texto: mensagemCobranca(c, cob) });
    novo = atualizar(c.id, (x) => registrar(x, envio.ok ? 'link de pagamento enviado' : 'link de pagamento NÃO enviado', envio.ok ? {} : { erro: envio.erro }));
  }
  return { ok: true, cobranca: cob, envio, avisos: r.avisos || [], cliente: comSituacao(novo) };
}

/* ---------------- checkout (quem assina pelo console) ---------------- */

/**
 * Primeiro passo do checkout: cadastra (ou reconhece pelo documento) quem está
 * comprando, garante o contrato em dia com o que foi escolhido e registra o
 * aceite. Só depois disso existe valor pra cobrar — o mesmo valor do contrato.
 */
/** Pagamento que valeu a licença em vigor — base do crédito numa troca. */
function pagoPelaLicenca(c, lic) {
  const cob = (c.cobrancas || []).find((x) => x.referencia && x.referencia === lic.referencia);
  /* Chave de troca vale o ciclo novo INTEIRO: parte veio em dinheiro, parte em crédito. */
  if (cob?.pedido?.tipo === 'troca') { return (cob.valorCentavos || 0) + (cob.pedido.creditoCentavos || 0); }
  if (cob?.valorCentavos && !cob.teste) { return cob.valorCentavos; }
  /* Sem cobrança (liberação manual): vale o contrato DA chave — nunca o último
     gerado, que pode ser o de uma troca ainda não paga e inflaria o crédito. */
  const k = (c.contratos || []).find((x) => x.numero === (lic.contrato || cob?.contrato))
    || [...(c.contratos || [])].filter((x) => x.geradoEm <= lic.emitidaEm).at(-1);
  return k?.valorCiclo || 0;
}

/** Adendos que o cliente pode contratar sozinho (o sob consulta vai pro WhatsApp). */
export function adendosDisponiveis() {
  let lista = [];
  try { lista = adicionaisDoCatalogo() || []; } catch { lista = []; }
  return lista.filter((a) => a.active !== false).map((a) => ({
    code: a.code, nome: a.name, mensalCentavos: a.monthly_price ?? null, sobConsulta: a.sob_consulta === true || a.monthly_price == null,
  }));
}

/**
 * Quem já tem assinatura em vigor não "assina de novo": troca de plano ou
 * contrata adendo. Esta é a foto que a tela mostra pra ele escolher.
 */
export function situacaoDoAssinante(c, { produtos = [], ciclo = 'mensal' } = {}, em = agora()) {
  const lic = licencaVigente(c, em);
  if (!lic) { return null; }
  const atual = c.produtos?.[0];
  const novo = produtos[0] || null;
  const credito = creditoRestante({ pagoCentavos: pagoPelaLicenca(c, lic), emitidaEm: lic.emitidaEm, validaAte: lic.validaAte, em });
  let troca = null;
  if (novo) {
    const p = precoDe({ produtos: [novo], ciclo, adendos: c.adendos || [] });
    troca = p.ok
      ? { para: novo, nome: oferta(novo)?.nome || novo, ciclo, valorNovoCiclo: p.total,
        ...avaliarTroca({ valorNovoCiclo: p.total, valorAtualCiclo: precoDe(c).ok ? precoDe(c).total : null,
          creditoCentavos: credito, mesmoPlano: novo === atual && ciclo === c.ciclo }) }
      : { para: novo, erro: p.motivo };
  }
  return {
    atual: { code: atual, nome: oferta(atual)?.nome || atual, ciclo: c.ciclo, validaAte: lic.validaAte, codigo: lic.codigo },
    diasRestantes: Math.max(0, Math.ceil((new Date(lic.validaAte) - new Date(em)) / 86400000)),
    creditoCentavos: credito,
    troca,
    trocaAgendada: c.trocaAgendada || null,
    adendos: adendosDisponiveis().map((a) => ({
      ...a, agoraPorUnidade: a.sobConsulta ? null : valorAdendoProporcional({ mensalCentavos: a.mensalCentavos, validaAte: lic.validaAte, em }),
    })),
    adendosContratados: c.adendos || [],
  };
}

/* Mesma pessoa? Na página pública, CPF + WhatsApp precisam bater. */
function mesmaPessoa(existente, whatsapp) {
  const wa = String(whatsapp || '').replace(/\D/g, '');
  return existente.whatsapp === wa || existente.whatsapp === '55' + wa;
}

/* Senha de uso único + pedido em aberto: o que o Pix e o cartão vão cobrar. */
function abrirPedido(id, pedido, oQue) {
  const acesso = randomBytes(18).toString('base64url');
  atualizar(id, (x) => registrar({ ...x, pedido, acessoCheckout: { hash: sha(Buffer.from(acesso)), criadoEm: agora() } }, oQue, { tipo: pedido.tipo, valor: pedido.valorCentavos }));
  return acesso;
}

export async function iniciarCheckout(d = {}, { imprimir, publico = false } = {}) {
  if (d.aceite !== true) { return { ok: false, motivo: 'para assinar, é preciso aceitar o contrato' }; }
  const email = String(d.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { return { ok: false, motivo: 'informe um e-mail válido: é pra ele que o Mercado Pago manda o comprovante' }; }
  const produtos = [...new Set((d.produtos || []).filter((p) => p !== 'sob-consulta'))];
  if (!produtos.length) { return { ok: false, motivo: 'escolha ao menos um serviço' }; }
  const ciclo = d.ciclo || 'mensal';
  const doc = conferirDocumento(d.documento);
  const existente = doc.ok ? lista().find((c) => c.documento === doc.digitos) : null;
  /* Na página PÚBLICA, quem digita um documento que já existe não pode trocar o
     WhatsApp dele: seria desviar a chave (e a cobrança) de outra pessoa só
     sabendo o CPF. Mesmo número = é a mesma pessoa voltando; número diferente
     = fala com a gente. */
  if (publico && existente && !mesmaPessoa(existente, d.whatsapp)) {
    return { ok: false, motivo: 'já existe um cadastro com este CPF/CNPJ e outro WhatsApp. Para sua segurança, fale com a gente para atualizar.' };
  }
  /* Documento novo com o e-mail ou o WhatsApp de quem JÁ TEM CONTRATO: é a
     mesma pessoa assinando de novo com outro CPF/CNPJ — segundo contrato,
     segunda chave, e o acesso trava porque o e-mail já é de outro cliente. */
  if (!existente) {
    const dono = lista().find((c) => (c.contratos || []).length && (c.email === email || mesmaPessoa(c, d.whatsapp)));
    if (dono) {
      return { ok: false, jaTemContrato: true,
        motivo: 'já existe um contrato com este e-mail ou WhatsApp. Use o CPF/CNPJ desse contrato para trocar de plano ou contratar adendo — se é outro cadastro, fale com a gente.' };
    }
  }

  /* Venda nova só pelo que está À VENDA: plano versionado (antigo) ou da tabela
     legada fica só para quem já o tem. */
  const foraDeVenda = produtos.find((code) => { const o = oferta(code); return (!o || o.ativo === false || (publico && o.legado)) && !(existente?.produtos || []).includes(code); });
  if (foraDeVenda) { return { ok: false, motivo: `o plano "${oferta(foraDeVenda)?.nome || foraDeVenda}" não está mais à venda — escolha um dos planos da tabela` }; }
  /* JÁ É ASSINANTE: assinar de novo trocaria o plano dele por cima e somaria
     validade como se fosse renovação. Aqui só existe trocar de plano ou adendo. */
  const sit = existente ? situacaoDoAssinante(existente, { produtos, ciclo }) : null;
  if (sit && d.troca !== true) {
    return { ok: false, jaAssinante: true, clienteId: existente.id, assinante: sit,
      motivo: `você já assina ${sit.atual.nome} até ${new Date(sit.atual.validaAte).toLocaleDateString('pt-BR')} — troque de plano ou contrate um adendo` };
  }
  if (sit && d.troca === true) {
    const t = sit.troca;
    if (!t || t.erro) { return { ok: false, motivo: t?.erro || 'escolha o plano para trocar' }; }
    if (t.tipo === 'mesmo') { return { ok: false, motivo: 'esse já é o seu plano' }; }
    if (t.tipo === 'downgrade') {
      /* Plano menor: agenda pra renovação. Nada é cobrado nem devolvido, e o
         cliente segue com o que pagou até o fim do ciclo. */
      atualizar(existente.id, (x) => registrar({ ...x, trocaAgendada: { para: t.para, ciclo, em: agora(), valeApartir: sit.atual.validaAte } },
        'troca de plano agendada', { de: sit.atual.code, para: t.para }));
      return { ok: true, agendada: true, clienteId: existente.id, para: t.nome, valeApartir: sit.atual.validaAte };
    }
    /* Plano maior: contrato novo já com o plano novo; o cadastro só muda quando pagar. */
    const comoFicara = { produtos: [t.para], ciclo, liberacoes: liberacoesPadrao([t.para]), adendos: existente.adendos || [] };
    const g = await gerarContrato(existente.id, { imprimir, comoFicara });
    if (!g.ok) { return g; }
    const k = obter(existente.id).contratos.at(-1);
    const pedido = { tipo: 'troca', de: sit.atual.code, para: t.para, ciclo, creditoCentavos: t.creditoCentavos,
      valorCentavos: t.valorCentavos, licencaAnterior: sit.atual.codigo, contrato: k.numero,
      descricao: `Bolso Cheio — troca para ${t.nome} (crédito de ${brl(t.creditoCentavos)})` };
    const acesso = abrirPedido(existente.id, pedido, 'troca de plano iniciada');
    const vc = valorDaCobranca(k, pedido);
    return { ok: true, clienteId: existente.id, acesso, pedido,
      contrato: { numero: k.numero, versao: k.versao, valorCiclo: k.valorCiclo, ciclo: k.ciclo },
      cobrar: { valorCentavos: vc.valor, teste: vc.teste } };
  }

  /* Mesmo cliente, mesmos serviços e ciclo: mantém o que foi liberado pra ele
     (pode ter sido ajustado à mão). Mudou a escolha: vale o padrão dos serviços. */
  const mesmaEscolha = existente && existente.ciclo === ciclo
    && JSON.stringify([...existente.produtos].sort()) === JSON.stringify([...produtos].sort());
  const s = salvar({
    ...(existente || {}),
    id: existente?.id,
    nome: publico && existente ? existente.nome : d.nome,
    documento: d.documento,
    whatsapp: publico && existente ? existente.whatsapp : d.whatsapp,
    email: publico && existente?.email ? existente.email : email,
    produtos, ciclo, valorCombinadoMensal: null,
    liberacoes: mesmaEscolha ? existente.liberacoes : liberacoesPadrao(produtos),
  });
  if (!s.ok) { return { ok: false, motivo: s.erros.join('; '), erros: s.erros }; }
  let c = obter(s.cliente.id);
  if (!(c.contratos || []).length || c.contratoDesatualizado) {
    const g = await gerarContrato(c.id, { imprimir });
    if (!g.ok) { return g; }
    c = obter(c.id);
  }
  const k = c.contratos.at(-1);
  /* Senha de uso único desta tentativa: é o que a página pública apresenta pra
     gerar o Pix, pagar e ver o resultado. Sem ela, bastaria trocar o id na URL
     pra mexer no checkout de outra pessoa. */
  const pedido = { tipo: 'assinatura', valorCentavos: k.valorCiclo, contrato: k.numero };
  const acesso = abrirPedido(c.id, pedido, publico ? 'contrato aceito na página de assinatura' : 'contrato aceito no checkout');
  const vc = valorDaCobranca(k, pedido);
  return { ok: true, clienteId: c.id, acesso, pedido, contrato: { numero: k.numero, versao: k.versao, valorCiclo: k.valorCiclo, ciclo: k.ciclo }, cobrar: { valorCentavos: vc.valor, teste: vc.teste }, preco: precoDe(c) };
}

/**
 * Adendo: só pra quem já assina. Cobra agora o proporcional aos dias que faltam
 * no ciclo e, pago, amplia o que está liberado na mesma chave (mesma validade).
 */
export function iniciarAdendo(d = {}, { publico = false } = {}) {
  const doc = conferirDocumento(d.documento);
  const c = doc.ok ? lista().find((x) => x.documento === doc.digitos) : null;
  if (!c || (publico && !mesmaPessoa(c, d.whatsapp))) { return { ok: false, motivo: 'não encontrei assinatura com este CPF/CNPJ e WhatsApp' }; }
  const lic = licencaVigente(c);
  if (!lic) { return { ok: false, motivo: 'adendo é pra quem tem assinatura em vigor — assine um plano primeiro' }; }
  const a = adendosDisponiveis().find((x) => x.code === d.code);
  if (!a) { return { ok: false, motivo: 'adendo não encontrado' }; }
  if (a.sobConsulta) { return { ok: false, motivo: 'este adendo é sob consulta — fale com a gente no WhatsApp' }; }
  const qtd = Math.min(Math.max(parseInt(d.qtd, 10) || 1, 1), 20);
  const k = (c.contratos || []).at(-1);
  const valor = valorAdendoProporcional({ mensalCentavos: a.mensalCentavos * qtd, validaAte: lic.validaAte });
  const pedido = { tipo: 'adendo', code: a.code, nome: a.nome, qtd, mensalCentavos: a.mensalCentavos * qtd, valorCentavos: valor,
    licencaAnterior: lic.codigo, contrato: k?.numero, descricao: `Bolso Cheio — adendo: ${a.nome}${qtd > 1 ? ` × ${qtd}` : ''} (proporcional até ${new Date(lic.validaAte).toLocaleDateString('pt-BR')})` };
  const acesso = abrirPedido(c.id, pedido, 'adendo iniciado');
  const vc = valorDaCobranca(k, pedido);
  return { ok: true, clienteId: c.id, acesso, pedido,
    contrato: { numero: k?.numero, versao: k?.versao, valorCiclo: k?.valorCiclo, ciclo: k?.ciclo },
    cobrar: { valorCentavos: vc.valor, teste: vc.teste } };
}

/** Confere a senha de uso único do checkout público (tempo constante, vale 24 h). */
export function conferirAcessoCheckout(id, acesso) {
  const c = obter(id);
  const a = c?.acessoCheckout;
  if (!a || !acesso) { return false; }
  if (Date.now() - new Date(a.criadoEm).getTime() > 86400000) { return false; }
  const x = Buffer.from(sha(Buffer.from(String(acesso)))), y = Buffer.from(a.hash);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Cobrança aberta de tentativa anterior sai do caminho: quem voltou ao checkout está pagando de novo. */
const fecharAbertas = (id) => atualizar(id, (x) => ({
  ...x, cobrancas: (x.cobrancas || []).map((y) => (y.estado === 'AGUARDANDO' ? { ...y, estado: 'CANCELADA', canceladaEm: agora(), motivo: 'substituída por nova tentativa no checkout' } : y)),
}));

/** Pix direto: o QR nasce aqui, na tela do checkout. */
export async function pixCheckout(id, { cobrar: cobrarNoGateway, webhookUrl } = {}) {
  const c = obter(id);
  if (!c) { return { ok: false, motivo: 'cliente não encontrado' }; }
  const k = (c.contratos || []).at(-1);
  if (!k || c.contratoDesatualizado) { return { ok: false, motivo: 'o contrato não está em dia — volte e assine de novo' }; }
  fecharAbertas(id);
  const n = (obter(id).cobrancas || []).length + 1;
  const referencia = `bc-${c.id}-${n}`;
  const pedido = c.pedido || { tipo: 'assinatura', valorCentavos: k.valorCiclo };
  const vc = valorDaCobranca(k, pedido);
  const r = await cobrarNoGateway({
    metodo: 'PIX', valorCentavos: vc.valor, referencia, idempotencyKey: referencia, webhookUrl,
    descricao: pedido.descricao || `Bolso Cheio — ${c.produtos.map((p) => oferta(p)?.nome || p).join(' + ')} (${CICLOS[k.ciclo].nome.toLowerCase()})`,
    nome: c.nome, email: c.email || undefined, cpfCnpj: c.documento,
  });
  if (!r.ok) { return { ok: false, motivo: r.motivo || r.erro || 'o Mercado Pago recusou gerar o Pix' }; }
  const cob = {
    n, referencia, metodo: 'PIX', pagamentoId: r.pagamento.id, valorCentavos: vc.valor, teste: vc.teste, ciclo: k.ciclo, contrato: k.numero,
    link: r.pagamento.linkPagamento, pix: r.pagamento.pix?.payload || null, pixImagem: r.pagamento.pix?.imagemBase64 || null,
    estado: 'AGUARDANDO', criadaEm: agora(), origem: 'checkout', pedido,
  };
  atualizar(id, (x) => registrar({ ...x, cobrancas: [...(x.cobrancas || []), cob] }, vc.teste ? 'Pix de TESTE gerado no checkout' : 'Pix gerado no checkout', { referencia, valor: vc.valor }));
  return { ok: true, cobranca: cob, semQr: !cob.pix };
}

/**
 * Cartão: o Mercado Pago aprova ou recusa NA HORA. Aprovado já emite a chave;
 * recusado devolve a frase do motivo; em análise espera o webhook.
 */
export async function cartaoCheckout(id, { cartao = {}, pagarCartao, assinar, enviar, urlAtivacao, webhookUrl } = {}) {
  const c = obter(id);
  if (!c) { return { ok: false, motivo: 'cliente não encontrado' }; }
  const k = (c.contratos || []).at(-1);
  if (!k || c.contratoDesatualizado) { return { ok: false, motivo: 'o contrato não está em dia — volte e assine de novo' }; }
  fecharAbertas(id);
  const n = (obter(id).cobrancas || []).length + 1;
  const referencia = `bc-${c.id}-${n}`;
  const pedido = c.pedido || { tipo: 'assinatura', valorCentavos: k.valorCiclo };
  const vc = valorDaCobranca(k, pedido);
  /* Parcela só o que é ciclo inteiro pago de uma vez (assinatura ou troca). */
  const maxParcelas = vc.teste || pedido.tipo === 'adendo' ? 1 : CICLOS[pedido.ciclo || k.ciclo].meses;
  const r = await pagarCartao({
    token: cartao.token, bandeira: cartao.bandeira, emissor: cartao.emissor,
    parcelas: Math.min(Math.max(Number(cartao.parcelas) || 1, 1), maxParcelas),
    email: cartao.email || c.email, documento: cartao.documento || c.documento,
    valorCentavos: vc.valor, referencia, idempotencia: referencia, webhookUrl, naFatura: 'BOLSOCHEIO',
    descricao: pedido.descricao || `Bolso Cheio — ${c.produtos.map((p) => oferta(p)?.nome || p).join(' + ')} (${CICLOS[k.ciclo].nome.toLowerCase()})`,
  });
  if (!r.ok) {
    /* Falha de integração (credencial, rede) não é recusa do banco: quem está
       pagando não resolve "Access Token inválido". Ele lê o que fazer; o motivo
       técnico fica no histórico, pra quem opera o sistema. */
    atualizar(id, (x) => registrar(x, 'cartão não processado no checkout', { erro: r.motivo }));
    const doCliente = r.status == null || r.status >= 500 || [401, 403].includes(r.status)
      ? 'Não conseguimos processar o cartão agora. Nada foi cobrado — tente de novo em instantes ou pague com Pix.'
      : `O Mercado Pago não aceitou os dados: ${r.motivo}`;
    return { ok: false, recusado: true, motivo: doCliente, tecnico: r.motivo };
  }
  const estado = r.aprovado || r.emAnalise ? 'AGUARDANDO' : 'RECUSADA';
  const cob = {
    n, referencia, metodo: 'CREDIT_CARD', pagamentoId: r.pagamento.id, valorCentavos: vc.valor, teste: vc.teste, ciclo: k.ciclo, contrato: k.numero,
    estado, detalhe: r.detalhe, mensagem: r.mensagem, criadaEm: agora(), origem: 'checkout', pedido,
  };
  atualizar(id, (x) => registrar({ ...x, cobrancas: [...(x.cobrancas || []), cob] },
    r.aprovado ? 'cartão aprovado' : (r.emAnalise ? 'cartão em análise' : 'cartão recusado'), { referencia, detalhe: r.detalhe }));
  if (!r.aprovado) { return { ok: true, aprovado: false, emAnalise: r.emAnalise, recusado: !r.emAnalise, mensagem: r.mensagem, referencia }; }
  const lib = await emitirLicenca(id, { cob, assinar, enviar, urlAtivacao, origem: 'cartão aprovado', pagamentoId: r.pagamento.id });
  return { ok: true, aprovado: true, mensagem: r.mensagem, referencia, codigo: lib.codigo, validaAte: lib.validaAte, envio: lib.envio };
}

/** Como está a tentativa — é o que a tela do Pix pergunta enquanto espera. */
export function estadoCheckout(id, referencia) {
  const c = obter(id);
  const cob = (c?.cobrancas || []).find((x) => x.referencia === referencia);
  if (!cob) { return { ok: false, motivo: 'tentativa de pagamento não encontrada' }; }
  const lic = cob.licencaCodigo ? c.licencas.find((l) => l.codigo === cob.licencaCodigo) : null;
  return {
    ok: true, estado: cob.estado, metodo: cob.metodo, mensagem: cob.mensagem || null, pagamentoId: cob.pagamentoId,
    codigo: lic?.codigo || null, validaAte: lic?.validaAte || null, entregue: lic?.entregue ?? null,
  };
}

export function mensagemCobranca(c, cob) {
  const primeiro = c.nome.split(' ')[0];
  return [
    `Olá, ${primeiro}! Aqui é da Veloso Solution.`,
    '',
    `Segue o pagamento do Bolso Cheio (contrato ${cob.contrato}):`,
    `Valor: *${brl(cob.valorCentavos)}* — ${CICLOS[cob.ciclo].nome.toLowerCase()}`,
    '',
    cob.link ? `Pague por Pix ou cartão neste link:\n${cob.link}` : null,
    cob.pix ? `\nOu Pix copia e cola:\n${cob.pix}` : null,
    '',
    'Assim que o pagamento for confirmado, a sua chave de ativação chega aqui mesmo, neste WhatsApp.',
  ].filter((x) => x !== null).join('\n');
}

/* ---------------- confirmação e chave ---------------- */

/**
 * Chamado pelo webhook com o pagamento já confirmado. Idempotente: a mesma
 * cobrança confirmada duas vezes (o Mercado Pago reentrega) gera UMA chave.
 *
 * `assinar(payload) → token` assina a licença (Ed25519, chave privada no
 * servidor); `enviar` manda o WhatsApp. Os dois injetados.
 */
export async function aoConfirmarPagamento(pagamento, { assinar, enviar, urlAtivacao } = {}) {
  const ref = String(pagamento?.referencia || '');
  if (!ref.startsWith('bc-')) { return { ok: true, naoEDaqui: true }; }
  const c = lista().find((x) => (x.cobrancas || []).some((y) => y.referencia === ref));
  if (!c) { return { ok: false, motivo: `cobrança ${ref} não pertence a nenhum cliente` }; }
  const cob = c.cobrancas.find((y) => y.referencia === ref);
  if (cob.estado === 'PAGA') { return { ok: true, repetido: true, codigo: cob.licencaCodigo }; }
  return emitirLicenca(c.id, { cob, assinar, enviar, urlAtivacao, origem: 'pagamento confirmado', pagamentoId: pagamento.id });
}

/**
 * Liberação sem cobrança pelo gateway — o cliente pagou por fora (Pix direto na
 * conta, dinheiro). Exige o motivo: chave sem pagamento registrado é a primeira
 * coisa que se procura quando o caixa não fecha.
 */
export async function liberarManual(id, { motivo, assinar, enviar, urlAtivacao } = {}) {
  if (!String(motivo || '').trim()) { return { ok: false, motivo: 'diga por que está liberando sem cobrança (ex.: "pagou Pix direto em 23/09")' }; }
  const c = obter(id);
  if (!c) { return { ok: false, motivo: 'cliente não encontrado' }; }
  const k = (c.contratos || []).at(-1);
  if (!k) { return { ok: false, motivo: 'gere o contrato antes de liberar' }; }
  const aberta = (c.cobrancas || []).find((x) => x.estado === 'AGUARDANDO');
  return emitirLicenca(id, { cob: aberta || null, assinar, enviar, urlAtivacao, origem: 'liberação manual', motivoManual: String(motivo).trim(), ciclo: k.ciclo });
}

async function emitirLicenca(id, { cob, assinar, enviar, urlAtivacao, origem, pagamentoId, motivoManual, ciclo }) {
  if (typeof assinar !== 'function') { return { ok: false, motivo: 'assinatura de licença não configurada' }; }
  const pedido = cob?.pedido || null;
  let c = obter(id);
  const vig = licencaVigente(c);

  /* TROCA paga: agora sim o cadastro vira o plano novo (o do contrato da troca),
     a chave antiga sai de cena e o ciclo novo começa hoje — o crédito dos dias
     que sobravam já foi descontado no valor. */
  if (pedido?.tipo === 'troca') {
    const k = (c.contratos || []).find((x) => x.numero === pedido.contrato) || c.contratos.at(-1);
    c = atualizar(id, (x) => registrar({
      ...x, produtos: k.produtos, ciclo: k.ciclo, liberacoes: k.liberacoes, trocaAgendada: null,
      licencas: (x.licencas || []).map((l) => (l.codigo === pedido.licencaAnterior && !l.revogadaEm ? { ...l, revogadaEm: agora(), motivoRevogacao: `trocada por ${pedido.para}` } : l)),
    }, 'plano trocado', { de: pedido.de, para: pedido.para }));
  }
  /* ADENDO pago: amplia o liberado e entra no preço das próximas renovações.
     A chave é reemitida com o novo teto e a MESMA validade. */
  if (pedido?.tipo === 'adendo') {
    c = atualizar(id, (x) => {
      const lib = { ...x.liberacoes };
      if (pedido.code === 'atendente-extra' && lib.operadores != null) { lib.operadores += pedido.qtd; }
      const adendos = [...(x.adendos || [])];
      const i = adendos.findIndex((a) => a.code === pedido.code);
      if (i >= 0) { adendos[i] = { ...adendos[i], qtd: adendos[i].qtd + pedido.qtd, mensalCentavos: adendos[i].mensalCentavos + pedido.mensalCentavos }; }
      else { adendos.push({ code: pedido.code, nome: pedido.nome, qtd: pedido.qtd, mensalCentavos: pedido.mensalCentavos, desde: agora() }); }
      return registrar({
        ...x, liberacoes: lib, adendos,
        licencas: (x.licencas || []).map((l) => (l.codigo === pedido.licencaAnterior && !l.revogadaEm ? { ...l, revogadaEm: agora(), motivoRevogacao: 'reemitida com adendo' } : l)),
      }, 'adendo contratado', { adendo: pedido.code, qtd: pedido.qtd });
    });
  }

  const meses = CICLOS[pedido?.ciclo || cob?.ciclo || ciclo || c.ciclo].meses;
  /* Renovação antecipada soma ao que já está pago — o cliente que paga antes
     não pode perder os dias que ainda tinha. Troca começa hoje (o que sobrava
     virou crédito); adendo mantém a validade que já existia. */
  const desde = pedido?.tipo === 'troca' ? agora() : (vig ? vig.validaAte : agora());
  /* Pagamento de TESTE (R$ 0,50) libera 1 dia, e não soma à validade real. */
  const validaAte = cob?.teste ? new Date(Date.now() + 86400000).toISOString()
    : (pedido?.tipo === 'adendo' && vig ? vig.validaAte : somarMeses(desde, meses));
  const codigo = formatarCodigo(randomBytes(12));
  /* Sem documento e sem telefone: o conteúdo da chave é legível por quem a
     tiver (só a assinatura é secreta), e ela é mandada por WhatsApp. */
  const payload = {
    produto: 'bolso-cheio', codigo, cliente: c.id, nome: c.nome,
    produtos: c.produtos, liberacoes: c.liberacoes,
    iat: Date.now(), exp: new Date(validaAte).getTime(),
  };
  const token = assinar(payload);
  const kLic = (c.contratos || []).find((x) => x.numero === (pedido?.contrato || cob?.contrato)) || (c.contratos || []).at(-1);
  const lic = { codigo, token, emitidaEm: agora(), validaAte, origem: cob?.teste ? origem + ' (TESTE R$ 0,50)' : origem, teste: !!cob?.teste, contrato: kLic?.numero || null, referencia: cob?.referencia || null, motivoManual: motivoManual || null, entregue: false };

  let novo = atualizar(id, (x) => registrar({
    ...x,
    licencas: [...(x.licencas || []), lic],
    pedido: null,
    cobrancas: (x.cobrancas || []).map((y) => (cob && y.referencia === cob.referencia
      ? { ...y, estado: 'PAGA', pagaEm: agora(), pagamentoGatewayId: pagamentoId || null, licencaCodigo: codigo, manual: !!motivoManual } : y)),
  }, 'chave emitida', { codigo, validaAte, origem }));

  let envio = null;
  if (enviar) {
    envio = await enviar({ para: c.whatsapp, texto: mensagemChave(c, lic, urlAtivacao) });
    novo = atualizar(id, (x) => registrar({
      ...x, licencas: x.licencas.map((l) => (l.codigo === codigo ? { ...l, entregue: !!envio.ok, erroEntrega: envio.ok ? null : envio.erro } : l)),
    }, envio.ok ? 'chave enviada no WhatsApp' : 'chave NÃO enviada', envio.ok ? {} : { erro: envio.erro }));
  }
  return { ok: true, codigo, validaAte, envio, cliente: comSituacao(novo) };
}

/** Guarda como o convite de acesso saiu, canal por canal — pra ninguém prometer que chegou. */
export function registrarEntregaAcesso(id, { whatsapp, email } = {}) {
  return atualizar(id, (x) => registrar(x, 'convite de acesso', {
    erro: [whatsapp?.ok ? null : `WhatsApp: ${whatsapp?.erro || '?'}`, email?.ok ? null : `e-mail: ${email?.erro || '?'}`].filter(Boolean).join(' · ') || undefined,
    whatsapp: !!whatsapp?.ok, email: !!email?.ok,
  }));
}

/**
 * Quem PAGOU e ainda não tem como entrar: assinatura em vigor, sem senha criada
 * e a última entrega do convite falhou nos dois canais. É a
 * fila da nova tentativa automática — com teto por dia, pra canal quebrado não
 * virar metralhadora de mensagem na mesma pessoa.
 */
export function pendentesDeAcesso({ temSenha = () => false, maxPorDia = 6, em = agora() } = {}) {
  const dia = new Date(new Date(em).getTime() - 86400000).toISOString();
  return lista().filter((c) => {
    if (!licencaVigente(c, em) || temSenha(c.id)) { return false; }
    const convites = (c.historico || []).filter((h) => h.o === 'convite de acesso');
    const ultimo = convites.at(-1);
    /* Só quem TEVE entrega e ela falhou. Quem nunca recebeu convite (cliente
       antigo, de antes deste fluxo) é decisão de gente, não mensagem de robô. */
    if (!ultimo || ultimo.whatsapp || ultimo.email) { return false; }
    return convites.filter((h) => h.em > dia).length < maxPorDia;
  }).map((c) => c.id);
}

/** Cliente com assinatura em vigor dono deste e-mail — pra reenviar o acesso SÓ pros canais dele. */
export function assinantePorEmail(email, em = agora()) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) { return null; }
  return lista().find((c) => c.email === e && licencaVigente(c, em)) || null;
}

export function mensagemChave(c, lic, urlAtivacao) {
  const primeiro = c.nome.split(' ')[0];
  const l = c.liberacoes;
  const ate = new Date(lic.validaAte).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return [
    `Pagamento confirmado, ${primeiro}! ✅`,
    '',
    'Sua chave de ativação do Bolso Cheio:',
    `*${lic.codigo}*`,
    '',
    `Válida até ${ate}.`,
    `Liberado: ${l.operadores ?? 'ilimitados'} operador(es), ${l.campanhasMes ?? 'ilimitadas'} campanha(s)/mês, `
      + `banda de ${l.bandaGbMes == null ? 'uso ilimitado' : l.bandaGbMes + ' GB/mês'}`
      + `${l.auditor ? ', auditor' : ''}${l.botFunil ? ', bot de funil' : ''}${l.redes?.length ? ', ' + l.redes.join(' e ') : ''}.`,
    urlAtivacao ? `\nConfira a sua chave: ${urlAtivacao}?c=${encodeURIComponent(lic.codigo)}` : null,
    '',
    'A chave é pessoal — não repasse.',
  ].filter((x) => x !== null).join('\n');
}

export async function reenviarChave(id, { enviar, urlAtivacao } = {}) {
  const c = obter(id);
  if (!c) { return { ok: false, motivo: 'cliente não encontrado' }; }
  const lic = licencaVigente(c);
  if (!lic) { return { ok: false, motivo: 'este cliente não tem chave válida agora' }; }
  const envio = await enviar({ para: c.whatsapp, texto: mensagemChave(c, lic, urlAtivacao) });
  const novo = atualizar(id, (x) => registrar({
    ...x, licencas: x.licencas.map((l) => (l.codigo === lic.codigo ? { ...l, entregue: l.entregue || !!envio.ok } : l)),
  }, envio.ok ? 'chave reenviada' : 'reenvio da chave falhou', envio.ok ? {} : { erro: envio.erro }));
  return { ok: !!envio.ok, envio, motivo: envio.ok ? null : envio.erro, cliente: comSituacao(novo) };
}

export async function reenviarCobranca(id, { enviar } = {}) {
  const c = obter(id);
  const cob = (c?.cobrancas || []).find((x) => x.estado === 'AGUARDANDO');
  if (!cob) { return { ok: false, motivo: 'não há cobrança aguardando pagamento' }; }
  const envio = await enviar({ para: c.whatsapp, texto: mensagemCobranca(c, cob) });
  atualizar(id, (x) => registrar(x, envio.ok ? 'link de pagamento reenviado' : 'reenvio do link falhou', envio.ok ? {} : { erro: envio.erro }));
  return { ok: !!envio.ok, envio, motivo: envio.ok ? null : envio.erro };
}

/** Cancela a cobrança aberta aqui (não estorna nada — só deixa de esperar por ela). */
export function cancelarCobranca(id) {
  const c = obter(id);
  const cob = (c?.cobrancas || []).find((x) => x.estado === 'AGUARDANDO');
  if (!cob) { return { ok: false, motivo: 'não há cobrança aguardando pagamento' }; }
  const novo = atualizar(id, (x) => registrar({
    ...x, cobrancas: x.cobrancas.map((y) => (y.referencia === cob.referencia ? { ...y, estado: 'CANCELADA', canceladaEm: agora() } : y)),
  }, 'cobrança cancelada', { referencia: cob.referencia }));
  return { ok: true, cliente: comSituacao(novo) };
}

export function revogar(id, { motivo } = {}) {
  if (!String(motivo || '').trim()) { return { ok: false, motivo: 'diga o motivo da revogação' }; }
  const c = obter(id);
  const lic = c && licencaVigente(c);
  if (!lic) { return { ok: false, motivo: 'não há chave válida para revogar' }; }
  const novo = atualizar(id, (x) => registrar({
    ...x, licencas: x.licencas.map((l) => (l.codigo === lic.codigo ? { ...l, revogadaEm: agora(), motivoRevogacao: String(motivo).trim() } : l)),
  }, 'chave revogada', { codigo: lic.codigo, motivo }));
  return { ok: true, cliente: comSituacao(novo) };
}

/**
 * Consulta PÚBLICA de uma chave (a página /ativar). Mostra só o necessário pra
 * conferir: primeiro nome, o que está liberado e até quando. Documento e
 * telefone não saem daqui — quem tem a chave não precisa deles.
 */
export function consultarCodigo(bruto) {
  const codigo = normalizarCodigo(bruto);
  if (!codigo) { return { ok: false, motivo: 'formato de chave inválido (BC-XXXX-XXXX-XXXX)' }; }
  for (const c of lista()) {
    const l = (c.licencas || []).find((x) => x.codigo === codigo);
    if (!l) { continue; }
    const estado = l.revogadaEm ? 'revogada' : (l.validaAte > agora() ? 'valida' : 'vencida');
    return {
      ok: true, codigo, estado, validaAte: l.validaAte, titular: c.nome.split(' ')[0],
      produtos: c.produtos.map((p) => oferta(p)?.nome || p), liberacoes: c.liberacoes,
      token: estado === 'valida' ? l.token : null,
    };
  }
  return { ok: false, motivo: 'chave não encontrada' };
}

export { formatarWhatsapp };
