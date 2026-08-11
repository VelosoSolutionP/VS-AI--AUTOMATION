#!/usr/bin/env node
/**
 * QA-Gate MCP server (stdio). Camada interativa: o modelo dirige o browser
 * a qualquer momento, recebe resultado estruturado + screenshot inline.
 * Tools de simulação exigem licença válida (validação offline Ed25519).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { checkApp, ensureUp, simulateFlows, runGate, loadConfig, targetsFor } from '../engine/core.mjs';
import { validateTask } from '../engine/requirements.mjs';
import { loadCompanyConfig } from '../engine/company-config.mjs';
import { makeTracker } from '../engine/vsqa/tracker/index.mjs';
import { normalizeIssue } from '../engine/vsqa/reader.mjs';
import { buildScenario, validateScenario } from '../engine/vsqa/scenario.mjs';
import { runVsqa } from '../engine/vsqa/index.mjs';
import { createEpic } from '../engine/vsanalista/index.mjs';
import { TRACKERS, CUSTOM_FIELDS, HU_TASKS } from '../engine/vsanalista/template.mjs';
import { writeDashboard } from '../engine/vsdiretoria/index.mjs';
import { answer as itwAnswer, nextQuestion as itwNext, progress as itwProgress } from '../engine/interview/engine.mjs';
import { loadProfile as itwLoad, saveProfile as itwSave } from '../engine/interview/index.mjs';
import { applyAll as itwApplyAll } from '../engine/interview/apply.mjs';
import { assertInstalled } from '../engine/interview/install.mjs';
import { qualificar as vsQualificar, followup as vsFollowup, objecao as vsObjecao, listarProdutos as vsListar, anunciar as vsAnunciar } from '../engine/vsvendas/index.mjs';
import { loadEvents, aggregate, report } from '../engine/metrics.mjs';
import { hasConsent } from '../engine/consent.mjs';
import { verifyLicense, currentLicenseToken } from '../license/license.mjs';
import { notify, projectLabel, receiptSummary } from '../engine/notify-whatsapp.mjs';
import { assertNotExpired } from '../engine/trial-lock.mjs';

const server = new McpServer({ name: 'qa-gate', version: '1.0.0' });

function requireLicense() {
  const res = verifyLicense(currentLicenseToken());
  if (!res.valid) { throw new Error('QA-Gate licença inválida: ' + res.reason); }
  // Teste de 7 dias: trava por data de instalação / trava forte do cron (plano trial só).
  assertNotExpired(res.license?.plan);
  return res.license;
}
const text = (t) => ({ type: 'text', text: t });
// Nome do projeto no recibo: MESMA regra dos hooks (projectLabel = pai/base ou
// config.projectName), pra não sair "frontend" no MCP e "Velvet/frontend" no hook.
function projectName(repo) {
  return projectLabel(repo);
}
function taskFromBranch(repo) {
  try {
    const b = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repo, encoding: 'utf8' }).trim();
    const m = b.match(/(\d{3,})/);
    return m ? m[1] : null;
  } catch { return null; }
}
function imageOf(path) {
  try { return { type: 'image', data: readFileSync(path).toString('base64'), mimeType: 'image/jpeg' }; }
  catch { return null; }
}

/* ---- qa_validate_task (livre — triagem de requisito antes da IA) ---- */
server.tool('qa_validate_task',
  'Valida se uma tarefa tem requisito suficiente ANTES de acionar a IA. Retorna codigo REQ (VS-REQ-001..005), o que falta e se deve escalar pro modelo (causa raiz/arquitetura/seguranca). Deterministico, ~0 token.',
  { task: z.string().describe('texto/descricao da tarefa'), pending: z.boolean().optional().describe('true se o dev deixou a tarefa aguardando requisito') },
  async ({ task, pending }) => {
    const r = validateTask(task, { pending });
    const lines = [
      `${r.short}`,
      r.blocked ? '► BLOQUEADO (IA nao acionada)' : '► liberado para o fluxo',
      r.missing.length ? `► falta: ${r.missing.join(', ')}` : '► requisito completo',
      `► escalar IA: ${r.escalate.call_ai ? 'SIM (' + r.escalate.reason + ')' : 'nao — trata local'}`,
      '',
      r.dev_msg,
    ];
    return { content: [text(lines.join('\n'))], isError: r.blocked };
  });

