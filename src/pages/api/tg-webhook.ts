import type { APIRoute } from 'astro';
import { blockIp, markLead } from '../../lib/state';

export const prerender = false;

const TG_TOKEN = import.meta.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

async function tgApi(method: string, body: any) {
  if (!TG_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) { console.warn('[tg api]', e); }
}

export const POST: APIRoute = async ({ request }) => {
  let update: any = {};
  try { update = await request.json(); } catch { return new Response('bad', { status: 400 }); }

  const cb = update.callback_query;
  if (!cb) return new Response(JSON.stringify({ ok: true }));

  const data: string = cb.data || '';
  const [action, ...rest] = data.split(':');
  const ip = rest.join(':');
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;

  let answerText = 'OK';
  if (action === 'lead' && ip) { markLead(ip); answerText = `🎯 ${ip} marked as lead`; }
  else if (action === 'block' && ip) { blockIp(ip); answerText = `🚫 ${ip} blocked (until cold start)`; }
  else if (action === 'info' && ip) {
    // Look up extra info on demand
    try {
      const r = await fetch(`http://ip-api.com/json/${ip}?fields=country,regionName,city,isp,org,as,reverse,mobile,proxy,hosting`);
      const j = await r.json();
      answerText = `${j.city || '?'}, ${j.country || '?'} • ${j.isp || '?'} • mobile=${j.mobile} proxy=${j.proxy} hosting=${j.hosting}`;
    } catch { answerText = 'Lookup failed'; }
  }

  // Acknowledge button press (popup)
  await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: answerText.slice(0, 200), show_alert: action === 'info' });

  // Append result to original message
  if (chatId && messageId && action !== 'info') {
    const original = cb.message.text || '';
    await tgApi('editMessageText', {
      chat_id: chatId, message_id: messageId,
      text: original + `\n\n✅ ${answerText}`,
      parse_mode: 'HTML',
    });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
};
