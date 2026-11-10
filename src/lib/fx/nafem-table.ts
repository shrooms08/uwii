/**
 * The CBN NFEM USD/NGN table and its lookup (D8), with no Node imports so the browser can use it too.
 * Lookup: the exact date, else the most recent prior published date (flagged `rate_fallback`). Rates are
 * never interpolated. The server reads data/fx/*.csv (nafem.ts); the browser reads the same rows as JSON
 * generated from that CSV at build time.
 */
import { dec, type Dec } from "../money";

/** The table as JSON: [date, closing rate] rows in date order, plus the CSV's source metadata. */
export interface NafemJson {
  meta: { sourceUrl: string; retrievedAt: string };
  rows: [string, string][];
}

export interface FxQuote {
  /** NGN per USD as published. */
  rate: string;
  /** Date of the published rate used. */
  rateDate: string;
  /** Requested (transaction) date. */
  date: string;
  /** True when no rate was published on `date` and the prior published date was used. */
  rateFallback: boolean;
}

export class NafemTable {
  private readonly dates: string[];
  constructor(
    private readonly rows: Map<string, string>,
    public readonly meta: { sourceUrl: string; retrievedAt: string },
  ) {
    this.dates = [...rows.keys()].sort();
  }

  static parse(csv: string): NafemTable {
    const rows = new Map<string, string>();
    let sourceUrl = "";
    let retrievedAt = "";
    for (const line of csv.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith("#")) {
        const src = /^# Source: (\S+)/.exec(t);
        if (src) sourceUrl = src[1];
        const ret = /^# Retrieved: (\S+)/.exec(t);
        if (ret) retrievedAt = ret[1];
        continue;
      }
      if (t === "date,closing_rate") continue;
      const [date, rate] = t.split(",");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d+(\.\d+)?$/.test(rate ?? "")) throw new Error(`Bad NAFEM CSV line: ${t}`);
      rows.set(date, rate);
    }
    if (rows.size === 0) throw new Error("NAFEM CSV has no rows");
    return new NafemTable(rows, { sourceUrl, retrievedAt });
  }

  /** The rows and source metadata as plain JSON (the browser's copy of the table, built from the CSV). */
  toJSON(): NafemJson {
    return { meta: this.meta, rows: this.dates.map((d) => [d, this.rows.get(d)!] as [string, string]) };
  }

  static fromJSON(json: NafemJson): NafemTable {
    return new NafemTable(new Map(json.rows), json.meta);
  }

  get range(): { first: string; last: string } {
    return { first: this.dates[0], last: this.dates[this.dates.length - 1] };
  }

  /** Exact date, else the most recent prior published date (rate_fallback). Throws if none: never interpolates. */
  quote(date: string): FxQuote {
    const exact = this.rows.get(date);
    if (exact !== undefined) return { rate: exact, rateDate: date, date, rateFallback: false };
    let prior: string | undefined;
    for (const d of this.dates) {
      if (d < date) prior = d;
      else break;
    }
    if (!prior) throw new Error(`No CBN NFEM rate published on or before ${date} (data starts ${this.dates[0]})`);
    return { rate: this.rows.get(prior)!, rateDate: prior, date, rateFallback: true };
  }

  rateOf(date: string): Dec {
    return dec(this.quote(date).rate);
  }
}
