/**
 * Config do salão, por casa (empresa/loja) — guarda o que liga o CRM ao salão:
 * o Evolution (WhatsApp não-oficial: url, key, instância) e o Cadê Você (url, token).
 * É o que a tela "Salão → Conexão" salva, pra NÃO depender de variável de ambiente
 * nem de reiniciar a produção. Cada salão tem o seu (arquivo 0600 na casa).
 *
 * Segredos (key/token) ficam aqui, nunca no git — igual às outras credenciais do
 * projeto. A tela mostra só se estão preenchidos, não o valor.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { dentroDaCasa, casa } from '../casa.mjs';

const diretorioConfig = () => {
  const definido = process.env.VSCADEVC_DIR || process.env.VSSALAO_DIR;
  if (definido) { return definido; }
  const novo = dentroDaCasa('vscadevc');
  const legado = dentroDaCasa('vssalao');
  if (existsSync(join(novo, 'config.json'))) { return novo; }
  if (existsSync(join(legado, 'config.json'))) { return legado; }
  return novo;
};
const arq = () => join(diretorioConfig(), 'config.json');
const str = (v, n = 300) => String(v ?? '').trim().slice(0, n);

const PADRAO = {
  ativo: true, evolutionUrl: '', evolutionKey: '', evolutionInstance: '',
  cadevcUrl: '', cadevcToken: '', numero: '', nomeBot: '', personalidade: 'acolhedor',
  nicho: 'cadevc-barbearia', metaAgenda: false, bot0007Id: '',
};

export function config() {
  let salvo = {};
  try {
    salvo = JSON.parse(readFileSync(arq(), 'utf8'));
  } catch {
    salvo = {};
  }

  /* AJUSTE FIXO LOCAL: Trocando localhost/domínios pelo IP limpo 127.0.0.1.
     Isso pula a resolução de DNS do Linux e evita o erro EAI_AGAIN. */
  return {
    evolutionUrl: salvo.evolutionUrl || process.env.EVOLUTION_URL || 'http://127.0.0.1:8085',
    evolutionKey: salvo.evolutionKey || process.env.EVOLUTION_KEY || '',
    evolutionInstance: salvo.evolutionInstance || process.env.EVOLUTION_INSTANCE || 'inst-A',
    cadevcUrl: salvo.cadevcUrl || process.env.CADEVC_URL || 'http://127.0.0.1:8085',
    cadevcToken: salvo.cadevcToken || process.env.CADEVC_TOKEN || '',
    numero: salvo.numero || '',
    nomeBot: salvo.nomeBot || 'o atendimento do salão',
    personalidade: ['acolhedor', 'profissional', 'direto'].includes(salvo.personalidade) ? salvo.personalidade : 'acolhedor',
    nicho: salvo.nicho || 'cadevc-barbearia',
    bot0007Id: str(salvo.bot0007Id, 120),
    ativo: salvo.ativo !== false,
    metaAgenda: !!salvo.metaAgenda,
  };
}


/** Salva só os campos enviados (vazio = apaga aquele campo). */
export function salvar(d = {}) {
  if (d.personalidade !== undefined && !['acolhedor', 'profissional', 'direto'].includes(String(d.personalidade))) {
    return { ok: false, motivo: 'personalidade inválida' };
  }
  if (d.nomeBot !== undefined && String(d.nomeBot).trim().length > 40) {
    return { ok: false, motivo: 'o nome do atendimento deve ter até 40 caracteres' };
  }
  const c = { ...PADRAO };
  try { Object.assign(c, JSON.parse(readFileSync(arq(), 'utf8'))); } catch { /* primeira vez */ }
  for (const k of Object.keys(PADRAO)) {
    if (d[k] === undefined) { continue; }
    c[k] = typeof PADRAO[k] === 'boolean' ? (d[k] === true || d[k] === 'true' || d[k] === 1 || d[k] === '1') : str(d[k], k.endsWith('Url') ? 300 : 200);
  }
  mkdirSync(diretorioConfig(), { recursive: true, mode: 0o700 });
  writeFileSync(arq(), JSON.stringify(c, null, 2), { mode: 0o600 });
  return { ok: true };
}

/** De qual TENANT (CNPJ) é uma instância do Evolution. '' = a empresa dona da
 *  instalação (raiz); uma string = o CNPJ do cliente; null = instância desconhecida.
 *  É assim que o webhook descobre de qual salão veio a mensagem — multi-tenant. */
function lerConfigDe(dir) { try { return JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')); } catch { return null; } }
export function tenantPorInstancia(instancia) {
  if (!instancia) { return null; }
  const caminhos = (base) => ['vscadevc', 'vssalao'].map((nome) => join(base, nome));
  if (caminhos(casa()).some((dir) => lerConfigDe(dir)?.evolutionInstance === instancia)
    || process.env.EVOLUTION_INSTANCE === instancia) { return ''; }
  let empresas = [];
  try { empresas = readdirSync(join(casa(), 'empresas')); } catch { /* sem empresas clientes */ }
  for (const cnpj of empresas) {
    if (caminhos(join(casa(), 'empresas', cnpj)).some((dir) => lerConfigDe(dir)?.evolutionInstance === instancia)) { return cnpj; }
  }
  return null;
}

/** O que a tela pode ver: urls e instância em claro; segredos só como preenchido/sim-não. */
export function paraTela() {
  const c = config();
  return {
    evolutionUrl: c.evolutionUrl, evolutionInstance: c.evolutionInstance, evolutionKeyPreenchida: !!c.evolutionKey,
    cadevcUrl: c.cadevcUrl, cadevcTokenPreenchido: !!c.cadevcToken, numero: c.numero,
    nomeBot: c.nomeBot, personalidade: c.personalidade, nicho: c.nicho,
    bot0007Id: c.bot0007Id,
    completo: !!(c.evolutionUrl && c.evolutionKey && c.evolutionInstance),
    cadevcCompleto: !!(c.cadevcUrl && c.cadevcToken),
    ativo: c.ativo !== false,
  };
}
