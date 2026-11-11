/**
 * What Uwii's privacy proof covers and does not cover (audit findings M3 and N5). Shown in the privacy
 * panel and the guide, and mirrored in the README. Every line must stay true of src/lib/near/attestation.ts.
 */

/** Where the user's own inputs go. The one place this claim is worded: every other mention uses it verbatim. */
export const ANCHOR_EXCEPTION = "only if you choose to anchor; even then, your name, TIN and state are never sent";
export const PRIVATE_INPUTS_CLAIM = `Your answers, other income, reliefs and personal details are processed in your browser and sent to Uwii ${ANCHOR_EXCEPTION}.`;
/** The exception, said next to any shorter "your answers stay on your device" line. */
export const ANSWERS_EXCEPTION_LINE = `The one exception: your answers reach Uwii ${ANCHOR_EXCEPTION}.`;

export const PRIVACY_SCOPE = {
  title: "What this proof covers",
  covers: [
    { title: "Genuine hardware", text: "Genuine Intel TDX and NVIDIA GPU hardware: the TDX quote is verified with Intel DCAP and the GPU evidence by NVIDIA's attestation service." },
    { title: "Debug off", text: "Debug mode is off." },
    { title: "Fresh nonce", text: "A fresh nonce from Uwii is inside every attestation report, so the reports were made for this scan." },
    { title: "Signer bound to the hardware", text: "The key that signs the AI's responses is bound to the attested hardware." },
    { title: "Signed responses", text: "Each AI response is signed over its exact bytes, and Uwii checks every signature." },
  ],
  notTitle: "What it does not cover",
  notCovered: [
    { title: "No pinned list of approved builds", text: "A pinned allowlist of approved software builds: Uwii checks that the reported configuration matches the hardware measurement, not that it is a build it has approved." },
    { title: "TLS termination", text: "That TLS terminates inside the attested gateway." },
    { title: "NVIDIA token checked by NVIDIA", text: "Local validation of NVIDIA's attestation token: Uwii relies on NVIDIA's service over HTTPS." },
    { title: "Your answers are not part of it", text: PRIVATE_INPUTS_CLAIM + " They never reach the TEE: the AI only ever receives public on-chain data." },
  ],
};
