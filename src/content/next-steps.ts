/**
 * "What to do next" after a report, shared by the Result and Export pages and the last section of the
 * PDF worksheet. Plain text only.
 */

export const NEXT_STEPS_TITLE = "What to do next";

export const NEXT_STEPS: { title: string; body: string }[] = [
  {
    title: "Get a Tax ID (TIN) if you don't have one.",
    body: "You need it to file.",
  },
  {
    title: "Give this worksheet to your tax consultant, or use it to file with your State Internal Revenue Service by 31 March 2027.",
    body: "Every line cites NRS Information Circular 2026/21, so it can be checked line by line.",
  },
  {
    title: "Keep evidence.",
    body: "P2P receipts, exchange statements, and this PDF with its fingerprint.",
  },
];

/** Shown instead of the steps while the report is a draft. */
export const NEXT_STEPS_DRAFT = "Finish the questions to get a final figure.";