/* ---- qa_report (dashboard executivo anonimo, licenciado) ---- */
server.tool('qa_report',
  'Gera o relatorio executivo anonimo de governanca (tempo economizado, reducao de tokens, chamadas de IA evitadas, retrabalho, ROI). Agregado, sem nomes.',
  { squad: z.string().optional(), period: z.string().optional() },
  async ({ squad, period }) => {
    requireLicense();
    if (!hasConsent()) { return { content: [text('[VS-MON-003] Coleta desativada (sem consentimento). Sem telemetria para relatar.')] }; }
    const ev = loadEvents();
    if (!ev.length) { return { content: [text('Sem eventos coletados ainda.')] }; }
    return { content: [text(report(aggregate(ev), { squad, period }))] };
  });

/* ---- qa_check_app (livre) ---- */
server.tool('qa_check_app',
  'Verifica se o app local está no ar antes de simular.',
  { baseUrl: z.string(), healthPath: z.string().optional() },
  async ({ baseUrl, healthPath }) => {
    const up = await checkApp(baseUrl, healthPath || '/login');
    return { content: [text(up ? `✔ app no ar em ${baseUrl}` : `✖ app não responde em ${baseUrl}`)] };
  });

/* ---- qa_list_flows (livre) ---- */
server.tool('qa_list_flows',
  'Lista os fluxos configurados no qa-gate.config.json do projeto.',
  { configPath: z.string() },
  async ({ configPath }) => {
    const cfg = loadConfig(configPath);
    if (!cfg) { return { content: [text('sem config em ' + configPath)] }; }
    return { content: [text(JSON.stringify((cfg.flows || []).map((f) => ({ name: f.name, path: f.path })), null, 2))] };
  });

/* ---- qa_simulate (licenciado) — multi-alvo (front/mobile/ambos) ---- */
server.tool('qa_simulate',
  'Simula UM fluxo em browser real: injeta bug (submit vazio) e exige mensagem amigável + console limpo. ALVO: front | mobile | (vazio=ambos). Retorna status + screenshot inline por alvo. Use pra DIAGNOSTICAR bug de CRUD/validação: reproduz o erro real.',
  {
    configPath: z.string().describe('caminho do qa-gate.config.json'),
    path: z.string().describe('rota do fluxo, ex: /medico/pacientes/36/editar'),
    alvo: z.enum(['front', 'mobile']).optional().describe('vazio = roda front E mobile'),
    mode: z.enum(['form', 'read']).optional().describe('form=injeta bug via submit + exige msg amigavel (default). read=lista/visualiza sem submit, exige conteudo renderizado'),
    submitText: z.string().optional(),
    submitSelector: z.string().optional(),
    fill: z.record(z.string()).optional().describe('form: preenche campos ANTES do submit p/ reproduzir validacao de negocio. Ex: {"#email":"existente@x.com","#nome":"Teste"} (email duplicado, formato invalido)'),
    expectFriendlyError: z.boolean().optional(),
    expectMessageText: z.string().optional().describe('form: exige que a msg amigavel contenha esse texto (ex: "ja cadastrado")'),
    expectSelector: z.string().optional().describe('read: seletor que DEVE renderizar (ex: linha da tabela)'),
    expectMinCount: z.number().optional().describe('read: quantidade minima do expectSelector (ex: 1)'),
    expectText: z.string().optional().describe('read: texto que deve aparecer no DOM'),
  },
  async ({ configPath, path, alvo, mode, submitText, submitSelector, fill, expectFriendlyError, expectMessageText, expectSelector, expectMinCount, expectText }) => {
    requireLicense();
    const cfg = loadConfig(configPath);
    if (!cfg) { throw new Error('sem config em ' + configPath); }
    const flow = { name: 'adhoc' + path, path, mode, submitText, submitSelector, fill, expectFriendlyError, expectMessageText, expectSelector, expectMinCount, expectText };
    const content = [];
    let anyRed = false;
    for (const { name, tcfg } of targetsFor(cfg, alvo)) {
      const up = tcfg.start ? await ensureUp(tcfg.baseUrl, tcfg.healthPath || cfg.healthPath, tcfg) : await checkApp(tcfg.baseUrl, tcfg.healthPath || cfg.healthPath);
      if (!up) { content.push(text(`⚠ ${name}: app fora do ar (${tcfg.baseUrl}) — não subiu/não testado`)); continue; }
      const [res] = await simulateFlows({ ...tcfg }, [flow], { repo: `${configPath}-${name}` });
      if (res.status === 'red') { anyRed = true; }
      content.push(text(`${res.status === 'green' ? '✔ VERDE' : '✖ VERMELHO'} [${name}] ${path}\n${res.errors.join('\n') || 'bug injetado retornou msg amigável, console limpo'}`));
      const img = res.screenshot && imageOf(res.screenshot);
      if (img) { content.push(img); }
    }
    if (!content.length) { content.push(text('nenhum alvo configurado/no ar')); }
    return { content, isError: anyRed };
  });

