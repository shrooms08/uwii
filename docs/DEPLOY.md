# Deploying Uwii on Vercel (Hobby)

The hosted demo runs on Vercel's Hobby plan, imported from the GitHub repository. Judges use it from
14 to 25 November 2026. Everything here is free-tier; no paid service is required.

## 1. Project settings

| Setting | Value |
| --- | --- |
| Framework preset | Next.js |
| Root directory | repository root |
| Install command | `npm install` (default) |
| Build command | `npm run build` (default `next build`) |
| Output directory | default (`.next`) |
| Node.js version | 24.x (also pinned by `"engines": { "node": "24.x" }` in package.json) |
| Fluid compute | on (the default for new projects) |
| Function region | default `iad1` is fine |

Function durations are set in code (`export const maxDuration`): 300 s for `/api/scan`, `/api/report`,
`/api/questions` and `/api/anchor` (the Hobby maximum), 60 s for `/api/verify`. Do not raise the
project's default above 300 s; Hobby does not allow it.

## 2. Environment variables

Set these in Project, Settings, Environment Variables (Production and Preview). Names only; never put
values in the repository. Values marked secret must be "Sensitive".

| Name | Required | Secret | Purpose |
| --- | --- | --- | --- |
| `NEAR_AI_API_KEY` | for live scans | yes | NEAR AI Cloud key for the TEE-attested AI classification step. Without it, live scans cannot classify; the cached demo still works. |
| `NEAR_NETWORK` | yes | no | Must be `testnet`. Anything else is refused. |
| `NEAR_ANCHOR_CONTRACT_ID` | for anchoring and /verify | no | The anchor contract account, `uwii-anchor.testnet`. Needed by `/verify` (read-only) and `/api/anchor`. |
| `NEAR_ANCHOR_ACCOUNT_ID` | for anchoring | no | The account that signs `anchor()` calls (the contract owner, `uwii-anchor.testnet`). |
| `NEAR_ANCHOR_PRIVATE_KEY` | for anchoring | yes | `ed25519:` private key of that account (from `.env.local`). Testnet only. |
| `MAX_AI_CALLS_PER_DAY` | no | no | Global cap on AI requests per UTC day. Default 150. `0` disables live scans (cached demo only). |
| `MAX_ANCHORS_PER_DAY` | no | no | Global cap on new anchor transactions per UTC day. Default 100. |
| `NEAR_ARCHIVAL_RPC_URL` | no | if it embeds a token | Faster mainnet archival RPC for staking snapshots of uncached accounts. |
| `NEAR_ARCHIVAL_RPC_MIN_INTERVAL_MS` | no | no | Pacing for that archival RPC (default 61000 for the public endpoint). |
| `COINGECKO_DEMO_API_KEY` | no | yes | CoinGecko demo key; the keyless public API is used without it. |
| `COINGECKO_MIN_INTERVAL_MS` | no | no | Pacing between CoinGecko calls. |
| `NEAR_TESTNET_RPC_URL` | no | if it embeds a token | Testnet RPC override (default FastNEAR, then rpc.testnet.near.org). |
| `NEAR_TESTNET_ARCHIVAL_RPC_URL` | no | if it embeds a token | Testnet archival RPC override for the verify page's transaction lookup. |
| `SCAN_TIME_BUDGET_MS` | no | no | Override for the scan time budget (default on Vercel: 280000, i.e. 300 s minus a 20 s margin). |
| `UWII_CACHE_DIR` | no | no | Override for the runtime cache directory (default on Vercel: `<os.tmpdir()>/uwii-cache`). |

Vercel sets `VERCEL` and `VERCEL_GIT_COMMIT_SHA` itself; do not set them.

## 3. What the deployment does differently

- **Read-only filesystem.** When `VERCEL` is set, runtime caches go to `<os.tmpdir()>/uwii-cache`
  (per instance, not persisted; every cache can be rebuilt) and any write elsewhere throws. The committed
  fixtures (`data/fixtures`) and CBN NFEM rates (`data/fx`) are read-only and are bundled into every API
  function through `outputFileTracingIncludes` in `next.config.ts`.
- **Live AI only through `/api/scan`.** `/api/report`, `/api/questions` and `/api/anchor` never classify
  live; an account that has not been scanned gets a 409 ("Start a scan first").
- **Limits (best-effort, in memory, per instance):**
  - scans: 5 per IP per hour; anchors: 3 per IP per hour (only new anchor transactions count);
  - global per UTC day: `MAX_AI_CALLS_PER_DAY` AI requests (checked before any AI call from the
    deterministic rule pre-pass) and `MAX_ANCHORS_PER_DAY` new anchors;
  - when a limit is hit the API returns 429 and the scan page offers "Load the cached demo report",
    which replays the committed `rybergh44.near` run (no AI call), labelled with its recorded
    attestation time.
  Several instances or a recycled instance each keep their own counters, so the effective limits can be
  higher than configured. IPs are kept only as hashes in memory and are never logged.
- **Time limit.** A scan that cannot finish inside the function limit (usually the live history fetch of
  a large account) streams: "This account is too large for the hosted demo's time limit. Run Uwii
  locally from the README."

## 4. Post-deploy checks

1. `GET /api/health` returns 200 with `ok: true`, `network: "testnet"`, `fixturesPresent: true`, the
   expected `configured` flags (true/false only, never values) and `version` equal to the deployed
   commit.
2. Home page, "Try the demo account", "Start private scan": the scan streams and reaches Done (one live
   AI call), then Questions, "Fill illustrative demo answers", 4/4, the Result is Final.
3. Export: the PDF downloads; "Anchor fingerprint" returns a testnet transaction; the link opens it on
   nearvalidate.org; `/verify?fingerprint=<the fingerprint>` shows Anchored, and a random fingerprint
   shows Not anchored.
4. Cached demo: open `/scan?account=rybergh44.near&cached=1`; it replays the committed run with the
   "Cached demo result" label and continues to Questions.
5. Watch usage: NEAR AI Cloud credit balance and the `uwii-anchor.testnet` balance (top up from the
   testnet faucet if it runs low). To stop live AI use without redeploying code, set
   `MAX_AI_CALLS_PER_DAY=0` and redeploy.
