/**
 * A casa dos dados.
 *
 * O que este arquivo protege e a unica promessa de isolamento que este produto
 * consegue cumprir hoje: como NAO existe sistema de papeis (a auditoria §35
 * registra "RBAC MISSING"), nao da pra prometer "conta sem privilegio". O que
 * da pra prometer e OUTRA INSTALACAO — outro diretorio. O que a demo nao ve,
 * ela nao ve porque nao esta la.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';

const limpar = () => { delete process.env.VS_HOME; };

test('sem VS_HOME, a casa e a de sempre — instalacao existente nao muda de lugar', async () => {
  limpar();
  const { casa } = await import('../engine/casa.mjs?v=1');
  assert.equal(casa(), join(homedir(), '.qa-gate'));
});

test('VS_HOME troca a raiz INTEIRA, nao um modulo', async () => {
  process.env.VS_HOME = '/tmp/demo-vs';
  const { casa, dentroDaCasa } = await import('../engine/casa.mjs?v=2');
  assert.equal(casa(), '/tmp/demo-vs');
  assert.equal(dentroDaCasa('vsbot'), '/tmp/demo-vs/vsbot');
  assert.equal(dentroDaCasa('console', 'acesso.json'), '/tmp/demo-vs/console/acesso.json');
  limpar();
});

test('a senha do console tambem mora na casa — senao a demo compartilharia o login', async () => {
  process.env.VS_HOME = '/tmp/demo-vs';
  delete process.env.VSCONSOLE_ACESSO;
  const acesso = await import('../backend/acesso.mjs?v=3');
  assert.match(acesso.caminhoArquivo(), /^\/tmp\/demo-vs\//);
  limpar();
});

test('a variavel do modulo ainda ganha da casa — e o que faz teste apontar pra pasta descartavel', async () => {
  process.env.VS_HOME = '/tmp/demo-vs';
  process.env.VSCONSOLE_ACESSO = '/tmp/so-desta-vez/acesso.json';
  const acesso = await import('../backend/acesso.mjs?v=4');
  assert.equal(acesso.caminhoArquivo(), '/tmp/so-desta-vez/acesso.json');
  delete process.env.VSCONSOLE_ACESSO;
  limpar();
});

/* UMA excecao, e ela tem dono: a REGRA 0 da spec do marketplace proibe
   `engine/vsmarket` de importar qualquer coisa do VS-IA — ele tem de poder ser
   entregue sozinho. Entao ele resolve a raiz com duas linhas proprias, que
   honram VS_HOME do mesmo jeito. Duplicar duas linhas custa menos que amarrar
   dois produtos; o que nao pode e a excecao virar silenciosa. */
const EXCECOES = ['engine/vsmarket/'];

test('nenhum modulo grava fora da casa', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const varrer = (dir, achados = []) => {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) { varrer(p, achados); }
      else if (p.endsWith('.mjs') && !p.endsWith('casa.mjs') && !EXCECOES.some((e) => p.includes(e))) {
        const s = readFileSync(p, 'utf8');
        /* O padrao proibido e montar o caminho na mao. Quem precisa da raiz
           pede pra casa — senao a proxima instancia nasce com um vazamento. */
        if (/join\(\s*homedir\(\)\s*,\s*'\.qa-gate'/.test(s)) { achados.push(p); }
      }
    }
    return achados;
  };
  const fora = [...varrer('engine'), ...varrer('backend')];
  assert.deepEqual(fora, [], `estes gravam fora da casa: ${fora.join(', ')}`);
});

test('a excecao do marketplace continua honrando VS_HOME — senao a demo vazaria por ela', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('engine/vsmarket/store.mjs', 'utf8');
  assert.match(src, /process\.env\.VS_HOME/, 'a independencia nao pode custar o isolamento');
});
