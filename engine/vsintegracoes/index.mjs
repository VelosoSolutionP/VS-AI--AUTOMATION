/**
 * VSintegracoes — a central de integrações do Bolso Cheio (Configurações).
 *
 * Responde uma pergunta só: "o que do meu sistema está funcionando e o que
 * falta pra funcionar?". Cada integração REAL do produto vira um item com
 * estado (ok · incompleta · desligada), o motivo em português, a tela onde se
 * configura e, quando dá, um teste de verdade.
 *
 * Os itens do QA-Gate (Jira, Redmine, Azure DevOps, promptAudit, Slack,
 * governança de commit) NÃO entram: são da ferramenta de desenvolvimento, não
 * do lojista. O company.json continua intacto no disco.
 *
 * Quem sabe o estado de cada coisa é o módulo dela — este aqui só recebe as
 * leituras prontas (`fontes`) e monta a foto. Assim dá pra testar sem rede.
 *
 * "Caiu": guarda quais integrações JÁ funcionaram. Se uma delas deixa de
 * funcionar, entra na lista de caídas até voltar ou até o dono dispensar.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { dentroDaCasa } from '../casa.mjs';

export const GRUPOS = [
  ['canais', 'Canais de atendimento'],
  ['pagamentos', 'Pagamentos'],
  ['redes', 'Redes e loja'],
  ['avisos', 'Avisos e e-mail'],
];

const dir = () => process.env.VSINTEGRACOES_DIR || dentroDaCasa('vsintegracoes');
const arq = () => join(dir(), 'historico.json');
const ler = () => { try { return JSON.parse(readFileSync(arq(), 'utf8')); } catch { return { jaFuncionou: {}, dispensadas: {} }; } };
const gravar = (d) => { mkdirSync(dir(), { recursive: true, mode: 0o700 }); writeFileSync(arq(), JSON.stringify(d, null, 2)); };

const item = (id, grupo, nome, estado, detalhe, extra = {}) => ({ id, grupo, nome, estado, detalhe, ...extra });
const OK = 'ok', INC = 'incompleta', OFF = 'desligada';

/**
 * Monta a lista. Cada fonte é o retorno do módulo dono daquele assunto; fonte
 * ausente ou que quebrou vira "incompleta" com o motivo, nunca some da tela.
 */
