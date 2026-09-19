/**
 * VSmarket — orquestrador do marketplace.
 *
 * REGRA 0 da spec: este produto é independente. Nenhum arquivo de `engine/vsmarket/`
 * importa de `engine/vs*` do VS-IA, e o servidor é próprio. Existe teste que falha
 * se a fronteira for cruzada.
 *
 * Aqui só tem I/O e composição; as regras vivem nos módulos puros.
 */
import { load, save } from './store.mjs';
import * as ident from './identidade.mjs';
import * as cad from './cadastro.mjs';
import * as aud from './auditoria.mjs';
import * as ind from './indicacao.mjs';
import { atende, ordenarPorDistancia, distanciaKm, REGIAO_MVP } from './geo.mjs';

const USUARIOS = 'usuarios';
const SESSOES = 'sessoes';
const CLIENTES = 'clientes';
const PRESTADORES = 'prestadores';
const INDICACOES = 'indicacoes';
const TRILHA = 'auditoria';
const CATEGORIAS = 'categorias';

export { ident, cad, aud, ind, REGIAO_MVP };

/** Categorias iniciais do §1 — cadastráveis, não fixas no código. */
const CATEGORIAS_PADRAO = [
  { id: 'eletricista', nome: 'Eletricista', precificacao: 'ESTIMATE' },
  { id: 'encanador', nome: 'Encanador', precificacao: 'ESTIMATE' },
  { id: 'pintor', nome: 'Pintor', precificacao: 'INSPECTION_REQUIRED' },
  { id: 'montador', nome: 'Montador de móveis', precificacao: 'FIXED_PRICE' },
  { id: 'reparos', nome: 'Pequenos reparos', precificacao: 'ESTIMATE' },
  { id: 'manutencao', nome: 'Manutenção residencial', precificacao: 'ESTIMATE' },
];

export function categorias() {
  const guardadas = load(CATEGORIAS, null);
  if (guardadas) { return guardadas; }
  save(CATEGORIAS, CATEGORIAS_PADRAO);
  return CATEGORIAS_PADRAO;
}

/** Grava na trilha encadeada. Falha de auditoria NÃO é silenciosa. */
function auditar(e) {
  const trilha = load(TRILHA, []);
  const r = aud.registrar(trilha, e);
  if (r.erro) { return { ok: false, erro: r.erro }; }
  save(TRILHA, [...trilha, r.registro]);
  return { ok: true, registro: r.registro };
}

export const trilha = (f = {}) => aud.filtrar(load(TRILHA, []), f);
export const verificarTrilha = () => aud.verificar(load(TRILHA, []));

/* ---------------- identidade ---------------- */

export const usuarios = () => load(USUARIOS, []);

export function criarUsuario(e = {}, ator = 'sistema') {
  const todos = usuarios();
  const r = ident.normalizarUsuario(e, todos);
  if (r.erros.length) { return { ok: false, erros: r.erros }; }
  save(USUARIOS, [...todos, r.usuario]);
  auditar({ ator, acao: 'cadastro.criado', entidade: 'usuario', entidadeId: r.usuario.id, depois: { papel: r.usuario.papel } });
  return { ok: true, usuario: ident.publico(r.usuario) };
}

