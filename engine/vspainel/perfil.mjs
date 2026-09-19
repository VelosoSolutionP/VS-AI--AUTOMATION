/**
 * VSpainel — perfil, configuração e plano.
 *
 * Três telas que mostravam "ainda não preenchido" enquanto o dado já existia em
 * `~/.qa-gate/company.json` — o arquivo que a entrevista de onboarding grava e que
 * governa branch, commit, documentação e notificação de toda a suíte.
 *
 * Regra do arquivo: segredo NUNCA sai inteiro daqui. Token de licença, apikey de
 * WhatsApp e afins saem mascarados, e o painel diz onde mudar em vez de editar o que
 * pode quebrar a governança.
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadCompanyConfig, resolveConfigPath, branchName, DEFAULT_CONFIG } from '../company-config.mjs';

/** Placeholders que a entrevista deixa e que NÃO contam como preenchido. */
const VAZIO = ['', 'xxx', 'XXX', 'null', null, undefined];
const preenchido = (v) => !VAZIO.includes(v) && String(v ?? '').trim() !== '';

export function mascarar(s) {
  const v = String(s || '');
  if (!preenchido(v)) { return null; }
  if (v.length <= 6) { return '*'.repeat(v.length); }
  return `${v.slice(0, 3)}${'*'.repeat(Math.min(10, v.length - 6))}${v.slice(-3)}`;
}

export function caminhoConfig() {
  return resolveConfigPath?.() || join(homedir(), '.qa-gate', 'company.json');
}

/**
 * Perfil da empresa/dev: o que a entrevista preencheu e o que ficou pra trás.
 * O "completo" é medido pelos campos que mudam o comportamento da suíte, não por
 * todos os campos existirem.
 */
export function perfil() {
  const caminho = caminhoConfig();
  const existe = existsSync(caminho);
  const cfg = loadCompanyConfig();

  const campos = [
    { id: 'autor', rotulo: 'Autor das branches', valor: cfg.autor, usadoEm: 'nome da branch e assinatura do commit' },
    { id: 'projectName', rotulo: 'Nome do projeto', valor: cfg.projectName, usadoEm: 'recibo e notificação' },
    { id: 'branchPattern', rotulo: 'Padrão de branch', valor: cfg.branchPattern, usadoEm: 'guard de branch' },
    { id: 'commitScope', rotulo: 'Escopo do commit', valor: cfg.commitScope, usadoEm: 'guard de commit' },
  ];

  const faltando = campos.filter((c) => !preenchido(c.valor)).map((c) => c.rotulo);

  return {
    existe,
    caminho,
    atualizadoEm: existe ? new Date(statSync(caminho).mtimeMs).toISOString() : null,
    campos: campos.map((c) => ({ ...c, valor: preenchido(c.valor) ? c.valor : null, ok: preenchido(c.valor) })),
    tipos: cfg.tipos || [],
    // Mostrar o resultado, não só a regra: padrão de branch em abstrato ninguém confere.
    exemploBranch: (() => {
      try { return branchName(cfg, { tipo: 'fix', numero: '1234', slug: 'ajuste' }); } catch { return null; }
    })(),
    documentacao: {
      obrigatoria: Boolean(cfg.doc?.required),
      modelo: cfg.doc?.template || null,
    },
    push: { setUpstream: Boolean(cfg.push?.setUpstream) },
    agentes: { permitidos: Boolean(cfg.allowAgents) },
    faltando,
    completo: faltando.length === 0,
  };
}

/**
 * Configuração operacional: notificação e integrações, com os segredos mascarados.
 * Cada item diz se está LIGADO e se tem o que precisa pra funcionar — ligado sem
 * credencial é o estado que engana.
 */
