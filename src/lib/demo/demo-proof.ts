/**
 * Privacy proof of the committed demo run (rybergh44.near), for the landing page. Server-only: the
 * fixture is imported at build time and only the small proof object reaches the browser.
 */
import fixture from "../../../data/fixtures/rybergh44.near-2026.classified.json";
import { privacyProofFromRun, type PrivacyProof } from "../report/privacy";
import type { ClassifiedRun } from "../tax/ng/types";

const run = fixture as unknown as ClassifiedRun;

export const demoPrivacyProof: PrivacyProof = privacyProofFromRun(run);
/** Transactions the deterministic rules labelled in that run. */
export const demoRuleCount: number = run.records.length - demoPrivacyProof.aiDecisions;
