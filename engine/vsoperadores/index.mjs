/**
 * Cadastro de operadores, com o teto vindo do CONTRATO.
 *
 * Fica fora do repositorio, como o resto do dado de cliente: `~/.qa-gate/vsoperadores`.
 * O limite NAO e escrito aqui — vem do plano contratado (`vsplanos`), que e onde
 * o comercial mexe. Cravar numero neste arquivo faria "Bronze V2" nascer torto.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { validar, cabeMais, porSetor, setoresSemGente, uso, ativos, norm } from './regras.mjs';
import { limiteDeAtendentes } from '../vsplanos/index.mjs';

export { porSetor, setoresSemGente, ativos, norm };

const arq = () => join(process.env.VSOPERADORES_DIR || join(homedir(), '.qa-gate', 'vsoperadores'), 'operadores.json');
const ler = () => { try { return JSON.parse(readFileSync(arq(), 'utf8')); } catch { return []; } };
const gravar = (lista) => {
  mkdirSync(dirname(arq()), { recursive: true, mode: 0o700 });
  writeFileSync(arq(), JSON.stringify(lista, null, 2), { mode: 0o600 });
  return lista;
};

export const listar = () => ler();

/** Quem atende um setor, agora. Vazio aqui = cliente encaminhado pro vazio. */
export const doSetor = (setor) => ativos(ler()).filter((o) => o.setor === norm(setor));

export function salvar(dados = {}) {
  const v = validar(dados);
  if (!v.ok) { return v; }

  const lista = ler();
  const limite = limiteDeAtendentes();

  /* Reativar alguem ocupa vaga igual a cadastrar — senao o teto do contrato
     vira decoracao: bastava desativar, cadastrar outro e reativar o primeiro. */
  const antes = lista.find((o) => o.id === v.operador.id);
  const virandoAtivo = v.operador.ativo && (!antes || antes.ativo === false);
  if (virandoAtivo) {
    const cabe = cabeMais(lista, limite, antes?.ativo === false ? null : v.operador.id);
    if (!cabe.ok) { return { ok: false, erros: [cabe.motivo], limite: cabe }; }
  }

  const nova = [...lista.filter((o) => o.id !== v.operador.id), v.operador]
    .sort((a, b) => a.setor.localeCompare(b.setor) || a.nome.localeCompare(b.nome));
  gravar(nova);
  return { ok: true, operador: v.operador, uso: uso(nova, limite) };
}

export function remover(id) {
  const lista = ler();
  if (!lista.some((o) => o.id === id)) { return { ok: false, erros: ['operador não encontrado'] }; }
  gravar(lista.filter((o) => o.id !== id));
  return { ok: true };
}

/** O que a tela precisa: lista, uso do contrato e os setores descobertos. */
export function painel(setoresDoFluxo = []) {
  const lista = ler();
  return {
    operadores: lista,
    uso: uso(lista, limiteDeAtendentes()),
    porSetor: porSetor(lista),
    setoresSemGente: setoresSemGente(lista, setoresDoFluxo),
  };
}
