/**
 * Hub multi-tenant do salão (22/10): o webhook do Evolution cai no bot do SALÃO
 * (não na Micaela), e cada CNPJ é isolado — a mensagem da instância do cliente A
 * usa o Cadê Você e o Evolution do A, nunca do B. Instância desconhecida é ignorada.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { receberWebhook, esquecer } from '../engine/vssalao/hub.mjs';
import { comEmpresa } from '../engine/casa.mjs';
const hotel = await import('../engine/vs0007/bots.mjs');

//* casa temporária com dois tenants, cada um com sua config de salão. */
const casa = mkdtempSync(join(tmpdir(), 'cadevc-hub-'));
process.env.VS_HOME = casa;
delete process.env.VSCRM_DIR;
delete process.env.EVOLUTION_INSTANCE; delete process.env.CADEVC_URL; delete process.env.CADEVC_TOKEN;
function respostaPesquisa(html, status = 200, location = '') {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (nome) => nome.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8'
        : nome.toLowerCase() === 'location' ? location : null,
    },
    text: async () => html,
  };
}
function fetchPesquisaInicial() {
  const fontes = [
    { url: 'https://manicure.gov.br/padroes', titulo: 'Manicure — orientação oficial' },
    { url: 'https://blog.exemplo.com/manicure/boas-praticas', titulo: 'Manicure — boas práticas' },
    { url: 'https://forum.exemplo.com/manicure/duvidas', titulo: 'Manicure — dúvidas da comunidade' },
  ];
  return async (url) => {
    const pagina = new URL(url);
    if (pagina.hostname === 'r.jina.ai') {
      return respostaPesquisa(fontes.map((fonte, i) =>
        `[${fonte.titulo}](https://www.google.com/goto?url=${i})\n\nOrientações úteis de manicure e práticas recomendadas.`,
      ).join('\n\n'));
    }
    if (pagina.hostname === 'www.google.com' && pagina.pathname === '/goto') {
      const fonte = fontes[Number(pagina.searchParams.get('url'))];
      return fonte ? respostaPesquisa('', 302, fonte.url) : respostaPesquisa('', 404);
    }
    const fonte = fontes.find((item) => new URL(item.url).hostname === pagina.hostname);
    if (!fonte) return respostaPesquisa('', 404);
    const conteudo = 'Manicure deve confirmar os horários e explicar os serviços conforme as orientações desta fonte.';
    return respostaPesquisa(`<html><head><title>${fonte.titulo}</title><meta name="description" content="${conteudo}"></head><body><p>${conteudo}</p></body></html>`);
  };
}
function seedTenant(cnpj, inst, evoBase, cvBase) {
  const dir = join(casa, 'empresas', cnpj, 'vscadevc');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({
    evolutionUrl: evoBase, evolutionKey: 'k-' + cnpj, evolutionInstance: inst,
    cadevcUrl: cvBase, cadevcToken: 'tok-' + cnpj, nomeBot: 'Micaela', personalidade: 'direto',
  }));
}
// AJUSTADO: Agora o ambiente de simulação sabe onde a Evolution real está escutando
seedTenant('11111111000199', 'inst-A', 'http://127.0.0.1:8085', 'http://127.0.0.1:8085');
seedTenant('22222222000188', 'inst-B', 'http://evoB', 'http://cvB');

//seedTenant('22222222000188', 'inst-B', 'http://evoB', 'http://cvB');

/* rede falsa: registra cada chamada; connectionState = open pra poder responder. */
function fakeNet() {
  const log = [];
  const fetch = async (url, o = {}) => {
    log.push({ url, method: o.method || 'GET', body: o.body });
    const ok = (j) => ({ ok: true, status: 200, json: async () => j });
    if (url.includes('/instance/connectionState/')) { return ok({ instance: { state: 'open' } }); }
    if (url.includes('/message/sendText/')) { return ok({ key: { id: 'E1' } }); }
    if (url.includes('/instance/')) { return ok({}); }
    return ok({});   // cadevc: o "oi" não chama a agenda
  };
  return { fetch, log };
}
const upsert = (inst, texto, id = 'm1') => ({ event: 'messages.upsert', instance: inst,
  data: { key: { remoteJid: '5531988887777@s.whatsapp.net', fromMe: false, id }, pushName: 'Ana', messageTimestamp: Math.floor(Date.now() / 1000), message: { conversation: texto } } });

