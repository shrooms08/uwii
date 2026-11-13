/**
 * Optional "Have a tax consultant review this" call to action. It appears only when
 * NEXT_PUBLIC_REVIEW_CONTACT_URL is set to an http(s) or mailto URL; otherwise nothing renders.
 */

export const REVIEW_COPY = {
  title: "Have a tax consultant review this",
  body: "A tax consultant can check your answers and this report before you file.",
  button: "Ask for a review",
};

/** The review contact URL, or null when unset or not an http(s)/mailto URL. */
export function reviewContactUrl(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:" ? u.toString() : null;
  } catch {
    return null;
  }
}
