/**
 * Fluxo vindo de planilha.
 *
 * Cadastrar árvore de conversa uma tela por vez é trabalho de escriba: quem
 * conhece o atendimento escreve rápido numa planilha e pensa melhor vendo tudo
 * junto. Então o formato é UMA LINHA POR OPÇÃO, e a mensagem do passo vai só na
 * primeira linha dele:
 *
 *   passo,mensagem,opcao,texto_opcao,vai_para,acao,resposta
 *   inicio,"Boa noite! Sou a Micaela...",1,"Já sou cliente",cliente,,
 *   inicio,,2,"Quero conhecer",novo,,
 *   cliente,"Que bom! Me confirma seu nome?",,,,confirmar,
 *   novo,"Vou te passar pro comercial.",,,,comercial,
 *
 * O PRIMEIRO passo da planilha é por onde a conversa começa.
 *
 * Aceita `;` além de `,` porque Excel em português salva com ponto e vírgula —
 * e quem exporta do Excel não tem por que saber disso.
 */
import { validarFluxo, ACOES, valorEmCentavos } from './fluxo.mjs';

/**
 * O vocabulario de quem escreve a planilha nao e o do motor — e nem deveria
 * ser. Quem desenha atendimento escreve "encaminhar_financeiro", nao
 * "encaminhar com departamento=financeiro". A traducao mora aqui.
 */
const SINONIMOS = [
  [/^encaminhar[_ -]?(.*)$/, (m) => ({ acao: ACOES.ENCAMINHAR, departamento: m[1] || 'humano' })],
  [/^(falar|chamar)[_ -]?(humano|pessoa|atendente|especialista)$/, () => ({ acao: ACOES.ENCAMINHAR, departamento: 'humano' })],
  [/^(comercial|financeiro|suporte|administrativo|parcerias)$/, (m) => ({ acao: ACOES.ENCAMINHAR, departamento: m[1] })],
  [/^abrir[_ -]?ticket.*$/, () => ({ acao: ACOES.ENCAMINHAR, departamento: 'especialista', pendente: 'ticket' })],
  [/^coletar.*$|^texto[_ -]?livre$/, () => ({ acao: ACOES.COLETAR })],
  [/^(catalogo|produtos|vitrine)$/, () => ({ acao: ACOES.CATALOGO })],
  [/^confirmar.*$/, () => ({ acao: ACOES.CONFIRMAR })],
  [/^(cobrar.*|cobranca.*|pagar.*|pagamento.*|link[_ -]?de[_ -]?pagamento)$/, () => ({ acao: ACOES.COBRAR })],
  [/^(fim|finalizar.*|encerrar.*)$/, () => ({ acao: ACOES.FIM })],
  [/^(consultar[_ -]?base.*|.*_kb|apresentar[_ -]?solucao.*|tentativa[_ -]?base)$/, () => ({ acao: ACOES.NOTA, pendente: 'base de conhecimento' })],
  [/^(satisfacao|avaliacao|nota|resolvido)$/, () => ({ acao: ACOES.NOTA })],
];

/** @returns {{acao, departamento?, pendente?}|null} */
export function traduzirAcao(bruta) {
  const a = semAcento(bruta).replace(/\s+/g, '_');
  if (!a) { return null; }
  if (Object.values(ACOES).includes(a)) { return { acao: a }; }
  for (const [re, fn] of SINONIMOS) {
    const m = a.match(re);
    if (m) { return fn(m); }
  }
  return { acao: null, desconhecida: bruta };
}

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Nomes que a mesma coluna pode ter. Planilha de gente real não segue padrão. */
const COLUNAS = {
  passo: ['passo', 'etapa', 'id', 'tela'],
  mensagem: ['mensagem', 'texto', 'pergunta', 'fala'],
  opcao: ['opcao', 'tecla', 'numero', 'num'],
  textoOpcao: ['texto_opcao', 'textoopcao', 'opcao_texto', 'rotulo', 'label', 'escolha'],
  vaiPara: ['vai_para', 'vaipara', 'proximo', 'destino', 'ir_para'],
  acao: ['acao', 'action', 'fim'],
  resposta: ['resposta', 'mensagem_final', 'despedida'],
  valor: ['valor', 'preco', 'preço', 'price', 'valor_rs', 'r$'],
  sku: ['sku', 'codigo', 'código', 'cod', 'produto'],
};