export function configuracao() {
  const cfg = loadCompanyConfig();
  const wa = cfg.notify?.whatsapp || {};
  const slack = cfg.notify?.slack || {};
  const integ = cfg.integrations || {};

  const canais = [
    {
      id: 'whatsapp', nome: 'Aviso por WhatsApp',
      ligado: Boolean(wa.enabled),
      provider: wa.provider || null,
      credenciais: { telefone: preenchido(wa.phone), apikey: preenchido(wa.apikey) },
      valor: mascarar(wa.apikey),
      pronto: Boolean(wa.enabled) && preenchido(wa.phone) && preenchido(wa.apikey),
    },
    {
      id: 'slack', nome: 'Aviso por Slack',
      ligado: Boolean(slack.enabled),
      provider: slack.provider || 'webhook',
      credenciais: { webhook: preenchido(slack.webhook || slack.url) },
      valor: mascarar(slack.webhook || slack.url),
      pronto: Boolean(slack.enabled) && preenchido(slack.webhook || slack.url),
    },
  ];

  return {
    caminho: caminhoConfig(),
    canais,
    // Ligado sem credencial: a suíte acha que avisa e não avisa. É o pior estado.
    incoerentes: canais.filter((c) => c.ligado && !c.pronto).map((c) => c.nome),
    integracoes: Object.entries(integ).map(([id, v]) => ({
      id,
      ligado: Boolean(v?.enabled),
      detalhe: Object.entries(v || {})
        .filter(([k]) => k !== 'enabled')
        .map(([k, val]) => `${k}: ${val}`)
        .join(' · ') || null,
    })),
    padroes: {
      tiposAceitos: (cfg.tipos || []).length,
      docObrigatoria: Boolean(cfg.doc?.required),
      agentesPermitidos: Boolean(cfg.allowAgents),
    },
  };
}

/**
 * Estado da licença. Import dinâmico porque a instalação de desenvolvimento roda
 * sem `license/` de propósito — e a tela não pode quebrar por isso.
 */
export async function plano() {
  let mod;
  try {
    mod = await import('../../license/license.mjs');
  } catch {
    return {
      disponivel: false,
      motivo: 'esta instalação não tem o módulo de licença (recorte de desenvolvimento)',
      valida: null,
    };
  }

  const token = mod.currentLicenseToken();
  if (!token) {
    return {
      disponivel: true,
      valida: false,
      motivo: 'QA_GATE_LICENSE não está no ambiente',
      comoResolver: 'exporte QA_GATE_LICENSE com o token recebido na compra',
      token: null,
    };
  }

  const r = mod.verifyLicense(token);
  const lic = r.license || {};
  const expira = lic.exp ? new Date(lic.exp) : null;
  return {
    disponivel: true,
    valida: r.valid,
    motivo: r.valid ? null : r.reason,
    token: mascarar(token),
    plano: lic.plan || null,
    email: lic.email || null,
    expiraEm: expira ? expira.toISOString() : null,
    diasRestantes: expira ? Math.ceil((expira.getTime() - Date.now()) / 86400000) : null,
  };
}

/**
 * Grava SÓ os campos de identificação. Padrão de branch, escopo de commit e tipos
 * ficam de fora de propósito: são a governança que os hooks aplicam, e mudá-los por
 * uma tela web quebraria o guard no meio do trabalho de alguém.
 */
export function salvarPerfil(mudancas = {}) {
  const permitidos = ['autor', 'projectName'];
  const recusados = Object.keys(mudancas).filter((k) => !permitidos.includes(k));
  if (recusados.length) {
    return {
      ok: false,
      erros: [`só dá pra mudar ${permitidos.join(' e ')} por aqui. ${recusados.join(', ')} governa os hooks — edite ${caminhoConfig()} direto`],
    };
  }

  const caminho = caminhoConfig();
  let atual = {};
  try { atual = JSON.parse(readFileSync(caminho, 'utf8')); } catch { /* arquivo novo */ }

  const novo = { ...atual };
  for (const k of permitidos) {
    if (mudancas[k] === undefined) { continue; }
    const v = String(mudancas[k]).trim();
    if (!v) { return { ok: false, erros: [`${k} não pode ficar vazio`] }; }
    novo[k] = v;
  }

  try {
    writeFileSync(caminho, JSON.stringify(novo, null, 2));
  } catch (e) {
    return { ok: false, erros: [`não consegui gravar em ${caminho}: ${e.message}`] };
  }
  return { ok: true, perfil: perfil() };
}

export { DEFAULT_CONFIG };
