/**
 * Saída de WhatsApp. Provider plugável.
 *   WHATSAPP_PROVIDER = cloud | log   (default: log)
 *
 * O canal do dia a dia NAO passa mais por aqui: ele e o WhatsAppWebProvider, em
 * engine/canais/. Este arquivo cobre a saida pela API OFICIAL da Meta, que fica
 * de pe pro dia em que a conta destravar.
 *
 * cloud = WhatsApp Cloud API (Meta). Fora da janela de 24h exige TEMPLATE aprovado.
 *   env: WA_TOKEN, WA_PHONE_ID, WA_TEMPLATE (nome do template), WA_LANG (default pt_BR)
 *   O template deve ter 1 variável no corpo = a chave.
 * log = NÃO envia: registra a chave e devolve o link wa.me pro envio manual.
 *
 * REGRA (spec §6): nada de fallback silencioso Meta -> log. `ok` significa UMA coisa
 * só — a mensagem saiu pela rede. O provider `log` devolve ok:false com `pendente:true`,
 * porque antes ele devolvia ok:true e o /trial respondia "entregue" sem nada ter saído:
 * o cliente ficava esperando uma chave que nunca chegou no WhatsApp dele.
 * Provider `cloud` sem credencial também não cai pra log — falha explícito.
 */
// normalizarTelefone e funcao PURA e testada; na extracao do dominio compartilhado
// (P0) ela sai de vscrm pra biblioteca comum. Duplicar a regra aqui seria pior: foi
// justamente a falta do DDI que fez a entrega nao chegar em numero nenhum.
import { normalizarTelefone } from '../engine/vscrm/leads.mjs';

const PROVIDER = process.env.WHATSAPP_PROVIDER || 'log';

/** E.164 do Brasil. Sem o 55 o wa.me e a Cloud API descartam o destino. */
const onlyDigits = (s) => normalizarTelefone(s).telefone || String(s || '').replace(/\D/g, '');

function waMeLink(phone, text) {
  return `https://wa.me/${onlyDigits(phone)}?text=${encodeURIComponent(text)}`;
}

/**
 * Uma saida so pra Cloud API. Recebe o corpo ja montado porque sao dois casos
 * diferentes: a licenca pode ir por TEMPLATE (fora da janela de 24h) e a resposta
 * do bot vai sempre como texto — ela so existe porque o cliente escreveu primeiro,
 * ou seja, a janela esta aberta por definicao.
 */
async function postCloud(body, fetchImpl = globalThis.fetch) {
  const token = process.env.WA_TOKEN;
  const phoneId = process.env.WA_PHONE_ID;
  if (!token || !phoneId) { throw new Error('WA_TOKEN/WA_PHONE_ID ausentes'); }

  const r = await fetchImpl(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { throw new Error('WhatsApp Cloud API: ' + JSON.stringify(j)); }
  return { ok: true, id: j.messages?.[0]?.id };
}

async function sendCloud(phone, key, name) {
  const template = process.env.WA_TEMPLATE;
  const lang = process.env.WA_LANG || 'pt_BR';
  const body = template
    ? {
        messaging_product: 'whatsapp', to: onlyDigits(phone), type: 'template',
        template: { name: template, language: { code: lang }, components: [
          { type: 'body', parameters: [{ type: 'text', text: key }] },
        ] },
      }
    : {
        messaging_product: 'whatsapp', to: onlyDigits(phone), type: 'text',
        text: { body: `Sua licença QA-Gate:\n\n${key}\n\nConfigure: export QA_GATE_LICENSE="<chave>"` },
      };
  return postCloud(body);
}

/**
 * Manda um texto qualquer pro cliente. E por aqui que a resposta do bot sai.
 *
 * Mesma regra do resto do modulo: `ok:true` significa que a mensagem SAIU pela
 * rede. Sem credencial ou com provider `log` devolve ok:false com o link wa.me —
 * nunca ok:true "por gentileza", senao a trilha do CRM registra uma resposta que
 * o cliente nunca recebeu.
 *
 * @returns {Promise<{ok:boolean, provider:string, id?:string, link?:string, error?:string}>}
 */
export async function enviarTexto({ phone, texto }, { fetchImpl } = {}) {
  const destino = onlyDigits(phone);
  const link = waMeLink(phone, texto);
  if (!destino) { return { ok: false, provider: PROVIDER, error: 'telefone vazio' }; }

  if (PROVIDER !== 'cloud') {
    console.log(`[whatsapp:log] resposta NAO enviada (provider=${PROVIDER}) para ${destino}: ${String(texto).slice(0, 80)}`);
    return { ok: false, provider: PROVIDER, pendente: true, error: `WHATSAPP_PROVIDER=${PROVIDER} — nada foi enviado`, link };
  }
  try {
    const r = await postCloud({
      messaging_product: 'whatsapp', to: destino, type: 'text',
      text: { preview_url: false, body: String(texto).slice(0, 4096) },
    }, fetchImpl);
    return { ok: true, provider: 'cloud', id: r.id };
  } catch (e) {
    console.error(`[whatsapp] resposta FALHOU para ${destino} (${PROVIDER}): ${e.message}`);
    return { ok: false, provider: PROVIDER, error: e.message, link };
  }
}

/**
 * @returns {Promise<{ok:boolean, provider:string, link?:string, id?:string, error?:string}>}
 */
export async function sendLicense({ phone, key, name, plan }) {
  const msg = `Olá${name ? ' ' + name : ''}! Sua licença QA-Gate (${plan}):\n\n${key}\n\nConfigure: export QA_GATE_LICENSE="a chave acima"`;
  const link = waMeLink(phone, msg);

  if (PROVIDER === 'cloud') {
    try {
      const res = await sendCloud(phone, key, name);
      console.log(`[whatsapp] enviado via Cloud API para ${phone} (id=${res.id})`);
      return { ok: true, provider: 'cloud', id: res.id };
    } catch (e) {
      // Falhou no cloud: NAO cai pra log. Devolve o erro e o link pro envio manual,
      // mas ok:false — quem chamou tem de saber que nada saiu.
      console.error(`[whatsapp] Cloud API FALHOU: ${e.message} — envie manualmente: ${link}`);
      return { ok: false, provider: 'cloud', pendente: true, error: e.message, link };
    }
  }

  // log: registra a chave + link de envio manual. Entrega fica PENDENTE de ação humana.
  console.log(`[whatsapp:log] PENDENTE de envio manual para ${phone} (${name || 's/nome'}):`);
  console.log(`  chave: ${key}`);
  console.log(`  link manual: ${link}`);
  return {
    ok: false,
    provider: 'log',
    pendente: true,
    error: 'WHATSAPP_PROVIDER=log — nada foi enviado; entregue pelo link manual',
    link,
  };
}
