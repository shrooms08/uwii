# Uwii

Private crypto-tax agent on NEAR. Uwii reads an individual's NEAR account history, labels each
transaction with deterministic rules from NRS Information Circular 2026/21, classifies the rest with an
AI model running in a verified TEE (NEAR AI Cloud, attestation and per-response signatures checked),
asks the owner about anything it cannot tell, and computes the 2026 Nigerian tax with a worksheet
(PDF/CSV) whose fingerprint can be anchored on NEAR testnet.

Computation for review; not tax advice.

## Run locally

Requirements: Node.js 24, npm.

```bash
npm install
cp .env.example .env.local   # fill in what you need (see below); never commit .env.local
npm run dev                  # http://localhost:3000
```

The demo account `rybergh44.near` works with no keys and no live data calls: its history,
classification, prices and opening position are committed in `data/fixtures/`. Use "Try the demo
account" on the home page, then "Fill illustrative demo answers" on the Questions page.

Scanning other accounts reads live data:

- NearBlocks free API (paced at about 6 calls a minute) and the NEAR archival RPC (paced at about one
  call a minute for staking snapshots), so a large account can take many minutes. The hosted demo stops
  scans at its function time limit; running locally has no such limit.
- `NEAR_AI_API_KEY` is required for the AI classification step (NEAR AI Cloud).

Optional: `NEAR_ARCHIVAL_RPC_URL` (a faster mainnet archival RPC), `COINGECKO_DEMO_API_KEY`.
Testnet anchoring needs the `NEAR_ANCHOR_*` variables (see `docs/DEPLOY.md`).

## Useful scripts

```bash
npm test                 # unit and integration tests (node:test)
npm run build && npm start   # production mode
npm run fetch:history -- --account <id>
npm run classify -- --account <id> [--refresh]
npm run report -- --account <id> [--answers answers.json]
npm run deploy:anchor    # deploy contracts/anchor to testnet (key from .env.local)
```

The anchor contract lives in `contracts/anchor` (Rust, near-sdk, cargo-near). Deployment notes for
Vercel: `docs/DEPLOY.md`. Tax decisions: `docs/rules-ng-2026-21.md`.

Powered by NearBlocks.io APIs.
