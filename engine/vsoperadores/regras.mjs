/**
 * Operadores humanos: quem recebe o cliente quando a Micaela passa adiante.
 *
 * Regra puras, sem disco. O que elas protegem:
 *  - o teto do CONTRATO, que é o que o cliente comprou;
 *  - o operador sem setor, que existe no cadastro e nunca recebe nada;
 *  - o setor sem gente, que engole cliente encaminhado e não devolve.
 */

export const norm = (t) => String(t ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Só dígitos — telefone é identificação, não texto livre. */
const soDigitos = (t) => String(t ?? '').replace(/\D/g, '');

export function validar(dados = {}) {
  const erros = [];
  const nome = String(dados.nome || '').trim();
  const setor = norm(dados.setor);
  if (!nome) { erros.push('informe o nome do operador'); }
  /* Operador sem setor e o pior tipo de cadastro: existe na tela, conta no
     teto do contrato e nunca recebe cliente nenhum. Some sem dar erro. */
  if (!setor) { erros.push('escolha o setor — sem setor ele nunca recebe cliente'); }

  const telefone = soDigitos(dados.telefone);
  if (telefone && (telefone.length < 10 || telefone.length > 13)) {
    erros.push('telefone fora do padrão — informe com DDD');
  }
  if (erros.length) { return { ok: false, erros }; }

  return {
    ok: true,
    operador: {
      id: String(dados.id || '').trim() || `op-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      nome,
      setor,
      telefone: telefone || null,
      email: String(dados.email || '').trim() || null,
      /* Ativo por padrao: quem acabou de ser cadastrado e pra trabalhar. */
      ativo: dados.ativo !== false,
      criadoEm: dados.criadoEm || new Date().toISOString(),
    },
  };
}

/** Só quem está ATIVO ocupa vaga — quem saiu da empresa não pode custar. */
export const ativos = (lista = []) => lista.filter((o) => o.ativo !== false);

/**
 * Cabe mais um?
 *
 * `limite` null significa "o contrato não informou" — e aí NÃO se bloqueia:
 * falha nossa de cadastro não pode impedir o cliente de trabalhar.
 *
 * `entrando` é o id de quem está sendo salvo: editar alguém que já existe não
 * consome vaga nova. Sem isso, o cadastro cheio virava cadastro congelado —
 * ninguém conseguia nem corrigir um nome escrito errado.
 */
export function cabeMais(lista = [], limite, entrando = null) {
  if (limite == null) { return { ok: true, ilimitado: true }; }
  const jaEra = lista.find((o) => o.id === entrando);
  if (jaEra && jaEra.ativo !== false) { return { ok: true, edicao: true }; }

  const usados = ativos(lista).length;
  if (usados < limite) { return { ok: true, usados, limite }; }
  return {
    ok: false,
    usados,
    limite,
    motivo: `o contrato libera ${limite} ${limite === 1 ? 'operador' : 'operadores'} e ${limite === 1 ? 'ele já está' : 'todos já estão'} em uso.`
      + ' Amplie o contrato ou desative alguém que não atende mais.',
  };
}

/** Quantos, por setor — só os ativos, que é quem de fato recebe. */
export function porSetor(lista = []) {
  const mapa = {};
  for (const o of ativos(lista)) { mapa[o.setor] = (mapa[o.setor] || 0) + 1; }
  return mapa;
}

/**
 * Setores para onde a conversa é encaminhada e que não têm NINGUÉM ativo.
 *
 * É o buraco silencioso deste módulo: a Micaela transfere, o cliente espera, e
 * não há quem receba. Ninguém percebe até o cliente cobrar — quando percebe.
 */
export function setoresSemGente(lista = [], setoresDoFluxo = []) {
  const tem = porSetor(lista);
  return [...new Set(setoresDoFluxo.map(norm).filter(Boolean))]
    .filter((s) => s !== 'humano' && !tem[s]);
}

/** Uso do contrato, pronto pra tela. */
export function uso(lista = [], limite) {
  const usados = ativos(lista).length;
  if (limite == null) { return { usados, limite: null, texto: `${usados} cadastrados — sem limite informado` }; }
  return {
    usados,
    limite,
    cheio: usados >= limite,
    /* Avisa ANTES de encher: descobrir o teto na hora de cadastrar o operador
       novo, com a pessoa contratada esperando, e descobrir tarde. */
    alerta: usados >= limite ? 'cheio' : (usados >= limite * 0.8 ? 'quase cheio' : null),
    texto: `${usados} de ${limite} do contrato`,
  };
}
