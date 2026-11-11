/**
 * Page metadata shared by every route: title, description, canonical URL, Open Graph and Twitter card.
 * The social image comes from the opengraph-image / twitter-image file routes (site card; the result
 * route uses the cached demo figures only, never a user's).
 */
import type { Metadata } from "next";

/** Public origin for absolute URLs in social cards. */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://uwii-chi.vercel.app");

export const SITE_NAME = "Uwii";

export const SITE_DESCRIPTION =
  "Paste your NEAR account and Uwii works out your 2026 Nigerian crypto tax. The AI runs in verified, sealed hardware, and your answers stay on your device.";

export const SITE_CARD_ALT = "uwii: Know your crypto tax. Tell no one. Built on NEAR.";

export interface CardImage {
  og: string;
  twitter: string;
  alt: string;
}

export const SITE_CARD: CardImage = { og: "/opengraph-image", twitter: "/twitter-image", alt: "" };

export function pageMetadata(title: string, description: string, path: string, card: CardImage = SITE_CARD): Metadata {
  const alt = card.alt || SITE_CARD_ALT;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: SITE_NAME, title, description, url: path, locale: "en_NG", images: [{ url: card.og, width: 1200, height: 630, alt }] },
    twitter: { card: "summary_large_image", title, description, images: [{ url: card.twitter, alt }] },
  };
}
