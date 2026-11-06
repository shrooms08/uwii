/**
 * Client-facing errors (audit finding L1). Unexpected failures return a generic message with a short
 * error id; the internal message is written to the server log under that id (and nothing else: no
 * request body, answers or personal fields). Known honest states (busy, not scanned, too large,
 * validation) keep their specific messages and are not handled here.
 */
import { randomBytes } from "node:crypto";

export const GENERIC_ERROR = "Something went wrong on our side. Try again; if it keeps happening, quote error";

/** Logs the internal detail under a fresh id and returns the public message. */
export function publicError(context: string, e: unknown): { id: string; message: string } {
  const id = randomBytes(4).toString("hex");
  console.error(`[uwii error ${id}] ${context}: ${e instanceof Error ? e.message : String(e)}`);
  return { id, message: `${GENERIC_ERROR} ${id}.` };
}

/** JSON response for an unexpected failure (5xx). */
export function serverError(context: string, e: unknown, status: 500 | 502 | 503 = 500): Response {
  const { id, message } = publicError(context, e);
  return Response.json({ error: message, code: "server_error", errorId: id }, { status, headers: { "cache-control": "no-store" } });
}
