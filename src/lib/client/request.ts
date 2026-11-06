/**
 * Request bodies built from what is saved in this browser. Answers, own accounts and profile are
 * sent only in request bodies; the server never stores them.
 */
import { parseAccountList } from "@/lib/near/account-id";
import type { GroupAnswer } from "@/lib/tax/ng/questions";
import { isPositiveQuantity, type SourceLegInput } from "@/lib/tax/ng/source-leg";
import { NGN_INPUT_RE, loadSource, stripNgn, type Saved } from "./storage";

/** Source leg as it will be sent: separators stripped; null until the asset and a positive quantity are given. */
export function legForRequest(leg: SourceLegInput | undefined): SourceLegInput | null {
  if (!leg) return null;
  const quantity = stripNgn(leg.quantity);
  if (!leg.asset.symbol.trim() || leg.asset.contract === "" || !isPositiveQuantity(quantity)) return null;
  return { asset: leg.asset, quantity, ...(leg.timestamp ? { timestamp: leg.timestamp } : {}) };
}

/** Body for /api/questions and /api/report (naira separators stripped, incomplete source legs left out). */
export function requestBody(account: string, saved: Saved) {
  const groups: Record<string, GroupAnswer> = {};
  for (const [id, g] of Object.entries(saved.groups)) {
    const ngn = g.ngn ? Object.fromEntries(Object.entries(g.ngn).map(([k, v]) => [k, stripNgn(v)]).filter(([, v]) => v !== "")) : undefined;
    const legs = g.sourceLegs
      ? Object.fromEntries(
          Object.entries(g.sourceLegs).flatMap(([k, v]) => {
            const l = legForRequest(v);
            return l ? [[k, l]] : [];
          }),
        )
      : undefined;
    groups[id] = {
      option: g.option,
      ...(g.overrides && Object.keys(g.overrides).length ? { overrides: g.overrides } : {}),
      ...(ngn && Object.keys(ngn).length ? { ngn } : {}),
      ...(legs && Object.keys(legs).length ? { sourceLegs: legs } : {}),
    };
  }
  const other = stripNgn(saved.otherIncomeNgn);
  return {
    account,
    ownAccounts: parseAccountList(saved.ownText).filter((a) => a !== account),
    answers: { groups },
    profile: { otherIncomeNgn: NGN_INPUT_RE.test(other) ? other : "" },
    // The cached demo result: stay on the committed classified run (no live AI).
    ...(loadSource(account) ? { classificationSource: "fixture" as const } : {}),
  };
}

export async function postJson<T>(url: string, body: unknown, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}
