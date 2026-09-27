/**
 * Carteira de clientes. O caminho inteiro, do cadastro à chave no WhatsApp, com
 * o mundo de fora trocado por dublês: impressora de PDF, gateway, WhatsApp e
 * assinatura. O que estes casos protegem:
 *  - o preço do contrato é o preço da cobrança (39,90 / 30 anual; 120 / 100 anual);
 *  - chave só sai com pagamento confirmado (ou liberação manual COM motivo);
 *  - pagamento reentregue não gera segunda chave;
 *  - PDF "assinado" que não é o nosso contrato é recusado;
 *  - pagamento de cartão pelo checkout (id diferente da cobrança) é reconhecido.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign, verify } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'vsclientes-'));
process.env.VSCLIENTES_DIR = join(dir, 'cli');
process.env.VSPAGAMENTOS_DIR = join(dir, 'pag');
process.env.VSPLANOS_DIR = join(dir, 'planos');
const C = await import('../engine/vsclientes/index.mjs');
const O = await import('../engine/vsclientes/ofertas.mjs');
const { montarContrato } = await import('../engine/vsclientes/contrato.mjs');
test.after(() => rmSync(dir, { recursive: true, force: true }));

/* CPF e CNPJ válidos (dígitos verificadores conferem), gerados pra teste. */
const CPF = '52998224725';
const CNPJ = '53759232000194';

/* ---- dublês ---- */

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const assinar = (payload) => { const buf = Buffer.from(JSON.stringify(payload)); return b64url(buf) + '.' + b64url(sign(null, buf, privateKey)); };
const abrirToken = (t) => {
  const [p, s] = t.split('.');
  const buf = Buffer.from(p, 'base64url');
  return { ok: verify(null, buf, publicKey, Buffer.from(s, 'base64url')), payload: JSON.parse(buf) };
};

/** "Chrome": devolve um PDF mínimo que carrega o HTML — cada contrato com bytes próprios. */
const imprimir = async (html) => Buffer.from(`%PDF-1.7\n% contrato\n${html.length}\n${html.slice(0, 400)}\n%%EOF\n`, 'latin1');

/** Assinatura do ITI simulada: atualização INCREMENTAL, anexada ao fim do original. */
const assinarNoGovbr = (original, quem = 'MARIA DA SILVA') => {
  const der = Buffer.from(`certificado AC Final do Governo Federal do Brasil v1 ${quem}:${CPF}`, 'utf8').toString('hex');
  return Buffer.concat([original, Buffer.from(`\n1 0 obj <</Type/Sig/ByteRange [0 10 20 30]/Contents <${der}>>> endobj\n%%EOF\n`, 'latin1')]);
};

function whats() {
  const enviados = [];
  const f = async (m) => { enviados.push(m); return { ok: true }; };
  f.enviados = enviados;
  return f;
}

let seqGateway = 0;
function gateway() {
  const chamadas = [];
  const f = async (e) => {
    chamadas.push(e);
    return { ok: true, pagamento: { id: 'pref-' + (++seqGateway), linkPagamento: 'https://mp.test/checkout/' + seqGateway, pix: null }, avisos: [] };
  };
  f.chamadas = chamadas;
  return f;
}

const base = (x = {}) => ({ nome: 'Maria da Silva', documento: CPF, whatsapp: '(31) 98888-7777', produtos: ['whats-bot'], ciclo: 'mensal', ...x });

/* ---------------- regra comercial ---------------- */

test('preços da tabela: bot 39,90 mensal / 30 no anual; redes 120 / 100 no anual', () => {
  const bot = O.precoDe({ produtos: ['whats-bot'], ciclo: 'mensal' });
  assert.equal(bot.total, 3990);
  const botAnual = O.precoDe({ produtos: ['whats-bot'], ciclo: 'anual' });
  assert.equal(botAnual.mensal, 3000);
  assert.equal(botAnual.total, 36000, 'anual cobra os 12 meses de uma vez');
  assert.equal(botAnual.economia, (3990 - 3000) * 12);
  assert.equal(O.precoDe({ produtos: ['redes-micro'], ciclo: 'mensal' }).total, 12000);
  assert.equal(O.precoDe({ produtos: ['redes-micro'], ciclo: 'anual' }).total, 120000);
  assert.equal(O.precoDe({ produtos: ['whats-bot', 'redes-micro'], ciclo: 'mensal' }).total, 15990);
});

test('sob consulta nao tem preco de tabela: sem valor combinado, recusa', () => {
  assert.equal(O.precoDe({ produtos: ['sob-consulta'] }).ok, false);
  assert.equal(O.precoDe({ produtos: ['sob-consulta'], valorCombinadoMensal: 25000, ciclo: 'anual' }).total, 300000);
});

test('bot WhatsApp libera 2 operadores por padrao; redes liberam TikTok e Instagram', () => {
  assert.equal(O.liberacoesPadrao(['whats-bot']).operadores, 2);
  assert.deepEqual(O.liberacoesPadrao(['redes-micro']).redes, ['tiktok', 'instagram']);
  const combo = O.liberacoesPadrao(['whats-bot', 'redes-micro']);
  assert.equal(combo.operadores, 2);
  assert.equal(combo.auditor, true);
  assert.equal(combo.botFunil, true);
});

test('documento e WhatsApp sao conferidos: digito errado e numero curto sao recusados', () => {
  assert.equal(O.documento(CPF).ok, true);
  assert.equal(O.documento(CNPJ).tipo, 'CNPJ');
  assert.equal(O.documento('52998224724').ok, false);
  assert.equal(O.documento('11111111111').ok, false);
  assert.equal(O.whatsapp('31 98888-7777').digitos, '5531988887777');
  assert.equal(O.whatsapp('98888-7777').ok, false);
});

