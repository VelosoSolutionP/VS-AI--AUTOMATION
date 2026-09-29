/**
 * Verificação do site no Google (Merchant Center / Search Console), SEM token.
 *
 * O Merchant Center só aceita o feed de um site "reivindicado": ele manda baixar
 * um arquivo `google<código>.html` e procura por ele na RAIZ do domínio. O
 * conteúdo é sempre `google-site-verification: google<código>.html` — então o
 * dono só precisa colar o NOME do arquivo (ou o arquivo inteiro, ou a tag
 * <meta>: aceitamos os três e tiramos o código dele).
 *
 * A tag <meta name="google-site-verification"> não serve aqui: a raiz deste
 * domínio redireciona pro painel, e o Google confere a página inicial.
 */
import { load, save } from './store.mjs';

const ARQ = 'google-verificacao';
const NOME = /^google[0-9a-f]{8,32}\.html$/;

/** "google1a2b….html", o conteúdo do arquivo, ou a tag <meta content="…"> → nome do arquivo. */
export function nomeDoArquivo(colado) {
  const t = String(colado || '').trim();
  const doArquivo = t.match(/google[0-9a-f]{8,32}\.html/i);
  if (doArquivo) { return doArquivo[0].toLowerCase(); }
  if (/<meta/i.test(t)) { return null; } // tag meta: código de outro formato, não vira arquivo
  const soCodigo = t.match(/^(?:google)?([0-9a-f]{8,32})$/i);
  return soCodigo ? `google${soCodigo[1].toLowerCase()}.html` : null;
}

export function getVerificacao() {
  return load(ARQ, null);
}

export function salvarVerificacao({ colado } = {}) {
  if (!String(colado || '').trim()) { return { ok: false, motivo: 'cole o nome do arquivo que o Google pediu (ex.: google1a2b3c4d5e6f7a8b.html)' }; }
  const arquivo = nomeDoArquivo(colado);
  if (!arquivo) {
    return { ok: false, motivo: /<meta/i.test(colado)
      ? 'a tag <meta> não funciona neste endereço (a página inicial redireciona pro painel). No Google, escolha "Arquivo HTML" e cole o nome do arquivo.'
      : 'não reconheci o arquivo — ele se chama google + letras/números + .html (ex.: google1a2b3c4d5e6f7a8b.html)' };
  }
  save(ARQ, { arquivo, em: new Date().toISOString() });
  return { ok: true, arquivo };
}

export function limparVerificacao() {
  save(ARQ, null);
  return { ok: true };
}

/** Pedido na raiz: devolve o arquivo se for EXATAMENTE o cadastrado; senão null. */
export function servirVerificacao(caminho) {
  const v = getVerificacao();
  const pedido = String(caminho || '').split('?')[0].replace(/^\/+/, '');
  if (!v?.arquivo || !NOME.test(pedido) || pedido !== v.arquivo) { return null; }
  return { tipo: 'text/html; charset=utf-8', conteudo: `google-site-verification: ${v.arquivo}` };
}
