/**
 * VSqa — aproveita CENARIO e EXECUCAO que ja existem na tarefa, escritos por
 * quem quer que seja (QA, tech lead, outro dev).
 *
 * Por que existe: o fluxo padrao do VSqa assume que quem roda tambem escreve o
 * cenario. Na pratica o cenario ja esta la, escrito pelo QA, em subtarefa ou em
 * nota do historico. Exigir que o dev reescreva o que ja existe trava a
 * regressao inteira por burocracia.
 *
 * O que este modulo faz: le as subtarefas e as notas da issue, extrai o que da
 * pra usar de forma MECANICA (rotas e textos esperados) e devolve um cenario
 * parcial junto com a lista do que nao deu pra inferir.
 *
 * O que este modulo NAO faz: nao finge que texto em prosa vira cenario
 * executavel. Cenario escrito para humano nao carrega seletor de DOM. O que sai
 * daqui e um rascunho com origem rastreada — quem decide se esta pronto continua
 * sendo o `validateScenario`.
 */

/** Rotas plausiveis dentro de um texto livre: /settings, /ai-companion/2 ... */
const RE_ROTA = /(?<![\w/])\/[a-z][a-z0-9-]*(?:\/[a-z0-9_-]+)*/gi;

/** Trechos entre aspas — o QA costuma citar assim o texto esperado na tela. */
const RE_CITADO = /[""]([^""]{3,120})[""]|"([^"]{3,120})"/g;

/** Verbos que denunciam interacao (submit) em vez de leitura. */
const RE_ACAO = /\b(clic|clique|clicar|enviar|salvar|submeter|preencher|ativar|desativar|confirmar)\w*/i;

/** Rotas que aparecem em texto mas nao sao rota de tela. */
const ROTA_FALSA = /^\/(api|assets?|static|_next|favicon|http|https)\b/i;

/**
 * Puxa tudo que ja existe pendurado na issue: subtarefas e notas do historico.
 *
 * `listIssues` filtra por `parent_id` (API padrao do Redmine). Se o tracker nao
 * suportar, devolve so as notas — degrada, nao quebra.
 */
export async function fetchExistingArtifacts(tracker, issueId) {
  const out = { children: [], notes: [], erros: [] };

  try {
    const filhos = await tracker.listIssues(`parent_id=${issueId}&status_id=*`);
    out.children = Array.isArray(filhos) ? filhos : (filhos?.issues || []);
  } catch (e) {
    out.erros.push(`subtarefas: ${e.message}`);
  }

  try {
    const raw = await tracker.getIssue(issueId);
    const issue = raw?.issue || raw;
    const journals = issue?.journals || [];
    out.notes = journals
      .map((j) => ({ autor: j.user?.name || '?', texto: String(j.notes || '').trim() }))
      .filter((n) => n.texto !== '');
  } catch (e) {
    out.erros.push(`notas: ${e.message}`);
  }

  return out;
}

/**
 * Separa o que interessa de um texto livre. Heuristica declarada, sem magica:
 * rota = primeiro caminho plausivel; expectText = primeiro trecho entre aspas;
 * mode = 'form' se houver verbo de acao, senao 'read'.
 */
export function extractScenarioFromText(texto) {
  const t = String(texto || '');

  const rotas = [...t.matchAll(RE_ROTA)]
    .map((m) => m[0])
    .filter((r) => !ROTA_FALSA.test(r));

  const citados = [...t.matchAll(RE_CITADO)]
    .map((m) => (m[1] || m[2] || '').trim())
    .filter((s) => s !== '' && !s.startsWith('/'));

  return {
    path: rotas[0] || null,
    rotasEncontradas: [...new Set(rotas)],
    expectText: citados[0] || null,
    textosCitados: [...new Set(citados)],
    mode: RE_ACAO.test(t) ? 'form' : 'read',
  };
}

const ehCenario = (s) => /cen[aá]rio|scenario|caso de teste|\bCT\d/i.test(String(s || ''));
const ehExecucao = (s) => /execu[cç][aã]o|retest|reteste|evid[eê]ncia/i.test(String(s || ''));

/**
 * Monta um cenario a partir do que ja existe na tarefa.
 *
 * Ordem de preferencia, da fonte mais estruturada para a menos:
 *   1. subtarefa de CENARIO (foi escrita pra isso)
 *   2. subtarefa de EXECUCAO (costuma trazer o passo a passo do reteste)
 *   3. notas do historico (o QA descreve a reproducao ali)
 *
 * @returns {{scenario: object|null, origem: string|null, candidatos: object[], avisos: string[]}}
 */
export async function scenarioFromTracker(tracker, issueId, opts = {}) {
  const { children, notes, erros } = await fetchExistingArtifacts(tracker, issueId);
  const avisos = [...erros];

  const fontes = [];
  for (const c of children) {
    const assunto = c.subject || '';
    const corpo = `${assunto}\n${c.description || ''}`;
    if (ehCenario(assunto)) { fontes.push({ tipo: 'subtarefa-cenario', id: c.id, autor: c.author?.name, texto: corpo, peso: 3 }); }
    else if (ehExecucao(assunto)) { fontes.push({ tipo: 'subtarefa-execucao', id: c.id, autor: c.author?.name, texto: corpo, peso: 2 }); }
    else { fontes.push({ tipo: 'subtarefa', id: c.id, autor: c.author?.name, texto: corpo, peso: 1 }); }
  }
  for (const n of notes) {
    fontes.push({ tipo: 'nota', autor: n.autor, texto: n.texto, peso: ehExecucao(n.texto) ? 2 : 1 });
  }

  if (fontes.length === 0) {
    avisos.push('nada reaproveitavel: a tarefa nao tem subtarefa nem nota com passo a passo');
    return { scenario: null, origem: null, candidatos: [], avisos };
  }

  fontes.sort((a, b) => b.peso - a.peso);

  const candidatos = fontes.map((f) => ({ ...f, extraido: extractScenarioFromText(f.texto) }));
  const escolhido = candidatos.find((c) => c.extraido.path) || candidatos[0];

  if (!escolhido.extraido.path) {
    avisos.push('nenhuma rota citada no material existente — o passo precisa de `path` a mao');
  }
  if (!escolhido.extraido.expectText) {
    avisos.push('nenhum texto entre aspas no material existente — sem assertiva inferida');
  }

  const base = opts.us?.titulo || opts.us?.subject || `issue-${issueId}`;

  return {
    scenario: {
      issueId,
      titulo: base,
      steps: [{
        name: `${escolhido.tipo}-${issueId}`,
        mode: escolhido.extraido.mode,
        path: escolhido.extraido.path,
        expectText: escolhido.extraido.expectText,
      }],
    },
    origem: `${escolhido.tipo}${escolhido.id ? ` #${escolhido.id}` : ''}${escolhido.autor ? ` (${escolhido.autor})` : ''}`,
    candidatos,
    avisos,
  };
}