export function login(email, senha, agora = Date.now()) {
  const todos = usuarios();
  const i = todos.findIndex((u) => u.email === String(email || '').trim().toLowerCase());
  const r = ident.autenticar(i < 0 ? null : todos[i], senha, agora);

  // Mesmo falhando, o contador de tentativas precisa persistir — senão o bloqueio
  // por força bruta nunca acontece.
  if (i >= 0 && r.usuario) { todos[i] = r.usuario; save(USUARIOS, todos); }

  if (!r.ok) {
    if (i >= 0) {
      auditar({ ator: todos[i].id, acao: 'usuario.login_falhou', entidade: 'usuario', entidadeId: todos[i].id, depois: { motivo: r.motivo } });
    }
    return { ok: false, motivo: r.motivo, exigeMfa: r.exigeMfa || false };
  }

  const sessoes = load(SESSOES, []);
  // Limpa expiradas ao entrar: sessão morta não precisa de rotina própria.
  const vivas = sessoes.filter((s) => new Date(s.expiraEm).getTime() > agora);
  save(SESSOES, [...vivas, r.sessao]);
  auditar({ ator: r.usuario.id, papel: r.usuario.papel, acao: 'usuario.login', entidade: 'usuario', entidadeId: r.usuario.id });

  return { ok: true, token: r.token, usuario: ident.publico(r.usuario), expiraEm: r.sessao.expiraEm };
}

export function sessaoDoToken(token, agora = Date.now()) {
  if (!token) { return { ok: false, motivo: 'sem token' }; }
  const s = load(SESSOES, []).find((x) => x.hashToken === ident.hashDeToken(token));
  const v = ident.sessaoValida(s, agora);
  if (!v.ok) { return v; }
  const u = usuarios().find((x) => x.id === s.usuarioId);
  if (!u || !u.ativo) { return { ok: false, motivo: 'conta desativada' }; }
  return { ok: true, sessao: s, usuario: ident.publico(u) };
}

export function logout(token) {
  const h = ident.hashDeToken(token);
  save(SESSOES, load(SESSOES, []).filter((s) => s.hashToken !== h));
  return { ok: true };
}

/* ---------------- cadastro ---------------- */

export const clientes = () => load(CLIENTES, []);
export const prestadores = () => load(PRESTADORES, []);

export function criarCliente(e = {}, ator = 'sistema') {
  const r = cad.normalizarCliente(e);
  if (r.erros.length) { return { ok: false, erros: r.erros, avisos: r.avisos }; }
  save(CLIENTES, [...clientes(), r.cliente]);
  auditar({ ator, acao: 'cadastro.criado', entidade: 'cliente', entidadeId: r.cliente.id });
  return { ok: true, cliente: r.cliente, avisos: r.avisos };
}

export function criarPrestador(e = {}, ator = 'sistema') {
  const r = cad.normalizarPrestador(e);
  if (r.erros.length) { return { ok: false, erros: r.erros, avisos: r.avisos }; }
  save(PRESTADORES, [...prestadores(), r.prestador]);
  auditar({ ator, acao: 'cadastro.criado', entidade: 'prestador', entidadeId: r.prestador.id, depois: { status: r.prestador.status } });
  return { ok: true, prestador: cad.prestadorPublico(r.prestador), avisos: r.avisos };
}

export function editarPrestador(id, mudancas = {}, ator = 'sistema') {
  const todos = prestadores();
  const i = todos.findIndex((p) => p.id === String(id));
  if (i < 0) { return { ok: false, erros: [`prestador "${id}" não encontrado`] }; }
  const antes = todos[i];
  const r = cad.normalizarPrestador({ ...antes, lat: antes.base.lat, lng: antes.base.lng, ...mudancas, id: antes.id, status: mudancas.status || antes.status });
  if (r.erros.length) { return { ok: false, erros: r.erros, avisos: r.avisos }; }
  todos[i] = r.prestador;
  save(PRESTADORES, todos);
  auditar({ ator, acao: 'cadastro.alterado', entidade: 'prestador', entidadeId: antes.id, antes: { raioKm: antes.raioKm }, depois: { raioKm: r.prestador.raioKm } });
  return { ok: true, prestador: cad.prestadorPublico(r.prestador), avisos: r.avisos };
}

