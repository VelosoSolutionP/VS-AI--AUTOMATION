/**
 * MISSÃO 007 — criação automática de uma IA-ZEST no Hotel e exclusão do perfil.
 *
 * A pessoa informa só nicho + identificação da empresa + aceite. O 0007 faz o
 * resto. Risco alto não é homologado sozinho; CPF fica no cadastro local e não
 * vai a buscador.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load, save } from '../engine/vscrm/store.mjs';

const casa = mkdtempSync(join(tmpdir(), 'ia-zest-auto-'));
process.env.VSCRM_DIR = join(casa, 'vscrm');
process.on('exit', () => { try { rmSync(casa, { recursive: true, force: true }); } catch { /* ja foi */ } });

const bots = await import('../engine/vs0007/bots.mjs');
const mapa = await import('../engine/vs0007/mapa.mjs');
const segmentos = await import('../engine/vs0007/segmentos.mjs');

function respostaHtml(html) {
  return {
    status: 200,
    ok: true,
    headers: { get: (nome) => (nome.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
    text: async () => html,
  };
}

function respostaRedirecionada(localizacao) {
  return {
    status: 302,
    ok: false,
    headers: { get: (nome) => (nome.toLowerCase() === 'location' ? localizacao : null) },
  };
}

function fetchDePesquisa(especialidade) {
  const slug = especialidade.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-');
  const fontes = [
    { url: `https://turismo.gov.br/${slug}/padroes`, titulo: `${especialidade} — padrões oficiais`, tipo: 'site oficial' },
    { url: `https://especialista.example.com/blog/${slug}`, titulo: `${especialidade} — boas práticas`, tipo: 'blog especializado' },
    { url: `https://forum.example.com/${slug}/duvidas`, titulo: `${especialidade} — discussão técnica`, tipo: 'comunidade profissional' },
  ];
  const resultados = `# Search Results\n\n${fontes.map((fonte, indice) =>
    `[${fonte.titulo}](https://www.google.com/goto?url=${indice})\n\n${fonte.tipo} com orientações de ${especialidade} e procedimentos recomendados.`,
  ).join('\n\n')}`;
  const chamadas = [];
  const fetch = async (url) => {
    const pagina = new URL(url);
    chamadas.push(decodeURIComponent(url));
    if (pagina.hostname === 'r.jina.ai') return respostaHtml(resultados);
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
  return { fetch, curl: async () => resultados, chamadas };
}

async function criarAutomatico(nicho, opcoes = {}) {
  const proposta = bots.prepararNicho({ nicho });
  const dependencias = fetchDePesquisa(proposta.especialidade);
  const resultado = await bots.criarIAZestAutomatica({
    nicho,
    empresaTipo: opcoes.empresaTipo || 'nome',
    empresaIdentificador: opcoes.empresaIdentificador || 'Empresa Teste',
    aceite: true,
    autorizado: true,
    ...dependencias,
  });
  return { resultado, dependencias, proposta };
}

test('criação automática exige nicho, identificação da empresa e aceite', async () => {
  const semAceite = await bots.criarIAZestAutomatica({
    nicho: 'hamburgueria',
    empresaTipo: 'nome',
    empresaIdentificador: 'Empresa Teste',
    aceite: false,
    autorizado: true,
  });
  assert.match(semAceite.erro, /aceitar/i);

  const semEmpresa = await bots.criarIAZestAutomatica({
    nicho: 'hamburgueria',
    empresaTipo: 'nome',
    empresaIdentificador: '',
    aceite: true,
    autorizado: true,
  });
  assert.match(semEmpresa.erro, /identifique a empresa/i);

  const nichoCurto = await bots.criarIAZestAutomatica({
    nicho: 'x',
    empresaTipo: 'nome',
    empresaIdentificador: 'Empresa Teste',
    aceite: true,
    autorizado: true,
  });
  assert.match(nichoCurto.erro, /nicho/i);

  const cpfComoNome = await bots.criarIAZestAutomatica({
    nicho: 'hamburgueria',
    empresaTipo: 'nome',
    empresaIdentificador: '05485368646',
    aceite: true,
    autorizado: true,
  });
  assert.match(cpfComoNome.erro, /selecione CNPJ ou CPF/i);
});

test('nicho de baixo risco é pesquisado, testado e homologado automaticamente', async () => {
  const { resultado, dependencias, proposta } = await criarAutomatico('hamburgueria', { empresaIdentificador: 'Lanchonete do Zé' });
  assert.equal(resultado.erro, undefined, JSON.stringify(resultado));
  assert.equal(resultado.homologado, true, JSON.stringify(resultado.testes));
  assert.equal(resultado.aguardandoAprovacao, false);
  assert.equal(resultado.bot.estado, 'homologado');
  assert.equal(resultado.risco.nivel, 'baixo');
  assert.ok(resultado.testes.criticosOk);
  assert.ok(resultado.testes.total >= 5);
  assert.ok(resultado.relatorio.fontesRegistradas.length >= 3);
  assert.equal(resultado.bot.empresaNome, 'Lanchonete do Zé');
  assert.ok(dependencias.chamadas.some((url) => /Lanchonete.*Z/i.test(url)),
    'o nome da empresa é pesquisado como presença pública');
  assert.ok(resultado.bot.preparacao.pesquisaInicial.fontes.some((fonte) => fonte.tipo === 'site-oficial'));
  assert.ok(resultado.bot.preparacao.pesquisaInicial.fontes.some((fonte) => fonte.tipo === 'blog-especializado'));
  assert.equal(proposta.especialidade, resultado.bot.especialidade);
});

test('CPF é aceito, fica só no cadastro local e não é enviado a buscador', async () => {
  const cpf = '05485368646';
  const { resultado, dependencias } = await criarAutomatico('hamburgueria', { empresaTipo: 'cpf', empresaIdentificador: cpf });
  assert.equal(resultado.erro, undefined, JSON.stringify(resultado));
  assert.equal(bots.obterBot(resultado.bot.agenteId).empresaCpf, cpf, 'o CPF completo fica só no armazenamento local');
  assert.match(resultado.bot.empresaCpf, /^\*\*\*\.\*\*\*\.\*\*\*-\d\d$/, 'a resposta da API não devolve o CPF inteiro');
  assert.equal(resultado.homologado, true);
  assert.equal(resultado.empresa.tipo, 'cpf');
  assert.match(resultado.empresa.identificador, /^\*\*\*\.\*\*\*\.\*\*\*-\d\d$/);
  assert.ok(dependencias.chamadas.every((url) => !url.includes(cpf)), 'CPF não aparece em nenhuma URL de pesquisa');
  assert.ok(!JSON.stringify(resultado.bot.preparacao.pesquisaInicial.fontes).includes(cpf));
});

test('risco alto fica em validação aguardando aprovação humana', async () => {
  const { resultado } = await criarAutomatico('clinica odontologica', { empresaIdentificador: 'Clínica Sorriso' });
  assert.equal(resultado.erro, undefined, JSON.stringify(resultado));
  assert.equal(resultado.risco.nivel, 'alto');
  assert.equal(resultado.homologado, false);
  assert.equal(resultado.aguardandoAprovacao, true);
  assert.equal(resultado.bot.estado, 'em_validacao');
  assert.equal(resultado.testes.criticosOk, true, JSON.stringify(resultado.testes));

  const aprovacaoHumana = bots.homologarBot({ agenteId: resultado.bot.agenteId, autorizado: true, aprovado: true });
  assert.equal(aprovacaoHumana.homologado, true);
});

test('duas empresas do mesmo nicho recebem identificadores distintos', async () => {
  const primeira = await criarAutomatico('hamburgueria', { empresaIdentificador: 'Empresa Um' });
  const segunda = await criarAutomatico('hamburgueria', { empresaIdentificador: 'Empresa Dois' });
  assert.equal(primeira.resultado.erro, undefined, JSON.stringify(primeira.resultado));
  assert.equal(segunda.resultado.erro, undefined, JSON.stringify(segunda.resultado));
  assert.notEqual(primeira.resultado.bot.agenteId, segunda.resultado.bot.agenteId);
});

test('excluir IA-ZEST remove perfil, mapa e instâncias inativas', async () => {
  const { resultado } = await criarAutomatico('hamburgueria', { empresaIdentificador: 'Empresa Excluir' });
  const id = resultado.bot.agenteId;

  const semAutorizacao = bots.excluirBot({ agenteId: id });
  assert.match(semAutorizacao.erro, /autorização/i);

  const ativa = bots.criarInstancia({ modeloId: id, clienteId: 'cliente-1', autorizado: true });
  assert.equal(ativa.ok, true);
  bots.ativarInstancia({ id: ativa.instancia.id, autorizado: true });
  const bloqueada = bots.excluirBot({ agenteId: id, autorizado: true });
  assert.match(bloqueada.erro, /instância\(s\) ativa/i);

  const instancias = load(bots.DATASET_INSTANCIAS, []);
  for (const instancia of instancias) instancia.status = 'inativo';
  save(bots.DATASET_INSTANCIAS, instancias);

  const antes = (await mapa.obterNos(id)).nos.length;
  assert.ok(antes > 0);

  const exclusao = bots.excluirBot({ agenteId: id, autorizado: true });
  assert.equal(exclusao.erro, undefined, JSON.stringify(exclusao));
  assert.equal(exclusao.excluido.agenteId, id);
  assert.equal(exclusao.instanciasRemovidas, 1);
  assert.equal(bots.obterBot(id), null);
  assert.equal((await mapa.obterNos(id)).nos.length, 0);
});

test('não deixa cadastrar nem renomear duas IA-ZEST com o mesmo nome', () => {
  const base = { finalidade: 'Atender clientes da padaria', especialidade: 'Padaria nome único', autorizado: true };
  const a = bots.criarBotComercial({ ...base, nome: 'Atendente Pão Quente' });
  assert.equal(a.ok, true);
  const dup = bots.criarBotComercial({ ...base, especialidade: 'Padaria outra', nome: '  atendente pao quente ' });
  assert.match(dup.erro, /já existe uma IA-ZEST com o nome/);
  const b = bots.criarBotComercial({ ...base, especialidade: 'Padaria segunda', nome: 'Atendente Pão Frio' });
  assert.equal(b.ok, true);
  const renomear = bots.atualizarPerfilBot({ agenteId: b.bot.agenteId, nome: 'ATENDENTE PÃO QUENTE', perfil: b.bot.perfil, autorizado: true });
  assert.match(renomear.erro, /já existe outra IA-ZEST/);
  /* Manter o próprio nome não conta como repetido. */
  const mesmo = bots.atualizarPerfilBot({ agenteId: b.bot.agenteId, nome: 'Atendente Pão Frio', perfil: { ...b.bot.perfil, persona: 'Calma e objetiva.' }, autorizado: true });
  assert.equal(mesmo.ok, true);
  assert.equal(mesmo.alterado, true);
  assert.equal(bots.obterBot(b.bot.agenteId).perfil.persona, 'Calma e objetiva.');
});

test('criação automática repetida no mesmo nicho ganha nome distinto', async () => {
  const primeiro = await criarAutomatico('floricultura', { empresaIdentificador: 'Flores A' });
  const segundo = await criarAutomatico('floricultura', { empresaIdentificador: 'Flores B' });
  assert.notEqual(primeiro.resultado.bot.nome, segundo.resultado.bot.nome);
  assert.notEqual(primeiro.resultado.bot.agenteId, segundo.resultado.bot.agenteId);
});

test('o relógio do prazo de 12h homologa sozinho o bot que ficou parado em preparação', async () => {
  const proposta = bots.prepararNicho({ nicho: 'lavanderia' });
  const criado = bots.criarBotComercial({
    nome: 'Atendente Lavanderia Prazo', finalidade: proposta.finalidade, especialidade: proposta.especialidade,
    profissao: proposta.profissao.id, autorizado: true, atividades: proposta.atividades,
    ferramentas: (proposta.ferramentas || []).map((item) => item.nome || String(item)),
    falhas: proposta.falhas, lacunas: proposta.lacunas, conhecimentos: proposta.conhecimentos,
    preparacao: proposta, perfil: proposta.perfil,
  });
  assert.equal(criado.ok, true);
  const id = criado.bot.agenteId;
  assert.equal(bots.obterBot(id).estado, 'em_preparacao');
  const deps = fetchDePesquisa(proposta.especialidade);
  const r = await bots.processarPrazosHomologacao({ ...deps, forcar: true });
  const item = r.itens.find((i) => i.agenteId === id);
  assert.equal(item?.resultado, 'homologado', JSON.stringify(item));
  const bot = bots.obterBot(id);
  assert.equal(bot.estado, 'homologado');
  assert.equal(bot.cicloVida.preparacaoConhecimentoInicial.ultimoResultado, 'homologado');
  /* Já homologado: a rodada seguinte não mexe nele. */
  const de_novo = await bots.processarPrazosHomologacao({ ...deps, forcar: true });
  assert.equal(de_novo.itens.some((i) => i.agenteId === id), false);
});

test('o relógio do prazo não homologa sozinho risco alto e não repete antes de 30 min', async () => {
  const proposta = bots.prepararNicho({ nicho: 'advocacia trabalhista' });
  const criado = bots.criarBotComercial({
    nome: 'Atendente Advocacia Prazo', finalidade: proposta.finalidade, especialidade: proposta.especialidade,
    profissao: proposta.profissao.id, autorizado: true, preparacao: proposta, perfil: proposta.perfil,
    falhas: proposta.falhas, lacunas: proposta.lacunas, conhecimentos: proposta.conhecimentos,
  });
  const id = criado.bot.agenteId;
  const deps = fetchDePesquisa(proposta.especialidade);
  const agora = new Date();
  await bots.processarPrazosHomologacao({ ...deps, agora });
  const bot = bots.obterBot(id);
  assert.notEqual(bot.estado, 'homologado');
  const tentativas = bot.cicloVida.preparacaoConhecimentoInicial.tentativas;
  const r = await bots.processarPrazosHomologacao({ ...deps, agora: new Date(agora.getTime() + 60000) });
  assert.equal(r.itens.some((i) => i.agenteId === id), false);
  assert.equal(bots.obterBot(id).cicloVida.preparacaoConhecimentoInicial.tentativas, tentativas);
});

test('qualquer nicho fecha só com sites comuns do setor (sem gov, blog ou fórum)', async () => {
  const nicho = 'conserto de bicicleta';
  const fontes = [1, 2, 3, 4].map((n) => ({ url: `https://bike-oficina-${n}.com.br/servicos`, titulo: `Conserto de bicicleta ${n} — serviços` }));
  const resultados = `# Search Results\n\n${fontes.map((f, i) => `[${f.titulo}](https://www.google.com/goto?url=${i})\n\nconserto de bicicleta com revisão, troca de câmara e regulagem de freios.`).join('\n\n')}`;
  const fetch = async (url) => {
    const pagina = new URL(url);
    if (pagina.hostname === 'r.jina.ai') return respostaHtml(resultados);
    if (pagina.hostname === 'www.google.com' && pagina.pathname === '/goto') return respostaRedirecionada(fontes[Number(pagina.searchParams.get('url'))].url);
    const fonte = fontes.find((f) => new URL(f.url).hostname === pagina.hostname);
    if (!fonte) return { ...respostaHtml(''), status: 404, ok: false };
    const texto = 'O conserto de bicicleta inclui revisão completa, regulagem de câmbio e freios e troca de peças gastas.';
    return respostaHtml(`<html><head><title>${fonte.titulo}</title><meta name="description" content="${texto}"></head><body><p>${texto}</p></body></html>`);
  };
  const r = await bots.criarIAZestAutomatica({ nicho, empresaTipo: 'nome', empresaIdentificador: 'Bike do Zé', aceite: true, autorizado: true, fetch, curl: async () => resultados });
  assert.equal(r.erro, undefined, JSON.stringify(r));
  assert.equal(r.pendencia, null, JSON.stringify({ p: r.pendencia, m: r.mensagem, e: r.erroPesquisa }));
  assert.equal(r.homologado, true);
  assert.ok(r.bot.preparacao.pesquisaInicial.fontes.every((f) => ['site-do-setor', 'presenca-digital-empresa'].includes(f.tipo)));
});

test('sem modelo pronto a IA é do nicho, e não "Atendente de loja"', () => {
  const p = bots.prepararNicho({ nicho: 'assistente executiva' });
  assert.equal(JSON.stringify(p).includes('Atendente de loja'), false);
  assert.equal(p.profissao.nome, 'Atendente de assistente executiva');
});

test('só conta como fonte a página que fala mesmo do nicho', async () => {
  const { falaDoNicho } = await import('../engine/vs0007/pesquisa.mjs');
  assert.equal(falaDoNicho('Que horas o Sol se põe? Assistente virtual do Google', ['Assistente executiva']), false);
  assert.equal(falaDoNicho('A assistente executiva organiza a agenda da diretoria', ['Assistente executiva']), true);
  assert.equal(falaDoNicho('Serviços de faxineira em Belo Horizonte', ['Faxineura']), true, 'tolera erro de grafia');
});

test('empresa só conta com o nome inteiro', async () => {
  const { falaDoNicho } = await import('../engine/vs0007/pesquisa.mjs');
  assert.equal(falaDoNicho('Teste Engenharia, ensaios de concreto', ['Salão da Glau Teste'], 1), false);
  assert.equal(falaDoNicho('Salão da Glau em Lagoa Santa', ['Salão da Glau'], 1), true);
});

test('produtos saem dos dados do site e, sem eles, das linhas com preço', async () => {
  const { extrairProdutos } = await import('../engine/vs0007/pesquisa.mjs');
  const ld = '<script type="application/ld+json">{"@type":"Product","name":"Dobrão","description":"Vende no WhatsApp","offers":{"price":"99.90"}}</script>';
  assert.deepEqual(extrairProdutos(ld), ['Dobrão — R$ 99.90: Vende no WhatsApp']);
  assert.deepEqual(extrairProdutos('<p>Plano Básico R$ 49,90 por mês</p><p>Sobre nós</p>'), ['Plano Básico R$ 49,90 por mês']);
});

/* Cardápio Digital é segmento comercial: distribuidoras, por temas de operação. */
function fetchDeSegmento(temasSemFonte = []) {
  const { segmentoDoNicho } = segmentos;
  const temas = segmentoDoNicho('cardapio digital').temas;
  const frase = (t) => `Na operação diária, ${t.nome.toLowerCase()} organiza o trabalho e reduz erros em distribuidora de bebidas e pedidos.`;
  const ampla = { 'pagamentos-pix': 'pagamentos', 'fiscal-nfe-sped': 'nota fiscal', 'whatsapp-automacao': 'whatsapp', 'precos-promocoes': 'tabela de preços', 'clientes-condicoes': 'atacado', 'compras-fornecedores': 'fornecedores', 'estoque-reposicao': 'estoque', 'catalogo-produtos': 'catálogo', 'cardapio-catalogo-digital': 'cardápio digital', distribuidoras: 'distribuidora de bebidas', 'pedidos-vendas-entregas': 'pedidos' };
  const texto = (t) => `${frase(t)} O tema de ${ampla[t.id]} aparece em toda rotina do setor atendido hoje.`;
  const fetch = async (url) => {
    const u = new URL(url); const alvo = decodeURIComponent(url);
    if (u.hostname === 'r.jina.ai') {
      const t = temas.find((x) => alvo.includes(x.busca));
      if (!t || temasSemFonte.includes(t.id)) return respostaHtml('# Search Results\n\n');
      return respostaHtml(`# Search Results\n\n[${t.nome} ${ampla[t.id]} distribuidora de bebidas](https://www.google.com/goto?url=${t.id})\n\n${texto(t)}`);
    }
    if (u.hostname === 'www.bing.com' || u.hostname === 'search.yahoo.com') return respostaHtml('<html></html>');
    if (u.pathname === '/goto') return respostaRedirecionada(`https://setor.example.com/${u.searchParams.get('url')}`);
    const t = temas.find((x) => u.pathname === `/${x.id}`);
    if (!t) return { ...respostaHtml(''), status: 404, ok: false };
    return respostaHtml(`<html><head><title>${t.nome}</title></head><body><p>${texto(t)}</p></body></html>`);
  };
  return { fetch, curl: async () => '' };
}

test('Cardápio Digital é distribuição de alimentos e bebidas, não comida nem profissão', () => {
  const p = bots.prepararNicho({ nicho: 'cardapio digital' });
  assert.equal(p.especialidade, 'Distribuição e comércio de alimentos e bebidas');
  assert.equal(p.segmento.especialidade, 'Catálogo e pedidos digitais');
  assert.equal(p.perfil.funcao, 'Catálogo e pedidos digitais');
  assert.equal(p.especialidadeId, null);
  assert.equal(p.segmento.temas.length, 11);
  assert.ok(p.atividades.some((a) => /SPED/.test(a)));
  assert.doesNotMatch(JSON.stringify(p), /Vendedora|Comida japonesa/);
});

test('segmento registra um conhecimento por tema, vai para validação humana por ter tema fiscal', async () => {
  const r = await bots.criarIAZestAutomatica({ nicho: 'Cardápio Digital', empresaTipo: 'nome', empresaIdentificador: 'Distribuidora Modelo', aceite: true, autorizado: true, ...fetchDeSegmento() });
  assert.equal(r.pendencia, null, r.mensagem || r.erroPesquisa);
  assert.equal(r.risco.nivel, 'alto');
  assert.equal(r.bot.estado, 'em_validacao');
  const t = r.testes.testes.find((x) => x.id === 'temas-do-segmento');
  assert.equal(t.ok, true, t.evidencia);
  const categorias = r.bot.preparacao.pesquisaInicial.conhecimentos.map((c) => c.categoria);
  assert.ok(categorias.includes('fiscal-nfe-sped') && categorias.includes('estoque-reposicao'));
});

test('segmento abaixo do mínimo de temas não conclui e diz quais faltaram', async () => {
  const r = await bots.criarIAZestAutomatica({ nicho: 'distribuidora de bebidas', empresaTipo: 'nome', empresaIdentificador: 'Outra Distribuidora', aceite: true, autorizado: true, ...fetchDeSegmento(['fiscal-nfe-sped', 'pagamentos-pix', 'estoque-reposicao']) });
  assert.equal(r.pendencia, 'pesquisa');
  assert.equal(r.homologado, false);
  assert.match(r.erroPesquisa, /cobriu 8 de 11.*NF-e/);
});

test('na criação pela tela a pesquisa do segmento fica com o relógio, sem segurar a requisição', async () => {
  const r = await bots.criarIAZestAutomatica({ nicho: 'cardapio digital', empresaTipo: 'nome', empresaIdentificador: 'Terceira Distribuidora', aceite: true, autorizado: true, pesquisarAgora: false });
  assert.equal(r.pendencia, 'pesquisa');
  assert.equal(r.bot.estado, 'em_preparacao');
  assert.equal(r.bot.preparacao.pesquisaInicial?.estado === 'concluida', false);
  assert.equal(r.pesquisando, true);
});

test('rodada seguinte guarda o que achou e busca só os temas que faltaram', async () => {
  const faltando = ['fiscal-nfe-sped', 'pagamentos-pix', 'estoque-reposicao'];
  const primeira = await bots.criarIAZestAutomatica({ nicho: 'distribuidora de alimentos', empresaTipo: 'nome', empresaIdentificador: 'Quarta Distribuidora', aceite: true, autorizado: true, ...fetchDeSegmento(faltando) });
  assert.equal(primeira.pesquisando, true);
  assert.match(primeira.erroPesquisa, /em andamento.*cobriu 8 de 11/);
  const buscas = [];
  const dep = fetchDeSegmento();
  const fetch = (url) => { buscas.push(decodeURIComponent(url)); return dep.fetch(url); };
  const segunda = await bots.concluirPreparacaoAutomatica({ agenteId: primeira.bot.agenteId, fetch, curl: dep.curl });
  assert.equal(segunda.pendencia, null, segunda.mensagem || segunda.erroPesquisa);
  assert.equal(buscas.some((u) => /tabela de pre/.test(u)), false);
  assert.equal(buscas.some((u) => /SPED/.test(u)), true);
  const categorias = segunda.bot.preparacao.pesquisaInicial.conhecimentos.map((c) => c.categoria);
  assert.equal(new Set(categorias).size, 11);
});

test('rodada que não acha nada novo vira impedimento', async () => {
  const dep = fetchDeSegmento(['fiscal-nfe-sped', 'pagamentos-pix', 'estoque-reposicao']);
  const primeira = await bots.criarIAZestAutomatica({ nicho: 'distribuidora de bebidas', empresaTipo: 'nome', empresaIdentificador: 'Quinta Distribuidora', aceite: true, autorizado: true, ...dep });
  const segunda = await bots.concluirPreparacaoAutomatica({ agenteId: primeira.bot.agenteId, ...dep });
  assert.equal(segunda.pesquisando, false);
  assert.match(segunda.erroPesquisa, /^Impedimento/);
});

test('regra do dono: primeiro treino passou de 12 h → apaga quem não aprendeu, protege quem está em uso, não homologa o resto', async () => {
  const criar = (nome) => {
    const proposta = bots.prepararNicho({ nicho: 'chaveiro 24 horas' });
    return bots.criarBotComercial({
      nome, finalidade: proposta.finalidade, especialidade: proposta.especialidade,
      profissao: proposta.profissao.id, autorizado: true, preparacao: proposta, perfil: proposta.perfil,
      falhas: proposta.falhas, lacunas: proposta.lacunas, conhecimentos: proposta.conhecimentos, identificadorUnico: true,
    }).bot.agenteId;
  };
  const naoAprendeu = criar('Chaveiro Sem Treino');
  const emUso = criar('Chaveiro Em Uso');
  const aprendeu = criar('Chaveiro Aguardando');
  const lista = load(bots.DATASET_BOTS, []);
  for (const b of lista) {
    if ([naoAprendeu, emUso].includes(b.agenteId)) b.preparacao.pesquisaInicial = { ...(b.preparacao.pesquisaInicial || {}), estado: 'pendente' };
    if (b.agenteId === aprendeu) {
      b.preparacao.pesquisaInicial = { ...(b.preparacao.pesquisaInicial || {}), estado: 'concluida' };
      b.cicloVida.preparacaoConhecimentoInicial.ultimoResultado = 'aguardando-aprovacao-humana';
    }
  }
  save(bots.DATASET_BOTS, lista);
  const depois = new Date(Date.now() + 13 * 3600e3);
  const r = await bots.processarPrazosHomologacao({ agora: depois, protegido: (id) => (id === emUso ? 'está ligada ao número "Teste" no WhatsApp' : null) });
  const de = (id) => r.encerrados.find((e) => e.agenteId === id);
  assert.equal(de(naoAprendeu).acao, 'apagada');
  assert.match(de(naoAprendeu).motivo, /não aprendeu/);
  assert.equal(bots.obterBot(naoAprendeu), null, 'a IA que não aprendeu foi apagada');
  assert.equal(de(emUso).acao, 'nao-homologada');
  assert.match(de(emUso).motivo, /Não apaguei: está ligada ao número/);
  assert.ok(bots.obterBot(emUso), 'IA em uso nunca é apagada sozinha');
  assert.equal(de(aprendeu).acao, 'nao-homologada');
  assert.match(de(aprendeu).motivo, /passou de 12 h/);
  assert.notEqual(bots.obterBot(aprendeu).estado, 'homologado');
  /* Encerrada não volta a ser processada (nem homologa sozinha, nem manda e-mail de novo). */
  const r2 = await bots.processarPrazosHomologacao({ agora: new Date(depois.getTime() + 3600e3), forcar: true });
  assert.equal(r2.encerrados.length, 0);
  assert.equal(r2.itens.some((i) => [emUso, aprendeu].includes(i.agenteId)), false);
});

test('prazo de 12 h é só do primeiro treino: bot que já foi homologado e voltou para validação não é encerrado', async () => {
  const proposta = bots.prepararNicho({ nicho: 'chaveiro 24 horas' });
  const id = bots.criarBotComercial({
    nome: 'Chaveiro Retreino', finalidade: proposta.finalidade, especialidade: proposta.especialidade,
    profissao: proposta.profissao.id, autorizado: true, preparacao: proposta, perfil: proposta.perfil,
    falhas: proposta.falhas, lacunas: proposta.lacunas, conhecimentos: proposta.conhecimentos, identificadorUnico: true,
  }).bot.agenteId;
  const lista = load(bots.DATASET_BOTS, []);
  const alvo = lista.find((b) => b.agenteId === id);
  alvo.preparacao.pesquisaInicial = { ...(alvo.preparacao.pesquisaInicial || {}), estado: 'concluida' };
  alvo.cicloVida.preparacaoConhecimentoInicial.ultimoResultado = 'homologado';
  /* Encerramento indevido gravado pela versão anterior da regra: precisa ser desfeito. */
  alvo.cicloVida.preparacaoConhecimentoInicial.encerradoPorPrazo = { em: new Date().toISOString(), acao: 'nao-homologada', motivo: 'passou de 12 h sem concluir a homologação (situação: homologado)' };
  save(bots.DATASET_BOTS, lista);
  const r = await bots.processarPrazosHomologacao({ agora: new Date(Date.now() + 90 * 3600e3), forcar: true });
  assert.equal(r.encerrados.some((e) => e.agenteId === id), false, 'não é encerrado de novo');
  assert.ok(r.itens.some((i) => i.agenteId === id), 'volta para o fluxo normal de homologação');
  const etapa = (bots.obterBot(id).cicloVida || {}).preparacaoConhecimentoInicial || {};
  assert.equal(etapa.encerradoPorPrazo, undefined);
  assert.ok(etapa.encerramentoDesfeito, 'guarda o registro do encerramento desfeito');
});
