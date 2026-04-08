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

// ── Session log (last 200 sessions in memory) ─────────────────────────
export interface SessionRecord {
  sessionId: string;
  ip: string;
  visitorNum?: number;
  startTs: number;
  endTs?: number;
  city?: string;
  region?: string;
  country?: string;
  isp?: string;
  device?: string;
  browser?: string;
  os?: string;
  language?: string;
  referrer?: string;
  landing?: string;
  pages?: string[];
  durationMs?: number;
  maxScroll?: number;
  clickCount?: number;
  visitCount?: number;
  utm?: Record<string, string>;
  actions: { ts: number; label: string; extra?: string }[];
}
const SESSION_LIMIT = 200;
const sessionList: SessionRecord[] = []; // newest first
const sessionMap = new Map<string, SessionRecord>();

export function recordSession(rec: SessionRecord) {
  if (sessionMap.has(rec.sessionId)) return;
  sessionList.unshift(rec);
  sessionMap.set(rec.sessionId, rec);
  while (sessionList.length > SESSION_LIMIT) {
    const old = sessionList.pop()!;
    sessionMap.delete(old.sessionId);
  }
}

export function endSession(sessionId: string, data: Partial<SessionRecord>) {
  const rec = sessionMap.get(sessionId);
  if (!rec) return;
  Object.assign(rec, data, { endTs: Date.now() });
}

export function recordAction(sessionId: string, label: string, extra?: string) {
  const rec = sessionMap.get(sessionId);
  if (rec) {
    rec.actions.push({ ts: Date.now(), label, extra });
  }
}

export function getSessions(limit = 10): SessionRecord[] {
  return sessionList.slice(0, limit);
}

export function getSessionById(id: string): SessionRecord | undefined {
  return sessionMap.get(id);
}

export function findSessionsByIp(ip: string): SessionRecord[] {
  return sessionList.filter(s => s.ip === ip || s.ip.includes(ip));
}

// VN day start (Asia/Ho_Chi_Minh, UTC+7)
function vnDayStartMs(): number {
  const offset = 7 * 3600 * 1000;
  const nowVN = Date.now() + offset;
  const dayStartVN = nowVN - (nowVN % (24 * 3600 * 1000));
  return dayStartVN - offset;
}

export function getActiveSessions(withinMs = 15 * 60 * 1000): SessionRecord[] {
  const now = Date.now();
  return sessionList.filter(s => !s.endTs && now - s.startTs < withinMs);
}

export function getTodaySessions(): SessionRecord[] {
  const ds = vnDayStartMs();
  return sessionList.filter(s => s.startTs >= ds);
}

export function getTodayStats() {
  const today = getTodaySessions();
  const visitors = today.length;
  const actions = today.reduce((sum, s) => sum + s.actions.length, 0);
  const leads = today.filter(s => isLead(s.ip)).length;
  const activeNow = getActiveSessions().length;
  const cities = new Map<string, number>();
  for (const s of today) {
    if (s.city) cities.set(s.city, (cities.get(s.city) || 0) + 1);
  }
  const topCities = Array.from(cities.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return { visitors, actions, leads, activeNow, topCities, allTime: visitorTotalCount };
}

export function getLeadSessions(): SessionRecord[] {
  return sessionList.filter(s => isLead(s.ip));
}
