/**
 * QA-Gate licensing — validação OFFLINE (cliente).
 * A licença é um token: base64url(payload).base64url(assinaturaEd25519).
 * O cliente verifica a assinatura com a chave PÚBLICA embutida. Não bate em servidor.
 * A chave privada (assinatura) vive só no backend (license/.keys/private.pem).
 */
import { verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// __QAGATE_PUBKEY__ é injetado no build protegido (esbuild define) pra embutir a
// chave PÚBLICA no bundle. Em dev (não definido) cai no arquivo. typeof evita
// ReferenceError com identificador não declarado.
const PUBKEY = (typeof __QAGATE_PUBKEY__ !== 'undefined')
  ? __QAGATE_PUBKEY__
  : readFileSync(join(HERE, 'pubkey.pem'), 'utf8');

const b64urlDecode = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/**
 * @returns {{valid:boolean, reason?:string, license?:object}}
 */
export function verifyLicense(token) {
  if (!token || !token.includes('.')) { return { valid: false, reason: 'sem licença. Compre em devpointinnovation.com.br e configure QA_GATE_LICENSE.' }; }
  try {
    const [payloadB64, sigB64] = token.split('.');
    const payloadBuf = b64urlDecode(payloadB64);
    const sig = b64urlDecode(sigB64);
    const ok = verify(null, payloadBuf, PUBKEY, sig);
    if (!ok) { return { valid: false, reason: 'assinatura inválida' }; }
    const license = JSON.parse(payloadBuf.toString('utf8'));
    if (license.exp && Date.now() > license.exp) { return { valid: false, reason: 'licença expirada em ' + new Date(license.exp).toISOString() }; }
    return { valid: true, license };
  } catch (e) {
    return { valid: false, reason: 'licença corrompida: ' + e.message };
  }
}

export function currentLicenseToken() {
  return process.env.QA_GATE_LICENSE || '';
}
