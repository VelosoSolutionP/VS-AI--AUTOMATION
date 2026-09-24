/**
 * Segurança de quem atende e de quem é atendido.
 *
 * O bot já reconhecia o pedido de socorro e respondia com o telefone certo —
 * e dizia "já avisei alguém" sem avisar ninguém. Este módulo é o que faltava
 * pra essa frase ser verdade:
 *
 *  - RESPONSÁVEIS: quem recebe o alerta no WhatsApp quando alguém pede socorro,
 *    quando o atendente aperta o SOS ou quando a empresa manda um teste;
 *  - ALERTA: sai pra cada responsável, e o resultado de CADA envio fica
 *    registrado — "avisei" só vale se saiu;
 *  - AUDITORIA: todo acionamento, encaminhamento e ação do sistema.
 *
 * O Bolso Cheio não substitui polícia, atendimento médico ou serviço de
 * emergência. Ele reduz o caminho entre um pedido de ajuda e quem pode agir.
 */
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { dentroDaCasa } from '../casa.mjs';

const MAX_AUDITORIA = 1000;
const arq = (n) => (process.env.VSSEGURANCA_DIR ? join(process.env.VSSEGURANCA_DIR, n) : dentroDaCasa('vsseguranca', n));
const ler = (n, p) => { try { return JSON.parse(readFileSync(arq(n), 'utf8')); } catch { return p; } };
const gravar = (n, d) => {
  mkdirSync(dirname(arq(n)), { recursive: true, mode: 0o700 });
  writeFileSync(arq(n), JSON.stringify(d, null, 2));
  try { chmodSync(arq(n), 0o600); } catch { /* sem chmod no Windows */ }
};
const soDigitos = (t) => String(t || '').replace(/\D/g, '');

/* ---------------- responsáveis ---------------- */

export const responsaveis = () => ler('responsaveis.json', []);

/**
 * Lista inteira de uma vez (a tela manda tudo). Telefone com DDD — sem ele o
 * alerta não sai, e descobrir isso na hora do socorro é tarde demais.
 */
export function salvarResponsaveis(lista = []) {
  const erros = [];
  const limpos = (lista || []).map((r, i) => {
    const nome = String(r?.nome || '').trim();
    let fone = soDigitos(r?.whatsapp);
    if (fone.length === 10 || fone.length === 11) { fone = `55${fone}`; }
    if (!nome) { erros.push(`responsável ${i + 1}: falta o nome`); }
    if (!(fone.length === 12 || fone.length === 13)) { erros.push(`${nome || `responsável ${i + 1}`}: WhatsApp "${r?.whatsapp || ''}" precisa de DDD (ex.: 31 99999-9999)`); }
    return { nome, whatsapp: fone };
  });
  if (erros.length) { return { ok: false, erros }; }
  gravar('responsaveis.json', limpos);
  auditar({ tipo: 'config', detalhe: `responsáveis pelos alertas: ${limpos.map((r) => r.nome).join(', ') || 'nenhum'}` });
  return { ok: true, responsaveis: limpos };
}

/* ---------------- auditoria ---------------- */

/** @param {{tipo:string, detalhe:string, protocolo?:string, cliente?:string, resultado?:string}} e */
export function auditar(e) {
  const item = { id: randomBytes(6).toString('hex'), em: new Date().toISOString(), ...e };
  const lista = [item, ...ler('auditoria.json', [])].slice(0, MAX_AUDITORIA);
  gravar('auditoria.json', lista);
  return item;
}

export const auditoria = (limite = 50) => ler('auditoria.json', []).slice(0, limite);

/* ---------------- sirene ---------------- */

/** O que faz a sirene tocar no painel: pedido de socorro, SOS e URGENTE. */
export const TOCA_SIRENE = (tipo) => /^emergencia:/.test(tipo) || tipo === 'sos' || tipo === 'urgente';
const JANELA_SIRENE_H = 2;

/**
 * Ocorrências que ninguém viu ainda, das últimas 2h. É o que o painel pergunta
 * a cada poucos segundos: tem alguma → sirene até alguém clicar "estou vendo".
 * Mais antiga que 2h não toca mais (fica só na auditoria): painel aberto de
 * manhã não pode disparar pelo socorro da madrugada que já foi tratado por
 * telefone.
 */
