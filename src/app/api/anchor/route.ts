/**
 * Anchor a final report's fingerprint on NEAR testnet, only when the user presses "Anchor fingerprint".
 * Body: the signed run, the answers, other income and reliefs, and the fingerprint the browser computed
 * (never name, TIN or state). The report is recomputed here and must match; only its fingerprint and
 * "final" go on-chain. The body is never stored or logged.
 */
import { handleAnchor } from "@/lib/api/anchor-handlers";

/** Vercel Hobby (Fluid compute): 300 s default and maximum per invocation. */
export const maxDuration = 300;

export function POST(request: Request) {
  return handleAnchor(request);
}
