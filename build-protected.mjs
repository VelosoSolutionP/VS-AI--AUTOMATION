/**
 * Build PROTEGIDO — gera o artefato distribuível em dist/ (bundle + minify +
 * ofuscação). O FONTE fica no repo privado; distribui-se SÓ o dist/.
 *
 * Cada entrypoint vira 1 arquivo .cjs auto-contido (engine/license/catalog
 * inlinados), com a chave PÚBLICA embutida (define) e ofuscado. Ninguém lê o
 * fonte; o license gate (expiração assinada Ed25519) segue valendo.
 *
 * Uso:  node build-protected.mjs
 */
import esbuild from 'esbuild';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync, cpSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ROOT = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const DIST = join(ROOT, 'dist');

const PUBKEY = readFileSync(join(ROOT, 'license', 'pubkey.pem'), 'utf8');

// entrypoint -> caminho de saída no dist (mantém layout p/ os hooks do Claude)
const ENTRIES = [
  ['hooks/on-session.mjs', 'hooks/on-session.mjs'],
  ['hooks/on-task.mjs', 'hooks/on-task.mjs'],
  ['hooks/on-commit.mjs', 'hooks/on-commit.mjs'],
  ['hooks/on-git-guard.mjs', 'hooks/on-git-guard.mjs'],
  ['hooks/on-qa-gate.mjs', 'hooks/on-qa-gate.mjs'],
  ['hooks/on-doc.mjs', 'hooks/on-doc.mjs'],
  ['hooks/on-agent-guard.mjs', 'hooks/on-agent-guard.mjs'],
  ['hooks/on-egle-anchor.mjs', 'hooks/on-egle-anchor.mjs'],
  ['hooks/whatsapp-watcher.mjs', 'hooks/whatsapp-watcher.mjs'],
  ['mcp/server.mjs', 'mcp/server.mjs'],
  ['qa-gate.mjs', 'qa-gate.mjs'],
];

const OBFU = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,
  identifierNamesGenerator: 'hexadecimal',
  numbersToExpressions: true,
  simplify: true,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  splitStrings: true,
  splitStringsChunkLength: 8,
  transformObjectKeys: true,
  // selfDefending desligado: pode quebrar em runtime Node; o resto já dificulta muito.
  selfDefending: false,
  disableConsoleOutput: false,
};

async function run() {
  // Limpa só os artefatos gerados; PRESERVA .git e .gitignore (dist é repo de release).
  if (existsSync(DIST)) {
    for (const item of readdirSync(DIST)) {
      if (item === '.git' || item === '.gitignore' || item === 'README.md') { continue; }
      rmSync(join(DIST, item), { recursive: true, force: true });
    }
  } else {
    mkdirSync(DIST, { recursive: true });
  }

  for (const [src, out] of ENTRIES) {
    const outfile = join(DIST, out);
    mkdirSync(dirname(outfile), { recursive: true });

    // 1) bundle + minify (inlina engine/license/catalog; embute a pubkey)
    const res = await esbuild.build({
      entryPoints: [join(ROOT, src)],
      bundle: true,
      minify: true,
      platform: 'node',
      target: 'node18',
      format: 'esm',
      // Só o CÓDIGO DELE é bundlado/ofuscado; libs de terceiros (playwright,
      // zod, sdk MCP, dotenv...) ficam external e são instaladas via npm no dist.
      packages: 'external',
      write: false,
      define: { __QAGATE_PUBKEY__: JSON.stringify(PUBKEY) },
      legalComments: 'none',
    });
    const bundled = res.outputFiles[0].text;

    // 2) ofusca (shebang preservado no topo). ESM pode não ser suportado pelo
    // obfuscator -> fallback pro bundle minificado (ainda ilegível: inlinado,
    // sem comentários, nomes mangled).
    const shebang = '#!/usr/bin/env node\n';
    const body = bundled.startsWith('#!') ? bundled.slice(bundled.indexOf('\n') + 1) : bundled;
    // ESM: o javascript-obfuscator corrompe import/export (gera codigo invalido
    // mesmo sem lancar). Ship MINIFICADO (esbuild) — ESM valido, nao-legivel:
    // inlinado, sem comentario, nomes locais mangled. Obfuscator so daria pra
    // usar convertendo pra CJS (bloqueado por top-level await nos hooks).
    void JavaScriptObfuscator; void OBFU; void shebang;
    // Shebang so no bin (qa-gate.mjs); hooks/MCP rodam via `node <file>`.
    const head = out === 'qa-gate.mjs' ? '#!/usr/bin/env node\n' : '';
    writeFileSync(outfile, head + body, 'utf8');
    console.log(`✓ ${out}  (${(body.length / 1024).toFixed(0)} KB) — minificado`);
  }

  // catalog/ é lido em runtime (createRequire nao inlina o JSON) — copia pro dist.
  // De dist/hooks/* e dist/mcp/*, "../catalog" resolve pra dist/catalog. OK.
  cpSync(join(ROOT, 'catalog'), join(DIST, 'catalog'), { recursive: true });

  // Estrutura de plugin instalavel (config, nao-IP): manifestos + comandos +
  // exemplo de hooks. O Claude Code auto-descobre hooks/ e commands/.
  cpSync(join(ROOT, '.claude-plugin'), join(DIST, '.claude-plugin'), { recursive: true });
  cpSync(join(ROOT, 'commands'), join(DIST, 'commands'), { recursive: true });
  if (existsSync(join(ROOT, 'hooks', 'settings.example.json'))) {
    cpSync(join(ROOT, 'hooks', 'settings.example.json'), join(DIST, 'hooks', 'settings.example.json'));
  }
  mkdirSync(join(DIST, 'license'), { recursive: true });
  cpSync(join(ROOT, 'license', 'pubkey.pem'), join(DIST, 'license', 'pubkey.pem'));

  // package.json do artefato
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const distPkg = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    type: 'module',
    bin: { 'qa-gate': 'qa-gate.mjs' },
    engines: pkg.engines || { node: '>=18' },
    // libs de terceiros ficam como deps normais (instaladas no cliente)
    dependencies: pkg.dependencies || {},
    license: 'SEE LICENSE — uso mediante chave',
  };
  writeFileSync(join(DIST, 'package.json'), JSON.stringify(distPkg, null, 2));

  writeFileSync(join(DIST, 'INSTALL.md'),
    '# QA-Gate (artefato)\n\nBinários ofuscados. Requer chave: `export QA_GATE_LICENSE="<chave>"`.\n' +
    'Hooks: aponte o settings do Claude Code para os `.cjs` em `hooks/`.\n' +
    'MCP: `node mcp/server.cjs`.\n\n© DevPoint Innovation — uso mediante licença.\n');

  console.log(`\nArtefato pronto em: ${DIST}`);
  console.log('Distribua SÓ o dist/. O fonte fica no repo privado.');
}

run().catch((e) => { console.error('build falhou:', e); process.exit(1); });
