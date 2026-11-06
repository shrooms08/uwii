/**
 * Request bodies built from what is saved in this browser. Answers, own accounts and profile are
 * sent only in request bodies; the server never stores them.
 */
import { parseAccountList } from "@/lib/near/account-id";
import type { GroupAnswer } from "@/lib/tax/ng/questions";
import { isPositiveQuantity, type SourceLegInput } from "@/lib/tax/ng/source-leg";
import { NGN_INPUT_RE, loadSource, stripNgn, type Saved } from "./storage";
import { loadRun } from "./runs";

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
  // Reliefs: only well-formed amounts are sent (an invalid field is flagged in the form and left out).
  const reliefs = Object.fromEntries(
    Object.entries(saved.reliefs ?? {})
      .map(([k, v]) => [k, stripNgn(v ?? "")])
      .filter(([, v]) => v !== "" && NGN_INPUT_RE.test(v)),
  );
  return {
    account,
    ownAccounts: parseAccountList(saved.ownText).filter((a) => a !== account),
    answers: { groups },
    profile: { otherIncomeNgn: NGN_INPUT_RE.test(other) ? other : "", ...(Object.keys(reliefs).length ? { reliefs } : {}) },
    // The cached demo result: stay on the committed classified run (no live AI).
    ...(loadSource(account) ? { classificationSource: "fixture" as const } : {}),
  };
}

/**
 * Request size limit. Vercel refuses request bodies over 4.5 MB before the app sees them, so the
 * browser checks first and explains (the server answers 413 above the same limit).
 */
export const MAX_BODY_BYTES = 4_500_000;
export const TOO_LARGE_BODY = "This account's scan is too large to send back for a report (over 4.5 MB). Uwii can't compute it in the hosted demo yet.";

/** JSON body with the saved signed run attached (not for the cached demo, which uses the committed fixture). */
export async function serializeBody(body: { account?: string; classificationSource?: string } & Record<string, unknown>): Promise<string> {
  let full: Record<string, unknown> = body;
  if (body.account && !body.classificationSource) {
    const signed = await loadRun(body.account);
    if (signed) full = { ...body, run: signed.run, runSig: signed.runSig };
  }
  const text = JSON.stringify(full);
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new Error(TOO_LARGE_BODY);
  return text;
}

export async function postJson<T>(url: string, body: { account?: string; classificationSource?: string } & Record<string, unknown>, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: await serializeBody(body), signal });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}
