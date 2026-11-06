/** Deployment health check. Reports which features are configured (true/false), never secret values. */
import { health } from "@/lib/server/health";

export async function GET() {
  const h = await health();
  return Response.json(h, { status: h.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
