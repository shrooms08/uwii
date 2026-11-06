/**
 * Abuse protection for the hosted demo: per-IP rate limits and global daily caps, in memory.
 *
 * Best-effort by design: state lives in one server instance (Vercel may run several, and an instance
 * can be recycled at any time), so the effective limits can be higher than configured. It needs no
 * paid service. IPs are kept only as truncated SHA-256 hashes in memory and are never logged; nothing
 * here records accounts or answers.
 */
import { createHash } from "node:crypto";

export const HOUR_MS = 60 * 60 * 1000;

export interface LimitResult {
  ok: boolean;
  /** Seconds until the next slot frees up (0 when ok). */
  retryAfterSec: number;
  remaining: number;
}

/** Sliding-window counter per key. */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    readonly limit: number,
    readonly windowMs: number,
  ) {}

  private recent(key: string, now: number): number[] {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  check(key: string, now = Date.now()): LimitResult {
    const list = this.recent(key, now);
    if (list.length < this.limit) return { ok: true, retryAfterSec: 0, remaining: this.limit - list.length };
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((list[0] + this.windowMs - now) / 1000)), remaining: 0 };
  }

  /** Records a hit when allowed; refuses (without recording) when the window is full. */
  hit(key: string, now = Date.now()): LimitResult {
    const r = this.check(key, now);
    if (!r.ok) return r;
    this.recent(key, now);
    this.hits.set(key, [...(this.hits.get(key) ?? []), now]);
    if (this.hits.size > 10_000) for (const k of this.hits.keys()) this.recent(k, now);
    return { ok: true, retryAfterSec: 0, remaining: r.remaining - 1 };
  }
}

const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

/** Global counter that resets at 00:00 UTC. */
export class DailyCap {
  private day = "";
  private used = 0;
  constructor(readonly cap: number) {}

  private roll(now: number) {
    const d = utcDay(now);
    if (d !== this.day) {
      this.day = d;
      this.used = 0;
    }
  }

  remaining(now = Date.now()): number {
    this.roll(now);
    return Math.max(0, this.cap - this.used);
  }

  /** Adds n (may be negative to return an unused reservation); never below zero. */
  add(n: number, now = Date.now()): void {
    this.roll(now);
    this.used = Math.max(0, this.used + n);
  }

  /** Seconds until the next UTC midnight. */
  static secondsToReset(now = Date.now()): number {
    const d = new Date(now);
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    return Math.max(1, Math.ceil((next - now) / 1000));
  }
}

/** Non-negative integer from the environment, else the default. */
export function envInt(name: string, fallback: number, env: Record<string, string | undefined> = process.env): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export const LIMITS = {
  scansPerIpPerHour: 5,
  anchorsPerIpPerHour: 3,
  defaultAiCallsPerDay: 150,
  defaultAnchorsPerDay: 100,
};

interface LimitState {
  scanPerIp: SlidingWindowLimiter;
  anchorPerIp: SlidingWindowLimiter;
  aiCallsDaily: DailyCap;
  anchorsDaily: DailyCap;
}

/** One shared state per server process (kept on globalThis so dev hot reloads do not reset it). */
export function limitState(): LimitState {
  const g = globalThis as typeof globalThis & { __uwiiLimits?: LimitState };
  g.__uwiiLimits ??= {
    scanPerIp: new SlidingWindowLimiter(LIMITS.scansPerIpPerHour, HOUR_MS),
    anchorPerIp: new SlidingWindowLimiter(LIMITS.anchorsPerIpPerHour, HOUR_MS),
    aiCallsDaily: new DailyCap(envInt("MAX_AI_CALLS_PER_DAY", LIMITS.defaultAiCallsPerDay)),
    anchorsDaily: new DailyCap(envInt("MAX_ANCHORS_PER_DAY", LIMITS.defaultAnchorsPerDay)),
  };
  return g.__uwiiLimits;
}

/** Client IP from the proxy headers (Vercel sets x-forwarded-for), hashed for in-memory keys only. */
export function clientKey(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = fwd || request.headers.get("x-real-ip")?.trim() || "unknown";
  return createHash("sha256").update(`uwii-limit:${ip}`).digest("hex").slice(0, 16);
}

export const BUSY_MESSAGE = "The hosted demo is busy. Try again later, or load the cached demo report.";

export function tooManyRequests(code: "rate_limited" | "daily_cap", retryAfterSec: number, error = BUSY_MESSAGE): Response {
  return Response.json(
    { error, code, retryAfterSec },
    { status: 429, headers: { "cache-control": "no-store", "retry-after": String(retryAfterSec) } },
  );
}
