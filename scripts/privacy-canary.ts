/**
 * Network canary for the browser-side report (needs `npm run build` first; starts `next start` itself).
 *
 * Enters canary values (other income 4,812,345.67, rent 1,234,567.89, TIN 99887766-0001, name "Canary
 * Taxpayer"), answers every question of the cached demo, views the result, downloads the PDF and the CSV,
 * and records every request the browser makes: none may carry a canary value or any answer. Then it
 * presses "Anchor fingerprint": that one request must carry the answers (never the name or TIN). The real
 * /api/anchor runs (signed run, recomputation, fingerprint check) with no anchoring key, so nothing is
 * written on-chain; the chain step is mocked in the browser.
 *
 *   npm run build && npm run test:privacy            (PORT=3200 by default)
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Request } from "playwright";
import { DEMO_ACCOUNT, ILLUSTRATIVE_ANSWERS } from "../src/lib/demo/illustrative-answers";

const PORT = Number(process.env.PORT ?? 3200);
const BASE = `http://localhost:${PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CANARIES = ["4812345.67", "4,812,345.67", "4812345", "1234567.89", "1,234,567.89", "1234567", "99887766-0001", "99887766", "Canary Taxpayer", "Canary"];
/** Every answer the demo flow gives: options, naira amounts, overrides and question groups. */
const ANSWERS = [
  ...new Set(
    Object.entries(ILLUSTRATIVE_ANSWERS.groups).flatMap(([group, g]) => [group, g.option, ...Object.values(g.ngn ?? {}), ...Object.values(g.overrides ?? {})]),
  ),
];
const PERSONAL = ["99887766-0001", "99887766", "Canary Taxpayer", "Canary"];

interface Seen {
  method: string;
  url: string;
  body: string;
}

const found = (r: Seen, needles: string[]) => {
  const hay = `${r.url}\n${decodeURIComponent(r.url)}\n${r.body}`.toLowerCase();
  return needles.filter((n) => hay.includes(n.toLowerCase()));
};

