#!/usr/bin/env node
/**
 * Monta um banco SQLite de demonstração com produtos consultados na API GTIN da RSC Sistemas (V3).
 *
 * Uso:
 *   echo SEU_TOKEN > ~/.gtin-token           # uma vez só (ou export GTIN_TOKEN=...)
 *   node scripts/gtin-banco-demo.mjs codigos.txt [--imagens] [--banco demo-produtos.db]
 *   node scripts/gtin-banco-demo.mjs 7891000100103 7896116900029
 *
 * Token vencido (1 h)? Defina também GTIN_USUARIO e GTIN_SENHA: o script pede um token novo
 * sozinho (POST /api/v3/oauth/token com Basic Auth) e segue. Nada de token vai para o banco nem para a tela.
 *
 * Cuidados da API: código inválido nunca é enviado (10 inválidos em 20 min suspendem a conta por 1 h),
 * uma consulta por vez com pausa, e para tudo no primeiro 403/429 (limite do plano ou suspensão).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const API = 'https://gtin.rscsistemas.com.br';
const AGENTE = 'ZEST-Demo/1.0';
// O plano limita a 2 requisições por minuto, contando token e imagem: uma chamada a cada 31 s.
const INTERVALO_MS = Number(process.env.GTIN_INTERVALO_MS || 31000);
let ultimaChamada = 0;
async function aguardarVez() {
  const espera = ultimaChamada + INTERVALO_MS - Date.now();
  if (ultimaChamada && espera > 0) await new Promise((fim) => setTimeout(fim, espera));
  ultimaChamada = Date.now();
}

const args = process.argv.slice(2);
const flag = (nome) => args.includes(nome);
const valor = (nome, padrao) => { const i = args.indexOf(nome); return i >= 0 && args[i + 1] ? args[i + 1] : padrao; };
const arquivoBanco = valor('--banco', 'demo-produtos.db');
const comImagens = flag('--imagens');
const entradas = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--banco');
if (!entradas.length && existsSync('codigos.txt')) entradas.push('codigos.txt');

/** Dígito verificador GS1 (GTIN-8, 12, 13 e 14). */
export function gtinValido(codigo) {
  const d = String(codigo).replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(d.length) || /^0+$/.test(d)) return false;
  const corpo = d.slice(0, -1).split('').reverse().map(Number);
  const soma = corpo.reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (soma % 10)) % 10 === Number(d.at(-1));
}

function lerCodigos() {
  const lista = [];
  for (const e of entradas) {
    if (existsSync(e)) lista.push(...readFileSync(e, 'utf8').split(/[\s,;]+/));
    else lista.push(e);
  }
  return [...new Set(lista.map((x) => x.replace(/\D/g, '')).filter(Boolean))];
}

// Token: variável GTIN_TOKEN ou o arquivo ~/.gtin-token (salvo uma vez, fora do repositório).
const arquivoToken = join(homedir(), '.gtin-token');
let token = process.env.GTIN_TOKEN || (existsSync(arquivoToken) ? readFileSync(arquivoToken, 'utf8').trim() : '');

