#!/usr/bin/env node
/**
 * VStiktok — CLI. É por aqui que se configura o app, autoriza a conta, cadastra
 * produto, cria campanha e publica vídeo sem abrir o painel da TikTok.
 *
 * Os comandos que gastam dinheiro ou vão ao ar (campanha, publicação) dizem em voz
 * alta o que fizeram — inclusive que a campanha nasce PAUSADA.
 */
import { readFileSync } from 'node:fs';
import * as vs from './index.mjs';
import { conectar, testar } from './conectar.mjs';

const [cmd, ...args] = process.argv.slice(2);

/** Lê `chave=valor` da linha de comando; o resto sobra como posicional. */
function pares(lista) {
  const out = {};
  const soltos = [];
  for (const a of lista) {
    const i = a.indexOf('=');
    if (i > 0 && !a.startsWith('http')) { out[a.slice(0, i)] = a.slice(i + 1); }
    else { soltos.push(a); }
  }
  return { opts: out, soltos };
}

/** Aceita `@arquivo.json` como payload — produto e campanha têm campo demais pra linha. */
function payload(arg) {
  if (!arg) { return null; }
  if (arg.startsWith('@')) { return JSON.parse(readFileSync(arg.slice(1), 'utf8')); }
  return JSON.parse(arg);
}

function falhou(r) {
  console.error('  ✖', r.motivo || (r.erros || []).join('; ') || 'falhou');
  if (r.logId) { console.error('    log/request id:', r.logId); }
  process.exit(1);
}

function avisar(r) {
  for (const a of r.avisos || []) { console.log('  ⚠ ', a); }
}

function ajuda() {
  console.log(`
  VStiktok — integração TikTok (Login Kit, Shop e Ads)

  Configuração
    conectar <familia> [publicar=1]     túnel + autorização + teste, num comando só
                                        [provedor=localhost.run|cloudflared]
    testar [familia]                    bate na API de verdade e mostra o que voltou
    status                              o que está pronto e o que falta
    app <open|business|shop> k=v...     guarda a credencial do app
    autorizar <familia> [publicar=1]    imprime a URL da tela de consentimento
                                        (publicar=1 pede tambem video.publish/upload)
    callback <familia> <code> [state]   troca o code por token e guarda
    lojas                               lojas do Shop autorizadas (define a ativa)
    anunciantes                         contas de anúncio (define a ativa)

  Catálogo (Shop)
    categorias                          árvore de categorias
    armazens                            armazéns da loja (warehouse_id dos SKUs)
    produto-criar @produto.json         cadastra (valida antes de enviar)
    produtos [texto]                    busca no catálogo
    produto-ativar <id...>              publica na vitrine
    produto-pausar <id...>              tira da vitrine

  Campanhas (Ads)
    campanha-criar @campanha.json       cria PAUSADA (não gasta até você ligar)
    campanhas                           lista as campanhas da conta
    campanha-ligar <id...>              coloca pra veicular
    campanha-pausar <id...>             pausa
    relatorio <AAAA-MM-DD> <AAAA-MM-DD> gasto, cliques e conversões por campanha

  Conteúdo e métricas
    perfil                              conta conectada
    publicar <url|arquivo> "titulo" [privacidade]
    metricas <videoId...>               views/likes/comentários por vídeo
`);
}

const familias = ['open', 'business', 'shop'];