export function pendentes(agora = Date.now()) {
  return ler('auditoria.json', [])
    .filter((a) => TOCA_SIRENE(a.tipo) && !a.vistoEm && agora - Date.parse(a.em) <= JANELA_SIRENE_H * 3600000);
}

/** "Estou vendo": para a sirene em todas as telas e registra quem viu. */
export function reconhecer(ids = [], por = null) {
  const alvo = new Set((ids || []).map(String));
  const lista = ler('auditoria.json', []);
  let n = 0;
  for (const a of lista) {
    if (alvo.has(String(a.id)) && !a.vistoEm) { a.vistoEm = new Date().toISOString(); a.vistoPor = por; n += 1; }
  }
  if (!n) { return { ok: true, reconhecidos: 0 }; }
  gravar('auditoria.json', lista);
  auditar({ tipo: 'visto', detalhe: `${por || 'alguém'} viu ${n} alerta(s) e parou a sirene` });
  return { ok: true, reconhecidos: n };
}

/* ---------------- alerta ---------------- */

const TITULO = {
  violencia: '🚨 PEDIDO DE SOCORRO — violência',
  violencia_mulher: '🚨 PEDIDO DE SOCORRO — possível violência doméstica',
  saude: '🚨 EMERGÊNCIA MÉDICA',
  sos: '🆘 SOS DO ATENDIMENTO',
  urgente: '⚠️ URGENTE no atendimento',
  teste: '✅ Teste de alerta',
};

/** O texto que o responsável recebe. Curto: ele precisa saber QUEM e O QUÊ. */
export function textoDoAlerta({ tipo, cliente, telefone, protocolo, trecho, motivo, por }) {
  return [
    `*${TITULO[tipo] || '🚨 Alerta de segurança'}*`,
    '',
    cliente || telefone ? `Cliente: ${[cliente, telefone].filter(Boolean).join(' · ')}` : null,
    protocolo ? `Protocolo: ${protocolo}` : null,
    trecho ? `Mensagem: "${String(trecho).slice(0, 200)}"` : null,
    motivo ? `Motivo: ${String(motivo).slice(0, 300)}` : null,
    por ? `Acionado por: ${por}` : null,
    '',
    tipo === 'teste'
      ? 'Se você recebeu isto, os alertas de segurança chegam até você. Nada a fazer.'
      : 'Veja a conversa no painel do Bolso Cheio e aja agora.',
  ].filter((l) => l !== null).join('\n');
}

/**
 * Manda o alerta pra cada responsável. `enviar` é do canal (quem tem rede).
 * Sem responsável, sem canal ou com todos os envios falhando, o resultado diz
 * isso — e fica na auditoria. É o que impede "avisei" de virar mentira calada.
 */
export async function alertar(evento, { enviar } = {}) {
  const lista = responsaveis();
  const texto = textoDoAlerta(evento);
  if (!lista.length) {
    auditar({ tipo: `alerta:${evento.tipo}`, detalhe: 'nenhum responsável cadastrado — ninguém foi avisado', protocolo: evento.protocolo, cliente: evento.cliente, resultado: 'falhou' });
    return { ok: false, avisados: [], falhas: [], motivo: 'nenhum responsável cadastrado' };
  }
  const avisados = [];
  const falhas = [];
  for (const r of lista) {
    let env;
    try { env = enviar ? await enviar({ para: r.whatsapp, texto }) : { ok: false, erro: 'canal de WhatsApp fora do ar' }; } catch (e) { env = { ok: false, erro: e.message }; }
    if (env?.ok) { avisados.push(r.nome); } else { falhas.push({ nome: r.nome, erro: env?.erro || 'motivo não informado' }); }
  }
  auditar({
    tipo: `alerta:${evento.tipo}`,
    detalhe: [avisados.length ? `avisado(s): ${avisados.join(', ')}` : null, falhas.length ? `NÃO avisado(s): ${falhas.map((f) => `${f.nome} (${f.erro})`).join(', ')}` : null].filter(Boolean).join(' · '),
    protocolo: evento.protocolo,
    cliente: evento.cliente,
    resultado: avisados.length ? (falhas.length ? 'parcial' : 'ok') : 'falhou',
  });
  return { ok: avisados.length > 0, avisados, falhas };
}