test('codigo de ativacao: formato BC-XXXX-XXXX-XXXX sem caracteres ambiguos', () => {
  const c = O.formatarCodigo(Buffer.alloc(12, 7));
  assert.match(c, /^BC-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
  assert.equal(O.normalizarCodigo(c.toLowerCase().replace(/-/g, ' ')), c, 'digitado em minusculas e com espaco ainda confere');
  assert.equal(O.normalizarCodigo('BC-0000-1111-OOOO'), null);
});

test('somar meses nao pula mes curto: 31/01 + 1 mes = 28/02', () => {
  assert.equal(O.somarMeses('2027-01-31T12:00:00.000Z', 1).slice(0, 10), '2027-02-28');
  assert.equal(O.somarMeses('2026-09-23T12:00:00.000Z', 12).slice(0, 10), '2027-09-23');
});

test('contrato detalha valor, ciclo, operadores, campanhas, auditor, bot de funil e banda', () => {
  const v = O.validarCliente(base({ ciclo: 'anual', liberacoes: { operadores: 2, campanhasMes: 4, bandaGbMes: 7, auditor: true, botFunil: true, redes: [] } }));
  const preco = O.precoDe(v.cliente);
  const html = montarContrato({ cliente: v.cliente, preco, numero: "BC-T-1" }).replace(/\u00a0/g, " ");
  for (const t of ['R$ 30,00', 'R$ 360,00', 'Anual', 'Operadores', 'Campanhas por mês', '>4<', '7 GB/mês',
    'Auditor', 'Bot para funil', 'Pix ou cartão', 'gov.br', '529.982.247-25', '53.759.232/0001-94']) {
    assert.ok(html.includes(t), `contrato sem "${t}"`);
  }
});

/* ---------------- caminho inteiro ---------------- */

let cli;
test('cadastro valida, normaliza e recusa o mesmo documento duas vezes', () => {
  const erro = C.salvar(base({ documento: '123', whatsapp: '1' }));
  assert.equal(erro.ok, false);
  assert.equal(erro.erros.length, 2);
  const r = C.salvar(base());
  assert.equal(r.ok, true, JSON.stringify(r.erros));
  cli = r.cliente;
  assert.equal(cli.whatsapp, '5531988887777');
  assert.equal(cli.liberacoes.operadores, 2, 'nasce com o padrao do produto');
  assert.equal(cli.situacao.codigo, 'cadastrado');
  assert.equal(C.salvar(base({ nome: 'Outra Pessoa' })).ok, false, 'mesmo CPF = mesmo cliente');
});

test('cobrar sem contrato e recusado: e o contrato que diz o valor', async () => {
  const r = await C.cobrar(cli.id, { cobrar: gateway() });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /contrato/);
});

test('contrato gerado vira PDF guardado e muda a situacao', async () => {
  const r = await C.gerarContrato(cli.id, { imprimir });
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.contrato.valorCiclo, 3990);
  assert.equal(r.cliente.situacao.codigo, 'contrato_gerado');
  assert.ok(C.arquivoContrato(cli.id, 1).buf.subarray(0, 5).toString() === '%PDF-');
});

test('impressora que nao devolve PDF nao gera contrato fantasma', async () => {
  const r = await C.gerarContrato(cli.id, { imprimir: async () => Buffer.from('<html>') });
  assert.equal(r.ok, false);
  assert.equal(C.obter(cli.id).contratos.length, 1);
});

test('PDF sem assinatura, ou assinatura de OUTRO documento, e recusado', () => {
  const original = C.arquivoContrato(cli.id, 1).buf;
  const semAss = C.receberAssinado(cli.id, original);
  assert.equal(semAss.ok, false);
  assert.match(semAss.motivo, /não tem assinatura/);
  const outro = assinarNoGovbr(Buffer.from('%PDF-1.7\noutro documento qualquer\n%%EOF\n'));
  const r = C.receberAssinado(cli.id, outro);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /não é o contrato/);
  assert.equal(C.receberAssinado(cli.id, Buffer.from('nao sou pdf')).ok, false);
});

test('PDF assinado no gov.br, do nosso contrato, e aceito e reconhece o signatario', () => {
  const original = C.arquivoContrato(cli.id, 1).buf;
  const umaParte = assinarNoGovbr(original);
  const r1 = C.receberAssinado(cli.id, umaParte);
  assert.equal(r1.ok, true, r1.motivo);
  assert.equal(r1.assinado.govbr, true);
  assert.deepEqual(r1.assinado.signatarios, ['MARIA DA SILVA']);
  assert.ok(r1.avisos.some((a) => /falta a outra parte/.test(a)), 'uma assinatura so avisa que falta a outra parte');
  const r2 = C.receberAssinado(cli.id, assinarNoGovbr(umaParte, 'FABIANO LUCIO VELOSO'));
  assert.equal(r2.assinado.assinaturas, 2);
  assert.equal(r2.avisos.length, 0);
  assert.equal(r2.cliente.situacao.codigo, 'assinado');
});

let cobranca;
test('cobranca sai no valor do contrato, pelo checkout (Pix e cartao) e o link vai pro WhatsApp', async () => {
  const g = gateway(); const w = whats();
  const r = await C.cobrar(cli.id, { cobrar: g, enviar: w, webhookUrl: 'https://x/api/webhooks/mercadopago' });
  assert.equal(r.ok, true, r.motivo);
  cobranca = r.cobranca;
  assert.equal(g.chamadas[0].valorCentavos, 3990);
  assert.equal(g.chamadas[0].metodo, 'CREDIT_CARD', 'o checkout do MP oferece Pix e cartao');
  assert.deepEqual(g.chamadas[0].excluirTipos, ['ticket', 'atm'], 'boleto fora: o contrato diz Pix ou cartao');
  assert.equal(g.chamadas[0].webhookUrl, 'https://x/api/webhooks/mercadopago');
  assert.equal(w.enviados[0].para, '5531988887777');
  assert.match(w.enviados[0].texto, /R\$\s?39,90/);
  assert.match(w.enviados[0].texto, /https:\/\/mp\.test\/checkout/);
  assert.equal(r.cliente.situacao.codigo, 'aguardando_pagamento');
  const dup = await C.cobrar(cli.id, { cobrar: g });
  assert.equal(dup.ok, false, 'segunda cobranca com uma aberta confunde a cliente');
});

