/**
 * Entrega de licença via WhatsApp. Provider plugável.
 *   WHATSAPP_PROVIDER = cloud | log   (default: log)
 *
 * cloud = WhatsApp Cloud API (Meta). Fora da janela de 24h exige TEMPLATE aprovado.
 *   env: WA_TOKEN, WA_PHONE_ID, WA_TEMPLATE (nome do template), WA_LANG (default pt_BR)
 *   O template deve ter 1 variável no corpo = a chave.
 * log = não envia; loga + devolve link wa.me pra envio manual (fallback seguro).
 */
const PROVIDER = process.env.WHATSAPP_PROVIDER || 'log';

const onlyDigits = (s) => String(s || '').replace(/\D/g, '');

function waMeLink(phone, text) {
  return `https://wa.me/${onlyDigits(phone)}?text=${encodeURIComponent(text)}`;
}

async function sendCloud(phone, key, name) {
  const token = process.env.WA_TOKEN;
  const phoneId = process.env.WA_PHONE_ID;
  const template = process.env.WA_TEMPLATE;
  const lang = process.env.WA_LANG || 'pt_BR';
  if (!token || !phoneId) { throw new Error('WA_TOKEN/WA_PHONE_ID ausentes'); }

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

  const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) { throw new Error('WhatsApp Cloud API: ' + JSON.stringify(j)); }
  return { ok: true, id: j.messages?.[0]?.id };
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
      console.error(`[whatsapp] Cloud API falhou: ${e.message} — fallback link manual: ${link}`);
      return { ok: false, provider: 'cloud', error: e.message, link };
    }
  }

  // log/fallback: registra a chave + link de envio manual
  console.log(`[whatsapp:log] entregar para ${phone} (${name || 's/nome'}):`);
  console.log(`  chave: ${key}`);
  console.log(`  link manual: ${link}`);
  return { ok: true, provider: 'log', link };
}
