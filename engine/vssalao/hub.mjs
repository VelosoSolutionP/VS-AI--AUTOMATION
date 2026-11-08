/**
 * Hub do salão — multi-tenant. Cada cliente (CNPJ) tem o SEU Evolution (número
 * próprio), o SEU Cadê Você (agenda) e o SEU bot, isolados. O webhook do Evolution
 * chega aqui, a gente descobre de qual tenant é pela `instance`, e roda o bot
 * daquele salão com a agenda dele — nunca mistura cliente.
 *
 * NÃO encosta no gateway dos canais (que é da Micaela/WhatsApp): é um caminho
 * próprio do salão, pra o WhatsApp do salão cair no BOT DO SALÃO, não na Micaela.
 */
import { criarWhatsAppEvolutionProvider } from '../canais/whatsapp-evolution/index.mjs';
import { criarCadevcClient } from './cadevc.mjs';
import { criarBotcadevc } from './bot.mjs';
import * as cfgStore from './config.mjs';
import { comEmpresa } from '../casa.mjs';
import * as hotel from '../vs0007/bots.mjs';
import * as mapaHotel from '../vs0007/mapa.mjs';
import { avaliarParaUso } from './ias.mjs';

/* Um conjunto (provider + bot + conversas) por tenant. A chave '' é a raiz. */
const porTenant = new Map();

/** Monta (ou pega do cache) o atendente do salão daquele CNPJ. opts.fetch/cerebro pra teste. */
export function doTenant(cnpj, opts = {}) {
  const chave = cnpj || '';
  if (porTenant.has(chave)) { return porTenant.get(chave); }
  const montado = comEmpresa(cnpj, () => {
    const cfg = cfgStore.config();
    if (!cfg.evolutionUrl || !cfg.evolutionKey || !cfg.evolutionInstance) { return null; }
    const prov = criarWhatsAppEvolutionProvider({ baseUrl: cfg.evolutionUrl, apiKey: cfg.evolutionKey, instance: cfg.evolutionInstance, nome: 'whatsapp-web', fetchImpl: opts.fetch });
    const cadevc = criarCadevcClient({ baseUrl: cfg.cadevcUrl, token: cfg.cadevcToken, fetchImpl: opts.fetch });
    const bot = criarBotcadevc({ cadevc, cerebro: { ligado: true, ...(opts.cerebro || {}) } });
    const estados = new Map();   // telefone -> estado da conversa, isolado por tenant
    const quem = cnpj || 'raiz';
    prov.aoReceber(async (m) => {
      if (!m.de || !m.texto) { return; }
      const botAtivo = comEmpresa(cnpj, () => cfgStore.config().ativo !== false);
      if (!botAtivo) {
        console.log(`[cadevc:${quem}] bot desligado — mensagem ignorada de ${m.de}`);
        return;
      }
      /* Trilha (dono 22/10: "coloca log"): toda a conversa do salão aparece no
         .painel.log — chegou, qual passo, o que o bot respondeu, e se o envio falhou. */
      console.log(`[cadevc:${quem}] ← ${m.de}: ${String(m.texto).slice(0, 80)}`);
      try {
        /* Chegou mensagem = a instância ESTÁ conectada; o objeto provider ainda não
           sabe (nasceu "desconectado"). Sincroniza uma vez pra poder responder. */
        if (prov.status().estado !== 'conectado') { await prov.sincronizar(); }
        const perfil = comEmpresa(cnpj, () => cfgStore.config());
        const botHotel = perfil.bot0007Id
          ? comEmpresa(cnpj, () => hotel.obterBot(perfil.bot0007Id))
          : null;
        const avaliacao = perfil.bot0007Id ? comEmpresa(cnpj, () => (botHotel ? avaliarParaUso(botHotel) : { ok: false, motivo: 'IA não encontrada' })) : { ok: true };
        if (perfil.bot0007Id && !avaliacao.ok) {
          console.error(`[cadevc:${quem}] perfil 0007 ${perfil.bot0007Id} recusado no salão (${avaliacao.motivo}); mensagem não respondida`);
          return;
        }
        const nosHomologados = botHotel
          ? comEmpresa(cnpj, () => mapaHotel.obterNos(botHotel.agenteId).nos)
            .filter((no) => no.estado === 'homologado')
          : [];
        const contextoMapa = nosHomologados.map((no) => `${no.categoria}: ${no.conteudo}`).join('\n');
        const r = await bot.responder(estados.get(m.de) || null, m.texto, {
          telefone: m.de,
          nomeBot: botHotel?.nome || perfil.nomeBot,
          personalidade: perfil.personalidade,
          perfilBot: botHotel?.perfil,
          contextoMapa,
        });
        estados.set(m.de, r.estado);
        /* Contato só com LID (sem telefone visível): responde ao endereço @lid. */
        const env = await prov.enviarTexto({ para: m.endereco || m.de, texto: r.resposta });
        console.log(`[cadevc:${quem}] → ${m.de} [passo=${r.estado?.passo || 'fim'}]: ${String(r.resposta).split('\n')[0]}${env && env.ok === false ? ` [FALHOU O ENVIO: ${env.erro}]` : ''}`);
      } catch (e) { console.error(`[cadevc:${quem}] bot QUEBROU ao responder ${m.de}: ${e.message}`); }
    });
    return { prov, bot, estados };
  });
  porTenant.set(chave, montado);
  return montado;
}

/** Webhook do Evolution → acha o tenant pela instância → entrega pro bot dele.
 *  Devolve {ok} ou {ok:false, motivo} (instância desconhecida é ignorada de propósito). */
export function receberWebhook(body, opts = {}) {
  const inst = Array.isArray(body) ? body[0]?.instance : body?.instance;
  if (!inst) { return { ok: false, motivo: 'webhook sem instance' }; }
  const cnpj = cfgStore.tenantPorInstancia(inst);
  if (cnpj === null) { return { ok: false, motivo: `instância desconhecida: ${inst}` }; }
  const at = doTenant(cnpj, opts);
  if (!at) { return { ok: false, motivo: `tenant ${cnpj || 'raiz'} sem config do salão` }; }
  const n = at.prov.receberEvento(body);
  console.log(`[cadevc] webhook ${inst} → tenant ${cnpj || 'raiz'}: ${n} mensagem(ns) pro bot`);
  return { ok: true, tenant: cnpj, mensagens: n };
}

/** Esquece um tenant após troca de credenciais, ou todos para teste/limpeza. */
export function esquecer(cnpj) {
  if (cnpj === undefined) { porTenant.clear(); return; }
  porTenant.delete(cnpj || '');
}
