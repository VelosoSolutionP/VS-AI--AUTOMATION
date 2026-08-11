/**
 * Instalador — orquestra a instalação: valida seleção -> emite trial 7 dias ->
 * detecta a IDE/IA -> escreve o MCP no config dela. Sem ferramenta detectada,
 * devolve instruções manuais.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validarSelecao } from './catalog.mjs';
import { issueTrial } from './trial.mjs';
import { detect } from './detect.mjs';
import { serverEntry, installIntoTool } from './mcp-config.mjs';
import { requiredSetsFor, precisaApplyConfig, buildAndValidate } from './onboarding.mjs';
import { saveProfile } from '../engine/interview/index.mjs';
import { applyAll } from '../engine/interview/apply.mjs';
import { markInstalled } from '../engine/trial-lock.mjs';
import { scheduleTrialLock } from './schedule-lock.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SERVER_PATH = join(dirname(HERE), 'mcp', 'server.mjs');

/**
 * @param {{email:string, empresa?:string, produtos:string[], respostas?:object,
 *   detectImpl?:Function, installImpl?:Function, saveImpl?:Function, applyImpl?:Function}} dados
 */
export async function runInstall(dados) {
  const sel = validarSelecao(dados.produtos);
  if (!sel.ok) { return { ok: false, erros: sel.erros }; }

  // 1. Entrevista inline: valida as respostas dos sets obrigatórios pros produtos escolhidos
  const sets = requiredSetsFor(sel.escolhidos);
  const { perfis, erros } = buildAndValidate(sets, dados.respostas || {});
  if (erros.length) { return { ok: false, erros, sets }; }

  // 2. Persiste os perfis e aplica no company.json quando for fluxo dev (analista+qa)
  const saveImpl = dados.saveImpl || saveProfile;
  for (const [setId, answers] of Object.entries(perfis)) { saveImpl(setId, answers); }
  if (precisaApplyConfig(sel.escolhidos)) {
    try { (dados.applyImpl || applyAll)(); }
    catch (e) { return { ok: false, erros: [e.message], sets }; }
  }

  const contato = dados.whatsapp || dados.email || null;
  const trial = await (dados.trialImpl || issueTrial)({ email: contato || 'trial@velososolution.online', name: dados.nome });
  const serverPath = dados.serverPath || SERVER_PATH;

  // 3. Trava do teste: marca a instalação + agenda o cron/tarefa que trava em 7 dias
  (dados.markImpl || markInstalled)({ days: trial.days, plan: 'trial' });
  const trava = (dados.scheduleImpl || scheduleTrialLock)({ days: trial.days });

  const detectImpl = dados.detectImpl || detect;
  const installImpl = dados.installImpl || installIntoTool;
  const alvos = detectImpl();
  const entry = serverEntry(serverPath, trial.token);

  const configurados = [];
  for (const a of alvos) {
    try { configurados.push({ tool: a.tool, ...installImpl(a.configPath, entry) }); }
    catch (e) { configurados.push({ tool: a.tool, erro: String(e.message) }); }
  }

  return {
    ok: true,
    contato,
    empresa: dados.empresa || null,
    escolhidos: sel.escolhidos,
    trial,
    trava,
    serverPath,
    configurados,
    semFerramenta: configurados.length === 0,
    treinamento: {
      gratis: true,
      mensagem: 'Treinamento GRÁTIS incluso — recomendamos fortemente fazer antes de começar. Fala com a gente pra agendar.',
    },
  };
}
