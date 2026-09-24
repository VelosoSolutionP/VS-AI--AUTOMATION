/**
 * Jogo de cintura — IA LOCAL que só ENTENDE, nunca FALA.
 *
 * O dicionário do `entender.mjs` resolve o grosso de graça, mas trava em frase
 * que ele não conhece: erro de digitação, gíria, jeito diferente de dizer a
 * mesma coisa. Era aí que o bot virava "não achei nas opções" pra quem já tinha
 * dito o que queria.
 *
 * Aqui um modelo pequeno, rodando NA MÁQUINA (Ollama), recebe a mensagem e as
 * opções DAQUELE ponto do menu e devolve UMA coisa: qual opção a pessoa quis, ou
 * "nenhuma". A resposta ao cliente continua sendo o texto configurado no fluxo —
 * a IA não escreve pro cliente, então não inventa preço, prazo nem promessa.
 *
 * Sem dinheiro e sem dólar: nada sai da máquina. E se a IA estiver fora do ar ou
 * demorar, devolve null e o bot segue como antes — ela ajuda, nunca trava.
 */

export const PADRAO_CEREBRO = {
  ligado: false,
  url: 'http://127.0.0.1:11434',
  modelo: 'qwen2.5:3b',
  timeoutMs: 8000,
};

const SISTEMA = [
  'Você lê a mensagem de um cliente no WhatsApp e diz qual opção do menu ele quer.',
  'O cliente escreve com erro, gíria, abreviação e sem acento ("qro" = quero, "c" = com, "vcs" = vocês, "insta" = Instagram, "dando pau" = com defeito).',
  'Cada opção pode trazer entre parênteses o que ela inclui: use isso para entender do que ela trata.',
  'Escolha a opção cujo assunto é o que a pessoa quer resolver.',
  'Cumprimento sozinho ("oi", "bom dia", "tudo bem?") ou mensagem sem pedido: responda "nenhuma".',
  'Se nenhuma opção combina, responda "nenhuma". Nunca invente opção.',
].join('\n');

/**
 * @param {string} texto  o que o cliente escreveu
 * @param {{tecla:string, texto:string}[]} opcoes  as opções do passo atual
 * @returns {Promise<{tecla:string|null, ms:number, erro?:string}>}
 */
export async function escolherOpcao(texto, opcoes, cfg = {}, { fetch: f = globalThis.fetch } = {}) {
  const c = { ...PADRAO_CEREBRO, ...cfg };
  const teclas = (opcoes || []).map((o) => String(o.tecla));
  const inicio = Date.now();
  if (!teclas.length || !String(texto || '').trim()) { return { tecla: null, ms: 0 }; }
  /* O modelo escolhe pelo NOME da opção: número solto não tem significado e
     modelo pequeno chutava o "3" pra tudo. Nome e tecla são reconvertidos aqui. */
  const nomes = opcoes.map((o) => String(o.texto).trim());
  const menu = opcoes.map((o, i) => `- ${nomes[i]}${o.sobre ? ` (inclui: ${String(o.sobre).slice(0, 160)})` : ''}`).join('\n');
  const ctrl = new AbortController();
  const relogio = setTimeout(() => ctrl.abort(), c.timeoutMs);
  try {
    const r = await f(`${c.url}/api/chat`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: c.modelo,
        stream: false,
        keep_alive: '24h',
        options: { temperature: 0, num_predict: 16 },
        /* Formato travado: a saída SÓ pode ser uma das teclas ou "nenhuma". */
        format: { type: 'object', properties: { opcao: { type: 'string', enum: [...nomes, 'nenhuma'] } }, required: ['opcao'] },
        messages: [
          { role: 'system', content: SISTEMA },
          { role: 'user', content: `Opções do menu:\n${menu}\n\nMensagem do cliente: "${String(texto).slice(0, 400)}"\n\nResponda {"opcao": "<nome exato da opção>"} ou {"opcao": "nenhuma"}.` },
        ],
      }),
    });
    if (!r.ok) { return { tecla: null, ms: Date.now() - inicio, erro: `ollama respondeu ${r.status}` }; }
    const j = await r.json();
    let escolha = null;
    try { escolha = String(JSON.parse(j?.message?.content || '{}').opcao ?? ''); } catch { escolha = null; }
    /* Confere de novo: só vale opção que EXISTE neste passo. */
    const i = nomes.indexOf(escolha);
    return { tecla: i >= 0 ? teclas[i] : null, ms: Date.now() - inicio };
  } catch (e) {
    return { tecla: null, ms: Date.now() - inicio, erro: e.name === 'AbortError' ? `demorou mais de ${c.timeoutMs} ms` : e.message };
  } finally {
    clearTimeout(relogio);
  }
}