test('pagamento de OUTRA origem (referencia sem bc-) nao mexe na carteira', async () => {
  const r = await C.aoConfirmarPagamento({ id: '1', referencia: 'OS-77' }, { assinar, enviar: whats() });
  assert.equal(r.naoEDaqui, true);
});

let codigo;
test('pagamento confirmado gera a chave assinada e manda no WhatsApp cadastrado', async () => {
  const w = whats();
  const r = await C.aoConfirmarPagamento({ id: '999', referencia: cobranca.referencia }, { assinar, enviar: w, urlAtivacao: 'https://bc/ativar' });
  assert.equal(r.ok, true, r.motivo);
  codigo = r.codigo;
  assert.match(codigo, /^BC-/);
  assert.equal(w.enviados[0].para, '5531988887777');
  assert.ok(w.enviados[0].texto.includes(codigo));
  assert.match(w.enviados[0].texto, /2 operador/);
  assert.match(w.enviados[0].texto, /https:\/\/bc\/ativar\?c=/);
  const c = C.obter(cli.id);
  const lic = c.licencas[0];
  const t = abrirToken(lic.token);
  assert.equal(t.ok, true, 'a chave e assinada e confere com a chave publica');
  assert.equal(t.payload.produto, 'bolso-cheio');
  assert.equal(t.payload.liberacoes.operadores, 2);
  assert.equal(t.payload.documento, undefined, 'documento nao vai dentro da chave');
  assert.equal(lic.entregue, true);
  assert.equal(c.cobrancas[0].estado, 'PAGA');
  const dias = (new Date(lic.validaAte) - Date.now()) / 86400000;
  assert.ok(dias > 27 && dias < 32, `mensal vale ~1 mes (deu ${dias})`);
});

test('mesmo pagamento reentregue pelo Mercado Pago nao gera segunda chave', async () => {
  const w = whats();
  const r = await C.aoConfirmarPagamento({ id: '999', referencia: cobranca.referencia }, { assinar, enviar: w });
  assert.equal(r.repetido, true);
  assert.equal(w.enviados.length, 0);
  assert.equal(C.obter(cli.id).licencas.length, 1);
});

test('consulta publica da chave mostra primeiro nome e liberacoes, sem documento nem telefone', () => {
  const r = C.consultarCodigo(codigo.toLowerCase());
  assert.equal(r.ok, true);
  assert.equal(r.estado, 'valida');
  assert.equal(r.titular, 'Maria');
  assert.equal(r.liberacoes.operadores, 2);
  const json = JSON.stringify({ ...r, token: undefined });
  assert.ok(!json.includes(CPF) && !json.includes('5531988887777'));
  assert.equal(C.consultarCodigo('BC-2222-2222-2222').ok, false);
});

test('renovacao antecipada SOMA a validade — quem paga antes nao perde dias', async () => {
  const antes = C.obter(cli.id).licencas[0].validaAte;
  const g = gateway();
  const cob = await C.cobrar(cli.id, { cobrar: g });
  assert.equal(cob.ok, true, cob.motivo);
  const r = await C.aoConfirmarPagamento({ id: '1000', referencia: cob.cobranca.referencia }, { assinar, enviar: whats() });
  assert.equal(r.validaAte.slice(0, 10), O.somarMeses(antes, 1).slice(0, 10));
});

test('liberacao manual exige motivo e fica no historico', async () => {
  const outro = C.salvar(base({ nome: 'Joana Empresa Ltda', documento: CNPJ, whatsapp: '31977776666', produtos: ['redes-micro'], ciclo: 'anual' }));
  assert.equal(outro.ok, true, JSON.stringify(outro.erros));
  const id = outro.cliente.id;
  assert.equal((await C.liberarManual(id, { motivo: 'pagou', assinar })).ok, false, 'sem contrato nao libera');
  await C.gerarContrato(id, { imprimir });
  assert.equal((await C.liberarManual(id, { motivo: '  ', assinar })).ok, false);
  const r = await C.liberarManual(id, { motivo: 'Pix direto em 23/09', assinar, enviar: whats() });
  assert.equal(r.ok, true, r.motivo);
  const c = C.obter(id);
  assert.equal(c.licencas[0].motivoManual, 'Pix direto em 23/09');
  const dias = (new Date(c.licencas[0].validaAte) - Date.now()) / 86400000;
  assert.ok(dias > 360, 'anual vale 12 meses');
});

test('mudar o que o contrato promete exige contrato novo antes de cobrar', async () => {
  const c = C.obter(cli.id);
  const r = C.salvar({ ...c, liberacoes: { ...c.liberacoes, bandaGbMes: 50 } });
  assert.equal(r.ok, true);
  const cob = await C.cobrar(cli.id, { cobrar: gateway() });
  assert.equal(cob.ok, false);
  assert.match(cob.motivo, /contrato novo/);
});

test('revogar exige motivo e a consulta publica passa a dizer revogada', () => {
  assert.equal(C.revogar(cli.id, {}).ok, false);
  const vig = C.listar().find((x) => x.id === cli.id).licencaVigente.codigo;
  assert.equal(C.revogar(cli.id, { motivo: 'teste' }).ok, true);
  assert.equal(C.consultarCodigo(vig).estado, 'revogada');
  assert.equal(C.consultarCodigo(vig).token, null, 'chave revogada nao devolve o token');
});

