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
import { deveAtender, normalizar, soDigitos } from './normalizar.mjs';

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

      cliente.onMessage?.((m) => {
        ultimaAtividade = agora();
        const filtro = deveAtender(m);
        if (!filtro.ok) { return; }
        const canonica = normalizar(m);
        for (const fn of ouvintesMsg) {
          try { fn(canonica); } catch (e) { console.error('[whatsapp-web] ouvinte de mensagem quebrou:', e.message); }
        }
      });

      // Queda de sessão detectada pela própria lib.
      cliente.onStateChange?.((s) => {
        if (['UNPAIRED', 'UNPAIRED_IDLE', 'CONFLICT'].includes(String(s))) {
          mudar(ESTADOS.CAIDO);
          agendarReconexao();
        }
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
  async function personalizar({ foto, nome, recado } = {}) {
    if (estado !== ESTADOS.CONECTADO || !cliente) {
      return { ok: false, erro: `canal ${estado} — conecte antes de personalizar` };
    }
    const feito = [];
    const falhas = [];
    const tentar = async (rotulo, fn) => {
      try { await fn(); feito.push(rotulo); } catch (e) { falhas.push(`${rotulo}: ${e.message}`); }
    };
    if (foto) { await tentar('foto', () => cliente.setProfilePic(foto)); }
    if (nome) { await tentar('nome', () => cliente.setProfileName(nome)); }
    if (recado) { await tentar('recado', () => cliente.setProfileStatus(recado)); }
    if (!feito.length && !falhas.length) { return { ok: false, erro: 'nada pra mudar' }; }
    /* Sucesso parcial e o caso normal aqui: a TikTok/WhatsApp recusa foto fora do
       formato mas aceita o nome. Dizer so "ok" esconderia metade do resultado. */
    return { ok: falhas.length === 0, feito, falhas };
  }

  async function enviarTexto({ para, texto }) {
    const destino = soDigitos(para);
    if (!destino) { return { ok: false, erro: 'destino vazio' }; }
    if (estado !== ESTADOS.CONECTADO || !cliente) {
      return { ok: false, erro: `canal ${estado} — nada foi enviado` };
    }
    try {
      const r = await cliente.sendText(`${destino}@c.us`, String(texto));
      ultimaAtividade = agora();
      return { ok: true, id: r?.id?.id || r?.id || null };
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
    aoReceber: (fn) => { ouvintesMsg.push(fn); },
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
