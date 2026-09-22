/**
 * WhatsAppWebProvider — canal por sessão de WhatsApp Web (WPPConnect).
 *
 * POR QUE ESTE CANAL EXISTE: a API oficial da Meta exige verificação de negócio,
 * e uma conta presa no checkpoint trava o produto inteiro. Este provider entrega
 * o beta sem depender disso. Ele NÃO é API oficial — `oficial: false` é lido
 * pela tela, que avisa isso pra quem for conectar.
 *
 * A biblioteca fica encapsulada AQUI DENTRO, de propósito. Trocar WPPConnect por
 * Baileys (mais leve, sem Chromium, melhor quando houver muitas sessões por
 * máquina) é reescrever este arquivo e mais nenhum. E trocar este provider
 * inteiro pelo oficial é uma linha no registro.
 *
 * Nada de CRM, lead, cliente, pedido, fila, ticket, bot ou auditoria mora aqui.
 * O que chega vira mensagem canônica e sobe pro gateway.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ESTADOS, mensagem } from '../provider.mjs';
import { deveAtender, normalizar, soDigitos, ehLid, pareceTelefone } from './normalizar.mjs';

/**
 * Mata navegador ORFAO preso na pasta desta sessao.
 *
 * Acontece de verdade: o painel e derrubado (deploy, kill -9, queda) e o Chrome
 * que ele abriu sobrevive segurando o perfil. Na proxima conexao o WPPConnect
 * recusa com "The browser is already running for ..." e NENHUMA tentativa de
 * reconexao resolve — so tirando o orfao da frente.
 *
 * O filtro e a pasta EXATA da sessao, entao isto nao encosta no Chrome que a
 * pessoa esta usando pra navegar.
 */
