/**
 * Landing page copy. Edit words here; layout lives in src/app/page.tsx.
 *
 * Rules: every claim must be true of the current product. No reviews, ratings, user counts, press
 * mentions or guarantees. Answers that state law name their source (the Circular or the Act).
 */
import { PRIVATE_INPUTS_CLAIM } from "./privacy-scope";

export const REPO_URL = "https://github.com/shrooms08/uwii";
export const DEMO_ACCOUNT_ID = "rybergh44.near";

export const hero = {
  deadline: "First filing deadline: 31 March 2027",
  eyebrow: "Private AI · NRS Circular 2026/21",
  /** Two-tone headline: line 1 in the foreground colour, line 2 muted (ends with the gold % mark). */
  headline: "Crypto tax,",
  headlineMuted: "without the guesswork.",
  headlineItalic: "Worked out privately.",
  subline:
    "Uwii reads your NEAR transactions, asks you a few plain questions, and computes your 2026 Nigerian tax under NRS Circular 2026/21.",
};

/** Numbered section headers: "01 / HOW IT WORKS", a one-line two-tone headline, a short line. */
export const sections = {
  how: {
    index: "01",
    label: "How it works",
    headline: "Three steps.",
    muted: "Scan, answer, file.",
    body: "Fixed tax rules first, private AI only for what they can't label, then a worksheet that cites the circular line by line.",
  },
  trust: { index: "02", label: "Why trust the number", headline: "Checked and cited.", muted: "Proven, then anchored.", body: "Four things you can check yourself." },
  who: { index: "03", label: "Who it's for", headline: "Paid, staked or swapped", muted: "on NEAR in 2026.", body: "Individuals filing personal income tax in Nigeria." },
  scope: { index: "04", label: "Scope", headline: "What Uwii can do,", muted: "and what it can't yet.", body: "" },
  faq: { index: "05", label: "FAQ", headline: "Questions,", muted: "answered plainly.", body: "" },
};

/** Labels for the "Live" row; every number is measured (src/content/stats.json and the demo run). */
export const liveStats = {
  label: "Live",
  tests: "tests passing",
  illustrations: "NRS illustrations reproduced",
  checks: "privacy checks per scan",
  anchors: "reports anchored on NEAR testnet",
};

export const howItWorks = {
  title: "How it works",
  steps: [
    {
      number: "01",
      title: "Scan privately",
      body: "Your transactions are classified by fixed tax rules, and the few they can't label by an AI running in verified secure hardware.",
    },
    {
      number: "02",
      title: "Answer a few questions",
      body: "Only what the chain can't tell us, like who sent you money and why, in plain English. Your answers stay in your browser.",
    },
    {
      number: "03",
      title: "Get your worksheet",
      body: "Every line cites the circular; hand it to your consultant or file it yourself.",
    },
  ],
};

export type TrustAction = { kind: "link"; href: string; label: string; external?: boolean } | { kind: "privacy"; label: string };

export const trust = {
  title: "Why you can trust the number",
  cards: [
    {
      title: "Checked against the NRS's own worked examples",
      body: "Automated tests reproduce the circular's Illustrations 2 and 3 to the kobo: a naira purchase and sale, and a crypto-to-crypto swap.",
      action: { kind: "link", href: `${REPO_URL}/blob/main/src/lib/tax/ng/engine.test.ts`, label: "Read the tests on GitHub", external: true },
    },
    {
      title: "Every line cites the circular",
      body: "Each income, disposal and fee line shows the paragraph it follows, with a plain explanation of the treatment.",
      action: { kind: "link", href: `/result?account=${DEMO_ACCOUNT_ID}`, label: "See the demo result" },
    },
    {
      title: "Private by proof, not by promise",
      body: "The hardware checks and signed AI responses are recorded with every scan, and you can read them.",
      action: { kind: "privacy", label: "Open the demo's privacy proof" },
    },
    {
      title: "Anchored on NEAR",
      body: "A final report's fingerprint can be written to NEAR testnet, so anyone can check that the exact report existed and hasn't changed.",
      action: { kind: "link", href: "/verify", label: "Verify a report" },
    },
  ] satisfies { title: string; body: string; action: TrustAction }[],
};

export const whoFor = {
  title: "Who it's for",
  items: [
    { who: "Freelancers and remote workers paid in USDC or NEAR", line: "Payment received in crypto is income at its value on the day you got it." },
    { who: "NEAR stakers", line: "Staking rewards are income as they arrive, day by day." },
    { who: "Traders and swappers", line: "Each swap is a disposal of what you gave up, with its own gain or loss." },
    { who: "Anyone who received crypto as payment", line: "For goods, services or work, the value received counts as income." },
  ],
};

export const scope = {
  title: "What Uwii can and can't do",
  can: {
    title: "Can",
    items: [
      "Individuals",
      "NEAR accounts (one account scanned at a time)",
      "Tax year 2026",
      "Personal income tax on crypto income and gains",
      "Accounts you own: transfers between them are not taxed",
      "Naira P2P purchases and sales, from your answers",
    ],
  },
  cant: {
    title: "Can't (yet)",
    items: ["Companies", "VAT", "Filing for you", "Other chains", "Exchange CSV import"],
  },
  note: "Your answers drive the result. Keep receipts for anything bought or sold for naira.",
};

export const faq = {
  title: "Questions",
  items: [
    {
      q: "Is this tax advice?",
      a: "No. Uwii produces a computation for review, not tax advice. Have a tax professional check it before you rely on it.",
    },
    {
      q: "Where do I file?",
      a: "With the Internal Revenue Service of the state you live in (FCT residents: FCT-IRS). The annual return for 2026 income is due by 31 March 2027.",
    },
    {
      q: "Can Uwii see my data?",
      a: `Your NEAR transactions are public on the chain. ${PRIVATE_INPUTS_CLAIM} The deterministic tax rules label your transactions on Uwii's server during the scan; the AI step for the ones they can't label runs in verified secure hardware, and you can read the proof.`,
    },
    {
      q: "What if I don't know an answer?",
      a: "Choose “I don't know”. That transaction stays out of the totals, and the report stays a draft and says why.",
    },
    {
      q: "What is the report fingerprint?",
      a: "A SHA-256 code computed from everything in the report except your personal details. Any change to the report changes it. If you anchor a final report, only this code is written to NEAR testnet, and anyone can check it on the Verify page.",
    },
    {
      q: "Do I need to file if I owe nothing?",
      a: "Generally yes. Under the Nigeria Tax Administration Act 2025, individuals with income are expected to file an annual return even when no tax is due. Confirm with your State IRS or a tax professional.",
    },
  ],
};
