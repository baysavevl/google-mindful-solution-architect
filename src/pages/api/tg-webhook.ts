import type { APIRoute } from 'astro';
import {
  blockIp, markLead,
  getSessions, getActiveSessions, getTodayStats, getLeadSessions,
  findSessionsByIp, getSessionById, type SessionRecord,
} from '../../lib/state';

export const prerender = false;

const TG_TOKEN = import.meta.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_KEY = import.meta.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;

async function tgApi(method: string, body: any) {
  if (!TG_TOKEN) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await r.json();
  } catch (e) { console.warn('[tg api]', e); return null; }
}

function esc(s: any): string {
  return String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));
}

function fmtTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function fmtSessionLine(s: SessionRecord): string {
  const loc = [s.city, s.country].filter(Boolean).join(', ') || '?';
  const eng = s.endTs && s.durationMs ? ` • ${fmtDuration(s.durationMs)}` : ' • <i>active</i>';
  const acts = s.actions.length ? ` • ${s.actions.length} actions` : '';
  return `<code>${esc(s.sessionId.slice(-6))}</code> ${esc(loc)} • ${esc(s.device || '?')} ${esc(s.browser || '')}${eng}${acts}\n   ↳ ${fmtTimeAgo(s.startTs)} • ${esc(s.landing || '/')}`;
}

// ── Inline keyboard with suggested commands after each response ──
function suggestKb(suggestions: { text: string; cmd: string }[]) {
  return {
    inline_keyboard: suggestions.map(s => [{ text: s.text, callback_data: `cmd:${s.cmd}` }]),
  };
}