/* ---- qa_run_gate (licenciado) ---- */
server.tool('qa_run_gate',
  'Roda o gate completo a partir do diff staged do repo (igual ao pre-commit). Backend puro pula browser.',
  {
    repo: z.string(),
    configPath: z.string().optional(),
    summary: z.string().optional().describe('solucao/o que foi feito (correcao unica) — vai no comprovante'),
    backend: z.string().optional().describe('o que foi feito no BACK nesta tarefa (card separa por stack)'),
    frontend: z.string().optional().describe('o que foi feito no FRONT nesta tarefa (card separa por stack)'),
    mobile: z.string().optional().describe('o que foi feito no MOBILE nesta tarefa (card separa por stack)'),
  },
  async ({ repo, configPath, summary, backend, frontend, mobile }) => {
    requireLicense();
    const cfg = configPath || `${repo}/qa-gate.config.json`;
    const r = await runGate(repo, cfg);
    // RECIBO VERDE: prova determinística p/ o git-guard liberar o commit (front/back).
    // Só grava no verde; qualquer edição posterior invalida (git-guard compara com o
    // mtime dos arquivos staged). Sem recibo fresco = commit BLOQUEADO (VS-GATE-001).
    try {
      const receipt = join(repo, '.git', 'qa-gate-green.json');
      if (r.status === 'green') {
        let branch = '';
        try { branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repo, encoding: 'utf8' }).trim(); } catch {}
        writeFileSync(receipt, JSON.stringify({ status: 'green', branch, ts: Date.now() }));
      }
    } catch {}
    // COMPROVANTE WhatsApp — AGUARDA e CAPTURA o status de ENTREGA (não é mais
    // fire-and-forget). Verde no gate != recibo entregue: a IA/dev precisa VER se
    // o WhatsApp saiu, senão é ponto cego. notify() nunca lança.
    let waStatus = null;
    try {
      const project = projectName(repo);
      const task = taskFromBranch(repo);
      // correção por stack (card separa Back/Front/Mobile) ou string única (summary)
      const solution = (backend || frontend || mobile) ? { back: backend, front: frontend, mobile } : summary;
      if (r.status === 'green') {
        waStatus = await notify({ project, task, kind: 'green', problem: 'gate verde', solution }, repo);
      } else if (r.status === 'red') {
        const errs = (r.results || [])
          .filter((x) => x.status === 'red')
          .flatMap((x) => x.errors || [])
          .slice(0, 3)
          .join('; ');
        waStatus = await notify({ project, task, kind: 'red', problem: errs || 'gate vermelho', solution }, repo);
      }
    } catch (e) { waStatus = { whatsapp: { ok: false, error: String(e) } }; }
    const lines = [`status: ${r.status}${r.reason ? ' — ' + r.reason : ''}`];
    (r.results || []).forEach((x) => lines.push(`  ${x.status === 'green' ? '✔' : x.status === 'red' ? '✖' : '·'} ${x.name}${x.errors?.length ? ' — ' + x.errors.join('; ') : ''}`));
    // ENTREGA do recibo (fecha o ponto cego: verde no gate != recibo entregue).
    // Olha TODOS os canais (Slack + WhatsApp): entregue se qualquer um saiu; canal
    // opcional que falhou vira nota, nao alarme falso.
    if (waStatus) { lines.push(receiptSummary(waStatus)); }
    if (r.needs?.length) {
      lines.push('FALTA pro gate rodar (a IA resolve; commit fica BLOQUEADO até o gate VERDE — não commite nem espere uma pessoa):');
      r.needs.forEach((n) => lines.push(`  → ${n.kind}${n.detail ? ': ' + n.detail : ''}${n.baseUrl ? ' (' + n.baseUrl + ')' : ''}${n.uiFiles ? ' [' + n.uiFiles.slice(0, 6).join(', ') + ']' : ''}`));
    }
    const content = [text(lines.join('\n'))];
    const firstRed = (r.results || []).find((x) => x.status === 'red' && x.screenshot);
    if (firstRed) { const img = imageOf(firstRed.screenshot); if (img) { content.push(img); } }
    return { content, isError: r.status === 'red' || r.status === 'error' || r.status === 'blocked' };
  });

