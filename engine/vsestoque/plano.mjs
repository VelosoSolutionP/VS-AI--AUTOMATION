/**
 * Quanto cabe em cada plano.
 *
 * A regra é comercial, não técnica: bronze 20 produtos, prata 50, ouro liberado
 * até a banda estourar. Ela mora aqui, num lugar só, porque limite espalhado
 * pelo código vira um número diferente em cada tela — e o cliente descobre o
 * limite de verdade no pior momento, tentando cadastrar.
 *
 * DUAS DECISÕES QUE VALEM SER DITAS:
 *
 * 1. Plano desconhecido NÃO bloqueia. Se a licença não informou o plano (ou o
 *    módulo de licença está fora), o limite é nulo e tudo passa. Bloquear no
 *    escuro puniria o cliente por uma falha nossa.
 * 2. O limite conta produto ATIVO. Produto arquivado não ocupa vaga — senão
 *    quem faz limpeza de catálogo é punido por ter histórico.
 */

export const PLANOS = Object.freeze({
  bronze: { limite: 20, nome: 'Bronze' },
  prata: { limite: 50, nome: 'Prata' },
  ouro: { limite: null, nome: 'Ouro' }, // null = sem teto de itens
});

const normalizar = (p) => String(p || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Descobre o plano a partir do nome que vier da licença. Aceita "Plano Prata",
 * "prata", "PRATA " — o nome vem de contrato escrito por gente.
 * @returns {{chave:string|null, limite:number|null, nome:string|null}}
 */
export function planoDe(nomeDoPlano) {
  const n = normalizar(nomeDoPlano);
  if (!n) { return { chave: null, limite: null, nome: null }; }
  for (const [chave, dados] of Object.entries(PLANOS)) {
    if (n.includes(chave)) { return { chave, limite: dados.limite, nome: dados.nome }; }
  }
  return { chave: null, limite: null, nome: nomeDoPlano };
}

/**
 * Cabe mais um?
 * @param {number} ativosAgora quantos produtos ativos já existem
 * @param {string} nomeDoPlano
 */
export function cabeMais(ativosAgora, nomeDoPlano) {
  const p = planoDe(nomeDoPlano);
  if (p.limite == null) { return { ok: true, limite: null, plano: p.nome }; }
  if (ativosAgora < p.limite) { return { ok: true, limite: p.limite, restam: p.limite - ativosAgora, plano: p.nome }; }
  return {
    ok: false,
    limite: p.limite,
    restam: 0,
    plano: p.nome,
    motivo: `o plano ${p.nome} permite ${p.limite} produtos ativos e você já tem ${ativosAgora}. `
      + 'Desative um que não vende mais, ou amplie o plano em Plano e acesso.',
  };
}

/** Resumo pra tela: quanto usou, quanto cabe, e se está perto do teto. */
export function uso(ativosAgora, nomeDoPlano) {
  const p = planoDe(nomeDoPlano);
  if (p.limite == null) {
    return { plano: p.nome, limite: null, usados: ativosAgora, texto: p.nome ? `${p.nome} — sem teto de itens` : 'sem limite definido' };
  }
  const pct = Math.round((ativosAgora / p.limite) * 100);
  return {
    plano: p.nome,
    limite: p.limite,
    usados: ativosAgora,
    restam: Math.max(0, p.limite - ativosAgora),
    pct,
    // Avisa ANTES de bater o teto: descobrir o limite tentando cadastrar é ruim.
    alerta: pct >= 80 ? (pct >= 100 ? 'cheio' : 'quase cheio') : null,
    texto: `${ativosAgora} de ${p.limite} (plano ${p.nome})`,
  };
}
