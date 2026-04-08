import type { APIRoute } from 'astro';

export const prerender = false;

const TG_TOKEN = import.meta.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

// One-shot helper: visit /api/tg-set-commands once after deploy to register
// the slash-command autocomplete menu in Telegram.
export const GET: APIRoute = async () => {
  if (!TG_TOKEN) return new Response('TELEGRAM_BOT_TOKEN not set', { status: 500 });

  const commands = [
    { command: 'help',     description: 'List all commands' },
    { command: 'today',    description: 'Today\'s overview (visitors, leads, top cities)' },
    { command: 'active',   description: 'Sessions live in the last 15 min' },
    { command: 'visitors', description: 'Last 10 visitor sessions' },
    { command: 'sessions', description: 'Last N sessions (default 5, max 20)' },
    { command: 'leads',    description: 'Sessions you marked as leads' },
    { command: 'stats',    description: 'Aggregate stats by city/device/browser' },
    { command: 'find',     description: 'Find sessions by IP — usage: /find 1.2.3.4' },
    { command: 'session',  description: 'Show one session in detail — /session abc123' },
    { command: 'ask',      description: 'Ask AI anything — /ask which city brings most leads?' },
  ];

  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/setMyCommands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commands }),
    });
    const data = await r.json();
    return new Response(JSON.stringify({ ok: data.ok, result: data, registered: commands.length }, null, 2), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e: any) {
    return new Response('Error: ' + (e?.message || e), { status: 500 });
  }
};
