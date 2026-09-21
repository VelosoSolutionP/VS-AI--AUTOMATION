/**
 * Entender o que a pessoa escreveu — sem IA paga.
 *
 * O fluxo em árvore protege o encaminhamento: ninguém se perde, e o especialista
 * sempre recebe o caso certo. O erro era OBRIGAR o cliente a percorrer a árvore
 * tecla por tecla. Quem manda "meu boleto venceu" já disse tudo; pedir pra ele
 * digitar 1, esperar, digitar 3 é fazê-lo repetir o que acabou de falar.
 *
 * Aqui não tem modelo de linguagem, não tem chamada paga, não tem rede. Tem
 * dicionário e contagem — determinístico, testável e de graça. Quando a conta
 * não fecha com folga, este módulo NÃO chuta: devolve o empate e quem chamou
 * mostra o menu. Chutar departamento manda o cliente pra pessoa errada, e ele
 * conta o problema duas vezes.
 */

const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/* Palavras que aparecem em toda frase e não escolhem nada. Deixá-las pontuar
   faria "quero falar sobre o sistema" casar com qualquer opção que diga "falar". */
const VAZIAS = new Set([
  'que', 'qual', 'quais', 'para', 'pra', 'por', 'com', 'sem', 'dos', 'das', 'nos', 'nas',
  'meu', 'minha', 'meus', 'minhas', 'seu', 'sua', 'uma', 'uns', 'umas', 'esse', 'essa',
  'isso', 'este', 'esta', 'aqui', 'ali', 'tem', 'ter', 'sou', 'sao', 'estou', 'esta',
  'quero', 'queria', 'gostaria', 'preciso', 'precisava', 'poderia', 'pode', 'consigo',
  'falar', 'saber', 'sobre', 'ajuda', 'ajudar', 'favor', 'bom', 'boa', 'dia', 'tarde',
  'noite', 'obrigado', 'obrigada', 'voce', 'voces', 'gente', 'coisa', 'algum', 'alguma',
  'ser', 'estar', 'fazer', 'vai', 'vou', 'ver', 'aí', 'lá', 'nao', 'sim', 'mais', 'muito',
]);

const palavras = (t) => norm(t).split(/[^a-z0-9]+/).filter((p) => p.length > 2 && !VAZIAS.has(p));

/**
 * Como o cliente FALA × como a opção está ESCRITA.
 *
 * A chave é o que aparece no texto da opção; a lista é o vocabulário real de
 * quem escreve no WhatsApp. Ninguém digita "Suporte técnico": digita "travou",
 * "deu erro", "parou de funcionar".
 */
export const VOCABULARIO = {
  financeiro: ['boleto', 'fatura', 'nota', 'nfe', 'pagamento', 'pagar', 'paguei', 'cobranca',
    'cobrando', 'segunda', 'via', 'vencimento', 'venceu', 'vencido', 'atraso', 'atrasado',
    'mensalidade', 'divida', 'debito', 'reembolso', 'estorno', 'pix', 'cartao', 'recibo'],
  suporte: ['erro', 'problema', 'travando', 'travou', 'travei', 'bug', 'funciona', 'funcionando',
    'parou', 'lento', 'lentidao', 'caiu', 'defeito', 'quebrou', 'falha', 'fora', 'acesso',
    'senha', 'entrar', 'logar', 'login', 'bloqueado', 'suporte', 'tecnico'],
  comercial: ['preco', 'valor', 'valores', 'orcamento', 'contratar', 'comprar', 'assinar',
    'plano', 'planos', 'proposta', 'custa', 'custo', 'quanto', 'vender', 'vendas', 'demonstracao',
    'demo', 'conhecer', 'interesse', 'interessado', 'contratacao'],
  cliente: ['cliente', 'contrato', 'contratei', 'assinante', 'uso', 'utilizo', 'minha empresa'],
  parcerias: ['parceria', 'parceiro', 'parceiros', 'revenda', 'revender', 'revendedor',
    'revendedora', 'indicacao', 'indicar', 'comissao', 'representante'],
  administrativo: ['contrato', 'cadastro', 'dados', 'documento', 'documentos', 'endereco', 'cnpj'],
  pessoa: ['pessoa', 'humano', 'atendente', 'alguem', 'consultor', 'especialista'],
  automacao: ['automacao', 'automatizar', 'robo', 'chatbot', 'inteligencia', 'artificial'],
  desenvolvimento: ['sistema', 'site', 'aplicativo', 'app', 'software', 'programa', 'desenvolver'],
  testes: ['teste', 'testes', 'qualidade', 'homologacao', 'governanca', 'auditoria'],
};

