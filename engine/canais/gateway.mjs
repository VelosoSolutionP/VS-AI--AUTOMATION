/**
 * Channel Gateway — a fronteira.
 *
 * De um lado, providers de canal (WhatsApp Web hoje, Cloud amanhã, Instagram
 * depois). Do outro, o domínio. O gateway não sabe o que o domínio faz com a
 * mensagem, e o domínio não sabe de onde ela veio: recebe sempre o mesmo
 * formato canônico.
 *
 * O que É responsabilidade daqui (infraestrutura de canal):
 *   - registrar providers e validar o contrato antes de aceitar;
 *   - garantir que a MESMA mensagem não seja entregue duas vezes;
 *   - devolver a resposta pelo canal de onde a mensagem veio.
 *
 * O que NÃO é: criar cliente, abrir conversa, mexer em fila, pontuar lead,
 * decidir resposta. Nada disso aparece neste arquivo — e é esse limite que
 * permite trocar o canal sem reescrever o produto.
 */
import { validarProvider, ESTADOS } from './provider.mjs';

export function criarGateway({ entregar, reservar } = {}) {
  if (typeof entregar !== 'function') {
    throw new Error('gateway sem `entregar`: é a função do domínio que recebe a mensagem canônica');
  }
  const providers = new Map();
  const vistas = new Set(); // trava de reentrega em memória, quando não há store

  /**
   * A trava de reentrega é do CANAL, não do domínio: o WhatsApp Web reentrega
   * mensagem ao reconectar, e quem tem de aparar isso é quem fala com ele.
   */
  const jaVi = (chave) => {
    if (typeof reservar === 'function') { return !reservar(chave, { tipo: 'mensagem-canal' }); }
    if (vistas.has(chave)) { return true; }
    vistas.add(chave);
    if (vistas.size > 5000) { vistas.delete(vistas.values().next().value); }
    return false;
  };

  function registrar(provider) {
    const v = validarProvider(provider);
    if (!v.ok) { throw new Error('provider recusado — ' + v.erro); }
    providers.set(provider.nome, provider);

    provider.aoReceber(async (msg) => {
      const chave = `${provider.nome}:${msg.id}`;
      if (!msg.id || jaVi(chave)) { return; }
      try {
        const r = await entregar(msg, { canal: provider.nome, responder: (texto) => provider.enviarTexto({ para: msg.endereco || msg.de, texto }) });
        // O domínio pode devolver um texto pra responder. Se não devolver, tudo
        // bem: nem toda mensagem merece resposta automática.
        if (r && r.responder) { await provider.enviarTexto({ para: msg.endereco || msg.de, texto: r.responder }); }
      } catch (e) {
        console.error(`[gateway] ${provider.nome} entregou e o dominio quebrou: ${e.message}`);
      }
    });

    return provider;
  }

  const obter = (nome) => providers.get(nome) || null;
  const listar = () => [...providers.values()].map((p) => ({ ...p.status(), nome: p.nome, oficial: p.oficial }));

  /** Estado de todos os canais, pra tela de Canais e pro health do servidor. */
  async function saudeGeral() {
    const out = [];
    for (const p of providers.values()) {
      let s = { ok: false, detalhe: 'não respondeu' };
      try { s = await p.saude(); } catch (e) { s = { ok: false, detalhe: e.message }; }
      out.push({ nome: p.nome, oficial: p.oficial, estado: p.status().estado, ...s });
    }
    return out;
  }

  /** Envia por um canal específico — usado quando o atendente responde pelo painel. */
  async function enviarPor(nome, { para, texto }) {
    const p = obter(nome);
    if (!p) { return { ok: false, erro: `canal "${nome}" não registrado` }; }
    if (p.status().estado !== ESTADOS.CONECTADO) { return { ok: false, erro: `canal "${nome}" está ${p.status().estado}` }; }
    return p.enviarTexto({ para, texto });
  }

  return { registrar, obter, listar, saudeGeral, enviarPor, providers };
}
