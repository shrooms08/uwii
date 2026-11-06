import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { devPagesEnabled } from "./dev-pages";

test("/dev pages: off in production and on Vercel unless UWII_ENABLE_DEV_PAGES=1", () => {
  assert.equal(devPagesEnabled({ NODE_ENV: "development" }), true);
  assert.equal(devPagesEnabled({ NODE_ENV: "test" }), true);
  assert.equal(devPagesEnabled({ NODE_ENV: "production" }), false);
  assert.equal(devPagesEnabled({ NODE_ENV: "development", VERCEL: "1" }), false);
  assert.equal(devPagesEnabled({ NODE_ENV: "production", UWII_ENABLE_DEV_PAGES: "1" }), true);
  assert.equal(devPagesEnabled({ NODE_ENV: "production", UWII_ENABLE_DEV_PAGES: "true" }), false, "only the exact value 1 enables them");
});

test("getClassification with own accounts never writes the shared classified cache", async () => {
  // Isolated cache dir; a placeholder AI key makes the AI preflight fail before any network call.
  const dir = mkdtempSync(path.join(os.tmpdir(), "uwii-devpages-"));
  process.env.UWII_CACHE_DIR = dir;
  process.env.NEAR_AI_API_KEY = "PASTE_KEY_HERE";
  try {
    const { classifiedCachePath, getClassification } = await import("../tax/ng/cache");
    const file = classifiedCachePath("rybergh44.near", "2026-01-01", "2026-12-31");
    // A base run (no own accounts) is already cached, as a completed scan leaves it.
    const base = readFileSync(path.join(process.cwd(), "data", "fixtures", "rybergh44.near-2026.classified.json"), "utf8");
    writeFileSync(file, base);
    const { run, origin } = await getClassification("rybergh44.near", "2026-01-01", "2026-12-31", { ownAccounts: ["attacker.near"] });
    assert.equal(origin, "live");
    assert.deepEqual(run.ownAccounts, ["attacker.near"]);
    assert.equal(readFileSync(file, "utf8"), base, "the shared base run is untouched");
    // Without a cached base run, nothing is written either.
    rmSync(file);
    await getClassification("rybergh44.near", "2026-01-01", "2026-12-31", { ownAccounts: ["attacker.near"] });
    assert.equal(existsSync(file), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
