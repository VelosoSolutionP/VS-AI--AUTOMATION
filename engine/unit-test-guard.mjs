/**
 * VS-AUD-004 — enforcement determinístico do teste unitário obrigatório.
 *
 * Regra (absoluta, empresa): se um commit toca CÓDIGO DE PRODUÇÃO (backend/front/mobile)
 * e NÃO há teste unitário no mesmo commit, o commit é BLOQUEADO. Sem teste, sem commit.
 *
 * Classifica os arquivos staged em três baldes por stack e responde se o commit passa.
 * Puro (sem I/O) para ser testável: quem chama passa a lista de paths staged.
 */

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');

const EXCLUDE = [
  /(^|\/)(vendor|node_modules|storage|bootstrap\/cache|public|dist|build)\//i,
  /(^|\/)database\/(migrations|seeders|factories)\//i,
  /\.blade\.php$/i,
  /\.(css|scss|sass|less|map|json|lock|md|txt|ya?ml|env|ico|png|jpe?g|svg|gif|webp|woff2?|ttf|eot)$/i,
];

const TEST = {
  backend: (p) => /(^|\/)tests\//i.test(p) || /Test\.php$/.test(p),
  front: (p) => /\.(test|spec)\.(mjs|cjs|jsx?|tsx?)$/i.test(p) || /(^|\/)__tests__\//.test(p),
  mobile: (p) => /_test\.dart$/.test(p) || /(^|\/)test\//.test(p),
};

const PROD = {
  backend: (p) => /(^|\/)app\/.+\.php$/.test(p),
  front: (p) => /\.(jsx?|tsx?|vue)$/i.test(p) && /(^|\/)(resources\/(js|ts)|src)\//.test(p),
  mobile: (p) => /(^|\/)lib\/.+\.dart$/.test(p),
};

const STACKS = ['backend', 'front', 'mobile'];

function isExcluded(p) {
  return EXCLUDE.some((re) => re.test(p));
}

/**
 * @param {string[]} stagedPaths  arquivos staged (git diff --cached --name-only)
 * @param {{stacks?: string[]}} [opts]  stacks ativas (default: todas)
 * @returns {{blocked: boolean, byStack: Record<string,{prod:string[],tests:string[]}>, missing: string[]}}
 */
export function evaluateUnitTestGuard(stagedPaths, opts = {}) {
  const stacks = (opts.stacks && opts.stacks.length) ? opts.stacks : STACKS;
  const paths = (stagedPaths || []).map(norm).filter(Boolean);
  const byStack = {};
  const missing = [];

  for (const stack of stacks) {
    const isTest = TEST[stack];
    const isProd = PROD[stack];
    if (!isTest || !isProd) {
      continue;
    }
    const tests = paths.filter((p) => isTest(p));
    const prod = paths.filter((p) => !isTest(p) && !isExcluded(p) && isProd(p));
    byStack[stack] = { prod, tests };
    if (prod.length > 0 && tests.length === 0) {
      missing.push(...prod);
    }
  }

  return { blocked: missing.length > 0, byStack, missing };
}
