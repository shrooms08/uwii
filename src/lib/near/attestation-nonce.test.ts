import assert from "node:assert/strict";
import { test } from "node:test";
import { nrasNonceProblem } from "./attestation";

test("NRAS eat_nonce: must be present and equal the client nonce (M3)", () => {
  const nonce = "ab".repeat(32);
  assert.equal(nrasNonceProblem({ eat_nonce: nonce }, nonce), null);
  assert.equal(nrasNonceProblem({ eat_nonce: nonce.toUpperCase() }, nonce), null, "hex case does not matter");
  assert.equal(nrasNonceProblem({}, nonce), "NRAS eat_nonce missing");
  assert.equal(nrasNonceProblem({ eat_nonce: "" }, nonce), "NRAS eat_nonce missing");
  assert.equal(nrasNonceProblem({ eat_nonce: 42 }, nonce), "NRAS eat_nonce missing");
  assert.equal(nrasNonceProblem({ eat_nonce: "cd".repeat(32) }, nonce), "NRAS eat_nonce does not match client nonce");
});
