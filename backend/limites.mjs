import { timingSafeEqual } from 'node:crypto';

/**
 * Limites de entrada do backend (spec §38: rate limiting, validação de entrada,
 * limites de arquivo).
 *
 * Dois furos reais que isto fecha:
 *
 * 1. `readBody` acumulava o corpo inteiro em memória sem teto. Um POST com corpo
 *    gigante derrubava o processo — e o processo é o mesmo que emite licença.
 * 2. `/trial` emitia licença assinada sem nenhum limite por origem. Dava pra mintar
 *    licença em massa com um laço de shell.
 *
 * Tudo aqui é PURO ou com relógio injetável, pra dar pra testar sem esperar tempo real.
 */

/** Teto padrão de corpo: 256 KB. Nenhuma rota legítima deste backend chega perto. */
export const CORPO_MAX_BYTES = Number(process.env.BODY_MAX_BYTES || 256 * 1024);

/**
 * Lê o corpo com teto. Passou do limite, aborta a leitura e devolve {excedeu:true} —
 * não adianta ler tudo pra depois recusar, o dano da memória já teria acontecido.
 */
export async function lerCorpoLimitado(req, maxBytes = CORPO_MAX_BYTES) {
  const declarado = Number(req.headers?.['content-length'] || 0);
  if (declarado && declarado > maxBytes) { return { excedeu: true, bytes: declarado }; }
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > maxBytes) {
      req.destroy?.();
      return { excedeu: true, bytes: total };
    }
    chunks.push(c);
  }
  return { excedeu: false, buffer: Buffer.concat(chunks), bytes: total };
}

/**
 * Rate limit por janela deslizante, em memória.
 *
 * Em memória é suficiente enquanto o backend é um processo só; quando virar mais de
 * uma instância isto precisa ir pro Redis (spec §40) — senão cada instância conta
 * sua própria cota. Está anotado como dívida consciente, não como esquecimento.
 */
export function criarRateLimit({ max = 10, janelaMs = 60000, agora = () => Date.now() } = {}) {
  const hits = new Map();

  function limpar(t) {
    for (const [k, ts] of hits) {
      const vivos = ts.filter((x) => t - x < janelaMs);
      if (vivos.length) { hits.set(k, vivos); } else { hits.delete(k); }
    }
  }

  return {
    /** @returns {{ok:boolean, restante:number, esperaSeg?:number}} */
    checar(chave) {
      const t = agora();
      const k = String(chave || 'sem-chave');
      const ts = (hits.get(k) || []).filter((x) => t - x < janelaMs);
      if (ts.length >= max) {
        const esperaSeg = Math.ceil((janelaMs - (t - ts[0])) / 1000);
        hits.set(k, ts);
        return { ok: false, restante: 0, esperaSeg };
      }
      ts.push(t);
      hits.set(k, ts);
      if (hits.size > 5000) { limpar(t); } // trava de crescimento: nao vira vazamento
      return { ok: true, restante: max - ts.length };
    },
    tamanho() { return hits.size; },
    zerar() { hits.clear(); },
  };
}

/**
 * IP do cliente. Atrás de proxy reverso o socket é o do proxy, então respeita
 * x-forwarded-for — mas só o PRIMEIRO endereço, e só quando TRUST_PROXY=1. Confiar
 * no header sem essa trava deixaria qualquer um forjar a identidade e furar a cota.
 */
export function ipDe(req) {
  if (process.env.TRUST_PROXY === '1') {
    const xff = req.headers?.['x-forwarded-for'];
    if (xff) { return String(xff).split(',')[0].trim(); }
  }
  return req.socket?.remoteAddress || 'desconhecido';
}

/**
 * Comparação de segredo em tempo constante. `a !== b` vaza, pelo tempo de resposta,
 * quantos caracteres iniciais estão certos — dá pra descobrir o token byte a byte.
 */
export function segredoIgual(a, b) {
  const A = Buffer.from(String(a ?? ''), 'utf8');
  const B = Buffer.from(String(b ?? ''), 'utf8');
  // Vazio NUNCA casa: sem esta linha, segredo nao configurado ('') batia com
  // requisicao sem token ('') e liberava a rota justamente quando ninguem configurou.
  if (A.length === 0 || B.length === 0) { return false; }
  if (A.length !== B.length) { return false; } // tamanho vaza, conteudo nao
  return timingSafeEqual(A, B);
}
