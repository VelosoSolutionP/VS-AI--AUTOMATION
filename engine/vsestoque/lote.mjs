/**
 * Lote de exportação — um recorte do catálogo por PERÍODO, congelado.
 *
 * Exportar "tudo, agora" serve pra conferir; não serve pra operar. Quem recebe o
 * feed (marketplace, rede social, outro CRM) precisa saber O QUE mudou desde a
 * última vez, e precisa poder reimportar exatamente o mesmo arquivo se a carga
 * falhar no meio. Por isso o lote guarda o conteúdo gerado, e não só os filtros:
 * regerar depois daria outro resultado, e aí "reimportar o lote 7" não quer dizer
 * mais nada.
 *
 * O período é sobre `atualizadoEm`, não `criadoEm`: o que interessa pra quem
 * recebe é o que MUDOU na janela, incluindo produto antigo que teve preço novo.
 */
import { load, save } from './store.mjs';
import { exportar as gerar, prontidao } from './exportar.mjs';

const LOTES = 'lotes';

export const listarLotes = () => load(LOTES, []);
export const obterLote = (id) => listarLotes().find((l) => l.id === String(id)) || null;

/** Começo do dia informado; data inválida vira null (nunca vira "hoje" calado). */
function inicioDoDia(s) {
  if (!s) { return null; }
  const d = new Date(`${String(s).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function fimDoDia(s) {
  if (!s) { return null; }
  const d = new Date(`${String(s).slice(0, 10)}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Seleciona os produtos alterados na janela. Sem `de`/`ate` a janela é aberta
 * daquele lado — quem exporta a primeira carga quer tudo.
 */
export function selecionar(produtos = [], { de, ate, incluirInativos = false } = {}) {
  const ini = inicioDoDia(de);
  const fim = fimDoDia(ate);
  return produtos.filter((p) => {
    if (!incluirInativos && p.ativo === false) { return false; }
    const quando = p.atualizadoEm || p.criadoEm;
    if (!quando) { return false; }
    if (ini && quando < ini) { return false; }
    if (fim && quando > fim) { return false; }
    return true;
  });
}

const novoId = (lotes) => 'L' + String(lotes.length + 1).padStart(4, '0');

/**
 * Cria o lote: seleciona, gera o arquivo do canal e GUARDA o conteúdo.
 * @returns {{ok:boolean, lote?:object, motivo?:string}}
 */
export function criarLote(produtos = [], e = {}) {
  const de = e.de ? inicioDoDia(e.de) : null;
  const ate = e.ate ? fimDoDia(e.ate) : null;
  if (e.de && !de) { return { ok: false, motivo: `data inicial inválida: "${e.de}"` }; }
  if (e.ate && !ate) { return { ok: false, motivo: `data final inválida: "${e.ate}"` }; }
  if (de && ate && de > ate) { return { ok: false, motivo: 'a data inicial é depois da final' }; }

  const selecionados = selecionar(produtos, { de: e.de, ate: e.ate, incluirInativos: e.incluirInativos });
  if (!selecionados.length) {
    return { ok: false, motivo: 'nenhum produto alterado nesse período — o lote sairia vazio' };
  }

  const r = gerar(selecionados, e.canal || 'json', e.opts || {});
  if (!r.ok) { return { ok: false, motivo: r.motivo }; }

  const lotes = listarLotes();
  const lote = {
    id: novoId(lotes),
    canal: e.canal || 'json',
    de: e.de || null,
    ate: e.ate || null,
    criadoEm: new Date().toISOString(),
    // Quantos entraram e quantos foram RECUSADOS por campo faltando. O recusado
    // fica nomeado: feed que some com item calado vira anúncio que nunca sobe.
    selecionados: selecionados.length,
    incluidos: r.incluidos,
    recusados: r.recusados,
    arquivo: r.arquivo,
    tipo: r.tipo,
    bytes: Buffer.byteLength(r.conteudo, 'utf8'),
    conteudo: r.conteudo,
    prontidao: prontidao(selecionados),
  };
  save(LOTES, [...lotes, lote]);
  return { ok: true, lote };
}

/** Lista sem o conteúdo — a tela não precisa carregar o arquivo inteiro. */
export function resumirLotes() {
  return listarLotes().map(({ conteudo, ...resto }) => resto).reverse();
}

export function excluirLote(id) {
  const lotes = listarLotes();
  const i = lotes.findIndex((l) => l.id === String(id));
  if (i < 0) { return { ok: false, motivo: `lote "${id}" não encontrado` }; }
  save(LOTES, lotes.filter((_, n) => n !== i));
  return { ok: true };
}
