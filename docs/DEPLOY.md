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
| Node.js version | 24.x (package.json `"engines"` allows `>=22`) |
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
| `UWII_RUN_SECRET` | for live scans | yes | HMAC-SHA256 key (at least 32 characters; `openssl rand -hex 32`) that signs the classification run `/api/scan` returns to the browser. The browser sends the signed run back with every questions/report/anchor request, so any instance can build the report and no user can change another's run. Without it, live scans return 503; the cached demo still works. Changing it invalidates runs saved in browsers (users scan again). |
| `UWII_ENABLE_DEV_PAGES` | no | no | `1` turns the `/dev/*` developer pages on in production. Leave unset: they call live services without the hosted-demo limits. |
| `NEAR_NETWORK` | yes | no | Must be `testnet`. Anything else is refused. |
| `NEAR_ANCHOR_CONTRACT_ID` | for anchoring and /verify | no | The anchor contract account, `uwii-anchor.testnet`. Needed by `/verify` (read-only) and `/api/anchor`. |
| `NEAR_ANCHOR_ACCOUNT_ID` | for anchoring | no | The account that signs `anchor()` calls (the contract owner, `uwii-anchor.testnet`). |
| `NEAR_ANCHOR_PRIVATE_KEY` | for anchoring | yes | `ed25519:` private key of a **function-call** access key on that account, limited to receiver `uwii-anchor.testnet`, method `anchor`, 1 NEAR gas allowance (see "Anchor key rotation"). The server refuses to sign with a full-access key. Testnet only. |
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
- **Live AI only through `/api/scan`, and runs live in the browser.** `/api/scan` returns the classified run
  signed with `UWII_RUN_SECRET` (HMAC-SHA256) and writes no shared cache. The browser keeps `{ run, runSig }`
  in IndexedDB and sends them with every `/api/questions`, `/api/report` and `/api/anchor` request; the
  server verifies the signature and the account (400 otherwise). So any instance can serve any request,
  and one user's scan can never change another's report. Without a signed run, the committed demo fixture
  is used for `rybergh44.near`; any other account gets a 409 ("Start a scan first"). The opening position
  (archival RPC) is computed alongside the scan and travels in the signed run when it is ready in time;
  otherwise the report computes it (cached per instance). Request bodies are limited to 4.5 MB (Vercel's
  limit), checked in the browser first.
- **`/dev/*` is off.** The developer pages return 404 in production unless `UWII_ENABLE_DEV_PAGES=1`.
- **Errors.** Unexpected failures return "Something went wrong on our side … quote error <id>" (5xx). The
  internal message is logged once with that id (`[uwii error <id>]` in the Vercel function logs); no request
  body, answers or personal fields are ever logged.
- **Limits (best-effort, in memory, per instance):**
  - scans: 5 per IP per hour; anchors: 3 per IP per hour (checked before the report is rebuilt);
  - `/api/report`, `/api/questions`, `/api/verify`: 60 per IP per minute each;
  - request bodies over 4.5 MB get 413; answers are capped at 200 groups and 500 overrides, naira amounts
    or source legs per group;
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

## Anchor key rotation (function-call key on the server)

The anchoring account `uwii-anchor.testnet` is also the contract account, so its full-access key could
redeploy the contract or move funds. The server therefore holds only a **function-call** key:

| Key | Permission | Where it lives |
| --- | --- | --- |
| `ed25519:A6nj86jEDeczEJrKNhVLLRmbhh2HKR4S7a2LwpR5QRtE` | FunctionCall: receiver `uwii-anchor.testnet`, method `anchor`, allowance 1 NEAR | `NEAR_ANCHOR_PRIVATE_KEY` in `.env.local` and Vercel |
| `ed25519:DM5vW6wwzNQvGYww76SFbuuc14aY6Xn2HpMJK97Q3Zdm` | FullAccess (admin) | `NEAR_ANCHOR_ADMIN_PRIVATE_KEY` in `.env.anchor-admin.local` only (gitignored by `.env*.local`; Next.js never loads it); never in Vercel |

- The function-call key was added on 2026-11-06 in tx `C1UFJHBTogw6asLXh3TrBn7C5jnf9X1M5JeuXU3BjQZs`
  (near-cli-rs `account add-key … grant-function-call-access --allowance '1 NEAR' --contract-account-id
  uwii-anchor.testnet --function-names anchor`, signed with the full-access key).
- Checked on testnet with the function-call key: a transfer and a contract deploy were both refused
  ("Transaction requires a full permission access key").
- `src/lib/near/anchor.ts` checks the key's on-chain permission before the first signature and refuses a
  full-access key, or one not limited to `anchor` on the contract.
- `npm run deploy:anchor` loads `.env.anchor-admin.local` explicitly; it is the only thing that uses the
  admin key.

To rotate again:

1. Generate a key pair locally (for example `near account add-key uwii-anchor.testnet
   grant-function-call-access --allowance '1 NEAR' --contract-account-id uwii-anchor.testnet
   --function-names anchor autogenerate-new-keypair …`, signed with the admin key).
2. Put the new private key in `.env.local` and in Vercel as `NEAR_ANCHOR_PRIVATE_KEY`, then redeploy.
3. Delete the old function-call key with the admin key: `near account delete-keys uwii-anchor.testnet
   public-keys <old public key> network-config testnet sign-with-…`.
4. When the 1 NEAR allowance runs low, rotate the same way (an allowance cannot be raised in place).