test('envio do WhatsApp que falha fica registrado: chave emitida mas NAO entregue', async () => {
  const x = C.salvar(base({ nome: 'Ana Falha', documento: '11144477735', whatsapp: '31966665555' }));
  await C.gerarContrato(x.cliente.id, { imprimir });
  const r = await C.liberarManual(x.cliente.id, { motivo: 'teste', assinar, enviar: async () => ({ ok: false, erro: 'canal desconectado' }) });
  assert.equal(r.ok, true);
  assert.equal(r.envio.ok, false);
  const lic = C.obter(x.cliente.id).licencas[0];
  assert.equal(lic.entregue, false);
  assert.equal(lic.erroEntrega, 'canal desconectado');
});

/* ---------------- webhook: cartão pelo checkout ---------------- */

test('pagamento pelo CHECKOUT (id diferente da preferencia) e achado pela referencia', async () => {
  const P = await import('../engine/vspagamentos/index.mjs');
  const antes = { ...process.env };
  try {
    process.env.MP_AMBIENTE = 'teste';
    process.env.MP_ACCESS_TOKEN_TESTE = 'TEST-token-de-mentira';
    process.env.MP_WEBHOOK_SECRET = 'segredo-de-mentira-com-tamanho-ok';
    P.configurar({ provedor: 'mercadopago', modelo: 'direto' });
    const resp = (corpo) => async () => ({ ok: true, status: 200, json: async () => corpo, text: async () => JSON.stringify(corpo) });
    const c = await P.cobrar({ metodo: 'CREDIT_CARD', valorCentavos: 3990, referencia: 'bc-cli_x-1', descricao: 'teste' },
      { fetchImpl: resp({ id: 'pref-abc', init_point: 'https://mp/checkout', sandbox_init_point: 'https://sandbox.mp/checkout' }) });
    assert.equal(c.ok, true, c.motivo);
    assert.equal(c.pagamento.id, 'pref-abc');
    const { createHmac } = await import('node:crypto');
    const v1 = createHmac('sha256', process.env.MP_WEBHOOK_SECRET).update('id:555;request-id:req-1;ts:1700000000;').digest('hex');
    const cab = { 'x-request-id': 'req-1', 'x-signature': `ts=1700000000,v1=${v1}` };
    const r = await P.processarWebhook(cab, { id: 'evt-1', type: 'payment', action: 'payment.updated', data: { id: '555' } },
      { query: { 'data.id': '555' }, fetchImpl: resp({ id: 555, status: 'approved', external_reference: 'bc-cli_x-1', transaction_amount: 39.9, payment_method_id: 'visa', payment_type_id: 'credit_card' }) });
    assert.equal(r.ok, true, r.motivo);
    assert.equal(r.orfao, undefined, 'antes: pagamento de cartao caia em "nao e nossa"');
    assert.equal(r.estado, 'CONFIRMADO');
    assert.equal(r.pagamento.referencia, 'bc-cli_x-1');
    assert.equal(P.obter('pref-abc').pagamentoGatewayId, '555');
  } finally { process.env = antes; }
});

test('envio do contrato no WhatsApp deixa rastro: enviado, ou NAO enviado com o motivo', async () => {
  const x = C.salvar(base({ nome: 'Bia Contrato', documento: '39053344705', whatsapp: '31955554444' }));
  await C.gerarContrato(x.cliente.id, { imprimir });
  const falha = await C.enviarContrato(x.cliente.id, { enviarArquivo: async () => { throw new Error('sendFile quebrou'); } });
  assert.equal(falha.ok, false);
  assert.equal(falha.motivo, 'sendFile quebrou');
  assert.equal(C.obter(x.cliente.id).historico.at(-1).o, 'contrato NÃO enviado');
  const enviados = [];
  const ok = await C.enviarContrato(x.cliente.id, { enviarArquivo: async (m) => { enviados.push(m); return { ok: true }; } });
  assert.equal(ok.ok, true);
  assert.equal(enviados[0].para, '5531955554444');
  assert.ok(enviados[0].buf.subarray(0, 5).toString() === '%PDF-');
  assert.match(enviados[0].nome, /^contrato-BC-.*\.pdf$/);
  assert.equal(C.obter(x.cliente.id).historico.at(-1).o, 'contrato enviado no WhatsApp');
});

/* ---------------- checkout pelo console ---------------- */

/* Outro documento = outra pessoa: e-mail proprio, senao cai na regra de quem ja tem contrato. */
const dadosCk = (x = {}) => ({ nome: 'Carla Checkout', documento: '71428793860', whatsapp: '31944443333',
  email: x.documento ? `cliente${x.documento}@example.com` : 'carla@example.com', produtos: ['whats-bot', 'redes-micro'], ciclo: 'anual', aceite: true, ...x });
let ck;
test('checkout exige aceite do contrato e e-mail; cria cliente e contrato no valor escolhido', async () => {
  assert.match((await C.iniciarCheckout(dadosCk({ aceite: false }), { imprimir })).motivo, /aceitar o contrato/);
  assert.match((await C.iniciarCheckout(dadosCk({ email: 'x' }), { imprimir })).motivo, /e-mail/);
  assert.equal((await C.iniciarCheckout(dadosCk({ produtos: ['sob-consulta'] }), { imprimir })).ok, false, 'sob consulta nao se compra no checkout');
  ck = await C.iniciarCheckout(dadosCk(), { imprimir });
  assert.equal(ck.ok, true, ck.motivo);
  assert.equal(ck.contrato.valorCiclo, (3000 + 10000) * 12);
  assert.equal(C.obter(ck.clienteId).historico.at(-1).o, 'contrato aceito no checkout');
  const denovo = await C.iniciarCheckout(dadosCk(), { imprimir });
  assert.equal(denovo.clienteId, ck.clienteId, 'mesmo documento = mesmo cliente, sem duplicar');
  assert.equal(C.obter(ck.clienteId).contratos.length, 1, 'mesma escolha nao gera contrato novo');
});