/**
 * Divide uma linha de CSV respeitando aspas. Vírgula DENTRO de aspas é parte do
 * texto — e mensagem de atendimento é cheia de vírgula.
 */
export function partirLinha(linha, sep) {
  const out = [];
  let campo = '';
  let dentro = false;
  for (let i = 0; i < linha.length; i += 1) {
    const c = linha[i];
    if (c === '"') {
      if (dentro && linha[i + 1] === '"') { campo += '"'; i += 1; } // "" escapado
      else { dentro = !dentro; }
    } else if (c === sep && !dentro) { out.push(campo); campo = ''; } else { campo += c; }
  }
  out.push(campo);
  /* Tira espaço das pontas mas PRESERVA a quebra de linha do meio: ela é o que
     faz um cardápio ser legível no WhatsApp. */
  return out.map((x) => x.replace(/^[ \t]+|[ \t]+$/g, '').replace(/^\n+|\n+$/g, ''));
}

/**
 * Parte o arquivo em REGISTROS, não em linhas.
 *
 * Célula com quebra de linha é o normal, não a exceção: um cardápio, um menu
 * com opções, qualquer mensagem de mais de uma frase. O Excel e o Google
 * Planilhas exportam isso entre aspas, com o \n dentro — e partir por \n antes
 * de olhar as aspas rasgava a mensagem no meio.
 *
 * O estrago era pior que perder a quebra: cada pedaço virava um "passo" sem
 * mensagem, e a importação devolvia trinta erros sobre passos que nunca
 * existiram. Quem lia aquilo não tinha como adivinhar que o problema era uma
 * quebra de linha.
 */
export function partirRegistros(texto) {
  const regs = [];
  let atual = '';
  let dentro = false;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (c === '"') {
      if (dentro && texto[i + 1] === '"') { atual += '""'; i += 1; continue; }
      dentro = !dentro;
      atual += c;
      continue;
    }
    if ((c === '\n' || c === '\r') && !dentro) {
      if (c === '\r' && texto[i + 1] === '\n') { i += 1; }
      if (atual.trim()) { regs.push(atual); }
      atual = '';
      continue;
    }
    atual += c;
  }
  if (atual.trim()) { regs.push(atual); }
  return regs;
}

const detectarSeparador = (cabecalho) => ((cabecalho.match(/;/g) || []).length > (cabecalho.match(/,/g) || []).length ? ';' : ',');