/** Vocabulário que vale para uma opção, a partir do que ela diz. */
function termosDa(opcao) {
  const texto = norm(opcao.texto || '');
  const termos = new Set(palavras(texto));
  /* O texto da opcao nem sempre diz o assunto: "Quero conhecer as solucoes"
     leva pro comercial sem a palavra "comercial" aparecer. Quem sabe o assunto
     e o DESTINO — vai_para e departamento. Sem olhar pra eles, a opcao mais
     comercial do menu ficava sem vocabulario nenhum. */
  const pistas = `${texto} ${norm(opcao.vaiPara || '')} ${norm(opcao.departamento || '')}`;
  for (const [chave, lista] of Object.entries(VOCABULARIO)) {
    if (pistas.includes(chave)) { lista.forEach((t) => termos.add(t)); }
  }
  /* A opção pode declarar as próprias palavras na planilha — é assim que o
     dono do negócio ensina o vocabulário da casa dele sem mexer em código. */
  (opcao.termos || []).forEach((t) => palavras(t).forEach((p) => termos.add(p)));
  return termos;
}

/* Portugues flexiona muito: "revendedor" e "revenda", "contrato" e "contratar",
   "parceria" e "parceiros". Cadastrar cada forma na mao e trabalho que nunca
   acaba e sempre falta uma. Seis letras iguais no comeco resolve a familia
   inteira sem abrir a porta pra qualquer coisa. */
const RAIZ = 6;
const mesmaFamilia = (a, b) => (a.length >= RAIZ && b.length >= RAIZ && a.slice(0, RAIZ) === b.slice(0, RAIZ));
/* Pontua por PALAVRA DITA, nunca por termo do dicionario: senao "parceria"
   valia dois pontos so porque a lista tem "parceria" e "parceiros", e uma
   palavra sozinha ganhava de uma frase inteira.

   Acerto exato vale mais que parentesco. E o que separa "ja tenho CONTRATO"
   (quem ja e cliente) de "quero CONTRATAR" (quem quer virar): as duas sao da
   mesma familia, mas so uma esta escrita ali. */
function nota(ditas, termos) {
  let pontos = 0;
  for (const dita of ditas) {
    let melhor = 0;
    for (const termo of termos) {
      if (dita === termo) { melhor = 2; break; }
      if (mesmaFamilia(dita, termo)) { melhor = Math.max(melhor, 1); }
    }
    pontos += melhor;
  }
  return pontos;
}

/**
 * Qual opção a frase está pedindo.
 *
 * Devolve `{ escolhida }` quando há um vencedor folgado, `{ empate: [...] }`
 * quando duas disputam, e `{}` quando nada casou. Empate NÃO vira escolha: uma
 * resposta errada com cara de certeza custa mais que uma pergunta a mais.
 */
export function entender(texto, opcoes = []) {
  const ditas = new Set(palavras(texto));
  if (!ditas.size || !opcoes.length) { return {}; }

  const notas = opcoes
    .map((o) => {
      return { opcao: o, pontos: nota(ditas, termosDa(o)) };
    })
    .filter((n) => n.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos);

  if (!notas.length) { return {}; }
  if (notas.length > 1 && notas[0].pontos === notas[1].pontos) {
    return { empate: notas.filter((n) => n.pontos === notas[0].pontos).map((n) => n.opcao) };
  }
  return { escolhida: notas[0].opcao, pontos: notas[0].pontos };
}

/**
 * O assunto está DOIS NÍVEIS ABAIXO — e a pessoa já disse qual é.
 *
 * "O sistema travou" não casa com nada no menu de cima, porque Suporte mora
 * dentro de "Já sou cliente". Obrigar quem já disse o problema a caçar o
 * caminho é justamente o que faz desistir no meio.
 *
 * Só vale a partir do começo da conversa: no meio da árvore o que a pessoa
 * escreve costuma ser RESPOSTA à pergunta da vez, e pular dali seria trocar o
 * assunto na cara dela. E exige folga na conta — um ponto solto não move
 * ninguém de lugar.
 */
