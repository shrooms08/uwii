/**
 * "Crypto tax in Nigeria, explained" (/guide). Edit words here; layout lives in src/app/guide/page.tsx.
 *
 * Rules: every claim cites the Circular (NRS Information Circular No. 2026/21) or the Nigeria Tax Act 2025
 * (NTA), or is marked as a Uwii decision linked to the decision log (docs/rules-ng-2026-21.md).
 * Illustrations 2 and 3 use the Circular's own numbers (verified by the engine tests in
 * src/lib/tax/ng/engine.test.ts).
 */
import { ZERO_D, dec } from "../lib/money";
import { fmtNgn } from "../lib/report/format";
import { PIT_BANDS } from "../lib/tax/ng/pit";
import { RELIEFS, RELIEFS_NOTE } from "../lib/tax/ng/reliefs";
import { REPO_URL } from "./landing";

/** A heading in docs/rules-ng-2026-21.md on GitHub. */
const DECISION_LOG_URL = (anchor: string) => `${REPO_URL}/blob/main/docs/rules-ng-2026-21.md#${anchor}`;

export interface GuideItem {
  title: string;
  body: string;
  cite: string;
  /** A Uwii decision (not a quote from the Circular or the Act), linked to the decision log. */
  decision?: { id: string; href: string };
}

export interface GuideSection {
  id: string;
  title: string;
  intro?: string;
  items: GuideItem[];
  /** Optional worked examples (title + steps). */
  examples?: { title: string; cite: string; steps: string[] }[];
  note?: string;
}

export const guideMeta = {
  title: "Crypto tax in Nigeria, explained",
  intro:
    "How NRS Information Circular No. 2026/21 (the Circular) and the Nigeria Tax Act 2025 (NTA) treat crypto for individuals, in plain English. A guide, not tax advice: have a tax professional check your own position.",
};

const fmtBand = (n: string) => fmtNgn(n).replace(/\.00$/, "");

function bandLines(): string {
  let from = ZERO_D;
  const parts: string[] = [];
  for (const b of PIT_BANDS) {
    const rate = `${dec(b.rate).mul(100).toFixed(0)}%`;
    if (b.width === null) parts.push(`${rate} above ₦${fmtBand(from.toFixed())}`);
    else {
      parts.push(`${rate} on the ${from.isZero() ? "first" : "next"} ₦${fmtBand(b.width)}`);
      from = from.plus(dec(b.width));
    }
  }
  return parts.join("; ");
}

