import type { APIRoute } from 'astro';
import { checkAndConsume, LIMITS } from '../../lib/state';

export const prerender = false;

const GEMINI_KEY = import.meta.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const MODEL = 'gemini-2.0-flash';

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
    return new Response(JSON.stringify({
      error: 'GEMINI_API_KEY not set',
      reply: "I'm not configured yet — please set GEMINI_API_KEY in Vercel environment variables."
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
      return new Response(JSON.stringify({
        error: `gemini ${r.status}`,
        reply: "I'm having trouble reaching the AI right now. Please try again in a moment."
      }), { status: 500, headers: { 'content-type': 'application/json' } });
    }

    const data = await r.json();
    const reply = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || "Sorry, I didn't catch that — could you rephrase?";

    return new Response(JSON.stringify({ ok: true, reply }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e: any) {
    console.warn('[chat-solve]', e);
    return new Response(JSON.stringify({
      error: String(e?.message || e),
      reply: "Connection error. Please try again."
    }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
};