export function entenderNoFluxo(texto, fluxo, { ignorar = null, minimo = 2 } = {}) {
  const passos = (fluxo?.passos || []).filter((p) => String(p.id) !== String(ignorar));
  if (!passos.length) { return {}; }

  /* Passo que nao e assunto nao e destino: ninguem quer ser levado pra
     "obrigada pelo contato" nem pra pesquisa de satisfacao. Entram os que tem
     escolhas, os que tem dono (departamento) e os que perguntam algo. */
  const ehDestino = (p) => (p.opcoes || []).length > 0 || p.departamento
    || ['encaminhar', 'coletar', 'confirmar'].includes(String(p.acao || ''));

  const candidatos = [];
  const vistos = new Set();
  for (const p of passos.filter(ehDestino)) {
    /* O id e o departamento dizem o assunto melhor que a mensagem, que e texto
       de conversa. A mensagem entra porque e onde o dono do negocio escreveu,
       com as palavras dele, do que aquele passo trata. */
    if (!vistos.has(p.id)) {
      vistos.add(p.id);
      candidatos.push({ passo: p, como: { texto: `${p.id} ${p.mensagem || ''}`, vaiPara: p.id, departamento: p.departamento } });
    }
    /* As OPCOES tambem valem como destino. "Automacao / IA" nao e passo, e uma
       tecla dentro do comercial — e e exatamente o que a pessoa escreveu.

       Uma opcao que leva ao passo X e o passo X sao O MESMO DESTINO contados
       duas vezes. Deixar os dois na disputa fabrica empate onde nao ha duvida
       nenhuma, e o empate cancela o salto — a pessoa levava menu de volta por
       causa de uma contagem errada nossa. A opcao ganha: ela carrega a fala e
       a acao que o passo sozinho nao tem. */
    for (const o of p.opcoes || []) {
      const destino = o.vaiPara || null;
      if (destino) {
        const antes = candidatos.findIndex((c) => c.passo && String(c.passo.id) === String(destino));
        if (antes >= 0) { candidatos.splice(antes, 1); }
        vistos.add(destino);
      }
      candidatos.push({ opcao: o, pai: p, como: { texto: o.texto, vaiPara: o.vaiPara, departamento: o.departamento, termos: o.termos } });
    }
  }

  const r = entender(texto, candidatos.map((c) => c.como));

  /* Empate entre IRMAS nao e duvida de assunto, e de detalhe: "automatizar meu
     atendimento" casa com "Vendas / CRM / atendimento" e com "Automacao / IA",
     e as duas moram dentro do comercial. Devolver o menu principal ali seria
     jogar fora o que a pessoa disse. Leva pro galho e deixa ela escolher entre
     as duas — um toque, no lugar certo. */
  if (r.empate) {
    let irmas = r.empate.map((c) => candidatos.find((x) => x.como === c)).filter(Boolean);

    /* Um empatado DENTRO do outro nao e empate: "Suporte tecnico" leva a uma
       triagem, e "Nao abre" e uma das escolhas DESSA triagem. Fica o de fora —
       chega no mesmo lugar e ainda deixa a pessoa refinar em vez de decidir
       por ela qual dos sintomas e o dela. */
    const destinos = new Set(irmas.map((i) => i.como.vaiPara).filter(Boolean));
    const foraDeDentro = irmas.filter((i) => !(i.pai && destinos.has(String(i.pai.id))));
    if (foraDeDentro.length === 1) {
      const so = foraDeDentro[0];
      return { passo: so.passo || null, opcao: so.opcao || null, pontos: r.pontos || minimo, porFora: true };
    }
    if (foraDeDentro.length) { irmas = foraDeDentro; }
    const pais = new Set(irmas.map((i) => i.pai?.id).filter(Boolean));
    if (pais.size === 1 && irmas.length > 1) {
      return { passo: irmas[0].pai, pontos: minimo, porIrmas: true };
    }
    return {};
  }

  if (!r.escolhida || (r.pontos || 0) < minimo) { return {}; }
  const achado = candidatos.find((c) => c.como === r.escolhida);
  if (!achado) { return {}; }
  return { passo: achado.passo || null, opcao: achado.opcao || null, pontos: r.pontos };
}