/* ---- vsqa_scenario (livre) — lê a US e devolve o cenário-rascunho ---- */
server.tool('vsqa_scenario',
  'VSqa: lê a US no tracker (Redmine) e devolve o CENÁRIO-rascunho (1 passo por critério de aceite) + o que falta mapear (path/seletores). Não executa nada. Livre.',
  { issueId: z.union([z.string(), z.number()]), repo: z.string().describe('repo p/ resolver o qa-gate.company.json') },
  async ({ issueId, repo }) => {
    const company = loadCompanyConfig(repo);
    const tracker = makeTracker(company);
    const raw = await tracker.getIssue(issueId);
    const us = normalizeIssue(raw);
    const scenario = buildScenario(us);
    const check = validateScenario(scenario);
    const out = {
      us: { id: us.id, titulo: us.titulo, modulo: us.modulo, criterios: us.criterios },
      scenario,
      ready: check.ready,
      missing: check.missing,
    };
    return { content: [text(JSON.stringify(out, null, 2))] };
  });

/* ---- vsqa_test_task (licenciado) — orquestra US->cenário->execução->veredito ---- */
server.tool('vsqa_test_task',
  'VSqa: testa a US inteira como um QA. Lê a US no tracker, cria TAREFA de Cenário e de Execução, roda o cenário no browser real e dá o veredito: VERDE fecha / VERMELHO devolve pro dev. Passe `scenario` (JSON mapeado com path/seletores) obtido do vsqa_scenario; sem ele volta o rascunho p/ completar. humanInLoop=true (default) só comenta; false fecha/devolve sozinho.',
  {
    issueId: z.union([z.string(), z.number()]),
    repo: z.string(),
    configPath: z.string().describe('qa-gate.config.json do projeto (alvo do browser)'),
    alvo: z.enum(['front', 'mobile']).optional(),
    scenario: z.any().optional().describe('cenário já mapeado (do vsqa_scenario, com path/seletores preenchidos)'),
    humanInLoop: z.boolean().optional(),
    createTasks: z.boolean().optional(),
  },
  async ({ issueId, repo, configPath, alvo, scenario, humanInLoop, createTasks }) => {
    requireLicense();
    const company = loadCompanyConfig(repo);
    assertInstalled(company);
    const tracker = makeTracker(company);
    const cfg = loadConfig(configPath);
    if (!cfg) { throw new Error('sem config em ' + configPath); }
    const [tgt] = targetsFor(cfg, alvo);
    if (!tgt) { throw new Error('nenhum alvo no config'); }
    const base = tgt.tcfg.baseUrl;
    const up = tgt.tcfg.start
      ? await ensureUp(base, tgt.tcfg.healthPath || cfg.healthPath, tgt.tcfg)
      : await checkApp(base, tgt.tcfg.healthPath || cfg.healthPath);
    if (!up) { return { content: [text(`✖ app fora do ar em ${base} — suba o ambiente e rode de novo`)], isError: true }; }
    const r = await runVsqa(issueId, {
      tracker,
      target: tgt.tcfg,
      repo,
      scenario,
      humanInLoop: humanInLoop !== false,
      createTasks: createTasks !== false,
    });
    if (r.stage === 'scenario-draft') {
      return { content: [text('CENÁRIO INCOMPLETO — complete e rechame com opts.scenario:\n' + JSON.stringify({ scenario: r.scenario, missing: r.missing }, null, 2))], isError: true };
    }
    const lines = [
      `US #${issueId} — ${r.veredito.verde ? '✅ VERDE' : r.veredito.bloqueado ? '⚠ BLOQUEADO' : '❌ VERMELHO'}`,
      r.veredito.resumo,
      r.scenarioTask ? `Cenário: ${r.scenarioTask.url || r.scenarioTask.id}` : '',
      r.execTask ? `Execução: ${r.execTask.url || r.execTask.id}` : '',
      `Ações: ${(r.actions || []).join('; ')}`,
    ];
    const content = [text(lines.filter(Boolean).join('\n'))];
    (r.report.steps || []).filter((s) => s.status === 'red' && s.screenshot).forEach((s) => {
      const img = imageOf(s.screenshot);
      if (img) { content.push(img); }
    });
    return { content, isError: !r.veredito.verde };
  });