async function main() {
  const cache = mkdtempSync(path.join(os.tmpdir(), "uwii-canary-"));
  // No anchoring key: /api/anchor still verifies, recomputes and checks the fingerprint, then stops with 503.
  const env = { ...process.env, UWII_CACHE_DIR: cache, NEAR_ANCHOR_ACCOUNT_ID: "", NEAR_ANCHOR_PRIVATE_KEY: "", UWII_FAULTS: "" };
  const server = spawn("npx", ["next", "start", "-p", String(PORT)], { env, stdio: "ignore", detached: true });
  const results: string[] = [];
  let failed = false;
  const check = (ok: boolean, what: string) => {
    results.push(`${ok ? "PASS" : "FAIL"}  ${what}`);
    if (!ok) failed = true;
  };
  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`${BASE}/robots.txt`)).ok) break;
      } catch {
        // not up yet
      }
      await sleep(500);
    }
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce", acceptDownloads: true });
    const page = await context.newPage();
    const seen: Seen[] = [];
    const anchorBodies: Seen[] = [];
    let anchoring = false;
    const record = (req: Request) => {
      const r = { method: req.method(), url: req.url(), body: req.postData() ?? "" };
      if (r.url.startsWith("data:") || r.url.startsWith("blob:")) return;
      (anchoring && new URL(r.url).pathname === "/api/anchor" ? anchorBodies : seen).push(r);
    };
    context.on("request", record);

    // 1. The cached demo, every question answered (the illustrative answers), other income and rent entered.
    await page.goto(`${BASE}/scan?account=${DEMO_ACCOUNT}&cached=1`);
    await page.getByRole("link", { name: /Answer \d+ question/ }).click({ timeout: 60_000 });
    await page.getByRole("button", { name: "Fill illustrative demo answers" }).click({ timeout: 30_000 });
    await page.getByRole("link", { name: "See final result" }).waitFor({ timeout: 30_000 });

    // The demo itself still reaches Final NGN 41,231.99.
    await page.getByRole("link", { name: "See final result" }).click();
    await page.getByRole("heading", { name: /Your 2026 crypto tax/ }).waitFor({ timeout: 30_000 });
    await sleep(1500); // count-up animation
    const demo = await page.evaluate(() => document.body.innerText);
    check(/\bFinal\b/.test(demo) && /₦\s?41,231\.99/.test(demo), "demo result: Final, ₦41,231.99");

    await page.goto(`${BASE}/questions?account=${DEMO_ACCOUNT}`);
    await page.getByLabel(/Your other taxable income in 2026/).fill("4,812,345.67");
    await page.getByRole("button", { name: /Reliefs and deductions/ }).click();
    await page.getByLabel(/Rent you paid in 2026/).fill("1,234,567.89");
    await sleep(1200); // debounced recompute
    await page.getByRole("link", { name: "See final result" }).click({ timeout: 30_000 });
    await page.getByRole("heading", { name: /Your 2026 crypto tax/ }).waitFor({ timeout: 30_000 });
    await sleep(1500);

    // 2. Export: personal details, PDF and CSV.
    await page.goto(`${BASE}/export?account=${DEMO_ACCOUNT}`);
    await page.getByLabel("Taxpayer name").fill("Canary Taxpayer");
    await page.getByLabel("TIN").fill("99887766-0001");
    const pdf = page.waitForEvent("download", { timeout: 60_000 });
    await page.getByRole("button", { name: "Download PDF worksheet" }).click();
    check(/\.pdf$/.test((await pdf).suggestedFilename()), "PDF downloaded");
    const csv = page.waitForEvent("download", { timeout: 30_000 });
    await page.getByRole("button", { name: /^Download CSV$/ }).click();
    check(/\.csv$/.test((await csv).suggestedFilename()), "CSV downloaded");
    await page.getByRole("button", { name: "Anchor fingerprint" }).waitFor({ timeout: 30_000 });
    check(await page.getByText("Uwii's server recomputes your report from your answers").isVisible(), "anchor disclosure shown before the button");
    await sleep(500);

    const leaks = seen.flatMap((r) => found(r, [...CANARIES, ...ANSWERS]).map((n) => `${r.method} ${r.url} contains "${n}"`));
    check(leaks.length === 0, `${seen.length} requests before anchoring: no canary value or answer in any URL or body${leaks.length ? `\n      ${leaks.join("\n      ")}` : ""}`);

    // 3. Anchor: the real server checks and recomputes; only the chain write is mocked.
    let serverStatus = 0;
    let serverCode = "";
    await page.route("**/api/anchor", async (route) => {
      const real = await route.fetch();
      serverStatus = real.status();
      serverCode = ((await real.json().catch(() => ({}))) as { code?: string; error?: string }).code ?? "";
      const fingerprint = (JSON.parse(route.request().postData() ?? "{}") as { fingerprint?: string }).fingerprint ?? "";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          fingerprint,
          status: "final",
          network: "testnet",
          contractId: "uwii-anchor.testnet",
          anchoredBy: "uwii-anchor.testnet",
          blockHeight: "1",
          anchoredAt: new Date().toISOString(),
          txHash: "MockedTx",
          explorerUrl: "https://nearvalidate.org/txns/MockedTx?network=testnet",
          blockUrl: "https://nearvalidate.org/blocks/1?network=testnet",
          alreadyAnchored: false,
        }),
      });
    });
    const before = seen.length;
    anchoring = true;
    await page.getByRole("button", { name: "Anchor fingerprint" }).click();
    await page.getByText("Anchored on NEAR testnet").waitFor({ timeout: 60_000 });
    anchoring = false;
    check(anchorBodies.length === 1, `exactly one anchor request (${anchorBodies.length})`);
    const a = anchorBodies[0];
    if (a) {
      const carried = found(a, [...ANSWERS, "4812345.67", "1234567.89"]);
      check(carried.length === ANSWERS.length + 2, `the anchor request carries the answers, other income and rent (${carried.length}/${ANSWERS.length + 2})`);
      check(found(a, PERSONAL).length === 0, "the anchor request carries no name or TIN");
    }
    check(serverStatus === 503 && serverCode === "", `the server accepted the signed run and its recomputed fingerprint matched, then stopped for want of a key (HTTP ${serverStatus}${serverCode ? ` ${serverCode}` : ""})`);
    const after = seen.slice(before).flatMap((r) => found(r, [...CANARIES, ...ANSWERS]).map((n) => `${r.method} ${r.url} contains "${n}"`));
    check(after.length === 0, `requests other than the anchor carry nothing${after.length ? `\n      ${after.join("\n      ")}` : ""}`);

    console.log(`Requests seen (excluding the anchor): ${[...new Set(seen.map((r) => `${r.method} ${new URL(r.url).pathname}`))].sort().join(", ")}`);
    await browser.close();
  } finally {
    try {
      process.kill(-server.pid!, "SIGKILL");
    } catch {
      // already gone
    }
    rmSync(cache, { recursive: true, force: true });
  }
  console.log(results.join("\n"));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
