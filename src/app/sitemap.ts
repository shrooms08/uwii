import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site/metadata";

/** Public pages only: the flow pages (scan, questions, result, export) depend on an account and the browser. */
export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/guide", "/verify"].map((p) => ({ url: `${SITE_URL}${p === "/" ? "" : p}`, changeFrequency: "monthly", priority: p === "/" ? 1 : 0.6 }));
}