async function novoToken() {
  const { GTIN_USUARIO: u, GTIN_SENHA: s } = process.env;
  if (!u || !s) throw new Error('token recusado (401) e sem GTIN_USUARIO/GTIN_SENHA para pedir outro');
  await aguardarVez();
  const r = await fetch(`${API}/api/v3/oauth/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${u}:${s}`).toString('base64')}`, Accept: 'application/json', 'User-Agent': AGENTE, 'Content-Length': '0' },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`não consegui gerar token: HTTP ${r.status} ${j.mensagem || j.erro || ''}`);
  token = j.access_token;
  console.log('· token novo gerado (vale 1 h)');
}

async function chamar(caminho, { binario = false } = {}) {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    if (!token) await novoToken();
    await aguardarVez();
    const r = await fetch(`${API}${caminho}`, { headers: { Authorization: `Bearer ${token}`, Accept: binario ? '*/*' : 'application/json', 'User-Agent': AGENTE } });
    if (r.status === 401 && tentativa === 0) { token = ''; continue; }
    if (r.status === 403 || r.status === 429) {
      const j = await r.json().catch(() => ({}));
      throw Object.assign(new Error(`API bloqueou (HTTP ${r.status}): ${j.mensagem || j.erro || ''}${r.headers.get('retry-after') ? ` · tente de novo em ${r.headers.get('retry-after')} s` : ''}`), { parar: true });
    }
    return r;
  }
  throw new Error('token recusado duas vezes');
}

const db = new DatabaseSync(arquivoBanco);
db.exec(`CREATE TABLE IF NOT EXISTS produtos (
  gtin TEXT PRIMARY KEY, tipo TEXT, nome TEXT, marca TEXT, categoria TEXT, ncm TEXT, cest TEXT,
  imagem TEXT, resposta_json TEXT NOT NULL, consultado_em TEXT NOT NULL)`);
db.exec(`CREATE TABLE IF NOT EXISTS nao_encontrados (gtin TEXT PRIMARY KEY, motivo TEXT, consultado_em TEXT NOT NULL)`);
const gravar = db.prepare(`INSERT INTO produtos (gtin, tipo, nome, marca, categoria, ncm, cest, imagem, resposta_json, consultado_em)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(gtin) DO UPDATE SET tipo=excluded.tipo, nome=excluded.nome, marca=excluded.marca,
  categoria=excluded.categoria, ncm=excluded.ncm, cest=excluded.cest, imagem=COALESCE(excluded.imagem, produtos.imagem),
  resposta_json=excluded.resposta_json, consultado_em=excluded.consultado_em`);
const faltou = db.prepare(`INSERT OR REPLACE INTO nao_encontrados (gtin, motivo, consultado_em) VALUES (?, ?, ?)`);

const codigos = lerCodigos();
if (!codigos.length) { console.error('Informe códigos ou um arquivo com um código por linha.'); process.exit(1); }
if (!token && !process.env.GTIN_USUARIO) { console.error('Sem token. Salve uma vez:  echo SEU_TOKEN > ~/.gtin-token'); process.exit(1); }

const validos = codigos.filter(gtinValido);
const invalidos = codigos.filter((c) => !gtinValido(c));
if (invalidos.length) console.log(`· ${invalidos.length} código(s) com dígito verificador errado, não enviados: ${invalidos.slice(0, 10).join(', ')}${invalidos.length > 10 ? '…' : ''}`);
if (comImagens) mkdirSync('imagens', { recursive: true });

let ok = 0, sem = 0;
for (const gtin of validos) {
  const agora = new Date().toISOString();
  try {
    const r = await chamar(`/api/v3/gtin/${gtin}`);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.nome) {
      faltou.run(gtin, j?.mensagem || `HTTP ${r.status}`, agora); sem++;
      console.log(`✗ ${gtin} — ${j?.mensagem || `não encontrado (HTTP ${r.status})`}`);
    } else {
      let imagem = null;
      if (comImagens) {
        const ri = await chamar(`/api/v3/gtin/${gtin}/image`, { binario: true });
        if (ri.ok) { const ext = (ri.headers.get('content-type') || '').includes('jpeg') ? 'jpg' : 'png'; imagem = `imagens/${gtin}.${ext}`; writeFileSync(imagem, Buffer.from(await ri.arrayBuffer())); }
      }
      gravar.run(gtin, j.ean_tipo ?? null, j.nome, j.marca ?? null, j.categoria ?? null, j.ncm ?? null, j.cest ?? null, imagem, JSON.stringify(j), agora);
      ok++;
      console.log(`✓ ${gtin} — ${j.nome}${j.marca ? ` (${j.marca})` : ''}`);
    }
  } catch (e) {
    console.error(`! ${gtin} — ${e.message}`);
    if (e.parar) break;
  }
}
console.log(`\nPronto: ${ok} gravado(s), ${sem} não encontrado(s), ${invalidos.length} inválido(s). Banco: ${arquivoBanco}`);