/* ---- vsanalista_template (livre) — template + membros p/ o modelo preencher ---- */
server.tool('vsanalista_template',
  'VSanalista: devolve o TEMPLATE real de Épico/HU do RURAP (trackers, campos custom, as 3 Tarefas Técnicas por HU) + os MEMBROS do projeto com papéis, p/ escolher dev/QA. Livre. Use antes de vsanalista_create pra montar a spec no padrão certo.',
  { repo: z.string(), projectId: z.number().optional() },
  async ({ repo, projectId }) => {
    const company = loadCompanyConfig(repo);
    const tracker = makeTracker(company);
    const pid = projectId || company.integrations?.redmine?.projectId;
    let membros = [];
    try { membros = await tracker.getMembers(pid); } catch (e) { membros = [{ erro: String(e.message) }]; }
    const skeleton = {
      titulo: '<título do épico>',
      hus: [{
        modulo: '<Ex.: Planejamento>', titulo: 'Deve <comportamento>',
        como: 'Usuário', solicito: '<o que>', para: '<benefício>',
        preCondicoes: [], posCondicoes: [], fluxos: [], regras: [],
        criteriosTeste: ['<critério verificável 1>'], integra: false, pontos: '',
        devId: '<id do dev>', qaId: '<id do QA>',
      }],
    };
    const out = { trackers: TRACKERS, customFields: CUSTOM_FIELDS, tarefasPorHU: HU_TASKS, projectId: pid, membros, skeletonSpec: skeleton };
    return { content: [text(JSON.stringify(out, null, 2))] };
  });