test('"oi" na instância do A cai no bot do salão e responde pelo Evolution do A', async () => {
  esquecer(); const net = fakeNet();
  const r = receberWebhook(upsert('inst-A', 'oi'), { fetch: net.fetch, cerebro: { ligado: false } });
  assert.equal(r.ok, true); assert.equal(r.tenant, '11111111000199'); assert.equal(r.mensagens, 1);
  await new Promise((res) => setTimeout(res, 50));   // o aoReceber é async
  const send = net.log.find((c) => c.method === 'POST' && c.url.includes('/message/sendText/inst-A'));
  assert.ok(send, 'tinha que mandar resposta pela instância A');
  assert.match(JSON.parse(send.body).text, /Sou Micaela\. Quer agendar, cancelar ou encerrar/);
  assert.match(JSON.parse(send.body).text, /Agendar horário/);              // é o bot do SALÃO, não a Micaela
  assert.ok(!net.log.some((c) => c.url.includes('evoB')), 'não pode encostar no Evolution do B');
});

test('a instância do B vai pro tenant B (isolado)', async () => {
  esquecer(); const net = fakeNet();
  const r = receberWebhook(upsert('inst-B', 'oi'), { fetch: net.fetch, cerebro: { ligado: false } });
  assert.equal(r.tenant, '22222222000188');
  await new Promise((res) => setTimeout(res, 50));
  assert.ok(net.log.some((c) => c.url.includes('/message/sendText/inst-B')));
  assert.ok(!net.log.some((c) => c.url.includes('evoA')), 'B não pode usar o Evolution do A');
});

test('troca de instância invalida só o cache do tenant alterado', async () => {
  esquecer();
  const net = fakeNet();
  receberWebhook(upsert('inst-A', 'oi', 'antes-da-troca'), { fetch: net.fetch, cerebro: { ligado: false } });
  await new Promise((res) => setTimeout(res, 50));
  try {
    seedTenant('11111111000199', 'inst-A2', 'http://127.0.0.1:8085', 'http://127.0.0.1:8085');
    esquecer('11111111000199');
    const r = receberWebhook(upsert('inst-A2', 'oi', 'depois-da-troca'), { fetch: net.fetch, cerebro: { ligado: false } });
    assert.equal(r.tenant, '11111111000199');
    await new Promise((res) => setTimeout(res, 50));
    assert.ok(net.log.some((c) => c.url.includes('/message/sendText/inst-A2')));
  } finally {
    seedTenant('11111111000199', 'inst-A', 'http://127.0.0.1:8085', 'http://127.0.0.1:8085');
    esquecer();
  }
});

test('instância desconhecida é ignorada (não cria tenant nem responde)', () => {
  esquecer(); const net = fakeNet();
  const r = receberWebhook(upsert('inst-fantasma', 'oi'), { fetch: net.fetch });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /desconhecida/);
});

test('bot desligado não responde mensagens do salão', async () => {
  esquecer();
  const caminho = join(casa, 'empresas', '11111111000199', 'vscadevc', 'config.json');

  // AJUSTADO: Se o teste reescrever o arquivo, ele mantém o IP local correto!
  writeFileSync(caminho, JSON.stringify({
    evolutionUrl: 'http://127.0.0.1:8085',
    evolutionKey: 'k-11111111000199',
    evolutionInstance: 'inst-A',
    cadevcUrl: 'http://127.0.0.1:8085',
    cadevcToken: 'tok-11111111000199',
    ativo: false // O objetivo do teste é validar este "false"
  }));

  try {
    const net = fakeNet();
    const r = receberWebhook(upsert('inst-A', 'oi', 'bot-desligado'), {
      fetch: net.fetch,
      cerebro: { ligado: false }
    });

    assert.equal(r.ok, true);
    await new Promise((res) => setTimeout(res, 50));

    assert.ok(
      !net.log.some((c) =>
        c.method === 'POST' && c.url.includes('/message/sendText/inst-A')
      ),
      'o bot desligado não pode enviar respostas'
    );
  } finally {
    // AJUSTADO: O bloco finally (que limpa o teste) também deve apontar para a porta certa
    seedTenant('11111111000199', 'inst-A', 'http://127.0.0.1:8085', 'http://127.0.0.1:8085');
    esquecer();
  }
});

