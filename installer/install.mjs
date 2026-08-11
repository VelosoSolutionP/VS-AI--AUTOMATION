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

const HERE = dirname(fileURLToPath(import.meta.url));
export const SERVER_PATH = join(dirname(HERE), 'mcp', 'server.mjs');

/**
 * @param {{email:string, empresa?:string, produtos:string[], detectImpl?:Function, installImpl?:Function}} dados
 */
export async function runInstall(dados) {
  const sel = validarSelecao(dados.produtos);
  if (!sel.ok) { return { ok: false, erros: sel.erros }; }

  const trial = await issueTrial({ email: dados.email });
  const serverPath = dados.serverPath || SERVER_PATH;

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
    email: dados.email,
    empresa: dados.empresa || null,
    escolhidos: sel.escolhidos,
    trial,
    serverPath,
    configurados,
    semFerramenta: configurados.length === 0,
    treinamento: {
      gratis: true,
      mensagem: 'Treinamento GRÁTIS incluso — recomendamos fortemente fazer antes de começar. Fala com a gente pra agendar.',
    },
  };
}
