/**
 * VSmarket — trilha de auditoria (§37).
 *
 * A exigência é que o log NÃO seja editável por usuário comum. Enquanto o banco não
 * entra (onde isso vira permissão de tabela e append-only de verdade), a garantia
 * possível é outra: **encadear os registros por hash**. Cada entrada carrega o hash
 * da anterior, então apagar ou alterar qualquer linha do meio quebra a corrente e
 * `verificar()` aponta exatamente onde.
 *
 * Isso não IMPEDE a edição — impede que ela passe despercebida. É a diferença entre
 * um log que ninguém confere e um log que denuncia adulteração.
 */
import { createHash, randomBytes } from 'node:crypto';

/** Operações críticas do §37. Lista fechada: ação fora dela é erro de chamada. */
export const ACOES = [
  'preco.alterado', 'proposta.criada', 'proposta.selecionada', 'prestador.aceitou',
  'pagamento.criado', 'pagamento.confirmado', 'pagamento.disponivel', 'reembolso', 'repasse',
  'escopo.criado', 'escopo.alterado', 'change_request.aceito',
  'os.concluida', 'contestacao.aberta', 'laudo.registrado',
  'incidente.confirmado', 'strike.aplicado', 'prestador.status',
  'usuario.login', 'usuario.login_falhou', 'cadastro.criado', 'cadastro.alterado',
];

const GENESE = '0'.repeat(64);

function hashDe(registro, anterior) {
  return createHash('sha256').update(JSON.stringify({
    seq: registro.seq, em: registro.em, ator: registro.ator, acao: registro.acao,
    entidade: registro.entidade, entidadeId: registro.entidadeId,
    antes: registro.antes, depois: registro.depois, correlacaoId: registro.correlacaoId,
    anterior,
  })).digest('hex');
}

/**
 * Monta um registro encadeado ao último.
 * @param {object[]} trilha  a trilha como está hoje
 * @param {object} e  {ator, acao, entidade, entidadeId, antes, depois, correlacaoId}
 */
export function registrar(trilha = [], e = {}) {
  const acao = String(e.acao || '');
  if (!ACOES.includes(acao)) {
    return { registro: null, erro: `ação fora do catálogo de auditoria: "${acao}"` };
  }
  if (!e.ator) { return { registro: null, erro: 'auditoria sem ator não serve pra nada — informe quem fez' }; }

  const ultimo = trilha[trilha.length - 1];
  const registro = {
    seq: (ultimo?.seq ?? 0) + 1,
    em: e.quando || new Date().toISOString(),
    ator: String(e.ator),
    papel: e.papel || null,
    acao,
    entidade: e.entidade || null,
    entidadeId: e.entidadeId || null,
    // Só o que mudou, nunca o objeto inteiro: o §39 pede log sanitizado.
    antes: e.antes ?? null,
    depois: e.depois ?? null,
    correlacaoId: e.correlacaoId || randomBytes(6).toString('hex'),
    anterior: ultimo?.hash || GENESE,
  };
  registro.hash = hashDe(registro, registro.anterior);
  return { registro, erro: null };
}

/**
 * Confere a corrente inteira. Devolve o primeiro ponto quebrado — não só "inválida".
 */
export function verificar(trilha = []) {
  let anterior = GENESE;
  for (const [i, r] of trilha.entries()) {
    if (r.anterior !== anterior) {
      return { ok: false, seq: r.seq, indice: i, motivo: `o registro ${r.seq} aponta para um anterior que não é o esperado — houve remoção ou reordenação` };
    }
    if (r.seq !== i + 1) {
      return { ok: false, seq: r.seq, indice: i, motivo: `sequência quebrada: esperado ${i + 1}, veio ${r.seq}` };
    }
    if (hashDe(r, r.anterior) !== r.hash) {
      return { ok: false, seq: r.seq, indice: i, motivo: `o conteúdo do registro ${r.seq} foi alterado depois de gravado` };
    }
    anterior = r.hash;
  }
  return { ok: true, registros: trilha.length, ultimoHash: anterior };
}

/** Filtro de leitura — auditoria só serve se der pra procurar nela. */
export function filtrar(trilha = [], f = {}) {
  return trilha.filter((r) => {
    if (f.acao && r.acao !== f.acao) { return false; }
    if (f.ator && r.ator !== f.ator) { return false; }
    if (f.entidadeId && r.entidadeId !== f.entidadeId) { return false; }
    if (f.correlacaoId && r.correlacaoId !== f.correlacaoId) { return false; }
    if (f.desde && r.em < f.desde) { return false; }
    return true;
  });
}