test('perfil homologado do 0007 orienta o Salão e deixa de responder se voltar à validação', async () => {
  esquecer();
  const cnpj = '11111111000199';
  const configPath = join(casa, 'empresas', cnpj, 'vscadevc', 'config.json');
  const configAnterior = readFileSync(configPath, 'utf8');
  const agenteId = await comEmpresa(cnpj, async () => {
    const proposta = hotel.prepararNicho({ nicho: 'manicure' });
    const criado = hotel.criarBotComercial({
      nome: 'Nina',
      finalidade: proposta.finalidade,
      especialidade: `${proposta.especialidade} teste runtime`,
      profissao: proposta.profissao.id,
      autorizado: true,
      falhas: proposta.falhas,
      lacunas: proposta.lacunas,
      conhecimentos: proposta.conhecimentos,
      preparacao: proposta,
      perfil: {
        ...proposta.perfil,
        mensagemInicial: 'Oi! Sou {nome} e vou ajudar com o salão.',
        mensagemFallback: 'Não entendi. Escolha uma opção abaixo.',
        regrasAdicionais: ['Confirme o horário com o cliente antes de reservar.'],
      },
    });
    const pesquisa = await hotel.pesquisarERegistrarPreparacaoInicial({
      agenteId: criado.bot.agenteId,
      autorizado: true,
      fetch: fetchPesquisaInicial(),
      curl: async () => '',
    });
    (await import('../engine/vssalao/ias.mjs')).salvarDadosSistema(criado.bot.agenteId, { url: 'http://x', token: 't' });
    assert.equal(pesquisa.erro, undefined);
    const validacao = hotel.validarBot({
      agenteId: criado.bot.agenteId,
      autorizado: true,
      confirmado: true,
      lacunasConfirmadas: criado.bot.lacunas,
    });
    assert.equal(validacao.ok, true);
    assert.equal(validacao.homologado, true);
    const homologacao = hotel.homologarBot({
      agenteId: criado.bot.agenteId,
      autorizado: true,
      aprovado: true,
    });
    assert.equal(homologacao.homologado, true);
    return criado.bot.agenteId;
  });
  const config = JSON.parse(configAnterior);
  config.bot0007Id = agenteId;
  writeFileSync(configPath, JSON.stringify(config));
  try {
    const net = fakeNet();
    let payload;
    const ollama = async (_url, options) => {
      payload = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => ({ message: { content: JSON.stringify({ opcao: 'nenhuma' }) } }) };
    };
    receberWebhook(upsert('inst-A', 'oi', 'perfil-0007'), {
      fetch: net.fetch,
      cerebro: { ligado: true, fetch: ollama },
    });
    await new Promise((res) => setTimeout(res, 50));
    const envio = net.log.find((item) => item.method === 'POST' && item.url.includes('/message/sendText/inst-A'));
    assert.match(JSON.parse(envio.body).text, /Oi! Sou Nina e vou ajudar com o salão/);
    assert.match(payload.messages[1].content, /Confirme o horário com o cliente antes de reservar/);
    assert.match(payload.messages[1].content, /manicure/);

    comEmpresa(cnpj, () => hotel.atualizarPerfilBot({
      agenteId,
      nome: 'Nina',
      autorizado: true,
      perfil: {
        ...hotel.obterBot(agenteId).perfil,
        persona: 'Perfil alterado e ainda não revisado.',
      },
    }));
    esquecer(cnpj);
    const enviosAntes = net.log.filter((item) => item.method === 'POST' && item.url.includes('/message/sendText/inst-A')).length;
    receberWebhook(upsert('inst-A', 'oi', 'perfil-pendente'), { fetch: net.fetch, cerebro: { ligado: false } });
    await new Promise((res) => setTimeout(res, 50));
    const enviosDepois = net.log.filter((item) => item.method === 'POST' && item.url.includes('/message/sendText/inst-A')).length;
    assert.equal(enviosDepois, enviosAntes, 'perfil em validação não pode responder pelo canal');
  } finally {
    writeFileSync(configPath, configAnterior);
    esquecer();
  }
});