test('quem ja tem contrato nao assina outro com o mesmo e-mail ou WhatsApp e outro CPF/CNPJ', async () => {
  const antes = C.listar().length;
  const mesmoEmail = await C.iniciarCheckout(dadosCk({ documento: '31415926590', whatsapp: '31911112222', email: 'carla@example.com' }), { imprimir, publico: true });
  assert.equal(mesmoEmail.ok, false);
  assert.equal(mesmoEmail.jaTemContrato, true);
  assert.match(mesmoEmail.motivo, /já existe um contrato/);
  const mesmoWhats = await C.iniciarCheckout(dadosCk({ documento: '31415926590', email: 'outra@example.com' }), { imprimir });
  assert.equal(mesmoWhats.jaTemContrato, true, 'vale tambem fora da pagina publica');
  assert.equal(C.listar().length, antes, 'nenhum cliente novo criado');
});

test('Pix do checkout nasce no valor do contrato, com CPF e QR, e troca a tentativa aberta', async () => {
  const chamadas = [];
  const cobrarFake = async (e) => { chamadas.push(e); return { ok: true, pagamento: { id: 'pix-' + chamadas.length, pix: { payload: '000201PIX', imagemBase64: 'iVBOR' } } }; };
  const a = await C.pixCheckout(ck.clienteId, { cobrar: cobrarFake });
  assert.equal(a.ok, true, a.motivo);
  assert.equal(chamadas[0].metodo, 'PIX');
  assert.equal(chamadas[0].valorCentavos, 156000);
  assert.equal(chamadas[0].cpfCnpj, '71428793860');
  assert.equal(a.cobranca.pix, '000201PIX');
  const b = await C.pixCheckout(ck.clienteId, { cobrar: cobrarFake });
  assert.equal(b.ok, true, 'gerar de novo nao pode travar em "ja existe cobranca"');
  const cobs = C.obter(ck.clienteId).cobrancas;
  assert.equal(cobs.filter((x) => x.estado === 'AGUARDANDO').length, 1);
  assert.equal(C.estadoCheckout(ck.clienteId, b.cobranca.referencia).estado, 'AGUARDANDO');
});

