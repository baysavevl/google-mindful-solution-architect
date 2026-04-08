// In-memory shared state across API routes within the same serverless function instance.
// NOTE: cold starts reset all state. For production durability, swap for Vercel KV / Upstash Redis.

function todayKey(): string {
  // Vietnam day boundary
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

// ── Rate limiting (Gemini) ───────────────────────────────────────────
interface RateState { date: string; global: number; perIp: Map<string, number>; }
let rate: RateState = { date: todayKey(), global: 0, perIp: new Map() };

function rollIfNewDay() {
  const k = todayKey();
  if (rate.date !== k) rate = { date: k, global: 0, perIp: new Map() };
}

export const LIMITS = { perSession: 5, perUser: 10, global: 20 };

export function checkAndConsume(ip: string): { ok: true } | { ok: false; reason: 'global' | 'user'; remaining: { user: number; global: number } } {
  rollIfNewDay();
  if (rate.global >= LIMITS.global) return { ok: false, reason: 'global', remaining: { user: Math.max(0, LIMITS.perUser - (rate.perIp.get(ip) || 0)), global: 0 } };
  const used = rate.perIp.get(ip) || 0;
  if (used >= LIMITS.perUser) return { ok: false, reason: 'user', remaining: { user: 0, global: LIMITS.global - rate.global } };
  rate.global += 1;
  rate.perIp.set(ip, used + 1);
  return { ok: true };
}

export function rateSnapshot() {
  rollIfNewDay();
  return { date: rate.date, global: rate.global, uniqueIps: rate.perIp.size };
}

// ── Blocklist (from Telegram inline button) ──────────────────────────
const blocked = new Set<string>();
export function blockIp(ip: string) { blocked.add(ip); }
export function isBlocked(ip: string) { return blocked.has(ip); }

// ── Marked-as-lead IPs (just for display in /api/tg-find-chat) ───────
const leads = new Set<string>();
export function markLead(ip: string) { leads.add(ip); }
export function isLead(ip: string) { return leads.has(ip); }

// ── Visitor counter (per-day + all-time within instance) ──────────────
let visitorDayKey = todayKey();
let visitorDayCount = 0;
let visitorTotalCount = 0;
const seenVisitorSessions = new Set<string>();

export function nextVisitorNumber(sessionId: string): { today: number; total: number } {
  const k = todayKey();
  if (k !== visitorDayKey) {
    visitorDayKey = k;
    visitorDayCount = 0;
    seenVisitorSessions.clear();
  }
  if (sessionId && !seenVisitorSessions.has(sessionId)) {
    seenVisitorSessions.add(sessionId);
    visitorDayCount += 1;
    visitorTotalCount += 1;
  }
  return { today: visitorDayCount, total: visitorTotalCount };
}
