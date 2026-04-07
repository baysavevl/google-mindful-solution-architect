import type { APIRoute } from 'astro';

export const prerender = false;

const TG_TOKEN = import.meta.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

export const GET: APIRoute = async () => {
  if (!TG_TOKEN) return new Response('TELEGRAM_BOT_TOKEN not set', { status: 500 });
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getUpdates`);
    const data = await r.json();
    if (!data.ok) return new Response(JSON.stringify(data, null, 2), { status: 500 });

    const chats = new Map<number, any>();
    for (const u of data.result || []) {
      const chat = u.message?.chat || u.channel_post?.chat || u.my_chat_member?.chat;
      if (chat) chats.set(chat.id, { id: chat.id, type: chat.type, title: chat.title || (chat.first_name || '') + ' ' + (chat.last_name || ''), username: chat.username });
    }
    const list = Array.from(chats.values());
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Telegram chats</title>
<style>body{font-family:system-ui;max-width:720px;margin:2rem auto;padding:0 1rem;color:#202124}
h1{font-size:1.3rem}table{width:100%;border-collapse:collapse;margin-top:1rem}
th,td{padding:.6rem;text-align:left;border-bottom:1px solid #eee;font-size:.9rem}
th{background:#f8f9fa}.id{font-family:ui-monospace,monospace;background:#f1f3f4;padding:.15em .4em;border-radius:4px}
.note{background:#fef7e0;border-left:3px solid #f9ab00;padding:.75rem 1rem;border-radius:4px;margin:1rem 0;font-size:.85rem}
</style></head><body>
<h1>Telegram chats this bot has seen</h1>
<div class="note">⚠️ Telegram only returns recent updates (last ~24h). If your group isn't here:
<ol><li>Add the bot to the group</li><li>Send any message in the group (e.g., "hello")</li><li>Refresh this page</li></ol>
Then copy the <code>id</code> below and set it as <code>TELEGRAM_CHAT_ID</code> in Vercel env vars.</div>
${list.length === 0 ? '<p>No chats yet. Send a message to your bot or in your group, then refresh.</p>' :
`<table><tr><th>id</th><th>type</th><th>title / name</th></tr>${list.map(c => `<tr><td><span class="id">${c.id}</span></td><td>${c.type}</td><td>${c.title || ''} ${c.username ? '@' + c.username : ''}</td></tr>`).join('')}</table>`}
</body></html>`;
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  } catch (e: any) {
    return new Response('Error: ' + (e?.message || e), { status: 500 });
  }
};
