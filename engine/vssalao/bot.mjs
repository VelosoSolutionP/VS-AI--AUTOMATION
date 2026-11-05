/**
 * Bot do salão — a conversa que marca/desmarca/confirma, falando com o Cadê Você
 * (cliente cadevc.mjs). Determinístico, por MENU numerado (sem IA, regra de custo):
 * cada opção é um número, que no WhatsApp vira texto ou botão. O CRM é o controller;
 * a agenda mora no Cadê Você — aqui a gente só conduz a conversa.
 *
 * Uso: const bot = criarBotcadevc({ cadevc });
 *      const { resposta, estado } = await bot.responder(estadoAnterior, textoDoCliente, { telefone });
 * O estado é um objeto simples {passo, dados} que o chamador guarda por telefone
 * (mesma ideia de uma sessão de conversa) e devolve na próxima mensagem.
 */
import { escolherOpcao } from '../vsbot/cerebro.mjs';

const norm = (s) => String(s ?? '').trim();
const brl = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const soDig = (s) => String(s || '').replace(/\D/g, '');
/* Próximos N dias em que o salão abre (horarios[].diaSemana: 0=dom..6=sáb). */
function proximosDias(horarios, n = 5, hoje = new Date()) {
  const abre = new Set((horarios || []).filter((h) => !h.fechado).map((h) => h.diaSemana));
  const dias = []; const d = new Date(hoje);
  for (let i = 0; i < 21 && dias.length < n; i++) {
    if (abre.has(d.getDay())) { dias.push(new Date(d)); }
    d.setDate(d.getDate() + 1);
  }
  return dias;
}
/* Data LOCAL (não UTC): à noite, toISOString() pula pro dia seguinte e marcava no
   dia errado. Tem que bater com diaBonito, que é local. */
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const diaBonito = (d) => d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
const dataBonita = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }); };
const menu = (titulo, itens) => `${titulo}\n\n` + itens.map((t, i) => `*${i + 1}.*  ${t}`).join('\n');
const escolha = (texto, n) => { const i = parseInt(soDig(texto), 10); return i >= 1 && i <= n ? i - 1 : -1; };
/* Vários de uma vez (sem repetir). Com separador ("1,3" / "1 e 3" / "1 3") usa os
   grupos — aceita item 10+. Grudado num menu de até 9 itens ("13" / "123") lê
   dígito a dígito, que é o que o cliente quis. */
const varios = (texto, lista) => {
  const t = String(texto).trim();
  const nums = (lista.length <= 9 && /^\d+$/.test(t)) ? t.split('') : (t.match(/\d+/g) || []);
  return [...new Set(nums.map((n) => parseInt(n, 10) - 1))].filter((i) => i >= 0 && i < lista.length).map((i) => lista[i]);
};
/* Horários do EXPEDIENTE quando o profissional não tem agenda própria no Cadê Você
   (dono 22/10: "não deve ter agenda desse profissional, veio null → abre início e
   fim do expediente"). De 30 em 30, de abre a fecha, só onde a duração TOTAL cabe
   antes de fechar (não estoura o expediente). */
function slotsExpediente(horarios, dataIso, durMin) {
  const [y, m, d] = String(dataIso).split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  const h = (horarios || []).find((x) => x.diaSemana === dow && !x.fechado);
  if (!h || !h.abre || !h.fecha) { return []; }
  const toMin = (s) => { const [a, b] = String(s).split(':').map(Number); return a * 60 + (b || 0); };
  const fmt = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const ini = toMin(h.abre), fecha = toMin(h.fecha), dur = durMin || 30, out = [];
  for (let t = ini; t + dur <= fecha; t += 30) { out.push(fmt(t)); }
  return out;
}

