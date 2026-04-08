import type { APIRoute } from 'astro';
import { checkAndConsume, LIMITS } from '../../lib/state';

export const prerender = false;

const GEMINI_KEY = import.meta.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const PRIMARY_MODEL = 'gemini-2.5-flash';
const FALLBACK_MODEL = 'gemini-2.5-flash-lite';
const TG_TOKEN = import.meta.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT  = import.meta.env.TELEGRAM_CHAT_ID   || process.env.TELEGRAM_CHAT_ID;

async function reportError(label: string, detail: string) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT,
        text: `🚨 <b>Personalize error: ${label}</b>\n<pre>${detail.slice(0, 1500).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))}</pre>`,
        parse_mode: 'HTML', disable_notification: true,
      }),
    });
  } catch {}
}

const SYSTEM = `You personalize Google Ads recommendations for Vietnamese SMBs.

STRICT LENGTH RULES (do not violate):
- Each "why" field: ONE sentence, maximum 22 words. Direct and specific. No fluff.
- "intro" field: ONE short sentence, maximum 20 words.
- "insight" field: ONE short sentence, maximum 22 words.

CONTENT RULES:
- Reference the user's industry, city, persona, product, or competitors by name when natural.
- Always reply in English regardless of input language.
- No generic platitudes ("this is a great choice"). Be concrete.
- No "As a..." preambles. Get straight to the value.

Reply ONLY in valid JSON, no markdown fences, no preamble:
{
  "intro": "...",
  "solutions": [
    { "key": "<solution_key>", "why": "..." },
    { "key": "<solution_key>", "why": "..." },
    { "key": "<solution_key>", "why": "..." }
  ],
  "insight": "..."
}`;

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!GEMINI_KEY) {
    await reportError('GEMINI_API_KEY missing', 'Cannot personalize.');
    return new Response(JSON.stringify({ ok: false, fallback: true }), { status: 500 });
  }

  const ip = (request.headers.get('x-forwarded-for') || clientAddress || 'unknown').split(',')[0].trim();
  const rl = checkAndConsume(ip);
  if (!rl.ok) {
    return new Response(JSON.stringify({ ok: false, rateLimited: true, reason: rl.reason, fallback: true }), {
      status: 429, headers: { 'content-type': 'application/json' },
    });
  }

  let body: any = {};
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: 'bad json', fallback: true }), { status: 400 });
  }

  const ctx = {
    intent: body.intent || '',
    city: body.cityName || '',
    industry: body.industryName || '',
    persona: body.persona || '',
    product: body.product || '',
    competitors: body.competitors || '',
    marketData: body.marketData || null,
    pickedKeys: Array.isArray(body.pickedKeys) ? body.pickedKeys : [],
    catalogHints: body.catalogHints || {},
    refinedBudget: body.refinedBudget || '',
    refinedGoal: body.refinedGoal || '',
    refinedValue: body.refinedValue || '',
  };

  const refinedBlock = (ctx.refinedBudget || ctx.refinedGoal || ctx.refinedValue)
    ? `\nRefined inputs the user gave us (USE THESE — reference budget/goal/value explicitly in your reasoning):
- Monthly budget: ${ctx.refinedBudget || '(not specified)'}
- Primary conversion goal: ${ctx.refinedGoal || '(not specified)'}
- Average customer value / order: ${ctx.refinedValue || '(not specified)'}`
    : '';

  const userMsg = `Business context:
- Initial intent: ${ctx.intent}
- City: ${ctx.city}
- Industry: ${ctx.industry}
- Target customer: ${ctx.persona}
- Product/business: ${ctx.product}
- Competitors: ${ctx.competitors || '(none specified)'}
- Market data: TAM ${ctx.marketData?.tam || '?'}, SAM ${ctx.marketData?.sam || '?'}, growth ${ctx.marketData?.growth || '?'}, reachable ${ctx.marketData?.reach || '?'}${refinedBlock}

The 3 picked Google Ads solution keys (in priority order): ${ctx.pickedKeys.join(', ')}

Solution names (for reference):
${Object.entries(ctx.catalogHints).map(([k, v]: any) => `- ${k}: ${v}`).join('\n')}

Now write the personalized JSON response. If refined inputs are present, your "why" sentences MUST reference the budget tier, goal type, and customer value where relevant — that's the whole point of personalization.`;

  async function callModel(modelName: string) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_KEY}`;
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: userMsg }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 2000, responseMimeType: 'application/json' },
      }),
    });
  }

  // Robust JSON extractor — handles truncated responses by closing open strings/brackets
  function tryParseJson(raw: string): any | null {
    if (!raw) return null;
    // Strip code fences if Gemini wrapped output
    raw = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { return JSON.parse(raw); } catch {}
    // Attempt repair: close trailing string + brackets
    try {
      let s = raw;
      // Count unescaped quotes — if odd, close the string
      let inStr = false, esc = false;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') inStr = !inStr;
      }
      if (inStr) s += '"';
      // Balance braces and brackets
      const opens: string[] = [];
      let inS = false; esc = false;
      for (const ch of s) {
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') { inS = !inS; continue; }
        if (inS) continue;
        if (ch === '{' || ch === '[') opens.push(ch);
        if (ch === '}') { if (opens[opens.length - 1] === '{') opens.pop(); }
        if (ch === ']') { if (opens[opens.length - 1] === '[') opens.pop(); }
      }
      while (opens.length) {
        const o = opens.pop();
        s += o === '{' ? '}' : ']';
      }
      return JSON.parse(s);
    } catch { return null; }
  }

  try {
    let r = await callModel(PRIMARY_MODEL);
    if (!r.ok && [429, 500, 503].includes(r.status)) {
      console.warn('[personalize] primary failed', r.status, '— fallback');
      r = await callModel(FALLBACK_MODEL);
    }
    if (!r.ok) {
      const txt = await r.text();
      await reportError(`Gemini ${r.status}`, `personalize\ntried=${PRIMARY_MODEL},${FALLBACK_MODEL}\nip=${ip}\n${txt}`);
      return new Response(JSON.stringify({ ok: false, fallback: true }), { status: 500 });
    }

    const data = await r.json();
    const raw = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
    const parsed = tryParseJson(raw);
    if (!parsed) {
      await reportError('JSON parse failed', `raw=${raw.slice(0, 800)}`);
      return new Response(JSON.stringify({ ok: false, fallback: true }), { status: 500 });
    }
    // Sanity-check shape
    if (!parsed.solutions || !Array.isArray(parsed.solutions)) {
      await reportError('JSON shape invalid', `raw=${raw.slice(0, 600)}`);
      return new Response(JSON.stringify({ ok: false, fallback: true }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true, ...parsed }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e: any) {
    await reportError('exception', `ip=${ip}\n${String(e?.message || e)}`);
    return new Response(JSON.stringify({ ok: false, fallback: true }), { status: 500 });
  }
};
