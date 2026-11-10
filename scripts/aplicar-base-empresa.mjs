#!/usr/bin/env node
/**
 * Pede ao Agente 0007 para rever e refazer um bot ou TODOS os bots do Hotel:
 * - Corrige nicho, o que a empresa faz, produtos e o que pode somar;
 * - Refaz pesquisa básica com base curada oficial (sem lixo de busca externa);
 * - Reconstrói mapa mental (vs0007-mapa.json + preparacao.mapaMental), frases e forma de agir.
 *
 * Uso:
 *   node scripts/aplicar-base-empresa.mjs --all --apply
 *   node scripts/aplicar-base-empresa.mjs --agenteId bot-... --dir /caminho/vscrm --apply
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DATASET_BOTS,
  listarBots,
  revisarERefazerBot,
  revisarERefazerTodosOsBots,
} from '../engine/vs0007/bots.mjs';
import { DATASET_MAPA } from '../engine/vs0007/mapa.mjs';

const args = process.argv.slice(2);
const opcao = (nome, padrao = '') => {
  const indice = args.indexOf(`--${nome}`);
  return indice >= 0 ? (args[indice + 1] || '') : padrao;
};
const aplicar = args.includes('--apply');
const todos = args.includes('--all') || !args.includes('--agenteId');
const agenteId = opcao('agenteId', 'bot-assistencia-e-suporte-tecnico-1');
const dir = resolve(opcao('dir', process.env.VSCRM_DIR || '/home/veloso/.qa-gate-crm-local/vscrm'));
process.env.VSCRM_DIR = dir;

const botsAtuais = listarBots();
if (!botsAtuais.length) {
  console.error(`Nenhum bot encontrado em ${dir}`);
  process.exit(1);
}

if (!aplicar) {
  console.log(JSON.stringify({
    modo: 'dry-run',
    dir,
    escopo: todos ? 'todos-os-bots' : agenteId,
    bots: botsAtuais.map((b) => ({
      agenteId: b.agenteId,
      nome: b.nome,
      nichoAtual: b.preparacao?.nicho || '',
      especialidadeAtual: b.especialidade,
      funcaoAtual: b.perfil?.funcao || '',
    })),
  }, null, 2));
  console.log('\nDry-run. Use --apply para gravar (com backup automático).');
  process.exit(0);
}

const agora = new Date().toISOString();
const destinoBackup = join(dir, `backup-revisao-0007-${agora.replace(/[:.]/g, '-')}`);
mkdirSync(destinoBackup, { recursive: true });
for (const arq of [`${DATASET_BOTS}.json`, `${DATASET_MAPA}.json`]) {
  const origem = join(dir, arq);
  if (existsSync(origem)) copyFileSync(origem, join(destinoBackup, arq));
}

const resultado = todos
  ? revisarERefazerTodosOsBots({ autorizado: true, por: '0007' })
  : revisarERefazerBot({ agenteId, autorizado: true, por: '0007' });

console.log(JSON.stringify({
  modo: 'apply',
  dir,
  backup: destinoBackup,
  ok: resultado.ok,
  resumo: todos
    ? resultado.resultados.map((r) => ({
      agenteId: r.agenteId,
      nome: r.nome,
      papel: r.papel,
      base: r.base?.id,
      nicho: r.nicho,
      especialidade: r.especialidade,
      funcao: r.funcao,
      mapa: r.mapa,
      criticosOk: r.testes?.criticosOk,
      faltamParametros: r.diagnostico?.faltam?.length ?? 0,
    }))
    : {
      agenteId: resultado.agenteId,
      nome: resultado.nome,
      papel: resultado.papel,
      base: resultado.base?.id,
      nicho: resultado.nicho,
      especialidade: resultado.especialidade,
      funcao: resultado.funcao,
      mapa: resultado.mapa,
      criticosOk: resultado.testes?.criticosOk,
      faltamParametros: resultado.diagnostico?.faltam?.length ?? 0,
    },
}, null, 2));