export function mudarStatusPrestador(id, para, opts = {}) {
  const todos = prestadores();
  const i = todos.findIndex((p) => p.id === String(id));
  if (i < 0) { return { ok: false, erro: `prestador "${id}" não encontrado` }; }
  const r = cad.mudarStatus(todos[i], String(para).toUpperCase(), opts);
  if (r.erro) { return { ok: false, erro: r.erro }; }
  todos[i] = r.prestador;
  save(PRESTADORES, todos);
  if (!r.repetido) {
    auditar({
      ator: opts.por || 'sistema', acao: 'prestador.status', entidade: 'prestador', entidadeId: id,
      antes: { status: r.evento.de }, depois: { status: r.evento.para, motivo: r.evento.motivo },
    });
  }
  return { ok: true, prestador: cad.prestadorPublico(r.prestador) };
}

/* ---------------- território e busca (base do matching) ---------------- */

/**
 * Quem atende este ponto. Só ACTIVE entra (§4), e cada um vem com o MOTIVO de ter
 * entrado — o admin precisa poder explicar a fila.
 */
export function buscarPrestadores(destino = {}, filtros = {}) {
  const ativos = prestadores().filter((p) => cad.PARTICIPA_MATCHING.includes(p.status));
  const porCategoria = filtros.categoria
    ? ativos.filter((p) => p.categorias.includes(filtros.categoria))
    : ativos;

  const avaliados = porCategoria.map((p) => {
    const a = atende(p, destino);
    return { ...cad.prestadorPublico(p), atende: a.atende, motivo: a.motivo, criterio: a.criterio, distanciaKm: a.distanciaKm ?? distanciaKm(p.base, destino) };
  });

  const elegiveis = ordenarPorDistancia(avaliados.filter((p) => p.atende), destino);
  return {
    destino,
    categoria: filtros.categoria || null,
    // §9: até ~10 prestadores recebem a oportunidade. Configurável.
    elegiveis: elegiveis.slice(0, filtros.limite || 10),
    totalElegiveis: elegiveis.length,
    // Quem ficou de fora e por quê — é o que permite auditar o matching.
    descartados: avaliados.filter((p) => !p.atende).map((p) => ({ id: p.id, nome: p.nome, motivo: p.motivo })),
    inativosIgnorados: prestadores().length - ativos.length,
  };
}

/* ---------------- indicação ---------------- */

export const indicacoes = () => load(INDICACOES, []);

export function codigoDeIndicacao(nome) {
  return ind.gerarCodigo(nome, indicacoes().map((i) => i.codigo));
}

export function indicar(e = {}, ator = 'sistema') {
  const r = ind.registrarIndicacao(e, indicacoes());
  if (r.erros.length) { return { ok: false, erros: r.erros }; }
  save(INDICACOES, [...indicacoes(), r.indicacao]);
  auditar({ ator, acao: 'cadastro.criado', entidade: 'indicacao', entidadeId: r.indicacao.id });
  return { ok: true, indicacao: r.indicacao };
}

export function converterIndicacao(id, tipo) {
  const todas = indicacoes();
  const i = todas.findIndex((x) => x.id === String(id));
  if (i < 0) { return { ok: false, erro: 'indicação não encontrada' }; }
  const r = ind.converter(todas[i], tipo);
  if (r.erro) { return { ok: false, erro: r.erro }; }
  todas[i] = r.indicacao;
  save(INDICACOES, todas);
  return { ok: true, indicacao: r.indicacao, jaConvertida: r.jaConvertida || false };
}

export const painelIndicacao = () => ind.painel(indicacoes());

/* ---------------- visão geral ---------------- */

export function painel() {
  const ps = prestadores();
  const t = load(TRILHA, []);
  return {
    regiao: REGIAO_MVP,
    clientes: clientes().length,
    prestadores: {
      total: ps.length,
      porStatus: cad.STATUS_PRESTADOR.reduce((a, s) => ({ ...a, [s]: ps.filter((p) => p.status === s).length }), {}),
      semRecebimento: ps.filter((p) => !p.walletId).length,
    },
    categorias: categorias().length,
    indicacao: painelIndicacao(),
    auditoria: { registros: t.length, integridade: aud.verificar(t) },
  };
}
