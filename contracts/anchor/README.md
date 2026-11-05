# Uwii report anchor (NEAR testnet)

Records the SHA-256 fingerprint of a **final** Uwii tax report on-chain, with the block time and height.
Only the fingerprint and the status `"final"` are stored; nothing in the report itself.

Deployed on testnet at `uwii-anchor.testnet` (owner: itself).

## Interface

- `new(owner: AccountId)`: init; only `owner` can anchor.
- `anchor(fingerprint: String, status: String) -> Anchor`: owner only; `fingerprint` must be 64 lowercase
  hex characters, `status` must be `"final"`, and each fingerprint can be anchored once. Emits a NEP-297
  event: `EVENT_JSON:{"standard":"uwii_anchor","version":"1.0.0","event":"anchor","data":[Anchor]}`.
- `get_anchor(fingerprint: String) -> Option<Anchor>` (view).
- `get_owner() -> AccountId` (view).

`Anchor = { fingerprint, status, anchored_at_ns, block_height, anchored_by }` (U64 values as JSON strings).

## Build, test, deploy

```bash
cargo test                                # unit tests
cargo near build non-reproducible-wasm    # target/near/anchor.wasm
cd ../.. && npm run deploy:anchor         # deploy + init on testnet (key from .env.local)
```

Toolchain: Rust 1.93.0 (rust-toolchain.toml), near-sdk 5.29, cargo-near 0.22.
