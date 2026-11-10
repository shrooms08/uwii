/** What an anchor proves and does not prove (audit finding L4). Shown on Export and /verify. */
export const ANCHOR_CAVEAT = "An anchor proves this exact report existed at that time. It does not prove the report is correct or that the account owner made it.";

/** Shown before the anchor button: anchoring is the one time the user's answers are sent to Uwii's server. */
export const ANCHOR_DISCLOSURE =
  "To anchor, Uwii's server recomputes your report from your answers to confirm it is final, then writes only the fingerprint on-chain. Your answers are not stored.";