export function criarBotcadevc({ cadevc, cerebro } = {}) {
  const ini = () => ({ passo: 'menu', dados: {} });
  /* IGUAL À MICAELA: o Ollama local (cerebro.mjs) só ENTENDE qual opção o cliente
     quis (texto livre → opção), a resposta segue determinística. Número e palavra
     conhecida resolvem de graça; o resto cai no cérebro; cérebro fora do ar = volta
     ao número, nunca trava. */
  const cb = cerebro || {};
  async function pick(texto, labels, contexto) {
    const n = escolha(texto, labels.length);
    if (n >= 0) { return n; }
    if (cb.ligado && labels.length) {
      try {
        const r = await escolherOpcao(texto, labels.map((x, i) => ({ tecla: String(i), texto: x })), cb, { fetch: cb.fetch || globalThis.fetch, contexto });
        if (r.tecla !== null && r.tecla !== '') { return Number(r.tecla); }
      } catch { /* cérebro ajuda, nunca trava */ }
    }
    return -1;
  }

  async function responder(estadoAnterior, texto, { telefone, hoje = new Date(), nomeBot, personalidade, perfilBot, contextoMapa = '' } = {}) {
    const est = estadoAnterior && estadoAnterior.passo ? { ...estadoAnterior, dados: { ...estadoAnterior.dados } } : ini();
    const t = norm(texto);
    const tel = soDig(telefone);
    const nomeAtendente = norm(nomeBot) || 'o atendimento do salão';
    const apresentacaoPerfil = norm(perfilBot?.mensagemInicial).replaceAll('{nome}', nomeAtendente);
    const mensagemFallback = norm(perfilBot?.mensagemFallback);
    const apresentacao = apresentacaoPerfil || (personalidade === 'profissional'
      ? `Olá! Aqui é ${nomeAtendente}, atendimento do salão. Como posso ajudar?`
      : personalidade === 'direto'
        ? `Oi! Sou ${nomeAtendente}. Quer agendar, cancelar ou encerrar o atendimento?`
        : `Oi! Sou ${nomeAtendente} 😊 Vou te ajudar com os horários do salão.`);
    const contexto = [
      perfilBot?.persona,
      ...(perfilBot?.regrasAdicionais || []),
      contextoMapa,
    ].filter(Boolean).join('\n').slice(0, 6000);
    const opcoesMenu = ['Agendar horário', 'Cancelar horário', 'Encerrar atendimento'];
    const voltarMenu = (msg) => ({ resposta: `${msg || mensagemFallback ? `${msg || mensagemFallback}\n\n` : ''}${menu('O que você quer?', opcoesMenu)}`, estado: ini() });
    const pedirOpcao = (titulo, itens, estado) => ({
      resposta: `${mensagemFallback ? `${mensagemFallback}\n\n` : ''}${menu(titulo, itens)}`,
      estado,
    });
    const encerrar = () => ({ resposta: 'Atendimento encerrado. Quando precisar, é só chamar novamente 😊', estado: ini() });

    try {
      if (/\b(encerrar|encerra|finalizar|finalize|tchau|até mais)\b/i.test(t) || /^(fim|sair)$/i.test(t)) {
        return encerrar();
      }

      // "menu" / início / atalhos
      if (est.passo === 'menu' || /^(oi|ol[áa]|menu|voltar|come[çc]ar|in[íi]cio)$/i.test(t)) {
        if (/marcar|agend/i.test(t) || t === '1') { return iniciarMarcar(est, tel, hoje); }
        if (/meus|hor[áa]rios/i.test(t)) { return listarMeus(tel); }
        if (/cancelar|desmarcar/i.test(t) || t === '2') { return iniciarCancelar(tel); }
        if (t === '3') { return encerrar(); }
        const op = await pick(t, opcoesMenu, contexto);
        if (op === 0) { return iniciarMarcar(est, tel, hoje); }
        if (op === 1) { return iniciarCancelar(tel); }
        if (op === 2) { return encerrar(); }
        return voltarMenu(apresentacao);
      }

      if (est.passo === 'profissional') {
        const nomes = est.dados.profissionais.map((p) => p.nome).concat('Tanto faz, qualquer um');
        const i = await pick(t, nomes, contexto);
        if (i < 0) { return pedirOpcao('Escolha o profissional pelo número:', nomes, est); }
        est.dados.profissional = i < est.dados.profissionais.length ? est.dados.profissionais[i] : null;   // último = tanto faz
        return mostrarServicos(est);
      }

      if (est.passo === 'servico') {
        const s = est.dados.servicos;
        /* UM ou VÁRIOS serviços de uma vez (dono 22/10): "1,3" / "1 e 3". Sem número,
           tenta o cérebro pra um só. */
        let escolhidos = varios(t, s);
        if (!escolhidos.length) { const i = await pick(t, s.map(rotuloServico), contexto); if (i >= 0) { escolhidos = [s[i]]; } }
        if (!escolhidos.length) { return pedirOpcao('Não entendi. Escolha o serviço pelo número — pode mais de um, separado por vírgula (ex.: 1,3):', s.map(rotuloServico), est); }
        est.dados.escolhidos = escolhidos;
        return mostrarDias(est, hoje);
      }

      if (est.passo === 'dia') {
        const i = await pick(t, est.dados.dias.map(diaBonito), contexto);
        if (i < 0) { return pedirOpcao('Escolha o dia pelo número:', est.dados.dias.map(diaBonito), est); }
        est.dados.data = iso(est.dados.dias[i]);
        return mostrarVagas(est);
      }

      if (est.passo === 'hora') {
        const i = await pick(t, est.dados.vagas.map((v) => `${v.hora} · ${v.profissional}`), contexto);
        if (i < 0) { return pedirOpcao('Escolha o horário pelo número:', est.dados.vagas.map((v) => `${v.hora} · ${v.profissional}`), est); }
        est.dados.vaga = est.dados.vagas[i];
        return confirmarOuPedirNome(est, tel);
      }

      if (est.passo === 'novo') {
        const i = await pick(t, ['Sim, sou novo(a)', 'Não, já sou cliente']);
        if (i === 1) { return efetivar(est, tel); }                                    // já é cliente, marca direto
        if (i === 0) { est.passo = 'nome'; return { resposta: 'Que bom te receber! 😊 Qual o seu *nome completo*?', estado: est }; }
        return { resposta: menu('É a *primeira vez* aqui?', ['Sim, sou novo(a)', 'Não, já sou cliente']), estado: est };
      }

      if (est.passo === 'nome') {
        if (t.length < 2) { return { resposta: 'Qual o seu *nome completo*? (primeira vez aqui 😊)', estado: est }; }
        est.dados.nome = t;
        est.passo = 'cpf';
        return { resposta: `Prazer, ${t.split(' ')[0]}! E o seu *CPF*? (só os 11 números)`, estado: est };
      }
      if (est.passo === 'cpf') {
        const cpf = soDig(t);
        if (cpf.length !== 11) { return { resposta: 'Preciso do *CPF* com os 11 números pra confirmar a reserva. Pode mandar?', estado: est }; }
        est.dados.cpf = cpf;
        return efetivar(est, tel);
      }

      if (est.passo === 'cancelar') {
        const i = await pick(t, est.dados.ags.map(rotuloAg), contexto);
        if (i < 0) { return pedirOpcao('Qual agendamento cancelar? (número)', est.dados.ags.map(rotuloAg), est); }
        const ag = est.dados.ags[i];
        const r = await cadevc.cancelar(ag.id, 'cancelado pelo cliente no WhatsApp');
        const aviso = r.multa ? ` Como foi em cima da hora, há uma taxa de ${brl(r.multa)} que entra no seu próximo agendamento.` : '';
        return voltarMenu(`Pronto, cancelei o ${rotuloAg(ag)}.${aviso}`);
      }

      return voltarMenu();
    } catch (e) {
      return { resposta: `Ops, deu um probleminha aqui (${e.message}). Vamos de novo?\n\n${menu('O que você quer?', opcoesMenu)}`, estado: ini() };
    }

    // ── passos ─────────────────────────────────────────────────────────────
    async function iniciarMarcar(e, telefone, hj) {
      const s = await cadevc.cadevc();
      e.dados.config = { regras: s.regras, horarios: s.horarios };
      e.dados.servicos = s.servicos || [];
      e.dados.profissionais = s.profissionais || [];
      if (!e.dados.servicos.length) { return { resposta: 'O salão ainda não cadastrou serviços. Fala com a recepção.', estado: ini() }; }
      /* Barbeiro PRIMEIRO (pedido do dono, 22/10): numa barbearia o cliente escolhe
         com quem quer, depois o serviço. Sem profissional cadastrado, vai direto ao serviço. */
      if (e.dados.profissionais.length) {
        e.passo = 'profissional';
        const nomes = e.dados.profissionais.map((p) => p.nome).concat('Tanto faz, qualquer um');
        return { resposta: menu('Com qual profissional você quer marcar?', nomes), estado: e };
      }
      e.passo = 'servico';
      return { resposta: menu('Qual serviço?', e.dados.servicos.map(rotuloServico)), estado: e };
    }
    function mostrarServicos(e) {
      e.passo = 'servico';
      const titulo = e.dados.profissional ? `Com ${e.dados.profissional.nome}. Qual serviço?` : 'Qual serviço?';
      return { resposta: menu(titulo, e.dados.servicos.map(rotuloServico)), estado: e };
    }
    function mostrarDias(e, hj) {
      e.dados.dias = proximosDias(e.dados.config.horarios, 5, hj);
      e.passo = 'dia';
      return { resposta: menu(`${e.dados.escolhidos.map((x) => x.nome).join(' + ')} — qual dia?`, e.dados.dias.map(diaBonito)), estado: e };
    }
    async function mostrarVagas(e) {
      const v = await cadevc.vagas({ data: e.dados.data, servicos: e.dados.escolhidos.map((x) => x.id) });
      let profs = v.profissionais || [];
      /* Barbeiro escolhido = só as vagas dele; "tanto faz" = todos. */
      if (e.dados.profissional) { profs = profs.filter((p) => String(p.id) === String(e.dados.profissional.id)); }
      let vagas = [];
      for (const p of profs) { for (const h of p.horarios || []) { vagas.push({ hora: h, profissional: p.nome, profissionalId: p.id }); } }
      /* Profissional sem agenda própria (veio null): cai no EXPEDIENTE do salão. */
      if (!vagas.length) {
        const dur = e.dados.escolhidos.reduce((s, x) => s + (Number(x.duracao) || 30), 0);
        const prof = e.dados.profissional || e.dados.profissionais[0] || null;
        vagas = slotsExpediente(e.dados.config.horarios, e.dados.data, dur).map((h) => ({ hora: h, profissional: prof?.nome || 'a combinar', profissionalId: prof?.id || null }));
      }
      vagas.sort((a, b) => a.hora.localeCompare(b.hora));
      if (!vagas.length) {
        e.passo = 'dia';
        return { resposta: `Nesse dia o salão não tem horário pra ${e.dados.escolhidos.map((x) => x.nome).join(' + ')}. ${menu('Escolha outro dia:', e.dados.dias.map(diaBonito))}`, estado: e };
      }
      e.dados.vagas = vagas.slice(0, 8); e.passo = 'hora';
      return { resposta: menu(`🗓️ *${dataBonita(e.dados.data)}*\nHorários livres:`, e.dados.vagas.map((x) => `🕐 *${x.hora}*${e.dados.profissional ? '' : '  ·  ' + x.profissional}`)), estado: e };
    }
    async function confirmarOuPedirNome(e, telefone) {
      if (e.dados.nome) { return efetivar(e, telefone); }   // nome+CPF já coletados
      e.passo = 'novo';
      return { resposta: menu('É a *primeira vez* aqui?', ['Sim, sou novo(a)', 'Não, já sou cliente']), estado: e };
    }
    async function efetivar(e, telefone) {
      const corpo = { telefone, servicos: e.dados.escolhidos.map((x) => x.id), data: e.dados.data, hora: e.dados.vaga.hora, profissional: e.dados.vaga.profissionalId };
      if (e.dados.nome) { corpo.nome = e.dados.nome; }
      if (e.dados.cpf) { corpo.cpf = e.dados.cpf; corpo.observacoes = `CPF ${e.dados.cpf}`; }   // cadevc aceita o que conhece; CPF também fica na observação
      const r = await cadevc.marcar(corpo);
      const ag = r.agendamento || {};
      const regra = e.dados.config?.regras?.cancelamentoHorasMinimo;
      const aviso = regra ? ` Pra cancelar sem taxa, avise com ${regra}h de antecedência.` : '';
      const total = e.dados.escolhidos.reduce((acc, x) => acc + (Number(x.preco) || 0), 0);
      return { resposta: `✅ *Marcado!*\n\n✂️ *${e.dados.escolhidos.map((x) => x.nome).join(' + ')}*\n🗓️ ${dataBonita(e.dados.data)} às *${e.dados.vaga.hora}*\n💈 com ${e.dados.vaga.profissional}\n💰 ${brl(ag.valor ?? total)}${aviso ? `\n\n_${aviso.trim()}_` : ''}\n\n❌ Pra *cancelar*, responda *CANCELAR*`, estado: ini() };
    }
    async function listarMeus(telefone) {
      const r = await cadevc.agendamentosDe(telefone);
      const ags = r.agendamentos || [];
      if (!ags.length) { return voltarMenu('Você não tem horário marcado.'); }
      return voltarMenu('Seus horários:\n' + ags.map((a) => '• ' + rotuloAg(a)).join('\n'));
    }
    async function iniciarCancelar(telefone) {
      const r = await cadevc.agendamentosDe(telefone);
      const ags = r.agendamentos || [];
      if (!ags.length) { return voltarMenu('Você não tem horário pra cancelar.'); }
      return { resposta: menu('Qual cancelar?', ags.map(rotuloAg)), estado: { passo: 'cancelar', dados: { ags } } };
    }
  }

  return { responder, estadoInicial: ini };
}

function rotuloServico(s) { return `${s.nome} — ${brl(s.preco)}${s.duracao ? ` (${s.duracao}min)` : ''}`; }
function rotuloAg(a) {
  const d = a.inicio ? new Date(a.inicio) : null;
  const quando = d ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : `${a.data || ''} ${a.hora || ''}`.trim();
  const serv = Array.isArray(a.servicos) ? a.servicos.map((x) => x.nome || x).join(', ') : (a.servico || 'serviço');
  return `${serv} — ${quando}`;
}
