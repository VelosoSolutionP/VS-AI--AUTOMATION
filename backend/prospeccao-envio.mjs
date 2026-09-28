/**
 * O e-mail do dia 0 da Prospecção, em LOTES — a parte automática da pescaria.
 *
 * Regra do dono (28/09): dia 0 = e-mail com a apresentação e o portfólio; o
 * WhatsApp do dia 5 é de gente. Aqui mora só o dia 0:
 *  - modelo e anexo aprovados por ele: docs/prospeccao/email-1a-mensagem.txt e
 *    docs/prospeccao/portfolio-bolso-cheio-agro.pdf;
 *  - LIMITE POR DIA (PROSP_EMAIL_DIA, padrão 50): e-mail comum (Zoho) bloqueia
 *    ou manda pro spam acima disso — a pescaria queimaria a rede;
 *  - um por vez, com pausa (PROSP_EMAIL_PAUSA_MS, padrão 4 s);
 *  - "enviado" só quando o servidor ACEITOU (250 após o DATA);
 *  - 3 recusas seguidas = para o lote (conta bloqueada ou limite do provedor).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prosp from '../engine/vsprospeccao/index.mjs';
import * as email from './email.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODELO = () => process.env.PROSP_EMAIL_MODELO || join(RAIZ, 'docs', 'prospeccao', 'email-1a-mensagem.txt');
const ANEXO = () => process.env.PROSP_EMAIL_ANEXO || join(RAIZ, 'docs', 'prospeccao', 'portfolio-bolso-cheio-agro.pdf');
export const limiteDia = () => Math.max(1, Number(process.env.PROSP_EMAIL_DIA) || 50);
const pausa = () => Math.max(0, Number(process.env.PROSP_EMAIL_PAUSA_MS ?? 4000));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

let job = null; // o lote em andamento (ou o último)

/** O que a tela mostra: limite, quanto saiu hoje, o lote em andamento e quem vai no próximo. */
export function estado() {
  const hoje = prosp.emailsHoje();
  const cabe = Math.max(0, limiteDia() - hoje);
  const proximos = prosp.loteEmail({ limite: Math.min(cabe, 5) || 5 }).map((c) => ({ nome: c.nome, cidade: c.cidade, email: c.email }));
  return { configurado: email.configurado(), limiteDia: limiteDia(), hoje, cabe, job: job ? { ...job, erros: job.erros.slice(-5) } : null, proximos };
}

/** Uma prévia do e-mail como vai sair (primeira empresa do próximo lote, ou um exemplo). */
export function previa() {
  const c = prosp.loteEmail({ limite: 1 })[0] || { nome: 'EMPRESA EXEMPLO LTDA' };
  return { para: c.email || null, ...prosp.emailApresentacao(c, readFileSync(MODELO(), 'utf8')), anexo: 'portfolio-bolso-cheio-agro.pdf' };
}

/**
 * Dispara um lote em segundo plano e devolve na hora. `quantos` é cortado pelo
 * que ainda cabe hoje. Lote andando não aceita outro por cima.
 */
export function iniciar(quantos, { por = null, deps = {} } = {}) {
  if (job?.rodando) { return { ok: false, motivo: 'já tem um lote sendo enviado — espere terminar' }; }
  const enviar = deps.enviarEmail || email.enviarEmail;
  if (!deps.enviarEmail && !email.configurado()) { return { ok: false, motivo: 'e-mail não configurado no servidor (SMTP_USER/SMTP_PASS)' }; }
  const cabe = Math.max(0, limiteDia() - prosp.emailsHoje());
  if (!cabe) { return { ok: false, motivo: `o limite de hoje (${limiteDia()} e-mails) já foi usado — amanhã tem mais` }; }
  const lote = prosp.loteEmail({ limite: Math.min(cabe, Math.max(1, Number(quantos) || 0)) });
  if (!lote.length) { return { ok: false, motivo: 'ninguém na lista com e-mail pra receber' }; }
  let modelo, pdf;
  try { modelo = readFileSync(MODELO(), 'utf8'); pdf = readFileSync(ANEXO()); }
  catch (e) { return { ok: false, motivo: `não achei o modelo ou o portfólio: ${e.message}` }; }
  job = { rodando: true, total: lote.length, enviados: 0, falhas: 0, erros: [], inicio: new Date().toISOString(), fim: null, por, parou: null };
  const j = job;
  (async () => {
    let seguidas = 0;
    for (const c of lote) {
      const m = prosp.emailApresentacao(c, modelo);
      const r = await enviar({ para: c.email, assunto: m.assunto, texto: m.texto, responderPara: process.env.PROSP_RESPONDER_PARA || null,
        anexos: [{ nome: 'portfolio-bolso-cheio-agro.pdf', tipo: 'application/pdf', conteudo: pdf }] }).catch((e) => ({ ok: false, erro: e.message }));
      if (r?.ok) { prosp.marcarEmailEnviado(c.id, { id: r.id }); j.enviados++; seguidas = 0; }
      else {
        j.falhas++; seguidas++; j.erros.push(`${c.email}: ${r?.erro || 'o servidor não aceitou'}`);
        console.warn(`[prospeccao] e-mail pra ${c.email} não saiu: ${r?.erro}`);
        if (seguidas >= 3) { j.parou = 'o servidor de e-mail recusou 3 seguidos — lote parado (limite do provedor ou conta bloqueada)'; break; }
      }
      await espera(pausa());
    }
    j.rodando = false; j.fim = new Date().toISOString();
    console.log(`[prospeccao] lote de e-mails: ${j.enviados} enviado(s), ${j.falhas} falha(s)${j.parou ? ` — ${j.parou}` : ''}`);
  })();
  return { ok: true, total: lote.length };
}