// ── Command handlers ──
const COMMANDS: Record<string, (args: string) => Promise<{ text: string; keyboard?: any }>> = {
  async help() {
    const text = [
      '<b>📋 Available commands</b>',
      '',
      '<b>Quick stats</b>',
      '/today — today\'s overview (visitors, leads, top cities)',
      '/active — sessions live in the last 15 min',
      '/stats — full aggregate stats',
      '',
      '<b>Browse sessions</b>',
      '/visitors — last 10 visitor sessions',
      '/sessions [N] — last N sessions (default 5, max 20)',
      '/leads — sessions you marked as leads',
      '',
      '<b>Find</b>',
      '/find &lt;ip&gt; — find sessions by IP',
      '/session &lt;id&gt; — show one session in detail',
      '',
      '<b>Ask AI</b>',
      '/ask &lt;question&gt; — ask anything about your sessions',
      '   <i>e.g., /ask which city brings the most engaged visitors today?</i>',
      '',
      '<b>Tip:</b> tap any button below for one-click actions.',
    ].join('\n');
    return { text, keyboard: suggestKb([
      { text: '📊 Today\'s stats', cmd: 'today' },
      { text: '🟢 Active now', cmd: 'active' },
      { text: '👥 Last visitors', cmd: 'visitors' },
      { text: '🎯 Leads', cmd: 'leads' },
    ]) };
  },

  async start() { return COMMANDS.help(''); },

  async today() {
    const s = getTodayStats();
    const lines = [
      '<b>📊 Today (Vietnam time)</b>',
      `👥 Visitors: <b>${s.visitors}</b>`,
      `🎬 Actions tracked: <b>${s.actions}</b>`,
      `🎯 Marked as leads: <b>${s.leads}</b>`,
      `🟢 Active now (last 15 min): <b>${s.activeNow}</b>`,
      `📈 All-time visitors (since cold start): <b>${s.allTime}</b>`,
    ];
    if (s.topCities.length) {
      lines.push('', '<b>Top cities today</b>');
      s.topCities.forEach(([c, n]) => lines.push(`  • ${esc(c)} — ${n}`));
    }
    return { text: lines.join('\n'), keyboard: suggestKb([
      { text: '🟢 Active now', cmd: 'active' },
      { text: '👥 Last visitors', cmd: 'visitors' },
      { text: '🎯 Leads', cmd: 'leads' },
      { text: '🤖 Ask AI', cmd: 'ask top engaged visitor today' },
    ]) };
  },

  async active() {
    const sessions = getActiveSessions();
    if (!sessions.length) return { text: '🌙 No active sessions in the last 15 min.', keyboard: suggestKb([{ text: '📊 Today', cmd: 'today' }]) };
    const text = [`<b>🟢 Active sessions (${sessions.length})</b>`, '']
      .concat(sessions.map(fmtSessionLine)).join('\n\n');
    return { text, keyboard: suggestKb([{ text: '📊 Today', cmd: 'today' }, { text: '👥 Last visitors', cmd: 'visitors' }]) };
  },

  async visitors() {
    const sessions = getSessions(10);
    if (!sessions.length) return { text: 'No sessions yet.' };
    const text = ['<b>👥 Last 10 visitors</b>', ''].concat(sessions.map(fmtSessionLine)).join('\n\n');
    return { text, keyboard: suggestKb([{ text: '📊 Today', cmd: 'today' }, { text: '🟢 Active', cmd: 'active' }]) };
  },

  async sessions(args) {
    let n = parseInt(args, 10) || 5;
    if (n > 20) n = 20;
    const sessions = getSessions(n);
    if (!sessions.length) return { text: 'No sessions yet.' };
    const text = [`<b>👥 Last ${n} sessions</b>`, ''].concat(sessions.map(fmtSessionLine)).join('\n\n');
    return { text, keyboard: suggestKb([{ text: '📊 Today', cmd: 'today' }]) };
  },

  async leads() {
    const sessions = getLeadSessions();
    if (!sessions.length) return { text: '🎯 No leads marked yet. Tap "🎯 Mark lead" on any visit notification.', keyboard: suggestKb([{ text: '👥 Last visitors', cmd: 'visitors' }]) };
    const text = [`<b>🎯 Marked leads (${sessions.length})</b>`, ''].concat(sessions.map(fmtSessionLine)).join('\n\n');
    return { text };
  },

  async stats() {
    const s = getTodayStats();
    const all = getSessions(200);
    const cities = new Map<string, number>();
    const devices = new Map<string, number>();
    const browsers = new Map<string, number>();
    for (const x of all) {
      if (x.city) cities.set(x.city, (cities.get(x.city) || 0) + 1);
      if (x.device) devices.set(x.device, (devices.get(x.device) || 0) + 1);
      if (x.browser) browsers.set(x.browser, (browsers.get(x.browser) || 0) + 1);
    }
    const topN = (m: Map<string, number>, n = 5) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n);
    const fmtTop = (m: Map<string, number>) => topN(m).map(([k, v]) => `  • ${esc(k)} — ${v}`).join('\n') || '  (none)';
    return {
      text: [
        '<b>📈 Aggregate stats</b>',
        `Today: <b>${s.visitors}</b> visitors • <b>${s.actions}</b> actions • <b>${s.leads}</b> leads • <b>${s.activeNow}</b> active`,
        `All sessions in memory: <b>${all.length}</b>`,
        '',
        '<b>Top cities</b>',
        fmtTop(cities),
        '',
        '<b>Devices</b>',
        fmtTop(devices),
        '',
        '<b>Browsers</b>',
        fmtTop(browsers),
      ].join('\n'),
      keyboard: suggestKb([{ text: '📊 Today', cmd: 'today' }, { text: '🤖 Ask AI', cmd: 'ask what is unusual in todays traffic?' }]),
    };
  },

  async find(args) {
    if (!args.trim()) return { text: 'Usage: /find &lt;ip or partial ip&gt;' };
    const sessions = findSessionsByIp(args.trim());
    if (!sessions.length) return { text: `No sessions found for IP <code>${esc(args)}</code>` };
    const text = [`<b>Found ${sessions.length} sessions matching ${esc(args)}</b>`, ''].concat(sessions.map(fmtSessionLine)).join('\n\n');
    return { text };
  },

  async session(args) {
    const id = args.trim();
    if (!id) return { text: 'Usage: /session &lt;sessionId&gt;' };
    // Allow short id (last 6 chars) or full
    const all = getSessions(200);
    const rec = all.find(s => s.sessionId === id || s.sessionId.endsWith(id));
    if (!rec) return { text: `Session not found: <code>${esc(id)}</code>` };
    const lines = [
      `<b>🔍 Session ${esc(rec.sessionId)}</b>`,
      `🌍 ${esc([rec.city, rec.region, rec.country].filter(Boolean).join(', '))}`,
      `📡 <code>${esc(rec.ip)}</code> • ${esc(rec.isp || '?')}`,
      `${rec.device === 'Mobile' ? '📱' : '🖥️'} ${esc(rec.device || '?')} • ${esc(rec.os || '?')} • ${esc(rec.browser || '?')}`,
      `🕐 Started ${fmtTimeAgo(rec.startTs)}${rec.endTs ? ` • ended ${fmtTimeAgo(rec.endTs)}` : ' • <i>active</i>'}`,
      rec.durationMs ? `⏱️ Duration: ${fmtDuration(rec.durationMs)}` : '',
      rec.maxScroll != null ? `📜 Scroll: ${rec.maxScroll}%` : '',
      rec.clickCount != null ? `🖱️ Clicks: ${rec.clickCount}` : '',
      `🔗 Referrer: ${esc(rec.referrer || 'direct')}`,
      `📄 Landing: ${esc(rec.landing || '/')}`,
      rec.pages?.length ? `📑 Pages (${rec.pages.length}):\n${rec.pages.slice(0, 10).map(p => `  • ${esc(p)}`).join('\n')}` : '',
      rec.actions.length ? `\n<b>🎬 Actions (${rec.actions.length})</b>\n${rec.actions.slice(0, 15).map(a => `  • ${esc(a.label)}${a.extra ? ` — ${esc(a.extra)}` : ''}`).join('\n')}` : '',
    ].filter(Boolean).join('\n');
    return { text: lines };
  },

  async ask(args) {
    const q = args.trim();
    if (!q) return { text: 'Usage: /ask &lt;your question&gt;\nExample: /ask what city brought the most engaged visitor today?' };
    if (!GEMINI_KEY) return { text: '⚠️ GEMINI_API_KEY not set in Vercel env vars.' };

    // Build session context for the AI
    const today = getSessions(50).filter(s => s.startTs > Date.now() - 24 * 3600 * 1000);
    const compactSessions = today.slice(0, 30).map(s => ({
      id: s.sessionId.slice(-6),
      city: s.city, country: s.country, isp: s.isp,
      device: s.device, browser: s.browser, os: s.os,
      visitorNum: s.visitorNum,
      ago: Math.round((Date.now() - s.startTs) / 60000) + 'm',
      duration: s.durationMs ? Math.round(s.durationMs / 1000) + 's' : 'active',
      pages: s.pages?.length || 0,
      scroll: s.maxScroll,
      clicks: s.clickCount,
      landing: s.landing,
      referrer: s.referrer,
      visit_count: s.visitCount,
      actions: s.actions.map(a => a.label),
    }));
    const stats = getTodayStats();

    const systemPrompt = `You are an analytics assistant for a Google Ads consulting website. Answer the user's question concisely (2-5 short bullets max) using the session data provided. Be specific — name actual cities, IPs, session IDs, browsers, etc. Skip preambles. If the data doesn't answer, say so honestly.`;
    const userMsg = `Today's stats:\n${JSON.stringify(stats)}\n\nLast ${compactSessions.length} sessions today:\n${JSON.stringify(compactSessions, null, 0)}\n\nQuestion: ${q}`;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userMsg }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 600 },
        }),
      });
      if (!r.ok) {
        // Try fallback model
        const r2 = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userMsg }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 600 },
          }),
        });
        if (!r2.ok) return { text: `🚨 AI error ${r.status}. Try again later.` };
        const d2 = await r2.json();
        const reply2 = d2?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '(no answer)';
        return { text: `🤖 <b>${esc(q.slice(0, 80))}</b>\n\n${esc(reply2)}` };
      }
      const data = await r.json();
      const reply = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '(no answer)';
      return {
        text: `🤖 <b>${esc(q.slice(0, 80))}</b>\n\n${esc(reply)}`,
        keyboard: suggestKb([
          { text: '📊 Today', cmd: 'today' },
          { text: '👥 Visitors', cmd: 'visitors' },
          { text: '🤖 Ask another', cmd: 'ask what should I focus on next?' },
        ]),
      };
    } catch (e: any) {
      return { text: `🚨 AI error: ${esc(e?.message || e)}` };
    }
  },
};

