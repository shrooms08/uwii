import { cacheLife } from "next/cache";
import { ImageResponse } from "next/og";
import { SITE_CARD_ALT } from "@/lib/site/metadata";
import { OG_SIZE, SiteCard, ogFonts } from "@/lib/site/og";

export const alt = SITE_CARD_ALT;
export const size = OG_SIZE;
export const contentType = "image/png";

/** Rendered once (cached, prerendered at build): no runtime file reads. */
async function png(): Promise<Uint8Array> {
  "use cache";
  cacheLife("max");
  const res = new ImageResponse(<SiteCard />, { ...OG_SIZE, fonts: await ogFonts() });
  return new Uint8Array(await res.arrayBuffer());
}

export default async function Image() {
  return new Response(Buffer.from(await png()), { headers: { "content-type": contentType } });
}
