import type { APIRoute } from 'astro';

export const prerender = false;

const TG_TOKEN = import.meta.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT  = import.meta.env.TELEGRAM_CHAT_ID   || process.env.TELEGRAM_CHAT_ID;

function esc(s: any): string {
  return String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));
}

export const POST: APIRoute = async ({ request }) => {
  let body: any = {};
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'bad json' }), { status: 400 });
  }

  const { name, contact, business, city, industry, notes, sessionId, conversation } = body;

  // Minimal validation
  if (!name || !contact) {
    return new Response(JSON.stringify({ error: 'name and contact required' }), { status: 400 });
  }

  if (!TG_TOKEN || !TG_CHAT) {
    console.warn('[lead-submit] Telegram env vars not set');
    return new Response(JSON.stringify({ ok: false, warning: 'telegram not configured' }));
  }

  const convoSnippet = Array.isArray(conversation)
    ? conversation.slice(-6).map((t: any) => `  <i>${esc(t.role)}</i>: ${esc((t.text || '').slice(0, 200))}`).join('\n')
    : '';

  const msg = [
    `🎯 <b>NEW LEAD — Solve Your Problems</b>`,
    `👤 <b>Name:</b> ${esc(name)}`,
    `📞 <b>Contact:</b> ${esc(contact)}`,
    business  ? `🏢 <b>Business:</b> ${esc(business)}` : '',
    city      ? `📍 <b>City:</b> ${esc(city)}` : '',
    industry  ? `🏷️ <b>Industry:</b> ${esc(industry)}` : '',
    notes     ? `📝 <b>Notes:</b> ${esc(notes)}` : '',
    sessionId ? `🆔 <code>${esc(sessionId)}</code>` : '',
    convoSnippet ? `\n💬 <b>Recent conversation:</b>\n${convoSnippet}` : '',
  ].filter(Boolean).join('\n');

  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: msg, parse_mode: 'HTML' }),
    });
  } catch (e) {
    console.warn('[lead-submit tg]', e);
    return new Response(JSON.stringify({ error: 'telegram failed' }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json' },
  });
};