// Aliases
COMMANDS.h = COMMANDS.help;
COMMANDS.s = COMMANDS.sessions;
COMMANDS.v = COMMANDS.visitors;
COMMANDS.a = COMMANDS.active;
COMMANDS.t = COMMANDS.today;
COMMANDS.l = COMMANDS.leads;

async function handleCommand(text: string): Promise<{ text: string; keyboard?: any }> {
  // Strip leading slash and bot mention
  const cleaned = text.replace(/^\//, '').replace(/^([a-z_]+)@\w+/i, '$1');
  const [cmd, ...rest] = cleaned.split(/\s+/);
  const args = rest.join(' ');
  const handler = COMMANDS[cmd.toLowerCase()];
  if (!handler) {
    return { text: `Unknown command: <code>/${esc(cmd)}</code>\nSend /help to see all commands.` };
  }
  return handler(args);
}

export const POST: APIRoute = async ({ request }) => {
  let update: any = {};
  try { update = await request.json(); } catch { return new Response('bad', { status: 400 }); }

  // ── Inline keyboard callback (Mark lead / Block / Info / Suggested cmds) ──
  const cb = update.callback_query;
  if (cb) {
    const data: string = cb.data || '';
    const [action, ...rest] = data.split(':');
    const arg = rest.join(':');
    const chatId = cb.message?.chat?.id;
    const messageId = cb.message?.message_id;

    // Suggested-command button
    if (action === 'cmd' && arg) {
      await tgApi('answerCallbackQuery', { callback_query_id: cb.id });
      const result = await handleCommand('/' + arg);
      await tgApi('sendMessage', {
        chat_id: chatId, text: result.text, parse_mode: 'HTML',
        reply_markup: result.keyboard, disable_web_page_preview: true,
      });
      return new Response(JSON.stringify({ ok: true }));
    }

    // Existing visit-notification buttons (lead/block/info)
    let answerText = 'OK';
    if (action === 'lead' && arg) { markLead(arg); answerText = `🎯 ${arg} marked as lead`; }
    else if (action === 'block' && arg) { blockIp(arg); answerText = `🚫 ${arg} blocked`; }
    else if (action === 'info' && arg) {
      try {
        const r = await fetch(`http://ip-api.com/json/${arg}?fields=country,regionName,city,isp,org,as,reverse,mobile,proxy,hosting`);
        const j = await r.json();
        answerText = `${j.city || '?'}, ${j.country || '?'} • ${j.isp || '?'} • mobile=${j.mobile} proxy=${j.proxy} hosting=${j.hosting}`;
      } catch { answerText = 'Lookup failed'; }
    }
    await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: answerText.slice(0, 200), show_alert: action === 'info' });
    if (chatId && messageId && action !== 'info') {
      const original = cb.message.text || '';
      await tgApi('editMessageText', {
        chat_id: chatId, message_id: messageId,
        text: original + `\n\n✅ ${answerText}`,
        parse_mode: 'HTML',
      });
    }
    return new Response(JSON.stringify({ ok: true }));
  }

  // ── Plain message: check for slash command ──
  const msg = update.message || update.channel_post;
  if (msg && typeof msg.text === 'string') {
    const text = msg.text.trim();
    if (text.startsWith('/')) {
      const result = await handleCommand(text);
      await tgApi('sendMessage', {
        chat_id: msg.chat.id, text: result.text, parse_mode: 'HTML',
        reply_markup: result.keyboard, disable_web_page_preview: true,
      });
    }
    return new Response(JSON.stringify({ ok: true }));
  }

  return new Response(JSON.stringify({ ok: true }));
};