export function montar(f = {}) {
  const lista = [];

  // WhatsApp Web
  const w = f.whatsapp || null;
  if (!w) { lista.push(item('whatsapp', 'canais', 'WhatsApp Web', OFF, 'canal não montado', { tela: 'canais' })); }
  else {
    const e = w.estado || 'desconectado';
    lista.push(item('whatsapp', 'canais', 'WhatsApp Web',
      e === 'conectado' ? OK : e === 'desconectado' ? OFF : INC,
      e === 'conectado' ? `conectado${w.numero ? ` · +${w.numero}` : ''}` : e === 'aguardando_qr' ? 'esperando ler o QR Code no celular' : e === 'caido' ? `caiu${w.ultimoErro ? ` — ${w.ultimoErro}` : ''}` : e === 'conectando' ? 'conectando…' : 'desconectado — o bot não atende pelo WhatsApp',
      { tela: 'canais', acao: e === 'conectado' ? 'Gerenciar' : 'Conectar', testavel: true }));
  }

  // Telegram
  const t = f.telegram || {};
  const te = t.estado || 'desconectado';
  lista.push(item('telegram', 'canais', 'Telegram',
    te === 'conectado' ? OK : !t.temToken ? OFF : INC,
    te === 'conectado' ? `conectado${t.numero || t.bot ? ` · ${t.numero || t.bot}` : ''}` : !t.temToken ? 'sem token do bot — crie no @BotFather e cole em Canal e conexão' : `${te}${t.ultimoErro ? ` — ${t.ultimoErro}` : ''}`,
    { tela: 'tg-canal', acao: te === 'conectado' ? 'Gerenciar' : 'Conectar', testavel: true }));

  // Pagamentos (o provedor escolhido)
  const p = f.pagamento || null;
  if (p) {
    lista.push(item('pagamento', 'pagamentos', p.rotulo || p.nome || 'Pagamentos',
      p.pronto && !(p.faltando || []).length ? OK : p.pronto ? INC : OFF,
      p.pronto ? `${p.emProducao ? 'produção' : 'teste (não move dinheiro)'} · Pix e cartão${(p.faltando || []).length ? ` · falta: ${p.faltando.join('; ')}` : ''}` : `falta: ${(p.faltando || ['credencial']).join('; ')}`,
      { tela: 'pl-recebimento', acao: 'Configurar', testavel: !!p.pronto, emTeste: p.pronto && !p.emProducao }));
  }

  // TikTok (publicar · loja · anúncios)
  const tk = f.tiktok?.familias || {};
  const fams = [['open', 'publicar'], ['shop', 'loja'], ['business', 'anúncios']].filter(([k]) => tk[k]);
  if (fams.length) {
    const aut = fams.filter(([k]) => tk[k].autorizado && !tk[k].expirado);
    const semApp = fams.filter(([k]) => !tk[k].appConfigurado);
    lista.push(item('tiktok', 'redes', 'TikTok',
      aut.length === fams.length ? OK : aut.length ? INC : OFF,
      aut.length ? `autorizado: ${aut.map(([, n]) => n).join(', ')}${aut.length < fams.length ? ` · falta: ${fams.filter((x) => !aut.includes(x)).map(([, n]) => n).join(', ')}` : ''}` : semApp.length === fams.length ? 'sem credencial do app — cadastre em Redes sociais → Conexões' : 'falta autorizar a conta',
      { tela: 'redes-canal', acao: aut.length ? 'Gerenciar' : 'Conectar' }));
  }

  // Instagram (hoje só métricas)
  lista.push(item('instagram', 'redes', 'Instagram', f.instagram?.conectado ? OK : OFF,
    f.instagram?.conectado ? 'conectado · métricas de post' : 'não conectado · hoje o sistema só lê métricas',
    { tela: 'redes-canal', acao: 'Ver' }));

  // Loja e Google Shopping
  const lj = f.loja || {};
  lista.push(item('loja', 'redes', 'Loja e Google Shopping', lj.publicados > 0 ? OK : OFF,
    lj.publicados > 0 ? `${lj.publicados} produto(s) publicados na vitrine e no feed` : 'nenhum produto publicado',
    { tela: 'loja', acao: 'Ver loja' }));

  // Quebra-Galho (marketplace)
  const qg = f.quebragalho || null;
  if (qg) {
    lista.push(item('quebragalho', 'redes', 'Quebra-Galho', qg.disponivel ? OK : INC,
      qg.disponivel ? 'marketplace no ar e integrado' : `${qg.motivo || 'fora do ar'}${qg.comoResolver ? ` — ${qg.comoResolver}` : ''}`,
      { tela: 'qg-painel', acao: 'Ver', testavel: true }));
  }

  // E-mail (SMTP)
  lista.push(item('email', 'avisos', 'E-mail (SMTP)', f.email?.configurado ? OK : OFF,
    f.email?.configurado ? 'configurado · envia acesso e redefinição de senha' : 'não configurado no servidor (SMTP_USER e SMTP_PASS) — acesso e senha saem só pelo WhatsApp',
    { acao: null, testavel: !!f.email?.configurado }));

  // Alertas de segurança
  const nResp = f.alertas?.responsaveis ?? 0;
  const waOk = (f.whatsapp?.estado || '') === 'conectado';
  lista.push(item('alertas', 'avisos', 'Alertas de segurança',
    nResp && waOk ? OK : nResp ? INC : OFF,
    nResp ? `${nResp} responsável(is) recebem no WhatsApp${waOk ? '' : ' · WhatsApp desconectado: o alerta não sai'}` : 'ninguém cadastrado para receber alertas',
    { tela: 'seguranca', acao: 'Editar' }));

  return lista;
}

/** Resumo + caídas (o que já funcionou e parou). Atualiza o histórico. */
export function comHistorico(lista, { agora = new Date().toISOString() } = {}) {
  const h = ler();
  let mudou = false;
  for (const i of lista) {
    if (i.estado === OK) {
      if (!h.jaFuncionou[i.id]) { h.jaFuncionou[i.id] = agora; mudou = true; }
      if (h.dispensadas[i.id]) { delete h.dispensadas[i.id]; mudou = true; }
    }
  }
  if (mudou) { gravar(h); }
  const caidas = lista.filter((i) => i.estado !== OK && h.jaFuncionou[i.id] && !h.dispensadas[i.id]).map((i) => ({ id: i.id, nome: i.nome, detalhe: i.detalhe, tela: i.tela || null }));
  const conta = (e) => lista.filter((i) => i.estado === e).length;
  return { itens: lista.map((i) => ({ ...i, caiu: caidas.some((c) => c.id === i.id) })), grupos: GRUPOS, resumo: { ok: conta(OK), incompletas: conta(INC), desligadas: conta(OFF) }, caidas };
}

/** O dono viu e decidiu: para de avisar até ela funcionar de novo. */
export function dispensar(id) {
  const h = ler();
  h.dispensadas[String(id)] = new Date().toISOString();
  gravar(h);
  return { ok: true };
}
