/** Public, read-only: is this report fingerprint anchored on NEAR testnet? GET /api/verify?fingerprint=<64 hex> */
import type { NextRequest } from "next/server";
import { handleVerify } from "@/lib/api/anchor-handlers";
import { apiLimit } from "@/lib/server/limits";

/** Read-only lookup (one view call, then at most one block and its chunks, 20 s per RPC call). Hobby allows up to 300 s. */
export const maxDuration = 60;

export function GET(request: NextRequest) {
  const limited = apiLimit("verifyPerIp", request);
  if (limited) return limited;
  return handleVerify(request.nextUrl.searchParams.get("fingerprint"));
}