export function matarNavegadorOrfao(pastaSessao, exec = execFileSync) {
  /* SEM os dois tracos na frente: `pgrep -f --user-data-dir=...` faz o pgrep ler
     o padrao como OPCAO DELE e cuspir a tela de ajuda — foi assim que a limpeza
     falhou calada na primeira versao. */
  const alvo = `user-data-dir=${pastaSessao}`;
  let pids = [];
  try {
    pids = String(exec('pgrep', ['-f', alvo], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).split('\n').map((x) => x.trim()).filter(Boolean);
  } catch { return { mortos: 0 }; } // pgrep sai 1 quando nao acha: nao ha orfao
  let mortos = 0;
  for (const pid of pids) {
    /* Filho de navegador morre junto com o pai: "processo inexistente" aqui e
       o esperado, nao problema — por isso o stderr fica de fora. */
    try { exec('kill', ['-9', pid], { stdio: 'ignore' }); mortos += 1; } catch { /* ja morreu */ }
  }
  if (mortos) { console.warn(`[whatsapp-web] ${mortos} processo(s) de navegador orfao removidos de ${pastaSessao}`); }
  return { mortos };
}

/** Erros que reconectar NUNCA resolve — insistir neles so gasta tentativa. */
export function ehErroDeAmbiente(msg) {
  return /already running|user-data-dir|ENOENT|executable|Failed to launch|spawn/i.test(String(msg || ''));
}

const agora = () => new Date().toISOString();

/**
 * @param {object} opcoes
 * @param {string} [opcoes.sessao]        nome da sessão (pasta de tokens)
 * @param {string} [opcoes.chrome]        caminho do Chrome já instalado
 * @param {Function} [opcoes.criarSessao] injeção pro teste: substitui o WPPConnect
 * @param {number} [opcoes.maxTentativas] reconexões automáticas antes de desistir
 */
export function criarWhatsAppWebProvider(opcoes = {}) {
  const nomeSessao = opcoes.sessao || process.env.WPP_SESSAO || 'veloso';
  const chrome = opcoes.chrome || process.env.CHROME_PATH || '/usr/bin/google-chrome';
  const maxTentativas = opcoes.maxTentativas ?? 5;

  let cliente = null;
  let estado = ESTADOS.DESCONECTADO;
  let qr = null;            // data URL do QR, enquanto ele vale
  let numero = null;
  let desde = null;
  let ultimaAtividade = null;
  let ultimoErro = null;
  let tentativas = 0;
  /* Desligar e uma ORDEM, nao um acidente. Fechar a sessao faz a lib emitir o
     mesmo evento de uma queda, e o reconector religava dois segundos depois —
     contra a vontade de quem desligou. Este sinalizador e a diferenca entre
     "caiu" e "o dono mandou parar". */
  let intencional = false;
  /* Ids do que NOS mandamos. O WhatsApp devolve tudo que sai da conta como
     mensagem `fromMe` — inclusive as nossas. Sem separar as duas coisas, a
     resposta da propria Micaela seria lida como "o dono digitou". */
  const enviadosPorNos = new Set();
  /* Minutos de idade acima dos quais a mensagem NAO e mais conversa viva.
     Ao reconectar, o WhatsApp entrega tudo que ficou pendente de uma vez — e
     sem este corte o bot responde o historico inteiro num segundo so. */
  const janelaMin = opcoes.janelaMinutos ?? 10;
  const ouvintesDono = [];
  let reconectando = null;  // timer

  const ouvintesMsg = [];
  const ouvintesStatus = [];

  const mudar = (novo, extra = {}) => {
    estado = novo;
    if (novo !== ESTADOS.AGUARDANDO_QR) { qr = extra.qr ?? null; }
    for (const fn of ouvintesStatus) {
      try { fn(status()); } catch (e) { console.error('[whatsapp-web] ouvinte de status quebrou:', e.message); }
    }
  };

  function status() {
    return {
      provider: 'whatsapp-web',
      oficial: false,
      estado,
      numero,
      desde,
      ultimaAtividade,
      qr: estado === ESTADOS.AGUARDANDO_QR ? qr : null,
      /* NAO chamar de `erro`: o servidor trata qualquer `erro` no corpo como
         400, e aí um status legítimo ("caiu, e o motivo foi X") virava Bad
         Request na cara de quem só perguntou como o canal está. */
      ultimoErro,
      tentativas,
    };
  }

  /** Só o que o WPPConnect precisa saber. Chrome do sistema: nada é baixado. */
  const opcoesPadrao = () => ({
    session: nomeSessao,
    headless: true,
    browserArgs: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    puppeteerOptions: { executablePath: chrome },
    logQR: false,
    disableWelcome: true,
    updatesLog: false,
    /* A lib loga em nivel verbose por padrao e inunda o log do painel com o
       estado interno do navegador. Fica so o que e problema de verdade — e o
       que este provider tem a dizer, ele mesmo diz com [whatsapp-web]. */
    logger: opcoes.logger || { level: 'error', error: (...a) => console.error('[wpp]', ...a), warn: () => {}, info: () => {}, http: () => {}, verbose: () => {}, debug: () => {}, silly: () => {}, log: () => {} },
    autoClose: 0, // 0 = não fecha sozinho esperando o QR; quem decide é o painel
  });

  /* Os nomes vem da lib. Aprendidos observando a sessao de verdade, porque a
     ordem real e contra-intuitiva: ela emite `inChat` ANTES do login, e tratar
     isso como "conectado" fazia a tela dizer CONECTADO com ninguem pareado —
     mentira pior que erro. Sinal bom aqui e so CANDIDATO; quem confirma e a
     propria sessao, em `confirmar()`. */
  const SINAL_BOM = ['isLogged', 'qrReadSuccess', 'successChat', 'inChat', 'chatsAvailable'];
  const SINAL_RUIM = ['browserClose', 'qrReadFail', 'autocloseCalled', 'serverClose',
    'disconnectedMobile', 'desconnectedMobile', 'deviceNotConnected'];
  const SINAL_QR = ['notLogged', 'qrReadError'];

  function onStatus(s) {
    if (SINAL_QR.includes(s)) {
      if (estado !== ESTADOS.AGUARDANDO_QR) { mudar(ESTADOS.CONECTANDO); }
      return;
    }
    if (SINAL_RUIM.includes(s)) {
      if (estado === ESTADOS.CONECTADO) { mudar(ESTADOS.CAIDO); agendarReconexao(); }
      return;
    }
    if (SINAL_BOM.includes(s)) { confirmar(); }
  }

  /**
   * Só declara CONECTADO se a sessão confirmar. Enquanto o cliente não existe
   * (o `create()` ainda não voltou), não há o que perguntar — e chutar que está
   * conectado é exatamente o bug que isto conserta.
   */
  async function confirmar() {
    if (!cliente) { return false; }
    try {
      const ok = await cliente.isConnected?.();
      if (ok === false) { return false; }
      try { numero = soDigitos(await cliente.getWid?.()) || numero; } catch { /* cosmético */ }
      tentativas = 0;
      desde = desde || agora();
      mudar(ESTADOS.CONECTADO);
      return true;
    } catch { return false; }
  }

  async function conectar({ aoQr } = {}) {
    /* Pedido explicito de conexao cancela o desligamento: quem mandou ligar
       agora manda mais que quem mandou desligar antes. */
    intencional = false;
    if (estado === ESTADOS.CONECTADO) { return status(); }
    mudar(ESTADOS.CONECTANDO);
    ultimoErro = null;

    const criar = opcoes.criarSessao || (async (cfg) => {
      const wpp = await import('@wppconnect-team/wppconnect');
      return (wpp.create || wpp.default.create)(cfg);
    });

    // Tira da frente qualquer navegador que sobrou de uma queda anterior. Sem
    // isto, a primeira conexao depois de um restart forcado falha sempre.
    if (!opcoes.criarSessao) {
      matarNavegadorOrfao(join(process.cwd(), 'tokens', nomeSessao), opcoes.exec);
    }

    try {
      cliente = await criar({
        ...opcoesPadrao(),
        catchQR: (base64Qr) => {
          qr = base64Qr;
          mudar(ESTADOS.AGUARDANDO_QR, { qr: base64Qr });
          if (typeof aoQr === 'function') { aoQr(base64Qr); }
        },
        statusFind: (s) => onStatus(s),
      });

      cliente.onMessage?.(async (m) => {
        ultimaAtividade = agora();
        /* O DONO ASSUMIU A CONVERSA.
           Mensagem que sai da conta e `fromMe`. Ate agora tudo isso era jogado
           fora como eco — e junto ia o sinal mais importante que existe neste
           canal: a pessoa de carne e osso entrou na conversa. Enquanto isso era
           ignorado, a Micaela respondia POR CIMA do dono, com o cliente vendo os
           dois falando ao mesmo tempo. */
        if (m.fromMe) {
          const idm = String(m.id?.id || m.id || '');
          if (enviadosPorNos.has(idm)) { enviadosPorNos.delete(idm); return; }
          const onde = m.to || m.chatId?._serialized || m.chatId || null;
          if (onde) {
            console.log(`[whatsapp-web] o dono escreveu em ${onde} — a Micaela sai desta conversa`);
            for (const fn of ouvintesDono) {
              try { fn({ endereco: String(onde), de: soDigitos(onde) }); } catch (e) { console.error('[whatsapp-web] ouvinte do dono quebrou:', e.message); }
            }
          }
          return;
        }

        /* MENSAGEM VELHA NAO SE RESPONDE.
           Aconteceu em campo: o canal reconectou e, sete segundos depois, sairam
           21 respostas no mesmo segundo pra duas pessoas — o WhatsApp tinha
           entregue todo o historico pendente de uma vez e o bot respondeu cada
           mensagem antiga como se fosse nova. Alem de constrangedor, isso e o
           caminho curto pro numero ser bloqueado por spam.

           Quem mandou ha uma hora ja seguiu a vida; responder agora nao ajuda
           ninguem. O atendimento continua na trilha — o que nao acontece e a
           enxurrada. */
        const quando = Number(m.t || m.timestamp || 0) * 1000;
        if (quando > 0) {
          const idadeMin = (Date.now() - quando) / 60000;
          if (idadeMin > janelaMin) {
            console.log(`[whatsapp-web] ignorada (mensagem de ${Math.round(idadeMin)} min atras, fora da janela de ${janelaMin}) — de ${m.from || '?'}`);
            return;
          }
        }

        const filtro = deveAtender(m);
        if (!filtro.ok) {
          /* Este era o ultimo ponto cego: mensagem descartada aqui sumia sem
             UMA linha. Quem testava mandando do proprio celular caia no "eco da
             propria resposta" e via a Micaela muda, com o log em branco — nao da
             pra distinguir "nao chegou" de "chegou e eu joguei fora". Toda
             mensagem que entra deixa rastro agora, sem excecao. */
          console.log(`[whatsapp-web] ignorada (${filtro.motivo}) — de ${m.from || '?'}`);
          return;
        }
        const canonica = normalizar(m);

        /* Descobrir o TELEFONE vale a pena — e ele que identifica o cliente no
           CRM e junta a conversa de hoje com a de semana passada. Mas nao ter o
           telefone NAO cala o atendimento: a resposta vai pro endereco de onde
           a mensagem veio, que e a propria conversa.

           Foi exatamente aqui que se perdeu meia manha: o codigo exigia
           telefone pra responder, e a conta nova do WhatsApp nao entrega
           telefone nenhum — so o LID. Primeiro isso virou resposta pro numero
           errado; depois, silencio. Os dois por confundir QUEM E o cliente com
           ONDE SE RESPONDE. */
        if (ehLid(m.from) || !pareceTelefone(canonica.de)) {
          const real = await resolverTelefone(m);
          if (real) {
            canonica.de = real;
          } else {
            console.warn(`[whatsapp-web] sem telefone para "${m.from}" — atendo assim mesmo, respondendo na propria conversa`);
          }
        }

        for (const fn of ouvintesMsg) {
          try { fn(canonica); } catch (e) { console.error('[whatsapp-web] ouvinte de mensagem quebrou:', e.message); }
        }
      });

      // Queda de sessão detectada pela própria lib.
      cliente.onStateChange?.((s) => {
        if (!['UNPAIRED', 'UNPAIRED_IDLE', 'CONFLICT'].includes(String(s))) { return; }
        /* Desligado de proposito nao e queda. Marcar CAIDO aqui poria um erro
           vermelho na tela por uma decisao do dono — e alguem "consertaria"
           religando o que ele desligou. */
        if (intencional) { return; }
        mudar(ESTADOS.CAIDO);
        agendarReconexao();
      });

      // Agora o cliente existe: da pra perguntar de verdade em vez de supor.
      await confirmar();
      return status();
    } catch (e) {
      ultimoErro = e.message;
      mudar(ESTADOS.CAIDO);
      /* Erro de ambiente (perfil travado, Chrome sem executavel) nao melhora
         sozinho: insistir queima as 5 tentativas e some com o motivo no meio do
         log. Fica parado, com o motivo na tela, esperando gente. */
      if (ehErroDeAmbiente(e.message)) {
        console.error(`[whatsapp-web] nao da pra reconectar sozinho: ${e.message}`);
      } else {
        agendarReconexao();
      }
      return status();
    }
  }

  /**
   * Reconexão CONTROLADA: espera crescente e teto de tentativas. Reconectar em
   * laço apertado é o caminho curto pro número ser bloqueado — e some com o
   * motivo real da queda no meio de mil linhas de log.
   */
  function agendarReconexao() {
    if (intencional) {
      console.log('[whatsapp-web] desligado de proposito — nao vou reconectar sozinho');
      return;
    }
    if (reconectando || tentativas >= maxTentativas) {
      if (tentativas >= maxTentativas) {
        console.error(`[whatsapp-web] desisti de reconectar depois de ${tentativas} tentativas — precisa de gente`);
      }
      return;
    }
    tentativas += 1;
    const espera = Math.min(60_000, 2 ** tentativas * 1000);
    console.warn(`[whatsapp-web] sessao caiu — tentativa ${tentativas}/${maxTentativas} em ${espera / 1000}s`);
    reconectando = setTimeout(() => {
      reconectando = null;
      conectar().catch((e) => console.error('[whatsapp-web] reconexao falhou:', e.message));
    }, espera);
    reconectando.unref?.();
  }

  async function desconectar() {
    /* Marca ANTES de fechar: o `close()` dispara o evento de queda, e sem a
       marca ja posta o reconector agendaria a volta no mesmo instante. */
    intencional = true;
    if (reconectando) { clearTimeout(reconectando); reconectando = null; }
    tentativas = 0;
    try { await cliente?.close?.(); } catch (e) { console.warn('[whatsapp-web] erro ao fechar:', e.message); }
    cliente = null;
    numero = null;
    desde = null;
    mudar(ESTADOS.DESCONECTADO);
  }

  /**
   * Health check. Pergunta pra lib, não pro nosso próprio estado — sessão que
   * caiu do lado do celular continua "conectada" aqui até alguém conferir.
   */
  async function saude() {
    if (!cliente) { return { ok: false, detalhe: 'sem sessão aberta' }; }
    try {
      const conectado = await cliente.isConnected?.();
      if (conectado === false) {
        mudar(ESTADOS.CAIDO);
        agendarReconexao();
        return { ok: false, detalhe: 'a sessão caiu do lado do WhatsApp' };
      }
      return { ok: true, detalhe: 'sessão respondendo', estado };
    } catch (e) {
      return { ok: false, detalhe: 'não consegui perguntar pra sessão: ' + e.message };
    }
  }

  /**
   * Cara do numero: foto, nome e recado.
   *
   * Isto SO existe no canal por WhatsApp Web. Na API oficial da Meta a foto e o
   * nome vem do perfil da conta no WhatsApp Manager e nenhum codigo nosso muda —
   * a tela do painel dizia isso e estava certa PRA AQUELE canal. Aqui a sessao e
   * a propria conta, entao da pra personalizar.
   *
   * @param {{foto?:string, nome?:string, recado?:string}} perfil
   *        foto = data URL ou caminho de arquivo
   */
  /**
   * A cara que o numero tem AGORA, antes de a gente trocar.
   *
   * O WhatsApp nao guarda a foto anterior: trocou, sumiu. Sem ler antes, o
   * painel so sabe aplicar — e voltar atras viraria tarefa manual no celular,
   * o que e meio caminho e deixa a pessoa com medo de clicar.
   */
  async function perfilAtual() {
    if (estado !== ESTADOS.CONECTADO || !cliente) { return null; }
    const wid = numero ? `${numero}@c.us` : await cliente.getWid?.().catch(() => null);
    const pegar = async (fn) => { try { return await fn(); } catch { return null; } };
    const bruta = await pegar(() => cliente.getProfilePicFromServer?.(wid));
    return {
      /* A lib devolve a foto como OBJETO com a url ({eurl}), e `setProfilePic`
         so aceita imagem. Guardar do jeito que veio daria um backup que nao
         restaura — descoberto antes de doer, mas so porque o log mostrou
         "restaurado: nada". Entao baixamos a imagem e guardamos os BYTES: a url
         da Meta expira, e backup que expira nao e backup. */
      foto: await baixarComoDataUri(bruta?.eurl || bruta?.imgFull || bruta),
      nome: await pegar(() => cliente.getProfileName?.()),
      recado: await pegar(() => cliente.getProfileStatus?.()),
      em: agora(),
    };
  }

  /** URL da foto -> data URI. Devolve null se nao der: backup e complemento. */
  async function baixarComoDataUri(url) {
    const u = String(url || '');
    if (!u.startsWith('http')) { return u || null; }
    try {
      const res = await fetch(u);
      if (!res.ok) { return null; }
      const tipo = res.headers.get('content-type') || 'image/jpeg';
      const b64 = Buffer.from(await res.arrayBuffer()).toString('base64');
      return `data:${tipo};base64,${b64}`;
    } catch { return null; }
  }

  async function personalizar({ foto, nome, recado } = {}) {
    if (estado !== ESTADOS.CONECTADO || !cliente) {
      return { ok: false, erro: `canal ${estado} — conecte antes de personalizar` };
    }
    const feito = [];
    const falhas = [];
    /* Le o que esta la ANTES de escrever por cima. Se isto falhar, a troca
       acontece do mesmo jeito — perder o backup e chato, nao poder trocar a
       foto por causa dele seria pior. */
    const anterior = await perfilAtual().catch(() => null);
    const tentar = async (rotulo, fn) => {
      try { await fn(); feito.push(rotulo); } catch (e) { falhas.push(`${rotulo}: ${e.message}`); }
    };
    if (foto) { await tentar('foto', () => cliente.setProfilePic(foto)); }
    if (nome) { await tentar('nome', () => cliente.setProfileName(nome)); }
    if (recado) { await tentar('recado', () => cliente.setProfileStatus(recado)); }
    if (!feito.length && !falhas.length) { return { ok: false, erro: 'nada pra mudar' }; }
    /* DUAS perguntas diferentes, duas respostas.
         `ok`       — a operacao rodou e ALGO mudou no numero;
         `completo` — tudo que foi pedido entrou.

       Eram uma coisa so, e isso custou caro: com `ok:false` no parcial, o
       tradutor generico do servidor virava a resposta inteira em "nao foi
       possivel concluir" — e o dono lia fracasso depois de a foto TER SIDO
       trocada no numero dele. Mentira em cima de sucesso e pior que erro. */
    return { ok: feito.length > 0, completo: falhas.length === 0, feito, falhas, anterior };
  }

  /**
   * Descobre o telefone de verdade por tras de um LID. Tenta, em ordem: o
   * tradutor da propria lib, o contato que veio junto da mensagem, e o id do
   * chat. O primeiro que parecer telefone do Brasil ganha.
   */
  async function resolverTelefone(m) {
    /* Cada candidato leva o NOME do caminho junto. Quando isto falha em campo,
       a pergunta e sempre "de onde o sistema tirou esse numero?" — e sem o
       nome do caminho a resposta custa uma tarde de leitura de log. */
    const candidatos = [];
    try {
      const e = await cliente?.getPnLidEntry?.(m.from);
      if (e?.phoneNumber) { candidatos.push(['lid->telefone', e.phoneNumber]); }
    } catch { /* a lib nao soube: seguem os outros caminhos */ }
    /* `m.to` NAO entra aqui: ele e o destinatario, ou seja, NOS. Quando o
       remetente chegava como LID e nenhum caminho resolvia, a lista caia no
       `to` e devolvia o NOSSO numero como se fosse o do cliente. A resposta ia
       entao pra nossa propria conversa — educada, completa e invisivel pra quem
       tinha escrito. O cliente ficava esperando; o log dizia "respondi". */
    candidatos.push(
      ['sender.id.user', m.sender?.id?.user],
      ['sender.id._serialized', m.sender?.id?._serialized],
      ['author', m.author],
      ['chatId.user', m.chatId?.user],
      ['chatId._serialized', m.chatId?._serialized],
    );
    const recusados = [];
    for (const [caminho, valor] of candidatos) {
      const d = soDigitos(valor);
      if (!d) { continue; }
      if (!pareceTelefone(d)) { recusados.push(`${caminho} nao parece telefone (${d.length} digitos)`); continue; }
      /* Cinto e suspensorio: mensagem de cliente nunca vem do proprio numero
         conectado. Se chegou nisso, foi confusao de identificador — e responder
         seria falar sozinho de novo. */
      if (numero && d === numero) { recusados.push(`${caminho} devolveu o NOSSO proprio numero`); continue; }
      console.log(`[whatsapp-web] telefone do cliente veio de ${caminho}`);
      return d;
    }
    /* Ultimo recurso: perguntar pra propria lib quem e esse contato. Em conta
       nova o WhatsApp entrega o remetente so como LID, e nenhum campo da
       mensagem carrega o telefone — mas o contato, consultado, carrega. */
    for (const [caminho, buscar] of [
      ['getContact', async () => cliente?.getContact?.(m.from)],
      ['getChatById', async () => (await cliente?.getChatById?.(m.from))?.contact],
    ]) {
      try {
        const c = await buscar();
        for (const v of [c?.id?.user, c?.number, c?.phoneNumber, c?.id?._serialized]) {
          const d = soDigitos(v);
          if (pareceTelefone(d) && !(numero && d === numero)) {
            console.log(`[whatsapp-web] telefone do cliente veio de ${caminho}`);
            return d;
          }
        }
      } catch { /* a lib nao soube: segue */ }
    }

    if (recusados.length) { console.warn(`[whatsapp-web] caminhos recusados: ${recusados.join('; ')}`); }
    /* Quando NADA resolve, o log precisa mostrar o que a mensagem trazia — sem
       isso a investigacao vira adivinhacao, e foi o que custou a manha de hoje.
       Só os nomes dos campos e os identificadores; o texto da conversa fica de
       fora, que log nao e lugar de guardar mensagem de cliente. */
    const espiar = (o) => Object.keys(o || {}).join(', ');
    console.warn(`[whatsapp-web] campos da mensagem: ${espiar(m)}`);
    console.warn(`[whatsapp-web] ids vistos: from=${m.from} | to=${m.to} | author=${m.author} | chatId=${JSON.stringify(m.chatId)} | sender=${espiar(m.sender)} | sender.id=${JSON.stringify(m.sender?.id)}`);
    return null;
  }

  async function enviarTexto({ para, texto }) {
    const cru = String(para || '').trim();
    if (!cru) { return { ok: false, erro: 'destino vazio' }; }

    /* Duas formas de endereco chegam aqui, e as duas sao legitimas:
       - um JID pronto (`...@c.us` ou `...@lid`), que e a conversa de onde a
         mensagem veio — responder nele e o caminho natural e sempre funciona;
       - um telefone solto, quando alguem inicia a conversa a partir do painel.
       Exigir telefone nos dois casos era o que calava a Micaela com cliente que
       chega por LID: da pra conversar com ele, so nao da pra saber o numero. */
    const destino = cru.includes('@') ? cru : soDigitos(cru);
    if (!cru.includes('@') && !pareceTelefone(destino)) {
      return { ok: false, erro: `"${destino}" não é um telefone válido (${destino.length} dígitos) — para iniciar conversa é preciso o número do cliente` };
    }
    if (estado !== ESTADOS.CONECTADO || !cliente) {
      return { ok: false, erro: `canal ${estado} — nada foi enviado` };
    }
    try {
      const r = await cliente.sendText(destino.includes('@') ? destino : `${destino}@c.us`, String(texto));
      ultimaAtividade = agora();
      const idEnviado = r?.id?.id || r?.id || null;
      /* Guarda o id pra reconhecer o proprio eco daqui a pouco. Com teto: a
         lista existe por segundos e nao pode virar vazamento de memoria numa
         sessao que fica meses no ar. */
      if (idEnviado) {
        enviadosPorNos.add(String(idEnviado));
        if (enviadosPorNos.size > 300) { enviadosPorNos.delete(enviadosPorNos.values().next().value); }
      }
      return { ok: true, id: idEnviado };
    } catch (e) {
      return { ok: false, erro: e.message };
    }
  }

  return {
    nome: 'whatsapp-web',
    oficial: false,
    conectar,
    desconectar,
    status,
    saude,
    enviarTexto,
    personalizar,
    perfilAtual,
    aoReceber: (fn) => { ouvintesMsg.push(fn); },
    /** Avisado quando o DONO digita numa conversa — o canal nao decide o que
        fazer com isso, quem decide e o dominio. */
    aoDonoEscrever: (fn) => { ouvintesDono.push(fn); },
    aoMudarStatus: (fn) => { ouvintesStatus.push(fn); },
    /* só pra teste: injeta uma mensagem como se tivesse vindo do WhatsApp */
    _receberDireto: (m) => {
      const f = deveAtender(m);
      if (!f.ok) { return f; }
      const c = normalizar(m);
      ouvintesMsg.forEach((fn) => fn(c));
      return { ok: true, mensagem: c };
    },
  };
}