test('cartao RECUSADO devolve a mensagem do banco e nao gera chave', async () => {
  const r = await C.cartaoCheckout(ck.clienteId, {
    cartao: { token: 'tok', bandeira: 'visa', parcelas: 3 }, assinar,
    pagarCartao: async () => ({ ok: true, aprovado: false, emAnalise: false, detalhe: 'cc_rejected_insufficient_amount', mensagem: 'O cartão não tem limite para este valor. Use outro cartão ou o Pix.', pagamento: { id: 'c1' } }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.recusado, true);
  assert.match(r.mensagem, /limite/);
  assert.equal(C.obter(ck.clienteId).licencas.length, 0);
});

test('cartao APROVADO: valor e parcelas decididos no servidor, chave emitida na hora', async () => {
  let pedido;
  const w = whats();
  const r = await C.cartaoCheckout(ck.clienteId, {
    cartao: { token: 'tok', bandeira: 'master', parcelas: 99 }, assinar, enviar: w, urlAtivacao: 'https://bc/ativar',
    pagarCartao: async (e) => { pedido = e; return { ok: true, aprovado: true, detalhe: 'accredited', mensagem: 'Pagamento aprovado.', pagamento: { id: 'c2' } }; },
  });
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.aprovado, true);
  assert.equal(pedido.valorCentavos, 156000, 'o valor e o do contrato, nao o que o navegador mandou');
  assert.equal(pedido.parcelas, 12, 'anual aceita no maximo 12x');
  assert.match(r.codigo, /^BC-/);
  assert.equal(w.enviados[0].para, '5531944443333');
  const e = C.estadoCheckout(ck.clienteId, r.referencia);
  assert.equal(e.estado, 'PAGA');
  assert.equal(e.codigo, r.codigo);
  assert.equal(C.obter(ck.clienteId).cobrancas.filter((x) => x.estado === 'AGUARDANDO').length, 0, 'o Pix aberto da tentativa anterior foi fechado');
});

test('cartao mensal nao parcela', async () => {
  const x = await C.iniciarCheckout(dadosCk({ nome: 'Duda Mensal', documento: '86288366757', whatsapp: '31933332222', produtos: ['whats-bot'], ciclo: 'mensal' }), { imprimir });
  let pedido;
  await C.cartaoCheckout(x.clienteId, { cartao: { token: 't', parcelas: 6 }, assinar, pagarCartao: async (e) => { pedido = e; return { ok: true, aprovado: false, emAnalise: true, mensagem: 'em análise', pagamento: { id: 'c3' } }; } });
  assert.equal(pedido.parcelas, 1);
  assert.equal(pedido.valorCentavos, 3990);
});

test('gateway: cartao vai com token e sem numero de cartao; recusa vira frase em portugues', async () => {
  const { criarGateway, explicarRecusa } = await import('../engine/vspagamentos/mercadopago.mjs');
  let corpo;
  const g = criarGateway({ apiKey: 'APP_USR-x', fetchImpl: async (_u, o) => { corpo = JSON.parse(o.body); return { ok: true, status: 201, json: async () => ({ id: 77, status: 'rejected', status_detail: 'cc_rejected_bad_filled_security_code', transaction_amount: 39.9 }) }; } });
  const r = await g.pagarComCartao({ token: 'tok-1', bandeira: 'visa', parcelas: 1, valorCentavos: 3990, email: 'a@b.co', documento: '529.982.247-25', referencia: 'bc-1' });
  assert.equal(corpo.token, 'tok-1');
  assert.equal(corpo.transaction_amount, 39.9);
  assert.deepEqual(corpo.payer.identification, { type: 'CPF', number: '52998224725' });
  assert.equal(r.aprovado, false);
  assert.match(r.mensagem, /código de segurança/);
  assert.match(explicarRecusa('qualquer_coisa', 'rejected'), /não foi aprovado/);
  assert.match(explicarRecusa(null, 'in_process'), /análise/);
  assert.equal((await g.pagarComCartao({ valorCentavos: 100 })).ok, false, 'sem token nao chama o Mercado Pago');
});

test('falha de credencial no cartao: quem paga le o que fazer, o tecnico fica no historico', async () => {
  const r = await C.cartaoCheckout(ck.clienteId, { cartao: { token: 't' }, assinar,
    pagarCartao: async () => ({ ok: false, status: 401, motivo: 'Access Token do Mercado Pago inválido ou vencido' }) });
  assert.match(r.motivo, /Nada foi cobrado/);
  assert.doesNotMatch(r.motivo, /Access Token/);
  assert.match(C.obter(ck.clienteId).historico.at(-1).erro, /Access Token/);
});

test('modo teste: cobra R$ 0,50, chave vale 1 dia, e desliga sozinho', async () => {
  const x = await C.iniciarCheckout(dadosCk({ nome: 'Teo Teste', documento: '12345678909', whatsapp: '31922221111', produtos: ['whats-bot'], ciclo: 'anual' }), { imprimir });
  assert.equal(x.cobrar.teste, false);
  assert.equal(x.cobrar.valorCentavos, 36000);
  assert.equal(C.ligarModoTeste({ minutos: 30 }).ativo, true);
  let pix; await C.pixCheckout(x.clienteId, { cobrar: async (e) => { pix = e; return { ok: true, pagamento: { id: 'p-t', pix: { payload: 'x' } } }; } });
  assert.equal(pix.valorCentavos, 50, 'modo teste cobra 50 centavos');
  let card;
  const r = await C.cartaoCheckout(x.clienteId, { cartao: { token: 't', parcelas: 12 }, assinar, enviar: whats(),
    pagarCartao: async (e) => { card = e; return { ok: true, aprovado: true, mensagem: 'ok', pagamento: { id: 'c-t' } }; } });
  assert.equal(card.valorCentavos, 50);
  assert.equal(card.parcelas, 1, '50 centavos nao parcela');
  const horas = (new Date(r.validaAte) - Date.now()) / 3600000;
  assert.ok(horas > 23 && horas < 25, `chave de teste vale 1 dia (deu ${horas}h), nao o ano`);
  assert.equal(C.obter(x.clienteId).licencas.at(-1).teste, true);
  assert.equal(C.modoTeste(new Date(Date.now() + 31 * 60000).toISOString()).ativo, false, 'passou do prazo, desliga sozinho');
  assert.equal(C.desligarModoTeste().ativo, false);
  let cheio; await C.pixCheckout(x.clienteId, { cobrar: async (e) => { cheio = e; return { ok: true, pagamento: { id: 'p-c', pix: { payload: 'x' } } }; } });
  assert.equal(cheio.valorCentavos, 36000, 'desligado, volta o valor do contrato');
});

/* ---------------- planos Bronze / Prata / Gold do catálogo ---------------- */

test('os planos do catalogo viram ofertas com o preco de la; semestral com o desconto de la', () => {
  const todas = C.todasOfertas();
  const prata = todas.find((o) => o.code === 'whats-prata');
  assert.ok(prata, 'whats-prata do catalogo aparece como oferta');
  assert.equal(prata.mensal, 12900);
  assert.equal(prata.semestralMensal, Math.round(12900 * 0.9));
  assert.equal(prata.liberacoes.operadores, 3);
  assert.equal(prata.liberacoes.auditor, true);
  assert.equal(todas.filter((o) => o.catalogo).length, 12, '4 modulos (WhatsApp, Telegram, Redes, Combo) x Bronze/Prata/Gold');
  assert.equal(todas.find((o) => o.code === 'telegram-prata')?.nome, 'Telegram Prata');
  assert.equal(O.precoDe({ produtos: ['combo-bronze'], ciclo: 'semestral' }).total, Math.round(11900 * 0.9) * 6);
  assert.equal(O.precoDe({ produtos: ['combo-bronze'], ciclo: 'anual' }).ok, false, 'catalogo nao tem anual: recusa em vez de inventar preco');
});

test('checkout de plano do catalogo: contrato semestral no valor certo, 6x no cartao', async () => {
  const x = await C.iniciarCheckout(dadosCk({ nome: 'Rui Prata', documento: '98765432100', whatsapp: '31911110000', produtos: ['whats-prata'], ciclo: 'semestral' }), { imprimir });
  assert.equal(x.ok, true, x.motivo);
  assert.equal(x.contrato.valorCiclo, Math.round(12900 * 0.9) * 6);
  let pedido;
  await C.cartaoCheckout(x.clienteId, { cartao: { token: 't', parcelas: 12 }, assinar, pagarCartao: async (e) => { pedido = e; return { ok: true, aprovado: false, emAnalise: true, mensagem: 'em análise', pagamento: { id: 'c-s' } }; } });
  assert.equal(pedido.parcelas, 6, 'semestral parcela no maximo em 6');
  const html = montarContrato({ cliente: C.obter(x.clienteId), preco: O.precoDe(C.obter(x.clienteId)), numero: 'T' }).replace(/ /g, ' ');
  assert.ok(html.includes('6 (seis) meses'));
  assert.ok(html.includes('WhatsApp Prata'));
});

/* ---------------- página pública de assinatura ---------------- */

test('publico: CPF ja cadastrado com OUTRO WhatsApp e recusado — nao da pra desviar a chave de alguem', async () => {
  const r = await C.iniciarCheckout(dadosCk({ nome: 'Golpista', whatsapp: '31900000000' }), { imprimir, publico: true });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /outro WhatsApp/);
  assert.equal(C.obter(ck.clienteId).whatsapp, '5531944443333', 'o numero do cliente nao mudou');
  assert.equal(C.obter(ck.clienteId).nome, 'Carla Checkout');
});

