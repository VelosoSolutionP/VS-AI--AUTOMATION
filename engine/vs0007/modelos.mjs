/**
 * Modelos de IA free do 0007: o dono escolhe no catálogo do Ollama, a tela baixa com
 * progresso e o modelo entra no catálogo e no mapa do 0007 — fecha o fluxo na tela.
 *
 * Trava da máquina (memória "Máquina sem folga para Ollama"): modelo maior que 3B
 * derrubou a produção. Acima disso o download é recusado até chegar a RAM nova
 * (VS_OLLAMA_MAX_B sobe o teto).
 */
import { load, save } from '../vscrm/store.mjs';
import { MODELOS_FREE_0007 } from './auditoria.mjs';

export const DATASET_EXTRAS = 'vs0007-modelos-extra';
export const URL_CATALOGO = 'https://ollama.com/library';
const urlOllama = () => (process.env.OLLAMA_URL || process.env.VS_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const tetoB = () => Number(process.env.VS_OLLAMA_MAX_B) || 3;

/** Sugestões leves e gratuitas do catálogo do Ollama (tamanho aproximado do download). */
export const SUGESTOES = Object.freeze([
  { id: 'gemma3:1b', nome: 'Gemma 3 1B (Google)', tamanho: '≈ 815 MB', indicacao: 'Respostas curtas e rápidas; bom para triagem e FAQ.' },
  { id: 'qwen3:1.7b', nome: 'Qwen 3 1.7B', tamanho: '≈ 1.4 GB', indicacao: 'Geração nova do Qwen; português melhor que o 2.5 do mesmo tamanho.' },
  { id: 'llama3.2:3b', nome: 'Llama 3.2 3B (Meta)', tamanho: '≈ 2.0 GB', indicacao: 'Conversa mais natural; o maior que esta máquina aguenta.' },
  { id: 'smollm2:1.7b', nome: 'SmolLM2 1.7B', tamanho: '≈ 1.8 GB', indicacao: 'Leve, para resumo e classificação de mensagens.' },
  { id: 'qwen2.5:1.5b', nome: 'Qwen 2.5 1.5B', tamanho: '986 MB', indicacao: 'O padrão de atendimento humanizado do 0007.' },
]);

/** Catálogo do 0007 = os homologados de fábrica + os que o dono adicionou. */
export function catalogo() {
  const extras = load(DATASET_EXTRAS, []);
  const ids = new Set(MODELOS_FREE_0007.map((m) => m.id.toLowerCase()));
  return [...MODELOS_FREE_0007, ...extras.filter((m) => !ids.has(String(m.id).toLowerCase()))];
}

/** Nome válido do Ollama (ex.: gemma3:1b, hf.co/x/y:Q4). Devolve erro em texto ou null. */
export function validarNome(modelo) {
  const id = String(modelo || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._\/-]{0,80}(:[a-z0-9._-]{1,40})?$/.test(id)) return { erro: 'Nome de modelo inválido. Copie do catálogo, ex.: gemma3:1b' };
  const tam = id.match(/[:\-_](\d+(?:\.\d+)?)b\b/);
  if (tam && Number(tam[1]) > tetoB()) return { erro: `${id} tem ${tam[1]}B de parâmetros: esta máquina aguenta até ${tetoB()}B sem travar a produção. Escolha um menor (1B a ${tetoB()}B).` };
  if (!tam && !/:/.test(id)) return { erro: 'Informe o tamanho junto (ex.: gemma3:1b), para eu conferir se a máquina aguenta.' };
  return { id };
}

const downloads = new Map(); // id → { id, estado, status, total, feito, erro, inicio, fim }

export function statusDownloads() {
  return [...downloads.values()].sort((a, b) => b.inicio - a.inicio).slice(0, 10);
}

/**
 * Começa o download no Ollama (em segundo plano, com progresso). Ao terminar, grava o
 * modelo no catálogo do 0007 e chama `aoTerminar(modelo)` (mapa + diário).
 */
export function baixar({ modelo, nome = null, indicacao = null, fetch: fetchFn = globalThis.fetch, aoTerminar = null } = {}) {
  const v = validarNome(modelo);
  if (v.erro) return { erro: v.erro };
  const atual = downloads.get(v.id);
  if (atual && atual.estado === 'baixando') return { ok: true, download: atual, jaEstava: true };
  const d = { id: v.id, estado: 'baixando', status: 'iniciando', total: 0, feito: 0, erro: null, inicio: Date.now(), fim: null };
  downloads.set(v.id, d);
  (async () => {
    try {
      const r = await fetchFn(`${urlOllama()}/api/pull`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: v.id, stream: true }) });
      if (!r.ok || !r.body) throw new Error(`Ollama respondeu HTTP ${r.status}`);
      const dec = new TextDecoder(); let resto = '';
      for await (const pedaco of r.body) {
        resto += dec.decode(pedaco, { stream: true });
        const linhas = resto.split('\n'); resto = linhas.pop();
        for (const l of linhas) {
          if (!l.trim()) continue;
          const j = JSON.parse(l);
          if (j.error) throw new Error(j.error);
          d.status = j.status || d.status;
          if (j.total) { d.total = j.total; d.feito = j.completed || 0; }
        }
      }
      if (d.status !== 'success') throw new Error(`download não terminou (${d.status})`);
      const sug = SUGESTOES.find((s) => s.id === v.id);
      const extras = load(DATASET_EXTRAS, []).filter((m) => m.id !== v.id);
      const tamanhoGb = d.total ? `${(d.total / 1e9).toFixed(1)} GB` : (sug?.tamanho || '');
      if (!MODELOS_FREE_0007.some((m) => m.id === v.id)) {
        extras.push({ id: v.id, nome: nome || sug?.nome || v.id, tamanho: tamanhoGb, papel: 'adicionado-pelo-dono', indicacao: indicacao || sug?.indicacao || 'Adicionado pelo dono a partir do catálogo free do Ollama.', padraoMessenger: false, adicionadoEm: new Date().toISOString() });
        save(DATASET_EXTRAS, extras);
      }
      d.estado = 'pronto'; d.fim = Date.now();
      if (aoTerminar) await aoTerminar(v.id);
    } catch (e) {
      d.estado = 'erro'; d.erro = String(e.message || e).slice(0, 300); d.fim = Date.now();
    }
  })();
  return { ok: true, download: d };
}