switch (cmd) {
  case 'status': {
    const d = vs.diagnostico();
    console.log('\n  VStiktok — situação\n');
    for (const [f, s] of Object.entries(d.familias)) {
      const marca = s.autorizado && !s.expirado ? '✓' : (s.appConfigurado ? '·' : '✖');
      console.log(`  ${marca} ${f.padEnd(9)} ${s.nome}`);
      if (s.faltando.length) { console.log(`      falta no app: ${s.faltando.join(', ')}`); }
      else if (!s.autorizado) { console.log('      app configurado, conta ainda NÃO autorizada — rode `autorizar ' + f + '`'); }
      else if (s.expirado) { console.log(`      token vencido${s.podeRenovar ? ' (renova sozinho na próxima chamada)' : ' — refaça a autorização'}`); }
      else if (s.venceEmMin != null) { console.log(`      token vence em ${s.venceEmMin} min  ${s.token}`); }
      else { console.log(`      autorizado  ${s.token}`); }
    }
    console.log('\n  Pronto pra:', Object.entries(d.pronto).filter(([, v]) => v).map(([k]) => k).join(', ') || '(nada ainda)');
    if (d.lojaAtiva) { console.log('  Loja ativa:', d.lojaAtiva); }
    if (d.anuncianteAtivo) { console.log('  Conta de anúncio ativa:', d.anuncianteAtivo); }
    console.log('');
    break;
  }

  case 'app': {
    const [familia, ...resto] = args;
    if (!familias.includes(familia)) { console.error('  ✖ use: app <open|business|shop> chave=valor...'); process.exit(1); }
    const { opts } = pares(resto);
    const r = vs.salvarCredencial(familia, opts);
    if (!r.ok) { falhou(r); }
    console.log(`  ✓ credencial do app "${familia}" guardada (${r.campos.join(', ')})`);
    break;
  }

  case 'conectar': {
    const [familia, ...resto] = args;
    if (!familias.includes(familia)) { console.error('  ✖ use: conectar <open|business|shop>'); process.exit(1); }
    const { opts } = pares(resto);
    if (opts.escopos) { opts.escopos = String(opts.escopos).split(',').map((e) => e.trim()).filter(Boolean); }
    else if (opts.publicar) { opts.escopos = [...vs.auth.ESCOPOS_PADRAO, vs.auth.ESCOPOS.publicar, vs.auth.ESCOPOS.enviar]; }
    const r = await conectar(familia, opts);
    if (!r.ok) { falhou(r); }
    console.log(`\n  ✓ ${familia} conectado. token ${r.token.accessToken}`);
    if (r.token.expiraEm) { console.log('    vence em', r.token.expiraEm, '(renova sozinho enquanto houver refresh)'); }
    console.log('\n  Provando contra a API de verdade:\n');
    const t = await testar(familia);
    for (const p of t.provas) { console.log(`   ${p.ok ? '✓' : '✖'} ${p.chamada.padEnd(42)} ${p.detalhe}`); }
    console.log('');
    if (!t.ok) { process.exit(1); }
    break;
  }

  case 'testar': {
    const alvo = args[0] ? [args[0]] : familias.filter((f) => vs.diagnostico().familias[f].autorizado);
    if (!alvo.length) { console.error('  ✖ nenhuma familia autorizada ainda — rode `conectar <familia>`'); process.exit(1); }
    let tudoOk = true;
    for (const f of alvo) {
      const t = await testar(f);
      console.log(`\n  ${f}`);
      if (t.motivo) { console.log(`   ✖ ${t.motivo}`); tudoOk = false; continue; }
      for (const p of t.provas) { console.log(`   ${p.ok ? '✓' : '✖'} ${p.chamada.padEnd(42)} ${p.detalhe}`); }
      tudoOk = tudoOk && t.ok;
    }
    console.log('');
    if (!tudoOk) { process.exit(1); }
    break;
  }

  case 'autorizar': {
    const [familia, ...resto] = args;
    const { opts } = pares(resto);
    // Publicar exige escopo extra, e escopo NAO pedido aqui nao tem como ser pedido
    // depois sem refazer a autorizacao — por isso o atalho `publicar=1`.
    if (opts.escopos) { opts.escopos = String(opts.escopos).split(',').map((e) => e.trim()).filter(Boolean); }
    else if (opts.publicar) { opts.escopos = [...vs.auth.ESCOPOS_PADRAO, vs.auth.ESCOPOS.publicar, vs.auth.ESCOPOS.enviar]; }
    const r = vs.iniciarAutorizacao(familia, opts);
    if (!r.ok) { falhou(r); }
    console.log('\n  Abra esta URL, autorize, e volte com o `code` do callback:\n');
    console.log('   ', r.url, '\n');
    console.log('  Depois rode:  vstiktok callback', familia, '<code>', r.state, '\n');
    break;
  }

  case 'callback': {
    const [familia, code, state] = args;
    const r = await vs.concluirAutorizacao(familia, code, { state });
    if (!r.ok) { falhou(r); }
    console.log(`  ✓ ${familia} autorizado. token ${r.token.accessToken}`);
    if (r.token.expiraEm) { console.log('    vence em', r.token.expiraEm); }
    break;
  }

  case 'lojas': {
    const r = await vs.descobrirLoja();
    if (!r.ok) { falhou(r); }
    for (const l of r.lojas) { console.log(`  ${l.id}  ${l.name}  (${l.region || '—'})`); }
    if (!r.lojas.length) { console.log('  (nenhuma loja autorizou o app ainda)'); }
    break;
  }

  case 'anunciantes': {
    const r = await vs.descobrirAnunciante();
    if (!r.ok) { falhou(r); }
    for (const a of r.anunciantes) { console.log(`  ${a.advertiser_id}  ${a.advertiser_name}`); }
    if (!r.anunciantes.length) { console.log('  (nenhuma conta de anúncio disponível)'); }
    break;
  }

  case 'categorias': {
    const c = await vs.contexto('shop');
    if (!c.ok) { falhou(c); }
    const r = await vs.produtos.categorias(c.ctx);
    if (!r.ok) { falhou(r); }
    for (const cat of r.dados?.categories || []) { console.log(`  ${cat.id}  ${cat.local_name}${cat.is_leaf ? '' : '  (não é folha)'}`); }
    break;
  }

  case 'armazens': {
    const c = await vs.contexto('shop');
    if (!c.ok) { falhou(c); }
    const r = await vs.produtos.armazens(c.ctx);
    if (!r.ok) { falhou(r); }
    for (const w of r.dados?.warehouses || []) { console.log(`  ${w.id}  ${w.name}  ${w.type || ''}`); }
    break;
  }

  case 'produto-criar': {
    const r = await vs.cadastrarProduto(payload(args[0]) || {});
    if (!r.ok) { falhou(r); }
    console.log('  ✓ produto criado:', r.dados?.product_id || '(sem id no retorno)');
    console.log('    ele nasce como RASCUNHO/pendente — use `produto-ativar` pra ir pra vitrine');
    break;
  }

  case 'produtos': {
    const r = await vs.listarProdutos({ texto: args[0] });
    if (!r.ok) { falhou(r); }
    for (const p of r.dados?.products || []) { console.log(`  ${p.id}  ${p.status?.padEnd(10) || ''}  ${p.title}`); }
    if (!(r.dados?.products || []).length) { console.log('  (nenhum produto)'); }
    break;
  }

  case 'produto-ativar':
  case 'produto-pausar': {
    const c = await vs.contexto('shop');
    if (!c.ok) { falhou(c); }
    const fn = cmd === 'produto-ativar' ? vs.produtos.ativar : vs.produtos.desativar;
    const r = await fn(c.ctx, args);
    if (!r.ok) { falhou(r); }
    console.log(`  ✓ ${args.length} produto(s) ${cmd === 'produto-ativar' ? 'na vitrine' : 'fora da vitrine'}`);
    break;
  }

  case 'campanha-criar': {
    const r = await vs.criarCampanha(payload(args[0]) || {});
    avisar(r);
    if (!r.ok) { falhou(r); }
    console.log('  ✓ campanha criada:', r.dados?.campaign_id || '(sem id no retorno)');
    if (r.criadaPausada) { console.log('    ela está PAUSADA — nada é gasto até você rodar `campanha-ligar`'); }
    break;
  }

  case 'campanhas': {
    const r = await vs.listarCampanhas();
    if (!r.ok) { falhou(r); }
    for (const c of r.dados?.list || []) {
      console.log(`  ${c.campaign_id}  ${String(c.operation_status).padEnd(8)}  ${c.objective_type?.padEnd(16) || ''}  ${c.campaign_name}`);
    }
    if (!(r.dados?.list || []).length) { console.log('  (nenhuma campanha)'); }
    break;
  }

  case 'campanha-ligar':
  case 'campanha-pausar': {
    const c = await vs.contexto('business');
    if (!c.ok) { falhou(c); }
    const anuncianteId = vs.getConfig().anuncianteId;
    const r = await vs.campanhas.mudarStatus(c.ctx, anuncianteId, args, cmd === 'campanha-ligar' ? 'ENABLE' : 'DISABLE');
    if (!r.ok) { falhou(r); }
    console.log(`  ✓ ${args.length} campanha(s) ${cmd === 'campanha-ligar' ? 'veiculando (já começa a gastar)' : 'pausada(s)'}`);
    break;
  }

  case 'relatorio': {
    const [inicio, fim] = args;
    const r = await vs.relatorioCampanhas({ inicio, fim });
    if (!r.ok) { falhou(r); }
    console.log('\n  campanha            gasto        impressões   cliques   CTR     conversões');
    for (const l of r.linhas) {
      console.log(`  ${String(l.campanhaId).padEnd(19)} ${String(l.gastoFormatado).padEnd(12)} `
        + `${String(l.impressoes ?? '—').padEnd(12)} ${String(l.cliques ?? '—').padEnd(9)} `
        + `${String(l.ctr ?? '—').padEnd(7)} ${l.conversoes ?? '—'}`);
    }
    if (!r.linhas.length) { console.log('  (sem dados no período)'); }
    console.log('');
    break;
  }

  case 'perfil': {
    const r = await vs.meuPerfil();
    if (!r.ok) { falhou(r); }
    const p = r.perfil;
    console.log(`\n  ${p.nome || p.openId}\n  seguidores ${p.seguidores ?? '—'} · vídeos ${p.videos ?? '—'} · curtidas ${p.curtidas ?? '—'}\n`);
    break;
  }

  case 'publicar': {
    const [alvo, titulo, privacidade] = args;
    const ehUrl = /^https?:\/\//i.test(alvo || '');
    const r = await vs.publicarVideo({
      titulo,
      privacidade: privacidade || 'SELF_ONLY',
      ...(ehUrl ? { videoUrl: alvo } : { caminho: alvo }),
    }, { aguardar: true });
    avisar(r);
    if (!r.ok) { falhou(r); }
    console.log('  ✓ publicado. publish_id:', r.publishId);
    break;
  }

  case 'metricas': {
    const r = await vs.metricasDeVideos(args);
    if (!r.ok) { falhou(r); }
    for (const m of r.medicoes) {
      console.log(`  ${m.videoId}  views ${m.views ?? '—'} · likes ${m.likes ?? '—'} · comentários ${m.comentarios ?? '—'} · compart. ${m.compartilhamentos ?? '—'}`);
    }
    for (const id of r.ausentes) { console.log(`  ⚠  ${id} não voltou da TikTok (id errado ou vídeo de outra conta)`); }
    break;
  }

  default:
    ajuda();
    if (cmd) { process.exit(1); }
}