test('publico: assinante voltando NAO assina de novo — recebe a tela de trocar plano / adendo, e nada muda', async () => {
  const antes = C.obter(ck.clienteId);
  const r = await C.iniciarCheckout(dadosCk({ nome: 'Outro Nome Qualquer', whatsapp: '(31) 94444-3333', produtos: ['redes-micro'] }), { imprimir, publico: true });
  assert.equal(r.ok, false);
  assert.equal(r.jaAssinante, true);
  assert.ok(r.assinante.atual.validaAte);
  const depois = C.obter(ck.clienteId);
  assert.equal(depois.nome, 'Carla Checkout');
  assert.deepEqual(depois.produtos, antes.produtos, 'o plano dele nao foi trocado por cima');
  assert.equal(depois.licencas.length, antes.licencas.length, 'nenhuma validade somada');
});

test('senha de uso unico do checkout: confere a certa, recusa errada, vazia e a de outra tentativa', async () => {
  const semLicenca = dadosCk({ nome: 'Sem Licenca Ainda', documento: '15350946056', whatsapp: '31988880000' });
  const a = await C.iniciarCheckout(semLicenca, { imprimir });
  assert.equal(C.conferirAcessoCheckout(a.clienteId, a.acesso), true);
  assert.equal(C.conferirAcessoCheckout(a.clienteId, 'chute'), false);
  assert.equal(C.conferirAcessoCheckout(a.clienteId, ''), false);
  const b = await C.iniciarCheckout(semLicenca, { imprimir });
  assert.equal(C.conferirAcessoCheckout(a.clienteId, a.acesso), false, 'nova tentativa invalida a senha anterior');
  assert.equal(C.conferirAcessoCheckout(b.clienteId, b.acesso), true);
});


/* ---------------- troca de plano e adendo ---------------- */

test('credito proporcional e regra da troca: maior paga a diferenca, menor agenda', () => {
  const c = O.creditoRestante({ pagoCentavos: 7900, emitidaEm: '2026-09-01T00:00:00Z', validaAte: '2026-10-01T00:00:00Z', em: '2026-09-21T00:00:00Z' });
  assert.equal(c, Math.floor(7900 * 10 / 30));
  assert.deepEqual(O.avaliarTroca({ valorNovoCiclo: 12900, valorAtualCiclo: 7900, creditoCentavos: c, mesmoPlano: false }), { tipo: 'upgrade', valorCentavos: 12900 - c, creditoCentavos: c });
  assert.equal(O.avaliarTroca({ valorNovoCiclo: 5900, valorAtualCiclo: 7900, creditoCentavos: 100, mesmoPlano: false }).tipo, 'downgrade', 'plano mais barato e downgrade mesmo com pouco credito');
  assert.equal(O.avaliarTroca({ valorNovoCiclo: 12900, valorAtualCiclo: 7900, creditoCentavos: 12900, mesmoPlano: false }).valorCentavos, 100, 'upgrade nunca sai de graca: minimo R$ 1');
  assert.equal(O.avaliarTroca({ valorNovoCiclo: 1, creditoCentavos: 0, mesmoPlano: true }).tipo, 'mesmo');
  assert.equal(O.valorAdendoProporcional({ mensalCentavos: 1990, validaAte: '2026-10-01T00:00:00Z', em: '2026-09-16T00:00:00Z' }), Math.round(1990 * 15 / 30));
});

let assinante;
async function novoAssinante(plano, doc, wa) {
  const x = await C.iniciarCheckout(dadosCk({ nome: 'Tiago Troca', documento: doc, whatsapp: wa, produtos: [plano], ciclo: 'mensal' }), { imprimir });
  assert.equal(x.ok, true, x.motivo);
  const r = await C.cartaoCheckout(x.clienteId, { cartao: { token: 't' }, assinar, enviar: whats(),
    pagarCartao: async (e) => ({ ok: true, aprovado: true, mensagem: 'ok', pagamento: { id: 'p-' + e.referencia } }) });
  assert.equal(r.aprovado, true);
  return x.clienteId;
}

test('troca para plano MAIOR: paga so a diferenca, e o plano so muda quando o pagamento entra', async () => {
  const id = await novoAssinante('whats-bronze', '24681357928', '31955550001');
  assinante = id;
  const t = await C.iniciarCheckout(dadosCk({ documento: '24681357928', whatsapp: '31955550001', produtos: ['whats-prata'], ciclo: 'mensal', troca: true }), { imprimir, publico: true });
  assert.equal(t.ok, true, t.motivo);
  assert.equal(t.pedido.tipo, 'troca');
  assert.ok(t.pedido.creditoCentavos > 7800, 'acabou de pagar: credito ~ valor pago');
  assert.equal(t.cobrar.valorCentavos, 12900 - t.pedido.creditoCentavos);
  assert.deepEqual(C.obter(id).produtos, ['whats-bronze'], 'antes de pagar, segue no plano antigo');
  const chaveAntiga = C.obter(id).licencas.at(-1).codigo;
  let cobrado;
  const r = await C.cartaoCheckout(id, { cartao: { token: 't' }, assinar, enviar: whats(),
    pagarCartao: async (e) => { cobrado = e.valorCentavos; return { ok: true, aprovado: true, mensagem: 'ok', pagamento: { id: 'p-troca' } }; } });
  assert.equal(r.aprovado, true, r.motivo);
  assert.equal(cobrado, t.cobrar.valorCentavos);
  const c = C.obter(id);
  assert.deepEqual(c.produtos, ['whats-prata']);
  assert.equal(c.liberacoes.operadores, 3, 'liberou o do Prata');
  assert.ok(c.licencas.find((l) => l.codigo === chaveAntiga).revogadaEm, 'chave antiga saiu');
  const dias = (new Date(C.listar().find((x) => x.id === id).licencaVigente.validaAte) - Date.now()) / 86400000;
  assert.ok(dias > 27 && dias < 32, 'ciclo novo comeca hoje, sem somar o antigo');
});