/** CSV -> fluxo validado. Não grava nada: quem grava é quem chamou. */
export function fluxoDeCsv(texto) {
  /* Tira o BOM. Excel e Google Planilhas gravam UTF-8 com marca de ordem de
     bytes, e ela gruda na PRIMEIRA coluna do cabecalho: "passo" vira "\uFEFFpasso"
     e a importacao falha dizendo que nao achou a coluna que esta ali na cara. */
  const cru = String(texto || '').replace(/^\uFEFF/, '');
  const linhas = partirRegistros(cru);
  if (linhas.length < 2) { return { erros: ['a planilha está vazia ou só tem o cabeçalho'] }; }

  const sep = detectarSeparador(linhas[0]);
  const cab = partirLinha(linhas[0], sep).map(semAcento);
  const idx = {};
  for (const [chave, nomes] of Object.entries(COLUNAS)) {
    idx[chave] = cab.findIndex((c) => nomes.includes(c));
  }
  if (idx.passo < 0) {
    return { erros: [`não achei a coluna "passo" no cabeçalho (achei: ${cab.join(', ')})`] };
  }

  const erros = [];
  const pendentes = new Set(); // o que a planilha pede e o sistema ainda nao faz
  const porId = new Map();
  const ordem = [];

  linhas.slice(1).forEach((linha, n) => {
    const col = partirLinha(linha, sep);
    const v = (k) => (idx[k] >= 0 ? (col[idx[k]] || '').trim() : '');
    const id = v('passo');
    if (!id) { erros.push(`linha ${n + 2}: sem o nome do passo`); return; }

    if (!porId.has(id)) { porId.set(id, { id, mensagem: '', opcoes: [] }); ordem.push(id); }
    const passo = porId.get(id);

    const msg = v('mensagem');
    if (msg) {
      if (passo.mensagem && passo.mensagem !== msg) {
        erros.push(`linha ${n + 2}: o passo "${id}" já tinha mensagem — a mensagem vai só na primeira linha do passo`);
      }
      passo.mensagem = msg;
    }

    const brutaAcao = v('acao');
    const trad = brutaAcao ? traduzirAcao(brutaAcao) : null;
    if (trad?.desconhecida) {
      erros.push(`linha ${n + 2}: não conheço a ação "${trad.desconhecida}"`);
      return;
    }
    if (trad?.pendente) { pendentes.add(`${trad.pendente} (usada como "${brutaAcao}")`); }
    const textoOpcao = v('textoOpcao');

    /* Preço escrito e ilegível é erro na hora, não surpresa na cobrança: quem
       digitou "39,90 reais" precisa saber agora, não quando o link sair errado. */
    const bruto = v('valor');
    const valorCentavos = valorEmCentavos(bruto);
    if (bruto && valorCentavos == null) {
      erros.push(`linha ${n + 2}: não entendi o valor "${bruto}" (escreva como 39,90)`);
      return;
    }

    // Linha sem opção = a própria ação do passo (fim de galho ou passagem).
    if (!textoOpcao) {
      if (trad) { passo.acao = trad.acao; passo.departamento = trad.departamento || null; }
      if (v('vaiPara')) { passo.vaiPara = v('vaiPara'); }
      if (v('resposta')) { passo.resposta = v('resposta'); }
      if (valorCentavos != null) { passo.valorCentavos = valorCentavos; }
      return;
    }
    passo.opcoes.push({
      tecla: v('opcao') || String(passo.opcoes.length + 1),
      texto: textoOpcao,
      vaiPara: v('vaiPara') || null,
      acao: trad?.acao || null,
      departamento: trad?.departamento || null,
      resposta: v('resposta') || null,
      ...(valorCentavos != null ? { valorCentavos } : {}),
      /* Com SKU o preço vem do catálogo na hora do pedido — a planilha para de
         ser a dona do preço, e uma promoção passa a valer sem reimportar nada. */
      ...(v('sku') ? { sku: v('sku') } : {}),
    });
  });

  if (erros.length) { return { erros }; }

  const passos = ordem.map((id) => porId.get(id));
  const val = validarFluxo(passos);
  if (val.erros.length) { return { erros: val.erros }; }
  /* AVISO nao e erro: o fluxo entra e funciona, mas a pessoa precisa saber que
     aquele pedaco ainda nao faz o que o nome promete — senao ela acha que a base
     de conhecimento esta respondendo quando ninguem consultou nada. */
  return {
    erros: [],
    fluxo: val.fluxo,
    avisos: [...pendentes].map((x) => `${x}: ainda não existe no sistema — por ora o fluxo segue em frente`),
    resumo: { passos: passos.length, opcoes: passos.reduce((a, p) => a + p.opcoes.length, 0) },
  };
}

/** Modelo pra pessoa baixar, preencher e devolver. */
export function modeloCsv() {
  return [
    'passo,mensagem,opcao,texto_opcao,vai_para,acao,resposta',
    'inicio,"Boa noite! Sou a Micaela, atendente virtual da Veloso Solution. Em que posso te ajudar?",1,"Já sou cliente",cliente,,',
    'inicio,,2,"Quero conhecer a solução",novo,,',
    'inicio,,3,"Falar com uma pessoa",,comercial,"Claro! Já estou chamando alguém do time."',
    'cliente,"Que bom te ver de novo! O que você precisa hoje?",1,"Suporte",,comercial,"Vou te passar pro suporte agora."',
    'cliente,,2,"Ver produtos",,catalogo,',
    'novo,"Legal! Me confirma seu nome e a cidade que eu já te encaminho.",,,,confirmar,',
  ].join('\n');
}