/* ---- vsanalista_create (licenciado) — cria Épico + HUs + Tarefas no padrão RURAP ---- */
server.tool('vsanalista_create',
  'VSanalista: cria no Redmine o Épico + HUs + as 3 Tarefas Técnicas por HU (Codificar->dev, Especificar Testes/Execução dos testes->QA), no padrão real dos analistas. dryRun=true (default) só mostra o que criaria; dryRun=false escreve de verdade. devId/qaId = dev e QA do projeto (obrigatórios).',
  {
    repo: z.string(),
    spec: z.any().describe('{ titulo, hus:[{modulo,titulo,como,solicito,para,criteriosTeste,...}] }'),
    projectId: z.number().optional(),
    devId: z.number().optional(),
    qaId: z.number().optional(),
    dryRun: z.boolean().optional(),
  },
  async ({ repo, spec, projectId, devId, qaId, dryRun }) => {
    requireLicense();
    const company = loadCompanyConfig(repo);
    assertInstalled(company);
    const tracker = makeTracker(company);
    const rc = company.integrations?.redmine || {};
    const pid = projectId || rc.projectId;
    const dev = devId != null ? devId : rc.analista?.devId;
    const qa = qaId != null ? qaId : rc.analista?.qaId;
    const r = await createEpic(spec, { tracker, projectId: pid, devId: dev, qaId: qa, dryRun: dryRun !== false });
    if (r.stage === 'invalid') { return { content: [text('SPEC inválida:\n' + r.errors.map((e) => '  - ' + e).join('\n'))], isError: true }; }
    if (r.stage === 'preview') { return { content: [text('PREVIEW (dryRun) — nada criado. Rode com dryRun:false p/ criar:\n' + JSON.stringify(r.preview, null, 2))] }; }
    const lines = [`✔ Épico criado: ${r.epic.url}`];
    r.hus.forEach((h) => {
      lines.push(`  HU ${h.url} — ${h.subject}`);
      h.tarefas.forEach((t) => lines.push(`    · ${t.name} (${t.role}) ${t.url}`));
    });
    return { content: [text(lines.join('\n'))] };
  });

/* ---- vsdiretoria_report (licenciado) — painel executivo BI + PDF ---- */
server.tool('vsdiretoria_report',
  'VSdiretoria: gera o PAINEL DA DIRETORIA (BI) do projeto — produtividade, qualidade (defeitos/NC), governança (aderência ao fluxo) e pessoas — em HTML moderno (dark/light) e opcionalmente PDF. Dados reais do Redmine.',
  {
    repo: z.string(),
    projectId: z.number().optional(),
    out: z.string().optional().describe('caminho do HTML de saída'),
    pdf: z.boolean().optional().describe('também exporta PDF (Playwright)'),
    since: z.string().optional().describe('YYYY-MM-DD'),
    theme: z.enum(['light', 'dark']).optional(),
  },
  async ({ repo, projectId, out, pdf, since, theme }) => {
    requireLicense();
    const company = loadCompanyConfig(repo);
    assertInstalled(company);
    const tracker = makeTracker(company);
    const pid = projectId || company.integrations?.redmine?.projectId;
    if (!pid) { throw new Error('sem projeto: passe projectId ou configure integrations.redmine.projectId'); }
    const r = await writeDashboard({
      tracker, projectId: pid, since: since || null,
      out: out || 'painel-diretoria.html', pdf: !!pdf, theme: theme || 'light',
    });
    const t = r.kpis.tiles;
    const lines = [
      `✔ Painel gerado: ${r.htmlPath}${r.pdfPath ? ' | PDF: ' + r.pdfPath : ''}`,
      `entregues ${t.entregues} (${t.taxaEntrega}%) · abertas ${t.emAberto} · defeitos ${t.defeitos} (${t.defeitosPorHU}/HU) · NC ${t.naoConformidades}`,
      `aderência ao fluxo ${r.kpis.aderencia.comTree}% (amostra ${r.kpis.aderencia.amostra} HUs)`,
    ];
    return { content: [text(lines.join('\n'))] };
  });

