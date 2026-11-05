/** Public, read-only: is this report fingerprint anchored on NEAR testnet? GET /api/verify?fingerprint=<64 hex> */
import type { NextRequest } from "next/server";
import { handleVerify } from "@/lib/api/anchor-handlers";

export function GET(request: NextRequest) {
  return handleVerify(request.nextUrl.searchParams.get("fingerprint"));
}
