/**
 * Anchor a final report's fingerprint on NEAR testnet. Body: the same as /api/report. The report is
 * recomputed here; only its fingerprint and "final" go on-chain. Answers are never stored or logged.
 */
import { handleAnchor } from "@/lib/api/anchor-handlers";

/** Vercel Hobby (Fluid compute): 300 s default and maximum per invocation. */
export const maxDuration = 300;

export function POST(request: Request) {
  return handleAnchor(request);
}