/* ---- vs_interview (livre) — onboarding conversacional, resumível ---- */
server.tool('vs_interview',
  'Entrevista de onboarding da suite: captura o padrão da empresa/time que os módulos leem — nada de adivinhar. Chame sem id/value pra ver a próxima pergunta; com id+value pra responder. Estado persiste (resumível). Sets: empresa, vendas, dev (branch/commit/doc), analista (tracker+chave+projeto), qa (sistema+chave+exemplo).',
  {
    set: z.enum(['empresa', 'vendas', 'dev', 'analista', 'qa']),
    id: z.string().optional().describe('id da pergunta sendo respondida'),
    value: z.any().optional().describe('resposta (string, número, ou lista separada por linha/;)'),
  },
  async ({ set, id, value }) => {
    let state = { setId: set, answers: itwLoad(set) };
    let erro = null;
    if (id != null) {
      const r = itwAnswer(state, id, value);
      if (!r.ok) { erro = r.error; }
      else { state = r.state; itwSave(set, state.answers); }
    }
    const prog = itwProgress(state);
    const nx = itwNext(state);
    const out = {
      set, progresso: prog, erro,
      proxima: nx ? { id: nx.id, secao: nx.secao, pergunta: nx.pergunta, tipo: nx.tipo, opcoes: nx.opcoes || null, obrigatoria: !!nx.required, ajuda: nx.help || null } : null,
      completa: prog.completa,
    };
    return { content: [text(JSON.stringify(out, null, 2))], isError: !!erro };
  });

/* ---- vs_apply_config (livre) — aplica os perfis no company.json (instalação) ---- */
server.tool('vs_apply_config',
  'Aplica as respostas da entrevista no company-config da instalação: dev -> branch/commit/doc; analista -> integrations.redmine (URL/chave/projeto); qa -> integrations.qa. Rode após vs_interview dos sets dev/analista/qa.',
  {},
  async () => {
    const r = itwApplyAll();
    return { content: [text(`✔ config aplicada em ${r.path}\nAtualizado: ${r.changed.join(', ') || 'nada (sem perfis dev/analista/qa)'}`)] };
  });

/* ---- vsvendas_* (licenciado) — copiloto de vendas usando o perfil ---- */
// Vendas + Marketing é uma linha própria: NÃO exige QA/analista (gate do fluxo dev),
// só o perfil empresa+vendas (needInterview cobre isso).
const vendasHandler = (fn) => async (args) => {
  requireLicense();
  try {
    return { content: [text(JSON.stringify(fn(args), null, 2))] };
  } catch (e) {
    if (e.needInterview) { return { content: [text('⚠ ' + e.message + '\nRode `vs_interview` (sets empresa e vendas) primeiro.')], isError: true }; }
    throw e;
  }
};

server.tool('vsvendas_qualify',
  'VSvendas: qualifica um lead usando o perfil da empresa (entrevista). Retorna score, faixa (quente/morno/frio), motivos e próximo passo.',
  { lead: z.string().describe('mensagem/descrição do lead') },
  vendasHandler(({ lead }) => vsQualificar(lead)));

server.tool('vsvendas_followup',
  'VSvendas: redige o follow-up no tom da empresa e no momento do funil.',
  { nome: z.string().optional(), etapa: z.string().optional().describe('etapa do funil'), dor: z.string().optional() },
  vendasHandler((ctx) => vsFollowup(ctx)));

server.tool('vsvendas_objection',
  'VSvendas: responde a objeção do cliente (usa as respostas da empresa; senão biblioteca genérica).',
  { fala: z.string().describe('a objeção dita pelo cliente') },
  vendasHandler(({ fala }) => vsObjecao(fala)));

server.tool('vsvendas_ads_list',
  'VSvendas: lista os produtos a partir da PASTA de fotos (agrupa variantes). Diz o que falta (preço/texto). Postar automático nas plataformas é roadmap; aqui gera o anúncio pronto pra postar.',
  { dir: z.string().describe('pasta com as imagens dos produtos') },
  vendasHandler(({ dir }) => vsListar(dir)));

server.tool('vsvendas_ads_build',
  'VSvendas: gera o anúncio pronto de UM produto por plataforma (Instagram, Marketplace, Mercado Livre, OLX, WhatsApp), no tom da empresa. Passe preço e, se quiser, descrição.',
  {
    produto: z.string(),
    preco: z.number(),
    descricao: z.string().optional(),
    imagens: z.array(z.string()).optional(),
    plataformas: z.array(z.string()).optional().describe('vazio = todas'),
  },
  vendasHandler(({ produto, preco, descricao, imagens, plataformas }) => vsAnunciar({ produto, preco, descricao, imagens }, plataformas)));

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[qa-gate-mcp] pronto (stdio)');