test('troca para plano MENOR: agendada pro fim do ciclo, nada cobrado, nada muda agora', async () => {
  const r = await C.iniciarCheckout(dadosCk({ documento: '24681357928', whatsapp: '31955550001', produtos: ['whats-bronze'], ciclo: 'mensal', troca: true }), { imprimir, publico: true });
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.agendada, true);
  const c = C.obter(assinante);
  assert.deepEqual(c.produtos, ['whats-prata']);
  assert.equal(c.trocaAgendada.para, 'whats-bronze');
  const mesmo = await C.iniciarCheckout(dadosCk({ documento: '24681357928', whatsapp: '31955550001', produtos: ['whats-prata'], ciclo: 'mensal', troca: true }), { imprimir, publico: true });
  assert.match(mesmo.motivo, /já é o seu plano/);
});

test('adendo: atendente extra cobra o proporcional, amplia o liberado, mantem a validade e entra na renovacao', async () => {
  const antes = C.listar().find((x) => x.id === assinante).licencaVigente;
  const a = C.iniciarAdendo({ documento: '24681357928', whatsapp: '31955550001', code: 'atendente-extra', qtd: 2 }, { publico: true });
  assert.equal(a.ok, true, a.motivo);
  assert.equal(a.pedido.mensalCentavos, 1990 * 2);
  assert.ok(a.cobrar.valorCentavos <= 1990 * 2 + 200 && a.cobrar.valorCentavos >= 100);
  assert.equal(C.iniciarAdendo({ documento: '24681357928', whatsapp: '31900000000', code: 'atendente-extra' }, { publico: true }).ok, false, 'WhatsApp de outra pessoa nao contrata');
  const r = await C.cartaoCheckout(assinante, { cartao: { token: 't', parcelas: 6 }, assinar, enviar: whats(),
    pagarCartao: async (e) => { assert.equal(e.parcelas, 1, 'adendo nao parcela'); return { ok: true, aprovado: true, mensagem: 'ok', pagamento: { id: 'p-ad' } }; } });
  assert.equal(r.aprovado, true, r.motivo);
  const c = C.obter(assinante);
  assert.equal(c.liberacoes.operadores, 5, '3 do Prata + 2 extras');
  assert.equal(c.adendos[0].qtd, 2);
  assert.equal(C.listar().find((x) => x.id === assinante).licencaVigente.validaAte, antes.validaAte, 'mesma validade');
  assert.equal(O.precoDe(c).mensal, 12900 + 3980, 'renovacao ja inclui o adendo');
  const sem = C.iniciarAdendo({ documento: '15350946056', whatsapp: '31988880000', code: 'atendente-extra' });
  assert.match(sem.motivo, /assinatura em vigor/);
});

test('credito da chave liberada a mao usa o contrato DELA, nao o de uma troca ainda nao paga', async () => {
  const x = await C.iniciarCheckout(dadosCk({ nome: 'Lia Manual', documento: '47025813680', whatsapp: '31944440002', produtos: ['whats-bronze'], ciclo: 'mensal' }), { imprimir });
  await C.liberarManual(x.clienteId, { motivo: 'pagou por fora', assinar });
  const t1 = await C.iniciarCheckout(dadosCk({ documento: '47025813680', whatsapp: '31944440002', produtos: ['whats-prata'], ciclo: 'mensal', troca: true }), { imprimir, publico: true });
  const t2 = await C.iniciarCheckout(dadosCk({ documento: '47025813680', whatsapp: '31944440002', produtos: ['whats-prata'], ciclo: 'mensal', troca: true }), { imprimir, publico: true });
  assert.ok(t1.pedido.creditoCentavos <= 7900, `credito nao pode passar do Bronze pago (deu ${t1.pedido.creditoCentavos})`);
  assert.equal(t2.pedido.creditoCentavos, t1.pedido.creditoCentavos, 'tentar a troca de novo nao muda o credito');
});

test('pagou e ficou sem acesso: entra na fila de nova entrega ate criar a senha ou um canal entregar', () => {
  const pago = C.listar().find((c) => c.licencaVigente);
  assert.ok(pago, 'a suite ja tem um cliente com chave emitida');
  const semSenha = () => false;
  C.registrarEntregaAcesso(pago.id, { whatsapp: { ok: false, erro: 'No LID for user' }, email: { ok: false, erro: 'SMTP' } });
  assert.ok(C.pendentesDeAcesso({ temSenha: semSenha }).includes(pago.id), 'os dois canais falharam: tem que tentar de novo');
  assert.ok(!C.pendentesDeAcesso({ temSenha: (id) => id === pago.id }).includes(pago.id), 'ja criou a senha: nao manda mais');
  assert.ok(!C.pendentesDeAcesso({ temSenha: semSenha, maxPorDia: 1 }).includes(pago.id), 'teto por dia');
  C.registrarEntregaAcesso(pago.id, { whatsapp: { ok: true }, email: { ok: false, erro: 'SMTP' } });
  assert.ok(!C.pendentesDeAcesso({ temSenha: semSenha }).includes(pago.id), 'um canal entregou: sai da fila');
});

test('reenvio de acesso so acha assinatura em VIGOR pelo e-mail, sem diferenciar maiusculas', () => {
  const pago = C.listar().find((c) => c.licencaVigente && c.email);
  assert.ok(pago, 'a suite ja tem assinante com e-mail');
  assert.equal(C.assinantePorEmail(pago.email.toUpperCase())?.id, pago.id);
  assert.equal(C.assinantePorEmail('ninguem@example.com'), null);
  assert.equal(C.assinantePorEmail(''), null);
});

test('quem nunca recebeu convite NAO entra na fila automatica — cliente antigo e decisao de gente', () => {
  const nunca = C.listar().find((c) => c.licencaVigente && !(c.historico || []).some((h) => h.o === 'convite de acesso'));
  if (!nunca) { return; }
  assert.ok(!C.pendentesDeAcesso({ temSenha: () => false }).includes(nunca.id));
});
