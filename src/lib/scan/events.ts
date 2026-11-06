/**
 * Live scan stream: event types sent by POST /api/scan and the pure helpers shared by the route and
 * the /scan page. Every number in these events is measured by the server pipeline; the page never
 * invents or extrapolates one.
 */
import type { ClassifyEvent } from "../tax/ng/classify";
import type { ClassifiedRun } from "../tax/ng/types";

export type ScanEvent =
  /** Replay of the committed classified fixture (no live calls): the cached demo result. */
  | { type: "cached"; recordedAt: string; classifiedAt: string }
  | { type: "start"; account: string; from: string; to: string }
  /** History is not cached: it is being read live from the NearBlocks free tier (slow). */
  | { type: "history_live" }
  /** Live fetch progress: rows received so far across the NearBlocks endpoints. */
  | { type: "history_progress"; rowsRead: number }
  | { type: "history"; count: number; origin: "cache" | "fixture" | "live"; fetchedAt: string }
  | ClassifyEvent
  | {
      type: "done";
      /** Question groups the user must answer (after rules with their own accounts). */
      questions: number;
      /** Records inside those question groups. */
      needsYou: number;
      total: number;
      attestationVerified: boolean;
      aiResponses: number;
      aiResponsesVerified: number;
      /** Live scans only: the classified run (signed by the server) for the browser to keep and send back. */
      run?: ClassifiedRun;
      runSig?: string;
    }
  | { type: "error"; stage: "input" | "history" | "classification"; message: string; code?: "busy" | "timeout" | "rate_limited" | "daily_cap" };

export type ScanEventType = ScanEvent["type"];

/** Shown when a scan cannot finish inside the hosted demo's function time limit. */
export const TOO_LARGE_MESSAGE = "This account is too large for the hosted demo's time limit. Run Uwii locally from the README.";
export const OUT_OF_TIME_MESSAGE = "The hosted demo's time limit was reached before the scan finished. Run Uwii locally from the README.";

/** Server-Sent Events wire format: one `event:` line and one JSON `data:` line per event. */
export function sseEncode(event: ScanEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Parse complete SSE frames out of a text buffer; returns the events and the unconsumed remainder. */
export function sseDecode(buffer: string): { events: ScanEvent[]; rest: string } {
  const events: ScanEvent[] = [];
  const frames = buffer.split("\n\n");
  const rest = frames.pop() ?? "";
  for (const frame of frames) {
    const data = frame
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => l.slice(6))
      .join("\n");
    if (!data) continue; // comment / heartbeat frame
    try {
      events.push(JSON.parse(data) as ScanEvent);
    } catch {
      // malformed frame: ignore rather than show a number we cannot trust
    }
  }
  return { events, rest };
}

const PAGE_RE = /^\s*(\/v3\/accounts\/[^/\s]+\/[a-z-]+) page \d+: \d+ rows \((\d+) in range so far\)$/;

/**
 * Sums "rows in range so far" across NearBlocks endpoints from the fetcher's progress messages
 * (`  /v3/accounts/<id>/receipts page 3: 25 rows (60 in range so far)`). Other messages are ignored.
 */
export class FetchProgressTracker {
  private perEndpoint = new Map<string, number>();

  /** Returns the new running total when the message carried a page count, otherwise null. */
  push(message: string): number | null {
    const m = PAGE_RE.exec(message);
    if (!m) return null;
    this.perEndpoint.set(m[1], Number(m[2]));
    return this.total();
  }

  total(): number {
    let n = 0;
    for (const v of this.perEndpoint.values()) n += v;
    return n;
  }
}

/** "93.6%" from integer counts (one decimal, half-up), no floating-point division of amounts. */
export function percent(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  const tenths = Math.floor((part * 1000 * 2 + whole) / (2 * whole)); // round half up
  return `${Math.floor(tenths / 10)}.${tenths % 10}%`;
}