export const guideSections: GuideSection[] = [
  {
    id: "taxable",
    title: "What is taxable",
    intro: "Two kinds of event: income when you receive crypto, and disposals when you give crypto up.",
    items: [
      {
        title: "Staking rewards",
        body: "Income when you receive them, at their market value on the day.",
        cite: "Circular 7.1 event 9; 9.5(4)",
      },
      {
        title: "DeFi yield and rewards",
        body: "Income when you receive them, at market value.",
        cite: "Circular 7.1 event 14; 10.4",
      },
      {
        title: "Airdrops with a value",
        body: "Income at market value when received. An airdrop with no realisable value is not income.",
        cite: "Circular 7.1 event 10; 9.6",
      },
      {
        title: "Payment for work in crypto",
        body: "Fees or salary paid to you in crypto are income at market value when received.",
        cite: "Circular 6.1.1; 7.1 events 6-7; 9.5(3)",
      },
      {
        title: "Selling crypto for naira",
        body: "A disposal: the gain or loss is what you got for it minus what it cost you.",
        cite: "Circular 7.1 events 3-4; 9.1.2",
      },
      {
        title: "Swapping one token for another",
        body: "A disposal of the token you give up. The proceeds are the market value of what you gave up.",
        cite: "Circular 9.1.2; 9.3.2; Illustration 3",
      },
      {
        title: "Paying for goods or services with crypto",
        body: "A disposal at market value. This includes gas fees paid in NEAR, which are not deductible.",
        cite: "Circular 7.1 event 5",
      },
    ],
  },
  {
    id: "not-taxable",
    title: "What is not taxable",
    items: [
      {
        title: "Holding",
        body: "Holding crypto is not a taxable event, even when its price rises. Any rise in value is not taxed until you dispose of it.",
        cite: "Circular 7.2.1",
      },
      {
        title: "Moving crypto between your own wallets",
        body: "No change in who owns it, so no disposal.",
        cite: "Circular 7.2.2",
      },
      {
        title: "Wrapping and unwrapping",
        body: "Turning NEAR into wNEAR and back is the same asset in another form.",
        cite: "Circular 10.1",
      },
      {
        title: "Staking lockups",
        body: "Locking tokens to stake them is not a disposal. The rewards are income when received.",
        cite: "Circular 7.2.3",
      },
      {
        title: "Borrowing against crypto",
        body: "Putting crypto up as collateral for a loan is not a disposal.",
        cite: "Circular 7.2.6",
      },
      {
        title: "Buying crypto with naira",
        body: "Not taxable when you buy. What you paid becomes your cost for a later disposal.",
        cite: "Circular 7.1 event 1; 9.3.1",
      },
    ],
  },
  {
    id: "gains",
    title: "How gains are worked out",
    intro:
      "Gains are worked out in dollars first: proceeds minus cost, both in US dollars. The dollar gain is then converted to naira at the CBN NFEM closing rate.",
    items: [
      {
        title: "Dollars first, then naira",
        body: "Proceeds and cost are measured in US dollars; the gain is converted at the CBN NFEM (formerly NAFEM) rate on the date of the disposal.",
        cite: "Circular 9.1.2; Illustration 2",
      },
      {
        title: "Which coins you sold first",
        body: "First in, first out: the oldest units you hold are treated as sold first.",
        cite: "Circular 9.3.3(3)",
      },
      {
        title: "Prices",
        body: "Market value comes from a recognised price source. A token with no verifiable price is left out until it can be valued.",
        cite: "Circular 9.2; 9.2(4)",
      },
      {
        title: "Losses",
        body: "Gains and losses in the year are netted. A net loss is not set against your income; it carries forward to future crypto gains.",
        cite: "Circular 9.4",
      },
    ],
    examples: [
      {
        title: "Illustration 2: 0.985 BTC bought and sold for naira",
        cite: "Circular 9.1.2; Illustration 2",
        steps: [
          "You buy 0.985 BTC for ₦1,000,000 when the rate is ₦1,000 per dollar. Cost: $1,000.",
          "You sell it for ₦1,970,000 when the rate is ₦1,500 per dollar. Proceeds: ₦1,970,000 ÷ 1,500 = $1,313.33 (exactly $1,313.333…).",
          "Gain in dollars: $1,313.333… − $1,000 = $313.333… ($313.33 rounded).",
          "Converted at ₦1,500 per dollar: $313.333… × 1,500 = a taxable gain of ₦470,000.",
          "Worked in naira only, this looks like a ₦970,000 gain. ₦500,000 of that is just the naira falling from ₦1,000 to ₦1,500 per dollar, which is excluded. Only the real dollar gain of $313.33, converted at the sale-date rate, is taxable: ₦470,000.",
        ],
      },
      {
        title: "Illustration 3: a swap",
        cite: "Circular 9.3.2; Illustration 3",
        steps: [
          "You hold 2 ETH that cost you $3,000.",
          "You swap them for 0.1 BTC when ETH is $2,000 and BTC is $40,000, at ₦1,600 per dollar.",
          "Proceeds are the value of what you gave up: 2 × $2,000 = $4,000.",
          "Gain: $4,000 − $3,000 = $1,000, which is ₦1,600,000.",
          "Your 0.1 BTC now has a cost of $4,000 for when you dispose of it later.",
        ],
      },
    ],
  },
  {
    id: "tax",
    title: "How the tax is charged",
    items: [
      {
        title: "What is added up",
        body: "Your crypto income for the year plus your net gains (if positive) is the chargeable amount from crypto.",
        cite: "Circular 9.4",
      },
      {
        title: "Personal income tax bands",
        body: `It is taxed with the rest of your income under the personal income tax bands: ${bandLines()}.`,
        cite: "Circular 6.1.1(1); NTA 2025 s.58 and Fourth Schedule",
      },
    ],
  },
  {
    id: "reliefs",
    title: "Reliefs and deductions",
    intro: "These are taken off your income before the bands apply. Uwii applies them if you enter them on the Questions page. Gas fees and other transaction costs are not reliefs; gas fees are not deductible (D2).",
    items: RELIEFS.map((r) => ({ title: r.label, body: `${r.rule}.`, cite: r.citation })),
    note: RELIEFS_NOTE,
  },
  {
    id: "dates",
    title: "Key dates",
    items: [
      {
        title: "Tax year",
        body: "1 January to 31 December. The Circular was published on 31 July 2026 and does not state an effective date. Uwii applies it to the 2026 year of assessment, the first year under the Nigeria Tax Act 2025.",
        cite: "Uwii decision D16",
        decision: { id: "D16", href: DECISION_LOG_URL("d16--effective-date-2026-year-of-assessment-decided") },
      },
      {
        title: "Coins held before 2026",
        body: "Uwii uses the higher of what they cost you or their value at 31 December 2025 as their cost, and shows the gain both ways. This rests on public statements by the Presidential Fiscal Policy and Tax Reforms Committee; no citable paragraph has been published yet.",
        cite: "Uwii decision D11",
        decision: { id: "D11", href: DECISION_LOG_URL("d11--pre-2026-holdings-cost-base-reset-decided") },
      },
      {
        title: "Filing deadline",
        body: "The annual return for 2026 income is due by 31 March 2027.",
        cite: "Nigeria Tax Administration Act 2025",
      },
    ],
  },
  {
    id: "file",
    title: "Where to file",
    items: [
      {
        title: "Your State Internal Revenue Service",
        body: "With the Internal Revenue Service of the state you live in (FCT residents: FCT-IRS). The annual return for 2026 income is due by 31 March 2027.",
        cite: "Nigeria Tax Administration Act 2025",
      },
      {
        title: "Declare your crypto in that return",
        body: "Include your crypto income and gains in your annual income tax return.",
        cite: "Circular 6.1.1(4)",
      },
      {
        title: "Even if you owe nothing",
        body: "Generally yes. Under the Nigeria Tax Administration Act 2025, individuals with income are expected to file an annual return even when no tax is due. Confirm with your State IRS or a tax professional.",
        cite: "Nigeria Tax Administration Act 2025",
      },
    ],
  },
];
