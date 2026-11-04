import { connection } from "next/server";
import { Suspense } from "react";
import { runPhase1 } from "@/lib/near/phase1";

export const maxDuration = 300;

const pre = { background: "#f4f4f4", padding: 12, overflowX: "auto" } as const;

async function AttestResult() {
  // Fresh nonce + fresh evidence on every request: never prerender or cache.
  await connection();
  const result = await runPhase1();
  const { attestation } = result;

  return (
    <>
      <section>
        <h2 style={{ fontSize: 16 }}>Model</h2>
        <p>
          <code>{result.model?.id ?? "(none chosen)"}</code>
        </p>
        {result.model && <p style={{ color: "#555", fontSize: 14 }}>{result.model.reason}</p>}
      </section>

      <section>
        <h2 style={{ fontSize: 16 }}>Validated classification</h2>
        {result.classification ? (
          <pre style={pre}>{JSON.stringify(result.classification.classification, null, 2)}</pre>
        ) : (
          <p style={{ color: "#b00020" }}>{result.classificationError}</p>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 16 }}>Attestation</h2>
        <p
          data-testid="attestation-badge"
          style={{
            display: "inline-block",
            padding: "6px 12px",
            borderRadius: 6,
            color: "#fff",
            fontWeight: 600,
            background: attestation.verified ? "#1a7f37" : "#b00020",
          }}
        >
          {attestation.verified ? "Attestation verified" : `Attestation NOT verified: ${attestation.details}`}
        </p>
        {attestation.verified && <p style={{ fontSize: 14 }}>{attestation.details}</p>}
        <details>
          <summary style={{ cursor: "pointer" }}>Raw attestation summary</summary>
          <pre style={{ ...pre, fontSize: 12 }}>{JSON.stringify(attestation.rawAttestationSummary, null, 2)}</pre>
        </details>
      </section>
    </>
  );
}

export default function AttestPage() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 860, margin: "0 auto", padding: 24, lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 22 }}>Uwii · Phase 1 attestation check</h1>
      <Suspense fallback={<p>Running private inference and verifying TEE attestation…</p>}>
        <AttestResult />
      </Suspense>
    </main>
  );
}
