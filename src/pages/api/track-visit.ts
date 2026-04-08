import type { APIRoute } from 'astro';
import { isBlocked, nextVisitorNumber, recordSession, endSession, recordAction } from '../../lib/state';

export const prerender = false;

const TG_TOKEN = import.meta.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT  = import.meta.env.TELEGRAM_CHAT_ID   || process.env.TELEGRAM_CHAT_ID;

interface IPInfo {
  country?: string; regionName?: string; city?: string;
  zip?: string; lat?: number; lon?: number;
  timezone?: string; isp?: string; org?: string; as?: string;
  query?: string;
}

async function lookupIP(ip: string): Promise<IPInfo> {
  if (!ip || ip === '127.0.0.1' || ip.startsWith('::1')) return { city: 'localhost' };
  try {
    const r = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,regionName,city,zip,lat,lon,timezone,isp,org,as,query`);
    if (!r.ok) return {};
    return await r.json();
  } catch { return {}; }
}

// Vietnam local hour (Asia/Ho_Chi_Minh = UTC+7)
function vnHour(): number {
  return new Date(Date.now() + 7 * 3600 * 1000).getUTCHours();
}
function isQuietHour(): boolean {
  const h = vnHour();
  return h >= 23 || h < 7;
}

async function tg(text: string, opts: { silent?: boolean; ip?: string } = {}) {
  if (!TG_TOKEN || !TG_CHAT) {
    console.warn('[track-visit] Telegram env vars not set');
    return;
  }
  const body: any = {
    chat_id: TG_CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true,
    disable_notification: opts.silent || isQuietHour(),
  };
  if (opts.ip) {
    body.reply_markup = {
      inline_keyboard: [[
        { text: '🎯 Mark lead', callback_data: `lead:${opts.ip}` },
        { text: '👁 Info',      callback_data: `info:${opts.ip}` },
        { text: '🚫 Block',     callback_data: `block:${opts.ip}` },
      ]],
    };
  }
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) { console.warn('[tg]', e); }
}

function esc(s: any): string {
  return String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  return `${m}m ${r}s`;
}

// Engagement score: weighted blend of duration, scroll, clicks
function engagementScore(durationMs: number, maxScroll: number, clicks: number): { score: number; label: string } {
  const dMin = durationMs / 60000;
  const dur = Math.min(1, dMin / 3);          // cap at 3 min
  const scr = Math.min(1, (maxScroll || 0) / 100);
  const clk = Math.min(1, (clicks || 0) / 8); // cap at 8 clicks
  const score = Math.round((dur * 0.4 + scr * 0.3 + clk * 0.3) * 100);
  const label = score >= 75 ? '🔥 Hot' : score >= 45 ? '✨ Warm' : score >= 20 ? '🌱 Cool' : '🧊 Bounce';
  return { score, label };
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  let body: any = {};
  try { body = await request.json(); } catch {}

  const event = body.event as 'start' | 'end';
  const ip = (request.headers.get('x-forwarded-for') || clientAddress || '').split(',')[0].trim();

  if (isBlocked(ip)) {
    return new Response(JSON.stringify({ ok: true, blocked: true }), { headers: { 'content-type': 'application/json' } });
  }

  const ua = request.headers.get('user-agent') || '';
  const ref = body.referrer || request.headers.get('referer') || '';
  const lang = body.language || request.headers.get('accept-language')?.split(',')[0] || '';

  if (event === 'start') {
    const info = await lookupIP(ip);
    const sessionId = body.sessionId || ('s_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
    const visitorNum = nextVisitorNumber(sessionId);

    const isMobileDev = /Mobi|Android|iPhone|iPad/i.test(ua);
    const osName = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown';
    const browserName = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Other';

    recordSession({
      sessionId, ip,
      visitorNum: visitorNum.today,
      startTs: Date.now(),
      city: info.city, region: info.regionName, country: info.country,
      isp: info.isp || info.org,
      device: isMobileDev ? 'Mobile' : 'Desktop',
      os: osName, browser: browserName,
      language: lang,
      referrer: ref, landing: body.landing,
      visitCount: Number(body.visitCount) || 1,
      utm: body.utm || {},
      actions: [],
    });

    const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua);
    const device = isMobile ? '📱 Mobile' : '🖥️ Desktop';
    const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown';
    const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Other';

    const utm = body.utm || {};
    const utmLines = Object.entries(utm).filter(([, v]) => v).map(([k, v]) => `  • ${esc(k)}: <code>${esc(v)}</code>`).join('\n');

    // Returning visitor (client-tracked count)
    const visitNum = Number(body.visitCount) || 1;
    const visitTag = visitNum > 1 ? `🔄 <b>Returning visitor</b> (visit #${visitNum})` : '✨ <b>First-time visitor</b>';

    const msg = [
      `🟢 <b>New visit started</b>  •  <b>#${visitorNum.today}</b> today  •  #${visitorNum.total} all-time`,
      visitTag,
      `🕐 ${esc(new Date().toLocaleString('en-US', { timeZone: info.timezone || 'Asia/Ho_Chi_Minh' }))}`,
      `🌍 ${esc(info.city || '?')}, ${esc(info.regionName || '')}, ${esc(info.country || '')}`,
      `📡 <code>${esc(info.query || ip)}</code>`,
      `🏢 ${esc(info.isp || '?')} ${info.org && info.org !== info.isp ? `/ ${esc(info.org)}` : ''}`,
      `🕓 ${esc(info.timezone || '?')}`,
      `${device}  •  ${esc(os)}  •  ${esc(browser)}`,
      `📐 ${esc(body.screen || '?')}  •  🗣️ ${esc(lang)}`,
      `🔗 <b>Referrer:</b> ${esc(ref || 'direct')}`,
      `📄 <b>Landing:</b> ${esc(body.landing || '/')}`,
      utmLines ? `🏷️ <b>UTM:</b>\n${utmLines}` : '',
      `🆔 <code>${esc(sessionId)}</code>`,
      isQuietHour() ? '🌙 <i>quiet hours — silent</i>' : '',
    ].filter(Boolean).join('\n');

    await tg(msg, { ip });
    return new Response(JSON.stringify({ ok: true, sessionId }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  if (event === 'action') {
    const label = String(body.label || 'action').slice(0, 80);
    const extra = String(body.extra || '').slice(0, 200);
    const sid = String(body.sessionId || '').slice(0, 20);
    recordAction(sid, label, extra);
    const msg = `🎬 <code>${esc(sid || '?')}</code>  <b>${esc(label)}</b>${extra ? `\n   ↳ ${esc(extra)}` : ''}`;
    await tg(msg, { silent: true });
    return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
  }

  if (event === 'end') {
    const dur = Number(body.durationMs) || 0;
    const pages: string[] = body.pages || [];
    const maxScroll = Number(body.maxScroll) || 0;
    const clicks = Number(body.clickCount) || 0;
    const firstClick = body.firstClick || null;
    const lastClick = body.lastClick || null;
    const eng = engagementScore(dur, maxScroll, clicks);
    endSession(String(body.sessionId || ''), { durationMs: dur, pages, maxScroll, clickCount: clicks });

    const msg = [
      `🔴 <b>Session ended</b>`,
      `🆔 <code>${esc(body.sessionId || '?')}</code>`,
      `${eng.label} <b>Engagement: ${eng.score}/100</b>`,
      `⏱️ ${esc(fmtDuration(dur))}  •  📜 scroll ${maxScroll}%  •  🖱️ ${clicks} clicks`,
      firstClick ? `   ↳ first: ${esc(firstClick)}` : '',
      lastClick && lastClick !== firstClick ? `   ↳ last: ${esc(lastClick)}` : '',
      `📑 <b>Pages (${pages.length}):</b>`,
      ...pages.slice(0, 20).map(p => `  • ${esc(p)}`),
    ].filter(Boolean).join('\n');
    await tg(msg);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'unknown event' }), { status: 400 });
};
