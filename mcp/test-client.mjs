import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER = new URL('./server.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const CFG = 'C:/Veloso/ProjetosMsb/Rurap/sigater/qa-gate.config.json';

function summarize(r) {
  return (r.content || []).map((c) => c.type === 'text' ? c.text : `[image ${Math.round((c.data || '').length / 1024)}KB]`).join(' | ');
}

async function connect(env) {
  const transport = new StdioClientTransport({ command: 'node', args: [SERVER], env: { ...process.env, ...env } });
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

console.log('=== 1) COM licença demo ===');
let c = await connect({ QA_GATE_ALLOW_DEMO: '1', QA_GATE_LICENSE: 'DEMO-teste' });
const tools = await c.listTools();
console.log('TOOLS:', tools.tools.map((t) => t.name).join(', '));

console.log('\n-- qa_check_app --');
console.log(summarize(await c.callTool({ name: 'qa_check_app', arguments: { baseUrl: 'http://localhost:9080' } })));

console.log('\n-- qa_list_flows --');
console.log(summarize(await c.callTool({ name: 'qa_list_flows', arguments: { configPath: CFG } })));

console.log('\n-- qa_simulate (veiculos/create, espera VERDE) --');
const sim = await c.callTool({ name: 'qa_simulate', arguments: {
  configPath: CFG, path: '/planejamento/gerenciamento-veiculos/create', submitText: 'Salvar', expectFriendlyError: true,
} });
console.log('isError:', sim.isError, '|', summarize(sim));
await c.close();

console.log('\n=== 2) SEM licença (espera bloqueio) ===');
c = await connect({ QA_GATE_ALLOW_DEMO: '0', QA_GATE_LICENSE: '' });
const blocked = await c.callTool({ name: 'qa_simulate', arguments: { configPath: CFG, path: '/x', submitText: 'Salvar' } }).catch((e) => ({ err: e.message }));
console.log('resultado:', blocked.err ? 'ERRO: ' + blocked.err : summarize(blocked) + ' isError=' + blocked.isError);
await c.close();
console.log('\n=== FIM ===');
process.exit(0);
