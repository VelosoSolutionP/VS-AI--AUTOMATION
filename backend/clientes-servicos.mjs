/**
 * O que a carteira de clientes (engine/vsclientes) precisa do mundo real, num
 * lugar só: imprimir PDF, assinar a chave, mandar WhatsApp (texto e arquivo).
 *
 * O módulo recebe tudo isto injetado; é aqui que as peças de verdade são
 * escolhidas. Trocar a impressora ou o canal não encosta na regra de negócio.
 */
import { sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as canais from './canais.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Mesmo formato e mesma chave privada da licença do QA-Gate: payload.assinatura (Ed25519). */
export function assinarLicenca(payload) {
  const priv = process.env.QA_GATE_PRIVATE_KEY || readFileSync(join(HERE, '..', 'license', '.keys', 'private.pem'), 'utf8');
  const buf = Buffer.from(JSON.stringify(payload), 'utf8');
  return b64url(buf) + '.' + b64url(sign(null, buf, priv));
}

/**
 * HTML → PDF pelo Chrome da máquina. Um navegador por impressão: contrato sai
 * poucas vezes por dia, e um Chrome parado na memória por causa disso seria
 * custo sem retorno.
 */
export async function imprimirPdf(html) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close();
  }
}

/** Texto pelo WhatsApp conectado no console. Devolve {ok, erro}. */
export async function enviarWhatsapp({ para, texto }) {
  const r = await canais.enviar({ para, texto });
  return { ok: !!r?.ok, erro: r?.ok ? null : (r?.erro || 'o canal não confirmou o envio') };
}

/** Arquivo (o contrato em PDF) pelo WhatsApp conectado. */
export async function enviarArquivoWhatsapp({ para, buf, nome, legenda }) {
  const r = await canais.enviarArquivo({
    para, nome, legenda, dataUri: `data:application/pdf;base64,${Buffer.from(buf).toString('base64')}`,
  });
  return { ok: !!r?.ok, erro: r?.ok ? null : (r?.erro || 'o canal não confirmou o envio') };
}
