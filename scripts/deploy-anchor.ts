// Usage: npm run deploy:anchor   (after: cd contracts/anchor && cargo near build non-reproducible-wasm)
// Deploys contracts/anchor to NEAR_ANCHOR_CONTRACT_ID on testnet and initialises it with the contract
// account as owner, in one transaction. Reads the key from .env.local; never prints it.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Account, KeyPairSigner, actions, teraToGas, type KeyPairString } from "near-api-js";
import { anchorConfig, explorerTxUrl, nearProvider } from "../src/lib/near/anchor";

async function main() {
  const cfg = anchorConfig();
  if (!cfg || !cfg.accountId || !cfg.privateKey) throw new Error("Set NEAR_ANCHOR_ACCOUNT_ID, NEAR_ANCHOR_CONTRACT_ID and NEAR_ANCHOR_PRIVATE_KEY in .env.local");
  if (cfg.accountId !== cfg.contractId) throw new Error("This script deploys to the anchoring account itself (account id must equal contract id)");
  const wasm = await readFile(path.join(process.cwd(), "contracts/anchor/target/near/anchor.wasm"));
  const provider = nearProvider(cfg);
  const state = await provider.viewAccount({ accountId: cfg.contractId });
  if (state.code_hash !== "11111111111111111111111111111111") {
    console.log(`Code already deployed on ${cfg.contractId} (code hash ${state.code_hash}); not redeploying.`);
    return;
  }
  const account = new Account(cfg.accountId, provider, KeyPairSigner.fromSecretKey(cfg.privateKey as KeyPairString));
  const outcome = await account.signAndSendTransaction({
    receiverId: cfg.contractId,
    actions: [actions.deployContract(new Uint8Array(wasm)), actions.functionCall("new", { owner: cfg.accountId }, teraToGas("30"), BigInt(0))],
    waitUntil: "FINAL",
  });
  console.log(`Deployed and initialised ${cfg.contractId} (owner ${cfg.accountId}) on testnet`);
  console.log(`tx ${outcome.transaction_outcome.id}: ${explorerTxUrl(cfg.explorerBase, outcome.transaction_outcome.id)}`);
  const owner = await provider.callFunction({ contractId: cfg.contractId, method: "get_owner", args: {} });
  console.log(`get_owner() = ${String(owner)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
