#!/usr/bin/env node
/**
 * Define a senha do console desta máquina.
 *
 * Existe porque o painel podia subir só com CRM_TOKEN no ambiente: quem não
 * subiu o processo não tem como descobrir a senha, e ninguém deveria precisar
 * ler variável de ambiente de processo alheio pra entrar no próprio sistema.
 *
 *   node backend/senha-console.mjs               -> sorteia uma e mostra UMA vez
 *   node backend/senha-console.mjs "minha senha" -> usa a que você escolheu
 *
 * Vale na hora: o servidor confere o arquivo a cada tentativa de login, então
 * NÃO precisa reiniciar o painel. A senha do ambiente, se existir, continua
 * valendo junto — isto acrescenta um jeito de entrar, não remove o antigo.
 */
import { randomBytes } from 'node:crypto';
import { definir, caminhoArquivo, MIN_SENHA } from './acesso.mjs';

/* Sem l/1/0/O: essa senha vai ser digitada no celular, olhando pra tela. */
const ALFA = 'abcdefghijkmnopqrstuvwxyz23456789';
const sortear = () => Array.from(randomBytes(16))
  .map((b) => ALFA[b % ALFA.length]).join('')
  .replace(/(.{4})(?=.)/g, '$1-');

const escolhida = process.argv.slice(2).join(' ').trim();
const senha = escolhida || sortear();

try {
  definir(senha);
} catch (e) {
  console.error('nao deu: ' + e.message + (escolhida ? '' : ''));
  process.exit(1);
}

console.log('senha do console definida' + (escolhida ? '' : ' (sorteada)') + ':\n');
console.log('   ' + senha + '\n');
console.log('guardada como hash scrypt em ' + caminhoArquivo());
console.log('vale agora, sem reiniciar o painel. minimo de ' + MIN_SENHA + ' caracteres.');
