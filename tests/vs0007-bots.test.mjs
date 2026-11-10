/**
 * Fábrica de Modelos e Hotel dos Bots (missão 0007): criação, derivação pelas
 * deusas, homologação e instâncias — com autorização no centro de tudo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load, save } from '../engine/vscrm/store.mjs';

const casa = mkdtempSync(join(tmpdir(), 'hotel-bots-'));
process.env.VSCRM_DIR = join(casa, 'vscrm');
process.on('exit', () => { try { rmSync(casa, { recursive: true, force: true }); } catch { /* ja foi */ } });

const bots = await import('../engine/vs0007/bots.mjs');
const mapa = await import('../engine/vs0007/mapa.mjs');
const R = await import('../engine/vs0007/regras.mjs');

function respostaHtml(html) {
  return {
    status: 200,
    ok: true,
    headers: { get: (nome) => (nome.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
    text: async () => html,
  };
}

function respostaJson(valor) {
  return {
    status: 200,
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => valor,
  };
}

function respostaRedirecionada(localizacao) {
  return {
    status: 302,
    ok: false,
    headers: {
      get: (nome) => (nome.toLowerCase() === 'location' ? localizacao : null),
    },
  };
}

function fetchDePesquisa(especialidade, { incompleta = false, buscaBloqueada = false } = {}) {
  const slug = especialidade.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const fontes = [
    { url: `https://turismo.gov.br/${slug}/padroes`, titulo: `${especialidade} — padrões oficiais`, tipo: 'site oficial' },
    { url: `https://especialista.example.com/blog/${slug}`, titulo: `${especialidade} — boas práticas`, tipo: 'blog especializado' },
    { url: `https://forum.example.com/${slug}/duvidas`, titulo: `${especialidade} — discussão técnica`, tipo: 'comunidade profissional' },
  ].slice(0, incompleta ? 1 : 3);
  const resultados = `# Search Results\n\n${fontes.map((fonte, indice) =>
    `[${fonte.titulo}](https://www.google.com/goto?url=${indice})\n\n${fonte.tipo} com orientações de ${especialidade} e procedimentos recomendados.`,
  ).join('\n\n')}`;
  const fetch = async (url) => {
    const pagina = new URL(url);
    if (pagina.hostname === 'r.jina.ai') {
      if (buscaBloqueada) throw new Error('busca nativa bloqueada');
      return respostaHtml(resultados);
    }
    if (pagina.hostname === 'www.google.com' && pagina.pathname === '/goto') {
      const fonte = fontes[Number(pagina.searchParams.get('url'))];
      if (!fonte) return { ...respostaHtml(''), status: 404, ok: false };
      return respostaRedirecionada(fonte.url);
    }
    const fonte = fontes.find((item) => new URL(item.url).hostname === pagina.hostname);
    if (!fonte) return { ...respostaHtml(''), status: 404, ok: false };
    const conteudo = `${especialidade} deve ser atendida conforme os procedimentos descritos nesta fonte especializada.`;
    return respostaHtml(`<html><head><title>${fonte.titulo}</title><meta name="description" content="${conteudo}"></head><body><p>${conteudo}</p></body></html>`);
  };
  let chamadasCurl = 0;
  return {
    fetch,
    curl: async () => { chamadasCurl += 1; return resultados; },
    chamadasCurl: () => chamadasCurl,
  };
}

async function concluirPesquisa(agenteId) {
  const bot = bots.obterBot(agenteId);
  const dependencias = fetchDePesquisa(bot.especialidade);
  return bots.pesquisarERegistrarPreparacaoInicial({
    agenteId,
    autorizado: true,
    ...dependencias,
  });
}

function fetchDePesquisaEmpresarial(especialidade) {
  const cnpj = '11222333000181';
  const buscaProfissao = fetchDePesquisa(especialidade);
  const chamadas = [];
  const fetch = async (url, opcoes) => {
    chamadas.push(url);
    const pagina = new URL(url);
    if (pagina.hostname === 'brasilapi.com.br') {
      return respostaJson({
        cnpj,
        razao_social: 'Mercado Sol Nascente LTDA',
        nome_fantasia: 'Mercado Sol Nascente',
        descricao_situacao_cadastral: 'ATIVA',
        municipio: 'Belo Horizonte',
        uf: 'MG',
        cnae_fiscal_descricao: 'Comércio varejista de alimentos',
        cnaes_secundarios: [{ descricao: 'Entrega de produtos' }],
        porte: 'ME',
        data_inicio_atividade: '2021-06-01',
        qsa: [{ nome_socio: 'Dado pessoal que não deve ser incorporado' }],
      });
    }
    if (pagina.hostname === 'r.jina.ai' && /Mercado\s+Sol\s+Nascente/i.test(decodeURIComponent(pagina.search))) {
      return respostaHtml('[Mercado Sol Nascente — site da empresa](https://www.google.com/goto?url=empresa)\n\nMercado Sol Nascente em Belo Horizonte apresenta seus produtos e atendimento.');
    }
    if (pagina.hostname === 'www.google.com' && pagina.pathname === '/goto' && pagina.searchParams.get('url') === 'empresa') {
      return respostaRedirecionada('https://mercadosol.example.com/sobre');
    }
    if (pagina.hostname === 'mercadosol.example.com') {
      return respostaHtml('<html><head><title>Mercado Sol Nascente</title><meta name="description" content="Mercado Sol Nascente em Belo Horizonte vende alimentos e oferece entrega local."></head><body><p>Mercado Sol Nascente atende Belo Horizonte com comércio varejista e entrega de alimentos para seus clientes.</p></body></html>');
    }
    return buscaProfissao.fetch(url, opcoes);
  };
  return { cnpj, chamadas, fetch, curl: buscaProfissao.curl };
}

test('criar bot comercial exige autorizacao do criador e nasce em preparacao', async () => {
  const sem = bots.criarBotComercial({ finalidade: 'Restaurante de hambúrguer', especialidade: 'Hamburgueria e lanchonete' });
  assert.ok(sem.erro, 'sem autorizacao nao cria');
  const cri = bots.criarBotComercial({ nome: 'Atendente Hamburgueria', finalidade: 'Restaurante de hambúrguer', especialidade: 'Hamburgueria e lanchonete', autorizado: true });
  assert.equal(cri.erro, undefined);
  assert.equal(cri.bot.nome, 'Atendente Hamburgueria');
  assert.equal(cri.bot.finalidade, 'Restaurante de hambúrguer');
  assert.equal(cri.bot.estado, 'em_preparacao');
  assert.ok(cri.noId, 'a criacao grava o no no mapa mental');
  const nos = (await mapa.obterNos(cri.bot.agenteId)).nos;
  assert.equal(nos.length, 11, 'identidade, objetivo, limites, regras e mensagens entram no mapa');
  assert.equal(nos[0].estado, 'descoberto');
  assert.ok(nos.every((no) => no.estado === 'descoberto'));
  assert.equal(cri.bot.preparacao.pesquisaInicial.estado, 'pendente');
  assert.equal(cri.bot.perfil.funcao, 'Hamburgueria e lanchonete');
  assert.ok(cri.bot.perfil.objetivoPrincipal);
  assert.ok(cri.bot.perfil.limitesAtuacao);
  assert.equal(cri.bot.cicloVida.preparacaoConhecimentoInicial.estado, 'pendente');
  assert.equal(Date.parse(cri.bot.cicloVida.preparacaoConhecimentoInicial.prazoIdealEm) - Date.parse(cri.bot.criadoEm), 12 * 60 * 60 * 1000);
  assert.equal(Date.parse(cri.bot.cicloVida.preparacaoConhecimentoInicial.prazoMaximoEm) - Date.parse(cri.bot.criadoEm), 24 * 60 * 60 * 1000);
  const validacaoPendente = bots.validarBot({ agenteId: cri.bot.agenteId, autorizado: true, confirmado: true });
  assert.match(validacaoPendente.erro, /pesquisa externa/i);
  assert.equal(bots.homologarBot({ agenteId: cri.bot.agenteId, autorizado: true, aprovado: true }).homologado, false);
});

test('preparação personalizada pesquisa profissão e dados empresariais públicos sem quadro societário', async () => {
  const pesquisa = fetchDePesquisaEmpresarial('mercado');
  const criado = bots.criarBotComercial({
    nome: 'Atendente do Mercado Sol Nascente',
    finalidade: 'Atender clientes do mercado',
    especialidade: 'mercado',
    empresaCnpj: pesquisa.cnpj,
    autorizado: true,
  });
  assert.equal(criado.erro, undefined);
  const resultado = await bots.pesquisarERegistrarPreparacaoInicial({
    agenteId: criado.bot.agenteId,
    autorizado: true,
    ...pesquisa,
  });
  assert.equal(resultado.erro, undefined, JSON.stringify(resultado));
  assert.equal(resultado.bot.empresaCnpj, pesquisa.cnpj);
  assert.equal(resultado.bot.preparacao.pesquisaInicial.empresa.nomeFantasia, 'Mercado Sol Nascente');
  assert.ok(resultado.bot.preparacao.pesquisaInicial.fontes.some((fonte) => fonte.escopo === 'empresa'),
    JSON.stringify(resultado.bot.preparacao.pesquisaInicial.fontes));
  assert.ok(resultado.bot.preparacao.pesquisaInicial.conhecimentos.some((item) =>
    item.categoria === 'perfil-publico-da-empresa' && /comércio varejista de alimentos/i.test(item.conteudo)));
  assert.ok(!JSON.stringify(resultado.bot.preparacao.pesquisaInicial).includes('Dado pessoal que não deve ser incorporado'));
  assert.ok(pesquisa.chamadas.some((url) => url.includes(`brasilapi.com.br/api/cnpj/v1/${pesquisa.cnpj}`)));
  assert.ok(pesquisa.chamadas.filter((url) => url.includes('r.jina.ai') || url.includes('bing.com')).every((url) => !url.includes(pesquisa.cnpj)),
    'CNPJ não é enviado como termo aos buscadores');
});

test('personalização rejeita CPF pessoal e não conclui a preparação sem CNPJ', async () => {
  const cpf = bots.criarBotComercial({
    nome: 'Bot CPF',
    finalidade: 'Atender',
    especialidade: 'mercado',
    empresaCnpj: '05485368646',
    autorizado: true,
  });
  assert.match(cpf.erro, /CNPJ válido/i);
});

test('preparação inicial pesquisa fontes externas e mantém o conhecimento como descoberta', async () => {
  const criado = bots.criarBotComercial({
    nome: 'Atendente de teste',
    finalidade: 'Atender com segurança',
    especialidade: 'Especialidade de teste',
    autorizado: true,
  });
  const dependencias = fetchDePesquisa(criado.bot.especialidade);
  const negada = await bots.pesquisarERegistrarPreparacaoInicial({
    agenteId: criado.bot.agenteId,
    ...dependencias,
  });
  assert.match(negada.erro, /autorização/i);
  const buscaIncompleta = fetchDePesquisa(criado.bot.especialidade, { incompleta: true });
  const incompleta = await bots.pesquisarERegistrarPreparacaoInicial({
    agenteId: criado.bot.agenteId,
    autorizado: true,
    ...buscaIncompleta,
  });
  assert.match(incompleta.erro, /três fontes relevantes/i);
  assert.equal(bots.obterBot(criado.bot.agenteId).preparacao.pesquisaInicial.estado, 'pendente');
  const registrada = await concluirPesquisa(criado.bot.agenteId);
  assert.equal(registrada.ok, true);
  assert.equal(registrada.bot.preparacao.pesquisaInicial.estado, 'concluida');
  assert.ok(registrada.relatorio.fontesRegistradas.length >= 3);
  assert.ok(registrada.relatorio.conhecimentosIniciais.length >= 3);
  assert.match(registrada.relatorio.limitacoes.join(' '), /não foi validado por uma pessoa/i);
  assert.ok(registrada.bot.preparacao.pesquisaInicial.conhecimentos.every((item) => item.validado === false));
  assert.ok((await mapa.obterNos(criado.bot.agenteId)).nos.every((no) => no.estado === 'descoberto'));

  const criadoComContingencia = bots.criarBotComercial({
    nome: 'Atendente com contingência',
    finalidade: 'Atender com segurança',
    especialidade: 'Hospitalidade',
    autorizado: true,
  });
  const contingencia = fetchDePesquisa(criadoComContingencia.bot.especialidade, { buscaBloqueada: true });
  const pesquisaContingencia = await bots.pesquisarERegistrarPreparacaoInicial({
    agenteId: criadoComContingencia.bot.agenteId,
    autorizado: true,
    ...contingencia,
  });
  assert.equal(pesquisaContingencia.ok, true, JSON.stringify(pesquisaContingencia));
  assert.ok(contingencia.chamadasCurl() > 0);
});

test('modelos antigos sem pesquisa exigem preparação e revalidação antes de novas instâncias', async () => {
  const criado = bots.criarBotComercial({
    nome: 'Modelo legado',
    finalidade: 'Atender com segurança',
    especialidade: 'Especialidade legada',
    autorizado: true,
  });
  const registros = load(bots.DATASET_BOTS, []);
  const legado = registros.find((item) => item.agenteId === criado.bot.agenteId);
  legado.estado = 'homologado';
  legado.validacao = { estado: 'homologado', validado: true, runtime: 'revisao-manual', homologacao: 'homologado' };
  delete legado.preparacao.pesquisaInicial;
  save(bots.DATASET_BOTS, registros);
  save(bots.DATASET_INSTANCIAS, [{ id: 'inst-legado', modeloId: legado.agenteId, status: 'inativo' }]);

  const bloqueada = bots.criarInstancia({ modeloId: legado.agenteId, clienteId: 'cliente', autorizado: true });
  assert.match(bloqueada.erro, /sem preparação inicial/i);
  assert.match(bots.ativarInstancia({ id: 'inst-legado', autorizado: true }).erro, /modelo homologado e preparação inicial/i);
  const pesquisa = await concluirPesquisa(legado.agenteId);
  assert.equal(pesquisa.ok, true);
  assert.equal(pesquisa.bot.estado, 'em_validacao');
  assert.equal(pesquisa.bot.validacao.validado, false);
  assert.ok(bots.criarInstancia({ modeloId: legado.agenteId, clienteId: 'cliente', autorizado: true }).erro);
});

test('o chefe 0007 pesquisa o nicho no catálogo e retorna modelos comerciais relevantes', () => {
  const pesquisa = bots.pesquisarNicho({ nicho: 'hotel e pousada' });
  assert.equal(pesquisa.ok, true);
  assert.equal(pesquisa.pesquisadoPor, '0007');
  assert.equal(pesquisa.nicho, 'hotel e pousada');
  assert.equal(pesquisa.modelos[0].id, 'hotel-pousada');
  assert.equal(pesquisa.encontrouModelo, true);
  assert.ok(pesquisa.modelos[0].passos > 0);
  assert.equal(bots.pesquisarNicho({ nicho: 'hotelaria' }).modelos[0].id, 'hotel-pousada');
  assert.equal(bots.pesquisarNicho({ nicho: 'xx' }).encontrouModelo, false);
});

test('o 0007 prepara o bot pedindo apenas o nicho e usa fontes locais', () => {
  const proposta = bots.prepararNicho({ nicho: 'hamburgueria' });
  assert.equal(proposta.erro, undefined);
  assert.equal(proposta.especialidadeId, 'hamburgueria');
  assert.equal(proposta.profissao.id, 'delivery');
  assert.match(proposta.finalidade, /hamburgueria/i);
  assert.equal(proposta.pesquisaLocal.internetConsultada, false);
  assert.ok(proposta.perfil.persona.includes('{nome}'));

  const generica = bots.prepararNicho({ nicho: 'hidroponia urbana' });
  assert.equal(generica.erro, undefined);
  assert.equal(generica.modeloBase.status, 'sem_modelo_base');
  assert.ok(generica.lacunas.length);
});

test('o nicho de salão prepara funções e permissões limitadas à agenda conectada', () => {
  const proposta = bots.prepararNicho({ nicho: 'barbearia' });
  assert.equal(proposta.especialidadeId, 'cadevc-barbearia');
  assert.ok(proposta.atividades.some((item) => /consultar serviços, profissionais e horários reais/i.test(item)));
  assert.ok(proposta.permissoes.some((item) => /criar ou cancelar agendamento somente após confirmação explícita/i.test(item)));
  assert.ok(proposta.permissoes.some((item) => /alterar catálogo, preços, expediente/i.test(item)));
  assert.ok(proposta.mapaMental.some((item) => item.categoria === 'permissoes' && /agenda conectada/i.test(item.conteudo)));
});

test('o 0007 prepara automaticamente o bot a partir da especialidade e da profissao', () => {
  const proposta = bots.prepararEspecialidade({
    especialidadeId: 'hamburgueria',
    profissao: 'delivery',
    finalidade: 'Receber pedidos e orientar sobre entrega e retirada',
  });
  assert.equal(proposta.erro, undefined);
  assert.equal(proposta.pesquisadoPor, '0007');
  assert.equal(proposta.modeloBase.id, 'hamburgueria');
  assert.equal(proposta.profissao.id, 'delivery');
  assert.ok(proposta.responsabilidades.length);
  assert.ok(proposta.atividades.length);
  assert.ok(proposta.fluxos.length);
  assert.ok(proposta.ferramentas.length);
  assert.ok(proposta.regras.length);
  assert.ok(proposta.permissoes.length);
  assert.ok(proposta.horarios.length);
  assert.ok(proposta.autonomia.length);
  assert.ok(proposta.conhecimentos.length);
  assert.ok(proposta.mapaMental.length);
  assert.ok(proposta.lacunas.length);
  assert.ok(proposta.fontes.some((fonte) => fonte.referencia === 'exemplos/fluxo-hamburgueria.json'));
  assert.equal(proposta.validacao.validado, false);
  assert.equal(proposta.validacao.homologacao, 'pendente');
  assert.ok(proposta.descobertas.every((item) => item.estado === 'descoberto' && item.validado === false));
  assert.match(proposta.notaPesquisa, /pesquisa externa do 0007 ocorre depois/i);
});

test('especialidade sem modelo cria uma estrutura generica e sinaliza lacunas sem homologar', () => {
  const proposta = bots.prepararEspecialidade({
    especialidade: 'Consultoria de energia solar',
    profissao: 'prevendas',
    finalidade: 'Qualificar interessados e agendar conversa comercial',
  });
  assert.equal(proposta.erro, undefined);
  assert.equal(proposta.modeloBase.status, 'sem_modelo_base');
  assert.equal(proposta.modeloBase.passos.length, 0);
  assert.ok(proposta.fluxos.length);
  assert.ok(proposta.lacunas.length);
  assert.equal(proposta.validacao.estado, 'nao_executada');
  assert.equal(proposta.validacao.validado, false);
});

test('editar os campos da preparação atualiza o mapa mental sem deixar dados antigos', () => {
  const proposta = bots.prepararEspecialidade({
    especialidade: 'Consultoria de energia solar',
    profissao: 'prevendas',
    finalidade: 'Qualificar interessados',
  });
  const revisada = bots.revisarPreparacao(proposta, {
    atividades: ['Agendar conversa com especialista.'],
    falhas: ['Integração de agenda indisponível.'],
    lacunas: ['Regiões atendidas e condições comerciais.'],
    mapaMental: proposta.mapaMental,
  });
  assert.ok(revisada.mapaMental.some((item) => item.categoria === 'atividades' && item.conteudo === 'Agendar conversa com especialista.'));
  assert.ok(revisada.mapaMental.some((item) => item.categoria === 'falhas-de-preparacao' && item.conteudo === 'Integração de agenda indisponível.'));
  assert.ok(revisada.mapaMental.some((item) => item.categoria === 'lacunas' && item.conteudo === 'Regiões atendidas e condições comerciais.'));
  assert.ok(revisada.mapaMental.every((item) => item.origem === 'revisao-do-criador'));
});

test('criar bot salva a proposta aprovada e os nos do mapa mental como descobertos', async () => {
  const base = bots.prepararEspecialidade({
    especialidade: 'Comércio de instrumentos musicais',
    profissao: 'vendedora',
    finalidade: 'Orientar a escolha de instrumentos e registrar pedidos',
  });
  const revisada = bots.revisarPreparacao(base, {
    conhecimentos: [{ categoria: 'instrumentos', conteudo: 'Confirmar compatibilidade com a necessidade informada.' }],
    mapaMental: [{ categoria: 'revisao', conteudo: 'Conteúdo revisado pelo criador.' }],
    lacunas: ['Modelos, estoque e preços dependem da empresa.'],
  });
  const criacao = bots.criarBotComercial({
    nome: 'Atendente de instrumentos',
    finalidade: base.finalidade,
    especialidade: base.especialidade,
    profissao: base.profissao.id,
    autorizado: true,
    atividades: revisada.atividades,
    ferramentas: revisada.ferramentas.map((item) => item.nome),
    conhecimentos: revisada.conhecimentos,
    lacunas: revisada.lacunas,
    falhas: revisada.falhas,
    preparacao: revisada,
  });
  assert.equal(criacao.erro, undefined);
  assert.equal(criacao.bot.preparacao.aprovadaPeloCriador, true);
  assert.equal(criacao.bot.validacao.validado, false);
  const nos = (await mapa.obterNos(criacao.bot.agenteId)).nos;
  assert.ok(nos.some((no) => no.categoria === 'revisao'));
  assert.equal(new Set(nos.map((no) => no.id)).size, nos.length);
  assert.ok(nos.every((no) => no.estado === 'descoberto'));
  assert.ok(nos.every((no) => JSON.parse(no.evidencia).validado === false));
});

test('bot criado da proposta nao pode ser homologado sem validar e resolver as lacunas', () => {
  const proposta = bots.prepararEspecialidade({
    especialidade: 'Manutenção de instrumentos musicais',
    profissao: 'suporte',
    finalidade: 'Registrar solicitações de manutenção',
  });
  const criado = bots.criarBotComercial({
    nome: 'Suporte de instrumentos',
    finalidade: proposta.finalidade,
    especialidade: proposta.especialidade,
    autorizado: true,
    falhas: proposta.falhas,
    lacunas: proposta.lacunas,
    conhecimentos: proposta.conhecimentos,
    preparacao: proposta,
  });
  const resultado = bots.homologarBot({
    agenteId: criado.bot.agenteId,
    autorizado: true,
    aprovado: true,
  });
  assert.equal(resultado.homologado, false);
  assert.match(resultado.motivo, /lacunas: [1-9]/);
  assert.equal(bots.obterBot(criado.bot.agenteId).estado, 'em_preparacao');
  assert.ok(mapa.obterNos(criado.bot.agenteId).nos.every((no) => no.estado === 'descoberto'));
});

test('revisão explícita do criador resolve lacunas sem afirmar que houve teste ao vivo', async () => {
  const proposta = bots.prepararNicho({ nicho: 'barbearia' });
  const criado = bots.criarBotComercial({
    nome: 'Atendente do Salão',
    finalidade: proposta.finalidade,
    especialidade: `${proposta.especialidade} com revisão manual`,
    profissao: proposta.profissao.id,
    autorizado: true,
    falhas: proposta.falhas,
    lacunas: proposta.lacunas,
    conhecimentos: proposta.conhecimentos,
    preparacao: proposta,
  });
  await concluirPesquisa(criado.bot.agenteId);
  const semAutorizacao = bots.validarBot({
    agenteId: criado.bot.agenteId,
    confirmado: true,
    lacunasConfirmadas: criado.bot.lacunas,
  });
  assert.match(semAutorizacao.erro, /autorização do criador/i);
  const incompleta = bots.validarBot({
    agenteId: criado.bot.agenteId,
    autorizado: true,
    confirmado: true,
  });
  assert.match(incompleta.erro, /cada lacuna/i);
  const validacao = bots.validarBot({
    agenteId: criado.bot.agenteId,
    autorizado: true,
    confirmado: true,
    lacunasConfirmadas: criado.bot.lacunas,
  });
  assert.equal(validacao.ok, true);
  assert.equal(validacao.bot.validacao.runtime, 'revisao-manual');
  assert.equal(validacao.bot.testado, false);
  assert.equal(validacao.homologado, true, 'homologa automaticamente quando pesquisa, revisão e verificações passam');
  assert.equal(validacao.bot.estado, 'homologado');
  assert.deepEqual(validacao.bot.lacunas, []);
  assert.ok(mapa.obterNos(criado.bot.agenteId).nos.every((no) => no.estado === 'homologado'));
});

test('o 0007 adapta o fluxo de um modelo homologado como fonte aprovada', async () => {
  const base = bots.prepararEspecialidade({
    especialidadeId: 'hotel-pousada',
    profissao: 'recepcionista',
    finalidade: 'Preparar reservas e encaminhar solicitações',
  });
  const criado = bots.criarBotComercial({
    nome: 'Modelo hotel homologável',
    finalidade: base.finalidade,
    especialidade: base.especialidade,
    autorizado: true,
    atividades: base.atividades,
    ferramentas: base.ferramentas.map((item) => item.nome),
    falhas: [],
    lacunas: [],
    conhecimentos: base.conhecimentos,
    preparacao: base,
  });
  await concluirPesquisa(criado.bot.agenteId);
  const registros = load(bots.DATASET_BOTS, []);
  const registro = registros.find((item) => item.agenteId === criado.bot.agenteId);
  registro.validacao.validado = true;
  registro.falhas = [];
  registro.lacunas = [];
  save(bots.DATASET_BOTS, registros);
  const homologado = bots.homologarBot({ agenteId: registro.agenteId, autorizado: true, aprovado: true });
  assert.equal(homologado.homologado, true);

  const adaptada = bots.prepararEspecialidade({
    especialidadeId: 'hotel-pousada',
    profissao: 'recepcionista',
    finalidade: 'Receber hóspedes e apoiar reservas',
  });
  assert.equal(adaptada.modeloBase.status, 'homologado_na_origem');
  assert.equal(adaptada.modeloBase.agenteOrigemId, registro.agenteId);
  assert.equal(adaptada.modeloBase.passos[0].id, base.modeloBase.passos[0].id);
  assert.equal(adaptada.validacao.validado, false);
  assert.ok(adaptada.fontes.some((fonte) => fonte.id === 'modelo-homologado'));
  assert.ok(adaptada.fontes.some((fonte) => fonte.validacao === 'homologado-na-origem' && fonte.id === 'fluxo-base'));
});

test('a deusa so deriva modelo com autorizacao expressa do criador e sem copiar memoria', async () => {
  const negada = bots.registrarModeloDerivado({ deusaId: 'isis', especialidade: 'Cardapio digital' });
  assert.ok(negada.erro, 'derivacao sem autorizacao e negada');
  const derivada = bots.registrarModeloDerivado({ deusaId: 'isis', especialidade: 'Cardapio digital', autorizado: true });
  assert.equal(derivada.erro, undefined);
  assert.equal(derivada.independente, true);
  assert.equal(derivada.modelo.derivadoDe.copiandoMemorias, false, 'o modelo derivado nao copia memoria/privacidade da deusa');
  assert.ok(derivada.modelo.perfil.objetivoPrincipal);
  assert.ok(derivada.modelo.perfil.mensagemInicial);
  assert.ok(derivada.modelo.perfil.mensagemFallback);
  assert.ok(derivada.modelo.perfil.regrasAdicionais.length);
  assert.ok(derivada.modelo.conhecimentos.length);
  assert.equal(derivada.modelo.preparacao.pesquisaInicial.estado, 'pendente');
  assert.ok(derivada.nos.every((no) => no.estado === 'descoberto'));
});

test('homologar exige autorizacao e estado em fluxo; aprovado so com teste sem falhas', async () => {
  const cri = bots.criarBotComercial({ finalidade: 'Academia fitness', especialidade: 'Academia e estudio fitness', autorizado: true });
  const negada = bots.homologarBot({ agenteId: cri.bot.agenteId, noId: cri.noId, autorizado: false, aprovado: true });
  assert.ok(negada.erro, 'homologar sem autorizacao e negado');
  const pendente = bots.homologarBot({ agenteId: cri.bot.agenteId, noId: cri.noId, autorizado: true, aprovado: false, falhas: ['carrinho confuso'] });
  assert.equal(pendente.homologado, false, 'falhas na preparacao -> nao homologa');
  await concluirPesquisa(cri.bot.agenteId);
  const revisao = bots.validarBot({
    agenteId: cri.bot.agenteId,
    autorizado: true,
    confirmado: true,
    lacunasConfirmadas: [],
  });
  assert.equal(revisao.ok, true);
  assert.equal(revisao.homologado, true);
  const aprovada = bots.homologarBot({ agenteId: cri.bot.agenteId, noId: cri.noId, autorizado: true, aprovado: true, falhas: [], lacunas: [] });
  assert.equal(aprovada.erro, undefined);
  assert.equal(aprovada.homologado, true, 'homologação repetida é idempotente');
});

test('a previsão de homologação informa o que ainda falta antes de o chefe homologar', () => {
  const proposta = bots.prepararEspecialidade({
    especialidade: 'Consultoria de energia solar',
    profissao: 'prevendas',
    finalidade: 'Qualificar interessados e agendar conversa comercial',
  });
  assert.equal(proposta.ok, true);
  assert.equal(proposta.previsao.podeHomologarAgora, false, 'proposta nova nunca nasce pronta: falta validar e resolver lacunas');
  assert.equal(proposta.previsao.validacaoConcluida, false);
  assert.ok(proposta.previsao.motivos.length, 'a previsão lista os motivos em aberto');
  const pronto = bots.criarBotComercial({
    nome: 'Atendente de energia solar',
    finalidade: proposta.finalidade,
    especialidade: proposta.especialidade,
    profissao: proposta.profissao.id,
    autorizado: true,
    falhas: proposta.falhas,
    lacunas: proposta.lacunas,
    preparacao: proposta,
  });
  assert.equal(pronto.ok, true);
  assert.equal(pronto.bot.previsao.podeHomologarAgora, false, 'bot recém-criado nasce em homologação pendente');
  const recusada = bots.homologarBot({ agenteId: pronto.bot.agenteId, noId: pronto.noId, autorizado: true, aprovado: true });
  assert.equal(recusada.homologado, false);
  assert.equal(recusada.previsao.podeHomologarAgora, false, 'a resposta de homologação traz a mesma previsão');
});

test('perfil do cartão vai para o mapa e uma edição reabre a validação', async () => {
  const perfil = {
    persona: 'Você é {nome}, cordial e direta.',
    mensagemInicial: 'Oi, sou {nome}. Como posso ajudar?',
    mensagemFallback: 'Vou encaminhar sua dúvida para a equipe.',
    regrasAdicionais: ['Nunca confirme estoque sem consultar o catálogo.'],
  };
  const criado = bots.criarBotComercial({
    nome: 'Lia',
    finalidade: 'Atender clientes de varejo',
    especialidade: 'Loja de instrumentos',
    autorizado: true,
    perfil,
  });
  assert.equal(criado.erro, undefined);
  assert.ok(criado.bot.perfil.regrasAdicionais.includes(perfil.regrasAdicionais[0]));
  assert.ok((await mapa.obterNos(criado.bot.agenteId)).nos.some((no) =>
    no.categoria === 'regras-adicionais' && no.conteudo === perfil.regrasAdicionais[0] && no.estado === 'descoberto'));

  await concluirPesquisa(criado.bot.agenteId);
  const revisao = bots.validarBot({
    agenteId: criado.bot.agenteId,
    autorizado: true,
    confirmado: true,
    lacunasConfirmadas: [],
  });
  assert.equal(revisao.ok, true);
  assert.equal(revisao.homologado, true);
  const homologado = bots.homologarBot({ agenteId: criado.bot.agenteId, autorizado: true, aprovado: true });
  assert.equal(homologado.homologado, true);
  const atualizado = bots.atualizarPerfilBot({
    agenteId: criado.bot.agenteId,
    nome: 'Lia da loja',
    perfil: { ...perfil, persona: 'Você é {nome}, acolhedora e objetiva.' },
    autorizado: true,
  });
  assert.equal(atualizado.erro, undefined);
  assert.equal(atualizado.bot.estado, 'em_validacao');
  assert.equal(atualizado.bot.validacao.validado, false);
  assert.equal(bots.preverHomologacao(atualizado.bot).podeHomologarAgora, false);
  assert.ok((await mapa.obterNos(criado.bot.agenteId)).nos.some((no) =>
    no.categoria === 'personalidade' && no.conteudo === 'Você é {nome}, acolhedora e objetiva.' && no.estado === 'descoberto'));
});

test('foto aceita somente tipos e tamanhos permitidos', () => {
  const criado = bots.criarBotComercial({
    nome: 'Atendente',
    finalidade: 'Atender',
    especialidade: 'Loja de música',
    autorizado: true,
  });
  const invalida = bots.atualizarPerfilBot({
    agenteId: criado.bot.agenteId,
    nome: criado.bot.nome,
    perfil: { ...criado.bot.perfil, foto: 'data:text/html;base64,PHNjcmlwdD4=' },
    autorizado: true,
  });
  assert.match(invalida.erro, /foto invalida/i);
});

test('instancia nasce inativa e so de modelo homologado', async () => {
  const cri = bots.criarBotComercial({
    finalidade: 'Clínica de estética',
    especialidade: 'Salão, barbearia e estética',
    perfil: {
      persona: 'Você é {nome}, atenciosa.',
      mensagemInicial: 'Oi, sou {nome}.',
      mensagemFallback: 'Vou encaminhar.',
      regrasAdicionais: ['Não confirme horário sem consultar a agenda.'],
    },
    autorizado: true,
  });
  const antes = bots.criarInstancia({ modeloId: cri.bot.agenteId, clienteId: '5531900000001' });
  assert.ok(antes.erro, 'modelo em preparacao nao gera instancia');
  await concluirPesquisa(cri.bot.agenteId);
  const revisao = bots.validarBot({
    agenteId: cri.bot.agenteId,
    autorizado: true,
    confirmado: true,
    lacunasConfirmadas: [],
  });
  assert.equal(revisao.ok, true);
  assert.equal(revisao.homologado, true);
  const homologada = bots.homologarBot({ agenteId: cri.bot.agenteId, noId: cri.noId, autorizado: true, aprovado: true });
  assert.equal(homologada.homologado, true);
  const inst = bots.criarInstancia({ modeloId: cri.bot.agenteId, clienteId: '5531900000001', autorizado: true });
  assert.equal(inst.erro, undefined);
  assert.equal(inst.ativa, false, 'toda instancia nasce inativa');
  assert.equal(inst['instancia'].status, 'inativo');
  assert.equal(inst.instancia.configuracoes.perfil.persona, 'Você é {nome}, atenciosa.');
  assert.ok(inst.instancia.configuracoes.perfil.regrasAdicionais.includes('Não confirme horário sem consultar a agenda.'));
  const lig = bots.ativarInstancia({ id: inst['instancia'].id, autorizado: true });
  assert.equal(lig.ok, true);
  assert.equal(lig['instancia'].status, 'ativo');
});

test('o hotel conta totais, homologados, disponiveis e contratados', async () => {
  const p = bots.painel();
  assert.equal(typeof p.totais.total, 'number');
  assert.equal(typeof p.totais.emPreparacao, 'number');
  assert.equal(typeof p.totais.homologados, 'number');
  assert.equal(typeof p.totais.disponiveis, 'number');
  assert.equal(typeof p.totais.contratados, 'number');
  assert.ok(Array.isArray(p.bots));
  assert.ok(Array.isArray(p.instancias));
});

test('0007 revê e refaz Yasmin e todos os bots limpando conserto de telefone, pesquisa poluída e reconstruindo mapa mental e forma de agir', () => {
  const yasminCriada = bots.criarBotComercial({
    nome: 'Yasmin',
    finalidade: 'Atender clientes de Assistência e suporte técnico',
    especialidade: 'Assistência e suporte técnico',
    profissao: 'suporte',
    autorizado: true,
    preparacao: {
      ok: true,
      nicho: 'Vendedora-Suporte-Secretaria do dono',
      fluxos: ['aparelho: Qual é o aparelho (marca e modelo)? Ex.: Samsung A15, notebook Dell'],
    },
    perfil: {
      funcao: 'Suporte técnico',
      objetivoPrincipal: 'Atender ordem de serviço',
      limitesAtuacao: 'Básico',
      persona: 'Você é {nome}.',
      mensagemInicial: 'Me manda o número do pedido.',
      mensagemFallback: 'Com o número do pedido eu resolvo mais rápido.',
      regrasAdicionais: [],
    },
  });
  assert.equal(yasminCriada.ok, true);
  mapa.adicionarNo({
    agenteId: yasminCriada.bot.agenteId,
    categoria: 'conhecimento-básico',
    conteudo: 'Itapeva Rua Luiz Carriel 90 conserto de máquina de lavar Brastemp Samsung A15',
    estado: 'homologado',
    autorizado: true,
  });

  const rev = bots.revisarERefazerBot({ agenteId: yasminCriada.bot.agenteId, autorizado: true });
  assert.equal(rev.ok, true);
  assert.equal(rev.papel, 'yasmin-executiva-veloso');
  assert.equal(rev.base.id, 'veloso-solution');
  assert.equal(rev.testes.criticosOk, true);
  assert.equal(rev.diagnostico.faltam.length, 0);

  const botDepois = bots.obterBot(yasminCriada.bot.agenteId);
  const jsonBot = JSON.stringify(botDepois);
  assert.equal(/samsung a15|notebook dell|itapeva|brastemp|n[uú]mero do pedido/i.test(jsonBot), false);
  assert.match(botDepois.perfil.funcao, /Vendedora, Suporte de Sistemas e Secretária do Fabiano/);
  assert.ok(botDepois.conhecimentos.some((c) => c.categoria === 'o-que-pode-somar'));
  assert.ok(botDepois.conhecimentos.some((c) => c.categoria === 'o-que-a-empresa-faz'));
  assert.ok(botDepois.conhecimentos.some((c) => c.categoria === 'produto' && /To-No-Rango/.test(c.conteudo)));

  const nosDepois = mapa.obterNos(yasminCriada.bot.agenteId).nos;
  assert.equal(nosDepois.some((n) => /samsung a15|itapeva|brastemp/i.test(n.conteudo)), false);
  assert.ok(nosDepois.some((n) => n.categoria === 'o-que-pode-somar' && n.estado === 'homologado'));

  const todos = bots.revisarERefazerTodosOsBots({ autorizado: true });
  assert.equal(todos.ok, true);
  assert.ok(todos.total >= 1);
});
