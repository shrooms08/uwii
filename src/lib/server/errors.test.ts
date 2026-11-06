import assert from "node:assert/strict";
import { test } from "node:test";
import { GENERIC_ERROR, serverError } from "./errors";

test("5xx responses carry a generic message and an error id, never the internal message (L1)", async () => {
  const original = console.error;
  const logged: string[] = [];
  console.error = (m: string) => logged.push(m);
  try {
    const res = serverError("report", new Error("NEAR_AI_API_KEY is not set in .env.local at /var/task/data/x.json"));
    assert.equal(res.status, 500);
    const j = (await res.json()) as { error: string; code: string; errorId: string };
    assert.match(j.errorId, /^[0-9a-f]{8}$/);
    assert.equal(j.error, `${GENERIC_ERROR} ${j.errorId}.`);
    assert.equal(j.code, "server_error");
    assert.ok(!JSON.stringify(j).includes("NEAR_AI_API_KEY"));
    // The detail goes only to the server log, under the same id.
    assert.equal(logged.length, 1);
    assert.ok(logged[0].includes(j.errorId) && logged[0].includes("NEAR_AI_API_KEY"));
    assert.equal(serverError("verify", "x", 502).status, 502);
  } finally {
    console.error = original;
  }
});
