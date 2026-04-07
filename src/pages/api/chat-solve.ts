import type { APIRoute } from 'astro';
import { checkAndConsume, LIMITS } from '../../lib/state';

export const prerender = false;

const GEMINI_KEY = import.meta.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const MODEL = 'gemini-2.0-flash';
const TG_TOKEN = import.meta.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT  = import.meta.env.TELEGRAM_CHAT_ID   || process.env.TELEGRAM_CHAT_ID;

async function reportError(label: string, detail: string) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT,
        text: `🚨 <b>AI error: ${label}</b>\n<pre>${detail.slice(0, 1500).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))}</pre>`,
        parse_mode: 'HTML',
        disable_notification: true,
      }),
    });
  } catch {}
}

const SYSTEM_PROMPT = `You are the "Solve Your Problems" co-pilot for Vietnamese small/medium businesses using Google Ads.

PRIMARY GOAL: Help users articulate their REAL business problem in their OWN language (Vietnamese, English, or mixed). Never assume — always ask follow-up questions to deep-dive.

CONVERSATION RULES:
1. Detect the user's language from their first message and respond ENTIRELY in that language. Vietnamese users get Vietnamese replies. Mix is OK.
2. Be warm, concise, and concrete. Maximum 3-4 sentences per turn unless presenting a solution.
3. Ask ONE focused question at a time. Never bombard.
4. When the user provides market data (TAM/SAM/city/industry/persona) in the system context, REFERENCE it in your reasoning.
5. After enough context (usually 3-5 turns), produce a "Suggested Google Ads playbook" with: campaign type, targeting, budget range (USD/VND), KPI to watch, and first action.
6. If user is vague, gently probe: "What does success look like for you?" / "Bạn muốn đạt được gì cụ thể trong 3 tháng tới?"
7. NEVER invent specific numbers — if you don't know, say so and recommend testing.
8. End every solution with: "Would you like me to connect you with a real Google Ads specialist?" (translated).

CONTEXT STAGES the conversation flows through (you'll see [STAGE: ...] hints in user messages — adapt accordingly):
- discovery: understand business, product, goal
- market: city/industry chosen, TAM/SAM available
- persona: target customer described
- solution: deliver the playbook
- handoff: offer lead capture form

Stay focused. No preamble. No "As an AI..." disclaimers.`;

interface ChatTurn { role: 'user' | 'model'; text: string; }

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!GEMINI_KEY) {
    await reportError('GEMINI_API_KEY missing', 'No GEMINI_API_KEY env var set in Vercel. Add it and redeploy.');
    return new Response(JSON.stringify({
      error: 'GEMINI_API_KEY not set',
      reply: "AI is not configured yet — the site owner has been notified. Please leave your contact in the form below."
    }), { status: 500, headers: { 'content-type': 'application/json' } });
  }

  // Rate limit: per-IP and global daily caps. (Per-session limit is enforced client-side.)
  const ip = (request.headers.get('x-forwarded-for') || clientAddress || 'unknown').split(',')[0].trim();
  const rl = checkAndConsume(ip);
  if (!rl.ok) {
    const reply = rl.reason === 'global'
      ? `🛑 Daily site-wide AI limit reached (${LIMITS.global}/day). Please come back tomorrow — or fill the contact form below to talk to a real specialist.`
      : `🛑 You've used your daily AI quota (${LIMITS.perUser}/day). Come back tomorrow, or fill the contact form to reach a specialist.`;
    return new Response(JSON.stringify({ ok: false, rateLimited: true, reason: rl.reason, reply }), {
      status: 429, headers: { 'content-type': 'application/json' },
    });
  }

  let body: any = {};
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'bad json' }), { status: 400 });
  }

  const history: ChatTurn[] = Array.isArray(body.history) ? body.history : [];
  const contextHint = body.contextHint || '';

  // Build Gemini-format contents
  const contents = history.map(t => ({
    role: t.role,
    parts: [{ text: t.text }],
  }));

  // Prepend context hint to last user message
  if (contextHint && contents.length && contents[contents.length - 1].role === 'user') {
    const last = contents[contents.length - 1];
    last.parts[0].text = `[STAGE/CONTEXT: ${contextHint}]\n\n${last.parts[0].text}`;
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 600,
          topP: 0.95,
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
        ],
      }),
    });

    if (!r.ok) {
      const txt = await r.text();
      console.warn('[gemini]', r.status, txt);
      await reportError(`Gemini ${r.status}`, `model=${MODEL}\nip=${ip}\n${txt}`);
      return new Response(JSON.stringify({
        error: `gemini ${r.status}`,
        reply: "I'm having trouble reaching the AI right now. Please try again in a moment, or leave your contact in the form below."
      }), { status: 500, headers: { 'content-type': 'application/json' } });
    }

    const data = await r.json();
    const reply = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || "Sorry, I didn't catch that — could you rephrase?";
    if (!data?.candidates?.[0]?.content?.parts) {
      await reportError('Gemini empty reply', `model=${MODEL}\nip=${ip}\n${JSON.stringify(data).slice(0, 800)}`);
    }

    return new Response(JSON.stringify({ ok: true, reply }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e: any) {
    console.warn('[chat-solve]', e);
    await reportError('chat-solve exception', `ip=${ip}\n${String(e?.message || e)}\n${e?.stack || ''}`);
    return new Response(JSON.stringify({
      error: String(e?.message || e),
      reply: "Connection error. Please try again."
    }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
};
