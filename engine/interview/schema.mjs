/**
 * Entrevista de onboarding — schemas de perguntas por domínio.
 *
 * Motivo: a suite é multi-empresa; não dá pra adivinhar o que cada cliente vende,
 * o funil, o tom. A entrevista captura isso 1x e vira o PERFIL que os módulos leem
 * (VSvendas, e depois os outros). Schema-driven: adicionar pergunta = editar aqui.
 *
 * Tipos: text | longtext | number | bool | choice(opcoes) | multichoice(opcoes) | list
 */

export const SETS = {
  // Base da empresa — serve a todos os módulos.
  empresa: [
    { id: 'empresa_nome', secao: 'Empresa', pergunta: 'Qual o nome da empresa?', tipo: 'text', required: true },
  ],

  // Dev — padrão de branch/commit/doc. Alimenta a governança (branch/commit) + doc.
  dev: [
    { id: 'branch_pattern', secao: 'Dev', pergunta: 'Padrão do nome de branch?', tipo: 'text', required: true, help: 'Ex.: <tipo>/<autor>/<numero> -> fix/nome.sobrenome/1234' },
    { id: 'branch_autor', secao: 'Dev', pergunta: 'Qual o segmento de AUTOR no nome da branch?', tipo: 'text', required: true, help: 'O que entra no token <autor>. Ex.: nome.sobrenome. Se o padrão não usa <autor>, responda "-".' },
    { id: 'branch_tipos', secao: 'Dev', pergunta: 'Tipos aceitos (branch/commit)?', tipo: 'list', required: true, help: 'Ex.: fix; feat; refactor; chore; test; docs; perf' },
    { id: 'commit_pattern', secao: 'Dev', pergunta: 'Padrão da mensagem de commit?', tipo: 'text', required: true, help: 'Ex.: <tipo>(<escopo>): <descrição>' },
    { id: 'commit_escopo', secao: 'Dev', pergunta: 'O escopo do commit é o quê?', tipo: 'choice', opcoes: ['numero', 'modulo', 'any'], required: true, help: 'número da tarefa, módulo, ou livre' },
    { id: 'commit_autor', secao: 'Dev', pergunta: 'Assinatura do autor (Nome <email>)?', tipo: 'text', required: false },
    { id: 'testes_politica', secao: 'Dev', pergunta: 'Quando rodar os testes?', tipo: 'choice', opcoes: ['sempre', 'quando_pedir', 'nunca'], required: false },
    { id: 'doc_modelo', secao: 'Dev', pergunta: 'Cole o MODELO de documentação do time (ou caminho do arquivo) — eu leio e adoto', tipo: 'longtext', required: false },
  ],

  // Analista — acesso ao tracker onde cria sprints/HUs (na instalação). Alimenta o VSanalista.
  analista: [
    { id: 'tracker_tipo', secao: 'Analista', pergunta: 'Qual tracker a análise usa?', tipo: 'choice', opcoes: ['Redmine', 'Azure', 'Jira'], required: true },
    { id: 'tracker_url', secao: 'Analista', pergunta: 'URL do tracker?', tipo: 'text', required: true, help: 'Ex.: https://redmine.suaempresa.com' },
    { id: 'tracker_apikey', secao: 'Analista', pergunta: 'Chave de API (pra suite conectar)?', tipo: 'text', required: true, sensitive: true, help: 'Redmine: Minha conta > Chave de acesso à API' },
    { id: 'tracker_projeto', secao: 'Analista', pergunta: 'ID do projeto onde as sprints/HUs são criadas?', tipo: 'number', required: true },
    { id: 'sprint_local', secao: 'Analista', pergunta: 'Como as sprints são organizadas?', tipo: 'text', required: false, help: 'Ex.: subprojeto por sprint; versão; tag' },
  ],

  // QA — onde gera a doc de testes + acesso pra suite ler e ADOTAR o padrão dele.
  qa: [
    { id: 'qa_sistema', secao: 'QA', pergunta: 'Onde o QA gera/registra a documentação de testes?', tipo: 'text', required: true, help: 'Ex.: Redmine (Especificar/Execução de testes); TestRail; planilha' },
    { id: 'qa_apikey', secao: 'QA', pergunta: 'Chave de API pra suite conectar e ler o padrão?', tipo: 'text', required: false, sensitive: true },
    { id: 'qa_exemplo', secao: 'QA', pergunta: 'Link/ID de um exemplo de doc de teste do QA (pra eu ler e adotar)?', tipo: 'text', required: false },
    { id: 'qa_padrao', secao: 'QA', pergunta: 'Se quiser, descreva o padrão da doc de teste', tipo: 'longtext', required: false },
  ],

  // Vendas + Marketing — alimenta o VSvendas (qualificação, follow-up, objeção e ANÚNCIOS).
  influence: [
    { id: 'redes_publica', secao: 'Criador', pergunta: 'Em quais redes você publica?', tipo: 'multichoice', opcoes: ['youtube', 'instagram', 'tiktok', 'kwai', 'facebook'], required: true },
    { id: 'videos_pasta', secao: 'Criador', pergunta: 'Pasta de onde saem os vídeos?', tipo: 'text', required: true, help: 'Ex.: /home/voce/videos — o cron olha aqui pra saber se tem vídeo novo' },
    { id: 'horarios_publicacao', secao: 'Criador', pergunta: 'Horários de publicação?', tipo: 'list', required: true, help: 'Um por linha, formato HH:MM. Ex.: 09:00; 18:00' },
    { id: 'varredura_min', secao: 'Criador', pergunta: 'De quantos em quantos minutos o cron confere a pasta?', tipo: 'number', required: false, help: 'Padrão 15. Horário perdido com a máquina desligada é recuperado na varredura seguinte.' },
    { id: 'metricas_apikey', secao: 'Criador', pergunta: 'Chave de API pra ler views/likes (se já tiver)?', tipo: 'text', required: false, sensitive: true },
  ],

  vendas: [
    { id: 'vende', secao: 'Empresa', pergunta: 'O que a empresa vende? (produto/serviço em 1-2 frases)', tipo: 'longtext', required: true },
    { id: 'proposta_valor', secao: 'Empresa', pergunta: 'Principal proposta de valor — por que compram de você?', tipo: 'longtext', required: true },
    { id: 'icp', secao: 'Empresa', pergunta: 'Quem é o cliente ideal? (segmento, porte, cargo do decisor)', tipo: 'longtext', required: true },
    { id: 'ticket', secao: 'Empresa', pergunta: 'Ticket médio aproximado (R$)?', tipo: 'number', required: false },
    { id: 'tom', secao: 'Empresa', pergunta: 'Tom de voz nas mensagens?', tipo: 'choice', opcoes: ['Formal', 'Consultivo', 'Amigável', 'Direto'], required: true },
    { id: 'funil', secao: 'Vendas', pergunta: 'Quais as etapas do funil, em ordem?', tipo: 'list', required: true, help: 'Ex.: Novo lead; Qualificado; Proposta enviada; Negociação; Fechado' },
    { id: 'canais', secao: 'Vendas', pergunta: 'Canais de contato usados?', tipo: 'multichoice', opcoes: ['WhatsApp', 'E-mail', 'Ligação', 'Instagram', 'Presencial'], required: true },
    { id: 'sinais_quente', secao: 'Vendas', pergunta: 'O que indica um lead QUENTE? (sinais de compra)', tipo: 'list', required: false, help: 'Ex.: pediu preço; tem urgência; é o decisor; comparou concorrente' },
    { id: 'sinais_frio', secao: 'Vendas', pergunta: 'O que indica um lead FRIO / desqualificado?', tipo: 'list', required: false, help: 'Ex.: sem orçamento; só curiosidade; fora do perfil' },
    { id: 'objecoes', secao: 'Vendas', pergunta: 'Objeções mais comuns? (uma por linha; se quiser, "objeção => resposta")', tipo: 'list', required: false, help: 'Ex.: tá caro => mostro ROI; vou pensar => marco retorno com data' },
    { id: 'follow_prazo', secao: 'Vendas', pergunta: 'Após enviar proposta, em quantos dias fazer follow-up?', tipo: 'number', required: false },
    // Marketing / anúncios
    { id: 'plataformas_anuncio', secao: 'Marketing', pergunta: 'Em quais plataformas você anuncia?', tipo: 'multichoice', opcoes: ['Instagram', 'Facebook Marketplace', 'Mercado Livre', 'OLX', 'WhatsApp', 'Google', 'TikTok'], required: true, help: 'A suite gera o anúncio pronto pra cada uma' },
    { id: 'fotos_pasta', secao: 'Marketing', pergunta: 'Pasta padrão com as fotos dos produtos?', tipo: 'text', required: false, help: 'Ex.: C:\\vendas\\fotos — de onde eu listo os produtos' },
    { id: 'estilo_anuncio', secao: 'Marketing', pergunta: 'Estilo do anúncio?', tipo: 'choice', opcoes: ['Curto e direto', 'Detalhado', 'Emojis e informal', 'Sóbrio'], required: false },
  ],
};

export function getSet(setId) {
  const s = SETS[setId];
  if (!s) { throw new Error(`entrevista: set desconhecido "${setId}" (use: ${Object.keys(SETS).join(', ')})`); }
  return s;
}

export function findQuestion(setId, id) {
  return getSet(setId).find((q) => q.id === id) || null;
}

/** ids marcados como sensíveis (chaves de API) — pra mascarar em logs/echo. */
export function sensitiveIds(setId) {
  return getSet(setId).filter((q) => q.sensitive).map((q) => q.id);
}
