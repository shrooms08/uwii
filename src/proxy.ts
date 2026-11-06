import { NextResponse, type NextRequest } from "next/server";
import { devPagesEnabled } from "@/lib/server/dev-pages";

/** /dev/* is a 404 in production unless UWII_ENABLE_DEV_PAGES=1 (checked per request, at runtime). */
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/dev") && !devPagesEnabled()) {
    return new NextResponse("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/dev", "/dev/:path*"] };
