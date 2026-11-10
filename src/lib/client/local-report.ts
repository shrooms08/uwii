/**
 * The report, computed in this browser: the signed scan (or the cached demo's committed inputs) plus the
 * answers, other income and reliefs saved here. None of those leave the device; the only requests are
 * static tables (/static-data/) and, when an answer adds a source leg the scan did not price,
 * /api/price with that asset and date. The anchor request is the one exception, and only on the user's
 * say-so (AnchorCard).
 *
 * Loaded with import() so the engine is not in the first page load.
 */
import { DEMO_ACCOUNT } from "@/lib/demo/illustrative-answers";
import { NafemTable, type NafemJson } from "@/lib/fx/nafem-table";
import { inputsFromBundle, inputsFromSignedRun, userInputsFromBody, type DemoBundle } from "@/lib/report/local";
import { computeReport, type ReportData } from "@/lib/tax/ng/compute";
import { runQuestionFlow } from "@/lib/tax/ng/questions";
import { questionsView, type QuestionsView } from "@/lib/tax/ng/questions-view";
import type { ClassifiedRun } from "@/lib/tax/ng/types";
import { RemotePriceProvider } from "./remote-prices";
import { requestBody } from "./request";
import { loadRun } from "./runs";
import { loadSource, type Saved } from "./storage";

/** Accounts with a cached demo (public/static-data/demo/<account>.json, built from data/fixtures). */
export const DEMO_ACCOUNTS: readonly string[] = [DEMO_ACCOUNT];

export class LocalReportError extends Error {
  constructor(
    readonly code: "not_scanned" | "rescan" | "static_data",
    message: string,
  ) {
    super(message);
  }
}

const memo = new Map<string, Promise<unknown>>();
function staticJson<T>(path: string): Promise<T> {
  let p = memo.get(path) as Promise<T> | undefined;
  if (!p) {
    p = fetch(path).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<T>;
    });
    p.catch(() => memo.delete(path)); // a failed load is retried next time
    memo.set(path, p);
  }
  return p.catch(() => {
    throw new LocalReportError("static_data", "Could not load Uwii's price and exchange-rate tables. Check your connection and try again.");
  });
}

const loadFx = () => staticJson<NafemJson>("/static-data/fx-nafem.json").then((j) => NafemTable.fromJSON(j));
const loadDemo = (account: string) => staticJson<DemoBundle>(`/static-data/demo/${encodeURIComponent(account)}.json`);

type Source = { kind: "demo"; bundle: DemoBundle } | { kind: "signed"; run: ClassifiedRun };

/** The cached demo when chosen; else this browser's signed scan; else the demo's committed run when there is one. */
async function resolveSource(account: string): Promise<Source> {
  const isDemo = DEMO_ACCOUNTS.includes(account);
  // The demo's inputs are public static data: fetch them while the saved scan is looked up.
  const demo = isDemo ? loadDemo(account) : null;
  demo?.catch(() => {}); // unused when a signed run exists
  if (loadSource(account) && demo) return { kind: "demo", bundle: await demo };
  const signed = await loadRun(account);
  if (signed) {
    if (!signed.run.context?.prices) {
      throw new LocalReportError("rescan", "This scan was saved by an older version of Uwii that computed reports on the server. Scan the account again to compute it in your browser.");
    }
    return { kind: "signed", run: signed.run };
  }
  if (demo) return { kind: "demo", bundle: await demo };
  throw new LocalReportError("not_scanned", `${account} has not been scanned in this browser yet. Start a scan first.`);
}

export interface LocalResult {
  report: ReportData;
  view: QuestionsView;
}

const prices = new RemotePriceProvider();

export async function computeLocalReport(account: string, saved: Saved): Promise<LocalResult> {
  // The same body the anchor request would carry (already normalised: see request-body.test.ts).
  const user = userInputsFromBody(requestBody(account, saved));
  const [source, fx] = await Promise.all([resolveSource(account), loadFx()]);
  const inputs = source.kind === "demo" ? inputsFromBundle(source.bundle, user, fx, prices) : inputsFromSignedRun(source.run, user, fx, prices)!;
  const { report, flow } = await computeReport(inputs);
  return { report, view: questionsView(inputs.run, flow) };
}

/** Question counts for the scan page, with the user's own accounts applied here rather than sent with the scan. */
export async function localQuestionCounts(account: string, ownAccounts: string[], run: ClassifiedRun | null): Promise<{ questions: number; needsYou: number }> {
  const base = run ?? (await loadDemo(account)).run;
  const flow = runQuestionFlow(base, { ownAccounts, answers: { groups: {} } });
  return { questions: flow.questions.length, needsYou: flow.questions.reduce((n, q) => n + q.txs.length, 0) };
}
